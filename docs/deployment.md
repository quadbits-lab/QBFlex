# QB Flex production deployment (Docker Compose)

This guide deploys QB Flex 0.1.0 on a single Linux host with Docker Compose and the
`compose.selfhost.yml` overlay. Caddy fronts three HTTPS domains and terminates TLS with
Let's Encrypt; the API owns a persistent SQLite database on a named volume.

Contracts referenced here are verified against QB Flex 0.1.0. If your installed version
differs, compare the compose files, `infra/Dockerfile` and `.env.production.example`
against the source before deploying.

## Architecture

| Service | Image target | Internal port | Notes |
| --- | --- | --- | --- |
| gateway (Caddy) | pinned `caddy` digest | 80, 443 public | TLS/ACME; proxies to api, studio, docs; blocks `/internal/*` with 404 |
| api | `api` | 7612 | Owns the SQLite database volume; readiness at `/ready` |
| worker | `worker` | — | Background maintenance; shares the database volume read-only |
| studio | `studio` | 7610 | Admin UI |
| docs | `docs` | 7611 | Prerendered documentation |
| storage-init | `storage-init` | — | One-shot bucket provisioning against `QB_S3_ENDPOINT` (`restart: 'no'`) |

Volumes: `database` (SQLite + WAL), `gateway` (Caddy certs). Object bytes live in your
S3-compatible provider, not in a Compose volume.
Resource limits, capability drops and log rotation are preset in `compose.selfhost.yml`.

## Prerequisites

- Linux host (x86_64 or arm64) with Docker Engine and Compose v2 (`docker compose version`)
- DNS: `api`, `studio` and `docs` subdomains resolved (A/AAAA) to the host **before** first start,
  so Caddy can complete the ACME challenge
- Firewall: host ports 80 and 443 reachable from the internet; nothing else published
  (app services bind only inside the Compose network; the base compose publishes nothing publicly)
- If the object backend runs on the same host, the containers must reach it through
  `http://host.docker.internal:<port>`; on Linux add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to the api/worker/storage-init services
- Email provider: a Resend account with a verified sending domain (API key required in
  production) — React Email templates ship verification and password-reset mail; an SMTP
  relay is the optional alternative
- Object storage: any S3-compatible provider (RustFS, MinIO CE, AWS S3, Cloudflare R2)
  with credentials that allow bucket creation
- TLS and S3 provider compliance are certified independently for the backend you choose

## 1. Install the repository and environment file

```sh
git clone <your-fork-or-release> && cd QBFlex
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost config >/dev/null && echo "compose files valid"
cp .env.production.example .env
```

## 2. Generate and set secrets

Edit `.env`. Generate each secret with `openssl rand -hex 32` (the master key must contain
at least 32 characters):

```sh
openssl rand -hex 32  # QB_MASTER_KEY — protect it offline; snapshots are unusable without it
openssl rand -hex 32  # QB_BOOTSTRAP_TOKEN — one-time first-owner token, revoke after setup
openssl rand -hex 32  # QB_WORKER_TOKEN — private worker bearer token
```

- Required: `QB_API_DOMAIN`, `QB_STUDIO_DOMAIN`, `QB_DOCS_DOMAIN`, `QB_APP_ORIGINS` (exact
  browser origins, comma separated), `QB_MASTER_KEY`, `QB_BOOTSTRAP_TOKEN`, `QB_WORKER_TOKEN`,
  `QB_S3_ACCESS_KEY`, `QB_S3_SECRET_KEY`, and email — `QB_RESEND_API_KEY` (or `QB_SMTP_HOST`
  for the optional SMTP fallback; the API refuses to start in production without one of them).
- Email uses React Email templates delivered through Resend; set `QB_MAIL_FROM` to an address
  on your verified Resend domain (or the SMTP relay identity).
- Production requires HTTPS `QB_PUBLIC_URL`; the overlay derives it from `QB_API_DOMAIN`.
- Production requires admin MFA (`QB_REQUIRE_ADMIN_MFA: 'true'` is preset).
- Keep the completed `.env` off version control (`-mode 0600` recommended) and out of images.

## 3. Object storage

QB Flex talks S3-compatible APIs, so point `QB_S3_ENDPOINT` at the provider you run —
for example RustFS (default S3 port 9000), MinIO CE, AWS S3 or Cloudflare R2:

```sh
QB_S3_ENDPOINT=http://host.docker.internal:9000   # same-host RustFS; remote: https://s3.example.com
QB_S3_BUCKET=qb-flex
QB_S3_ACCESS_KEY=<provider access key>
QB_S3_SECRET_KEY=<provider secret key>
```

