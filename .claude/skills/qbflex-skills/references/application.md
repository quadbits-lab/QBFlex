# Build an application

## Establish schema and policies first

Inspect existing migrations and schema rather than creating competing tables. Apply a named, reviewed migration through Management API or `qb db migrate --file <sql> --id <migration> --project <id> --branch <id>`. Migration IDs/checksums are replay-sensitive. Author structural changes in migrations; avoid destructive reset of existing data. Explicitly enable table exposure with a column allowlist. Hidden columns must stay unavailable in filters, projections, OpenAPI, generated types, relations and realtime payloads.

Create separate `select`, `insert`, `update`, `delete` policies. With `owner_id`, use `{"op":"eq","left":{"column":"owner_id"},"right":{"claim":"sub"}}`. Include verified `authenticated` role; inserts/updates must also check the actual new row. Permissive grants OR together and restrictive checks AND together; absent grants deny. Reads/counts/pagination apply policies before returning results. A mutation can commit yet return no rows if select access is absent. Do not infer write success from returned row count alone.

The complete [task prerequisites](../assets/examples/README.md) bundle migration, exposure, four ownership policies and reviewed RPC configuration. Test anonymous, owner and another user; attempt ownership reassignment and filtering a hidden column. See [security evidence](verification.md).

## Generated types and reads

Run `qb types generate --project <id> --branch <id> --output src/qb-flex.types.ts` after schema, exposure or RPC changes. Import generated `Database` and `RPC` into `createClient<Database,RPC>`. Never manually widen types to expose hidden fields or hide errors with `any`. React callbacks should close over that typed client or use `useQBClient<Database,RPC>()`.

Use `from('tasks').select(['id','title']).eq('completed',0).order('id','asc').limit(50).execute()`. Projection and mutation variables retain generated types. The full builder/operation signatures are in [SDK declarations](generated/sdk.md). Always propagate an AbortSignal for replaceable reads. Store `meta.cursor` for the next page with the same query; cursors bind query, schema, identity and branch. After invalidation/expiry/schema or identity changes discard the cursor and restart from page one. Keyset pagination is not arbitrary offset pagination.

## Serialization

Safe SQLite integers are numbers; larger 64-bit integers are decimal strings. Generated integer fields consequently use `number | string`: convert only after checking bounds. BLOBs are base64 strings, JSON columns retain text semantics, booleans are 0/1 and nullable fields use null. CHECK enum constraints appear in generated types. Do not coerce every number/string globally or treat JSON text as an already parsed object.

## Mutations, revisions and retries

Insert/upsert accept rows or atomic batches up to 100. Update/delete accept a primary key (composite keys use the declared tuple). Use `revision` for optimistic concurrency where the exposed table has a revision column; a conflict means reread and resolve, not overwrite blindly. Policies evaluate old and actual prospective rows within the transaction. Upsert enforces the insert or update path selected by the conflict; partial success is not allowed for an atomic batch.

Generate one idempotency key per logical mutation and retain it across retries. The SDK safely retries reads and eligible keyed mutations; unkeyed writes are not automatically replayed. Cancellation/timeouts or owner death can leave commit status uncertain. Reconcile by the original key and row state before initiating another logical write. Large imports are separate 100-row transactions; the entire CLI import is not one atomic transaction.

## Approved relationships and RPC

Relationships must be registered, use valid foreign-key/linking columns, and reference exposed targets. Use `include([{name:'approved_name',columns:['id'],limit:20}])`. Related results and `exists` expressions apply target SELECT policies. `{"op":"exists","relationship":"approved_name","where":{"op":"true"}}` is implemented; unapproved names, cycles and excessive nesting fail. Existence policy support is distinct from one-level response expansion limits.

Reviewed RPC definitions describe query/insert/update/delete operations with declared arguments, table and expressions/values. Call only registered names via `client.rpc('create_task',{title})`. Claims come from the server; passing SQL or undeclared arguments is rejected. These are structured shared-engine operations, not arbitrary SQL, user-uploaded JavaScript or P1 functions.
