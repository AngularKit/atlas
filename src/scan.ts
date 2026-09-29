import path from 'node:path';
import ts from 'typescript';
import { Project } from './project.js';
import { StaticReader } from './static.js';
import { guardKinds, type Diagnostic, type EntryPoint, type Inventory, type RouteRecord, type ScanOptions } from './model.js';

export function scan(root = '.', options: ScanOptions = {}): Inventory {
  const project = new Project(root, options);
  const diagnostics: Diagnostic[] = [];
  const routes: RouteRecord[] = [];
  const entryPoints: EntryPoint[] = [];
  let currentRoute: string | null = null;
  const seenDiagnostics = new Set<string>();
  const report = (code: string, message: string, node: ts.Node) => {
    const diagnostic = { code, message, source: project.source(node), routeId: currentRoute };
    const key = JSON.stringify(diagnostic);
    if (!seenDiagnostics.has(key)) {
      seenDiagnostics.add(key);
      diagnostics.push(diagnostic);
    }
  };
  const reader = new StaticReader(project, report);
  const entryFilter = options.entry ? path.resolve(project.root, options.entry) : null;
  if (entryFilter && !project.files.some(f => path.resolve(f.fileName) === entryFilter)) {
    throw new Error(`Entry file is not in the analyzed project: ${options.entry}`);
  }

  function readString(value: ts.Node | undefined, fallback: string | null): string | null {
    if (!value) return fallback;
    const result = reader.string(value);
    if (result === undefined) report('UNRESOLVED_VALUE', 'Expected a static string; expression is not evaluated.', value);
    return result ?? null;
  }

  function component(node: ts.Node, lazy: boolean): RouteRecord['component'] {
    const target = lazy ? reader.lazy(node) : reader.resolve(node);
    if (!target || !ts.isClassDeclaration(target)) {
      report('UNRESOLVED_COMPONENT', 'Component class could not be resolved inside the project.', node);
      return { ...reader.reference(node), loading: lazy ? 'lazy' : 'eager' };
    }
    return {
      expression: node.getText(), name: target.name?.text ?? 'default', source: project.source(node),
      declaration: project.source(target), loading: lazy ? 'lazy' : 'eager',
    };
  }

  function visitArray(input: ts.Node, entryId: string, parent: RouteRecord | null, ancestors = new Set<ts.Node>()): void {
    currentRoute = parent?.id ?? null;
    const array = reader.resolve(input);
    if (!array) return;
    if (ancestors.has(array) || ancestors.size >= 100) {
      report('CYCLIC_ROUTES', 'Cyclic or excessively deep children configuration.', input);
      return;
    }
    const next = new Set(ancestors).add(array);
    const elements = reader.array(array);
    for (const [order, element] of elements.entries()) {
      currentRoute = parent?.id ?? null;
      const routeNode = reader.resolve(element);
      if (routeNode && next.has(routeNode)) {
        report('CYCLIC_ROUTES', 'Route object is already an ancestor of this branch.', element);
        continue;
      }
      const descendants = routeNode ? new Set(next).add(routeNode) : next;
      if (routes.length >= 10_000) {
        report('ANALYSIS_LIMIT', 'Route limit exceeded; remaining routes were not expanded.', element);
        return;
      }
      const id = `r${routes.length + 1}`;
      currentRoute = id;
      const props = reader.object(element);
      const uncertain = !props || reader.incompleteObjects.has(props);
      const field = (key: string) => props?.get(key);
      const routePath = field('matcher') ? null : readString(field('path'), uncertain ? null : '');
      const outlet = readString(field('outlet'), uncertain ? null : 'primary');
      const parentPath = parent ? parent.fullPath : '';
      const fullPath = routePath === null || outlet !== 'primary' || parentPath === null ? null
        : `/${[parentPath, routePath].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/');
      const eager = field('component');
      const lazy = field('loadComponent');
      const redirect = field('redirectTo');
      const children = field('children');
      const lazyChildren = field('loadChildren');
      const record: RouteRecord = {
        id, entryPointId: entryId, parentId: parent?.id ?? null, order,
        source: project.source(element), path: routePath, fullPath,
        pathMatch: readString(field('pathMatch'), uncertain ? null : 'prefix'), outlet,
        kind: redirect ? 'redirect' : eager || lazy ? 'screen' : props && !uncertain ? 'container' : 'unknown',
        component: eager ? component(eager, false) : lazy ? component(lazy, true) : null,
        redirect: redirect ? { expression: redirect.getText(), target: readString(redirect, null), source: project.source(redirect) } : null,
        guards: {}, resolvers: {}, lazyChildren: !!lazyChildren,
      };
      routes.push(record);
      if (field('matcher')) report('CUSTOM_MATCHER', 'Custom matcher retained as an unresolved URL; descendants have no inferred full URL.', field('matcher')!);
      if (outlet !== 'primary') report('NAMED_OUTLET', 'Named or unresolved outlet: no linear full URL is inferred.', field('outlet') ?? element);
      for (const kind of guardKinds) {
        const value = field(kind);
        if (value) record.guards[kind] = reader.array(value).map(node => reader.reference(node));
      }
      const resolve = field('resolve');
      if (resolve) {
        const resolvers = reader.object(resolve);
        if (resolvers) for (const [key, value] of resolvers) {
          Object.defineProperty(record.resolvers, key, { value: reader.reference(value), enumerable: true, configurable: true, writable: true });
        }
      }
      if (eager && lazy) report('CONFLICTING_COMPONENT', 'Both component and loadComponent are declared; eager component shown for inspection.', element);
      if (children && lazyChildren) report('CONFLICTING_CHILDREN', 'Both children and loadChildren are declared; inspect their configuration.', element);
      if (children) visitArray(children, entryId, record, descendants);
      if (lazyChildren) {
        currentRoute = id;
        const target = reader.lazy(lazyChildren);
        if (target) {
          if (ts.isClassDeclaration(target)) report('LAZY_NGMODULE', 'Lazy NgModule route extraction is not supported in this prototype.', lazyChildren);
          else visitArray(target, entryId, record, descendants);
        }
      }
    }
    currentRoute = parent?.id ?? null;
  }

  function discover(node: ts.Node, includeRegistration: boolean): void {
    if (ts.isCallExpression(node)) {
      let kind: EntryPoint['kind'] | undefined;
      if (reader.angularExport(node.expression, 'provideRouter')) kind = 'provideRouter';
      else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'forRoot'
        && reader.angularExport(node.expression.expression, 'RouterModule')) kind = 'RouterModule.forRoot';
      if (kind && includeRegistration) {
        const argument = node.arguments[0];
        const entry: EntryPoint = { id: `e${entryPoints.length + 1}`, kind, source: project.source(node), expression: argument?.getText() ?? '' };
        entryPoints.push(entry);
        if (argument) visitArray(argument, entry.id, null);
        else report('MISSING_ROUTES', 'Router registration has no routes argument.', node);
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'forChild'
        && reader.angularExport(node.expression.expression, 'RouterModule')) {
        report('CHILD_NGMODULE', 'RouterModule.forChild needs NgModule assembly analysis, which is not supported in this prototype.', node);
      }
      if (reader.angularExport(node.expression, 'provideRoutes')) {
        report('ADDITIONAL_ROUTES', 'Additional provideRoutes registration is not assembled in this prototype.', node);
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'resetConfig') {
        const type = project.checker.getTypeAtLocation(node.expression.expression);
        if (type.symbol?.getName() === 'Router') report('RUNTIME_CONFIGURATION', 'Router.resetConfig changes routes at runtime and is not evaluated.', node);
      }
    }
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'provide' && reader.angularExport(node.initializer, 'ROUTES')) {
      report('ADDITIONAL_ROUTES', 'ROUTES injection token provider requires provider assembly analysis.', node);
    }
    ts.forEachChild(node, child => discover(child, includeRegistration));
  }

  for (const file of project.files) {
    discover(file, !entryFilter || path.resolve(file.fileName) === entryFilter);
  }
  if (!entryPoints.length) diagnostics.push({ code: 'NO_ENTRY_POINTS', message: 'No supported Angular router registration found. Select the application tsconfig or an entry source file; this is not proof that the application has no routes.', source: null, routeId: null });

  return {
    schemaVersion: '1.0',
    tool: { name: '@angularkit/atlas', version: '0.1.0', typescriptVersion: ts.version },
    project: {
      tsconfig: project.relative(project.config), fingerprint: project.fingerprint,
      files: project.files.map(f => project.relative(f.fileName)), excludedFiles: project.excludedFiles,
      entryFilter: entryFilter ? project.relative(entryFilter) : null,
    },
    scope: {
      status: diagnostics.length ? 'partial' : 'static',
      limitations: [
        'Static declarations only; runtime reachability, mutations, permissions and observed user journeys are not evaluated.',
        'Registration calls are discovered in the selected project, without proving their execution at bootstrap.',
        'Named outlets, custom matchers, lazy NgModules and arbitrary expressions are reported as unresolved.',
        'Navigation references (routerLink, navigate, navigateByUrl) are outside this first milestone.',
        'Excluded files lists encountered excluded inputs, not every excluded file on disk.',
        'Route order is the order of discovered siblings; unresolved array spreads can contain additional routes.',
      ],
    },
    entryPoints, routes, diagnostics,
  };
}
