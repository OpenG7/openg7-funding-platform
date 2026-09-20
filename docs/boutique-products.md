# Produits vedettes de la boutique

Les pages `/boutique` et `/en/boutique` présentent une sélection éditoriale
avant les collections, sous le titre « Royaumes enchantés ». Les commandes restent
sur NorthDragon. Trois emplacements sont prêts : Dragons, Princesses et Licornes.
Les boutons d'univers filtrent la sélection ; « Tous les univers » réaffiche
l'ensemble. Toutes les cartes sont présentes au rendu initial, même sans JavaScript.

## Emplacements préparés

| Univers    | Identifiant de carte | Dossier des photos            | Exemple de fichier |
| ---------- | -------------------- | ----------------------------- | ------------------ |
| Dragons    | `dragon-01`          | `assets/boutique/dragons/`    | `dragon-01.webp`   |
| Princesses | `princess-01`        | `assets/boutique/princesses/` | `princess-01.webp` |
| Licornes   | `unicorn-01`         | `assets/boutique/unicorns/`   | `unicorn-01.webp`  |

Ces dossiers sont sous `apps/funding-web/src/`. Les photos restent à fournir ;
aucun fichier absent n'est chargé et aucun prix ou produit commercial n'est inventé.

## Ajouter les images et les produits

1. Déposer les photos dans le sous-dossier de leur univers.
   Utiliser des noms descriptifs sans espaces, par exemple `princess-01.webp`.
   Privilégier WebP, environ 960 × 1200 px (ratio 4:5), idéalement moins de 250 Ko.
   JPEG et PNG sont également possibles. Le cadre conserve ses dimensions au chargement.
2. Modifier `apps/funding-web/src/app/features/funding/config/boutique-products.config.ts`.
   L'ordre du tableau détermine l'ordre d'affichage. Chaque entrée possède un `id` unique.
   `universe` vaut `dragons`, `princesses` ou `unicorns` et détermine le filtre
   et la couleur de l'emplacement. Pour ajouter un produit, dupliquer une entrée,
   puis attribuer un nouvel identifiant et de nouvelles clés de traduction.
3. Remplacer les titres et descriptions provisoires dans les deux fichiers
   `apps/funding-web/src/assets/i18n/fr-CA.json` et `en.json`.
   Ajouter une clé `imageAlt` au produit, décrivant réellement la photo dans chaque langue.
4. Remplacer `image: null` par les informations de la photo :

   ```ts
   image: {
     src: 'assets/boutique/princesses/princess-01.webp',
     altKey: 'funding.boutique.featured.items.princesses.imageAlt',
     fit: 'contain'
   },
   ```

   `contain` montre l'image entière, sans découper le produit. Choisir `cover`
   pour une photo d'ambiance dont le recadrage a été vérifié sur mobile.

5. Renseigner `price` uniquement lorsque le montant est confirmé, en cents CAD :
   `price: { amountMinor: 4500, currency: 'CAD' }` affiche 45,00 CAD en français.
   Il s'agit d'un exemple de format, pas d'un prix réel. Garder `null` si le prix
   est inconnu. Les prix sont éditoriaux et doivent être maintenus à jour.
6. Renseigner `productUrl` avec l'URL HTTPS exacte de la fiche NorthDragon.
   Passer `availability` à `available` seulement lorsque la fiche est prête.
   La carte entière devient alors un lien, annoncé comme ouvrant un nouvel onglet.

Les photos peuvent être ajoutées avant les prix et les liens. Une entrée
`coming-soon` reste consultable sans lien d'achat ; `sold-out` retire également
ce lien. Le badge global « À venir » disparaît dès qu'une entrée quitte l'état
`coming-soon`. Pour retirer un produit de la sélection, enlever son entrée.

## États prévus

- Aucune photo configurée : « Visuel à venir », sans requête vers un fichier absent.
- Échec de chargement d'une photo : « Visuel momentanément indisponible » dans le même cadre.
- Prix inconnu : aucun prix affiché.
- Produit à venir ou indisponible : statut traduit, aucun lien d'achat actif.
- Tableau vide : message de sélection en préparation.

La carte est une molécule de présentation locale à la boutique, standalone et
OnPush. Le chargement des images est natif et différé, avec largeur, hauteur et
texte alternatif ; aucun accès navigateur n'est nécessaire pour le rendu serveur.
Aucune API, migration, synchronisation de catalogue ou gestion de stock n'est ajoutée.

## Vérifier après ajout

```sh
yarn build
node --test tests/boutique-products.test.mjs
yarn workspace @openg7/funding-web build
yarn playwright test --config tests/playwright-boutique-ui.config.mjs
```

Les tests de configuration vérifient les fichiers image renseignés, les traductions,
les prix et les destinations. La suite UI vérifie les deux langues, le rendu initial
sans JavaScript, les filtres d'univers au clavier, la navigation, l'accessibilité de la sélection et l'absence de
débordement sur mobile. Elle intercepte les API, sans base de données ni Stripe.
Vérifier aussi visuellement le cadrage des vraies photos et la correspondance
avec les fiches NorthDragon avant publication.
