# Publication automatique sur npm

**Français** · [English](releasing.en.md)

Après relecture et fusion d’une PR dans `main`, le workflow `publish.yml` exécute toute la CI. Si elle réussit et qu’un changement publiable existe depuis la dernière version, **semantic-release calcule la version, crée le tag, publie sur npm, puis crée la release GitHub**. Les PR et les branches de travail ne publient rien. La fusion d’une PR technique reste soumise à l’accord explicite de Gaëtan après relecture.

## Au quotidien

1. Créer une branche depuis `main` et ouvrir une PR.
2. Choisir un titre Conventional Commits, selon le tableau ci-dessous. Mettre à jour les guides français et anglais quand le comportement utilisateur change.
3. Faire relire la PR, terminer les vérifications, puis utiliser **Squash and merge** en conservant ce titre comme message du commit. Le corps du commit doit conserver les éventuelles indications `BREAKING CHANGE:`.
4. Après fusion, suivre **Publish npm** dans GitHub Actions, puis vérifier la [release GitHub](https://github.com/AngularKit/atlas/releases) et le [package npm](https://www.npmjs.com/package/@angularkit/atlas).

| Commit fusionné | Effet | Exemple depuis `0.1.1` |
|---|---|---|
| `fix: corriger les routes lazy` | Correctif | `0.1.2` |
| `feat: ajouter un filtre` | Fonctionnalité | `0.2.0` |
| `feat!: changer le schéma JSON` | Rupture de compatibilité | `1.0.0` |
| Un corps contenant `BREAKING CHANGE: ...` | Rupture, quel que soit le type | `1.0.0` |
| `docs:`, `ci:`, `test:`, `chore:`, `refactor:` | Pas de release à eux seuls, sans rupture | — |

Le changement le plus important depuis le dernier tag détermine la version. Une PR `ci:` peut donc déclencher la publication d’un `fix:` déjà fusionné mais non publié. Les scopes sont acceptés, par exemple `fix(parser): ...`. Une rupture produit une version majeure **même avant 1.0**. Les préversions ne sont pas configurées ; les publications vont sur `latest`.

Ne plus lancer `npm version`, pousser des tags de release ou modifier manuellement le numéro. Le dépôt garde `0.0.0-development` dans ses manifests ; les builds locaux affichent ce numéro. L’archive publiée reçoit la version calculée. Aucun commit automatique ne modifie `main`. Les tags, les releases GitHub et npm sont les références pour les versions publiées. Les notes de release sont générées à partir des commits ; `CHANGELOG.md` conserve le contexte fonctionnel rédigé dans les PR.

## Configuration initiale

Dans les [paramètres npm du package](https://www.npmjs.com/package/@angularkit/atlas/access), configurer **Trusted Publisher → GitHub Actions** :

| Champ | Valeur |
|---|---|
| Organization or user | `AngularKit` |
| Repository | `atlas` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | Autoriser `npm publish` |

Utiliser le nom du fichier, sans chemin. Une autorisation de staging seule ne suffit pas. Le propriétaire doit valider cette connexion une seule fois dans npm. Aucun secret `NPM_TOKEN` ou `NODE_AUTH_TOKEN` n’est nécessaire. Le job utilise OIDC, npm 11.21.0, un runner hébergé par GitHub et la provenance npm. Le jeton GitHub éphémère a `contents: write` pour les tags/releases ; le job a `id-token: write` pour npm. Aucun commentaire automatique sur les PR ou issues n’est activé.

L’environnement GitHub `npm` peut être protégé ; imposer un approbateur rendrait la publication semi-automatique. Conserver le nom du workflow et de l’environnement, ou actualiser la connexion npm avant tout changement.

Pour la migration, `v0.1.0` doit désigner **`3bc431cb1fe3e2bd57c0049a56cd31b5018beea4`**, le commit de l’archive publiée le 1er octobre 2026. Ce repère historique évite que semantic-release considère le projet comme une première release à `1.0.0`. Le workflow vérifie ce repère avant de publier. Le correctif TypeScript déjà fusionné conduit ensuite à `0.1.1`, si aucun changement plus important n’intervient.

## Ce que la CI vérifie

`publish.yml` réutilise `ci.yml` pour le commit fusionné : typage, tests, installation du package sur Node.js 22 et 24, Chromium, installation autonome et matrice des sept compilateurs TypeScript 5.x, en plus du compilateur 6.0.3. Un job distinct teste la politique de release, les notes et une release réelle vers un dépôt Git local, sans publier sur npm. Tous les jobs doivent réussir.

La CI produit `atlas-npm-<SHA>`. La publication télécharge l’archive de ce même run, vérifie son empreinte et l’extrait. Semantic-release remplace uniquement la version du manifest. Un contrôle compare chaque fichier et ses permissions à l’archive testée, vérifie que les autres champs du manifest sont identiques, puis compare l’archive préparée avec un nouveau `npm pack`. Aucun build ni script de cycle de vie n’est exécuté pendant cette préparation ou la publication.

La publication se fait depuis le répertoire extrait pour transmettre aussi le README à npm. Le manifeste final `published-package.json` et l’archive versionnée sont joints à la release GitHub et conservés 14 jours dans l’artefact `atlas-published-<SHA>`. L’outillage de release est isolé dans `.github/release` et exclu du package distribué.

Après publication, le workflow attend la propagation du registre, compare l’intégrité finale, installe le package dans un projet vierge, puis teste CLI, API et génération HTML. Il ne réussit qu’après cette vérification publique. Une PR documentaire seule peut finir avec « No release required » : c’est normal.

Les runs sont sérialisés, sans interrompre celui en cours. GitHub ne conserve qu’un run supplémentaire en attente ; si plusieurs fusions arrivent, un run en attente peut être remplacé par celui du commit plus récent. Celui-ci refait toute la CI et prend en compte les changements encore non publiés.

## En cas d’échec

- **CI ou préparation, avant création du tag** : corriger la cause dans une PR ou relancer le run si l’erreur est transitoire. Un contenu modifié doit repasser la CI.
- **Authentification npm** : vérifier les champs du trusted publisher, l’autorisation de publication et l’environnement. Ne pas ajouter de jeton permanent pour contourner la connexion OIDC.
- **Tag créé, publication npm échouée** : semantic-release crée le tag avant l’envoi à npm. Une simple relance peut alors annoncer qu’il n’y a rien à publier. Vérifier d’abord `npm view @angularkit/atlas@X.Y.Z version dist.integrity`, les logs et la release GitHub. Ne pas supprimer le tag automatiquement. Si npm confirme que la version n’existe pas, une récupération explicite et relue doit rétablir le repère de release avant de relancer le commit testé.
- **npm a accepté la version, puis une étape échoue** : la version publiée est immuable. Ne pas republier ni recréer son tag. Récupérer `published-package.json` dans les artefacts et relancer uniquement `node scripts/verify-release.mjs /chemin/published-package.json`. Si seule la release GitHub manque, la recréer sur le tag existant avec les notes et fichiers du run, sans nouvel envoi à npm.

Une exécution locale de `npm ci --prefix .github/release --ignore-scripts` puis `npm test --prefix .github/release` vérifie la release sans accès en écriture à GitHub ou npm (Node.js 24.10 ou plus récent).

Références : [semantic-release](https://semantic-release.gitbook.io/semantic-release/), [trusted publishing npm](https://docs.npmjs.com/trusted-publishers/), [provenance](https://docs.npmjs.com/generating-provenance-statements/).
