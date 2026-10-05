import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-package-'));
const usePnpm = process.argv.includes('--pnpm');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cache = path.join(root, 'cache');
try {
  const output = execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', cache], { encoding: 'utf8' });
  const [packed] = JSON.parse(output);
  for (const file of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'dist/html.js', 'dist/viewer.js', 'dist/viewer-style.js', 'schema/inventory-v1.schema.json', 'schema/compact-inventory-v1.schema.json', 'README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(packed.files.some(f => f.path === file), `Missing packaged file: ${file}`);
  }
  for (const file of packed.files) {
    if (file.path === 'dist/angular-compiler-LICENSE') continue;
    assert.match(file.path, /^(?:dist\/[\w-]+\.(?:js|d\.ts)|schema\/(?:compact-)?inventory-v1\.schema\.json|package\.json|README(?:\.en)?\.md|CHANGELOG\.md|LICENSE)$/, `Unexpected packaged file: ${file.path}`);
  }
  const consumer = path.join(root, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // A fresh CI runner does not necessarily cache registry packuments.
  // Supply the locked runtime dependency as a local archive, using an empty cache.
  const [typescript] = JSON.parse(execFileSync(npm, ['pack', './node_modules/typescript', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', cache], { encoding: 'utf8' }));
  const install = files => usePnpm
    ? execFileSync(pnpm, ['add', '--offline', '--ignore-scripts', '--strict-peer-dependencies', '--store-dir', path.join(root, 'store'), ...files], { cwd: consumer, stdio: 'pipe' })
    : execFileSync(npm, ['install', '--offline', '--ignore-scripts', '--legacy-peer-deps=false', '--force=false', '--no-audit', '--no-fund', '--cache', cache, ...files], { cwd: consumer, stdio: 'pipe' });
  // Model an Angular project that already has its compiler. Installing Atlas
  // separately must keep that compiler and resolve to the same physical copy.
  install([path.join(root, typescript.filename)]);
  const compilerPackage = path.join(consumer, 'node_modules/typescript/package.json');
  const compilerBefore = fs.readFileSync(compilerPackage, 'utf8');
  install([path.join(root, packed.filename)]);
  const metadata = JSON.parse(fs.readFileSync(path.join(consumer, 'node_modules/@angularkit/atlas/package.json'), 'utf8'));
  assert.ok(metadata.peerDependencies.typescript, 'The package must declare its compatible shared compiler.');
  assert.equal(metadata.dependencies?.typescript, undefined, 'Atlas must not request a private compiler dependency.');
  assert.equal(fs.readFileSync(compilerPackage, 'utf8'), compilerBefore, 'Installing Atlas must preserve the project compiler.');
  const projectRequire = createRequire(path.join(consumer, 'package.json'));
  const atlasRequire = createRequire(fs.realpathSync(path.join(consumer, 'node_modules/@angularkit/atlas/package.json')));
  assert.equal(fs.realpathSync(atlasRequire.resolve('typescript')), fs.realpathSync(projectRequire.resolve('typescript')), 'Atlas must use the project compiler.');
  if (!usePnpm) {
    const installedLock = JSON.parse(fs.readFileSync(path.join(consumer, 'package-lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(installedLock.packages).filter(key => /(?:^|\/)node_modules\/typescript$/.test(key)), ['node_modules/typescript'], 'Only one compiler may be installed.');
  }
  const binary = path.join(consumer, 'node_modules/.bin/angular-atlas');
  const help = execFileSync(binary, ['--help'], { encoding: 'utf8' });
  assert.match(help, /AngularKit Atlas/);
  const target = path.join(root, 'application');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], noLib: true }, files: ['app.ts'] }));
  fs.writeFileSync(path.join(target, 'app.ts'), `import { provideRouter, RouterLink } from '@angular/router'; import { Component } from '@angular/core'; @Component({imports:[RouterLink],template:'<a routerLink="/packed">Go</a>'}) class Page {} provideRouter([{ path: 'packed', component: Page }]);`);
  const json = execFileSync(binary, [target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const report = JSON.parse(json);
  assert.equal(report.routes[0].fullPath, '/packed');
  assert.equal(report.navigation.references[0].target, '/packed');
  assert.equal(report.navigation.references[0].status, 'matched');
  assert.throws(() => atlasRequire.resolve('@angular/compiler'), 'Consumers must not need Angular compiler installed.');
  assert.equal(report.tool.version, packed.version);
  assert.equal(report.tool.typescriptVersion, typescript.version, 'Reports must identify the shared compiler actually used.');
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
  console.log(`Packed package installed offline with ${usePnpm ? 'pnpm' : 'npm'}: shared TypeScript ${typescript.version}, executable CLI, API, TypeScript consumer compilation and schemas verified.`);
  if (process.argv.includes('--standalone')) {
    // Network integration: npm must also install the required peer when Atlas
    // is used outside an existing Angular project (e.g. an npx environment).
    const standalone = path.join(root, 'standalone');
    fs.mkdirSync(standalone);
    fs.writeFileSync(path.join(standalone, 'package.json'), JSON.stringify({ private: true }));
    const registryArgs = ['--registry=https://registry.npmjs.org', '--cache', path.join(root, 'registry-cache'), '--ignore-scripts', '--legacy-peer-deps=false', '--force=false', '--no-audit', '--no-fund'];
    execFileSync(npm, ['install', ...registryArgs, path.join(root, packed.filename)], { cwd: standalone, stdio: 'pipe' });
    const installedCompiler = JSON.parse(fs.readFileSync(path.join(standalone, 'node_modules/typescript/package.json'), 'utf8'));
    const standaloneReport = JSON.parse(execFileSync(path.join(standalone, 'node_modules/.bin/angular-atlas'), [target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(standaloneReport.tool.typescriptVersion, installedCompiler.version);
    assert.equal(standaloneReport.routes[0].fullPath, '/packed');

    const incompatible = path.join(root, 'incompatible');
    fs.mkdirSync(incompatible);
    const incompatiblePackage = JSON.stringify({ private: true, devDependencies: { typescript: '5.3.3' } });
    fs.writeFileSync(path.join(incompatible, 'package.json'), incompatiblePackage);
    const result = spawnSync(npm, ['install', ...registryArgs, '--package-lock-only', path.join(root, packed.filename)], { cwd: incompatible, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'An unsupported project compiler must not be replaced silently.');
    assert.match(result.stderr, /ERESOLVE/, 'npm must report the incompatible peer dependency.');
    assert.equal(fs.readFileSync(path.join(incompatible, 'package.json'), 'utf8'), incompatiblePackage);
    console.log(`Standalone compiler ${installedCompiler.version} installed automatically; incompatible project compiler rejected without modifying its manifest.`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
