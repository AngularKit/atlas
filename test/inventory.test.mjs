import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { scan, toMarkdown } from '../dist/index.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const schema = JSON.parse(fs.readFileSync(new URL('../schema/inventory-v1.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const routerTypes = `
export interface Route { path?: string; children?: Routes; [key: string]: unknown; }
export type Routes = Route[];
export declare function provideRouter(routes: Routes): unknown;
export declare class RouterModule { static forRoot(routes: Routes): unknown; static forChild(routes: Routes): unknown; }
export declare class Router { resetConfig(routes: Routes): void; }
export declare const ROUTES: unknown;
`;

function project(t, files, compilerOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contents = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noLib: true, types: [], ...compilerOptions }, include: ['src/**/*.ts'] }),
    'node_modules/@angular/router/package.json': JSON.stringify({ name: '@angular/router', types: 'index.d.ts' }),
    'node_modules/@angular/router/index.d.ts': routerTypes,
    'src/pages.ts': 'export class Shell {} export class Detail {} export class Home {}',
    ...files,
  };
  for (const [file, text] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('follows aliased imports, spreads, satisfies, children, lazy exports and declaration evidence', t => {
  const root = project(t, {
    'src/app.ts': `import { provideRouter as router } from '@angular/router'; import { routes as appRoutes } from '@routes'; router(appRoutes);`,
    'src/routes.ts': `
      import type { Routes } from '@angular/router';
      import { Shell as Layout, Home } from './pages';
      const authGuard = () => true;
      const childGuard = () => true;
      const resolver = () => 42;
      const common = { canActivate: [authGuard], resolve: { item: resolver } };
      const loadDetail = () => import('./pages').then(m => m.Detail);
      const nested = [{path: ':id', loadComponent: loadDetail}];
      const redirects = [{path: 'old', redirectTo: '/home', pathMatch: 'full'}];
      const configured = [
        { ...common, path: '', component: Layout, canActivateChild: [childGuard], children: nested },
        { path: 'home', component: Home },
        { path: 'admin', loadChildren: () => import('./lazy').then(m => m.childRoutes) },
        ...redirects,
        { path: '**', redirectTo: '/home' }
      ] satisfies Routes;
      export const routes = configured;
    `,
    'src/lazy.ts': `export const childRoutes = [{ path: 'details', loadComponent: () => import('./default-page') }];`,
    'src/default-page.ts': 'export default class LazyPage {}',
  }, { paths: { '@routes': ['./src/routes.ts'] } });
  const result = scan(root);
  assert.ok(validate(result), JSON.stringify(validate.errors));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.routes.map(r => r.fullPath), ['/', '/:id', '/home', '/admin', '/admin/details', '/old', '/**']);
  assert.deepEqual(result.routes.map(r => r.order), [0, 0, 1, 2, 0, 3, 4]);
  assert.equal(result.routes[0].component.name, 'Shell');
  assert.equal(result.routes[1].component.name, 'Detail');
  assert.equal(result.routes[4].component.name, 'LazyPage');
  assert.equal(result.routes[4].component.loading, 'lazy');
  assert.equal(result.routes[4].parentId, result.routes[3].id);
  assert.equal(result.routes[0].guards.canActivate[0].name, 'authGuard');
  assert.equal(result.routes[0].guards.canActivateChild[0].name, 'childGuard');
  assert.deepEqual(result.routes[1].guards, {});
  assert.equal(result.routes[0].resolvers.item.name, 'resolver');
  assert.equal(result.routes[1].component.declaration.file, 'src/pages.ts');
  assert.equal(result.routes[5].redirect.target, '/home');
  assert.equal(result.routes[5].pathMatch, 'full');
  for (const route of result.routes) {
    const line = fs.readFileSync(path.join(root, route.source.file), 'utf8').split('\n')[route.source.line - 1];
    assert.ok(line && route.source.column > 0);
  }
});

