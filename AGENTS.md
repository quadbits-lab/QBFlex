<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific skill; load additional skills only when the task spans their concerns.
<!-- intent-skills:end -->

## QB Flex development

For applications using QB Flex, platform contributions, operations or debugging, load
[qbflex-skills](.claude/skills/qbflex-skills/SKILL.md) and only the references relevant to the task.
Its contracts describe QB Flex 0.1.0. Verify source or installed versions before using examples.
Run `bun run skill:check` after skill or source-contract changes; refresh generated references
with `bun run skill:refresh` and verify behavior with `bun run skill:test` before packaging.
Preserve inherited instructions above. Skill invocation does not expand the user's authorization.

## Documentation is part of every change

Keep `apps/docs` current in the same change as newly developed features, fixes, UI workflows,
SDK/API/CLI contracts, environment variables and deployment behavior. Review source and tests
before documenting availability: distinguish available, experimental, configured and planned
capabilities, and never claim provider/device certification from mocks. Update affected guides,
typed examples, limitations, security/recovery notes and Studio contextual Help links.

The root development specification is the source for its generated Docs mirror. Edit that
source, not the generated reference pages. Run `bun run sdk:build` when declarations change,
then `bun run docs:generate`, `bun run docs:check`, `bun scripts/docs-examples.ts` and the Docs
production build (`bun run --cwd apps/docs build`). These checks cover generated references,
navigation/search metadata, links and examples; refresh/check QB Flex skills when their source
contracts change. Documentation updates do not authorize publication or external deployment.
