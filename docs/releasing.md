# Publier une version sur npm

`@angularkit/atlas@0.1.0` a été publié le 1er octobre 2026 depuis l'archive de la CI. Les versions suivantes sont publiées automatiquement par `.github/workflows/publish.yml` lorsqu'un tag stable `vX.Y.Z` est poussé. Le tag constitue la décision de publier, après relecture et fusion de la PR dans `main` ; un push ordinaire ou une pull request ne publie rien.

## Configuration initiale sur npm

Dans les [paramètres du package](https://www.npmjs.com/package/@angularkit/atlas/access), ajouter un **Trusted Publisher → GitHub Actions** :

| Champ | Valeur |
|---|---|
| Organization or user | `AngularKit` |
| Repository | `atlas` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | Autoriser `npm publish` |

Ne pas saisir le chemin complet du workflow. La permission de staging seule ne permet pas la publication automatique. La gestion séparée des dist-tags n'est pas nécessaire. Cette connexion autorise précisément ce workflow et cet environnement à publier le package ; son activation se fait une seule fois dans npm, avec la validation du propriétaire.

Aucun `NPM_TOKEN` ni `NODE_AUTH_TOKEN` n'est à créer dans GitHub. Le job utilise OIDC avec npm 11.21.0, un runner hébergé par GitHub et `id-token: write` uniquement pour la publication. La provenance est activée. L'environnement GitHub `npm` peut recevoir des protections supplémentaires si souhaité ; une approbation obligatoire y rendrait la publication semi-automatique.

## Préparer la version

Dans une branche issue de `main`, mettre à jour la version sans créer de tag :

```sh
npm version patch --no-git-tag-version
```

Choisir `minor` ou `major` selon les changements. Mettre à jour le changelog et les exemples versionnés du README. Ouvrir une PR vers `main` et terminer sa relecture technique avant fusion. Ne pas créer une nouvelle version uniquement pour tester l'authentification.

Après fusion et validation de la release, depuis un checkout propre de `main` à jour :

```sh
git fetch origin main
git switch main
git pull --ff-only
# Exemple : la PR vient de préparer la version 0.1.1.
git tag -a v0.1.1 -m 'Atlas 0.1.1'
git push origin v0.1.1
```

Le workflow refuse un tag différent de la version de `package.json`, un lockfile désynchronisé, une préversion ou un commit absent de `origin/main`. Les préversions ne sont pas prises en charge par ce workflow, qui publie sur `latest`.

## Vérifications et publication

Le workflow réutilise la CI du commit tagué : typage, tests et installation de l'archive sur Node.js 22 et 24, puis tests Chromium sur Node.js 24. Aucun package n'est publié tant que les deux jobs n'ont pas réussi.

Le job Node.js 24 produit l'artefact `atlas-npm-<SHA>` contenant l'archive et `atlas-package.json` (liste des fichiers, tailles et empreinte). Le job de publication télécharge uniquement l'artefact de ce même run. Il vérifie l'intégrité, extrait l'archive et vérifie que le réassemblage conserve exactement la même empreinte. Il publie ce répertoire sans compilation ni scripts de cycle de vie : cela transmet aussi le README à npm, contrairement à la publication directe d'une archive.

Après publication, un contrôle attend jusqu'à environ dix minutes la disponibilité du registre, compare l'intégrité, installe le package dans un consommateur vierge et teste sa CLI, son API et la génération HTML. Une erreur de téléchargement ou d'intégrité fait échouer le job. L'attestation de provenance est consultable sur npm.

Les archives ne contiennent pas les rapports privés ni les sources des applications analysées. Le contrôle de distribution existant vérifie la liste autorisée et un consommateur TypeScript strict.

## Si le workflow échoue

- **Avant publication** : corriger la cause et relancer les jobs échoués si le commit reste correct. Pour corriger le contenu, préparer une nouvelle révision relue et une nouvelle version.
- **Authentification npm** : vérifier les quatre champs du trusted publisher, l'autorisation `npm publish` et l'environnement `npm`. Ne pas ajouter un jeton permanent comme contournement.
- **Après acceptation par npm** : consulter `npm view @angularkit/atlas@X.Y.Z version dist.integrity` et les logs avant toute relance. Une version publiée est immuable ; ne pas supprimer/recréer un tag ni essayer de republier la même version. Le contrôle public peut être relancé seul avec `node scripts/verify-release.mjs /chemin/atlas-package.json`, à partir du manifeste téléchargé dans le run.

Une release déjà présente dans le registre fera échouer `npm publish` sans modifier son contenu. Les runs de publication sont sérialisés ; une publication en cours n'est pas interrompue. Pousser un seul tag de release à la fois, car GitHub ne conserve qu'un run supplémentaire en attente dans ce groupe.

Références : [trusted publishing npm](https://docs.npmjs.com/trusted-publishers/), [provenance](https://docs.npmjs.com/generating-provenance-statements/).
