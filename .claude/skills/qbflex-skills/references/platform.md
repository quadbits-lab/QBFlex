# Contribute to the platform

## Start with the owning contract

Locate the existing route/type/error in `packages/contracts`, implementation in `apps/api` and owner operation in `packages/database`. Transport handlers should validate input and dispatch, not invent a parallel policy engine. Database/query/policy changes must preserve parameterized SQL, exposure checks, transaction boundaries, precision serialization, signed cursors and transactional outbox behavior. Keep counts, returned rows, related reads, RPC and events under the same authorization rules.

Worker changes must retain private authentication, bounded jobs, leases, cleanup and retention; owner timeouts/crashes must reject uncertain calls and preserve acknowledged durability. Avoid enabling P1 adapters as a side effect of compatibility spikes. Add/update the capability registry only when the feature and its release tests exist.

For SDK changes inspect generated declarations and packed consumers, preserving browser ESM and React-free Vanilla packages. React changes must retain provider boundaries, identity-scoped caches, cancellation, request-local SSR and subscription cleanup. Maintain shared-client behavior across both adapters. Regression tests should reproduce an observable security/lifecycle defect, not mirror implementation details.

## Studio, UI, branding and Docs

Follow inherited `AGENTS.md` TanStack Intent instructions: list local skills before substantial edits and load the package-specific skill relevant to the change. TanStack Start is isomorphic by default; keep private server work behind authenticated server functions/routes. Create request-local routers/caches and maintain hydration behavior. Shared `packages/ui` owns branding and components; use the supplied assets in their actual format and proportions. Section/navigation icons should remain accessible, decorative icons aria-hidden, and mobile drawers keyboard-operable.

Docs is independently deployable `apps/docs`, with repository-owned MDX, generated heading/search metadata, static prerendering, code-copy controls and shared UI. Update the relevant implemented guide and Studio Help route. Future architecture explanations must be marked planned and must not contain runnable examples implying support. Update code examples with actual declarations, not permissive fixtures hiding type incompatibilities. Run `docs:generate`, `docs:check` and the MDX example checker after public changes.

## Skill maintenance

`bun run skill:refresh` builds SDK declarations, extracts API routes/capabilities, SDK declarations, CLI help and test evidence, regenerates example database/RPC types from the bundled schema and updates source/file checksums. Curated security guidance remains a human-reviewed reference. `skill:check` compares generated output and provenance without rewriting, validates metadata and all local links, checks bundled imports/files and rejects missing/extra/tampered files. `skill:test` verifies detached checks/diagnostics, actual packaged SDK declarations/types, builds both portable applications, exercises isolated workflows and runs existing platform/lifecycle regression tests. It reports missing S3 configuration instead of claiming transfer verification.

`skill:pack` validates the bundle and writes a deterministic `dist/skills/qbflex-skills.zip` with one root directory. Archive extraction and checksum verification must work outside the source checkout. Never include `.env`, node_modules, raw credentials, personal filesystem paths or authoring-skill files. The bundle documents 0.1.0; changed compatibility requires refreshed sources and validation, not just editing a version label.

Finish with changed behavior, relevant passing checks, skipped/unverified paths and any required environment configuration. Local packaging and review are distinct from external deployment, publication and registry release.
