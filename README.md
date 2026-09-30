# AngularKit Atlas

Cartographie et audit de la navigation Angular : routes, écrans et preuves dans le code, pour développeurs et agents IA.

**Prototype en développement, pas encore publié sur npm.** Le premier jalon produit un inventaire statique JSON et Markdown. Il ne mesure pas les parcours réellement empruntés et ne constitue pas un audit de sécurité.

## Essayer depuis les sources

Prérequis : Node.js 22 ou 24. Installer les dépendances du projet Angular pour permettre la résolution de ses imports.

```sh
git clone https://github.com/AngularKit/atlas.git
cd atlas
npm ci
npm run build
mkdir -p reports
node dist/cli.js /chemin/vers/application --json reports/routes.json --md reports/routes.md
```

Pour un monorepo ou une sélection explicite :

```sh
node dist/cli.js /chemin/vers/workspace --tsconfig apps/shop/tsconfig.app.json
```

Atlas utilise les options `tsConfig` des projets de build dans `angular.json`, puis `tsconfig.app.json`, puis `tsconfig.json`. Plusieurs applications détectées demandent un `--tsconfig` explicite. Les configurations solution à références de projets demandent de sélectionner le tsconfig d'une application. Pour Nx et les configurations non standard, préciser ce chemin.

`--entry src/app/app.config.ts` limite la découverte des appels d'enregistrement à ce fichier. Le contexte de compilation reste celui du projet ; les avertissements sur les modifications runtime restent visibles.

Sans `--json` ni `--md`, le JSON est écrit sur stdout ; le résumé va sur stderr. Les chemins de sortie sont relatifs au répertoire courant, leurs dossiers doivent exister. Les fichiers existants ne sont pas écrasés.

## Rapport compact

Pour une première lecture ou pour transmettre moins de contexte à un agent IA :

```sh
node dist/cli.js /chemin/vers/application --compact --json reports/resume.json --md reports/resume.md
```

Le Markdown compact commence par les points à vérifier, puis présente une section par parent avec de petits tableaux de chemins relatifs, composants et repères. Les composants communs sont indiqués une fois au-dessus du tableau ; chargements différés, guards et clés de resolvers sont regroupés sous les routes concernées. Deux déclarations avec le même chemin restent distinctes. Les listes de fichiers et les preuves détaillées sont omises. Le JSON compact conserve les occurrences, parents, ordre, points d'entrée, chemins, références source des routes et noms ou expressions des guards/resolvers ; il retire les preuves détaillées de chaque référence, les champs vides et les valeurs par défaut (`outlet: primary`, `pathMatch: prefix`, `lazyChildren: false`). Les valeurs inconnues restent `null`.

**Les diagnostics, le statut partiel et les limites restent présents dans les deux formats.** Aucune route n'est regroupée ou supprimée. Sans `--compact`, la sortie détaillée reste inchangée. `--fail-on-partial` fonctionne aussi avec ce format.

Le JSON compact est identifié par `format: "compact"`, avec son [schéma dédié](schema/compact-inventory-v1.schema.json). Il ne remplace pas le contrat complet retourné par `scan()`.

```js
import { scan, toCompactInventory, toMarkdown } from './dist/index.js';

const inventory = scan('/chemin/vers/application');
const summary = toCompactInventory(inventory);
const markdown = toMarkdown(inventory, { compact: true });
```

## Informations produites

- Enregistrements `provideRouter` et `RouterModule.forRoot`, y compris les imports renommés.
- Ordre des routes détectées, parents, motifs complets, paramètres, chemins vides, wildcards et redirections textuelles.
- Composants directs, imports différés statiques et tableaux enfants différés, exports par défaut ou nommés.
- Guards par type et par route de déclaration, resolvers et références vers leurs déclarations lorsqu'elles sont résolues.
- Fichier, ligne et colonne pour les preuves ; diagnostics localisés pour les expressions non prises en charge.
- Fichiers analysés, exclusions rencontrées et empreinte SHA-256 des configurations et entrées du compilateur, y compris les déclarations utilisées.

L'évaluateur suit les constantes, imports, alias du tsconfig, `satisfies`, assertions de type et spreads statiques. Il n'exécute pas le code applicatif et ne modifie pas le projet analysé. Les fixtures utilisent le véritable compilateur TypeScript, des fichiers et des graphes de routes réels ; aucun analyseur interne n'est simulé.

## Lire le résultat sans surinterpréter

`schemaVersion: "1.0"` est décrit par [le schéma JSON](schema/inventory-v1.schema.json). Les IDs identifient les occurrences dans un rapport ; ils ne sont pas des identifiants pérennes entre commits. Deux routes qui partagent un composant ou un chemin restent distinctes.

