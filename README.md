# QB Flex

Local-first, self-hostable PGlite backend with a branded Studio, generated REST, application authentication, row policies, realtime, S3 storage, encrypted recovery, CLI and independent documentation application. This implements the P0 scope of [the development specification](qb-flex-development-spec.md). P1/P2 services remain visibly planned. [Specification1.1](qb-flex-development-spec.md) defines an expanded release; [its implementation ledger](docs/expanded-release-status.md) tracks incomplete features and acceptance evidence. Product version remains0.1.0.

## Start locally

Use **Bun 1.4.2** and Docker Compose. The lockfile and container images pin verified releases.

```sh
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d --build mailpit storage-init
bun run dev
```

The development command checks application ports, starts the API and waits for its local worker credential to authenticate before starting the maintenance worker, Studio and Docs. If the full local Compose profile is already running, use those applications directly. To switch to native hot reload, stop only its application services first:

```sh
docker compose stop studio docs api worker
bun run dev
```

Mailpit remains running, and the database volume is preserved. Native `.data` and the Compose database volume are separate installations; do not copy or invent `worker.token` to connect one installation's worker to another API. For independent worker startup, start the API first with the same `QB_DATA_DIR`, or supply the same server-only `QB_WORKER_TOKEN` to both processes.

- Studio: http://localhost:7610
- Docs: http://localhost:7611
- API readiness: http://localhost:7612/ready
- Mailpit: http://localhost:7616

Local ports start at **7610**: Studio 7610, Docs 7611, API 7612,
Mailpit SMTP 7615, Mailpit UI 7616, React example 7617 and Vanilla
example 7618. Object storage is any S3-compatible provider you configure
(`QB_S3_ENDPOINT`, e.g. RustFS on 127.0.0.1:9000); the public self-hosting
gateway uses HTTPS on 443.

Create your own first owner in Studio using the token in `.data/bootstrap.token`. It is removed after setup. Application users are separate from Studio accounts. No default administrator is seeded. Local master/bootstrap/worker secrets are generated with restricted file permissions. Production requires operator-provided secrets and HTTPS.

For an entirely containerized local deployment:

```sh
docker compose up -d --build
docker compose exec api cat /var/lib/qb-flex/bootstrap.token
```

The second command deliberately displays your one-time local setup token. Keep it private. Container databases use the `database` named volume; native development uses `.data`. They are separate installations. Stop containers with `docker compose stop`; preserve the volumes for subsequent runs.

## Build the same task application in React and JavaScript

Follow Docs → Getting started → First project to create a tasks table, expose it, add ownership policies and issue a publishable key. Create a private attachments bucket in Storage. Then run either example:

```sh
bun run --cwd examples/react dev
bun run --cwd examples/vanilla dev
```

React runs on port 7617 and Vanilla JavaScript on 7618. Enter your API URL, project ID, publishable key and bucket ID in their forms. Both implement signup/login, protected CRUD, authorized row events and file upload/download/deletion. Use exact application origins in project configuration.

`@qb-flex/client` has browser ESM and TypeScript declarations without React dependencies. `@qb-flex/react` provides `QBProvider`, `useQBClient`, `useQBAuth`, `useQBQuery`, `useQBMutation`, `useQBRealtime` and `useQBStorage`, with identity-aware cache isolation and cleanup. Supply a stable client and use request-local state for SSR.

Build and package the SDKs locally:

```sh
bun run sdk:pack
```

The artifacts are `dist/packages/qb-flex-client-0.1.0.tgz` and `dist/packages/qb-flex-react-0.1.0.tgz`. Install both tarballs with npm when testing React in another application (`npm install /path/to/qb-flex-client-0.1.0.tgz /path/to/qb-flex-react-0.1.0.tgz`). Bun 1.4.2 attempts to resolve the unpublished client peer from npm even when both local tarballs are supplied; npm installation passes the isolated consumer check. Nothing is published to npm. The framework-independent browser module is also available at `/sdk/client.js` on Docs.

For npm scope setup, lockstep semantic versioning, dry-run validation, trusted publishing and post-release checks, use the [client SDK release runbook](docs/sdk-releases.md). The repository's publish command is dry-run by default; external publication remains an explicit release action.

## Documentation application

