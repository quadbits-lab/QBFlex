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
import { createRealm, encryption, realmSecret } from '@qb-flex/auth';
import { DurableJobs } from './jobs';
import { Webhooks } from './webhooks';
import { SecurityAdvisor } from './security-advisor';
import { simulatePolicy } from './policy-simulator';
import { SchemaReviews } from './schema-reviews';
import { SearchCollections } from './search';
import { QueryInspector } from './query-inspector';
import { evaluateRowAccess } from './row-access';
import { RealtimeDebugger } from './realtime-debug';
import { runAssistant, assistantConfigured } from './assistant';
import { provisionPreviewBranch } from './previews';
import { APP_ROLE_NAME, isReservedRoleName, QBError, type Identity } from '@qb-flex/contracts';
import { createHash } from 'node:crypto';
let engine: BranchEngine;
let jobs: DurableJobs;
let webhooks: Webhooks;
let advisor: SecurityAdvisor;
let reviews: SchemaReviews;
let searchCollections: SearchCollections;
let inspector: QueryInspector;
let realtimeDebug: RealtimeDebugger;
let auth: Awaited<ReturnType<typeof createRealm>>;
let serial = Promise.resolve();
async function loadUserRoles(userId: string) {
  return (
    (await engine.db
      .query(
        'SELECT r.name FROM _qb_user_roles ur JOIN _qb_roles r ON r.id=ur.role_id WHERE ur.user_id=? ORDER BY r.name',
      )
      .all(userId)) as { name: string }[]
  ).map((r) => r.name);
}
async function requireUser(userId: string) {
  const user = (await engine.db
    .query(
      'SELECT id,email,name,"emailVerified","createdAt",banned,"banReason" FROM _qb_auth_users WHERE id=?',
    )
    .get(userId)) as any;
  if (!user) throw new QBError('NOT_FOUND', 'Application user not found', 404);
  return user;
}
async function resolveRoleIds(names: string[]) {
  if (!Array.isArray(names)) throw new QBError('VALIDATION', 'roles must be an array');
  const unique = [...new Set(names.map((n) => String(n)))];
  if (!unique.length) return [] as string[];
  for (const name of unique) {
    if (!APP_ROLE_NAME.test(name) || isReservedRoleName(name))
      throw new QBError('VALIDATION', 'Invalid role name: ' + name);
  }
  const rows: { id: string; name: string }[] = [];
  for (const name of unique) {
    const row = (await engine.db.query('SELECT id,name FROM _qb_roles WHERE name=?').get(name)) as {
      id: string;
      name: string;
    } | null;
    if (!row) throw new QBError('VALIDATION', 'Unknown role: ' + name);
    rows.push(row);
  }
  return rows.map((r) => r.id);
}
async function setUserRoles(userId: string, roleNames: string[]) {
  const roleIds = await resolveRoleIds(roleNames);
  await engine.db.query('DELETE FROM _qb_user_roles WHERE user_id=?').run(userId);
  for (const roleId of roleIds)
    await engine.db.query('INSERT INTO _qb_user_roles VALUES(?,?)').run(userId, roleId);
  return loadUserRoles(userId);
}
async function userPayload(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: !!user.emailVerified,
    createdAt: user.createdAt,
    banned: !!user.banned,
    banReason: user.banReason ?? null,
    roles: await loadUserRoles(user.id),
  };
}
async function run(action: string, a: any) {
  if (action === 'close') {
    await engine.db.close(true);
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
    if (!session) return null;
    const banned = !!(session.user as { banned?: boolean }).banned;
    if (banned) return null;
    return {
      sub: session.user.id,
      role: 'authenticated' as const,
      roles: await loadUserRoles(session.user.id),
    };
  }
  await engine.refresh();
  const identity: Identity = a.identity ?? { sub: null, role: 'anonymous', roles: [] };
  if (!identity.roles) identity.roles = [];
  switch (action) {
    case 'policy-simulate':
      return await simulatePolicy(engine, a);
    case 'security-scan':
      return await advisor.scan(a.additional);
    case 'security-acknowledge':
      return await advisor.acknowledge(a.id, a.expiresAt, a.actor, a.additional);
    case 'security-clear':
      return await advisor.clear(a.id);
    case 'jobs-submit':
      return await jobs.submit(a);
    case 'jobs-list':
      return await jobs.list(a);
    case 'jobs-get':
      return { ...(await jobs.get(a.id)), history: await jobs.attempts(a.id) };
    case 'jobs-claim':
      return await jobs.claim(a.kinds, a.leaseMs);
    case 'jobs-finish':
      return await jobs.finish(a.id, a.leaseToken, a.result, a.kinds);
    case 'jobs-cancel':
      return await jobs.cancel(a.id);
    case 'jobs-replay':
      return await jobs.replay(a.id, a.idempotencyKey);
    case 'dead-letter-depth':
      return await engine.db.query(
        "SELECT kind,COUNT(*) AS count FROM _qb_jobs WHERE state='dead' GROUP BY kind",
      ).all();
    case 'webhooks-list':
      return await webhooks.list();
    case 'webhooks-create':
      return await webhooks.create(a);
    case 'webhooks-state':
      return await webhooks.state(a.id, a.state);
    case 'webhooks-rotate':
      return await webhooks.rotate(a.id);
    case 'webhooks-produce':
      return await webhooks.produce();
    case 'webhooks-reference':
      return await webhooks.reference(a.id, a.leaseToken);
    case 'webhooks-prepare':
      return await webhooks.prepare(a.id, a.leaseToken, a.serviceKeyId);
    case 'schema':
      if (!a.privileged) await engine.assertSchema();
      return {
        tables: await Promise.all(
          await Promise.all(
            (await schema(engine.db))
              .filter((t) => a.privileged || t.exposed)
              .map(async (t) =>
                a.privileged
                  ? t
                  : {
                      ...t,
                      columns: t.columns.filter((c) => t.allowedColumns.includes(c.name)),
                      indexes: [],
                      foreignKeys: [],
                      relationships: t.relationships?.filter(
                        (r) => engine.table(r.target, false)?.exposed,
                      ),
                    },
              ),
          ),
        ),
        schemaVersion: await schemaVersion(engine.db),
      };
    case 'policies':
      return await policies(engine.db);
    case 'policy':
      return await engine.savePolicy(a.policy);
    case 'relationship':
      return await registerRelationship(engine.db, a.relationship);
    case 'rpc-register':
      return await registerRPC(engine.db, a.operation);
    case 'rpc-list':
      return (await engine.db.query('SELECT definition FROM _qb_rpc').all()).map((r: any) =>
        JSON.parse(r.definition),
      );
    case 'rpc':
      return await engine.rpc(a.name, a.args, identity, a.idempotency);
    case 'expose':
      return await expose(engine.db, a.table, a.enabled, a.columns);
    case 'read':
      return await engine.read(a.table, a.query, identity, a.privileged);
    case 'mutate':
      return await engine.mutate(
        a.table,
        a.method,
        a.input,
        identity,
        a.key,
        a.idempotency,
        a.privileged,
        a.revision,
      );
    case 'migration': {
      if (a.reviewId) {
        const result = await reviews.applyApproved(a.reviewId, a.author);
        await searchCollections.invalidateForSchemaChange();
        return result;
      }
      if (typeof a.id === 'string' && typeof a.sql === 'string') {
        const previous = (await engine.db
          .query('SELECT checksum FROM _qb_migrations WHERE id=?')
          .get(a.id)) as { checksum: string } | null;
        if (previous) return await engine.migration(a.id, a.sql, a.author);
        const reviewId = await reviews.requireApproved(a.id, a.sql);
        const result = await reviews.applyApproved(reviewId, a.author);
        await searchCollections.invalidateForSchemaChange();
        return result;
      }
      throw new QBError('VALIDATION', 'Migration requires reviewId or an approved id/sql pair');
    }
    case 'migrations':
      return await engine.db
        .query('SELECT id,checksum,author,applied_at FROM _qb_migrations ORDER BY applied_at')
        .all();
    case 'reviews-list':
      return await reviews.list();
    case 'reviews-get':
      return await reviews.get(a.id);
    case 'reviews-create':
      return await reviews.create(
        { migrationId: a.migrationId, sql: a.sql },
        a.author,
      );
    case 'reviews-rehearse':
      return await reviews.rehearse(a.id);
    case 'reviews-approve':
      return await reviews.approve(a.id);
    case 'reviews-reject':
      return await reviews.reject(a.id);
    case 'policies-access':
      return await evaluateRowAccess(engine, a);
    case 'search-collections-list':
      return await searchCollections.list();
    case 'search-collections-create':
      return await searchCollections.create(a);
    case 'search-collections-rebuild':
      return await searchCollections.rebuild(a.id);
    case 'search-collections-delete':
      await searchCollections.delete(a.id);
      return { deleted: true };
    case 'search':
      return await searchCollections.search(engine, identity, {
        collection: a.collection,
        q: a.q,
        limit: a.limit,
        cursor: a.cursor,
      });
    case 'inspector-samples':
      return await inspector.listSamples();
    case 'inspector-plan':
      return await inspector.plan(a.fingerprint);
    case 'inspector-record':
      return await inspector.recordSample(a);
    case 'realtime-debug-list':
      return realtimeDebug.list();
    case 'realtime-debug-open':
      return realtimeDebug.open(a);
    case 'realtime-debug-record':
      return realtimeDebug.record(a.id, a.state, a);
    case 'webhooks-sample':
      return await webhooks.sample(a.id);
    case 'assistant': {
      const tables = await schema(engine.db);
      const policyList = await policies(engine.db);
      return await runAssistant({
        schema: tables,
        policies: policyList,
        request: a,
        createReview: async (sql, migrationId) => {
          const review = await reviews.create({ migrationId, sql }, a.author ?? 'assistant');
          return review.id;
        },
      });
    }
    case 'assistant-configured':
      return { configured: assistantConfigured() };
    case 'preview-provision':
      await provisionPreviewBranch(engine, a.path, a.fixtures ?? {});
      return { path: a.path };
    case 'sql':
      engine.safeSQL(a.sql);
      if (/^\s*(select|with)\b/i.test(a.sql))
        return await engine.db
          .query(`SELECT * FROM (${a.sql.trim().replace(/;$/, '')}) LIMIT 500`)
          .all();
      else {
        // Privileged SQL console still applies through a review when mutating.
        const id = crypto.randomUUID();
        const review = await reviews.create({ migrationId: id, sql: a.sql }, a.author);
        await reviews.rehearse(review.id);
        await reviews.approve(review.id);
        return await reviews.applyApproved(review.id, a.author);
      }
    case 'types':
      return await engine.types();
    case 'snapshot':
      return await engine.snapshot(a.path);
    case 'events':
      return await engine.events(a.after, identity, a.table);
    case 'latest':
      return await engine.latest();
    case 'users': {
      const rows = (await engine.db
        .query(
          'SELECT id,email,name,"emailVerified","createdAt",banned,"banReason" FROM _qb_auth_users ORDER BY "createdAt" DESC LIMIT 500',
        )
        .all()) as any[];
      return await Promise.all(rows.map((u) => userPayload(u)));
    }
    case 'user-create': {
      const email = String(a.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(a.password ?? '');
      const name = String(a.name ?? '').trim() || email.split('@')[0] || 'User';
      if (!email || !password) throw new QBError('VALIDATION', 'Email and password are required');
      if (password.length < 12)
        throw new QBError('VALIDATION', 'Password must be at least 12 characters');
      let created: { user?: { id: string } };
      try {
        created = (await auth.api.signUpEmail({
          body: { email, password, name },
          headers: new Headers(),
        })) as { user?: { id: string } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create user';
        if (/already|exists|unique/i.test(message))
          throw new QBError('CONFLICT', 'An application user with this email already exists', 409);
        throw new QBError('VALIDATION', message);
      }
      const userId =
        created?.user?.id ??
        ((await engine.db.query('SELECT id FROM _qb_auth_users WHERE email=?').get(email)) as any)
          ?.id;
      if (!userId) throw new QBError('DATABASE_ERROR', 'Failed to create application user');
      await engine.db.query('DELETE FROM _qb_auth_sessions WHERE "userId"=?').run(userId);
      if (a.emailVerified === true)
        await engine.db
          .query('UPDATE _qb_auth_users SET "emailVerified"=TRUE WHERE id=?')
          .run(userId);
      if (Array.isArray(a.roles) && a.roles.length) await setUserRoles(userId, a.roles);
      return userPayload(await requireUser(userId));
    }
    case 'user-update': {
      const user = await requireUser(a.userId);
      const updates: string[] = [];
      const values: unknown[] = [];
      if (a.name !== undefined) {
        const name = String(a.name ?? '').trim();
        if (!name) throw new QBError('VALIDATION', 'Name is required');
        updates.push('name=?');
        values.push(name);
      }
      if (a.email !== undefined) {
        const email = String(a.email ?? '')
          .trim()
          .toLowerCase();
        if (!email.includes('@')) throw new QBError('VALIDATION', 'Invalid email');
        updates.push('email=?');
        values.push(email);
      }
      if (a.emailVerified !== undefined) {
        updates.push('"emailVerified"=?');
        values.push(!!a.emailVerified);
      }
      if (!updates.length) throw new QBError('VALIDATION', 'No user fields to update');
      values.push(user.id);
      await engine.db
        .query(`UPDATE _qb_auth_users SET ${updates.join(',')} WHERE id=?`)
        .run(...values);
      return userPayload(await requireUser(user.id));
    }
    case 'user-delete': {
      await requireUser(a.userId);
      await engine.db.query('DELETE FROM _qb_user_roles WHERE user_id=?').run(a.userId);
      await engine.db.query('DELETE FROM _qb_auth_sessions WHERE "userId"=?').run(a.userId);
      await engine.db.query('DELETE FROM _qb_auth_accounts WHERE "userId"=?').run(a.userId);
      try {
        await engine.db.query('DELETE FROM _qb_auth_passkeys WHERE "userId"=?').run(a.userId);
      } catch {
        /* optional table */
      }
      try {
        await engine.db.query('DELETE FROM _qb_auth_two_factor WHERE "userId"=?').run(a.userId);
      } catch {
        /* optional table */
      }
      await engine.db.query('DELETE FROM _qb_auth_users WHERE id=?').run(a.userId);
      return { deleted: true };
    }
    case 'user-ban': {
      await requireUser(a.userId);
      const reason = a.reason != null ? String(a.reason).slice(0, 500) : null;
      await engine.db
        .query('UPDATE _qb_auth_users SET banned=TRUE,"banReason"=? WHERE id=?')
        .run(reason, a.userId);
      await engine.db.query('DELETE FROM _qb_auth_sessions WHERE "userId"=?').run(a.userId);
      return userPayload(await requireUser(a.userId));
    }
    case 'user-unban': {
      await requireUser(a.userId);
      await engine.db
        .query('UPDATE _qb_auth_users SET banned=FALSE,"banReason"=NULL WHERE id=?')
        .run(a.userId);
      return userPayload(await requireUser(a.userId));
    }
    case 'user-roles': {
      await requireUser(a.userId);
      const roles = await setUserRoles(a.userId, a.roles ?? []);
      return { id: a.userId, roles };
    }
    case 'roles': {
      const rows = (await engine.db
        .query(
          `SELECT r.id,r.name,r.description,r.created_at,
            (SELECT COUNT(*)::int FROM _qb_user_roles ur WHERE ur.role_id=r.id) AS members
           FROM _qb_roles r ORDER BY r.name`,
        )
        .all()) as any[];
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        createdAt: r.created_at,
        members: Number(r.members ?? 0),
      }));
    }
    case 'role-create': {
      const name = String(a.name ?? '')
        .trim()
        .toLowerCase();
      const description = String(a.description ?? '').slice(0, 500);
      if (!APP_ROLE_NAME.test(name) || isReservedRoleName(name))
        throw new QBError('VALIDATION', 'Invalid role name');
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      try {
        await engine.db
          .query('INSERT INTO _qb_roles VALUES(?,?,?,?)')
          .run(id, name, description, createdAt);
      } catch {
        throw new QBError('CONFLICT', 'Role already exists', 409);
      }
      return { id, name, description, createdAt, members: 0 };
    }
    case 'role-update': {
      const role = (await engine.db
        .query('SELECT id,name,description,created_at FROM _qb_roles WHERE id=?')
        .get(a.roleId)) as any;
      if (!role) throw new QBError('NOT_FOUND', 'Role not found', 404);
      let name = role.name;
      let description = role.description ?? '';
      if (a.name !== undefined) {
        name = String(a.name).trim().toLowerCase();
        if (!APP_ROLE_NAME.test(name) || isReservedRoleName(name))
          throw new QBError('VALIDATION', 'Invalid role name');
      }
      if (a.description !== undefined) description = String(a.description).slice(0, 500);
      try {
        await engine.db
          .query('UPDATE _qb_roles SET name=?,description=? WHERE id=?')
          .run(name, description, role.id);
      } catch {
        throw new QBError('CONFLICT', 'Role name already exists', 409);
      }
      const members = Number(
        (
          (await engine.db
            .query('SELECT COUNT(*)::int AS n FROM _qb_user_roles WHERE role_id=?')
            .get(role.id)) as any
        )?.n ?? 0,
      );
      return { id: role.id, name, description, createdAt: role.created_at, members };
    }
    case 'role-delete': {
      const role = (await engine.db
        .query('SELECT id FROM _qb_roles WHERE id=?')
        .get(a.roleId)) as any;
      if (!role) throw new QBError('NOT_FOUND', 'Role not found', 404);
      await engine.db.query('DELETE FROM _qb_roles WHERE id=?').run(a.roleId);
      return { deleted: true };
    }
    case 'revoke':
      await engine.db.query('DELETE FROM _qb_auth_sessions WHERE "userId"=?').run(a.userId);
      return true;
    case 'buckets':
      return await engine.db.query('SELECT * FROM _qb_buckets').all();
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
      await engine.db
        .query('INSERT INTO _qb_buckets VALUES(?,?,?,?,?)')
        .run(id, a.name, a.visibility, a.maxSize, JSON.stringify(a.mimeRules ?? []));
      return { id };
    }
    case 'objects':
      return await engine.db
        .query(
          "SELECT id,bucket_id,key,owner_id,size,mime,state,created_at FROM _qb_objects WHERE bucket_id=? AND (?=1 OR owner_id=?) AND state='ready' ORDER BY id LIMIT 500",
        )
        .all(a.bucket, Number(!!a.privileged), identity.sub ?? '');
    case 'upload-intent': {
      if (
        a.checksum !== undefined &&
        (typeof a.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(a.checksum))
      )
        throw new QBError('VALIDATION', 'Expected checksum must be lowercase SHA-256');
      const digest = createHash('sha256')
        .update(
          JSON.stringify(
            a.checksum === undefined
              ? [a.bucket, a.key, a.size, a.mime]
              : [a.bucket, a.key, a.size, a.mime, a.checksum],
          ),
        )
        .digest('hex');
      if (a.idempotency && (typeof a.idempotency !== 'string' || a.idempotency.length > 128))
        throw new QBError('VALIDATION', 'Idempotency keys must be at most 128 characters');
      const scope = a.idempotency
        ? createHash('sha256')
            .update(JSON.stringify(['storage', identity, a.bucket, a.idempotency]))
            .digest('hex')
        : null;
      if (scope) {
        const prior = (await engine.db
          .query('SELECT hash,response FROM _qb_idempotency WHERE scope=?')
          .get(scope)) as any;
        if (prior) {
          if (prior.hash !== digest)
            throw new QBError('IDEMPOTENCY_CONFLICT', 'Key reused with different content', 409);
          return JSON.parse(prior.response);
        }
      }
      const bucket = (await engine.db
        .query('SELECT * FROM _qb_buckets WHERE id=?')
        .get(a.bucket)) as any;
      if (!bucket) throw new QBError('NOT_FOUND', 'Bucket not available', 404);
      if (!identity.sub) throw new QBError('UNAUTHORIZED', 'Sign in to upload', 401);
      if (!Number.isInteger(a.size) || a.size < 0 || a.size > Number(bucket.max_size))
        throw new QBError('SIZE_LIMIT', 'Upload exceeds bucket limit', 413);
      const used = Number(
        (
          (await engine.db
            .query(
              "SELECT COALESCE(SUM(size),0) AS used FROM _qb_objects WHERE state NOT IN('deleted','unavailable')",
            )
            .get()) as any
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
      return await engine.db
        .transaction(async (tx) => {
          await tx
            .query(
              'INSERT INTO _qb_objects(id,bucket_id,key,owner_id,size,mime,state,created_at,expected_sha) VALUES(?,?,?,?,?,?,?,?,?)',
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
              a.checksum ?? null,
            );
          if (scope)
            await tx
              .query('INSERT INTO _qb_idempotency VALUES(?,?,?,?)')
              .run(scope, digest, JSON.stringify(result), new Date().toISOString());
          return result;
        })
        .immediate();
    }
    case 'object': {
      const object = (await engine.db
        .query(
          'SELECT o.*,b.visibility FROM _qb_objects o JOIN _qb_buckets b ON b.id=o.bucket_id WHERE o.id=?',
        )
        .get(a.id)) as any;
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
      const result = await engine.db
        .query(
          "UPDATE _qb_objects SET state='uploading' WHERE id=? AND state IN('pending','failed')",
        )
        .run(a.id);
      if (result.changes !== 1)
        throw new QBError('TRANSFER_BUSY', 'Object upload is already running', 503, true);
      return true;
    }
    case 'object-state':
      await engine.db
        .query(
          'UPDATE _qb_objects SET state=?,etag=?,content_sha=COALESCE(?,content_sha) WHERE id=?',
        )
        .run(a.state, a.etag ?? null, a.contentSha ?? null, a.id);
      return true;
    case 'purge-storage-keys':
      return await engine.db
        .query(
          "SELECT id,bucket_id,key,state FROM _qb_objects WHERE state != 'deleting' ORDER BY bucket_id,id",
        )
        .all();
    case 'object-maintenance':
      return await engine.db
        .query(
          "SELECT id FROM _qb_objects WHERE state='deleting' OR (state IN('pending','uploading','failed') AND created_at<?) LIMIT 100",
        )
        .all(new Date(Date.now() - 86400000).toISOString());
    case 'cleanup':
      {
        await jobs.cleanup();
        const cutoff = new Date(Date.now() - 86400000).toISOString();
        const last = Number(
          (
            (await engine.db
              .query('SELECT MAX(seq) AS seq FROM _qb_outbox WHERE created_at<?')
              .get(cutoff)) as any
          ).seq ?? 0,
        );
        if (last) {
          await engine.db
            .query(
              "INSERT INTO _qb_meta VALUES('outbox_floor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(String(last));
          await engine.db.query('DELETE FROM _qb_outbox WHERE seq<=?').run(last);
        }
        await engine.db.exec('');
      }
      await engine.db
        .query('DELETE FROM _qb_idempotency WHERE created_at<?')
        .run(new Date(Date.now() - 86400000).toISOString());
      await engine.db
        .query('DELETE FROM _qb_auth_verifications WHERE "expiresAt"<?')
        .run(new Date().toISOString());
      await engine.db
        .query('DELETE FROM _qb_auth_sessions WHERE "expiresAt"<?')
        .run(new Date().toISOString());
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
        await initializeBranch(db);
        engine = await new BranchEngine(db, message.init.secret).initialize();
        jobs = await new DurableJobs(
          db,
          encryption(realmSecret(message.init.secret, 'jobs')),
        ).initialize();
        webhooks = await new Webhooks(
          engine,
          jobs,
          encryption(realmSecret(message.init.secret, 'webhooks')),
          message.init.branchId,
        ).initialize();
        advisor = await new SecurityAdvisor(engine).initialize();
        reviews = await new SchemaReviews(engine).initialize();
        searchCollections = await new SearchCollections(engine).initialize();
        inspector = await new QueryInspector(engine).initialize();
        realtimeDebug = new RealtimeDebugger();
        auth = await createRealm(db, message.init.auth);
        // initdb's temporary WASM heap is large and is not accounted for by JS heap pressure.
        // Release initialization garbage before admitting this owner to the bounded pool.
        Bun.gc(true);
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
        const message = error.message;
        const sqlState = (error as Error & { code?: string }).code;
        if (sqlState === '23505' || /duplicate key value violates unique constraint/i.test(message))
          error = new QBError('CONFLICT', 'A unique value already exists', 409);
        else if (sqlState && /^(22|23|42)/.test(sqlState))
          error = new QBError('VALIDATION', 'Database constraint or input validation failed');
        else if (/could not obtain lock|deadlock detected|lock timeout/.test(message))
          error = new QBError('OWNER_BUSY', 'Database writer is busy', 503, true);
        else if (
          /syntax error|already exists|relation .* does not exist|column .* does not exist|unterminated/i.test(
            message,
          )
        )
          error = new QBError('VALIDATION', message);
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
