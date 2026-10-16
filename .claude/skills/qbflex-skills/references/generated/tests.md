# Executable test source evidence

Generated descriptions and hashes identify supporting tests in the QB Flex source checkout. They do not imply that a test has passed on the reader's deployment. Curated scenario mapping is in the validation reference.

## tests/activity-metrics.test.ts

SHA-256: `17fa246b1e9ee4f10b99b1cd0e9cc59e33dcaceb6961a0ee23906020a9f240e2`

- filters events to the selected project
- builds a fixed-length daily series with success and failure counts
- counts top labels by key
- summarizes totals, failures, and success rate

## tests/app-rbac.test.ts

SHA-256: `d08c24e69fc79705d1d9426438eb81b8c09b081b4f15471d875358cb59aa8082`

- compilePolicies matches system role or assigned app roles
- role name validation reserves system policy roles
- custom role policies and banned-style deny via missing app role

## tests/client-disconnect.test.ts

SHA-256: `5c1e1fbe1eb47a1c3a54cd36d680d6209f8f3df38852dc6ae6753d950154f6b5`

- recognizes a client socket reset wrapped as an HTTP error
- console.error skips client disconnects and keeps other errors

## tests/control-archives.test.ts

SHA-256: `6c3ba8e885de5be8a02e3cb6956fbf67488689046f38faa2b87d86f32be864b0`

- control v2 self-contained metadata is authenticated and large snapshots stream with private files
- legacy control envelopes restore across both base64 chunk boundaries, with checksums and limits
- control archive cancellation and cross-kind archives never publish a restore
- lease-protected startup cleanup removes only recognized control staging, not archives or symlink targets
- a killed control snapshot releases its volume lock and abandoned plaintext can be swept safely

## tests/create-table-sql.test.ts

SHA-256: `b0120a151cc30dde8501287a2f50373229caa4d137bd241a36e3a28e66072f5a`

- accepts safe identifiers and quotes unsafe ones
- omits NULL defaults and wraps expression defaults
- builds CREATE TABLE with description, PK, boolean check, and FK
- generated default SQL executes in PGlite
- validates required fields and references

## tests/deployment-doctor.test.ts

SHA-256: `b4c135c14f7730c7a42a69cb5c844b738db6a222962b52ccb43be03354615ca7`

- doctor is redacted, readonly, reports unknown capabilities and returns actionable status
- explicit readiness probe is bounded and refuses redirects or credential-bearing URLs
- qb doctor emits structured reports and uses distinct invalid-invocation exit status

## tests/dev-startup.test.ts

SHA-256: `3bebf4d91af3ccb8cf05b0e774cb5f808af6492e2b08d63a438a6d4039509a72`

- worker credentials belong to the API; missing configuration fails without minting a token
- a foreign ready API or occupied app port cannot bootstrap the native worker or local data
- clean native startup creates private API credentials, runs maintenance and both apps, and restarts cleanly
- failed API initialization stops the launcher without starting worker or frontends

## tests/docs-generation.test.ts

SHA-256: `71fb0d0582f944530854c39b1b130b2810eba974a1564b666270d6d478457dba`

- Docs mirrors the specification and rejects stale search, sitemap, robots and references

## tests/durability.test.ts

SHA-256: `38a5dbba1bd23b2d250ea0607e75261bb61ab1906ce4dc795bc57f63448d07f1`

- SIGKILL leaves acknowledged FULL/WAL commits and rolls back an open transaction
- branch queue is bounded, timed-out owners reject ambiguous work and can restart safely

## tests/durable-jobs.test.ts

SHA-256: `fe6df63286cce778692ae093a7b37b7f9fc9d850439edcc14d67a18f8e504721`

- job submissions are encrypted, deduplicated, bounded and transactional with source work
- expired leases fence late completions; retries and cancellation have recorded attempts
- executor kinds cannot claim or complete push work; six attempts exhaust push policy
- deadline and exact 30-day retention cleanup are deterministic
- integer-safe owners emit numeric metadata and ciphertext corruption cannot poison the queue forever
- committed jobs survive database reopen and expired executor crash

## tests/fixtures-crash.ts

SHA-256: `cbc26555f5e5f39d0c7211027a845275f5563d0d7a8ebedcfe46588eab48de52`

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

