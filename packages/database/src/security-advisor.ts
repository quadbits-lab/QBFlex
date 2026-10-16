import type { Database } from './connection';
import { createHash } from 'node:crypto';
import { QBError, type SecurityFinding, type SecurityReport } from '@qb-flex/contracts';
import { schema, policies, schemaVersion } from '@qb-flex/schema';
import type { BranchEngine } from './engine';
export type FindingInput = Omit<SecurityFinding, 'id' | 'acknowledgedUntil'>;
export function finding(input: FindingInput): SecurityFinding {
  return {
    ...input,
    id: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    acknowledgedUntil: null,
  };
}
export async function controlFindings(
  db: Database,
  projectId: string,
  orgId: string,
  clock = Date.now,
): Promise<SecurityFinding[]> {
  const result: SecurityFinding[] = [],
    now = clock();
  const mfa = Number(
    (
      (await db
        .query(
          `SELECT count(*) AS n FROM memberships m JOIN _qb_auth_users u ON u.id=m.user_id
    WHERE m.org_id=? AND m.role IN('owner','admin') AND NOT COALESCE(u."twoFactorEnabled",false)`,
        )
        .get(orgId)) as any
    ).n,
  );
  if (mfa)
    result.push(
      finding({
        code: 'ADMIN_MFA_GAP',
        severity: 'high',
        resource: `organization:${orgId}`,
        evidence: [`${mfa} owner/admin accounts do not have TOTP enabled.`],
        remediation:
          'Enroll administrator TOTP and enable QB_REQUIRE_ADMIN_MFA. Passkeys do not replace the existing TOTP gate.',
      }),
    );
  // Audit timestamps, not token values or hashes. Legacy keys without provenance remain unknown.
  const records = (await db
    .query(
      `SELECT k.id,k.scope,k.expires_at,m.created_at
    FROM project_keys k LEFT JOIN project_key_metadata m ON m.key_id=k.id
    WHERE k.project_id=? AND k.revoked_at IS NULL ORDER BY k.id LIMIT 501`,
    )
    .all(projectId)) as any[];
  let unknown = 0;
  for (const key of records.slice(0, 500)) {
    if (
      key.expires_at &&
      (!Number.isFinite(Date.parse(key.expires_at)) || Date.parse(key.expires_at) <= now)
    )
      continue;
    const created = Date.parse(key.created_at);
    if (!Number.isFinite(created)) {
      unknown++;
      continue;
    }
    if (created <= now - 90 * 86400000)
      result.push(
        finding({
          code: 'AGING_CREDENTIAL',
          severity: key.scope === 'service' ? 'medium' : 'info',
          resource: `key:${key.id}`,
          evidence: [
            `Active ${key.scope} key was created ${key.created_at}; age is at least 90 days.`,
          ],
          remediation:
            'Review usage, rotate trusted credentials and revoke superseded keys. Never paste raw credentials into findings.',
        }),
      );
  }
  if (unknown)
    result.push(
      finding({
        code: 'CREDENTIAL_AGE_UNKNOWN',
        severity: 'info',
        resource: `project:${projectId}`,
        evidence: [`${unknown} active keys have no usable creation audit timestamp.`],
        remediation: 'Review these legacy credentials; age is unknown, not fresh.',
      }),
    );
  if (records.length > 500)
    result.push(
      finding({
        code: 'CREDENTIAL_SCAN_LIMIT',
        severity: 'info',
        resource: `project:${projectId}`,
        evidence: ['Credential scan reached its 500-key limit.'],
        remediation: 'Remove unused keys and review the remaining inventory separately.',
      }),
    );
  return result;
}
/** Static diagnostics, not a second authorization engine or automatic security repair. */
export class SecurityAdvisor {
  constructor(
    private engine: BranchEngine,
    private clock = Date.now,
  ) {}
  async initialize() {
    await this.engine.db.exec(`CREATE TABLE IF NOT EXISTS _qb_security_acknowledgments(
      finding_id TEXT PRIMARY KEY,expires_at BIGINT NOT NULL,actor TEXT NOT NULL);`);
    return this;
  }
  async scan(additional: SecurityFinding[] = []): Promise<SecurityReport> {
    const findings: SecurityFinding[] = [...additional],
      tables = await schema(this.engine.db),
      grants = await policies(this.engine.db);
    let truncated = tables.length > 100;
    for (const table of tables.slice(0, 100).filter((t) => t.exposed)) {
      const enabled = grants.filter((p) => p.resource === table.name && p.enabled);
      for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
        if (
          !enabled.some(
            (p) => p.operation === operation && p.mode === 'permissive' && p.roles.length,
          )
        )
          findings.push(
            finding({
              code: 'MISSING_GRANT',
              severity: 'info',
              resource: `table:${table.name}:${operation}`,
              evidence: [
                `Exposed table has no enabled permissive ${operation.toUpperCase()} grant.`,
              ],
              remediation:
                'Access fails closed. Use the real policy simulator to verify intended roles before adding a narrowly scoped grant.',
            }),
          );
        const operationGrants = enabled.filter(
          (p) => p.operation === operation && p.mode === 'permissive' && p.roles.length,
        );
        if (
          operationGrants.length &&
          operationGrants.every(
            (p) =>
              (operation !== 'insert' && p.using.op === 'false') ||
              ((operation === 'insert' || operation === 'update') && p.check.op === 'false'),
          )
        )
          findings.push(
            finding({
              code: 'UNREACHABLE_GRANT',
              severity: 'info',
              resource: `table:${table.name}:${operation}`,
              evidence: [
                'All permissive grants for this operation contain a literal false access/check condition.',
              ],
              remediation:
                'Verify intended access with the real-engine simulator; default denial is safe but may make the workflow unusable.',
            }),
          );
      }
      const sensitive = table.allowedColumns.filter((c) =>
        /password|secret|token|private_key|credential|recovery_code/i.test(c),
      );
      if (sensitive.length)
        findings.push(
          finding({
            code: 'SENSITIVE_COLUMN_EXPOSURE',
            severity: 'high',
            resource: `table:${table.name}`,
            evidence: [`Suspicious exposed column names: ${sensitive.join(', ')}.`],
            remediation:
              'Review the column allowlist and remove credentials/secrets. Names are a heuristic, not proof of sensitive contents.',
          }),
        );
      for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
        const broad = enabled.some(
          (p) =>
            p.operation === operation &&
            p.mode === 'permissive' &&
            p.roles.includes('anonymous') &&
            (operation === 'insert' || p.using.op === 'true') &&
            (operation === 'select' || operation === 'delete' || p.check.op === 'true'),
        );
        const restrictive = enabled.some(
          (p) =>
            p.operation === operation && p.mode === 'restrictive' && p.roles.includes('anonymous'),
        );
        if (broad)
          findings.push(
            finding({
              code: 'BROAD_ANONYMOUS_GRANT',
              severity: restrictive ? 'medium' : 'high',
              resource: `table:${table.name}:${operation}`,
              evidence: [
                `Unconditional anonymous ${operation.toUpperCase()} permissive policy${restrictive ? ' with additional restrictive policies requiring simulation' : ''}.`,
              ],
              remediation:
                'Confirm intentional public access with the actual simulator, including restrictive policies and old/prospective rows. Do not automatically remove grants.',
            }),
          );
      }
    }
    const buckets = (await this.engine.db
      .query("SELECT id,name FROM _qb_buckets WHERE visibility='public-read' ORDER BY id LIMIT 501")
      .all()) as any[];
    truncated ||= buckets.length > 500;
    for (const bucket of buckets.slice(0, 500))
      findings.push(
        finding({
          code: 'PUBLIC_BUCKET',
          severity: 'medium',
          resource: `bucket:${bucket.id}`,
          evidence: [`Bucket ${bucket.name} intentionally permits public reads.`],
          remediation:
            'Confirm that all object bytes may be public; change visibility only through a reviewed configuration workflow.',
        }),
      );
    const now = this.clock();
    const acknowledgments = new Map(
      (
        (await this.engine.db
          .query(
            'SELECT finding_id,expires_at FROM _qb_security_acknowledgments WHERE expires_at>? LIMIT 500',
          )
          .all(now)) as any[]
      ).map((row) => [row.finding_id, Number(row.expires_at)]),
    );
    truncated ||=
      findings.length > 500 || additional.some((f) => f.code === 'CREDENTIAL_SCAN_LIMIT');
    return {
      scannedAt: now,
      schemaVersion: await schemaVersion(this.engine.db),
      truncated,
      findings: findings
        .sort((left, right) => {
          const rank = { high: 0, medium: 1, info: 2 };
          return (
            rank[left.severity] - rank[right.severity] ||
            left.resource.localeCompare(right.resource) ||
            left.id.localeCompare(right.id)
          );
        })
        .slice(0, 500)
        .map((f) => ({ ...f, acknowledgedUntil: acknowledgments.get(f.id) ?? null })),
      limitations: [
        'Static, bounded heuristics are not a security audit or proof of authorization.',
        'Policy behavior must be tested using the real-engine simulator; no production rows are sampled.',
        'Credential age uses creation audits; private telemetry and credential values are excluded.',
      ],
    };
  }
  async acknowledge(
    id: string,
    expiresAt: number,
    actor: string,
    additional: SecurityFinding[] = [],
  ) {
    const now = this.clock();
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 30 * 86400000 ||
      typeof actor !== 'string' ||
      actor.length > 100
    )
      throw new QBError('VALIDATION', 'Acknowledgment must expire within 30 days');
    const report = await this.scan(additional),
      current = report.findings.find((f) => f.id === id);
    if (!current)
      throw new QBError('FINDING_STALE', 'Finding changed or was resolved; refresh the scan', 409);
    await this.engine.db
      .transaction(async (tx) => {
        await tx.query('DELETE FROM _qb_security_acknowledgments WHERE expires_at<=?').run(now);
        if (
          !(await tx
            .query('SELECT 1 FROM _qb_security_acknowledgments WHERE finding_id=?')
            .get(id)) &&
          Number(
            (
              (await tx
                .query('SELECT count(*) AS n FROM _qb_security_acknowledgments')
                .get()) as any
            ).n,
          ) >= 500
        )
          throw new QBError('QUOTA', 'Acknowledgment capacity reached', 429);
        await tx
          .query(
            'INSERT INTO _qb_security_acknowledgments VALUES(?,?,?) ON CONFLICT(finding_id) DO UPDATE SET expires_at=excluded.expires_at,actor=excluded.actor',
          )
          .run(id, expiresAt, actor);
      })
      .immediate();
    return { ...current, acknowledgedUntil: expiresAt };
  }
  async clear(id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
      throw new QBError('VALIDATION', 'Invalid finding ID');
    await this.engine.db
      .query('DELETE FROM _qb_security_acknowledgments WHERE finding_id=?')
      .run(id);
    return { cleared: true };
  }
}
