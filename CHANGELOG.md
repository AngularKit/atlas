# Notes de version

## 0.1.0 — en préparation

Première version d'AngularKit Atlas : inventaire statique des déclarations de routes Angular, destiné à l'audit et à l'exploration d'un projet existant.

- CLI `angular-atlas` et API Node.js ESM avec types TypeScript inclus.
- Carte HTML autonome : hiérarchie dépliable, recherche, détails et références source, zoom et présentation mobile.
- Exports JSON et Markdown, détaillés ou compacts, avec schémas JSON versionnés.
- Analyse de `provideRouter` et `RouterModule.forRoot`, constantes, alias, spreads, routes enfants, imports différés et générateurs statiques bornés.
- Guards et resolvers conservés par lieu de déclaration ; diagnostics explicites pour les branches non résolues.
- Installation de l'archive vérifiée dans un consommateur isolé, en JavaScript et TypeScript ; CI sur Node.js 22 et 24.

Le graphe représente les relations parent–enfant. Il ne prouve ni les permissions, ni les parcours utilisateurs, ni l'exécution des enregistrements au démarrage. Les politiques SSR/SSG, URLs prérendues et liens de navigation restent hors périmètre. La version n'est pas encore publiée sur npm.
