# Architecture and availability

This bundle describes QB Flex 0.1.0. Read [generated availability and routes](generated/api.md) before assuming a capability exists. The development specification includes desired future behavior; source, declarations and tests establish current support.

## Responsibilities and boundaries

| Workspace | Responsibility |
| --- | --- |
| `apps/api` | Elysia gateway, Management API, branch REST/auth/realtime/storage |
| `apps/worker` | Private maintenance requests, cleanup, scheduled encrypted snapshots and experimental scoped webhook delivery |
| `apps/studio` | TanStack Start administration, database/policy/SQL editors, operations |
| `apps/docs` | Independent TanStack Start/MDX site, generated references, search/prerender |
| `apps/cli` | `qb` management commands and offline recovery |
| `packages/contracts` | Shared types, errors, route/capability registry, OpenAPI |
| `packages/database`, `schema`, `query-engine`, `policies` | Isolated PGlite owners, migrations, validation, authorization and serialization |
| `packages/auth`, `realtime`, `storage`, `observability` | Identity realms, authorized row stream, S3 metadata/bytes, redacted operational evidence |
| `packages/sdk-js`, `sdk-react`, `management-client`, `ui` | Browser client, provider/hooks, trusted management client, shared branding/components |

Management routes use `/management/v1`; application routes use `/v1/projects/{project}/branches/{branch}`. Authentication remains in distinct platform and project/branch realms. Public resource responses use `{data, meta}`; failures use `{error:{code,message,requestId,retryable}}`. Better Auth endpoints retain their native response shapes; downloads return bytes and OpenAPI returns a schema document. Async operations return 202 and an operation ID: poll to a terminal state.

## PGlite contract

One writable API node holds a filesystem lease over its data directory. Each branch has one database-owner worker, at most 64 queued/pending calls; the pool defaults to four active owners (`QB_MAX_BRANCH_OWNERS`, range 1–32). A deadline terminates the stuck owner and rejects uncertain work. Persistent filesystem storage uses relaxed durability disabled; PostgreSQL enforces foreign keys. Use local persistent disk, never a shared network database filesystem or a second writer node. Native SQL supports PGlite tables/indexes/views/triggers and built-in extensions where available; generated APIs expose a deliberately restricted subset. SQL console and direct filesystem access are trusted administrator access, not row-policy enforcement.

Tables start private. Views, virtual tables, custom triggers and unsupported/generated structures do not acquire public access automatically. Inspect exposure eligibility and use reviewed migrations. Ordinary exposed tables require supported keys and column types. Dynamic DDL is introspected; stale schema/cursors fail rather than silently using old policy plans. Transactional outbox events and mutations commit together. See [application development](application.md).

## P0, P1 and P2

P0 implements organizations/RBAC, MFA, projects/primary branches, schema/migrations, ownership and approved relationship-existence policies, REST, reviewed structured RPC/upsert, password auth, verification/reset workflows, credential-configured Google/GitHub adapters, authorized row events, basic S3 transfers, React/Vanilla SDKs, CLI, audit/logs, quotas and encrypted branch/control snapshots with isolated restore. OAuth adapters require real provider credentials and callback configuration; adapter presence is not external provider certification.

P1 remains planned: generated GraphQL, general snapshot branching, magic links/OTP/phone/CAPTCHA, more social connectors, broadcast/presence, resumable uploads/transforms, vector/AI APIs, isolated Bun functions and hosted MCP. GraphQL/Yoga remains a bounded compatibility spike. The former sqlite-vec spike is retired; vector product APIs remain planned. P2 remains planned: SSO/identity provider, replicas/multi-region, CDN/analytics/RAG, Deno, Terraform and advanced interoperability. React Native and other framework adapters are deferred. Supabase CLI/Postgres wire compatibility is not implemented.

## Limits and measured compatibility

REST reads default 50/max 500 rows; atomic batches max 100, filters max 30, IN max 100, policy depth max 12. Result budget including expanded relations is 2 MiB; JSON bodies max 64 KiB. Relationship expansion is one level, max three relationships/100 parents/50 children; existence traversal rejects cycles and depth above four. Realtime max 100 connections/project, 256/process, 64 KiB frame, 200 events/poll and 24-hour replay retention. Private storage lists max 500; upload and snapshot concurrency are bounded. Per-branch database/storage quotas and per-key request limits are enforced; inspect actual configuration before sizing workloads.

Chromium and platform workflows have repository evidence. Historical Linux results predate PGlite and require a fresh engine-specific run. Historical native-extension results do not certify the new PGlite runtime. Do not claim Safari/Firefox, external S3/provider or production throughput certification from local tests. See [verification](verification.md) and the repository verification report for conditions and measurements.

Specification1.1 adds experimental database webhooks and Security Advisor to the current source. Webhooks use private owner checkpoints/jobs and revalidated SELECT projections, signed fixed-IP HTTPS deliveries and receiver deduplication. Static Advisor findings/expiring acknowledgments never replace the real policy engine or fix production grants. Expanded native/push/WASM and recovery/operations/workflow capabilities remain incomplete.
