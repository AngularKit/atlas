import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const guard = fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url));

test('release gate requires a stable matching tag, synchronized versions and main ancestry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-release-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const versions = (version, locked = version) => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@angularkit/atlas', version }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: locked, packages: { '': { version: locked } } }));
  };
  const check = tag => spawnSync(process.execPath, [guard, tag], { cwd: root, encoding: 'utf8' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release Test');
    git('config', 'user.email', 'release@example.invalid');
    versions('1.2.3');
    git('add', '.');
    git('commit', '-m', 'Prepared release');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('tag', '-a', 'v1.2.3', '-m', 'Release');
    assert.equal(check('v1.2.3').status, 0);
    assert.notEqual(check('v1.2.4').status, 0, 'A mismatched tag must fail');
    versions('1.2.3', '1.2.2');
    assert.notEqual(check('v1.2.3').status, 0, 'A stale lockfile must fail');
    versions('1.2.4-rc.1');
    assert.notEqual(check('v1.2.4-rc.1').status, 0, 'A prerelease cannot become latest');
    versions('1.2.4');
    git('switch', '-c', 'unmerged');
    git('add', '.');
    git('commit', '-m', 'Not merged into main');
    git('tag', 'v1.2.4');
    assert.notEqual(check('v1.2.4').status, 0, 'An unmerged commit must fail');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.equal(check('v1.2.4').status, 0, 'A lightweight tag merged into main is valid');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
