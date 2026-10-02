import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function snapshotPackage(directory) {
  const files = new Map();
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else {
        assert.ok(entry.isFile(), `Unexpected non-file in release package: ${name}`);
        const filename = path.join(directory, name);
        files.set(name, { content: fs.readFileSync(filename), mode: fs.statSync(filename).mode & 0o777 });
      }
    }
  }
  visit();
  return files;
}

export function verifyPreparedPackage(directory, original, version) {
  const current = snapshotPackage(path.join(directory, 'package'));
  assert.deepEqual([...current.keys()].sort(), [...original.keys()].sort(), 'Release file list changed');
  for (const [name, before] of original) {
    const after = current.get(name);
    assert.equal(after.mode, before.mode, `Release file mode changed: ${name}`);
    if (name === 'package.json') {
      const expected = { ...JSON.parse(before.content), version };
      assert.deepEqual(JSON.parse(after.content), expected, 'Only the package version may change');
    } else assert.deepEqual(after.content, before.content, `Tested file changed: ${name}`);
  }
}

export function recordPreparedArchive(directory, original, version, env) {
  verifyPreparedPackage(directory, original, version);
  const filename = `angularkit-atlas-${version}.tgz`;
  // Compare npm's prepared tarball with a fresh pack of the directory that it
  // will publish. Never rebuild the JavaScript or execute lifecycle scripts.
  const published = path.join(directory, 'published');
  const prepared = fs.readFileSync(path.join(published, filename));
  const result = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', published, '--json'], {
    cwd: path.join(directory, 'package'), env, encoding: 'utf8',
  });
  const [packed] = JSON.parse(result);
  assert.equal(packed.version, version);
  assert.equal(packed.integrity, `sha512-${createHash('sha512').update(prepared).digest('base64')}`);
  fs.writeFileSync(path.join(directory, 'published-package.json'), result);
}
