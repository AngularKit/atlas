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
  for (const file of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'dist/html.js', 'dist/viewer.js', 'dist/viewer-style.js', 'schema/inventory-v1.schema.json', 'schema/compact-inventory-v1.schema.json', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(packed.files.some(f => f.path === file), `Missing packaged file: ${file}`);
  }
  for (const file of packed.files) {
    assert.match(file.path, /^(?:dist\/[\w-]+\.(?:js|d\.ts)|schema\/(?:compact-)?inventory-v1\.schema\.json|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/, `Unexpected packaged file: ${file.path}`);
  }
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
  const html = path.join(consumer, 'map.html');
  execFileSync(binary, [target, '--html', html], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(fs.readFileSync(html, 'utf8'), /Content-Security-Policy/);
  const compact = JSON.parse(execFileSync(binary, [target, '--compact'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(compact.format, 'compact');
  assert.equal(compact.routes[0].fullPath, '/packed');
  fs.writeFileSync(path.join(consumer, 'api.mjs'), `
    import { scan, toMarkdown, toCompactInventory, toHtml } from '@angularkit/atlas';
    const inventory = scan(process.argv[2]);
    if (!toMarkdown(inventory).includes('/packed')) process.exit(1);
    if (!toHtml(inventory).includes('Carte des routes')) process.exit(1);
    if (toCompactInventory(inventory).routes[0].fullPath !== '/packed') process.exit(1);
    if (!toMarkdown(inventory, {compact:true}).includes('Cartographie des routes')) process.exit(1);
  `);
  execFileSync(process.execPath, ['api.mjs', target], { cwd: consumer, stdio: 'pipe' });
  fs.writeFileSync(path.join(consumer, 'api.ts'), `
    import { scan, toMarkdown, toCompactInventory, toHtml } from '@angularkit/atlas';
    import type { Inventory, CompactInventory, ScanOptions, MarkdownOptions, RouteRecord } from '@angularkit/atlas';
    const options: ScanOptions = { tsconfig: 'tsconfig.json' };
    const inventory: Inventory = scan('.', options);
    const compact: CompactInventory = toCompactInventory(inventory);
    const markdownOptions: MarkdownOptions = { compact: true };
    const markdown: string = toMarkdown(inventory, markdownOptions);
    const html: string = toHtml(inventory);
    const routes: RouteRecord[] = inventory.routes;
    void [compact, markdown, html, routes];
  `);
  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [], lib: ['ES2022'], skipLibCheck: false },
    files: ['api.ts'],
  }));
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'pipe' });
  metadata.version = '0.0.0-metadata-test';
  fs.writeFileSync(path.join(consumer, 'node_modules/@angularkit/atlas/package.json'), JSON.stringify(metadata));
  const withUpdatedVersion = JSON.parse(execFileSync(binary, [target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(withUpdatedVersion.tool.version, metadata.version, 'Report version must follow the installed package metadata.');
  console.log('Packed package installed offline: executable CLI, API, TypeScript consumer compilation and schemas verified.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
