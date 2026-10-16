# API and capability summary

Generated from shared QB Flex 0.1.0 contracts. This is the route registry; request shapes and identity requirements remain defined by source and the curated references.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Health operation |
| GET | `/ready` | Ready operation |
| GET | `/setup` | Setup operation |
| POST | `/setup` | Setup operation |
| GET/POST | `/platform/auth/*` | * operation |
| GET | `/platform/avatars/{userId}` | Read platform avatar |
| POST | `/platform/avatar` | Upload platform avatar |
| DELETE | `/platform/avatar` | Remove platform avatar |
| GET | `/management/v1/capabilities` | Feature availability |
| GET | `/management/v1/organizations` | List organizations |
| POST | `/management/v1/organizations` | Create organization |
| GET | `/management/v1/organizations/{id}` | Read workspace |
| PATCH | `/management/v1/organizations/{id}` | Update workspace |
| POST | `/management/v1/organizations/{id}/archive` | Archive workspace |
| POST | `/management/v1/organizations/{id}/unarchive` | Restore workspace |
| DELETE | `/management/v1/organizations/{id}` | Delete workspace |
| GET | `/management/v1/organizations/{id}/members` | Members operation |
| POST | `/management/v1/organizations/{id}/members` | Members operation |
| POST | `/management/v1/invitations` | Invitations operation |
| POST | `/management/v1/tokens` | Tokens operation |
| GET | `/management/v1/tokens` | Tokens operation |
| DELETE | `/management/v1/tokens/{token}` | Token operation |
| GET | `/management/v1/projects` | List projects |
| POST | `/management/v1/projects` | Provision project |
| PATCH | `/management/v1/projects/{id}` | Update project name and region |
| DELETE | `/management/v1/projects/{id}` | Delete project and its artifacts |
| GET | `/management/v1/operations/{id}` | Operation status |
| POST | `/management/v1/operations/{id}/cancel` | Cancel before provisioning starts |
| GET | `/management/v1/projects/{id}/branches` | List branches |
| GET | `/management/v1/projects/{id}/keys` | List keys |
| POST | `/management/v1/projects/{id}/keys` | Create key |
| DELETE | `/management/v1/projects/{id}/keys/{key}` | Key operation |
| GET | `/management/v1/projects/{id}/config` | Config operation |
| PUT | `/management/v1/projects/{id}/config` | Config operation |
| PUT | `/management/v1/projects/{id}/secrets/{name}` | Name operation |
| GET | `/management/v1/projects/{id}/secrets` | Secrets operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/schema` | Inspect schema |
| GET | `/management/v1/projects/{id}/branches/{branch}/data/{table}` | Table operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/data/{table}` | Table operation |
| PATCH | `/management/v1/projects/{id}/branches/{branch}/data/{table}/{key}` | Key operation |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/data/{table}/{key}` | Key operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/migrations` | Migrations operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/migrations` | Apply migration |
| POST | `/management/v1/projects/{id}/branches/{branch}/sql` | Execute privileged SQL |
| GET | `/management/v1/projects/{id}/branches/{branch}/policies` | Policies operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/webhooks` | Webhook metadata |
| GET | `/management/v1/projects/{id}/branches/{branch}/security` | Security Advisor findings |
| POST | `/management/v1/projects/{id}/branches/{branch}/security/{finding}/acknowledge` | Acknowledge current finding with expiry |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/security/{finding}/acknowledge` | Clear finding acknowledgment |
| POST | `/management/v1/projects/{id}/branches/{branch}/webhooks` | Create scoped webhook |
| POST | `/management/v1/projects/{id}/branches/{branch}/webhooks/{webhook}/state` | Pause, resume or revoke webhook |
| POST | `/management/v1/projects/{id}/branches/{branch}/webhooks/{webhook}/rotate` | Rotate webhook signing secret |
| GET | `/management/v1/projects/{id}/branches/{branch}/jobs` | List private job metadata |
| GET | `/management/v1/projects/{id}/branches/{branch}/jobs/{job}` | Job attempt history |
| POST | `/management/v1/projects/{id}/branches/{branch}/jobs/{job}/cancel` | Cancel unsent job work |
| POST | `/management/v1/projects/{id}/branches/{branch}/jobs/{job}/replay` | Explicit dead-letter replay |
| PUT | `/management/v1/projects/{id}/branches/{branch}/policies` | Save policy |
| POST | `/management/v1/projects/{id}/branches/{branch}/policies/test` | Test operation |
| PUT | `/management/v1/projects/{id}/branches/{branch}/exposure/{table}` | Configure exposure |
| PUT | `/management/v1/projects/{id}/branches/{branch}/relationships` | Relationships operation |
| PUT | `/management/v1/projects/{id}/branches/{branch}/rpc` | Rpc operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/rpc` | Rpc operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/types` | Types operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/users` | Users operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/users` | Users operation |
| PATCH | `/management/v1/projects/{id}/branches/{branch}/users/{user}` | Users operation |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/users/{user}` | Users operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/users/{user}/ban` | Users operation |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/users/{user}/ban` | Users operation |
| PUT | `/management/v1/projects/{id}/branches/{branch}/users/{user}/roles` | Users operation |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/users/{user}/sessions` | Sessions operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/roles` | Roles operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/roles` | Roles operation |
| PATCH | `/management/v1/projects/{id}/branches/{branch}/roles/{role}` | Roles operation |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/roles/{role}` | Roles operation |
| GET | `/management/v1/projects/{id}/backups` | Backups operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/backups` | Backups operation |
| POST | `/management/v1/projects/{id}/backups/{backup}/restore` | Restore operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/cutover` | Cutover operation |
| GET | `/management/v1/audit` | Audit operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/buckets` | Buckets operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/buckets` | Buckets operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/buckets/{bucket}/objects` | Objects operation |
| POST | `/management/v1/projects/{id}/branches/{branch}/buckets/{bucket}/objects` | Objects operation |
| PUT | `/management/v1/projects/{id}/branches/{branch}/objects/{object}/content` | Content operation |
| GET | `/management/v1/projects/{id}/branches/{branch}/objects/{object}/content` | Content operation |
| DELETE | `/management/v1/projects/{id}/branches/{branch}/objects/{object}` | Object operation |
| GET/POST | `/v1/projects/{projectId}/branches/{branchId}/auth/*` | * operation |
| POST | `/v1/projects/{projectId}/branches/{branchId}/rpc/{operation}` | Operation operation |
| GET | `/v1/projects/{projectId}/branches/{branchId}/schema` | Exposed schema |
| GET | `/v1/projects/{projectId}/branches/{branchId}/openapi.json` | Generated OpenAPI |
| GET | `/v1/projects/{projectId}/branches/{branchId}/data/{table}` | Read authorized rows |
| POST | `/v1/projects/{projectId}/branches/{branchId}/data/{table}/query` | Structured query |
| POST | `/v1/projects/{projectId}/branches/{branchId}/data/{table}` | Insert rows |
| POST | `/v1/projects/{projectId}/branches/{branchId}/data/{table}/upsert` | Upsert operation |
| PATCH | `/v1/projects/{projectId}/branches/{branchId}/data/{table}/{key}` | Update row |
| DELETE | `/v1/projects/{projectId}/branches/{branchId}/data/{table}/{key}` | Delete row |
| GET | `/v1/projects/{projectId}/branches/{branchId}/storage/buckets` | Buckets operation |
| GET | `/v1/projects/{projectId}/branches/{branchId}/storage/buckets/{bucket}/objects` | Objects operation |
| POST | `/v1/projects/{projectId}/branches/{branchId}/storage/buckets/{bucket}/objects` | Objects operation |
| PUT | `/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}/content` | Content operation |
| GET | `/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}/content` | Content operation |
| DELETE | `/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}` | Object operation |
| WS | `/v1/projects/{projectId}/branches/{branchId}/realtime` | Authorized row subscriptions |

## Availability

- **organizations:** available
- **projects:** available
- **database:** available
- **rest:** available
- **policies:** available
- **auth:** available
- **realtime:** available
- **storage:** configured
- **backups:** available
- **graphql:** planned
- **branching:** planned
- **functions:** planned
- **ai:** planned
- **mcp:** planned
- **replicas:** planned
- **jobs:** experimental
- **recoveryCenter:** planned
- **securityAdvisor:** experimental
- **operationsDashboard:** planned
- **queryInspector:** planned
- **schemaReviews:** planned
- **previews:** planned
- **webhooks:** experimental
- **dataLab:** planned
- **search:** planned
- **nativeSDK:** planned
- **push:** planned