## tests/fixtures-webhook-delivery.ts

SHA-256: `27c4605bd7287ff03c16978d03dc00070f34fb36e8ebb096b6b1fe653589334d`

Shared test fixture; scenario names are in its consuming test files.

## tests/helpers.ts

SHA-256: `f05563d61519f98d7f53e4d9f2df48104d29840c778ac012f3b196d142e54c34`

Shared test fixture; scenario names are in its consuming test files.

## tests/integration/control-backup.test.ts

SHA-256: `b03acc884bf6806d06937cf47bc8fcc02a53cc355ead9f3190485667004bc4c9`

- encrypted control recovery validates the catalog, fences a live owner and revokes restored credentials
- legacy control catalog recovery retains projects and revokes restored platform credentials
- control snapshot concurrency and cancellation clean private plaintext and preserve the live catalog
- missing referenced branch files prevent control replacement and leave no restore staging
- maintenance and shutdown drain streamed control snapshots without releasing the owner early
- offline CLI control create/restore waits for streams and keeps its result contract
- authenticated control archives with invalid migration evidence cannot replace the catalog

## tests/integration/core.test.ts

SHA-256: `871a307a450562503427d3e602479881228833d7d43231a2a0a1e3fa049feb9a`

- default deny, owner checks, atomic batches, cursor scopes, migration checksums and outbox
- real API: first owner, provisioning, realm isolation, SDK CRUD, backup and isolated restore

## tests/integration/email.test.ts

SHA-256: `2794cf52efe6f60ad7284eaac2f07e4e8a8a5335261f612217a35e1f69af187a`

Shared test fixture; scenario names are in its consuming test files.

## tests/integration/expanded-foundation.test.ts

SHA-256: `a1514e609f13cfb0d485e3637ed4b6d4f85d69e94419654da62b487608ea0666`

- policy fixture endpoint is isolated, legacy test cannot bypass policies, DELETE honors revisions, job routes are private
- streamed S3 uploads verify optional checksums before finalization and preserve legacy clients
- restricted push principal cannot claim maintenance jobs or access metrics/maintenance APIs

## tests/integration/mfa.test.ts

SHA-256: `0c526e4bb7b5957bfe46472e3f008efd357fe6cbdaa0872d51a720c9287d6a01`

- administrator MFA enrollment, challenge, verification and enrollment-required management gate

## tests/integration/network.test.ts

SHA-256: `ef1b897143a96f28f589fe7e0bbf8d06482f8c263351e6e6a675e75329325629`

- real network isolation across two users/projects/branches, hidden schema, CORS, scopes and session revocation
- real realtime stream respects ownership, resumes after a disconnect and reauthorizes revoked sessions
- real S3 storage validates size, permissions, private bytes, finalization and deletion

## tests/integration/operations.test.ts

SHA-256: `004060fdf417777f9accd1458e2a80ea34ee6bc54608640ab121da621bb28d34`

- management scopes, signed pagination, quotas, corrupt backup denial and cancellation

## tests/integration/relations.test.ts

SHA-256: `e1aa8413de86938a285d695fc6a6d064009f02e8b9e8503ec214cd0ab9a99cfd`

- related rows, existence policies, upsert paths and reviewed RPC share identity enforcement
- outbox preserves large BIGINT precision and replay expiry requires resynchronization

## tests/integration/security-advisor.test.ts

SHA-256: `be501567c99d602fdfe99b0a1d956a70f44235c223b25670eb4d0bdfc9e85bc3`

- Security Advisor is management-only, derives control evidence, binds acknowledgments and excludes them from restore
- credential age survives audit pruning, missing legacy provenance stays unknown and other projects are excluded

## tests/integration/serialization.test.ts

SHA-256: `3745abdec3a8b18e22a457504f81ca8147c28a450a2e2f1db57069929f4febee`

- typed wire values preserve 64-bit integers, binary keys, JSON, enum metadata and injection strings
- permissive policy grants are ORed and restrictive policies remain an AND boundary
- native PostgreSQL booleans, timestamps and JSON retain wire types and typed policy comparisons
- constant policy comparisons preserve numeric, text, null and identity semantics
- native enum names do not inherit boolean, integer or timestamp coercion
- PostgreSQL console permits UPDATE and ON CONFLICT while fencing protected statements and objects