test('recognizes RouterModule aliases and namespace imports, rejects lookalike local functions', t => {
  const root = project(t, {
    'src/app.ts': `
      import { RouterModule as Routing } from '@angular/router';
      import * as ng from '@angular/router';
      Routing.forRoot([{path: 'one'}]);
      ng.provideRouter([{path: 'two'}]);
      function provideRouter(routes: unknown) { return routes; }
      provideRouter([{path: 'fake'}]);
    `,
  });
  const result = scan(root);
  assert.deepEqual(result.routes.map(r => r.path), ['one', 'two']);
  assert.deepEqual(result.entryPoints.map(e => e.kind), ['RouterModule.forRoot', 'provideRouter']);
});

test('excludes tests and build files without executing the application', t => {
  const root = project(t, {
    'src/app.ts': `import { provideRouter } from '@angular/router'; throw new Error('MUST NOT RUN'); provideRouter([{path:'real'}]);`,
    'src/decoy.spec.ts': `import { provideRouter } from '@angular/router'; provideRouter([{path:'test'}]);`,
    'src/nested.stories.ts': `import { provideRouter } from '@angular/router'; provideRouter([{path:'story'}]);`,
    'src/dist/generated.ts': `import { provideRouter } from '@angular/router'; provideRouter([{path:'generated'}]);`,
  });
  const before = fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8');
  const result = scan(root);
  assert.deepEqual(result.routes.map(r => r.path), ['real']);
  assert.equal(result.project.excludedFiles.filter(f => f.includes('spec') || f.includes('stories') || f.includes('generated')).length, 3);
  assert.equal(fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8'), before);
});

test('reports dynamic fields, matchers and named outlets without inventing URLs', t => {
  const root = project(t, {
    'src/app.ts': `import { provideRouter } from '@angular/router';
      provideRouter([
        {path: computePath()},
        {matcher: match, children:[{path:'child'}]},
        {path:'chat',outlet:'aside',children:[{path:'room'}]},
        {path:'old',redirectTo: () => '/new'},
        {path:'lazy',loadChildren: () => getRoutes()},
        ...getAdditionalRoutes()
      ]);`,
  });
  const result = scan(root);
  assert.equal(result.scope.status, 'partial');
  assert.deepEqual(result.routes.slice(0, 5).map(r => r.fullPath), [null, null, null, null, null]);
  for (const code of ['UNRESOLVED_VALUE', 'CUSTOM_MATCHER', 'NAMED_OUTLET', 'UNRESOLVED_LAZY', 'UNRESOLVED_ARRAY']) {
    assert.ok(result.diagnostics.some(d => d.code === code), code);
  }
  assert.equal(result.routes.find(r => r.path === 'old').redirect.target, null);
});

test('cycles terminate while sibling reuse remains supported', t => {
  const root = project(t, {
    'src/app.ts': `import { provideRouter } from '@angular/router';
      const circular = [{path:'cycle',children:circular}];
      const alias = alias;
      const shared = [{path:'leaf'}];
      const spreads = [...spreads];
      provideRouter([...circular,{path:'a',children:shared},{path:'b',children:shared},...alias,...spreads]);`,
  });
  const result = scan(root);
  assert.deepEqual(result.routes.map(r => r.fullPath), ['/cycle', '/a', '/a/leaf', '/b', '/b/leaf']);
  assert.ok(result.diagnostics.some(d => d.code === 'CYCLIC_ROUTES'));
  assert.ok(result.diagnostics.some(d => d.code === 'CYCLIC_REFERENCE'));
});

test('unknown object spreads cannot preserve potentially overridden fields', t => {
  const root = project(t, {
    'src/app.ts': `import { provideRouter } from '@angular/router';
      const partial = {path:'unsafe',...getConfig()};
      provideRouter([{...partial},{...getConfig(),path:'known',outlet:'primary'}]);`,
  });
  const result = scan(root);
  assert.equal(result.routes[0].path, null);
  assert.equal(result.routes[0].fullPath, null);
  assert.equal(result.routes[1].fullPath, '/known');
  assert.equal(result.scope.status, 'partial');
});

test('cyclic objects and excessive nesting are bounded with diagnostics', t => {
  const levels = Array.from({ length: 105 }, (_, index) => `const r${index} = [{path:'p${index}',children:r${index + 1}}];`).join('\n');
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      const circular = {...circular};
      ${levels}
      const r105 = [];
      provideRouter([circular, ...r0]);`,
  });
  const result = scan(root);
  assert.ok(result.routes.length <= 101);
  assert.ok(result.diagnostics.some(d => d.code === 'CYCLIC_REFERENCE'));
  assert.ok(result.diagnostics.some(d => d.code === 'CYCLIC_ROUTES'));
  assert.ok(validate(result), JSON.stringify(validate.errors));
});

test('follows property access through static objects without bypassing mutable bindings', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      const fixed = { path: 'good' };
      let changing = { path: 'unreliable' };
      provideRouter([{path:fixed.path},{path:changing.path}]);`,
  });
  const result = scan(root);
  assert.equal(result.routes[0].fullPath, '/good');
  assert.equal(result.routes[1].fullPath, null);
  assert.ok(result.diagnostics.some(d => d.code === 'MUTABLE_REFERENCE'));
});

