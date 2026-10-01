import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { scan, toMarkdown, toCompactInventory, toHtml } from '../dist/index.js';

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

test('expands literal map-generated routes without executing callbacks', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      provideRouter([{path:'known'},...['1','2'].map(id=>({path:'module-'+id}))]);`,
  });
  const result = scan(root);
  assert.deepEqual(result.routes.map(r=>r.fullPath),['/known', '/module-1', '/module-2']);
  assert.deepEqual(result.diagnostics, []);
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


test('generated route bindings survive nested maps, lazy imports and preserve source evidence', t => {
  const root = project(t, {
    'src/app.ts': "import {provideRouter} from '@angular/router'; provideRouter([{path:'courses',loadChildren:()=>import('./generated')}]);",
    'src/generated.ts': `import {Home} from './pages';
const ids = ['alpha', 'beta'] as const;
const guard = () => true;
const resolveItem = (id: string) => () => id;
export default ids.map((id, index) => ({
  path: 'module-' + id,
  component: Home,
  canActivate: [guard],
  resolve: { item: resolveItem(id) },
  children: [1, 2].map(lesson => ({
    path: id + '-' + (index + lesson),
    loadComponent: () => import('./pages').then(m => m.Detail),
  })),
}));`,
  });
  const result = scan(root);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.routes.map(r => r.fullPath), ['/courses', '/courses/module-alpha', '/courses/module-alpha/alpha-1', '/courses/module-alpha/alpha-2', '/courses/module-beta', '/courses/module-beta/beta-2', '/courses/module-beta/beta-3']);
  assert.deepEqual(result.routes.map(r => r.order), [0, 0, 0, 1, 1, 0, 1]);
  for (const route of [result.routes[1], result.routes[4]]) {
    assert.equal(route.component.name, 'Home');
    assert.equal(route.guards.canActivate[0].name, 'guard');
    assert.equal(route.resolvers.item.expression, 'resolveItem(id)');
    assert.deepEqual(route.source, {file:'src/generated.ts', line:5, column:39});
  }
  assert.equal(result.routes[2].parentId, result.routes[1].id);
  assert.equal(result.routes[5].parentId, result.routes[4].id);
  assert.equal(result.routes[5].component.name, 'Detail');
  assert.equal(result.routes[5].component.declaration.file, 'src/pages.ts');
  assert.ok(validate(result), JSON.stringify(validate.errors));
  assert.deepEqual(scan(root), result);
});

test('expands bounded Array.from, templates, const lengths and callback aliases', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
const length = 2 + 1;
const indices = Array.from({ length }, (_, index) => index + 1);
const route = (id: number) => { return { path: \`lesson-\${id}\` }; };
provideRouter([...indices.map(route), ...Array.from({length:2}, (_, index) => ({path:'direct-' + index})), ...[].map(id=>({path:id}))]);`,
  }, {noLib:false});
  const result = scan(root);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.routes.map(r=>r.fullPath), ['/lesson-1', '/lesson-2', '/lesson-3', '/direct-0', '/direct-1']);
});

test('does not confuse callback bindings with same-named constants or sibling callbacks', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
const id = 'global';
const shared = [{path:id}];
provideRouter([...['a','b'].map(id=>({path:id, children:shared})), ...['c'].map(id=>({path:id})), {path:id}]);`,
  });
  const result = scan(root);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.routes.map(r=>r.fullPath), ['/a', '/a/global', '/b', '/b/global', '/c', '/global']);
});

test('unsupported generators remain partial and never run callbacks or application factories', t => {
  const cases = [
    `[1].map(id=>{throw new Error('MUST NOT RUN')})`,
    `[1].map(async id=>({path:'async'}))`,
    `[1].map((id = 2)=>({path:'default'}))`,
    `[1].map((...ids)=>({path:'rest'}))`,
    `[1].map((id, index, array)=>({path:'third-param'}))`,
    `[1].map(id=>({path:'with-this'}), {})`,
    `[getId()].map(id=>({path:'unknown-' + id}))`,
    `[1,,3].map((id,index)=>({path:'hole-' + index}))`,
    `[...getIds(), 3].map((id,index)=>({path:'shifted-' + index}))`,
    `Array.from({length:-1}, (_,i)=>({path:'negative'}))`,
    `Array.from({length:1.5}, (_,i)=>({path:'fractional'}))`,
    `Array.from({length:10001}, (_,i)=>({path:'large'}))`,
    `Array.from({length:2, ...getConfig()}, (_,i)=>({path:'unknown'}))`,
    `Array.from({length:2, [Symbol.iterator]:getIterator}, (_,i)=>({path:'iterable'}))`,
  ];
  for (const expression of cases) {
    const root = project(t, {'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'known'}, ...${expression}]);`}, {noLib:false});
    const result = scan(root);
    assert.deepEqual(result.routes.map(r=>r.fullPath), ['/known'], expression);
    assert.equal(result.scope.status, 'partial', expression);
    assert.ok(result.diagnostics.length, expression);
  }
});