- `scope.status: "static"` : aucune limite détectée parmi les formes statiques analysées. Ce n'est pas une garantie d'exhaustivité à l'exécution.
- `scope.status: "partial"` : des éléments n'ont pas été résolus, ou aucun point d'entrée pris en charge n'a été trouvé. Les diagnostics indiquent où poursuivre la revue.
- `fullPath: null` : Atlas ne peut pas déduire un motif linéaire fiable. `/users/:id` reste un motif, pas une URL visitable sans données.
- `guards` contient les guards déclarés sur cette route. `parentId` permet de remonter le contexte ; Atlas ne prétend pas reconstituer leurs conditions d'exécution ou permissions.
- `redirect.target` garde le texte déclaré, relatif ou absolu. Les redirections fonctionnelles restent des expressions non évaluées.
- `order` suit les éléments frères détectés. Un spread non résolu peut contenir d'autres routes dont le nombre et la position effective sont inconnus.
- Les appels d'enregistrement sont trouvés dans les sources du projet ; Atlas ne démontre pas qu'ils sont exécutés au démarrage. Les tableaux sans enregistrement pris en charge ne sont pas présentés comme des routes actives.

Une erreur de lecture, de syntaxe ou de configuration est fatale : aucun rapport de succès n'est produit. Les erreurs de types Angular ne sont pas vérifiées ; ce prototype ne remplace pas le build du projet.

| Code CLI | Signification |
|---|---|
| `0` | Rapport produit ; vérifier `scope.status` et les diagnostics. |
| `1` | Erreur fatale ou problème de sortie. |
| `2` | Rapport partiel avec `--fail-on-partial`. |

## Limites explicites du prototype

Matchers personnalisés, outlets nommés, modules différés, assemblage `RouterModule.forChild`/`ROUTES`, `resetConfig` et fabriques arbitraires donnent des diagnostics. Les fonctions de chargement acceptées retournent directement `import('...')`, `import('...').then(m => m.Export)` ou une sélection déstructurée simple comme `.then(({ routes: selected }) => selected)`. Les réexports de namespaces avec export par défaut sont déballés comme par Angular. Les sélections à valeur par défaut ou rest et les fonctions à plusieurs instructions ne sont pas évaluées.

Les tableaux de primitives statiques peuvent être développés avec `.map((value, index) => …)`. `Array.from({ length: N }, (_, index) => …)` est pris en charge pour une longueur entière de 0 à 10 000, avec le véritable `Array` global. Les callbacks doivent être synchrones, sans paramètre déstructuré, valeur par défaut, rest ou troisième paramètre, et contenir une expression ou un unique `return`. Les concaténations, templates et additions de primitives sont lus statiquement ; les appels métier ne sont jamais exécutés. Les tableaux creux, sources dynamiques, tableaux d'objets et autres fabriques restent diagnostiqués.

Chaque occurrence générée possède son propre ID, chemin, parent et ordre. Sa référence source désigne le modèle dans le callback : plusieurs occurrences peuvent donc partager fichier, ligne et colonne. Les expressions de guards et resolvers restent le texte source original, sans évaluation de leur résultat. Les deux applications de validation atteignent désormais **31/31 et 105/105 entrées client** ; cela ne compte pas les URLs produites par le SSG.

Un appel `withRoutes` ou `provideServerRouting` de `@angular/ssr` produit `SERVER_RENDERING_NOT_ANALYZED`. Le rapport ne reconstitue ni les règles `RenderMode`, ni `getPrerenderParams`, ni les URLs générées par le build. Un chemin `/blog/:slug` ne représente pas la liste des pages SSG. Les modifications d'objets/tableaux après initialisation et les parcours conditionnels ne sont pas interprétés.

Tests, stories, déclarations et dossiers générés connus sont exclus des cibles d'analyse. `excludedFiles` liste les exclusions rencontrées par le compilateur et le tsconfig ; il ne recense pas tous les fichiers ignorés sur disque. Les imports hors de la racine sélectionnée ne sont pas développés comme routes applicatives.

Les liens `routerLink`, `navigate` et `navigateByUrl`, le rapport HTML, les captures navigateur et un éventuel MCP viendront dans des jalons ultérieurs. Aucun score de sécurité ni verdict « route inutilisée » n'est calculé.

## API et développement

```js
import { scan, toMarkdown } from './dist/index.js';

const inventory = scan('/chemin/vers/application', { tsconfig: 'tsconfig.app.json' });
console.log(toMarkdown(inventory));
```

```sh
npm run quality
```

La vérification comprend le typage, les tests de fixtures et de CLI, la validation du schéma JSON, puis l'installation hors ligne d'une archive npm dans un répertoire consommateur séparé. Le package installé est testé via sa CLI et son API. La CI exécute ces vérifications sous Node.js 22 et 24.

Le prototype utilise TypeScript 6. Son premier essai réel est documenté dans [la validation](docs/validation.md) ; cela ne constitue pas une matrice de compatibilité avec toutes les versions Angular.

Voir [l'architecture](docs/architecture.md) et [le premier chantier](https://github.com/AngularKit/atlas/issues/1).