test('keeps same-path routes distinct and their registration order intact', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      const isAdmin = () => true;
      provideRouter([{path:'new'},{path:':id'},{path:'same',canMatch:[isAdmin]},{path:'same'}]);`,
  });
  const result = scan(root);
  assert.deepEqual(result.routes.map(r => r.path), ['new', ':id', 'same', 'same']);
  assert.equal(new Set(result.routes.map(r => r.id)).size, 4);
  assert.equal(result.routes[2].guards.canMatch[0].name, 'isAdmin');
});

test('reports unsupported lazy NgModules, forChild and runtime configuration', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter,RouterModule,Router} from '@angular/router';
      provideRouter([{path:'legacy',loadChildren:()=>import('./legacy').then(m=>m.LegacyModule)}]);
      RouterModule.forChild([{path:'extra'}]);
      const router = new Router(); router.resetConfig([]);`,
    'src/legacy.ts': 'export class LegacyModule {}',
  });
  const result = scan(root);
  for (const code of ['LAZY_NGMODULE', 'CHILD_NGMODULE', 'RUNTIME_CONFIGURATION']) assert.ok(result.diagnostics.some(d => d.code === code), code);
});

test('default-exported lazy routes and re-exported classes are followed', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'lazy',loadChildren:()=>import('./lazy')}]);`,
    'src/lazy.ts': `export default [{path:'page',loadComponent:()=>import('./barrel').then(m=>m.Page)}];`,
    'src/barrel.ts': `export {Detail as Page} from './pages';`,
  });
  const result = scan(root);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.routes[1].fullPath, '/lazy/page');
  assert.equal(result.routes[1].component.name, 'Detail');
});

test('follows destructured lazy exports and renamed bindings through workspace aliases', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      provideRouter([
        {path:'shop',loadChildren:()=>import('@feature').then(({featureRoutes})=>featureRoutes)},
        {path:'other',loadChildren:()=>import('@feature').then(({featureRoutes: selected})=>selected)},
        {path:'screen',loadComponent:()=>import('./pages').then(({Detail: Page})=>Page)}
      ]);`,
    'src/feature/index.ts': `export {routes as featureRoutes} from './routes';`,
    'src/feature/routes.ts': `export const routes = [{path:':id',loadComponent:()=>import('../pages').then(m=>m.Detail)}];`,
  }, { paths: { '@feature': ['./src/feature/index.ts'] } });
  const result = scan(root);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.routes.map(r=>r.fullPath), ['/shop','/shop/:id','/other','/other/:id','/screen']);
  assert.equal(result.routes.at(-1).component.name, 'Detail');
  assert.ok(validate(result), JSON.stringify(validate.errors));
});

