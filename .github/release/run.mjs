import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import semanticRelease from 'semantic-release';
import { releaseConfig } from './config.mjs';
import { snapshotPackage, recordPreparedArchive } from './artifact.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Releases run only in GitHub Actions');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), process.env.GITHUB_SHA, 'Checkout must match the tested commit');
assert.equal(git('rev-parse', 'v0.1.0^{commit}'), '3bc431cb1fe3e2bd57c0049a56cd31b5018beea4', 'The first npm release must be tagged correctly');
git('merge-base', '--is-ancestor', 'v0.1.0', 'HEAD');

const directory = path.resolve(process.argv[2]);
execFileSync(process.execPath, ['scripts/prepare-release.mjs', directory], { stdio: 'inherit' });
const original = snapshotPackage(path.join(directory, 'package'));
const env = { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' };
const result = await semanticRelease(releaseConfig(directory, (_config, context) => {
  recordPreparedArchive(directory, original, context.nextRelease.version, context.env);
}), { env });
if (result) {
  execFileSync(process.execPath, ['scripts/verify-release.mjs', path.join(directory, 'published-package.json')], { env, stdio: 'inherit' });
} else {
  console.log('No release required for this commit.');
}
