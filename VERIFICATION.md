# Local verification — 6 October 2026

This is a local P0 delivery. No site, registry package or external provider configuration was published. The existing Sites prototype was not modified.

## Build and runtime matrix

| Environment                                      | Result                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS ARM64, Apple M5 Pro, Bun 1.4.2             | Type checking, tests, compatibility spike, Studio/Docs builds, both examples and SDK packaging pass                          |
| Linux ARM64 in Docker Desktop                    | Full verification image builds; SQLite vector extension 0.1.9 loads; GraphQL mounting/auth isolation spikes pass             |
| Linux AMD64 under Docker Desktop emulation       | Full verification image builds and tests pass; this is an emulated compatibility check, not an AMD64 performance measurement |
| Chromium 153.0.8010.12 through Playwright 1.63.0 | Docs desktop/mobile, Studio navigation and both authenticated task examples pass                                             |

The Linux build gate runs the SDK build, generated references, type checks, unit/integration suite, generated-type consumer checks, tutorial checks, route-contract checks, documentation checks, bounded compatibility spike and all application builds. Its two external-service tests are skipped during image construction and run separately against real services.

## Executed gates

| Gate                                  | Evidence                                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full tests with actual MinIO/Mailpit  | 22 tests pass, zero failures, on macOS and inside the Linux API container                                                                                                                                                                                                        |
| Clean container and empty data volume | First owner → organization/project provisioning → migration → default-private rejection → exposure/policies → separate application user → CRUD → authorized event → private object upload/download → generated types → restart durability → encrypted snapshot/validated restore |
| CLI quickstart                        | Init/link, scoped project listing, migrate, import/export, generated types, backup/restore, branch listing and secret configuration pass against the real API                                                                                                                    |
| Policy isolation                      | Two users/projects/branches; wrong-realm credentials, hidden columns, protected counts, ownership reassignment, policy algebra, relationships, reviewed RPC, upsert and revoked sessions                                                                                         |
| Crash durability and ownership        | SIGKILL preserves acknowledged FULL/WAL writes and rolls back an open transaction; live peers cannot acquire the data-volume lease; the OS releases it after a crash                                                                                                             |
| Overload and limits                   | Bounded owner queue/deadline recovery, explicit rate quotas, conservative result-size bounds, oversized-event resynchronization and streamed JSON limits                                                                                                                         |
| Recovery                              | Authenticated encryption/checksums, corrupt snapshot rejection, integrity/foreign-key/schema validation, isolated restore, excluded sessions, fenced cutover and offline control-catalog restore with credential revocation                                                      |
| SDK artifacts                         | Independent npm tarball installation, ESM imports, declarations, generated database/RPC types, React SSR, auth/CRUD/realtime workflows                                                                                                                                           |
| React lifecycle                       | Actionable provider boundary; shared auth; identity/cache isolation; cancellation; Strict Mode subscription cleanup; anonymous request-local SSR state                                                                                                                           |
| Documentation                         | 32 repository MDX articles, 33 prerendered pages including the landing page, static 404, 20 compiled tutorial artifacts and 72 checked public route contracts                                                                                                                    |
| Browser workflows                     | Search, stable heading links, copy controls, theme switch, metadata, mobile drawers/keyboard dismissal, direct browser-module import, Studio workspaces and React/Vanilla signup/CRUD/file round trips                                                                           |
| Logs                                  | Runtime logging allowlist and reset-link redaction omit passwords, credentials and row payloads                                                                                                                                                                                  |

Screenshots from the browser checks are local artifacts under `verification-artifacts/`. External-service tests require the local dependencies; ordinary `bun run check` intentionally skips those two tests unless enabled.

## Measured baseline

[`scripts/benchmark.ts`](scripts/benchmark.ts) seeded **1,000,000 ordinary task rows** with an `(owner_id,id)` index and ownership policy, then sent 1,000 reads of 20 rows at 100 requests/second and 100 single-row writes at 25 writes/second. SQLite uses WAL, synchronous FULL and foreign keys. All requests and all 100 authorized realtime events succeeded.

The Linux ARM64 container was limited to **4 CPU equivalents and 8 GiB** (`cpu.max=400000 100000`, `memory.max=8589934592`). The Apple M5 Pro host ran Docker Desktop; its shared Linux VM reported 18 CPUs and 8,317,267,968 bytes of available physical memory. The tested temporary filesystem was OverlayFS (`0x794c7630`) on Docker's local VM disk. This is a virtualized local benchmark, not bare-metal production certification.

| Measurement                      | Result    |
| -------------------------------- | --------- |
| Seed                             | 0.884 s   |
| Indexed policy-filtered read p95 | 4.29 ms   |
| FULL/WAL write p95               | 8.97 ms   |
| Authorized row event p95         | 250.18 ms |
| Encrypted snapshot               | 1.393 s   |
| Validated isolated restore       | 1.820 s   |

Realtime timing runs from request start to the SDK event and includes commit time. Raw benchmark metadata/results are in [`docs/benchmarks/linux-arm64.json`](docs/benchmarks/linux-arm64.json). These short baseline runs do not establish sustained throughput, multi-tenant fairness, power-loss behavior, memory-leak freedom, RPO/RTO guarantees or the Studio first-interactive target. Counts/joins, large values, slow readers, concurrent object transfers and production disks need separate workloads.

