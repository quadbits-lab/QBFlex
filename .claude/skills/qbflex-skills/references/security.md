# Security practices

Every change must preserve the existing authorization boundary. Read [verification evidence](verification.md), which identifies the executable tests supporting these rules. Explanatory guidance is curated; generated route lists alone cannot prove security.

## Identity and credentials

Platform organization roles are owner/admin/developer/viewer; they are separate from application-user claims. Platform sessions and scoped management tokens configure projects; project/branch sessions access application data. Never use one realm's bearer token in another realm. Administrative production writes require MFA; local development configuration is not a production bypass recommendation.

A publishable key identifies a project and does not grant row access. Authenticated access still needs applicable policies. Service credentials belong only in trusted server code, with explicit branch/table/method scopes and audited bypass behavior. Browser Origin requests with service keys are rejected. Do not embed a service/management key in VITE_ variables, generated static files, client bundles, URLs or screenshots. The diagnostic helper checks presence and suspicious browser variable names without printing values.

Supply required secrets through protected files or deployment secret storage. Keep master/bootstrap/worker/S3/SMTP/provider credentials out of version control, logs and shell arguments; avoid echoing secret values. CLI secret setting uses an environment variable name, not the literal secret. Never read/print an entire `.env` or master.key while diagnosing missing configuration. Inspect status/presence. Server logs use allowlisted fields; ensure tests catch tokens/passwords/provider responses leaking through errors.

## Data and policy boundaries

Default-private exposure and column allowlists apply to reads, filters, generated descriptions/types, counts, relationships, mutation returns and realtime. Row-policy predicates use server-verified sub/role claims. For ownership writes check actual defaults and prospective rows, not just submitted fields; never authorize solely by a client-supplied owner_id. Updates need old-row access plus new-row check to prevent reassignment. Upsert and RPC must use the same policy engine. Related existence predicates include target SELECT policies and traversal guards.

Counts and cursors must not reveal another user's hidden rows. Cursors bind identity/schema/branch/query and are signed/expiring. Realtime checks current policies and identity on delivery, including deletion/visibility-loss events. A previously unreadable row emits no unauthorized event; visibility loss carries only the authorized key. Session revocation affects HTTP and sockets. Browser screen guards improve UX but do not authorize API access.

## Network, storage and operators

Use exact origins including scheme and port, no wildcard credentialed CORS. Validate callback/reset origins and configure Google/GitHub providers explicitly. Private storage authorizes metadata and bytes; public-read buckets are an intentional exposure choice. Uploads enforce size/MIME and finalize verified bytes before download. Recover pending objects via supported reconciliation rather than manually making metadata readable.

SQL console, direct SQLite files and privileged management paths are trusted administrative access; application row policies do not protect against a filesystem operator. Maintain one writable API owner, local disk and least-privilege containers. Keep internal metrics/worker endpoints private and worker-token protected. Apply [backup/master-key custody](operations.md) separately from object-store protection.

A skill invocation does not grant permission to reset data, revoke unrelated credentials, switch production primary, deploy/publish externally or release npm packages. Prepare and verify within the user's authorized scope; ask only for a concrete otherwise unauthorized irreversible action.
