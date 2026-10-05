import type { Inventory } from './model.js';
import { escapeMarkdown as escape, sourceLabel } from './markdown-text.js';

export function navigationMarkdown(inventory: Inventory, compact = false): string[] {
  if (!inventory.navigation) return [];
  const { references, diagnostics, status } = inventory.navigation;
  const lines = ['', '## Navigation déclarée', '', `${references.length} références · analyse ${status === 'partial' ? 'partielle' : 'statique'}.`, '',
    'Les destinations sont des candidates, pas des parcours observés. Les wildcards, guards et redirections ne sont pas évalués. Un lien sans correspondance explicite n’est pas nécessairement cassé.', '',
    '| Origine | Destination / état | Référence | Source |', '|---|---|---|---|'];
  for (const ref of references) {
    const origin = ref.sourceRouteId ?? ref.owner?.name ?? 'Contexte inconnu';
    const label = { matched: 'candidate', unmatched: 'sans correspondance explicite', unresolved: 'non résolu', disabled: 'désactivé' }[ref.status];
    lines.push(`| ${escape(origin)} | ${escape(ref.target ?? label)}${ref.target ? ` (${label})` : ''} | ${escape(ref.id)} · ${escape(ref.kind)}${compact ? '' : ` : ${escape(ref.expression)}`} | ${sourceLabel(ref.source)} |`);

  }
  if (!compact) for (const ref of references) if (ref.reason) lines.push('', `- ${escape(ref.id)} : ${escape(ref.reason)}`);
  for (const diagnostic of diagnostics) lines.push('', `- **${escape(diagnostic.code)}** — ${escape(diagnostic.message)}${diagnostic.source ? ` — ${sourceLabel(diagnostic.source)}` : ''}`);
  return lines;
}