test('does not mistake a shadowed Array.from for the JavaScript builtin', t => {
  const root = project(t, {'src/app.ts': `import {provideRouter} from '@angular/router';
const Array = {from: (...args:unknown[])=>{throw new Error('MUST NOT RUN')}};
provideRouter(Array.from({length:2}, (_,i)=>({path:'fake-' + i})));`}, {noLib:false});
  const result = scan(root);
  assert.deepEqual(result.routes, []);
  assert.ok(result.diagnostics.some(d=>d.code==='UNRESOLVED_ARRAY'));
});

test('generated dynamic fields remain unresolved while static siblings are retained', t => {
  const root = project(t, {'src/app.ts': `import {provideRouter} from '@angular/router';
provideRouter(['a','b'].map(id=>({path:computePath(id), children:[{path:'child'}]})));`});
  const result = scan(root);
  assert.equal(result.routes.length, 4);
  assert.ok(result.routes.every(route=>route.fullPath===null));
  assert.equal(result.diagnostics.filter(d=>d.code==='UNRESOLVED_VALUE').length,2);
});

test('generated array cycles terminate and unknown bindings cannot invent template paths', t => {
  const root = project(t, {'src/app.ts': `import {provideRouter} from '@angular/router';
const recursive = recursive.map(id=>({path:id}));
provideRouter([...recursive, ...['a'].map(id=>({path: \`\${unknown}-\${id}\`}))]);`});
  const result = scan(root);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].fullPath, null);
  assert.ok(result.diagnostics.some(d=>d.code==='CYCLIC_REFERENCE'));
  assert.ok(result.diagnostics.some(d=>d.code==='UNRESOLVED_VALUE'));
});


test('compact projection retains route identity, uncertainty and diagnostics without repeated evidence', t => {
  const root = project(t, {'src/app.ts': `import {provideRouter} from '@angular/router';
import {Home} from './pages';
const auth=()=>true; const resolveItem=()=>1;
provideRouter([{path:'',component:Home,canActivate:[auth],resolve:{item:resolveItem},children:[{path:'same'},{path:'same'},{path:'chat',outlet:'aside'},{path:computePath()}]}, {path:'old',redirectTo:'/',pathMatch:'full'}, {path:'dynamic',redirectTo:()=>'/'}]);
provideRouter([{path:'same'}]);`});
  const full = scan(root);
  const before = structuredClone(full);
  const compact = toCompactInventory(full);
  const schema = JSON.parse(fs.readFileSync(new URL('../schema/compact-inventory-v1.schema.json', import.meta.url), 'utf8'));
  const validateCompact = new Ajv({allErrors:true}).compile(schema);
  assert.ok(validateCompact(compact), JSON.stringify(validateCompact.errors));
  assert.equal(compact.format,'compact');
  assert.deepEqual(compact.scope,full.scope);
  assert.deepEqual(compact.diagnostics,full.diagnostics);
  assert.deepEqual(compact.routes.map(r=>[r.id,r.parentId,r.order,r.entryPointId,r.path,r.fullPath]),full.routes.map(r=>[r.id,r.parentId,r.order,r.entryPointId,r.path,r.fullPath]));
  assert.deepEqual(compact.routes[0].guards,{canActivate:['auth']});
  assert.deepEqual(compact.routes[0].resolvers,{item:'resolveItem'});
  assert.deepEqual(compact.routes[0].component,{name:'Home',loading:'eager'});
  assert.equal(compact.routes[3].outlet,'aside');
  assert.equal(compact.routes[4].fullPath,null);
  assert.equal(compact.routes[5].pathMatch,'full');
  assert.equal(compact.routes[6].redirect.target,null);
  assert.ok(!('files' in compact.project));
  assert.ok(!('guards' in compact.routes[1]));
  assert.ok(!('declaration' in compact.routes[0].component));
  const md=toMarkdown(full,{compact:true});
  assert.ok(md.includes('Cartographie des routes'));
  assert.ok(md.includes('canActivate: auth'));
  assert.ok(md.includes('resolvers: item'));
  assert.ok(md.includes('→ /'));
  assert.ok(md.includes('outlet: aside'));
  for(const route of full.routes) assert.ok(md.includes(`| ${route.id} |`));
  assert.ok(md.includes('UNRESOLVED&#95;VALUE'));
  assert.ok(md.includes('Périmètre et limites'));
  assert.ok(!md.includes('### Détail'));
  assert.ok(!md.includes('### Fichiers analysés'));
  assert.ok(toMarkdown(full).includes('### Détail'));
  compact.scope.limitations.push('consumer edit');
  compact.diagnostics[0].message='consumer edit';
  assert.deepEqual(full,before);
});

