# Validation du premier prototype

## Cas réel — 29 septembre 2026

Analyse en lecture seule d'une application Angular 22.1 utilisant TypeScript 6 et un tsconfig d'application. Résultat comparé au relevé manuel préparé avant le développement :

| Vérification | Attendu | Obtenu |
|---|---:|---:|
| Routes | 7 | 7 |
| Composants de page distincts | 6 | 6 |
| Routes avec composant différé | 6 | 6 |
| Routes déclarant canActivate | 3 | 3 |
| Routes déclarant un resolver | 0 | 0 |
| Diagnostics dans ce périmètre | 0 | 0 |

Le cas comprend un tableau `satisfies` exporté via une constante, une fonction d'import différé partagée par deux routes et des composants nommés. L'ordre des routes et les références source ont été comparés à la configuration.

Les rapports de l'application restent locaux. Le dépôt public ne contient pas son code ni ses données.

## Vérifications reproductibles

`pnpm run quality` couvre notamment :

- Routes imbriquées, routes vides, alias de modules et de symboles, spreads, redirections et wildcards.
- Exports différés nommés/par défaut et réexports de composants.
- Réutilisation de tableaux, cycles de tableaux/objets et limites d'analyse.
- Génération bornée par `.map()` / `Array.from()`, bindings lexicaux imbriqués, chemins calculés et conservation des preuves.
- Refus des callbacks arbitraires, des sources incomplètes qui décaleraient les indices et des faux `Array.from`.
- Expressions dynamiques, outlets, matchers et configurations runtime signalés comme limites.
- Exclusion des tests et sorties de build, absence d'exécution du code applicatif.
- Déterminisme et empreinte des sources/configurations/déclarations.
- CLI : stdout JSON, fichiers Markdown/JSON, refus d'écrasement, codes d'erreur et analyse partielle.
- Schéma JSON et installation d'une archive npm dans un consommateur isolé.

## Limites de cette validation

Le premier cas ne contient pas de routes imbriquées ou de tableaux enfants différés. Les essais supplémentaires ci-dessous complètent cette validation et révèlent des limites importantes. Aucun gain de temps d'audit, parcours navigateur ou contrôle d'autorisation métier n'a encore été mesuré.

## Deux applications réelles supplémentaires — 29 septembre 2026

Analyse en lecture seule de copies propres des branches de référence, avec les dépendances déjà installées des projets. Les builds n'ont pas été relancés. Les compteurs portent sur les **entrées de configuration client**, conteneurs et chemins vides compris ; ce ne sont ni des nombres de pages distinctes ni des URLs prérendues.

| Cas | Référence établie par lecture des configurations | Détecté | Manquant | Diagnostic SSG |
|---|---:|---:|---:|---|
| Site Angular 22.0 à prérendu | 31 | 31 | 0 | Présent |
| Application Angular 22.0 / Nx avec cours et espace connecté | 105 | 105 | 0 | Présent |

Le décompte indépendant du premier cas relève 23 objets de route dans les configurations atteignables. Un objet est un modèle répété par `.map()` sur 9 valeurs : `23 - 1 + 9 = 31`. Atlas retrouve les 22 objets non générés et les 9 occurrences du modèle.

Le second cas contient 54 objets/modèles de route, dont 7 callbacks générant respectivement 9, 7, 7, 8, 9, 8 et 10 routes : `54 - 7 + 58 = 105`. Atlas retrouve les 47 objets non générés et les 58 occurrences des 7 modèles. Les routes parentes et leurs enfants sont conservés, même lorsqu'ils correspondent au même motif d'URL.

Ces essais ont permis de corriger les sélections d'exports déstructurées, les réexports de namespace dont Angular extrait l'export par défaut, puis les tableaux de primitives transformés par `.map()` et les séquences bornées `Array.from()`. La couverture avant cette dernière correction était de 22/31 et 47/105. Des fixtures indépendantes en conservent la régression. Aucun code des applications n'est copié dans le dépôt public.

### SSG

Le premier projet déclare une politique globale de prérendu et des générateurs de paramètres pour le contenu. Le second déclare le prérendu de ses pages de cours et du rendu client pour le reste. Ces observations proviennent d'une lecture des configurations serveur, pas d'une fonctionnalité d'analyse d'Atlas.

