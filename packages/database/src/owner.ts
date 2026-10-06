import { openDatabase } from './index';
import { BranchEngine } from './engine';
import {
  initializeBranch,
  schema,
  schemaVersion,
  policies,
  savePolicy,
  expose,
  registerRelationship,
  registerRPC,
} from '@qb-flex/schema';
import { createRealm } from '@qb-flex/auth';
import { QBError, type Identity } from '@qb-flex/contracts';
import { createHash } from 'node:crypto';
let engine: BranchEngine;
let auth: Awaited<ReturnType<typeof createRealm>>;
let serial = Promise.resolve();
async function run(action: string, a: any) {
  if (action === 'close') {
    engine.db.close(true);
    return true;
  }
  if (action === 'auth') {
    const response = await auth.handler(
      new Request(a.url, {
        method: a.method,
        headers: a.headers,
        ...(a.body ? { body: a.body } : {}),
      }),
    );
    return {
      status: response.status,
      headers: [...response.headers.entries()],
      body: await response.text(),
    };
  }
  if (action === 'identity') {
    const session = await auth.api.getSession({ headers: new Headers(a.headers) });
    return session ? { sub: session.user.id, role: 'authenticated' } : null;
  }
  const identity: Identity = a.identity ?? { sub: null, role: 'anonymous' };
  switch (action) {
    case 'schema':
      if (!a.privileged) engine.assertSchema();
      return {
        tables: schema(engine.db)
          .filter((t) => a.privileged || t.exposed)
          .map((t) =>
            a.privileged
              ? t
              : {
                  ...t,
                  columns: t.columns.filter((c) => t.allowedColumns.includes(c.name)),
                  indexes: [],
                  foreignKeys: [],
                  relationships: t.relationships?.filter((r) =>
                    schema(engine.db).some((t) => t.exposed && t.name === r.target),
                  ),
                },
          ),
        schemaVersion: schemaVersion(engine.db),
      };
    case 'policies':
      return policies(engine.db);
    case 'policy':
      return engine.savePolicy(a.policy);
    case 'relationship':
      return registerRelationship(engine.db, a.relationship);
    case 'rpc-register':
      return registerRPC(engine.db, a.operation);
    case 'rpc-list':
      return engine.db
        .query('SELECT definition FROM _qb_rpc')
        .all()
        .map((r: any) => JSON.parse(r.definition));
    case 'rpc':
      return engine.rpc(a.name, a.args, identity, a.idempotency);
    case 'expose':
      return expose(engine.db, a.table, a.enabled, a.columns);
    case 'read':
      return engine.read(a.table, a.query, identity, a.privileged);
    case 'mutate':
      return engine.mutate(
        a.table,
        a.method,
        a.input,
        identity,
        a.key,
        a.idempotency,
        a.privileged,
        a.revision,
      );
    case 'migration':
      return engine.migration(a.id, a.sql, a.author);
    case 'migrations':
      return engine.db
        .query('SELECT id,checksum,author,applied_at FROM _qb_migrations ORDER BY applied_at')
        .all();
    case 'sql':
      engine.safeSQL(a.sql);
      if (/^\s*(select|with)\b/i.test(a.sql))
        return engine.db.query(`SELECT * FROM (${a.sql.trim().replace(/;$/, '')}) LIMIT 500`).all();
      else return engine.migration(crypto.randomUUID(), a.sql, a.author);
    case 'types':
      return engine.types();
    case 'snapshot':
      return engine.snapshot(a.path);
    case 'events':
      return engine.events(a.after, identity, a.table);
    case 'latest':
      return engine.latest();
    case 'users':
      return engine.db
        .query(
          'SELECT id,email,name,emailVerified,createdAt FROM _qb_auth_users ORDER BY createdAt DESC LIMIT 500',
        )
        .all();
    case 'revoke':
      engine.db.query('DELETE FROM _qb_auth_sessions WHERE userId=?').run(a.userId);
      return true;
    case 'buckets':
      return engine.db.query('SELECT * FROM _qb_buckets').all();
    case 'bucket-create': {
      const id = crypto.randomUUID();
      if (
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(a.name) ||
        !['private', 'public'].includes(a.visibility) ||
        !Number.isInteger(a.maxSize) ||
        a.maxSize < 1 ||
        a.maxSize > 104857600
      )
        throw new QBError('VALIDATION', 'Invalid bucket configuration');
      engine.db
        .query('INSERT INTO _qb_buckets VALUES(?,?,?,?,?)')
        .run(id, a.name, a.visibility, a.maxSize, JSON.stringify(a.mimeRules ?? []));
      return { id };
    }
    case 'objects':
      return engine.db
        .query(
          "SELECT id,bucket_id,key,owner_id,size,mime,state FROM _qb_objects WHERE bucket_id=? AND (?=1 OR owner_id=?) AND state='ready' ORDER BY id LIMIT 500",
        )
        .all(a.bucket, Number(!!a.privileged), identity.sub ?? '');
    case 'upload-intent': {
      const digest = createHash('sha256')
        .update(JSON.stringify([a.bucket, a.key, a.size, a.mime]))
        .digest('hex');
      if (a.idempotency && (typeof a.idempotency !== 'string' || a.idempotency.length > 128))
        throw new QBError('VALIDATION', 'Idempotency keys must be at most 128 characters');
      const scope = a.idempotency
        ? createHash('sha256')
            .update(JSON.stringify(['storage', identity, a.bucket, a.idempotency]))
            .digest('hex')
        : null;
      if (scope) {
        const prior = engine.db
          .query('SELECT hash,response FROM _qb_idempotency WHERE scope=?')
          .get(scope) as any;
        if (prior) {
          if (prior.hash !== digest)
            throw new QBError('IDEMPOTENCY_CONFLICT', 'Key reused with different content', 409);
          return JSON.parse(prior.response);
        }
      }
      const bucket = engine.db.query('SELECT * FROM _qb_buckets WHERE id=?').get(a.bucket) as any;
      if (!bucket) throw new QBError('NOT_FOUND', 'Bucket not available', 404);
      if (!identity.sub) throw new QBError('UNAUTHORIZED', 'Sign in to upload', 401);
      if (!Number.isInteger(a.size) || a.size < 0 || a.size > Number(bucket.max_size))
        throw new QBError('SIZE_LIMIT', 'Upload exceeds bucket limit', 413);
      const used = Number(
        (
          engine.db
            .query(
              "SELECT COALESCE(SUM(size),0) AS used FROM _qb_objects WHERE state NOT IN('deleted','unavailable')",
            )
            .get() as any
        ).used,
      );
      if (used + a.size > (a.maxStorageBytes ?? 1073741824))
        throw new QBError('QUOTA', 'Branch storage quota exceeded', 429);
      if (
        typeof a.mime !== 'string' ||
        !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:;.*)?$/.test(a.mime)
      )
        throw new QBError('VALIDATION', 'Invalid MIME type');
      a.mime = a.mime.split(';')[0].toLowerCase();
      const rules = JSON.parse(bucket.mime_rules);
      if (rules.length && !rules.includes(a.mime))
        throw new QBError('MIME_DENIED', 'File type not accepted');
      if (
        typeof a.key !== 'string' ||
        a.key.length > 512 ||
        a.key.includes('..') ||
        a.key.startsWith('/') ||
        a.key.includes('\\')
      )
        throw new QBError('VALIDATION', 'Invalid object key');
      const id = crypto.randomUUID();
      const result = { id, size: a.size, mime: a.mime };
      return engine.db
        .transaction(() => {
          engine.db
            .query(
              'INSERT INTO _qb_objects(id,bucket_id,key,owner_id,size,mime,state,created_at) VALUES(?,?,?,?,?,?,?,?)',
            )
            .run(
              id,
              a.bucket,
              a.key,
              identity.sub,
              a.size,
              a.mime,
              'pending',
              new Date().toISOString(),
            );
          if (scope)
            engine.db
              .query('INSERT INTO _qb_idempotency VALUES(?,?,?,?)')
              .run(scope, digest, JSON.stringify(result), new Date().toISOString());
          return result;
        })
        .immediate();
    }
    case 'object': {
      const object = engine.db
        .query(
          'SELECT o.*,b.visibility FROM _qb_objects o JOIN _qb_buckets b ON b.id=o.bucket_id WHERE o.id=?',
        )
        .get(a.id) as any;
      if (
        !object ||
        (!a.privileged &&
          object.owner_id !== identity.sub &&
          !(a.read && object.visibility === 'public'))
      )
        throw new QBError('NOT_FOUND', 'Object not available', 404);
      return object;
    }
    case 'upload-claim': {
      const result = engine.db
        .query(
          "UPDATE _qb_objects SET state='uploading' WHERE id=? AND state IN('pending','failed')",
        )
        .run(a.id);
      if (result.changes !== 1)
        throw new QBError('TRANSFER_BUSY', 'Object upload is already running', 503, true);
      return true;
    }
    case 'object-state':
      engine.db
        .query(
          'UPDATE _qb_objects SET state=?,etag=?,content_sha=COALESCE(?,content_sha) WHERE id=?',
        )
        .run(a.state, a.etag ?? null, a.contentSha ?? null, a.id);
      return true;
    case 'object-maintenance':
      return engine.db
        .query(
          "SELECT id FROM _qb_objects WHERE state='deleting' OR (state IN('pending','uploading','failed') AND created_at<?) LIMIT 100",
        )
        .all(new Date(Date.now() - 86400000).toISOString());
    case 'cleanup':
      {
        const cutoff = new Date(Date.now() - 86400000).toISOString();
        const last = Number(
          (
            engine.db
              .query('SELECT MAX(seq) AS seq FROM _qb_outbox WHERE created_at<?')
              .get(cutoff) as any
          ).seq ?? 0,
        );
        if (last) {
          engine.db
            .query(
              "INSERT INTO _qb_meta VALUES('outbox_floor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(String(last));
          engine.db.query('DELETE FROM _qb_outbox WHERE seq<=?').run(last);
        }
        engine.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
      }
      engine.db
        .query('DELETE FROM _qb_idempotency WHERE created_at<?')
        .run(new Date(Date.now() - 86400000).toISOString());
      engine.db.query('DELETE FROM _qb_auth_verifications WHERE expiresAt<?').run(Date.now());
      engine.db.query('DELETE FROM _qb_auth_sessions WHERE expiresAt<?').run(Date.now());
      return true;
    default:
      throw new QBError('NOT_FOUND', 'Owner action unavailable', 404);
  }
}
self.onmessage = (e) => {
  const message = e.data;
  serial = serial.then(async () => {
    if (message.init) {
      try {
        const db = openDatabase(message.init.path);
        initializeBranch(db);
        engine = new BranchEngine(db, message.init.secret);
        auth = await createRealm(openDatabase(message.init.path, false), message.init.auth);
        self.postMessage({ ready: true });
      } catch (error) {
        self.postMessage({ startupError: error instanceof Error ? error.stack : String(error) });
      }
      return;
    }
    try {
      self.postMessage({ id: message.id, result: await run(message.action, message.args) });
    } catch (error) {
      if (!(error instanceof QBError) && error instanceof Error) {
        if (/UNIQUE constraint failed/i.test(error.message))
          error = new QBError('CONFLICT', 'A unique value already exists', 409);
        else if (/constraint failed/i.test(error.message))
          error = new QBError('VALIDATION', 'Row violates the schema constraints');
        else if (/database is locked|SQLITE_BUSY/.test(error.message))
          error = new QBError('OWNER_BUSY', 'Database writer is busy', 503, true);
      }
      self.postMessage({
        id: message.id,
        error: {
          code: error instanceof QBError ? error.code : 'DATABASE_ERROR',
          message: error instanceof QBError ? error.message : 'Database operation failed',
          status: error instanceof QBError ? error.status : 500,
          retryable: error instanceof QBError ? error.retryable : false,
        },
      });
    }
  });
};
