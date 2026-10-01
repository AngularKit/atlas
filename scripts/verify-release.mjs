import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const [packed] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(packed.name, '@angularkit/atlas');
const registry = 'https://registry.npmjs.org';
const url = `${registry}/${encodeURIComponent(packed.name)}/${encodeURIComponent(packed.version)}`;
let available = false;
// npm can accept a publish before its metadata and archive are available.
for (let attempt = 0; attempt < 40; attempt++) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (response.ok) {
    const metadata = await response.json();
    assert.equal(metadata.dist.integrity, packed.integrity, 'Public package differs from the tested archive');
    const archive = await fetch(metadata.dist.tarball, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    if (archive.ok) { available = true; break; }
    assert.equal(archive.status, 404, `Unexpected archive response: ${archive.status}`);
  } else {
    assert.equal(response.status, 404, `Unexpected registry response: ${response.status}`);
  }
  console.log(`Waiting for npm propagation (${attempt + 1}/40)…`);
  await setTimeout(15_000);
}
assert.ok(available, 'npm accepted the release but it is not available yet; inspect the registry before attempting another publication');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-public-release-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--registry', registry, '--cache', path.join(root, 'cache'), '--ignore-scripts', '--no-audit', '--no-fund', `${packed.name}@${packed.version}`], { cwd: root, stdio: 'pipe' });
  fs.mkdirSync(path.join(root, 'app'));
  fs.writeFileSync(path.join(root, 'app/tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], noLib: true }, files: ['app.ts'] }));
  fs.writeFileSync(path.join(root, 'app/app.ts'), "import {provideRouter} from '@angular/router'; provideRouter([{path:'published'}]);");
  execFileSync(path.join(root, 'node_modules/.bin/angular-atlas'), ['app', '--html', 'map.html'], { cwd: root, stdio: 'pipe' });
  assert.match(fs.readFileSync(path.join(root, 'map.html'), 'utf8'), /Carte des routes/);
  fs.writeFileSync(path.join(root, 'verify.mjs'), `
    import assert from 'node:assert/strict';
    import {scan, toCompactInventory} from '@angularkit/atlas';
    const result = scan('./app');
    assert.equal(result.tool.version, process.argv[2]);
    assert.equal(toCompactInventory(result).routes[0].fullPath, '/published');
  `);
  execFileSync(process.execPath, ['verify.mjs', packed.version], { cwd: root, stdio: 'pipe' });
  console.log(`Public installation, CLI and API verified for ${packed.name}@${packed.version}.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
