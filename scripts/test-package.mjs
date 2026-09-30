import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cache = path.join(root, 'cache');
try {
  const output = execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', cache], { encoding: 'utf8' });
  const [packed] = JSON.parse(output);
  for (const file of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'schema/inventory-v1.schema.json', 'schema/compact-inventory-v1.schema.json', 'README.md', 'LICENSE']) {
    assert.ok(packed.files.some(f => f.path === file), `Missing packaged file: ${file}`);
  }
  assert.ok(!packed.files.some(f => f.path.startsWith('reports/') || f.path.startsWith('test/')));
  const consumer = path.join(root, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // npm ci on a fresh CI runner does not necessarily cache registry packuments.
  // Supply the locked runtime dependency as a local archive, using an empty cache.
  const [typescript] = JSON.parse(execFileSync(npm, ['pack', './node_modules/typescript', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', cache], { encoding: 'utf8' }));
  execFileSync(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', cache, path.join(root, packed.filename), path.join(root, typescript.filename)], { cwd: consumer, stdio: 'pipe' });
  const metadata = JSON.parse(fs.readFileSync(path.join(consumer, 'node_modules/@angularkit/atlas/package.json'), 'utf8'));
  assert.ok(metadata.dependencies.typescript, 'The package must declare its runtime compiler dependency.');
  const binary = path.join(consumer, 'node_modules/.bin/angular-atlas');
  const help = execFileSync(binary, ['--help'], { encoding: 'utf8' });
  assert.match(help, /AngularKit Atlas/);
  const target = path.join(root, 'application');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], noLib: true }, files: ['app.ts'] }));
  fs.writeFileSync(path.join(target, 'app.ts'), `import { provideRouter } from '@angular/router'; provideRouter([{ path: 'packed' }]);`);
  const json = execFileSync(binary, [target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const report = JSON.parse(json);
  assert.equal(report.routes[0].fullPath, '/packed');
  assert.equal(report.tool.version, packed.version);
  const compact = JSON.parse(execFileSync(binary, [target, '--compact'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(compact.format, 'compact');
  assert.equal(compact.routes[0].fullPath, '/packed');
  fs.writeFileSync(path.join(consumer, 'api.mjs'), `
    import { scan, toMarkdown, toCompactInventory } from '@angularkit/atlas';
    const inventory = scan(process.argv[2]);
    if (!toMarkdown(inventory).includes('/packed')) process.exit(1);
    if (toCompactInventory(inventory).routes[0].fullPath !== '/packed') process.exit(1);
    if (!toMarkdown(inventory, {compact:true}).includes('synthèse')) process.exit(1);
  `);
  execFileSync(process.execPath, ['api.mjs', target], { cwd: consumer, stdio: 'pipe' });
  console.log('Packed package installed offline: executable CLI, API, declarations and schema verified.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
