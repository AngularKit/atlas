import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const analysisPlugins = [
  [require.resolve('@semantic-release/commit-analyzer'), { preset: 'conventionalcommits' }],
  [require.resolve('@semantic-release/release-notes-generator'), { preset: 'conventionalcommits' }],
];
export const releasePolicy = { branches: ['main'], tagFormat: 'v${version}' };

export function releaseConfig(directory, checkPreparedPackage) {
  return {
    ...releasePolicy,
    repositoryUrl: 'https://github.com/AngularKit/atlas.git',
    plugins: [
      ...analysisPlugins,
      [require.resolve('@semantic-release/npm'), { pkgRoot: path.join(directory, 'package'), tarballDir: path.join(directory, 'published') }],
      { prepare: checkPreparedPackage },
      [require.resolve('@semantic-release/github'), {
        successCommentCondition: false,
        failCommentCondition: false,
        releasedLabels: false,
        failTitle: false,
        assets: [path.join(directory, 'published/*.tgz'), path.join(directory, 'published-package.json')],
      }],
    ],
  };
}
