# Notes de version

Les versions et notes générées sont disponibles dans les [releases GitHub](https://github.com/AngularKit/atlas/releases). Ce fichier conserve le contexte des évolutions du code source.

## Évolutions depuis 0.1.0

- TypeScript devient une dépendance partagée (`>=5.4.2 <6.1`) pour réutiliser le compilateur compatible du projet lors d’une installation locale d’Atlas.
- Tests de compatibilité sur huit versions de TypeScript et contrôle de l’installation sans second compilateur.
- Documentation française et anglaise du poids sur disque, de l’installation locale et des limites du partage avec `npx`.

- Version, tag, notes et publication npm automatisés après fusion et réussite de la CI ; procédure documentée en français et en anglais.

## 0.1.0 — 1er octobre 2026

Première version d'AngularKit Atlas : inventaire statique des déclarations de routes Angular, destiné à l'audit et à l'exploration d'un projet existant.

- CLI `angular-atlas` et API Node.js ESM avec types TypeScript inclus.
- Carte HTML autonome : hiérarchie dépliable, recherche, détails et références source, zoom et présentation mobile.
- Exports JSON et Markdown, détaillés ou compacts, avec schémas JSON versionnés.
- Analyse de `provideRouter` et `RouterModule.forRoot`, constantes, alias, spreads, routes enfants, imports différés et générateurs statiques bornés.
- Diagnostics rattachés explicitement à leur contexte, y compris lorsque la limite de routes interrompt une branche ; marqueurs de la carte indexés par route.
- Guards et resolvers conservés par lieu de déclaration ; diagnostics explicites pour les branches non résolues.
- Installation de l'archive vérifiée dans un consommateur isolé, en JavaScript et TypeScript ; CI sur Node.js 22 et 24.

Le graphe représente les relations parent–enfant. Il ne prouve ni les permissions, ni les parcours utilisateurs, ni l'exécution des enregistrements au démarrage. Les politiques SSR/SSG, URLs prérendues et liens de navigation restent hors périmètre.