Email selection is explicit: `QB_MAIL_PROVIDER` accepts `resend` (default when
`QB_RESEND_API_KEY` is set), `smtp`, or `auto`; an explicit value is honored over
`QB_RESEND_API_KEY` presence, which keeps Mailpit-style relays usable for local stacks.
When using an SMTP relay on an implicit-TLS port (for example Resend's `smtp.resend.com:465`),
set `QB_SMTP_SECURE=true`; STARTTLS relays on 587 work with the default.

`storage-init` is a one-shot service that provisions the bucket on first start
(HeadBucket → CreateBucket when 404). It runs best-effort; if it fails, the API still
boots and storage requests report `STORAGE_UNCONFIGURED`-class errors until you fix
credentials and re-run:

```sh
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost run --rm storage-init
```

## 4. Build and start

```sh
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost build
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost up -d
```

Verify:

```sh
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost ps
curl -fsS https://api.example.com/ready      # ready gate
curl -fsS https://studio.example.com/        # Studio served
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost \
  logs storage-init                          # bucket provisioning succeeded
```

First start builds all application targets; Caddy obtains certificates on the first request
window. If certificates fail, re-check DNS and that 80/443 are open, then
`docker compose ... restart gateway`.

## 5. First-owner setup

The API refuses to start in production without owner credentials. Once `/ready` responds:

1. From `.env`, take the `QB_BOOTSTRAP_TOKEN` value.
2. Create the first owner: `POST https://api.example.com/setup` with
   `{"bootstrapToken":"<token>","email":"owner@example.com","name":"Owner","password":"<strong password>"}`,
   or use the onboarding flow in Studio.
3. Enable MFA for the admin account (production requires it) and record recovery codes.
4. After first setup, remove the plaintext bootstrap token from the host and re-chmod `.env`.

Keep the bootstrap token private to the single operator creating the owner account. The owner
session then issues management tokens and project keys from Studio; never place service or
management credentials in browser code.

## 6. Day-2 operations

- **Logs:** `docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost logs api`
  (`--tail 200 --follow` as needed). JSON-file logs are capped at 10 MiB × 3 per service.
- **Metrics:** private `/internal/metrics` on the API, authenticated with the worker bearer
  token, reachable only inside the Compose network. From the gateway the path returns 404.
  Readiness is the public `/ready` endpoint.
- **Capacity:** `docker compose ... top` and `docker stats` for CPU/memory pressure; watch
  disk/WAL usage, owner-queue pressure, outbox lag and upload/snapshot failures. Bounded
  limits surface as 429/503 — reduce workload and reconcile uncertain writes before retrying.
  Do not tune limits without a workload-specific benchmark.
- **One node owns the database.** Do not start a second API against the same volume.

## 7. Backups and recovery (three distinct assets)

1. **Database snapshots** — owner-created, AES-256-GCM encrypted, checksummed and
   schema-versioned (default retention 7 days / 4 weeks). Restore goes to a new isolated
   branch, then verify integrity, foreign keys, migrations, policies and representative rows.
   Auth users persist; sessions, challenges and OAuth tokens do not. Restored object metadata
   needs separate recovery. Never copy a live SQLite main file without its WAL.
2. **Object bytes** — S3 bytes are **not** in control archives. Use bucket versioning plus a
   separate object-store backup, and verify bytes, metadata and availability against a
   compatible checkpoint.
3. **Master key** — custody must be preserved independently (offline). A snapshot without its
   original key is not a usable recovery point.

Run backups with the CLI against your deployment:

```sh
qb login --url https://api.example.com --email owner@example.com   # Linux: supply a scoped QB_MANAGEMENT_TOKEN
qb backup create --project <project> --branch <branch>
# Restore to an isolated branch only:
qb backup restore --backup <id> --project <project> --branch <new-branch-id>
```

Control-catalog recovery (`qb backup control-restore --data-dir <dir> --file <archive>
--confirm-local-control-restore`) is offline and destructive in nature: stop API and worker
first, preserve all referenced branch files, verify the archive and original master key, and
perform it only with explicit authorization. It revokes restored project/management
credentials — reissue them afterwards. Daily/weekly local archives alone are not off-site
disaster recovery.

## 8. Upgrades and rollback

```sh
# Before upgrading: create a fresh backup and confirm it verifies.
git pull                      # or check out the verified release
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost build
docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost up -d
```

- Named volumes persist across `up -d`; **never** use `down -v` as a deployment or
  port-change step.
- Roll back by rebuilding the previous commit/digest and running `up -d` again. Data rollback
  rides on snapshot restore into a new branch — alias switching is not a data merge.
- Base images and the Caddy gateway are digest-pinned. Rotate pins only after pulling and
  verifying locally (`docker pull`, compare the digest against upstream). Rebuild with
  `docker build --no-cache -f infra/Dockerfile .` if needed, and rescan before adopting.

## 9. Validation before go-live

- `docker compose -f compose.yml -f compose.selfhost.yml --profile selfhost config` passes
  (all required interpolation errors gone).
- From the repository: `bun run test:compose` proves a clean container boot, owner setup,
  migration, exposure, per-operation policies, realtime durability and storage against the
  Compose stack.
- From `infra/Dockerfile`: `bun run verify:linux` runs the repository quality gates inside
  the container.
- `/ready` succeeds over both `https://api.…/ready`; Studio and Docs load through HTTPS with
  valid certificates.