test('rejects destructured lazy defaults, rest and unrelated callback results', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      const other = [];
      provideRouter([
        {path:'default',loadChildren:()=>import('./lazy').then(({routes = other})=>routes)},
        {path:'rest',loadChildren:()=>import('./lazy').then(({...rest})=>rest)},
        {path:'unrelated',loadChildren:()=>import('./lazy').then(({routes})=>other)}
      ]);`,
    'src/lazy.ts': `export const routes = [{path:'child'}];`,
  });
  const result = scan(root);
  assert.equal(result.routes.length,3);
  assert.equal(result.diagnostics.filter(d=>d.code==='UNRESOLVED_LAZY').length,3);
});

test('unwraps a lazy namespace reexport once, like the Angular router', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      provideRouter([{path:'lessons',loadChildren:()=>import('./barrel').then(({routes})=>routes)}]);`,
    'src/barrel.ts': `export * as routes from './feature';`,
    'src/feature.ts': `export default [{path:'intro',loadComponent:()=>import('./pages').then(m=>m.Detail)}];`,
  });
  const result = scan(root);
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.routes.map(r=>r.fullPath),['/lessons','/lessons/intro']);
});

test('map-generated routes stay explicitly unresolved without executing callbacks', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      provideRouter([{path:'known'},...['1','2'].map(id=>({path:'module-'+id}))]);`,
  });
  const result = scan(root);
  assert.deepEqual(result.routes.map(r=>r.fullPath),['/known']);
  assert.ok(result.diagnostics.some(d=>d.code==='UNRESOLVED_ARRAY' && d.source.file==='src/app.ts'));
  assert.equal(result.scope.status,'partial');
});

test('reports SSG policy as a separate unanalysed scope, without evaluating prerender generators', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'blog/:slug'}]);`,
    'src/server.ts': `import {withRoutes as policies} from '@angular/ssr';
      policies([{path:'blog/:slug',renderMode:'Prerender',getPrerenderParams:()=>{throw new Error('MUST NOT RUN')}}]);`,
    'src/decoy.ts': `function withRoutes(value:unknown) { return value; } withRoutes([]);`,
  });
  const result = scan(root, {entry:'src/app.ts'});
  assert.equal(result.routes.length,1);
  assert.equal(result.routes[0].fullPath,'/blog/:slug');
  assert.equal(result.diagnostics.filter(d=>d.code==='SERVER_RENDERING_NOT_ANALYZED').length,1);
  assert.equal(result.scope.status,'partial');
  assert.ok(validate(result), JSON.stringify(validate.errors));
});

test('mutable references produce diagnostics', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router'; let routes=[{path:'initial'}]; provideRouter(routes);`,
  });
  const result = scan(root);
  assert.equal(result.routes.length, 0);
  assert.ok(result.diagnostics.some(d => d.code === 'MUTABLE_REFERENCE'));
});

test('shorthand properties retain symbol identity and do not bypass mutable bindings', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      const children = [{path:'child'}];
      const resolve = { count: () => 1 };
      let canActivate = [() => true];
      provideRouter([{path:'parent', children, resolve, canActivate}]);`,
  });
  const result = scan(root);
  assert.deepEqual(result.routes.map(r => r.fullPath), ['/parent', '/parent/child']);
  assert.ok(result.diagnostics.some(d => d.code === 'MUTABLE_REFERENCE'));
  assert.ok(result.routes[0].resolvers.count);
  assert.ok(validate(result), JSON.stringify(validate.errors));
});

test('provider registrations and resets remain visible with an entry filter', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([]);`,
    'src/other.ts': `import {Router,ROUTES} from '@angular/router'; new Router().resetConfig([]); export const provider={provide:ROUTES,useValue:[]};`,
  });
  const result = scan(root, { entry: 'src/app.ts' });
  assert.ok(result.diagnostics.some(d => d.code === 'RUNTIME_CONFIGURATION'));
  assert.ok(result.diagnostics.some(d => d.code === 'ADDITIONAL_ROUTES'));
});

