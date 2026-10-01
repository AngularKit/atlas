import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const tag = process.argv[2];
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
assert.equal(manifest.name, '@angularkit/atlas');
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable versions are published to latest');
assert.equal(tag, `v${manifest.version}`, 'Tag must match package.json');
assert.equal(lock.version, manifest.version, 'Update package-lock.json before releasing');
assert.equal(lock.packages[''].version, manifest.version, 'Lockfile root version differs');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tagged = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
assert.equal(tagged, head, 'Checkout must match the release tag');
execFileSync('git', ['merge-base', '--is-ancestor', head, 'origin/main']);
console.log(`${manifest.name}@${manifest.version}: tag matches a commit merged into main.`);