## tests/integration/webhooks.test.ts

SHA-256: `b199a8a6659b845f4b829cd13dfad2cd38441ddc2731af1f06b005cf94fe6821`

- webhook management scopes, dispatch-time authorization, signed delivery, replay dedup and restore exclusion
- webhook queue backpressure does not suppress owner cleanup or scheduled maintenance
- webhook executor cannot consume other kinds; push principal cannot prepare or produce webhooks

## tests/observability-histograms.test.ts

SHA-256: `7f7bf9b45c6dba2fdf972f7cdcd6aebc0ca4471e7d6d97e5bb469d3c2728ff81`

- private histograms retain old counters and expose cumulative boundary buckets
- labels never contain user-controlled keys, tokens, query values or arbitrary gauge names

## tests/operational.test.ts

SHA-256: `c884e488b3e6b1b2023d687a3d4a359428f9bc7f65245f13db4c97195365c3fd`

- OS-managed ownership rejects a live peer and recovers a SIGKILL without stale-lock races
- out-of-band DDL fails closed until a reviewed migration reconciles it
- structured logging drops unknown credential and payload fields at runtime

## tests/pglite-migration.test.ts

SHA-256: `2655fc5fe695774acbf456cb8fc8fb43db0576159ed1b2c238b77f19a07637ed`

- SQL parameter numbering preserves literals, comments, quoted identifiers and function bodies
- PGlite transactions isolate nested work, roll back policy failures and persist committed rows
- SQLite conversion preserves binary values, int64 identities, constraints, indexes and deleted sequence positions
- conversion blocks custom objects and mixed-type data, and never leaves a partial destination
- auth conversion preserves user IDs, password hashes, dates, MFA flags and live sessions
- whole-installation preflight rejects overlapping paths and both current and legacy active owners
- complete installation conversion preserves catalog, branch policies, event checkpoints, keys and archive references
- SIGKILL during installation conversion preserves the source and leaves an unopenable incomplete destination

## tests/policy-simulator.test.ts

SHA-256: `465cd96f5dbc5e8ec91b69670347b7370c684b49d0ccacf92ef2641bcdb1fcab`

- synthetic SELECT/INSERT/UPDATE/DELETE use DOUBLE PRECISION policies, never production rows or outbox

## tests/project-identity.test.ts

SHA-256: `fe27ef12f1649206ff74ebed0195248741b4ecced55a12f74bf91bb4777066e1`

- administrators can rename a project and keep the local region

## tests/project-lifecycle.test.ts

SHA-256: `1d940225d672139f27b87922feacf59d3feab8f4c84bb2c87f76d344c94c2db8`

Shared test fixture; scenario names are in its consuming test files.

## tests/schema-graph.test.ts

SHA-256: `eb5a409e3fba89f46fba18393002ca0106669f5b6fd2ab771240542519c84956`

- builds nodes per table and edges per foreign key
- references to absent tables surface as missing, not edges
- non-exposed tables still render (policy state is data, not structure)
- duplicate foreign keys dedupe; relationships become labeled edges

## tests/sdk-react.test.tsx

SHA-256: `153fde89680b7aaab85b66a1bbf4682428e8f2bce1b4472ae559b12810c214ba`

- provider boundary is actionable and SSR uses request-local anonymous state without browser globals
- shared auth updates, single-flight refresh, explicit identity cache keys and cache cancellation
- Strict Mode and unmount dispose subscriptions without duplicate sockets
- client cancellation, timeouts and disposal produce normalized errors

## tests/security-advisor.test.ts

SHA-256: `d71c27fdc6194c5adf1d2d5bc63eecb877f6210783a5b768f86730d4241a8499`

- advisor uses metadata only, distinguishes fail-closed grants from public exposure and makes no repairs
- finding evidence binds acknowledgment; exact expiry, stale findings, invalid schedules and clearing are enforced
- advisor respects INSERT check-only semantics and role-scoped restrictions

## tests/streaming-archives.test.ts

SHA-256: `3a66185915ceea31f76311fa182f3cbd91f8746c00a97173c6542376a37c8f57`