test('compact CLI supports JSON, Markdown and stdout while preserving partial exit status and escaping', t => {
  const root=project(t,{'src/app.ts':`import {provideRouter} from '@angular/router'; provideRouter([{path:'<script>|[x]',redirectTo:computeRedirect()}]);`});
  const run=args=>spawnSync(process.execPath,[cli,root,...args],{encoding:'utf8'});
  const normal=run([]);
  assert.ok(!('format' in JSON.parse(normal.stdout)));
  const stdout=run(['--compact','--fail-on-partial']);
  assert.equal(stdout.status,2,stdout.stderr);
  assert.equal(JSON.parse(stdout.stdout).format,'compact');
  const json=path.join(root,'compact.json'), md=path.join(root,'compact.md');
  const files=run(['--compact','--json',json,'--md',md,'--fail-on-partial']);
  assert.equal(files.status,2,files.stderr);
  assert.equal(files.stdout,'');
  assert.deepEqual(JSON.parse(fs.readFileSync(json,'utf8')),JSON.parse(stdout.stdout));
  const markdown=fs.readFileSync(md,'utf8');
  assert.ok(markdown.includes('&lt;script&gt;&#124;&#91;x&#93;'));
  assert.ok(!markdown.includes('<script>'));
  assert.ok(markdown.includes('UNRESOLVED&#95;VALUE'));
  assert.equal(run(['--compact','--json',json]).status,1);
});


