# Executable test source evidence

Generated descriptions and hashes identify supporting tests in the QB Flex source checkout. They do not imply that a test has passed on the reader's deployment. Curated scenario mapping is in the validation reference.

## tests/dev-startup.test.ts

SHA-256: `941c18b5c6300f2c29876304f8da7a56c424190403a8fb1c8cf6255bed44538e`

- worker credentials belong to the API; missing configuration fails without minting a token
- a foreign ready API or occupied app port cannot bootstrap the native worker or local data
- clean native startup creates private API credentials, runs maintenance and both apps, and restarts cleanly
- failed API initialization stops the launcher without starting worker or frontends

## tests/durability.test.ts

SHA-256: `99534cb4b2d2b4f951dee5a7ef643bf698bca90cfef7700024620e0e493c611c`

- SIGKILL leaves acknowledged FULL/WAL commits and rolls back an open transaction
- branch queue is bounded, timed-out owners reject ambiguous work and can restart safely

## tests/fixtures-crash.ts

SHA-256: `aee507437b45ebc041ed8a6fbd550c2a8a0f409d9a34f91a8d1e17bbd35cb089`

Shared test fixture; scenario names are in its consuming test files.

## tests/fixtures-dev.ts

SHA-256: `4d67e200148c04e387df1e805b7250d7fc4d88f29caaa325e9594e469ca41414`

Shared test fixture; scenario names are in its consuming test files.

## tests/fixtures-lease.ts

SHA-256: `ab7e917802f4abdb217b87a72c7bf526b43481bcc76f9fa1a129427c415cae8c`

Shared test fixture; scenario names are in its consuming test files.

## tests/fixtures-ssr.tsx

SHA-256: `0be630773b859977f6ace20f0427004a6d1ab97f7192ce1316132658ea7381a4`

Shared test fixture; scenario names are in its consuming test files.

## tests/helpers.ts

SHA-256: `a65648b36130644c13b8eac8cb460da12759199ec8d52abb1bae2e5aa015f53f`

Shared test fixture; scenario names are in its consuming test files.

## tests/integration/control-backup.test.ts

SHA-256: `f4f5ca33e7cdf3cfc43b345430e91691dc3fe93300e532d25c015201ec0f16d4`

- encrypted control recovery validates the catalog, fences a live owner and revokes restored credentials

## tests/integration/core.test.ts

SHA-256: `415537cd75cef2c2696a6d72517e2c9edf5b94420cee2c1cd3a596af83694940`

- default deny, owner checks, atomic batches, cursor scopes, migration checksums and outbox
- real API: first owner, provisioning, realm isolation, SDK CRUD, backup and isolated restore

## tests/integration/email.test.ts

SHA-256: `28b4eaad52deea518b9d3748c34090c1b39bd6147a3bb9f9a25581e661565acb`

Shared test fixture; scenario names are in its consuming test files.

## tests/integration/mfa.test.ts

SHA-256: `0c526e4bb7b5957bfe46472e3f008efd357fe6cbdaa0872d51a720c9287d6a01`

- administrator MFA enrollment, challenge, verification and enrollment-required management gate

## tests/integration/network.test.ts

SHA-256: `5af0f64bab24c46e4f8c4d6972891055f079473de16a7312dbb1bbffec0a7014`

- real network isolation across two users/projects/branches, hidden schema, CORS, scopes and session revocation
- real realtime stream respects ownership, resumes after a disconnect and reauthorizes revoked sessions
- real S3 storage validates size, permissions, private bytes, finalization and deletion

## tests/integration/operations.test.ts

SHA-256: `edd6ccc85f2797c117408a75429243f12b5afe6ef5b920735485e602b8a37878`

- management scopes, signed pagination, quotas, corrupt backup denial and cancellation

## tests/integration/relations.test.ts

SHA-256: `a0ba3883bd6ec9f03059f7c1f63830487c6086f9cf12e5dee1bd9a31b3e9257c`

- related rows, existence policies, upsert paths and reviewed RPC share identity enforcement
- outbox preserves large integer precision and replay expiry requires resynchronization

## tests/integration/serialization.test.ts

SHA-256: `c97494c067535a61b2ce0911a17b1e413610533a6e8544e6726191fa653e1447`

- typed wire values preserve 64-bit integers, binary keys, JSON, enum metadata and injection strings
- permissive policy grants are ORed and restrictive policies remain an AND boundary

## tests/operational.test.ts

SHA-256: `3cd8bbf3ae1d34bdae24d559dd48964e971a93ce59598d4df9034a71ffaac298`

- OS-managed ownership rejects a live peer and recovers a SIGKILL without stale-lock races
- out-of-band DDL fails closed until a reviewed migration reconciles it
- structured logging drops unknown credential and payload fields at runtime

## tests/sdk-react.test.tsx

SHA-256: `153fde89680b7aaab85b66a1bbf4682428e8f2bce1b4472ae559b12810c214ba`

- provider boundary is actionable and SSR uses request-local anonymous state without browser globals
- shared auth updates, single-flight refresh, explicit identity cache keys and cache cancellation
- Strict Mode and unmount dispose subscriptions without duplicate sockets
- client cancellation, timeouts and disposal produce normalized errors