Atlas émet désormais `SERVER_RENDERING_NOT_ANALYZED` avec la source de l'enregistrement serveur. Il ne compte pas les URLs générées et n'exécute pas les générateurs de paramètres. Les deux rapports sont correctement marqués **partiels**, et la CLI renvoie 2 avec `--fail-on-partial`.

### Conclusion de validation

Les 67 occurrences ajoutées ont été vérifiées contre les chemins attendus établis indépendamment : 9 modules et 58 leçons. Les contrôles portent aussi sur les composants, parents, ordre, resolvers et références source. Les entrées déjà détectées conservent leurs informations et leurs relations parentales ; seuls les IDs et indices décalés par les insertions changent.

La couverture des **déclarations client** de ces deux révisions est validée, sans diagnostic de tableau non résolu. Les seuls diagnostics restants concernent le SSG. Le rapprochement entre route client, politique de rendu et manifeste de prérendu reste un chantier distinct. Les projets analysés n'ont pas été modifiés.


## Formats compacts — 30 septembre 2026

Les mêmes inventaires sont rendus avec `--compact`. Les deux sorties JSON valident leur schéma dédié ; le nombre d'occurrences, les IDs, parents, ordre, points d'entrée, chemins, statut, limites et diagnostics sont identiques au rapport complet.

| Cas | JSON complet → compact | Markdown complet → compact |
|---|---:|---:|
| Site à prérendu, 31 routes | 32 348 → 11 577 octets | 9 781 → 3 392 octets |
| Application Nx, 105 routes | 157 743 → 50 434 octets | 42 082 → 7 809 octets |

La réduction provient des références détaillées et listes de fichiers omises, ainsi que de la suppression du tableau qui répétait l'arbre en Markdown. Aucune route ni aucun diagnostic n'est filtré. L'API complète et les sorties CLI sans option conservent leur contrat. Les tests couvrent aussi les chemins inconnus, les redirections dynamiques, les doublons, les enregistrements multiples, l'échappement Markdown et le code de sortie strict.


## Carte HTML interactive — 30 septembre 2026

Le même inventaire produit un fichier autonome avec branches repliables, recherche par chemin/composant, zoom, déplacement et panneau de preuves. L'ouverture initiale présente les routes racines. Les connexions décrivent la hiérarchie des déclarations, pas les parcours utilisateurs.

Tests Chromium sur fichiers locaux : dépliage au clavier, recherche d'une route cachée, conservation du filtre, contexte parent, guards déclarés uniquement, sources et resolvers, doublons, retour à la vue d'ensemble, zoom, navigation depuis un diagnostic, état vide, mobile 390 × 844 et contenu source contenant des balises/scripts. Les scénarios ne déclenchent aucune requête réseau externe. Le test du package installé vérifie aussi la génération HTML par CLI et API.

Les inventaires réels de 105 et 31 routes servent d'aperçus privés ; leur contenu n'est pas ajouté au dépôt public. L'analyse SSG reste partielle et le diagnostic est visible dès l'ouverture.


## Viewer : contrôle à 10 000 routes — 1er octobre 2026

Mesure locale sous macOS arm64, Node.js v24.18.0, Chromium 153.0.8010.12, sans interface graphique, viewport 1440 × 950. Deux inventaires synthétiques de 10 000 routes et 10 000 diagnostics, trois ouvertures par forme : 100 groupes contenant chacun 99 enfants, puis 10 000 routes sœurs visibles dès le départ.

| Forme | Ouverture et deux frames | Recherche exacte | Sélection et détails |
|---|---:|---:|---:|
| Groupes repliés | 89–159 ms | 38–48 ms | 75–98 ms |
| 10 000 routes visibles | 455–505 ms | 60–62 ms | 72–76 ms |

Les durées incluent les commandes Playwright et deux frames navigateur. Les fichiers HTML mesurent environ 4,6 Mo. Chaque essai vérifie le nombre de routes et de marqueurs, un résultat de recherche unique, le diagnostic de la route sélectionnée, l'absence d'erreur JavaScript et de requête réseau. Reproduction : `pnpm run benchmark:viewer`, après installation de Chromium ; résultats dans `reports/benchmark-viewer-10000.json`.

Ce contrôle couvre ces deux formes synthétiques sur cette machine. Il ne mesure ni un parcours complet ni les performances sur mobile ; ces durées ne sont pas des seuils garantis. Le script reste hors du package npm et de la CI, sans seuil temporel fragile.
