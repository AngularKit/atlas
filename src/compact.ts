import type { GuardKind, Inventory, RouteRecord } from './model.js';

export interface CompactRoute extends Pick<RouteRecord, 'id' | 'entryPointId' | 'parentId' | 'order' | 'path' | 'fullPath' | 'kind'> {
  source: string;
  /** Omitted when primary; null remains unresolved. */
  outlet?: string | null;
  /** Omitted when prefix; null remains unresolved. */
  pathMatch?: string | null;
  component?: { name: string; loading: 'eager' | 'lazy' };
  redirect?: { target: string | null; expression: string };
  guards?: Partial<Record<GuardKind, string[]>>;
  resolvers?: Record<string, string>;
  lazyChildren?: true;
}

export interface CompactInventory {
  schemaVersion: '1.0';
  format: 'compact';
  tool: Inventory['tool'];
  project: Pick<Inventory['project'], 'tsconfig' | 'fingerprint' | 'entryFilter'>;
  scope: Inventory['scope'];
  entryPoints: Omit<Inventory['entryPoints'][number], 'expression'>[];
  routes: CompactRoute[];
  diagnostics: Inventory['diagnostics'];
}

/** A summary projection; scan() continues to return the full evidence model. */
export function toCompactInventory(inventory: Inventory): CompactInventory {
  return {
    schemaVersion: '1.0', format: 'compact', tool: { ...inventory.tool },
    project: { tsconfig: inventory.project.tsconfig, fingerprint: inventory.project.fingerprint, entryFilter: inventory.project.entryFilter },
    scope: { status: inventory.scope.status, limitations: [...inventory.scope.limitations] },
    entryPoints: inventory.entryPoints.map(({ id, kind, source }) => ({ id, kind, source: { ...source } })),
    routes: inventory.routes.map(route => ({
      id: route.id, entryPointId: route.entryPointId, parentId: route.parentId, order: route.order,
      path: route.path, fullPath: route.fullPath, kind: route.kind,
      source: `${route.source.file}:${route.source.line}:${route.source.column}`,
      ...(route.outlet !== 'primary' ? { outlet: route.outlet } : {}),
      ...(route.pathMatch !== 'prefix' ? { pathMatch: route.pathMatch } : {}),
      ...(route.component ? { component: { name: route.component.name ?? route.component.expression, loading: route.component.loading } } : {}),
      ...(route.redirect ? { redirect: { target: route.redirect.target, expression: route.redirect.expression } } : {}),
      ...(Object.keys(route.guards).length ? { guards: Object.fromEntries(Object.entries(route.guards).map(([kind, refs]) => [kind, refs.map(ref => ref.name ?? ref.expression)])) } : {}),
      ...(Object.keys(route.resolvers).length ? { resolvers: Object.fromEntries(Object.entries(route.resolvers).map(([key, ref]) => [key, ref.name ?? ref.expression])) } : {}),
      ...(route.lazyChildren ? { lazyChildren: true as const } : {}),
    })),
    diagnostics: inventory.diagnostics.map(diagnostic => ({ ...diagnostic, source: diagnostic.source ? { ...diagnostic.source } : null })),
  };
}
