# Install or use the portable skill

The canonical repository copy is `.claude/skills/qbflex-skills`. The archive contains a single
`qbflex-skills/` directory with its entrypoint, Codex metadata, references, helpers, examples
and checksum/provenance manifest. Extract it anywhere; no authoring skill or original repository
is needed to read guidance, diagnose an application or run the examples with packaged SDKs.

Claude-compatible agents discover project skills under `.claude/skills/`; invoke
`/qbflex-skills` where slash-command skills are supported. Codex-compatible agents use
`.agents/skills/`; copy the extracted directory there **inside the target project** and invoke
`$qbflex-skills`. Its `agents/openai.yaml` enables implicit invocation. Discovery behavior
depends on agent version; reload the project's skill inventory after copying. Other agents can
read `SKILL.md` directly and follow its relative links. No global installation is performed.

In the QB Flex source repository use the `AGENTS.md` pointer to the canonical copy. Do not keep
two independently edited copies. For an application repository copy the complete directory;
do not copy only the entrypoint.

Verify extracted contents with:

```sh
node qbflex-skills/scripts/check-package.mjs qbflex-skills
node qbflex-skills/scripts/diagnose.mjs --directory ./your-application
```

Diagnostic output contains presence/status, never credential values; it performs no network
requests unless an explicit `--probe-url http://localhost:7612` is supplied. It does not load
application modules, mutate configuration, install packages or read master-key files.

The examples require QB Flex 0.1.0 and local SDK tarballs. Follow their
[setup guide](assets/examples/README.md). Browser packages are not assumed to have been
published to npm. Helpers need Node 22+ or Bun; source-reference refresh and repository
verification need the pinned repository Bun runtime and dependencies. Offline checksum
verification and diagnostics use only Node built-ins.

To refresh references from an available QB Flex source checkout, the bundled generator is
`bun scripts/refresh.ts --source-root <checkout> --skill-dir <extracted-skill>`; add `--check`
to detect drift. Run it with the checkout's pinned Bun runtime/dependencies. It uses platform
source/build tooling, not the original skill-creation tools. The portable archive builder is
`node scripts/pack.mjs <skill-directory> <output.zip>` and validates before writing.