## Reproduce

```sh
bun install --frozen-lockfile
docker compose --profile local up -d --build
bun run check
QB_INTEGRATION_STORAGE=1 bun test tests
docker compose exec -T -e QB_INTEGRATION_STORAGE=1 -e QB_MAILPIT_URL=http://mailpit:8025 api bun test tests
bun run test:cli
bun run test:compose
bun run build
bun run test:browser
bun run sdk:pack
bun scripts/sdk-consumer-check.ts
docker build --platform linux/arm64 -f infra/Dockerfile --target verify -t qb-flex-verified-arm64 .
docker build --platform linux/amd64 -f infra/Dockerfile --target verify -t qb-flex-verified-amd64 .
docker run --rm --platform linux/arm64 --cpus=4 --memory=8g qb-flex-verified-arm64 bun scripts/benchmark.ts
```

The fresh-container check uses a disposable volume/container and removes them afterward. It leaves the normal local installation untouched. The artifact consumer installs both local SDK tarballs with npm: Bun 1.4.2 incorrectly attempts to resolve the unpublished client peer from the registry when both tarballs are supplied. The monorepo's Bun workspace installation passes.

## Deployment and scope boundaries

Google/GitHub adapters are credential-configurable; no live credentials were supplied, so their callbacks are not certified. Production HTTPS/domains, SMTP outside Mailpit, disk encryption, external S3 providers and AMD64 hardware require deployment-specific checks. Chromium is the automated browser target; Firefox/Safari are not certified here. The macOS system SQLite rejects dynamic vector loading; Linux loads the tested extension, but vector product APIs and GraphQL remain P1.

One API process owns writable SQLite files. Distributed ownership/failover, SQLCipher, point-in-time recovery, custom storage-policy AST, resumable uploads, transformations, functions, AI, MCP and other framework adapters remain planned. Authentication limits use socket addresses: behind a proxy, apply per-client limits at the gateway because trusted forwarded-address processing is not implemented. Metrics are Prometheus HTTP/owner/disk metrics; full distributed tracing is not implemented.

Object listings currently cap at 500 ready objects. Database queries/relationships share a conservative 2 MiB serialization budget; oversized event images require a fresh snapshot. Four uploads and two snapshots can run concurrently. These are initial operational bounds, not advertised scale guarantees.

Back up S3 bytes and the master key separately and copy encrypted snapshots off-node. Branch restore deliberately leaves object bytes unavailable and removes sessions/OAuth tokens. Offline control recovery revokes restored project/management credentials. Local snapshots on the same disk are not disaster recovery by themselves.

## Development skill, branding and local ports

The canonical `qbflex-skills` skill documents QB Flex 0.1.0 under
`.claude/skills/qbflex-skills`; its deterministic local archive is
`dist/skills/qbflex-skills.zip`. Agent Skills frontmatter and Codex implicit-invocation
metadata validate. Generated API/SDK/CLI/test references carry source provenance,
and the manifest records file checksums. The archive extracts outside the checkout;
Node-only integrity checks and redacted read-only diagnostics work there. Real local
SDK tarballs install, generated database/RPC types compile and both portable Vite
applications build. React/Vanilla workflows verify auth, protected CRUD, reviewed
RPC, forced realtime reconnect, subscription disposal and private S3 transfers.
Integrity tests reject edited files, wrong names, disabled discovery, broken links
and stale generated contracts. Existing platform security and React lifecycle tests
remain passing. No global skill installation or registry publication occurs.

Docs navigation now has section-specific decorative icons on desktop and in mobile
drawers. Shared Docs/Studio branding centers the wordmark, divider and product label;
browser checks verify alignment, single-logo visibility in each theme, mobile
navigation, overflow and updated Studio links. Screenshots are in
`verification-artifacts/docs-updated-desktop.png`, `docs-updated-mobile.png` and
`studio-updated-header.png`.

Local port order is Studio 7610, Docs 7611, API 7612, MinIO 7613/console 7614,
Mailpit SMTP 7615/UI 7616, React example 7617 and Vanilla example 7618. Application
URLs, Compose mappings/health checks, worker/gateway targets, SDK examples and Docs
metadata use these defaults. Internal MinIO/SMTP ports and public TLS gateway
ports retain their service conventions. The running local containers were rebuilt
and recreated with their existing database/object volumes preserved. The clean
Linux API/container workflow, browser and CLI gates pass with the changed mappings.
Existing projects retain their reviewed origin allowlists; authorize the new exact
example origins when moving an existing application.

## Native development startup regression

The launcher now probes all application ports before starting children and requires
its local API's worker credential to authenticate before starting worker/Studio/Docs.
This prevents a running Docker API's readiness response from bootstrapping a worker
against an unrelated native `.data` directory. Independent workers report missing
configuration without creating credentials or printing token values.

On macOS, `tests/dev-startup.test.ts` passes four regressions covering occupied API
and Studio ports, absent/empty/production worker credentials, clean API/maintenance/
Studio/Docs startup, private token permissions, restart/shutdown and failed API
initialization. All services and databases in those tests are temporary. The full
`bun run check` passes with 24 tests and two external-service tests skipped; generated
types, tutorial artifacts, route contracts and documentation checks pass. Existing
Docker application/data volumes remain intact.
