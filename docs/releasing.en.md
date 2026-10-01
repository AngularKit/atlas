# Publish an npm release

[Français](releasing.md) · **English**

`@angularkit/atlas@0.1.0` was published on October 1, 2026 from the CI archive. Subsequent releases are published automatically by `.github/workflows/publish.yml` when a stable `vX.Y.Z` tag is pushed. Creating the tag is the decision to publish, after review and merge into `main`; ordinary branch pushes and pull requests do not publish packages.

## One-time npm setup

In the [package settings](https://www.npmjs.com/package/@angularkit/atlas/access), add a **Trusted Publisher → GitHub Actions** connection:

| Field | Value |
|---|---|
| Organization or user | `AngularKit` |
| Repository | `atlas` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | Allow `npm publish` |

Use only the workflow filename, not its full path. Stage-only permission does not enable automatic publication. Separate dist-tag management permission is unnecessary. This connection authorizes this workflow and environment to publish the package; the package owner must approve its one-time activation in npm.

Do not create `NPM_TOKEN` or `NODE_AUTH_TOKEN` secrets in GitHub. The job uses OIDC with npm 11.21.0 on a GitHub-hosted runner, granting `id-token: write` only to the publishing job. Provenance is enabled. Additional protections can be configured on the GitHub `npm` environment; a mandatory approval there would make publishing semi-automatic.

## Prepare a version

On a branch created from `main`, update the version without creating a tag:

```sh
npm version patch --no-git-tag-version
```

Choose `minor` or `major` as appropriate. Update the changelog and versioned examples in both READMEs. Open a PR targeting `main` and complete its technical review before merging. Do not create a release solely to test authentication.

After merge and release approval, from a clean, up-to-date checkout of `main`:

```sh
git fetch origin main
git switch main
git pull --ff-only
# Example: the merged PR prepared version 0.1.1.
git tag -a v0.1.1 -m 'Atlas 0.1.1'
git push origin v0.1.1
```

The workflow rejects a tag that differs from the `package.json` version, inconsistent lockfile versions, prereleases and commits outside `origin/main`. Prereleases are not supported by this workflow, which publishes to `latest`.

## Checks and publication

The workflow reuses CI for the tagged commit: type checking, tests and package installation on Node.js 22 and 24, followed by Chromium tests on Node.js 24. Both matrix jobs must succeed before publication.

The Node.js 24 job uploads `atlas-npm-<SHA>`, containing the archive and `atlas-package.json` (file list, sizes and integrity). The publishing job downloads only the artifact from that same run. It verifies integrity, extracts the archive and checks that repacking produces exactly the same digest. It publishes that directory without rebuilding or running lifecycle scripts, also sending README metadata to npm instead of publishing the tarball directly.

After publication, a check waits approximately ten minutes at most for registry availability, compares integrity, installs the package into a clean consumer and tests its CLI, API and HTML generation. Download or integrity failures fail the job. Provenance is available on npm.

Archives exclude private reports and source files from analyzed applications. The existing distribution check verifies an allowed file list and a strict TypeScript consumer. Both user guides are included in the package.

## Recover from a failed workflow

- **Before publication:** fix the cause and rerun failed jobs if the commit remains correct. Content changes require a newly reviewed revision and a new version.
- **npm authentication:** check all four trusted publisher fields, the `npm publish` permission and the `npm` environment. Do not add a permanent token as a workaround.
- **After npm accepts the release:** inspect `npm view @angularkit/atlas@X.Y.Z version dist.integrity` and logs before retrying. Published versions are immutable; do not delete/recreate a tag or attempt to republish the same version. Run the public check separately with `node scripts/verify-release.mjs /path/to/atlas-package.json`, using the manifest downloaded from the workflow run.

Publishing an existing version fails without changing its contents. Publication runs are serialized and an active publication is not interrupted. Push one release tag at a time: GitHub retains only one additional pending run in this concurrency group.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [provenance](https://docs.npmjs.com/generating-provenance-statements/).
