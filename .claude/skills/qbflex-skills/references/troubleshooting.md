# Diagnose failures

Start with `scripts/diagnose.mjs --directory <target>`. It is read-only and redacted. Preserve request ID, code/status and project/branch identifiers in an incident report; never attach raw authorization headers, cookies, `.env` contents or secrets.

| Symptom | Check and next action |
| --- | --- |
| Missing configuration | Check presence of URL/project/branch/publishable key; inspect safe `qb.json` fields and installed versions. Supply only the missing configuration; don't replace an existing `.env`. |
| Studio `API unavailable: Failed to fetch` | Confirm the API is listening, then check browser Origin against `QB_ALLOWED_ORIGINS`. `localhost` and `127.0.0.1` are different origins; local allowlists mirror both automatically. Retry after the API reloads. |
| Native startup port conflict / missing worker token | Check whether the full local Compose profile already owns 7610–7612. Use that stack or stop only `studio docs api worker` before `bun run dev`; preserve volumes. The launcher requires its API's credential, not a different installation's readiness response. For an independent worker, start the API first with the same `QB_DATA_DIR` or configure matching server-only `QB_WORKER_TOKEN` values. Never fabricate or log the token. See `tests/dev-startup.test.ts`. |
| Successful login returns to Studio sign-in | Check matching loopback hosts and browser cookies. Studio verifies its cookie before navigation; blocked cookies remain a sign-in error, while API failures show a retry screen. Remote hosts and passkey RP hostnames require correct explicit configuration. |
| No color / missing routine poll lines | Auto output is pretty only in development terminals; production/pipes use JSON. Use `QB_LOG_FORMAT=pretty`, honor `NO_COLOR`/`FORCE_COLOR`, and set `QB_LOG_INTERNAL=true` for successful job polling. Failures and metrics remain visible. |
| Workspace avatar/archive unavailable | Confirm the API migration is present and admin MFA requirements if production. Avatar image accepts PNG, JPEG or WebP data under 1.5 MiB. Workspace deletion requires owner role and will remove all project branches and storage for that workspace only. |
| Workspace switcher appears unexpectedly | A workspace has not been selected or the current selection is unavailable. Choose a listed workspace or create one. |
| 401 / wrong realm or branch | Confirm project/immutable branch, correct key, application vs platform session, audience and revocation. Sign in in the correct realm; don't substitute a service key into a browser. |
| Empty rows/count | Confirm exposure/column allowlist and applicable SELECT policies with the actual identity. Default denial is expected; verify the new-row ownership check separately. |
| Hidden column / unsupported relationship | Regenerate exposed types and inspect approved linking columns/target exposure. Do not bypass validation with raw SQL or widen types. |
| Schema/version conflict | Refresh `/schema`, generated types and query cache; inspect migration ID/checksum and configuration If-Match version. Review a new migration instead of reusing an altered migration ID. |
| Expired/invalid cursor | Discard cursor, requery the same authorized scope from page one. Realtime onResync needs a fresh snapshot before continued events. Never transplant cursors across identity or branches. |
| Revision conflict | Read current row, compare the user's change, then submit an intentional mutation with the current revision. Avoid automatic overwrite. |
| Timeout / uncertain commit | Keep the original idempotency key and reconcile row/operation state before retrying; an aborted HTTP request does not prove rollback. |
| QUEUE_FULL / OWNER_UNAVAILABLE / quota | Inspect private metrics, disk/WAL, pending operations and bounded limits; shed workload and back off. Restart only within authorization and preserve persistent data. |
| Missing QBProvider | Wrap all hooks in QBProvider with a stable client; hooks cannot run in a disconnected component tree. For SSR use a client/cache per request. |
| Stale protected UI | Forward query signals, use complete explicit keys/invalidation, clear derived state on identity change and unsubscribe duplicate effects. Test Strict Mode and reconnect. |
| OAuth / email failure | Verify provider (Resend API key) or SMTP presence, exact callback/reset origins, credential validity and delivery errors without logging values. Missing external configuration is not a platform authorization bypass. |
| STORAGE_UNCONFIGURED / incomplete upload | Configure S3 endpoint/bucket/region and credentials, inspect intent status/size/MIME rules, then supported reconciliation. Incomplete metadata remains unreadable. Restore object bytes separately from PGlite. |
| Encrypted restore fails | Verify archive checksum/schema and original master key custody; restore isolated first. Catalog archives do not contain branch files or S3 bytes. Don't overwrite the active owner or fabricate a new key. |

Use [generated API/CLI](generated/api.md) and [operations](operations.md) to distinguish supported recovery from planned features. If source differs from bundled 0.1.0 contracts, record the mismatch, refresh references and run the relevant regression gate before claiming compatibility.
