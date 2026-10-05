import { createHash } from 'node:crypto';
import type { Inventory } from './model.js';
import { mountAtlas } from './viewer.js';
import { viewerStyle } from './viewer-style.js';

/** Self-contained offline viewer. Inventory strings are inert data, never HTML. */
export function toHtml(inventory: Inventory): string {
  const data = JSON.stringify(inventory).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const script = `(${mountAtlas.toString()})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Atlas — Carte des routes</title><style>${viewerStyle}</style></head>
<body><header><div class="brand"><strong>Atlas</strong><h1>Carte des routes</h1></div><div class="status"><span id="status"></span><button id="warnings" class="warning"></button></div></header>
<div class="toolbar"><div class="search"><label for="search">Retrouver une route ou un composant</label><input id="search" type="search" placeholder="Ex. /cours, profile, LessonLayout…" autocomplete="off"></div><div class="toolbar-actions"><button id="navigation">Références de navigation</button><button id="navigation-edges" aria-pressed="false">Liens de la sélection</button><button id="reset">Vue d’ensemble</button><button id="zoom-out" aria-label="Réduire le zoom">−</button><output id="zoom-value" class="zoom-value">100 %</output><button id="zoom-in" aria-label="Augmenter le zoom">+</button></div></div>
<div id="results" class="results" hidden></div>
<main class="workspace"><section class="map-panel" aria-label="Hiérarchie des routes"><div class="map-summary"><p id="map-count" role="status" aria-live="polite"></p><p class="hint">Dépliez les branches, puis sélectionnez un chemin.</p></div><div id="viewport" class="viewport" tabindex="0" aria-label="Carte défilante des routes"><div id="sizer" class="sizer"><div id="stage" class="stage"></div></div></div><div class="legend"><span>Lien parent–enfant</span><span class="navigation-legend">Navigation déclarée (pointillés)</span><span>Route avec un diagnostic</span></div></section><aside id="inspector" class="inspector" aria-label="Détails de la sélection"></aside></main>
<noscript>Activez JavaScript pour explorer la carte. Les exports Markdown et JSON restent disponibles sans JavaScript.</noscript>
<script id="inventory" type="application/json">${data}</script><script>${script}</script></body></html>\n`;
}
