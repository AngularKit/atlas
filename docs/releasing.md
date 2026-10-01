# Préparer et publier une version

La `0.1.0` est une version candidate, pas une publication npm. La validation visuelle de la carte ne remplace pas la relecture technique de la PR. Fusion et publication demandent l'accord explicite de Gaëtan après cette relecture. La CI ne publie rien et aucune fusion automatique n'est configurée par ce chantier.

## Archive à relire

La CI exécute `npm run quality` et les scénarios Chromium sur Node.js 22 et 24. Le job Node.js 24 joint ensuite un artefact `atlas-npm-<SHA>` au run, conservé 14 jours :

- `angularkit-atlas-0.1.0.tgz` : package installable ;
- `atlas-package.json` : version, liste des fichiers, tailles et empreinte d'intégrité fournies par `npm pack`.

Le SHA d'un run de pull request peut être celui du commit de fusion temporaire GitHub. Pour publier après accord, retenir l'archive du run **push sur main** du commit effectivement relu et fusionné, une fois les deux jobs verts. Ne pas publier l'archive d'une autre révision ou d'un run incomplet.

L'archive contient les modules compilés et déclarations, les deux schémas JSON, les métadonnées npm, README, licence et notes de version. Les rapports de projets, démos, tests et sources des applications analysées n'y figurent pas. Le test d'installation contrôle cette liste autorisée, lance la CLI et l'API, puis compile un consommateur TypeScript strict sans les types de développement du dépôt.

Une archive peut également être préparée localement, depuis un checkout propre du commit validé :

```sh
npm ci
npm run quality
npx playwright install chromium
npm run test:browser
npm pack --ignore-scripts --json > atlas-package.json
```

Avant une release suivante, mettre à jour `package.json`, `package-lock.json`, la version dans `src/scan.ts` et les notes de version. Le test de l'archive vérifie que la version du rapport correspond à celle du package. Lors de la préparation finale de la première publication, remplacer les mentions « en préparation / pas encore publiée » du README et du changelog par les informations de release, puis faire valider cette révision.

## Première publication

Au contrôle du 1er octobre 2026, le registre ne retourne aucune version publique de `@angularkit/atlas`. Cela ne prouve pas que le compte connecté dispose des droits sur le scope `@angularkit`. Le compte de publication doit disposer de ces droits ; la connexion npm et les éventuelles étapes 2FA se font dans le navigateur ou le terminal du mainteneur, sans transmettre de jeton dans une conversation.

Après validation explicite de la révision et de sa publication, télécharger l'archive du run retenu, vérifier sa liste de fichiers et son intégrité, puis tester la publication à blanc :

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish ./angularkit-atlas-0.1.0.tgz --dry-run --access public --provenance=false
```

Le test à blanc ne vérifie pas les droits d'écriture dans le registre. La commande effective, uniquement une fois l'accord de publication obtenu, est :

```sh
npm publish ./angularkit-atlas-0.1.0.tgz --access public --provenance=false
```

La provenance npm exige un environnement CI pris en charge. Une première publication depuis le terminal n'a donc pas d'attestation de provenance : l'option explicite `--provenance=false` surcharge le défaut du package pour cette opération seulement. Si une attestation est exigée dès la première version, préparer et relire un workflow de publication authentifié dans GitHub Actions avant de publier ; ce workflow n'est pas inclus dans la CI actuelle.

Après succès, vérifier `npm view @angularkit/atlas@0.1.0 version dist.integrity`, comparer l'intégrité au manifeste et tester la commande `npx` documentée. Une version déjà publiée ne doit pas être réutilisée. Le tag Git et les notes de release doivent désigner le commit correspondant à l'archive.

## Publications suivantes

Une fois le package créé, configurer un trusted publisher npm pour un workflow GitHub Actions dédié à `AngularKit/atlas`. Cette configuration et ce workflow feront l'objet d'une étape distincte : ils ne sont pas actifs avec cette PR. Le flux OIDC permet ensuite de publier sans jeton npm permanent, avec provenance depuis le dépôt public. Conserver un déclenchement explicite après relecture.

Références : [publication d'un package public avec scope](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [provenance npm](https://docs.npmjs.com/generating-provenance-statements/), [trusted publishing](https://docs.npmjs.com/trusted-publishers/).
