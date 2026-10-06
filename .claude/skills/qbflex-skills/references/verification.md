# Validation and supporting evidence

[Generated test evidence](generated/tests.md) records source paths, executable test names and SHA-256 provenance. Paths refer to the QB Flex source checkout, not a requirement for portable guidance. Run those tests from the checkout; detached applications can use their installed SDKs plus the bundled runnable workflows. A listed test is evidence of a scenario's coverage, not a claim it passed on a new machine.

| Boundary | Supporting source test |
| --- | --- |
| Cross-user/project/branch, wrong realms, hidden columns, origins, service scopes, revocation | `tests/integration/network.test.ts` |
| Ownership reassignment, protected counts/returns, atomic policies, idempotency | `tests/integration/core.test.ts` |
| Approved relationship existence, upsert and reviewed RPC enforcement | `tests/integration/relations.test.ts` |
| Integer/BLOB/JSON/enum serialization, oversized reads/events, policy algebra | `tests/integration/serialization.test.ts` |
| Schema/cursor changes, quotas, corrupt restore, cancellation, chunked JSON budget | `tests/integration/operations.test.ts` |
| Provider boundaries, shared auth, cache isolation, cancellation, SSR and Strict Mode disposal | `tests/sdk-react.test.tsx`, `tests/fixtures-ssr.tsx` |
| MFA/admin scopes | `tests/integration/mfa.test.ts` |
| Password reset/verification/session revocation, missing delivery configuration | `tests/integration/email.test.ts` |
| Control archives/offline restore/revocation | `tests/integration/control-backup.test.ts` |
| Crash commits, owner leases/queues, stale DDL, redacted logs | `tests/durability.test.ts`, `tests/operational.test.ts` |
| Native startup, foreign-ready API/port conflicts, private worker credentials and shutdown/restart | `tests/dev-startup.test.ts` |

## Repository gates

Run `bun run sdk:pack`, `bun run docs:generate`, `bun run check`, `bun run skill:refresh`, `bun run skill:check`, `bun run skill:test`, `bun run skill:pack`. Full storage/email evidence requires configured isolated local MinIO/Mailpit and `QB_INTEGRATION_STORAGE=1`; absent configuration must be reported as skipped. Existing `test:browser`, `test:cli`, `test:compose` and `verify:linux` verify application/CLI/clean-container/Linux surfaces when those boundaries change. Preserve user data; tests own temporary directories/services, and cleanup must target only fixtures.

The skill test additionally extracts the archive outside the checkout, verifies checksums/links/metadata, installs the actual local SDK tarballs, regenerates database/RPC types, compiles React and typed Vanilla consumers, builds both portable apps and exercises auth/CRUD/realtime/private transfers. Check negative type cases (hidden column/table, wrong variables/RPC arguments) against actual declarations. Runtime negatives belong in shared platform tests, not insecure tutorial code. Require teardown, reconnect/resync and session-boundary coverage.

Report test results and skipped dependencies precisely. Local Chromium/MinIO measurements do not certify all browsers, cloud S3/OAuth providers or a production workload. Future versions need fresh provenance plus passing regression evidence.
