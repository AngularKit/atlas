import type { Inventory, Source } from './model.js';

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('|', '&#124;').replaceAll('`', '&#96;').replaceAll('*', '&#42;').replaceAll('_', '&#95;')
  .replaceAll('[', '&#91;').replaceAll(']', '&#93;').replace(/[\r\n]+/g, ' ');
const source = (value: Source) => `${escape(value.file)}:${value.line}:${value.column}`;

export interface MarkdownOptions { compact?: boolean; }

export function toMarkdown(inventory: Inventory, options: MarkdownOptions = {}): string {
  const lines = [
    options.compact ? '# AngularKit Atlas — synthèse des routes' : '# AngularKit Atlas — inventaire des routes', '',
    `Analyse **${inventory.scope.status === 'partial' ? 'partielle' : 'statique'}** · ${inventory.routes.length} routes détectées · ${inventory.diagnostics.length} diagnostics.`, '',
    `Configuration : ${escape(inventory.project.tsconfig)}`, '',
    ...(options.compact ? [] : [`Empreinte : \`${inventory.project.fingerprint}\``, '']),
    'Les chemins paramétrés sont des motifs. Les guards sont présentés à leur lieu de déclaration ; leur présence ne prouve pas une autorisation métier.', '',
  ];
  for (const entry of inventory.entryPoints) {
    lines.push(`## ${escape(entry.kind)} — ${source(entry.source)}`, '');
    if (!options.compact) lines.push('### Arbre', '');
    const routes = inventory.routes.filter(r => r.entryPointId === entry.id);
    const depths = new Map<string, number>();
    for (const route of routes) {
      const depth = route.parentId ? (depths.get(route.parentId) ?? 0) + 1 : 0;
      depths.set(route.id, depth);
      const details: string[] = [];
      if (options.compact) {
        if (route.component?.loading === 'lazy' || route.lazyChildren) details.push('différé');
        for (const [kind, refs] of Object.entries(route.guards)) details.push(`${kind}: ${refs.map(ref => ref.name ?? ref.expression).join(', ') || 'aucun'}`);
        if (Object.keys(route.resolvers).length) details.push(`resolvers: ${Object.keys(route.resolvers).join(', ')}`);
        if (route.redirect) details.push(`→ ${route.redirect.target ?? '(non résolue)'}`);
        if (route.outlet !== 'primary') details.push(`outlet: ${route.outlet ?? '(non résolu)'}`);
        if (route.pathMatch !== 'prefix') details.push(`pathMatch: ${route.pathMatch ?? '(non résolu)'}`);
      }
      lines.push(`${'  '.repeat(depth)}- ${escape(route.path === '' ? '(chemin vide)' : route.path ?? '(chemin non résolu)')} — ${escape(route.component?.name ?? route.kind)} (${route.id})${details.length ? ` · ${details.map(escape).join(' · ')}` : ''}`);
    }
    if (options.compact) { lines.push(''); continue; }
    lines.push('', '### Détail', '', '| ID / parent | Motif complet | Composant | Chargement | Guards déclarés | Resolvers | Redirection déclarée | Source |', '|---|---|---|---|---|---|---|---|');
    for (const route of routes) {
      const guards = Object.entries(route.guards).map(([kind, refs]) => `${kind}: ${refs.map(ref => ref.name ?? ref.expression).join(', ')}`).join('; ');
      const resolvers = Object.entries(route.resolvers).map(([key, value]) => `${key}: ${value.name ?? value.expression}`).join('; ');
      lines.push(`| ${route.id} / ${route.parentId ?? '—'} | ${escape(route.fullPath ?? 'Non résolu')} | ${escape(route.component?.name ?? '—')} | ${route.component?.loading ?? '—'} | ${escape(guards || '—')} | ${escape(resolvers || '—')} | ${escape(route.redirect?.target ?? route.redirect?.expression ?? '—')} | ${source(route.source)} |`);
    }
    lines.push('');
  }
  lines.push('## Diagnostics', '');
  if (!inventory.diagnostics.length) lines.push('Aucun diagnostic dans le périmètre statique pris en charge.');
  for (const diagnostic of inventory.diagnostics) lines.push(`- **${escape(diagnostic.code)}**${diagnostic.routeId ? ` (${diagnostic.routeId})` : ''} — ${escape(diagnostic.message)}${diagnostic.source ? ` — ${source(diagnostic.source)}` : ''}`);
  lines.push('', '## Périmètre et limites', '');
  for (const limitation of inventory.scope.limitations) lines.push(`- ${escape(limitation)}`);
  if (options.compact) return lines.join('\n') + '\n';
  lines.push('', '### Fichiers analysés', '');
  for (const file of inventory.project.files) lines.push(`- ${escape(file)}`);
  lines.push('', '### Fichiers exclus rencontrés', '');
  for (const file of inventory.project.excludedFiles) lines.push(`- ${escape(file)}`);
  return lines.join('\n') + '\n';
}
