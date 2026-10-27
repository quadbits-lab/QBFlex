import { test, expect } from 'bun:test';
import { Database as SQLite } from 'bun:sqlite';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, createHmac } from 'node:crypto';
import { Database, parameters, restoreDatabase } from '../packages/database/src/connection';
import {
  convertSQLiteDatabase,
  inspectSQLiteDatabase,
  migrateEngine,
} from '../packages/database/src/legacy';
import { acquireLease } from '../packages/database/src/lease';
import { createRealm } from '@qb-flex/auth';
import { betterAuth } from 'better-auth';
import { bearer, twoFactor } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
const master = 'migration-fixture-master-key-with-32-characters';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'qb-pglite-migration-'));
  return {
    directory,
    source: join(directory, 'source.sqlite'),
    target: join(directory, 'target.pglite'),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
test('SQL parameter numbering preserves literals, comments, quoted identifiers and function bodies', () => {
  expect(parameters(`SELECT ?, '?', "?", $$?$$, $body$?$body$ -- ?\n, ? /* ? */`)).toBe(
    `SELECT $1, '?', "?", $$?$$, $body$?$body$ -- ?\n, $2 /* ? */`,
  );
});
test('PGlite transactions isolate nested work, roll back policy failures and persist committed rows', async () => {
  const f = fixture();
  let db = new Database(f.target);
  try {
    expect(await db.query('SELECT $1::jsonb ? $2 AS present').get('{"ok":true}', 'ok')).toEqual({
      present: true,
    });
    await db.exec('CREATE TABLE entries(id bigint PRIMARY KEY,value text NOT NULL)');
    await db
      .transaction(async (tx) => {
        await tx.query('INSERT INTO entries VALUES($1,$2)').run(1, 'kept');
        await expect(
          tx
            .transaction(async (nested) => {
              await nested.query('INSERT INTO entries VALUES($1,$2)').run(2, 'discarded');
              throw new Error('rollback');
            })
            .immediate(),
        ).rejects.toThrow('rollback');
      })
      .immediate();
    await db.close();
    db = new Database(f.target);
    expect(await db.query('SELECT * FROM entries').all()).toEqual([{ id: 1, value: 'kept' }]);
    await db.snapshot(join(f.directory, 'snapshot.tar'));
    await restoreDatabase(join(f.directory, 'snapshot.tar'), join(f.directory, 'restored.pglite'));
    const restored = new Database(join(f.directory, 'restored.pglite'));
    try {
      expect(await restored.query('SELECT * FROM entries').all()).toEqual([
        { id: 1, value: 'kept' },
      ]);
    } finally {
      await restored.close();
    }
  } finally {
    await db.close();
    f.close();
  }
}, 15000);
test('SQLite conversion preserves binary values, int64 identities, constraints, indexes and deleted sequence positions', async () => {
  const f = fixture();
  const old = new SQLite(f.source, { safeIntegers: true });
  try {
    old.exec(
      "PRAGMA foreign_keys=ON;CREATE TABLE parents(id INTEGER PRIMARY KEY AUTOINCREMENT,label TEXT NOT NULL UNIQUE);CREATE TABLE children(id TEXT PRIMARY KEY NOT NULL,parent_id INTEGER NOT NULL REFERENCES parents(id),payload BLOB,amount INTEGER NOT NULL,flag BOOLEAN CHECK(flag IN(0,1)),metadata JSON CHECK(json_valid(metadata)));INSERT INTO parents VALUES(1,'retained'),(9223372036854775806,'deleted');DELETE FROM parents WHERE id>1;CREATE INDEX child_parent ON children(parent_id);INSERT INTO children VALUES('c',1,X'00FF',9223372036854775807,1,'{\"ok\":true}');",
    );
  } finally {
    old.close();
  }
  const before = createHash('sha256').update(readFileSync(f.source)).digest('hex');
  try {
    expect(inspectSQLiteDatabase(f.source).issues).toEqual([]);
    await convertSQLiteDatabase(f.source, f.target);
    expect(createHash('sha256').update(readFileSync(f.source)).digest('hex')).toBe(before);
    const db = new Database(f.target);
    try {
      const row = await db.query('SELECT * FROM children').get();
      expect(row!.amount).toBe('9223372036854775807');
      expect(Buffer.from(row!.payload).toString('hex')).toBe('00ff');
      expect(row!.metadata).toBe('{"ok":true}');
      expect(
        (await db.query("INSERT INTO parents(label) VALUES('next') RETURNING id").get())!.id,
      ).toBe('9223372036854775807');
      await expect(
        db.query("INSERT INTO children(id,parent_id,amount) VALUES('bad',99,1)").run(),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  } finally {
    f.close();
  }
}, 15000);
test('conversion blocks custom objects and mixed-type data, and never leaves a partial destination', async () => {
  const f = fixture();
  const db = new SQLite(f.source);
  db.exec(
    "CREATE TABLE mixed(id INTEGER PRIMARY KEY,value INTEGER);INSERT INTO mixed VALUES(1,'text');CREATE VIEW report AS SELECT * FROM mixed;CREATE TABLE invalid_utf8(value TEXT);INSERT INTO invalid_utf8 VALUES(CAST(X'FF' AS TEXT));CREATE TABLE nul_text(value TEXT);INSERT INTO nul_text VALUES('before'||char(0)||'after');",
  );
  db.close();
  try {
    const report = inspectSQLiteDatabase(f.source);
    expect(report.issues.length).toBe(4);
    await expect(convertSQLiteDatabase(f.source, f.target)).rejects.toMatchObject({
      code: 'MIGRATION_INCOMPATIBLE',
    });
    expect(existsSync(f.target)).toBe(false);
  } finally {
    f.close();
  }
});
test('auth conversion preserves user IDs, password hashes, dates, MFA flags and live sessions', async () => {
  const f = fixture();
  const old = new SQLite(f.source);
  const options = {
    database: old,
    secret: master,
    baseURL: 'http://localhost:7612',
    basePath: '/auth',
    user: { modelName: '_qb_auth_users' },
    session: { modelName: '_qb_auth_sessions' },
    account: { modelName: '_qb_auth_accounts' },
    verification: { modelName: '_qb_auth_verifications' },
    emailAndPassword: { enabled: true },
    plugins: [bearer(), twoFactor({ issuer: 'QB Flex', twoFactorTable: '_qb_auth_two_factor' })],
  };
  let registration: any;
  let enrollment: { totpURI: string; backupCodes: string[] } | undefined;
  try {
    await (await getMigrations(options)).runMigrations();
    const auth = betterAuth(options);
    registration = await auth.api.signUpEmail({
      body: {
        name: 'Migrated',
        email: 'migrated@example.com',
        password: 'migration-password-12345',
      },
    });
    const enabled = await auth.api.enableTwoFactor({
      body: { password: 'migration-password-12345' },
      headers: new Headers({ authorization: 'Bearer ' + registration.token }),
    });
    if (enabled.method !== 'totp') throw new Error('Expected TOTP enrollment');
    enrollment = enabled;
  } finally {
    old.close();
  }
  try {
    await convertSQLiteDatabase(f.source, f.target);
    const db = new Database(f.target);
    try {
      const auth = await createRealm(db, {
        secret: master,
        baseURL: 'http://localhost:7612',
        basePath: '/auth',
        origins: [],
      });
      const session = await auth.api.getSession({
        headers: new Headers({ authorization: 'Bearer ' + registration.token }),
      });
      expect(session?.user.id).toBe(registration.user.id);
      const login = await auth.api.signInEmail({
        body: { email: 'migrated@example.com', password: 'migration-password-12345' },
      });
      expect(login.user.id).toBe(registration.user.id);
      const newUser = await auth.api.signUpEmail({
        body: {
          name: 'New user',
          email: 'new-after-migration@example.com',
          password: 'migration-password-12345',
        },
      });
      expect(newUser.user.id).toBeTruthy();
      const secret = new URL(enrollment!.totpURI).searchParams.get('secret')!;
      let bits = '';
      for (const ch of secret.replace(/=+$/, ''))
        bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
      const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((value) => parseInt(value, 2)));
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
      const digest = createHmac('sha1', key).update(counter).digest(),
        offset = digest[digest.length - 1]! & 15;
      const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
      await auth.api.verifyTOTP({
        body: { code },
        headers: new Headers({ authorization: 'Bearer ' + login.token }),
      });
      const challenge: any = await auth.api.signInEmail({
        body: { email: 'migrated@example.com', password: 'migration-password-12345' },
      });
      expect(challenge.twoFactorRedirect).toBe(true);
    } finally {
      await db.close();
    }
  } finally {
    f.close();
  }
}, 15000);
test('whole-installation preflight rejects overlapping paths and both current and legacy active owners', async () => {
  const f = fixture();
  mkdirSync(join(f.directory, 'source'));
  const source = join(f.directory, 'source');
  const target = join(f.directory, 'destination');
  try {
    await expect(
      migrateEngine({ dataDir: source, outputDir: join(source, 'child'), check: true }),
    ).rejects.toMatchObject({ code: 'MIGRATION_PATH' });
    const release = acquireLease(source);
    try {
      await expect(
        migrateEngine({ dataDir: source, outputDir: target, check: true }),
      ).rejects.toMatchObject({ code: 'OWNER_LOCK' });
    } finally {
      release();
    }
    const lock = new SQLite(join(source, '.owner.sqlite'));
    lock.exec('BEGIN EXCLUSIVE;CREATE TABLE lease(id INTEGER PRIMARY KEY)');
    try {
      await expect(
        migrateEngine({ dataDir: source, outputDir: target, check: true }),
      ).rejects.toMatchObject({ code: 'OWNER_LOCK' });
    } finally {
      lock.close();
    }
    expect(existsSync(target)).toBe(false);
  } finally {
    f.close();
  }
});

test('complete installation conversion preserves catalog, branch policies, event checkpoints, keys and archive references', async () => {
  const f = fixture(),
    source = join(f.directory, 'installation'),
    destination = join(f.directory, 'converted');
  mkdirSync(source);
  writeFileSync(join(source, 'master.key'), master, { mode: 0o600 });
  const project = crypto.randomUUID(),
    branch = crypto.randomUUID(),
    organization = crypto.randomUUID();
  const branchFolder = join(source, 'projects', project, 'branches', branch);
  mkdirSync(branchFolder, { recursive: true });
  const catalog = new SQLite(join(source, 'control.sqlite'));
  const authOptions = {
    database: catalog,
    secret: master,
    baseURL: 'http://localhost:7612',
    user: { modelName: '_qb_auth_users' },
    session: { modelName: '_qb_auth_sessions' },
    account: { modelName: '_qb_auth_accounts' },
    verification: { modelName: '_qb_auth_verifications' },
  };
  try {
    await (await getMigrations(authOptions)).runMigrations();
    for (const id of ['001-foundation', '002-credentials', '003-delivery-security']) {
      const sql = readFileSync(
        new URL('../migrations/control/' + id + '.sql', import.meta.url),
        'utf8',
      );
      catalog.exec(sql);
      catalog
        .query('INSERT INTO control_migrations VALUES(?,?,?)')
        .run(id, createHash('sha256').update(sql).digest('hex'), '2026-10-15T00:00:00Z');
    }
    catalog
      .query('INSERT INTO organizations VALUES(?,?,?)')
      .run(organization, 'Preserved', '2026-10-15');
    catalog
      .query('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)')
      .run(
        project,
        organization,
        'Project',
        'project',
        'ready',
        'local',
        'encrypted-config',
        '2026-10-15',
      );
    catalog
      .query('INSERT INTO branches VALUES(?,?,?,?,?,?)')
      .run(branch, project, 'main', 'ready', 1, '2026-10-15');
    catalog
      .query('INSERT INTO project_keys VALUES(?,?,?,?,?,?,?)')
      .run('key', project, 'publishable', 'protected-hash', 'prefix', null, null);
    mkdirSync(join(source, 'backups'));
    const archive = join(source, 'backups', 'historical.sqlite.enc');
    writeFileSync(archive, 'authenticated-archive-fixture');
    catalog
      .query('INSERT INTO backups VALUES(?,?,?,?,?,?,?)')
      .run('backup', project, branch, 'preserved-checksum', archive, 1, '2026-10-15');
  } finally {
    catalog.close();
  }
  const oldBranch = new SQLite(join(branchFolder, 'main.sqlite'));
  try {
    oldBranch.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL);INSERT INTO tasks VALUES('row','Preserved');
      CREATE TABLE _qb_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO _qb_meta VALUES('schema_version','1');
      CREATE TABLE _qb_schema_exposure(table_name TEXT PRIMARY KEY,enabled INTEGER NOT NULL,allowed_columns TEXT NOT NULL);
      INSERT INTO _qb_schema_exposure VALUES('tasks',1,'["id","title"]');
      CREATE TABLE _qb_policies(id TEXT PRIMARY KEY,resource TEXT NOT NULL,definition TEXT NOT NULL);
      CREATE TABLE _qb_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,operation TEXT NOT NULL,pk_json TEXT NOT NULL,old_json TEXT,new_json TEXT,schema_version INTEGER NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO _qb_outbox VALUES(1000,'tasks','insert','{"id":"row"}',NULL,'{"id":"row","title":"Preserved"}',1,'2026-10-15T00:00:00Z');`);
    oldBranch.query('INSERT INTO _qb_policies VALUES(?,?,?)').run(
      'policy',
      'tasks',
      JSON.stringify({
        id: 'policy',
        resource: 'tasks',
        operation: 'select',
        roles: ['anonymous'],
        mode: 'permissive',
        enabled: true,
        using: { op: 'true' },
        check: { op: 'true' },
      }),
    );
  } finally {
    oldBranch.close();
  }
  const controlBefore = readFileSync(join(source, 'control.sqlite')),
    branchBefore = readFileSync(join(branchFolder, 'main.sqlite'));
  try {
    const report = await migrateEngine({ dataDir: source, outputDir: destination, check: true });
    expect(report.databases.flatMap((r) => r.issues)).toEqual([]);
    expect(existsSync(destination)).toBe(false);
    await migrateEngine({ dataDir: source, outputDir: destination });
    expect(JSON.parse(readFileSync(join(destination, 'engine.json'), 'utf8')).complete).toBe(true);
    expect(readFileSync(join(source, 'control.sqlite'))).toEqual(controlBefore);
    expect(readFileSync(join(branchFolder, 'main.sqlite'))).toEqual(branchBefore);
    expect(readFileSync(join(destination, 'master.key'), 'utf8')).toBe(master);
    const db = new Database(join(destination, 'control.pglite'));
    try {
      expect((await db.query('SELECT hash FROM project_keys').get())!.hash).toBe('protected-hash');
      const b = await db.query('SELECT path FROM backups').get();
      expect(b!.path).toBe(realpathSync(join(destination, 'backups', 'historical.sqlite.enc')));
      expect(readFileSync(b!.path, 'utf8')).toBe('authenticated-archive-fixture');
      expect((await db.query('SELECT count(*) AS n FROM engine_migrations').get())!.n).toBe(
        readdirSync(join(import.meta.dir, '..', 'migrations', 'pglite')).filter((f) =>
          f.endsWith('.sql'),
        ).length,
      );
    } finally {
      await db.close();
    }
    const { BranchEngine } = await import('../packages/database/src/engine');
    const data = new Database(
      join(destination, 'projects', project, 'branches', branch, 'main.pglite'),
    );
    try {
      const engine = await new BranchEngine(data, 'fixture').initialize();
      expect(await engine.latest()).toBe(1000);
      expect((await engine.read('tasks', {}, { sub: null, role: 'anonymous' })).data).toEqual([
        { id: 'row', title: 'Preserved' },
      ]);
    } finally {
      await data.close();
    }
  } finally {
    f.close();
  }
}, 20000);

test('SIGKILL during installation conversion preserves the source and leaves an unopenable incomplete destination', async () => {
  const f = fixture(),
    source = join(f.directory, 'source'),
    destination = join(f.directory, 'destination');
  mkdirSync(source);
  const sqlite = new SQLite(join(source, 'control.sqlite'));
  sqlite.exec('CREATE TABLE _qb_auth_users(id TEXT PRIMARY KEY)');
  for (const id of ['001-foundation', '002-credentials', '003-delivery-security']) {
    const sql = readFileSync(
      new URL('../migrations/control/' + id + '.sql', import.meta.url),
      'utf8',
    );
    sqlite.exec(sql);
    sqlite
      .query('INSERT INTO control_migrations VALUES(?,?,?)')
      .run(id, createHash('sha256').update(sql).digest('hex'), '2026-10-15');
  }
  sqlite.close();
  writeFileSync(join(source, 'master.key'), master);
  const before = readFileSync(join(source, 'control.sqlite'));
  const cli = new URL('../apps/cli/src/index.ts', import.meta.url).pathname;
  const child = Bun.spawn(
    [
      process.execPath,
      cli,
      'db',
      'migrate-engine',
      '--from',
      'sqlite',
      '--to',
      'pglite',
      '--data-dir',
      source,
      '--output-dir',
      destination,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  try {
    for (
      let i = 0;
      i < 1000 &&
      !existsSync(join(destination, 'engine.migrating.json')) &&
      child.exitCode === null;
      i++
    )
      await Bun.sleep(5);
    expect(existsSync(join(destination, 'engine.migrating.json'))).toBe(true);
    child.kill('SIGKILL');
    await child.exited;
    expect(existsSync(join(destination, 'engine.json'))).toBe(false);
    expect(readFileSync(join(source, 'control.sqlite'))).toEqual(before);
    const { createService } = await import('../apps/api/src/service');
    await expect(createService({ dataDir: destination, master, port: 0 })).rejects.toMatchObject({
      code: 'ENGINE_MIGRATION_REQUIRED',
    });
    expect(existsSync(join(destination, 'owner.lock'))).toBe(false);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await child.exited;
    }
    f.close();
  }
}, 15000);
