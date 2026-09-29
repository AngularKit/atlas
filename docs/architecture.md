# Architecture du prototype

Le moteur travaille sur les sources, sans charger les modules JavaScript du projet analysé.

| Module | Responsabilité |
|---|---|
| `project.ts` | Sélection et lecture du tsconfig, programme TypeScript, périmètre des fichiers, résolution de modules et empreinte. |
| `static.ts` | Lecture limitée des constantes, tableaux, objets et imports différés ; diagnostics sur les formes non prises en charge. |
| `scan.ts` | Reconnaissance des enregistrements Angular et construction du graphe de routes avec preuves. |
| `model.ts` | Contrat public de l'inventaire et des options. |
| `markdown.ts` | Rendu du même inventaire pour la lecture humaine. |
| `cli.ts` | Arguments, entrées/sorties et codes de retour. |

La CLI dépend de l'API `scan`/`toMarkdown`. Le rendu ne lit pas le dépôt. La lecture des objets n'invoque aucune fonction métier ; une expression arbitraire est conservée ou signalée, jamais exécutée.

Le lecteur statique borne la profondeur et le nombre d'opérations. Le graphe borne le nombre d'occurrences de routes. La réutilisation d'un même tableau dans plusieurs branches est valide ; seul un retour vers un ancêtre constitue un cycle.

Les spreads inconnus invalident les propriétés précédentes qu'ils pourraient écraser. Les propriétés explicites suivantes peuvent être conservées. Les champs dont la valeur est incertaine ne deviennent pas des valeurs par défaut fiables.

Les guards conservent leur lieu de déclaration. Le modèle ne confond pas `canActivate` d'un parent et `canActivateChild`, ni déclaration d'un guard et autorisation effective. Les redirects ne sont pas des arêtes de parcours observé.

Les sorties JSON sont validées contre un schéma public versionné. Pour une même version de l'outil, un même environnement de résolution et les mêmes entrées, le rapport est déterministe et sans horodatage variable. Les IDs sont locaux à ce rapport. L'empreinte couvre les entrées du compilateur et la configuration, pas un certificat de validité du code.

## Vérification

Tests sociables sur de vrais fichiers temporaires et le compilateur TypeScript réel. Une déclaration minimale de l'API Angular constitue la frontière externe des fixtures. Le cas réel complète ces tests ; le test d'archive vérifie le contrat de distribution depuis un projet consommateur.

## Évolutions

Les références de navigation formeront des relations distinctes de la hiérarchie des routes. Les parcours navigateur devront préciser leur contexte d'observation. Le rendu HTML réutilisera le modèle ; il ne pilotera pas le moteur. Le partage éventuel de code avec Inventory dépendra des besoins observés, sans extraction préalable d'un framework commun.
