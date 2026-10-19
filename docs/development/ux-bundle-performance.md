# Mesure des bundles UX-06

Mesure du **19 octobre 2026**, pour OUX-016. La référence avant est la fusion
locale `ae106201` des lots UX-02 à UX-05. La mesure après porte sur les sources
UX-06 de cette PR, y compris le déplacement du contrôle audio mobile dans
l'en-tête et les ajustements du suivi privé. Les changements de réception et la
séparation des catalogues sont donc mesurés ensemble. La
[réception UX](ux-unification-acceptance.md) distingue les
scénarios existants des exécutions réellement vérifiées.

## Résultat et décision

| Mesure production                                | Avant          | Après          |
| ------------------------------------------------ | -------------- | -------------- |
| Graphe initial navigateur, CSS global inclus     | 899 949 octets | 505 389 octets |
| Transfert initial estimé par Angular             | 222,11 kB      | 134,90 kB      |
| Fichier `main`                                   | 561 943 octets | 3 181 octets   |
| Catalogues FR/EN dans les sorties initiales      | 554 181 octets | 158 593 octets |
| CSS global initial                               | 10 114 octets  | 10 379 octets  |
| Entrée des routes admin, chargée à la navigation | 3 155 octets   | 399 067 octets |
| Plus grosse page différée : dossier commandite   | 788 313 octets | 788 280 octets |
| Routes statiques prérendues                      | 25             | 25             |

Le graphe initial baisse de **394 560 octets, soit 43,84 %**. Les seuils existants
de [configuration Angular](../../angular.json) restent à 800 kB d'avertissement
et 900 kB d'erreur : le build avant avertit à 899,95 kB ; celui après reste sous
les deux seuils à 505,39 kB. Ici, kB signifie 1 000 octets, comme dans le rapport
Angular. Le fichier `main` seul reflète aussi une nouvelle répartition entre
chunks partagés ; le gain annoncé porte sur leur graphe initial complet.

L'audit identifie les deux catalogues généraux comme premier coût initial. Leurs
racines `admin` passent dans `admin-base.fr-CA.json` et `admin-base.en.json`,
importés uniquement par les routes administratives différées. Les fichiers
`fr-CA.json` et `en.json` conservent la racine publique `funding`. Les six libellés
de niveaux de modération, également employés par le suivi privé, passent de
`admin.moderation.levels.*` à `funding.moderation.levels.*` ; leurs consommateurs
admin et privés utilisent ce chemin commun. La fusion des deux fichiers est
structurellement égale au catalogue antérieur dans les deux langues, après cette
seule correspondance de chemins. Toutes les valeurs sont conservées.

Le chargement des traductions publiques reste synchrone. Un service enregistré
une fois par application fusionne les deux catalogues admin avant la première
page administrative et avant la vérification de session existante. Chaque
première fusion de feature pour une langue initialise sa base publique complète
depuis la même source que le loader. Cela évite qu'un catalogue partiel empêche
ngx-translate de charger les traductions publiques de cette langue. Les fusions
suivantes conservent les traductions propres aux features, sans réinitialiser la
base. L'ordre des vérifications de session et les contrôles API ne changent pas.
Aucune dépendance ou requête HTTP de traduction n'est ajoutée.

La page dossier de 788 kB est déjà différée. La subdiviser ajouterait des
frontières dans un écran partagé sans preuve de gain utile sur ce parcours ;
ce lot conserve son découpage. Le rapport permet de suivre ce coût lors d'une
évolution du dossier. Il ne fixe pas un objectif de taille pour chaque chunk.

La réception ajoute deux corrections au header partagé. Son hôte utilise le
contrat block/minimum de largeur nul/largeur complète déjà appliqué aux autres
hôtes publics : le cas mobile WebKit passe de 426 à 390 px de largeur défilable
pour un viewport de 390 px. Le CTA mobile est limité à 7 rem avec un texte
centré pouvant occuper deux lignes. Sous Chromium Linux et ses fontes locales,
le chevauchement de 9 px entre la marque FR et le contrôle de langue à 390 px
devient une marge de 13,72 px ; le header reste haut de 145,80 px et les contrôles
mesurent au moins 44 × 44 px. Les libellés et les écarts entre contrôles sont
conservés. Ces règles ne masquent aucun débordement par découpage du contenu.
Ces deux corrections ajoutent 55 octets au CSS global par rapport au build UX-06
qui les précédait, soit 10 324 → 10 379 octets. Le tableau inclut ce coût.

## Reproduire

Utiliser **Node 22.23.3**, **Yarn 4.9.4** et le lockfile du dépôt. La compilation
TypeScript `yarn build` n'est pas la compilation Angular. Pour éviter de modifier
le checkout de travail, créer une référence isolée :

```sh
git worktree add --detach ../funding-ux06-baseline ae106201
```

Dans ce worktree de référence :

```sh
yarn install --immutable
yarn workspace @openg7/funding-web build --configuration production --stats-json
cp dist/apps/funding-web/stats.json ../ux06-before-stats.json
```

Dans le checkout de la PR UX-06, après installation avec le même lockfile :

```sh
yarn workspace @openg7/funding-web build --configuration production --stats-json
node apps/funding-web/tools/bundle-report.mjs ../ux06-before-stats.json
node apps/funding-web/tools/bundle-report.mjs
```

Le [rapporteur](../../apps/funding-web/tools/bundle-report.mjs) lit les sorties
`--stats-json`, suit les imports statiques de `main`, ajoute les styles globaux
et exclut les imports dynamiques de ce total. Il liste les plus grosses entrées
initiales, les scripts différés et les budgets configurés. Un fichier absent ou
un rapport sans entrée navigateur échoue avec un code non nul. Les noms hachés
et les chemins de `node_modules` peuvent varier selon le checkout ; comparer
les octets et les points d'entrée. Le fichier `stats.json` est un artefact de
build, pas un fichier source à committer.

## Portée et contre-épreuves

Ce total mesure les sorties du graphe initial, pas tout le chargement d'une
route. La page visitée et ses dépendances différées s'y ajoutent ; le cache,
la compression du serveur, le réseau et l'appareil modifient le transfert réel.
Le transfert Angular est une estimation de build. Aucun résultat LCP, TTI,
mémoire ou temps de navigation n'est revendiqué.

La [suite d'accessibilité](../../tests/playwright/platform-accessibility.spec.ts)
contrôle, en FR/EN, l'absence de code et de textes du catalogue admin dans les
scripts téléchargés par l'accueil public. Elle vérifie aussi les accès directs
admin et les allers-retours de langue, l'accueil sans JavaScript, le maintien
du chargement différé de l'accueil depuis une route secondaire et les 404.
Ces assertions comportementales complètent les tailles du rapport ; consulter
la réception pour leur résultat sur la révision testée.