`apps/docs` uses TanStack Start, shared UI and repository-owned MDX. It has a build-generated MiniSearch index, highlighted/copyable code, accessible mobile navigation, article heading links, previous/next articles, light/dark themes, canonical/social metadata and a sitemap. Dedicated React and Vanilla tracks describe all implemented SDK features.

```sh
bun run sdk:build
bun run docs:generate
bun run --cwd apps/docs build
bun run --cwd apps/docs start
```

For a different public Docs domain, set **both** `QB_DOCS_URL` and `VITE_DOCS_URL` before generation/build. Set `VITE_STUDIO_URL` for its Studio link. Serve prerendered pages from `apps/docs/dist/client` with clean-URL directory indexes and a useful 404 fallback, or run its standalone Bun server. The Docker `docs` profile builds and serves it independently. Public hosting is a separate release action.

API references are generated from shared contracts; SDK references come from emitted declarations. `docs:check`, contract-route checks, tested tutorial source artifacts and generated-type consumer checks detect drift.

## CLI and operations

Run `bun run qb --help`. macOS login stores a scoped token in Keychain. Linux/CI use a Studio-issued `QB_MANAGEMENT_TOKEN` injected through protected environment configuration. Organization lifecycle access must be explicitly granted when creating that token. Production administrators enroll MFA in Settings before privileged operations.

The maintenance worker performs expiry cleanup, checkpoints, object cleanup and daily encrypted branch/control snapshots. Default retention keeps seven days plus four weekly checkpoints. Branch restore validates integrity/foreign keys/schema version, excludes sessions/OAuth tokens, and leaves object bytes unavailable. Studio cutover requires the project slug, saves a rollback checkpoint and retires the former primary. Control recovery is offline and revokes restored credentials. Back up the master key and S3 objects separately, and move snapshots off-node.

Use persistent local disks for PGlite. One API process owns the data volume through an OS-managed file lock. Do not open one live PGlite directory from multiple processes or nodes. Project limits, bounded owner queues, query deadlines and realtime connection caps shed overload explicitly.

Linux self-hosting is configured by `compose.selfhost.yml` and `infra/Caddyfile`; supply the required domains, secrets, email credentials (Resend API key or SMTP) and application origins before starting it. The full production walkthrough — prerequisites, secrets, external S3, backups, upgrades and recovery — is in [docs/deployment.md](docs/deployment.md), with all required variables templated in `.env.production.example`. Object storage is provider-agnostic: any S3-compatible backend (RustFS, MinIO CE, AWS S3, R2) is configured through `QB_S3_*`. Certify your production object backend and external identity providers independently.

## Verify

The project-local [qbflex-skills](.claude/skills/qbflex-skills/SKILL.md) covers application
development, platform contributions, security, SDKs and operations for QB Flex 0.1.0.
Its portable examples, redacted diagnostics and generated source references ship in
`dist/skills/qbflex-skills.zip`; see [installation](.claude/skills/qbflex-skills/INSTALL.md).
Run `bun run skill:refresh`, `bun run skill:check`, `bun run skill:test` and
`bun run skill:pack` to maintain and verify it. No global installation or publication occurs.

```sh
bun run check
bun run test:integration
bun run test:cli
bun run test:compose
bun run build
bun run test:browser
bun run verify:linux
bun run sdk:pack
bun scripts/sdk-consumer-check.ts
```

Integration/browser checks need the local dependencies. Browser verification uses separate Studio/Docs ports 3030/3031 so it can run alongside the normal stack. Playwright requires an installed Chromium (`bun x playwright install chromium` if needed). [VERIFICATION.md](VERIFICATION.md) records actual results and certification boundaries. [Architecture decisions](docs/architecture-decisions.md) explain the M0 choices.

## Repository

`apps/api` owns management/data/auth routes; `apps/worker` drives maintenance; `apps/studio` and `apps/docs` are independent TanStack Start applications; `apps/cli` supplies the CLI. Shared packages own contracts, schema, policy/query compilation, database workers, auth, S3, observability, UI and SDKs. Examples and tests exercise the public API.

No external deployment or registry publication is performed. The existing Sites Studio prototype remains the visual reference and its audience is unchanged.

Existing SQLite installations require [offline conversion](apps/docs/content/self-hosting/engine-migration.mdx) into a separate directory before activation. PGlite owners default to four (`QB_MAX_BRANCH_OWNERS`, range 1–32); provision memory for independent WASM instances and complete snapshot exports.
