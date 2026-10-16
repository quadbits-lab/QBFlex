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
| Studio auth guards, loopback cookie host alignment, safe return URLs, stale sessions and connection errors | `tests/studio-auth.test.ts`; `bun run test:studio-auth` exercises both hostnames against an isolated API |
| Terminal rendering/redaction, JSON/color controls, quiet polls and actual auth response statuses | `tests/terminal-logging.test.ts`, `tests/dev-startup.test.ts` |
| Workspace avatar/archive/delete, project-scoped storage and branch cleanup, and no-workspace onboarding | `tests/workspace-lifecycle.test.ts`, `scripts/workspace-ui-check.ts` |
| Native startup, foreign-ready API/port conflicts, private worker credentials and shutdown/restart | `tests/dev-startup.test.ts` |
| Webhook checkpoints, exact-byte signatures/rotation, current policy projection, key revocation, backpressure and killed-process recovery | `tests/webhook-jobs.test.ts`, `tests/webhook-crash.test.ts`, `tests/integration/webhooks.test.ts` |
| Webhook IPv4/IPv6/DNS rebinding rejection, pinned trusted local HTTPS, hostname checks, redirect and credential isolation | `tests/webhook-network.test.ts` (TLS fixture requires OpenSSL; a skipped fixture is not network certification) |
| Metadata-only Advisor findings, operation/role-aware grant heuristics, evidence-bound expiring acknowledgments and project-scoped key-age/MFA evidence | `tests/security-advisor.test.ts`, `tests/integration/security-advisor.test.ts` |
| Studio post-submission refresh, stale-read cancellation, inactive/disabled queries, refresh failures and request-local cache isolation | `tests/studio-query-client.test.ts`; `scripts/browser-check.ts` adds real row/file submission and modal-dismissal regressions |

## Repository gates

Run `bun run sdk:pack`, `bun run docs:generate`, `bun run check`, `bun run skill:refresh`, `bun run skill:check`, `bun run skill:test`, `bun run skill:pack`. Full storage/email evidence requires configured isolated S3-compatible backend/Mailpit and `QB_INTEGRATION_STORAGE=1`; absent configuration must be reported as skipped. Existing `test:browser`, `test:cli`, `test:compose` and `verify:linux` verify application/CLI/clean-container/Linux surfaces when those boundaries change. Preserve user data; tests own temporary directories/services, and cleanup must target only fixtures.

The skill test additionally extracts the archive outside the checkout, verifies checksums/links/metadata, installs the actual local SDK tarballs, regenerates database/RPC types, compiles React and typed Vanilla consumers, builds both portable apps and exercises auth/CRUD/realtime/private transfers. Check negative type cases (hidden column/table, wrong variables/RPC arguments) against actual declarations. Runtime negatives belong in shared platform tests, not insecure tutorial code. Require teardown, reconnect/resync and session-boundary coverage.

Report test results and skipped dependencies precisely. Local Chromium/backend measurements do not certify all browsers, cloud S3/OAuth providers or a production workload. Future versions need fresh provenance plus passing regression evidence.

`QB_BROWSER_ENGINE=firefox` or `webkit` selects additional desktop engines in `test:browser`; install the corresponding Playwright runtime first. Launch failures remain unverified gates, not skipped successes. Physical native passkey/background/biometric and Expo push certification remains opt-in and pending until the native implementation exists.
