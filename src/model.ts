export interface Source {
  file: string;
  line: number;
  column: number;
}

export interface Reference {
  expression: string;
  name: string | null;
  source: Source;
  declaration: Source | null;
}

export const guardKinds = ['canActivate', 'canActivateChild', 'canMatch', 'canDeactivate', 'canLoad'] as const;
export type GuardKind = typeof guardKinds[number];

export interface RouteRecord {
  id: string;
  entryPointId: string;
  parentId: string | null;
  order: number;
  source: Source;
  path: string | null;
  fullPath: string | null;
  pathMatch: string | null;
  outlet: string | null;
  kind: 'screen' | 'redirect' | 'container' | 'unknown';
  component: (Reference & { loading: 'eager' | 'lazy' }) | null;
  redirect: { expression: string; target: string | null; source: Source } | null;
  guards: Partial<Record<GuardKind, Reference[]>>;
  resolvers: Record<string, Reference>;
  lazyChildren: boolean;
}

export interface Diagnostic {
  code: string;
  message: string;
  source: Source | null;
  routeId: string | null;
}

export interface EntryPoint {
  id: string;
  kind: 'provideRouter' | 'RouterModule.forRoot';
  source: Source;
  expression: string;
}

export interface Inventory {
  schemaVersion: '1.0';
  tool: { name: '@angularkit/atlas'; version: string; typescriptVersion: string };
  project: {
    tsconfig: string;
    fingerprint: string;
    files: string[];
    excludedFiles: string[];
    entryFilter: string | null;
  };
  scope: {
    status: 'static' | 'partial';
    limitations: string[];
  };
  entryPoints: EntryPoint[];
  routes: RouteRecord[];
  diagnostics: Diagnostic[];
}

export interface ScanOptions {
  tsconfig?: string;
  /** Restrict router registration discovery to this source file, relative to root. */
  entry?: string;
}
