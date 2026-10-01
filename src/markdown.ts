import type { Inventory } from './model.js';
import { escapeMarkdown as escape, sourceLabel as source } from './markdown-text.js';
import { compactMarkdown } from './markdown-compact.js';

export interface MarkdownOptions { compact?: boolean; }

export function toMarkdown(inventory: Inventory, options: MarkdownOptions = {}): string {
  if (options.compact) return compactMarkdown(inventory);
  const lines = [
    '# AngularKit Atlas — inventaire des routes', '',
    `Analyse **${inventory.scope.status === 'partial' ? 'partielle' : 'statique'}** · ${inventory.routes.length} routes détectées · ${inventory.diagnostics.length} diagnostics.`, '',
    `Configuration : ${escape(inventory.project.tsconfig)}`, '',
    `Empreinte : \`${inventory.project.fingerprint}\``, '',
    'Les chemins paramétrés sont des motifs. Les guards sont présentés à leur lieu de déclaration ; leur présence ne prouve pas une autorisation métier.', '',
  ];
  for (const entry of inventory.entryPoints) {
    lines.push(`## ${escape(entry.kind)} — ${source(entry.source)}`, '');
    lines.push('### Arbre', '');
    const routes = inventory.routes.filter(r => r.entryPointId === entry.id);
    const depths = new Map<string, number>();
    for (const route of routes) {
      const depth = route.parentId ? (depths.get(route.parentId) ?? 0) + 1 : 0;
      depths.set(route.id, depth);
      lines.push(`${'  '.repeat(depth)}- ${escape(route.path === '' ? '(chemin vide)' : route.path ?? '(chemin non résolu)')} — ${escape(route.component?.name ?? route.kind)} (${route.id})`);
    }
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
  lines.push('', '### Fichiers analysés', '');
  for (const file of inventory.project.files) lines.push(`- ${escape(file)}`);
  lines.push('', '### Fichiers exclus rencontrés', '');
  for (const file of inventory.project.excludedFiles) lines.push(`- ${escape(file)}`);
  return lines.join('\n') + '\n';
}
