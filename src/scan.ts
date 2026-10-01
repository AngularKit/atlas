import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Project } from './project.js';
import { StaticReader } from './static.js';
import { guardKinds, type Diagnostic, type EntryPoint, type Inventory, type RouteRecord, type ScanOptions } from './model.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export function scan(root = '.', options: ScanOptions = {}): Inventory {
  const project = new Project(root, options);
  const diagnostics: Diagnostic[] = [];
  const routes: RouteRecord[] = [];
  const entryPoints: EntryPoint[] = [];
  const seenDiagnostics = new Set<string>();
  const report = (code: string, message: string, node: ts.Node, routeId: string | null = null) => {
    const diagnostic = { code, message, source: project.source(node), routeId };
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

  function readString(context: StaticReader, value: ts.Node | undefined, fallback: string | null): string | null {
    if (!value) return fallback;
    const result = context.string(value);
    if (result === undefined) {
      context.report('UNRESOLVED_VALUE', 'Expected a static string; expression is not evaluated.', value);
    }
    return result ?? null;
  }

  function component(context: StaticReader, node: ts.Node, lazy: boolean): RouteRecord['component'] {
    const target = lazy ? context.lazy(node) : context.resolve(node);
    if (!target || !ts.isClassDeclaration(target)) {
      context.report('UNRESOLVED_COMPONENT', 'Component class could not be resolved inside the project.', node);
      return { ...context.reference(node), loading: lazy ? 'lazy' : 'eager' };
    }
    return {
      expression: node.getText(),
      name: target.name?.text ?? 'default',
      source: project.source(node),
      declaration: project.source(target),
      loading: lazy ? 'lazy' : 'eager',
    };
  }

  function readRoute(
    context: StaticReader, element: ts.Node, props: Map<string, ts.Node> | undefined,
    id: string, entryId: string, parent: RouteRecord | null, order: number,
  ): RouteRecord {
    const uncertain = !props || context.incompleteObjects.has(props);
    const routePath = props?.has('matcher') ? null : readString(context, props?.get('path'), uncertain ? null : '');
    const outlet = readString(context, props?.get('outlet'), uncertain ? null : 'primary');
    const parentPath = parent ? parent.fullPath : '';
    let fullPath: string | null = null;
    if (routePath !== null && outlet === 'primary' && parentPath !== null) {
      fullPath = `/${[parentPath, routePath].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/');
    }
    const eager = props?.get('component');
    const lazy = props?.get('loadComponent');
    const redirect = props?.get('redirectTo');
    let kind: RouteRecord['kind'] = uncertain ? 'unknown' : 'container';
    if (eager || lazy) kind = 'screen';
    if (redirect) kind = 'redirect';
    let resolvedComponent: RouteRecord['component'] = null;
    if (eager) resolvedComponent = component(context, eager, false);
    else if (lazy) resolvedComponent = component(context, lazy, true);
    return {
      id, entryPointId: entryId, parentId: parent?.id ?? null, order,
      source: project.source(element), path: routePath, fullPath,
      pathMatch: readString(context, props?.get('pathMatch'), uncertain ? null : 'prefix'),
      outlet, kind, component: resolvedComponent,
      redirect: redirect ? {
        expression: redirect.getText(), target: readString(context, redirect, null), source: project.source(redirect),
      } : null,
      guards: {}, resolvers: {}, lazyChildren: !!props?.has('loadChildren'),
    };
  }

  function readMetadata(context: StaticReader, record: RouteRecord, props: Map<string, ts.Node> | undefined, element: ts.Node): void {
    const matcher = props?.get('matcher');
    if (matcher) {
      context.report('CUSTOM_MATCHER', 'Custom matcher retained as an unresolved URL; descendants have no inferred full URL.', matcher);
    }
    if (record.outlet !== 'primary') {
      context.report('NAMED_OUTLET', 'Named or unresolved outlet: no linear full URL is inferred.', props?.get('outlet') ?? element);
    }
    for (const kind of guardKinds) {
      const value = props?.get(kind);
      if (!value) continue;
      record.guards[kind] = context.array(value).map(scoped =>
        context.withElement(scoped, node => context.reference(node)));
    }
    const resolve = props?.get('resolve');
    const resolvers = resolve ? context.object(resolve) : undefined;
    for (const [key, value] of resolvers ?? []) {
      Object.defineProperty(record.resolvers, key, {
        value: context.reference(value), enumerable: true, configurable: true, writable: true,
      });
    }
    if (props?.has('component') && props.has('loadComponent')) {
      context.report('CONFLICTING_COMPONENT', 'Both component and loadComponent are declared; eager component shown for inspection.', element);
    }
    if (props?.has('children') && props.has('loadChildren')) {
      context.report('CONFLICTING_CHILDREN', 'Both children and loadChildren are declared; inspect their configuration.', element);
    }
  }

  function visitChildren(context: StaticReader, record: RouteRecord, props: Map<string, ts.Node> | undefined, ancestors: Set<ts.Node>): void {
    const children = props?.get('children');
    if (children) visitArray(context, children, record.entryPointId, record, ancestors);
    const lazyChildren = props?.get('loadChildren');
    if (!lazyChildren) return;
    const target = context.lazy(lazyChildren);
    if (!target) return;
    if (ts.isClassDeclaration(target)) {
      context.report('LAZY_NGMODULE', 'Lazy NgModule route extraction is not supported in this prototype.', lazyChildren);
    } else {
      visitArray(context, target, record.entryPointId, record, ancestors);
    }
  }

  function visitRoute(
    parentContext: StaticReader, element: ts.Node, entryId: string,
    parent: RouteRecord | null, order: number, ancestors: Set<ts.Node>,
  ): void {
    const routeNode = parentContext.resolve(element);
    if (routeNode && ancestors.has(routeNode)) {
      parentContext.report('CYCLIC_ROUTES', 'Route object is already an ancestor of this branch.', element);
      return;
    }
    const descendants = routeNode ? new Set(ancestors).add(routeNode) : ancestors;
    const id = `r${routes.length + 1}`;
    const context = parentContext.withReporter((code, message, node) => report(code, message, node, id));
    const props = context.object(element);
    const record = readRoute(context, element, props, id, entryId, parent, order);
    routes.push(record);
    readMetadata(context, record, props, element);
    visitChildren(context, record, props, descendants);
  }

  function visitArray(
    context: StaticReader, input: ts.Node, entryId: string,
    parent: RouteRecord | null, ancestors = new Set<ts.Node>(),
  ): void {
    const array = context.resolve(input);
    if (!array) return;
    if (ancestors.has(array) || ancestors.size >= 100) {
      context.report('CYCLIC_ROUTES', 'Cyclic or excessively deep children configuration.', input);
      return;
    }
    const next = new Set(ancestors).add(array);
    for (const [order, scoped] of context.array(array).entries()) {
      if (routes.length >= 10_000) {
        context.report('ANALYSIS_LIMIT', 'Route limit exceeded; remaining routes were not expanded.', scoped.node);
        return;
      }
      context.withElement(scoped, element => visitRoute(context, element, entryId, parent, order, next));
    }
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
        if (argument) visitArray(reader, argument, entry.id, null);
        else report('MISSING_ROUTES', 'Router registration has no routes argument.', node);
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'forChild'
        && reader.angularExport(node.expression.expression, 'RouterModule')) {
        report('CHILD_NGMODULE', 'RouterModule.forChild needs NgModule assembly analysis, which is not supported in this prototype.', node);
      }
      if (reader.angularExport(node.expression, 'provideRoutes')) {
        report('ADDITIONAL_ROUTES', 'Additional provideRoutes registration is not assembled in this prototype.', node);
      }
      if (reader.angularExport(node.expression, 'withRoutes', '@angular/ssr')
        || reader.angularExport(node.expression, 'provideServerRouting', '@angular/ssr')) {
        report('SERVER_RENDERING_NOT_ANALYZED', 'Server rendering configuration detected. RenderMode, prerender parameters and generated URLs are not analyzed; this report inventories client route declarations only.', node);
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
    tool: { name: '@angularkit/atlas', version, typescriptVersion: ts.version },
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
        'Server rendering policies and generated prerender URLs are outside this first milestone.',
        'Excluded files lists encountered excluded inputs, not every excluded file on disk.',
        'Route order is the order of discovered siblings; unresolved array spreads can contain additional routes.',
      ],
    },
    entryPoints, routes, diagnostics,
  };
}