test('readable Markdown groups siblings and shared metadata without conflating same-named components', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
import {Home} from './pages'; import {Home as OtherHome} from './other';
const auth = () => true;
provideRouter([{path:'area',children:[{path:'one',component:Home,canActivate:[auth]}, {path:'two',component:Home,canActivate:[auth]}]}, {path:'other',children:[{path:'same',component:Home}, {path:'same',component:OtherHome}]}]);
provideRouter([]);`,
    'src/other.ts': 'export class Home {}',
  });
  const inventory = scan(root);
  const markdown = toMarkdown(inventory, {compact:true});
  assert.ok(markdown.indexOf('## À vérifier') < markdown.indexOf('## e1 — Carte des routes'));
  assert.ok(markdown.includes('### /area'));
  assert.ok(markdown.includes('Sous-routes de **r1**'));
  assert.equal(markdown.match(/Composant commun : \*\*Home\*\*/g)?.length, 1);
  assert.equal(markdown.match(/canActivate: auth/g)?.length, 1);
  assert.ok(markdown.includes('| one | r2 |'));
  assert.ok(markdown.includes('| two | r3 |'));
  assert.ok(markdown.includes('| same | Home | r5 |'));
  assert.ok(markdown.includes('| same | Home | r6 |'));
  for(const route of inventory.routes) assert.equal(markdown.split(`| ${route.id} |`).length - 1, 1);
  assert.ok(markdown.includes('## e2 — Carte des routes'));
  assert.ok(markdown.includes('Aucune route détectée pour cet enregistrement.'));
});


test('HTML export embeds the full inventory safely and the CLI preserves output contracts', t => {
  const root=project(t, {'src/app.ts': `import {provideRouter} from '@angular/router'; provideRouter([{path:'<script>|&',children:getRoutes()}]);`});
  const inventory=scan(root);
  const html=toHtml(inventory);
  assert.equal(toHtml(inventory),html);
  assert.match(html,/Content-Security-Policy/);
  const data=html.match(/<script id="inventory" type="application\/json">([^]*?)<\/script>/)[1];
  assert.ok(!data.includes('<'));
  assert.deepEqual(JSON.parse(data),inventory);
  const file=path.join(root,'map.html');
  const json=path.join(root,'map.json');
  const run=args=>spawnSync(process.execPath,[cli,root,...args],{encoding:'utf8'});
  const result=run(['--html',file,'--json',json,'--compact','--fail-on-partial']);
  assert.equal(result.status,2,result.stderr); assert.equal(result.stdout,'');
  assert.equal(fs.readFileSync(file,'utf8'),html);
  assert.equal(JSON.parse(fs.readFileSync(json,'utf8')).format,'compact');
  assert.equal(run(['--html',file]).status,1);
  const duplicate=path.join(root,'duplicate');
  assert.equal(run(['--html',duplicate,'--md',duplicate]).status,1);
  assert.ok(!fs.existsSync(duplicate));
});

test('diagnostic contexts stay attached to parents, siblings and global registrations', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      import {withRoutes} from '@angular/ssr';
      provideRouter([
        {path:'parent',children:[{path:'child',children:unknownChildren()}],loadChildren:unknownLoader()},
        {path:unknownPath()}
      ]);
      withRoutes([]);
      provideRouter(unknownRoutes());`,
  });
  const result = scan(root);
  const [parent, child, sibling] = result.routes;
  const at = expression => result.diagnostics.filter(d => {
    const source = fs.readFileSync(path.join(root, d.source.file), 'utf8').split('\n')[d.source.line - 1];
    return source.slice(d.source.column - 1).startsWith(expression);
  });
  assert.equal(at('unknownChildren()')[0].routeId, child.id);
  assert.equal(at('unknownLoader()')[0].routeId, parent.id);
  assert.equal(at('unknownPath()')[0].routeId, sibling.id);
  assert.equal(at('unknownRoutes()')[0].routeId, null);
  assert.equal(result.diagnostics.find(d => d.code === 'CONFLICTING_CHILDREN').routeId, parent.id);
  assert.equal(result.diagnostics.find(d => d.code === 'SERVER_RENDERING_NOT_ANALYZED').routeId, null);
});

test('route limit diagnostics do not leak the last child into parent or global contexts', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      import {withRoutes} from '@angular/ssr';
      const many = [${Array(10_000).fill('{}').join(',')}];
      provideRouter([{path:'parent',children:many},{path:'later'}]);
      withRoutes([]);`,
  });
  const result = scan(root);
  assert.equal(result.routes.length, 10_000);
  assert.deepEqual(result.diagnostics.filter(d => d.code === 'ANALYSIS_LIMIT').map(d => d.routeId), [result.routes[0].id, null]);
  assert.equal(result.diagnostics.find(d => d.code === 'SERVER_RENDERING_NOT_ANALYZED').routeId, null);
  assert.ok(validate(result), JSON.stringify(validate.errors));
});

test('static operation budget is shared across route diagnostic contexts', t => {
  const root = project(t, {
    'src/app.ts': `import {provideRouter} from '@angular/router';
      provideRouter([${Array(2_000).fill('1').join(',')}].map(() => ({path:${Array(16).fill("'x'").join('+')}})));`,
  });
  const result = scan(root);
  assert.ok(result.diagnostics.some(d => d.code === 'ANALYSIS_LIMIT'));
  assert.equal(result.scope.status, 'partial');
  assert.equal(result.routes[0].path, 'x'.repeat(16));
});
