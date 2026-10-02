import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const prepare = fileURLToPath(new URL('../scripts/prepare-release.mjs', import.meta.url));
test('release extraction rejects a corrupted archive or a different package version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-release-artifact-'));
  try {
    const source = path.join(root, 'source');
    const directory = path.join(root, 'release');
    fs.mkdirSync(path.join(source, 'package'), { recursive: true }); fs.mkdirSync(directory);
    const manifest = { name: '@angularkit/atlas', version: '0.0.0-development' };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(source, 'package/package.json'), JSON.stringify(manifest));
    const filename = 'angularkit-atlas-0.0.0-development.tgz';
    const archive = path.join(directory, filename);
    execFileSync('tar', ['-czf', archive, '-C', source, 'package']);
    const content = fs.readFileSync(archive);
    const packed = { ...manifest, filename, integrity: `sha512-${createHash('sha512').update(content).digest('base64')}` };
    const write = () => fs.writeFileSync(path.join(directory, 'atlas-package.json'), JSON.stringify([packed]));
    const check = () => spawnSync(process.execPath, [prepare, directory], { cwd: root, encoding: 'utf8' });
    write(); assert.equal(check().status, 0);
    fs.appendFileSync(archive, 'corrupted');
    assert.match(check().stderr, /integrity differs/);
    fs.writeFileSync(archive, content); packed.version = '9.9.9'; write();
    assert.notEqual(check().status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