- v2 streamed archives authenticate header/ciphertext, checksum and limits before publication
- legacy iv/cipher/tag and base64-text checksums remain readable across chunk boundaries

## tests/streaming-transfers.test.ts

SHA-256: `32d089da6953c2d66945b8a44057f5eab729e8e15978a831f5f8d49f66419667`

- large staging hashes incrementally, uses bounded chunks and private files, then cleans up
- size/checksum mismatches and cancellation remove all private staging

## tests/studio-auth.test.ts

SHA-256: `b1105350b18f69ee55944312d28f7b7de53f6087186a17831a21ac35db02e298`

- local Studio/API aliases share a cookie host while configured remote hosts and ports stay intact
- return destinations reject external URLs, auth loops and encoded bypasses
- route guards use current session state, preserve a local return path and require setup first
- network errors and malformed session/setup responses fail closed without a sign-in redirect
- sign-in requires a verified cookie session and discards previous identity data
- an anonymous request started before sign-in cannot overwrite the newly verified session

## tests/studio-query-client.test.ts

SHA-256: `a25caa91e870d7a083eefa71dc84d07fb6d5bb68417e34f9295ebca99ca555eb`

- successful Studio submissions await fresh lists and summaries before local success callbacks
- imperative uploads refresh active views and invalidate inactive views without fetching disabled queries
- cancelled pre-submission reads cannot overwrite newer data even when their transport ignores abort
- failed submissions do not refresh or clear data; failed reads do not falsely fail acknowledged writes
- Studio caches remain request-local

## tests/terminal-logging.test.ts

SHA-256: `dc3acad650bef16151ad2c0d09be8ec38538687ab40ad7a54b76c30392d6e01c`

- terminal auto mode keeps production and pipelines JSON; explicit mode and color controls are honored
- pretty and JSON logs use the same allowlist and strip credentials, query strings and terminal controls
- routine worker polling is quiet only when successful and fast; failures and slow calls stay visible
- startup panel shows ready services and engine information without secrets and fits narrow terminals
- Elysia request logs and metrics use the actual Better Auth response status

## tests/upload-queue.test.ts

SHA-256: `c44336e1f625f89866f725455578e1a796302e13c7606d48f6b6aa2a5423c894`

- queue runs two transfers, shows at most five, then removes success and promotes pending items in order
- failed uploads retain details; manual retry reuses the original intent, file and immutable target
- canceling pending or active work releases queue slots; identity changes abort and ignore late callbacks
- queue capacity rejects the whole selection and failed refresh never retries a committed upload
- upload transport reports bytes and finalizing separately, requires ready acknowledgement and sends cookies

## tests/webhook-crash.test.ts

SHA-256: `2a87cbe44fc32dc34fcb9403fecf838becf5fe139f73e5b418f7a5c18bd8de3d`

- SIGKILL rolls back incomplete webhook fanout; committed leases reopen with stable IDs and fence late results

## tests/webhook-jobs.test.ts

SHA-256: `b91dcb3aa1192e943a7ab4dc6deba84409dbbb16b5e04fff3b138d7fb6372621`

- webhook fanout checkpoints and encrypted reference jobs commit atomically and deduplicate
- dispatch rechecks real SELECT policies and projection, signs exact bytes, rotates with bounded overlap
- subscription state, policy revocation and replay gaps prevent unsafe dispatch; bounded fanout drains
- hidden/composite deletion keys, unexposed tables, malformed configurations and quotas fail closed
- queue backpressure rolls back every producer checkpoint rather than losing committed source events

## tests/webhook-network.test.ts

SHA-256: `46db0150bc0d24493524d0fd99ec50bc4140f221b414c4747e49a3f1d9d54564`

- webhook URLs reject unsafe schemes, credentials, ambiguous syntax and private/special IPv4/IPv6
- all DNS answers are screened on every dispatch and only a validated address is selected
- delivery rejects prohibited destinations and cancellation before issuing HTTPS requests
- real HTTPS uses the fixed address, verifies original TLS hostname, does not forward secrets or follow redirects

## tests/workspace-lifecycle.test.ts

SHA-256: `3f9115cdcb7e9044730b9f464cfb27869b04bf684cd08e4bed8d66cdd0d9d9da`

Shared test fixture; scenario names are in its consuming test files.
