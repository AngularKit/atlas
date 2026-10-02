import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Resolve the plugins shipped by semantic-release through their owning package.
// This also works with pnpm's isolated dependency layout.
const releaseRequire = createRequire(require.resolve('semantic-release'));
export const conventionalConfig = { config: require.resolve('conventional-changelog-conventionalcommits') };
export const npmPlugin = releaseRequire.resolve('@semantic-release/npm');
export const analysisPlugins = [
  [releaseRequire.resolve('@semantic-release/commit-analyzer'), conventionalConfig],
  [releaseRequire.resolve('@semantic-release/release-notes-generator'), conventionalConfig],
];
export const releasePolicy = { branches: ['main'], tagFormat: 'v${version}' };

export function releaseConfig(directory, checkPreparedPackage) {
  return {
    ...releasePolicy,
    repositoryUrl: 'https://github.com/AngularKit/atlas.git',
    plugins: [
      ...analysisPlugins,
      [npmPlugin, { pkgRoot: path.join(directory, 'package'), tarballDir: path.join(directory, 'published') }],
      { prepare: checkPreparedPackage },
      [releaseRequire.resolve('@semantic-release/github'), {
        successCommentCondition: false,
        failCommentCondition: false,
        releasedLabels: false,
        failTitle: false,
        assets: [path.join(directory, 'published/*.tgz'), path.join(directory, 'published-package.json')],
      }],
    ],
  };
}
