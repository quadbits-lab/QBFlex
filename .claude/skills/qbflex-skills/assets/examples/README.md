# React and Vanilla task workflows

Both applications implement application signup/login, protected task reads/create/update/delete,
authorized realtime invalidation, and private attachment upload/download/delete. React uses a
stable typed client, QBProvider and all custom hooks. Vanilla uses ordinary DOM APIs, session
observation, cancellation and explicit disposal. These files are portable and contain no credentials.

## Prerequisites

Use QB Flex 0.1.0 with an authorized project/branch and configured S3 backend. In a new disposable
project apply [schema.sql](schema.sql) through a named migration. Review
[prerequisites.json](prerequisites.json): expose only its listed task columns, create each of its
four ownership policies, and register the reviewed `create_task` RPC. Create its private attachment
bucket. Do not apply a tutorial migration over an existing incompatible table.

The Management API paths, prefixed by `/management/v1/projects/PROJECT_ID/branches/BRANCH_ID`,
are `POST /migrations` with `{id,sql}`, `PUT /exposure/tasks`, `PUT /policies` for each policy,
`PUT /rpc` with the reviewed RPC definition, and `POST /buckets`. Authenticate with a platform
session or scoped management token; keep that credential outside the browser. Obtain a project
publishable key and authorize exact origins `http://localhost:7617` and `http://localhost:7618`.

Generate types with `bun run qb types generate --project PROJECT_ID --branch BRANCH_ID --output
src/qb-flex.types.ts` from the source checkout, targeting each example's source directory. Bundled
[React types](react/src/qb-flex.types.ts) and [Vanilla types](vanilla/src/qb-flex.types.ts) are generated
from these prerequisites. Regenerate when your exposed schema or RPC changes.

## Install and run with local SDK packages

In the QB Flex source checkout run `bun run sdk:pack`. Copy its client/react tarballs somewhere
accessible to the extracted examples. From each example directory use the actual tarball paths:

```sh
# React directory; both tarballs are supplied in the same install.
npm install --ignore-scripts --no-audit --no-fund /path/to/qbflex-client-0.1.1.tgz /path/to/qbflex-react-0.1.1.tgz
npm run typecheck
npm run dev
```

```sh
# Vanilla directory.
npm install --ignore-scripts --no-audit --no-fund /path/to/qbflex-client-0.1.1.tgz
npm run typecheck
npm run dev
```

These commands install pinned example dependencies and add local SDK dependencies to the private
example manifest. They do not publish anything. Node must meet the pinned Vite runtime requirements
(use Node 22.12+ or Bun 1.4.2). `npm run build` produces an independently hostable static app.
The repository itself continues to use Bun workspaces; these examples use npm to verify real
packed artifacts without workspace resolution.

## Walk through the application

Enter URL, project ID, immutable branch ID (or intended `primary`) and publishable key from your
configuration. The supplied `config.example.json` is a placeholder inventory; forms do not read
secrets from it. Register an application user, create a task, toggle completion, and delete it.
Sign out, then sign in again to verify shared session updates. If registration requires verification,
complete it before protected access. A platform administrator account is a different realm.

Enter the private bucket ID and upload a small text file, download it and compare its bytes, then
delete it. Use a second browser user to verify task counts/rows and private files stay isolated.
Create a task with a second authenticated client for the same user to verify authorized realtime
updates. Interrupt/reconnect the network; the onResync handler refetches a protected snapshot.
Never render secret error payloads or replace policy failures with service credentials.

## Direct browser module

The Vanilla example includes a compiled 0.1.0 browser client in `vendor/client.js`, generated from
the same source as the packaged SDK. Serve `vanilla/` with a static HTTP server and open
`/direct/index.html`; `direct/main.js` imports that ESM module directly, with no Vite or React.
For example run `python3 -m http.server 7618 --bind 127.0.0.1` in `vanilla/`. Use the same exact
origin, configuration and prerequisites. Do not open the page with file://.

On teardown React subscription effects clean up and the application owner disposes a replaced
client. Vanilla aborts reads, unsubscribes auth/realtime and disposes on pagehide. The skill test
builds these applications outside the repository and verifies their workflows against isolated API
fixtures; external OAuth credentials and cloud S3 compatibility need separate configuration/testing.
