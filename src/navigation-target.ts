import type { NavigationReference, RouteRecord } from './model.js';

export function navigationTarget(
  commands: (string | number)[] | null, url: string | null,
  base: string | null, reason: string | null, disabled: boolean,
  routes: RouteRecord[], entryPointId?: string,
): Pick<NavigationReference, 'target' | 'targetRouteIds' | 'status' | 'reason'> {
  const unresolved = (message: string) => ({ target: null, targetRouteIds: [], status: 'unresolved' as const, reason: message });
  if (disabled) return { target: null, targetRouteIds: [], status: 'disabled', reason: 'routerLink is null or undefined.' };
  if (reason) return unresolved(reason);
  let segments: string[];
  if (url !== null) {
    if (!url.startsWith('/') || url.startsWith('//') || /[();%]/.test(url.split(/[?#]/)[0]!)) {
      return unresolved('Only absolute primary-outlet URL strings without encoded or matrix segments are resolved.');
    }
    segments = url.split(/[?#]/)[0]!.split('/').filter(Boolean);
  } else {
    if (!commands) return unresolved('Destination depends on a dynamic or unsupported expression.');
    const first = String(commands[0] ?? '');
    if (commands.slice(1).some(value => /[/]/.test(String(value)) || value === '.' || value === '..')
      || commands.some(value => /[?#();%]/.test(String(value))) || first.startsWith('//')) {
      return unresolved('Command encoding, outlets, query characters or matrix parameters are not resolved.');
    }
    const absolute = first.startsWith('/');
    if (!absolute && base === null) return unresolved('The activated route context is unknown.');
    segments = absolute ? [] : base!.split('/').filter(Boolean);
    const parts = [...first.split('/'), ...commands.slice(1).map(String)];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!segments.length) return unresolved('Relative navigation goes above the known root.');
        segments.pop();
      } else segments.push(part);
    }
    if (segments.some(segment => segment.startsWith(':') || segment === '**')) {
      return unresolved('Relative navigation retains runtime route parameters.');
    }
  }
  const target = '/' + segments.join('/');
  const candidates = routes.filter(route => {
    if (entryPointId && route.entryPointId !== entryPointId) return false;
    if (route.fullPath === null || route.outlet !== 'primary') return false;
    const pattern = route.fullPath.split('/').filter(Boolean);
    return !pattern.includes('**') && pattern.length === segments.length
      && pattern.every((segment, index) => segment.startsWith(':') || segment === segments[index]);
  });
  return { target, targetRouteIds: candidates.map(route => route.id),
    status: candidates.length ? 'matched' : 'unmatched',
    reason: candidates.length ? null : 'No explicit route pattern matches in the inventory; wildcard fallbacks and unresolved routes may still handle this destination.' };
}
