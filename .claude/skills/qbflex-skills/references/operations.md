# CLI, setup and operations

Use [generated CLI help](generated/cli.md) for exact subcommands and flags. In the source checkout prefix commands with `bun run qb`; examples below abbreviate this to `qb`. These commands manage platform resources, not browser app authentication.

## Local setup and packages

Use pinned Bun 1.4.2 and `bun install --frozen-lockfile`. Copy `.env.example` to `.env` only when no user configuration exists, then configure backend dependencies. `docker compose --profile dependencies up -d` supplies local MinIO/Mailpit. `bun run dev` starts Studio 7610, Docs 7611 and API 7612; supporting host ports are MinIO 7613/console 7614, SMTP 7615, Mailpit 7616. React/Vanilla examples use 7617/7618. Internal Compose MinIO/SMTP retain 9000/1025. Do not mix a native `.data` directory with an active Compose database volume.

The native launcher checks all application ports before starting children and authenticates the API-generated worker credential before launching worker/frontends. If the full local Compose stack owns the ports, use its apps directly or run `docker compose --profile local stop studio docs api worker` before `bun run dev`. This keeps infrastructure and persistent volumes intact. Independent workers require the API to start first with the same `QB_DATA_DIR`, or a matching server-only `QB_WORKER_TOKEN`; never mint a worker credential independently.

First-owner setup uses the locally generated bootstrap token through `/setup`; keep it private. Use Studio to configure project exposure/policies/origins and credentials. On macOS `qb login --url <api> --email <email>` uses an interactive hidden password and OS keychain. MFA users obtain a Studio-issued management token. On Linux supply a scoped `QB_MANAGEMENT_TOKEN`; keychain login is not implemented there. `qb link --project <id> --branch <id> --url <api>` writes non-secret `qb.json`.

Build/package SDKs with `bun run sdk:build` / `bun run sdk:pack`; local tarballs appear under `dist/packages`. Install both tarballs together with npm for React's client peer. No npm publication occurs. Skill commands are `skill:refresh`, `skill:check`, `skill:test`, `skill:pack`; see [maintenance](platform.md).

Useful actual commands: `qb projects list`, `qb db migrate --file <sql> --id <id>`, `qb types generate --output <file>`, `qb branches list`, `qb storage list`, `qb backup create`, `qb backup restore --backup <id>`. Scope to `--project`/`--branch`. `db diff` compares a supplied schema JSON; it does not generate arbitrary safe migrations. `storage sync --bucket <id> --directory <dir>` adds missing objects and preserves existing/remote-only objects. `db reset --data-dir <dir> --confirm-local-reset` destroys local data and requires explicit applicable authorization.

## Linux deployment and monitoring

Use `docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost build` and `up -d` after setting public domains, exact application origins, master/bootstrap/worker keys, S3 and SMTP credentials. Docs has independent build/start commands and a docs-only profile. Caddy fronts HTTPS domains; 80/443 are public TLS gateway ports, separate from the local 7610 base. One API node owns persistent SQLite disk. Preserve volumes on restart; never use `down -v` as a port-change or deployment step.

Readiness is `/ready`; private metrics are `/internal/metrics` with the worker bearer token on a private network. Gateway internal routes return 404. Inspect request IDs, redacted logs, operation status, disk/WAL usage, owner queue pressure, outbox lag and upload/snapshot failures. Bounded limits return predictable 429/503. Reduce workload and reconcile uncertain writes before retrying. Do not tune beyond measured deployment capacity without a workload-specific benchmark.

## Recovery: three distinct assets

1. **Database snapshots:** owner-created `VACUUM INTO` snapshots encrypted with AES-256-GCM, checksummed and schema-versioned. Restore to a new isolated branch and verify integrity, foreign keys, migrations, policies and representative rows. Auth users persist; sessions/challenges/OAuth tokens do not. Restored object metadata is unavailable until separately recovered. Never copy only a live SQLite main file and lose its WAL.
2. **Object bytes:** S3 bytes are not included in branch/control archives. Maintain separate object-store backups/versioning and verify bytes, metadata and availability against a compatible checkpoint. Reconciliation is not proof that missing bytes were restored.
3. **Master key:** protect the original encryption key independently and test its availability in recovery drills. A snapshot without its original key is not a usable encrypted recovery point; the archive does not include key custody.

Primary cutover requires owner role and explicit project-slug confirmation, creates a rollback snapshot, fences/retires the old primary and switches the alias. Existing sessions/sockets belong to their immutable branch; establish new sessions and reconcile clients. Rollback restores the saved snapshot into another isolated branch; alias switching is not a data merge. Prepare a comparison/recovery drill before any authorized cutover.

Control catalog recovery is offline: stop API/worker, preserve all referenced branch files, verify archive and original master key, then use `qb backup control-restore --data-dir <dir> --file <archive> --confirm-local-control-restore` only with explicit authorization. The OS lease rejects recovery over an active owner. Recovery validates catalog/schema/files, makes an encrypted rollback checkpoint, excludes sessions and revokes restored project/management credentials. Reissue credentials afterward. Control archives contain neither branch databases nor S3 bytes. Daily/weekly retention defaults are seven days/four weeks; local archives alone are not off-site disaster recovery.
