# Client SDK release runbook

QB Flex ships two public web SDK packages in lockstep:

- `@qb-flex/client` is the framework-independent ESM client.
- `@qb-flex/react` is the React 19 adapter and declares the matching client as a peer.

The management client remains private, and the React Native package described by specification 1.1 is not implemented. Publishing these two web packages is therefore a web-SDK release, not completion of the expanded release.

## One-time npm setup

1. Confirm that the npm account or organization owns the `@qb-flex` scope and that the two package names are available. An HTTP 404 from `npm view` shows that a package is not publicly visible; it does not prove that the signed-in account controls the scope.
2. Decide and record the package license before the first publish. The private repository currently has no license file, so release owners must not infer an open-source license.
3. Enable npm two-factor authentication. For automated releases, prefer npm trusted publishing with short-lived OIDC credentials; provenance is unavailable for private source repositories even when the package is public.
4. Authenticate locally with `npm login`, then verify the intended identity and registry:

   ```sh
   npm whoami
   npm config get registry
   ```

The package manifests pin publication to `https://registry.npmjs.org/` and public access. Scoped packages need public access on their first publication.

## Version policy

Both public packages use the same exact version. Follow semantic versioning:

- patch: backward-compatible fixes (`0.1.0` → `0.1.1`);
- minor: backward-compatible features (`0.1.1` → `0.2.0`);
- major: breaking public API changes once the SDK reaches `1.x`.

While the packages are below `1.0.0`, the React peer range `^0.1.0` intentionally accepts patch updates in the same `0.1` line, not `0.2.0`. Prereleases such as `0.2.0-rc.1` publish to `next` by default; stable versions publish to `latest`.

Set a version with:

```sh
bun run sdk:version 0.1.1
```

Review the manifest diff and document user-visible changes before committing. npm versions are immutable: never reuse a version, and deprecate a bad release instead of deleting history except for an immediate security incident handled under npm policy.

## Validate and publish

Run the repository gates from a clean checkout:

```sh
bun run sdk:release:check
bun run sdk:publish
```

`sdk:publish` is dry-run by default. It rebuilds the tarballs, installs them with npm in an isolated application, typechecks declarations without `skipLibCheck`, runs React SSR plus the client workflow under Node, and asks npm to inspect both tarballs without changing registry state.

After the dry run and the relevant repository gates pass, commit the version/release notes and create a reviewed release tag. Then publish the already validated package pair:

```sh
bun run sdk:publish -- --execute
```

To override the default distribution tag or request provenance in a supported public CI environment:

```sh
bun run sdk:publish -- --tag next --execute
bun run sdk:publish -- --provenance --execute
```

The command publishes the client first and React second because React peers on the client. npm cannot make two package publishes atomic. If the second publish fails, do not republish or overwrite the client version; fix the release condition and publish the matching React version.

## Post-release checks

Verify registry metadata and install the exact versions into a clean application:

```sh
npm view @qb-flex/client@0.1.1 version dist-tags --json
npm view @qb-flex/react@0.1.1 version peerDependencies dist-tags --json
npm install @qb-flex/client@0.1.1 @qb-flex/react@0.1.1
```

Tag the repository only for the version actually published, preserve the generated tarball checksums in release records, and keep the previous supported line available. Security fixes should state affected versions and upgrade guidance. Do not move `latest` to a prerelease; use `next`, `beta`, or another explicit channel.

Useful npm references: [publishing scoped packages](https://docs.npmjs.com/cli/v11/using-npm/scope/), [semantic versioning](https://docs.npmjs.com/about-semantic-versioning/), [two-factor publishing](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/), and [trusted publishing](https://docs.npmjs.com/trusted-publishers/).
