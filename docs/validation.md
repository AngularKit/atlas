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

`npm run quality` couvre notamment :

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