test('declaration inputs influence the fingerprint', t => {
  const root = project(t, { 'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([]);` });
  const first = scan(root);
  fs.appendFileSync(path.join(root, 'node_modules/@angular/router/index.d.ts'), '\nexport declare const changed: boolean;');
  assert.notEqual(scan(root).project.fingerprint, first.project.fingerprint);
});

test('empty configuration differs from missing registrations', t => {
  const root = project(t, { 'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([]);` });
  assert.equal(scan(root).scope.status, 'static');
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const routes = [];');
  const result = scan(root);
  assert.equal(result.scope.status, 'partial');
  assert.ok(result.diagnostics.some(d => d.code === 'NO_ENTRY_POINTS'));
});

test('inventory is deterministic; changes to inputs change its fingerprint', t => {
  const root = project(t, { 'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'one'}]);` });
  const first = scan(root);
  assert.deepEqual(scan(root), first);
  fs.appendFileSync(path.join(root, 'src/app.ts'), '\n// changed input\n');
  assert.notEqual(scan(root).project.fingerprint, first.project.fingerprint);
});

test('multiple Angular applications require an explicit tsconfig', t => {
  const root = project(t, {
    'angular.json': JSON.stringify({ projects: { a: { architect: { build: { options: { tsConfig: 'tsconfig.json' } } } }, b: { targets: { build: { options: { tsConfig: 'b.json' } } } } } }),
    'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([]);`,
  });
  assert.throws(() => scan(root), /Several applications/);
  assert.equal(scan(root, { tsconfig: 'tsconfig.json' }).scope.status, 'static');
});

test('entry filtering selects registrations and rejects files outside the project', t => {
  const root = project(t, {
    'src/a.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'a'}]);`,
    'src/b.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'b'}]);`,
  });
  assert.deepEqual(scan(root, { entry: 'src/b.ts' }).routes.map(r => r.path), ['b']);
  assert.throws(() => scan(root, { entry: 'missing.ts' }), /not in the analyzed project/);
});

test('fatal configuration and syntax errors do not generate a success report', t => {
  const root = project(t, { 'src/app.ts': 'export const broken = [' });
  assert.throws(() => scan(root), /src\/app.ts/);
  assert.throws(() => scan(root, { tsconfig: 'missing.json' }), /Cannot read/);
});

test('Markdown preserves source evidence and escapes source-controlled formatting', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'<script>|[x]'}]);`,
  });
  const markdown = toMarkdown(scan(root));
  assert.ok(markdown.includes('&lt;script&gt;&#124;&#91;x&#93;'));
  assert.ok(markdown.includes('src/app.ts:1:'));
  assert.ok(!markdown.includes('<script>'));
  assert.ok(markdown.includes('Périmètre et limites'));
});

test('CLI emits clean JSON, writes reports, refuses overwrite and signals partial or fatal failures', t => {
  const root = project(t, { 'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'home'}]);` });
  const run = args => spawnSync(process.execPath, [cli, root, ...args], { encoding: 'utf8' });
  const stdout = run([]);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.equal(JSON.parse(stdout.stdout).routes[0].path, 'home');
  const jsonPath = path.join(root, 'routes.json');
  const mdPath = path.join(root, 'routes.md');
  assert.equal(run(['--json', jsonPath, '--md', mdPath]).status, 0);
  assert.ok(fs.readFileSync(mdPath, 'utf8').includes('/home'));
  const before = fs.readFileSync(jsonPath, 'utf8');
  assert.equal(run(['--json', jsonPath]).status, 1);
  assert.equal(fs.readFileSync(jsonPath, 'utf8'), before);
  fs.writeFileSync(path.join(root, 'src/app.ts'), `import {provideRouter} from '@angular/router'; provideRouter(getRoutes());`);
  const partial = run(['--fail-on-partial']);
  assert.equal(partial.status, 2);
  assert.equal(JSON.parse(partial.stdout).scope.status, 'partial');
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'const broken = [');
  const fatal = run([]);
  assert.equal(fatal.status, 1);
  assert.equal(fatal.stdout, '');
});
