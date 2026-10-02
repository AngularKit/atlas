import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import semanticRelease from 'semantic-release';
import { releasePolicy, analysisPlugins, conventionalConfig, npmPlugin } from './config.mjs';
import { snapshotPackage, verifyPreparedPackage, recordPreparedArchive } from './artifact.mjs';

const { analyzeCommits } = await import(analysisPlugins[0][0]);
const { generateNotes } = await import(analysisPlugins[1][0]);
const quiet = () => new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const logger = { log() {}, error() {}, success() {}, warn() {} };
const cases = [
  ['fix: share TypeScript', 'patch'],
  ['feat: add route filters', 'minor'],
  ['feat!: change the report schema', 'major'],
  ['fix: change CLI\n\nBREAKING CHANGE: old flags were removed', 'major'],
  ['docs: clarify installation', null],
  ['ci: automate releases', null],
];
for (const [message, type] of cases) {
  test(`Conventional Commits: ${message.split('\n')[0]}`, async () => {
    assert.equal(await analyzeCommits(conventionalConfig, {
      cwd: process.cwd(), commits: [{ hash: 'abc123', message }], logger,
    }), type);
  });
}

test('release notes describe fixes and link to commits', async () => {
  const notes = await generateNotes(conventionalConfig, {
    cwd: process.cwd(), logger,
    options: { repositoryUrl: 'https://github.com/AngularKit/atlas.git' },
    commits: [{ hash: 'abcdef123456789', message: 'fix: share TypeScript' }],
    lastRelease: { version: '0.1.0', gitTag: 'v0.1.0' },
    nextRelease: { version: '0.1.1', gitTag: 'v0.1.1' },
  });
  assert.match(notes, /share TypeScript/);
  assert.match(notes, /AngularKit\/atlas\/commit\/abcdef123456789/);
});

test('real release engine versions the tested payload, tags a local remote and skips docs-only changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-semantic-release-'));
  const cwd = path.join(root, 'checkout');
  const remote = path.join(root, 'remote.git');
  const directory = path.join(root, 'release');
  const pkgRoot = path.join(directory, 'package');
  fs.mkdirSync(cwd); fs.mkdirSync(pkgRoot, { recursive: true });
  // Intentionally fail if npm executes any lifecycle hook on the tested payload.
  fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({
    name: '@angularkit/atlas', version: '0.0.0-development',
    description: 'Release fixture', repository: 'https://github.com/AngularKit/atlas.git',
    scripts: { prepack: 'exit 91', version: 'exit 92', prepare: 'exit 93' },
  }));
  fs.writeFileSync(path.join(pkgRoot, 'index.js'), 'export const tested = true;\n');
  fs.writeFileSync(path.join(pkgRoot, 'README.md'), '# Tested README\n');
  const original = snapshotPackage(pkgRoot);
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  // Do not inherit the CI checkout's GitHub identity or credentials into the
  // fixture. Every write performed by semantic-release targets this local repo.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GITHUB_|GH_|GIT_|CI$)/.test(key)));
  Object.assign(env, { NPM_CONFIG_IGNORE_SCRIPTS: 'true', npm_config_ignore_scripts: 'true', npm_config_cache: path.join(root, 'cache'), GIT_AUTHOR_NAME: 'Release Test', GIT_AUTHOR_EMAIL: 'release@example.invalid', GIT_COMMITTER_NAME: 'Release Test', GIT_COMMITTER_EMAIL: 'release@example.invalid' });
  const options = {
    ...releasePolicy, ci: false, repositoryUrl: remote,
    plugins: [
      analysisPlugins[0],
      [npmPlugin, { npmPublish: false, pkgRoot, tarballDir: path.join(directory, 'published') }],
      { prepare(_config, context) { recordPreparedArchive(directory, original, context.nextRelease.version, context.env); } },
    ],
  };
  try {
    git('init', '--bare', '-b', 'main', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release Test'); git('config', 'user.email', 'release@example.invalid');
    git('commit', '--allow-empty', '-m', 'feat: initial release');
    git('tag', 'v0.1.0');
    git('remote', 'add', 'origin', remote);
    git('commit', '--allow-empty', '-m', 'fix: share TypeScript');
    git('push', '-u', 'origin', 'main', '--tags');
    const head = git('rev-parse', 'HEAD');
    const result = await semanticRelease(options, { cwd, env, stdout: quiet(), stderr: quiet() });
    assert.equal(result.nextRelease.version, '0.1.1');
    assert.equal(result.nextRelease.gitHead, head);
    assert.equal(git('rev-parse', 'v0.1.1'), head);
    assert.match(git('ls-remote', '--tags', remote), /refs\/tags\/v0.1.1/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'published-package.json')))[0].version, '0.1.1');
    verifyPreparedPackage(directory, original, '0.1.1');
    git('commit', '--allow-empty', '-m', 'docs: clarify usage');
    git('push', 'origin', 'main');
    assert.equal(await semanticRelease({ ...options, dryRun: true }, { cwd, env, stdout: quiet(), stderr: quiet() }), false);
    assert.equal(git('tag', '--list').split('\n').length, 2);

    fs.appendFileSync(path.join(pkgRoot, 'index.js'), '// unexpected rebuild');
    assert.throws(() => verifyPreparedPackage(directory, original, '0.1.1'), /Tested file changed/);
    fs.writeFileSync(path.join(pkgRoot, 'index.js'), original.get('index.js').content);
    fs.writeFileSync(path.join(pkgRoot, 'extra.js'), 'unexpected file');
    assert.throws(() => verifyPreparedPackage(directory, original, '0.1.1'), /file list changed/);
    fs.unlinkSync(path.join(pkgRoot, 'extra.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json')));
    manifest.dependencies = { unexpected: '*' };
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify(manifest));
    assert.throws(() => verifyPreparedPackage(directory, original, '0.1.1'), /Only the package version/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
