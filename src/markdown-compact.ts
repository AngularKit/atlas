import type { Inventory, RouteRecord } from './model.js';
import { escapeMarkdown as escape, sourceLabel } from './markdown-text.js';

const limitations: Record<string, string> = {
  'Static declarations only; runtime reachability, mutations, permissions and observed user journeys are not evaluated.': 'Déclarations statiques uniquement : les parcours réels, mutations et permissions ne sont pas évalués.',
  'Registration calls are discovered in the selected project, without proving their execution at bootstrap.': 'Les enregistrements sont détectés dans le projet, sans prouver leur exécution au démarrage.',
  'Named outlets, custom matchers, lazy NgModules and arbitrary expressions are reported as unresolved.': 'Les outlets nommés, matchers personnalisés, NgModules différés et expressions non prises en charge sont signalés.',
  'Navigation references (routerLink, navigate, navigateByUrl) are outside this first milestone.': 'Les liens routerLink et les appels navigate / navigateByUrl ne sont pas analysés.',
  'Server rendering policies and generated prerender URLs are outside this first milestone.': 'Les politiques de rendu serveur et les URLs prérendues ne sont pas analysées.',
  'Excluded files lists encountered excluded inputs, not every excluded file on disk.': 'Le relevé des exclusions porte sur les entrées rencontrées, pas sur tous les fichiers du disque.',
  'Route order is the order of discovered siblings; unresolved array spreads can contain additional routes.': 'L’ordre des routes sœurs est conservé ; un tableau non résolu peut contenir des routes supplémentaires.',
};

function notes(route: RouteRecord): string[] {
  const values: string[] = [];
  if (route.component?.loading === 'lazy') values.push('composant chargé à la demande');
  if (route.lazyChildren) values.push('sous-routes chargées à la demande');
  for (const [kind, refs] of Object.entries(route.guards)) values.push(`${kind}: ${refs.map(ref => ref.name ?? ref.expression).join(', ') || 'aucun'}`);
  if (Object.keys(route.resolvers).length) values.push(`resolvers: ${Object.keys(route.resolvers).join(', ')}`);
  if (route.outlet !== 'primary') values.push(`outlet: ${route.outlet ?? 'non résolu'}`);
  if (route.pathMatch !== 'prefix') values.push(`pathMatch: ${route.pathMatch ?? 'non résolu'}`);
  if (route.kind === 'redirect' && !route.redirect) values.push('redirection non résolue');
  return values;
}

function screen(route: RouteRecord): string {
  if (route.redirect) return `→ ${route.redirect.target ?? 'redirection non résolue'}`;
  if (route.component) return route.component.name ?? 'composant non résolu';
  return route.kind === 'container' ? 'Sous-routes' : 'Non résolu';
}

/** Present each sibling group once, with its parent and common metadata above it. */
export function compactMarkdown(inventory: Inventory): string {
  const count = inventory.diagnostics.length;
  const lines = [
    '# Cartographie des routes', '',
    `**${inventory.routes.length} déclarations de routes** · ${count} ${count === 1 ? 'point à vérifier' : 'points à vérifier'} · analyse ${inventory.scope.status === 'partial' ? 'partielle' : 'statique'}.`, '',
    '## À vérifier', '',
  ];
  if (!count) lines.push('Aucun diagnostic dans le périmètre statique pris en charge.', '');
  for (const diagnostic of inventory.diagnostics) {
    const message = diagnostic.code === 'SERVER_RENDERING_NOT_ANALYZED'
      ? 'SSG : les politiques de rendu et les URLs prérendues ne sont pas analysées. Ce rapport décrit les routes client.'
      : diagnostic.message;
    lines.push(`- **${escape(message)}**`, `  Code : ${escape(diagnostic.code)}${diagnostic.routeId ? ` · Route : ${escape(diagnostic.routeId)}` : ''}${diagnostic.source ? ` · Source : ${sourceLabel(diagnostic.source)}` : ''}`, '');
  }
  lines.push('## Lire la carte', '',
    'Chaque section regroupe les routes d’un même parent. Les chemins du tableau sont relatifs au chemin de la section. « Accueil » désigne un chemin vide ; les paramètres comme :id restent des motifs.', '',
    'Les repères r1, r2… identifient les déclarations, y compris celles qui partagent un chemin. Un composant correspond au nom trouvé dans le code. Les guards sont indiqués à leur lieu de déclaration ; ils ne prouvent pas une autorisation métier.', '');

  for (const entry of inventory.entryPoints) {
    lines.push(`## ${inventory.entryPoints.length > 1 ? `${escape(entry.id)} — ` : ''}Carte des routes`, '',
      `Enregistrement : ${escape(entry.kind)} · ${sourceLabel(entry.source)}`, '');
    const groups = new Map<string | null, RouteRecord[]>();
    const byId = new Map<string, RouteRecord>();
    for (const route of inventory.routes.filter(route => route.entryPointId === entry.id)) {
      byId.set(route.id, route);
      const siblings = groups.get(route.parentId) ?? [];
      siblings.push(route);
      groups.set(route.parentId, siblings);
    }
    if (!groups.size) lines.push('Aucune route détectée pour cet enregistrement.', '');
    for (const [parentId, routes] of groups) {
      const parent = parentId ? byId.get(parentId) : undefined;
      lines.push(`### ${parentId ? escape(parent?.fullPath ?? 'Chemin parent non résolu') : 'Racine'}`, '');
      if (parentId) lines.push(`Sous-routes de **${escape(parentId)}**${parent?.component?.name ? ` — ${escape(parent.component.name)}` : ''}.`, '');
      const commonComponent = routes.length > 1 && routes.every(route => !route.redirect && route.component?.name && route.component.declaration
        && route.component.name === routes[0]?.component?.name
        && JSON.stringify(route.component.declaration) === JSON.stringify(routes[0]?.component?.declaration))
        ? routes[0]!.component!.name : null;
      if (commonComponent) lines.push(`Composant commun : **${escape(commonComponent)}**.`, '');
      const details = routes.map(notes);
      const common = routes.length > 1 ? details[0]!.filter(note => details.every(values => values.includes(note))) : [];
      if (common.length) lines.push(`Sur chaque route de cette section : ${common.map(escape).join(' · ')}.`, '');
      lines.push(commonComponent ? '| Chemin | Repère |' : '| Chemin | Composant / destination | Repère |',
        commonComponent ? '|---|---|' : '|---|---|---|');
      for (const route of routes) {
        const routePath = route.path === '' ? 'Accueil (chemin vide)' : route.path ?? 'Non résolu';
        lines.push(`| ${escape(routePath)} | ${commonComponent ? '' : `${escape(screen(route))} | `}${escape(route.id)} |`);
      }
      lines.push('');
      const annotations = new Map<string, string[]>();
      for (const [index, route] of routes.entries()) {
        for (const note of details[index]!.filter(note => !common.includes(note))) {
          const ids = annotations.get(note) ?? [];
          ids.push(route.id);
          annotations.set(note, ids);
        }
      }
      for (const [note, ids] of annotations) lines.push(`- ${escape(note)} — **${ids.map(escape).join(', ')}**`);
      if (annotations.size) lines.push('');
    }
  }
  lines.push('## Périmètre et limites', '', `Configuration : ${escape(inventory.project.tsconfig)}`, '',
    'Les compteurs incluent les conteneurs et chemins vides ; ce ne sont pas des nombres de pages distinctes ou d’URLs prérendues.', '');
  for (const limitation of inventory.scope.limitations) lines.push(`- ${escape(limitations[limitation] ?? limitation)}`);
  return lines.join('\n') + '\n';
}
