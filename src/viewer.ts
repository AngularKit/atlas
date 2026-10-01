import type { Inventory, RouteRecord, Reference, Source, EntryPoint } from './model.js';

/** Serialized into the standalone HTML; keep all runtime helpers inside this function. */
export function mountAtlas(): void {
  const inventory: Inventory = JSON.parse(document.getElementById('inventory')!.textContent!);
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
  const stage = get('stage'), viewport = get('viewport'), sizer = get('sizer'), inspector = get('inspector');
  const search = get<HTMLInputElement>('search'), results = get('results');
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text: string, action: () => void, className?: string) => {
    const node = element('button', text, className);
    node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const location = (source: Source) => `${source.file}:${source.line}:${source.column}`;
  type Item = { key: string; label: string; parent: string | null; route?: RouteRecord; entry?: EntryPoint };
  const items = new Map<string, Item>();
  const children = new Map<string | null, Item[]>();
  const routes = new Map(inventory.routes.map(route => [route.id, route]));
  for (const entry of inventory.entryPoints) items.set(`entry:${entry.id}`, { key: `entry:${entry.id}`, label: inventory.entryPoints.length === 1 ? 'Application' : `Entrée ${entry.id}`, parent: null, entry });
  for (const route of inventory.routes) {
    const key = `route:${route.id}`;
    items.set(key, { key, label: route.path === '' ? 'Chemin vide' : route.path ?? 'Chemin non résolu',
      parent: route.parentId ? `route:${route.parentId}` : `entry:${route.entryPointId}`, route });
  }
  for (const item of items.values()) {
    const parent = item.parent && items.has(item.parent) ? item.parent : null;
    item.parent = parent;
    const siblings = children.get(parent) ?? []; siblings.push(item); children.set(parent, siblings);
  }
  for (const item of items.values()) if (item.route?.path === '' && !children.has(item.key)) item.label = 'Accueil';
  const mobile = matchMedia('(max-width: 800px)');
  const descendants = new Map<string, number>();
  for (const item of items.values()) {
    let parent = item.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent); descendants.set(parent, (descendants.get(parent) ?? 0) + 1); parent = items.get(parent)?.parent ?? null;
    }
  }
  const expanded = new Set(inventory.entryPoints.map(entry => `entry:${entry.id}`));
  let selected: string | null = null;
  let zoom = .9;
  let query = '';
  let matchKeys = new Set<string>();
  let visibleForSearch: Set<string> | null = null;
  let positions = new Map<string, { x: number; y: number }>();
  let graphWidth = 0, graphHeight = 0;
  const diagnosticsByRoute = new Map<string, Inventory['diagnostics']>();
  for (const diagnostic of inventory.diagnostics) {
    if (diagnostic.routeId === null) continue;
    const group = diagnosticsByRoute.get(diagnostic.routeId) ?? [];
    group.push(diagnostic);
    diagnosticsByRoute.set(diagnostic.routeId, group);
  }
  const hasDiagnostic = (item: Item) => item.route && diagnosticsByRoute.has(item.route.id);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  get('status').textContent = `${inventory.routes.length} routes · analyse ${inventory.scope.status === 'partial' ? 'partielle' : 'statique'}`;
  get('warnings').textContent = plural(inventory.diagnostics.length, 'point à vérifier', 'points à vérifier');

  function revealInspector(): void {
    if (matchMedia('(max-width: 800px)').matches) {
      inspector.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      inspector.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }
  function panel(title: string, label?: string): void {
    inspector.replaceChildren();
    inspector.append(button('Revenir à la carte', () => viewport.scrollIntoView({ block: 'start' }), 'close-details'));
    if (label) inspector.append(element('p', label, 'eyebrow'));
    const heading = element('h2', title); heading.tabIndex = -1;
    inspector.append(heading);
  }
  function field(label: string, value: string): void {
    const dl = element('dl'); dl.append(element('dt', label), element('dd', value)); inspector.append(dl);
  }
  function reference(title: string, ref: Reference): void {
    const block = element('div', undefined, 'reference');
    block.append(element('strong', title), element('p', ref.name ?? 'Expression'), element('code', ref.expression), element('p', `Usage : ${location(ref.source)}`));
    if (ref.declaration) block.append(element('p', `Déclaration : ${location(ref.declaration)}`));
    inspector.append(block);
  }
  function diagnosticMessage(code: string, message: string): string {
    return code === 'SERVER_RENDERING_NOT_ANALYZED'
      ? 'Les politiques de rendu et les URLs prérendues ne sont pas analysées. La carte décrit les déclarations de routes client.' : message;
  }
  function diagnosticList(diagnostics: Inventory['diagnostics']): void {
    if (!diagnostics.length) inspector.append(element('p', 'Aucun diagnostic dans le périmètre statique pris en charge.'));
    for (const diagnostic of diagnostics) {
      const block = element('div', undefined, 'notice');
      block.append(element('p', diagnosticMessage(diagnostic.code, diagnostic.message)), element('code', diagnostic.code));
      if (diagnostic.source) block.append(element('p', location(diagnostic.source)));
      if (diagnostic.routeId && routes.has(diagnostic.routeId)) block.append(button(`Voir la route ${diagnostic.routeId}`, () => select(`route:${diagnostic.routeId}`, true)));
      inspector.append(block);
    }
  }
  function overview(): void {
    panel('Explorez une branche', 'Votre application, route par route');
    inspector.append(element('p', 'Le bouton + ouvre les sous-routes. Sélectionnez un chemin pour retrouver son composant, ses guards et son code source.'));
    field('Déclarations détectées', String(inventory.routes.length));
    field('Configuration', inventory.project.tsconfig);
    inspector.append(element('h3', 'Ce que montrent les liens'), element('p', 'Chaque connexion relie une route à son parent. Elle ne représente pas un clic ou un parcours utilisateur.'));
    if (inventory.diagnostics.length) {
      inspector.append(element('h3', 'À vérifier'));
      diagnosticList(inventory.diagnostics.slice(0, 1));
      if (inventory.diagnostics.length > 1) inspector.append(button('Voir tous les points à vérifier', showWarnings));
    }
  }
  function showWarnings(): void {
    panel('Points à vérifier', `Analyse ${inventory.scope.status === 'partial' ? 'partielle' : 'statique'}`);
    diagnosticList(inventory.diagnostics);
    inspector.append(element('h3', 'Périmètre de l’analyse'));
    const list = element('ul');
    for (const limitation of inventory.scope.limitations) list.append(element('li', limitation));
    inspector.append(list); revealInspector();
  }
  function details(item: Item): void {
    const route = item.route;
    if (!route) {
      panel('Enregistrement des routes', item.entry?.id);
      field('API Angular', item.entry?.kind ?? item.label);
      if (item.entry) field('Source', location(item.entry.source));
      field('Déclarations dans cette branche', String(descendants.get(item.key) ?? 0));
      inspector.append(element('p', 'Cet appel a été trouvé dans le code ; son exécution au démarrage n’est pas démontrée.'));
      return;
    }
    panel(route.fullPath ?? item.label, `Déclaration ${route.id}`);
    const ancestors: Item[] = [];
    const seen = new Set<string>();
    let key = item.parent;
    while (key && !seen.has(key)) { seen.add(key); const parent = items.get(key); if (!parent) break; ancestors.unshift(parent); key = parent.parent; }
    const crumbs = element('nav', undefined, 'crumbs'); crumbs.setAttribute('aria-label', 'Parents de la route');
    for (const parent of ancestors) crumbs.append(button(parent.route?.fullPath ?? parent.label, () => select(parent.key, true)));
    inspector.append(crumbs);
    field('Chemin déclaré', route.path === '' ? '(chemin vide)' : route.path ?? 'Non résolu');
    field('Source de la route', location(route.source));
    field('Ordre parmi les routes sœurs', String(route.order + 1));
    field('Outlet / correspondance', `${route.outlet ?? 'non résolu'} / ${route.pathMatch ?? 'non résolue'}`);
    if (route.component) {
      inspector.append(element('h3', 'Composant'));
      reference(route.component.loading === 'lazy' ? 'Chargé à la demande' : 'Chargement direct', route.component);
    } else field('Type', route.kind === 'container' ? 'Structure de sous-routes' : route.kind === 'redirect' ? 'Redirection' : 'Non résolu');
    if (route.redirect) { inspector.append(element('h3', 'Redirection')); field('Destination déclarée', route.redirect.target ?? 'Non résolue'); inspector.append(element('code', route.redirect.expression)); }
    if (route.lazyChildren) inspector.append(element('p', 'Les sous-routes sont chargées à la demande.'));
    inspector.append(element('h3', 'Guards déclarés ici'));
    const guards = Object.entries(route.guards);
    if (!guards.length) inspector.append(element('p', 'Aucun guard déclaré sur cette route. Consultez ses parents pour leur configuration.'));
    for (const [kind, refs] of guards) {
      if (!refs.length) field(kind, 'Tableau vide');
      for (const ref of refs) reference(kind, ref);
    }
    inspector.append(element('h3', 'Resolvers déclarés ici'));
    if (!Object.keys(route.resolvers).length) inspector.append(element('p', 'Aucun resolver déclaré sur cette route.'));
    for (const [name, ref] of Object.entries(route.resolvers)) reference(name, ref);
    const diagnostics = diagnosticsByRoute.get(route.id) ?? [];
    if (diagnostics.length) { inspector.append(element('h3', 'À vérifier sur cette route')); diagnosticList(diagnostics); }
    inspector.append(element('p', 'Les noms et expressions proviennent du code. Les permissions et l’exécution des fonctions ne sont pas évaluées.'));
  }
  function center(key: string): void {
    const position = positions.get(key);
    if (!position) return;
    viewport.scrollTo({ left: Math.max(0, (position.x + 115) * zoom - viewport.clientWidth / 2), top: Math.max(0, (position.y + 40) * zoom - viewport.clientHeight / 2) });
  }
  function select(key: string, reveal = false): void {
    const item = items.get(key); if (!item) return;
    if (reveal) {
      if (query && !visibleForSearch?.has(key)) { search.value = ''; query = ''; visibleForSearch = null; matchKeys.clear(); results.hidden = true; }
      let parent = item.parent;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) { seen.add(parent); expanded.add(parent); parent = items.get(parent)?.parent ?? null; }
    }
    selected = key; render(); details(item);
    Array.from(stage.querySelectorAll<HTMLElement>('.node')).find(node => node.dataset.key === key)?.querySelector<HTMLButtonElement>('.node-main')?.focus({ preventScroll: true });
    center(key); revealInspector();
  }
  function applyZoom(): void {
    stage.style.transform = `scale(${zoom})`;
    sizer.style.width = `${graphWidth * zoom}px`; sizer.style.height = `${graphHeight * zoom}px`;
    get('zoom-value').textContent = `${Math.round(zoom * 100)} %`;
    get<HTMLButtonElement>('zoom-out').disabled = zoom <= .5;
    get<HTMLButtonElement>('zoom-in').disabled = zoom >= 1.5;
  }
  function render(): void {
    stage.replaceChildren(); positions = new Map();
    let row = 0;
    const visible: Item[] = [];
    const laidOut = new Set<string>();
    function layout(item: Item, depth: number): number | undefined {
      if (laidOut.has(item.key) || (visibleForSearch && !visibleForSearch.has(item.key))) return undefined;
      laidOut.add(item.key); visible.push(item);
      const mobileY = mobile.matches ? 24 + row++ * 100 : 0;
      const nested = expanded.has(item.key) || !!visibleForSearch ? children.get(item.key) ?? [] : [];
      const ys: number[] = [];
      for (const child of nested) { const y = layout(child, depth + 1); if (y !== undefined) ys.push(y); }
      const y = mobile.matches ? mobileY : ys.length ? (ys[0]! + ys.at(-1)!) / 2 : 28 + row++ * 104;
      positions.set(item.key, { x: mobile.matches ? 20 + Math.min(depth, 4) * 24 : 28 + depth * 290, y }); return y;
    }
    for (const root of children.get(null) ?? []) { layout(root, 0); row += .4; }
    graphWidth = Math.max(400, ...Array.from(positions.values(), point => point.x + 258));
    graphHeight = Math.max(320, ...Array.from(positions.values(), point => point.y + 110));
    stage.style.width = `${graphWidth}px`; stage.style.height = `${graphHeight}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('edges'); svg.setAttribute('width', String(graphWidth)); svg.setAttribute('height', String(graphHeight)); svg.setAttribute('aria-hidden', 'true');
    stage.append(svg);
    for (const item of visible) {
      const position = positions.get(item.key)!;
      const parent = item.parent ? positions.get(item.parent) : undefined;
      if (parent) {
        const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        edge.classList.add('edge'); const middle = position.x - 30;
        edge.setAttribute('d', mobile.matches
          ? `M ${parent.x + 12} ${parent.y + 80} V ${position.y + 40} H ${position.x}`
          : `M ${parent.x + 230} ${parent.y + 40} H ${middle} V ${position.y + 40} H ${position.x}`); svg.append(edge);
      }
      const node = element('div', undefined, `node${item.entry ? ' entry' : ''}${selected === item.key ? ' selected' : ''}${hasDiagnostic(item) ? ' problem' : ''}`);
      node.dataset.key = item.key; if (item.route) node.dataset.routeId = item.route.id;
      node.style.left = `${position.x}px`; node.style.top = `${position.y}px`;
      const main = button('', () => select(item.key), 'node-main');
      main.setAttribute('aria-label', `${item.route?.fullPath ?? item.label} — ${item.route?.id ?? item.entry?.id}`);
      main.setAttribute('aria-pressed', String(selected === item.key));
      main.title = item.route?.fullPath ?? item.label;
      main.append(element('span', item.label, 'node-path'));
      const count = descendants.get(item.key) ?? 0;
      const kind = item.entry ? 'Enregistrement' : item.route?.kind === 'screen' ? 'Écran' : item.route?.kind === 'redirect' ? 'Redirection' : item.route?.kind === 'container' ? 'Structure' : 'Non résolu';
      main.append(element('span', `${item.entry ? `${count} déclarations` : `${kind}${count ? ` · ${plural(count, 'sous-route', 'sous-routes')}` : ''}`}${hasDiagnostic(item) ? ' · À vérifier' : ''}`, 'node-meta'));
      node.append(main);
      if ((children.get(item.key)?.length ?? 0) > 0) {
        const isOpen = !!visibleForSearch || expanded.has(item.key);
        const toggle = button('', () => {
          if (isOpen) expanded.delete(item.key); else expanded.add(item.key);
          render();
          const restored = Array.from(stage.querySelectorAll<HTMLElement>('.node')).find(candidate => candidate.dataset.key === item.key)?.querySelector<HTMLButtonElement>('.toggle');
          restored?.focus({ preventScroll: true }); center(item.key);
        }, 'toggle');
        toggle.setAttribute('aria-label', `${isOpen ? 'Replier' : 'Déplier'} ${item.label}`);
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.disabled = !!visibleForSearch;
        toggle.append(element('span', isOpen ? '−' : '+'), element('small', String(count))); node.append(toggle);
      }
      stage.append(node);
    }
    const shown = visible.filter(item => item.route).length;
    get('map-count').textContent = `${shown} / ${inventory.routes.length} déclarations affichées${query ? ` · ${matchKeys.size} résultats` : ''}`;
    if (!visible.length) stage.append(element('p', query ? 'Aucune route correspondante. Essayez un autre chemin ou nom de composant.' : 'Aucune route détectée. Consultez les points à vérifier.', 'empty'));
    applyZoom();
  }
  function updateSearch(): void {
    query = search.value.trim().toLocaleLowerCase();
    results.replaceChildren(); results.hidden = !query; matchKeys = new Set(); visibleForSearch = query ? new Set() : null;
    if (query) {
      const matches = Array.from(items.values()).filter(item => item.route && `${item.route.fullPath ?? ''} ${item.route.path ?? ''} ${item.route.component?.name ?? ''}`.toLocaleLowerCase().includes(query));
      for (const item of matches) {
        matchKeys.add(item.key); let key: string | null = item.key;
        while (key && !visibleForSearch!.has(key)) { visibleForSearch!.add(key); key = items.get(key)?.parent ?? null; }
      }
      results.append(element('p', `${plural(matches.length, 'résultat', 'résultats')}${matches.length > 100 ? ' · 100 premiers raccourcis affichés, affinez la recherche pour les autres' : ''}`));
      const list = element('ul');
      for (const item of matches.slice(0, 100)) {
        const li = element('li'); const result = button(item.route!.fullPath ?? item.label, () => select(item.key, true));
        result.append(element('small', `${item.route!.component?.name ?? 'Structure'} · ${item.route!.id}`)); li.append(result); list.append(li);
      }
      results.append(list);
    }
    render(); viewport.scrollTo(0, 0);
  }
  search.addEventListener('input', updateSearch);
  get('reset').addEventListener('click', () => {
    search.value = ''; query = ''; visibleForSearch = null; matchKeys.clear(); results.hidden = true;
    expanded.clear(); for (const entry of inventory.entryPoints) expanded.add(`entry:${entry.id}`);
    selected = null; zoom = .9; render(); overview(); viewport.scrollTo(0, 0);
  });
  get('warnings').addEventListener('click', showWarnings);
  for (const [id, direction] of [['zoom-in', 1], ['zoom-out', -1]] as const) get(id).addEventListener('click', () => {
    const old = zoom; zoom = Math.max(.5, Math.min(1.5, Math.round((zoom + direction * .1) * 10) / 10));
    const x = (viewport.scrollLeft + viewport.clientWidth / 2) / old, y = (viewport.scrollTop + viewport.clientHeight / 2) / old;
    applyZoom(); viewport.scrollTo(x * zoom - viewport.clientWidth / 2, y * zoom - viewport.clientHeight / 2);
  });
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId); viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', event => { if (drag) viewport.scrollTo(drag.left - event.clientX + drag.x, drag.top - event.clientY + drag.y); });
  const endDrag = () => { drag = null; viewport.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
  mobile.addEventListener('change', () => { render(); if (selected) center(selected); });
  render(); overview();
}
