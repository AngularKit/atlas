# Automatic npm releases

[Français](releasing.md) · **English**

After a reviewed PR merges into `main`, `publish.yml` runs the full CI suite. If it passes and there are releasable changes since the previous version, **semantic-release calculates the version, creates the tag, publishes to npm, and creates the GitHub release**. Pull requests and working branches do not publish. Technical PRs still require Gaëtan’s explicit approval after review before merging.

## Everyday workflow

1. Create a branch from `main` and open a PR.
2. Use a Conventional Commits title from the table below. Update both French and English user guides whenever user-facing behavior changes.
3. Complete review and checks, then **Squash and merge**, keeping that title as the commit message. Preserve any `BREAKING CHANGE:` footer in the commit body.
4. After merging, follow **Publish npm** in GitHub Actions, then check the [GitHub release](https://github.com/AngularKit/atlas/releases) and [npm package](https://www.npmjs.com/package/@angularkit/atlas).

| Merged commit | Effect | Example from `0.1.1` |
|---|---|---|
| `fix: resolve lazy routes` | Patch | `0.1.2` |
| `feat: add a filter` | Minor | `0.2.0` |
| `feat!: change the JSON schema` | Major | `1.0.0` |
| A body containing `BREAKING CHANGE: ...` | Major, regardless of type | `1.0.0` |
| `docs:`, `ci:`, `test:`, `chore:`, `refactor:` | No release on their own, without a breaking change | — |

The largest change since the previous tag determines the version. A `ci:` PR can therefore trigger publication of an earlier, unreleased `fix:` commit. Scopes such as `fix(parser): ...` are supported. Breaking changes produce a major version **even before 1.0**. Prereleases are not configured; releases use `latest`.

Do not run `npm version`, push release tags or change the version manually. Source manifests retain `0.0.0-development`, which local builds report. The published archive receives the calculated version. No automated commit changes `main`. Tags, GitHub releases and npm are authoritative for published versions. Release notes come from commits; `CHANGELOG.md` keeps the functional context written in PRs.

## One-time setup

In the [npm package settings](https://www.npmjs.com/package/@angularkit/atlas/access), configure **Trusted Publisher → GitHub Actions**:

| Field | Value |
|---|---|
| Organization or user | `AngularKit` |
| Repository | `atlas` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | Allow `npm publish` |

Use the filename without a path. Staging-only permission is insufficient. The package owner must approve this connection once in npm. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. The job uses OIDC, npm 11.21.0, a GitHub-hosted runner and npm provenance. Its temporary GitHub token has `contents: write` for tags/releases, and the job has `id-token: write` for npm. Automated comments on issues and PRs are disabled.

The GitHub `npm` environment may have protections; mandatory reviewers make publication semi-automatic. Preserve the workflow and environment names, or update the npm connection before changing them.

For migration, `v0.1.0` must point to **`3bc431cb1fe3e2bd57c0049a56cd31b5018beea4`**, the source of the archive published on October 1, 2026. This historical anchor prevents semantic-release from treating the project as an initial `1.0.0` release. The workflow verifies it before publishing. The already merged TypeScript fix then produces `0.1.1`, unless a larger change is introduced.

## CI guarantees

`publish.yml` reuses `ci.yml` for the merged commit: type checking, tests, package installation on Node.js 22 and 24, Chromium, standalone installation and the seven TypeScript 5.x compiler versions, in addition to compiler 6.0.3. A separate job tests release policy, notes and a real release to a local Git repository, without publishing to npm. Every job must pass.

CI produces `atlas-npm-<SHA>`. Publication downloads the archive from that same run, verifies its digest and extracts it. Semantic-release changes only the manifest version. A check compares every file and permission against the tested archive, verifies that other manifest fields are unchanged, then compares the prepared archive with a fresh `npm pack`. No build or lifecycle script runs during preparation or publication.

Publishing the extracted directory also sends README metadata to npm. The final `published-package.json` manifest and versioned archive are attached to the GitHub release and retained for 14 days in `atlas-published-<SHA>`. Release tooling lives separately in `.github/release` and is excluded from the distributed package.

After publishing, the workflow waits for registry propagation, compares final integrity, installs into a clean project and tests the CLI, API and HTML output. It succeeds only after this public verification. A documentation-only PR may finish with “No release required”; this is expected.

Runs are serialized without interrupting the active run. GitHub keeps only one additional pending run; several merges can replace a pending run with a newer one. The newer run repeats all CI checks and includes all changes that have not yet been released.

## Failure recovery

- **CI or preparation fails before tag creation:** fix the cause in a PR or rerun a transient failure. Changed content must pass CI again.
- **npm authentication:** check the trusted publisher fields, publication permission and environment. Do not bypass OIDC by adding a permanent token.
- **Tag created but npm publication failed:** semantic-release tags before sending the package to npm. Rerunning may report no release required. First inspect `npm view @angularkit/atlas@X.Y.Z version dist.integrity`, logs and the GitHub release. Do not automatically delete the tag. If npm confirms that the version does not exist, an explicit, reviewed recovery must restore the release anchor before rerunning the tested commit.
- **npm accepted the version but a later step fails:** published versions are immutable. Do not republish or recreate the tag. Download `published-package.json` from the artifacts and rerun only `node scripts/verify-release.mjs /path/published-package.json`. If only the GitHub release is missing, recreate it on the existing tag with that run’s notes and files, without publishing to npm again.

To test releases locally without writing to GitHub or npm, run `npm ci --prefix .github/release --ignore-scripts` followed by `npm test --prefix .github/release` (Node.js 24.10 or newer).

References: [semantic-release](https://semantic-release.gitbook.io/semantic-release/), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [provenance](https://docs.npmjs.com/generating-provenance-statements/).
