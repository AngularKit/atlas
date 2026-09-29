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
- Expressions dynamiques, outlets, matchers et configurations runtime signalés comme limites.
- Exclusion des tests et sorties de build, absence d'exécution du code applicatif.
- Déterminisme et empreinte des sources/configurations/déclarations.
- CLI : stdout JSON, fichiers Markdown/JSON, refus d'écrasement, codes d'erreur et analyse partielle.
- Schéma JSON et installation d'une archive npm dans un consommateur isolé.

## Limites de cette validation

Ce cas réel ne contient pas de routes imbriquées ou de tableaux enfants différés : ces mécanismes sont vérifiés par les fixtures, pas par un second projet réel. Aucun gain de temps d'audit, parcours navigateur ou contrôle d'autorisation métier n'a encore été mesuré.
