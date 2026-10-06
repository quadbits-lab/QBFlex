---
name: qbflex-skills
description: Build applications with QB Flex, contribute to its Bun platform, and diagnose or operate self-hosted deployments. Use for QB Flex schema, policies, REST, React providers/hooks, Vanilla JavaScript SDK, realtime, storage, CLI, Studio, Docs, security, backups or recovery work. Guidance and portable examples are verified against QB Flex 0.1.0; verify other versions before claiming compatibility.
metadata:
  version: "0.1.0"
  product: "QB Flex"
  compatibility: "QB Flex 0.1.0"
---

# QB Flex development

Produce a working, tested change using the installed contracts. This skill covers application
development and platform contributions. It requires ordinary filesystem, shell and HTTP tools;
no proprietary connector, MCP service or globally installed skill is required.

## Establish the target

1. Identify the repository or application root and version from package manifests, lockfiles
   and installed SDKs. Run `node <skill-dir>/scripts/diagnose.mjs --directory <target>` for
   a read-only, redacted inventory. For this repository, inspect source and executable tests.
   If the version differs from 0.1.0, compare contracts and rerun relevant checks first.
2. Resolve the API URL, project, immutable branch ID (or intended `primary` alias), existing
   schema/exposure, generated types and available features. Inspect `qb.json`, environment
   variable **presence**, `/schema` and project configuration with authorized credentials.
   Resolve discoverable facts before asking for missing choices.
3. Identify the credential realm: application session plus publishable key for browser data;
   platform session/scoped management token for configuration; explicitly scoped service key
   only in trusted server code. Never copy service/management credentials into examples.
4. Read the relevant reference below. Implemented source and tests override stale prose;
   the development spec describes intent and includes future features.

## Route the task

| Task | Load |
| --- | --- |
| Architecture, limits, P0/P1/P2 | [Architecture and availability](references/architecture.md), [generated contracts](references/generated/api.md) |
| Schema, queries, mutations, policies, RPC | [Application development](references/application.md), [security](references/security.md) |
| React application | [React SDK](references/react.md), [example prerequisites](assets/examples/README.md), [generated SDK](references/generated/sdk.md) |
| Vanilla JavaScript application | [Vanilla SDK](references/vanilla.md), [example prerequisites](assets/examples/README.md), [generated SDK](references/generated/sdk.md) |
| Local setup, deployment, CLI, recovery | [Operations](references/operations.md), [generated CLI](references/generated/cli.md) |
| API/worker/SDK/Studio/Docs contribution | [Platform contributions](references/platform.md), [validation evidence](references/verification.md) |
| Errors, configuration, providers, recovery | [Troubleshooting](references/troubleshooting.md), [security](references/security.md) |

## Execute and verify

For applications, apply reviewed migrations, explicitly expose allowed columns, create separate
read/write ownership policies, regenerate types and then implement SDK calls. Start from the
bundled React or Vanilla task workflow. Test with two application users and a separate branch;
positive UI behavior alone does not establish authorization correctness.

For platform changes, inspect the shared contracts and policy engine before editing transport
code. Keep REST, counts, returned mutation rows, relationships, RPC and realtime authorization
consistent. Add regression coverage at the layer that previously allowed the defect. Update
Docs and this skill alongside public behavior. See the validation reference for specific gates.

For operations, inventory the deployment, backup scope and required keys first. A skill invocation
does not authorize unrelated deletion, reset, credential revocation, cutover, external publication
or registry release. Complete non-destructive preparation and validation within the user's scope;
require explicit authorization for an otherwise unauthorized destructive action. Do not add
confirmation steps to actions the user already authorized. Database snapshots, object bytes and
master-key custody require separate recovery procedures.

End with the concrete changed behavior, checks actually run and their results, and remaining
configuration or unverified compatibility. Report skipped workflows explicitly. Do not promise
flawless execution or label planned features as working.

## Maintenance and portability

Repository commands: `bun run skill:refresh`, `bun run skill:check`, `bun run skill:test`,
`bun run skill:pack`. Refresh rebuilds generated source summaries and provenance; check detects
drift without rewriting. Test compiles packed SDK consumers, verifies portable examples against
isolated services and runs the platform security/lifecycle suite. Pack validates before archiving.

[Installation](INSTALL.md) describes project-local discovery and detached use.
[MANIFEST.json](MANIFEST.json) records version, source provenance and SHA-256 file checksums.
Keep curated security explanations reviewed separately from generated references.
