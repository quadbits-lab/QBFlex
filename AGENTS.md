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
