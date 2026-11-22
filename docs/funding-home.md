# Page du Fonds des Bâtisseurs

La page compose trois composants de la feature Funding : le formulaire de
contribution, le bandeau de retour Checkout et le résumé financier. La page
orchestre le démarrage de Checkout et la projection publique; les composants
de présentation ne confirment jamais un paiement.

La [page À propos](funding-about.md) explique le rôle du fonds et oriente vers
ses sections de financement, la transparence et les autres parcours publics.
La [page Transparence](funding-transparency.md) détaille les agrégats et les
allocations publiées, partage l’objectif mensuel de l’accueil et renvoie vers
son formulaire de contribution.
La [page Commanditaires](public-sponsors.md) utilise `?intent=sponsorship#support`
pour demander la présélection du type entreprise, sous réserve de son activation
côté serveur. Les consentements restent à remplir; un choix personnel explicite
du visiteur est préservé si la configuration arrive tard.

## Du cap collectif aux avancées publiées

Sous la bannière, un encart FR/EN présente l'intention collective : mobiliser,
construire et documenter. Il oriente vers les [avancées publiées](public-progress.md)
avant les cartes de l'écosystème et renvoie au formulaire existant en déplaçant
le focus vers `#support`. Ces repères ne constituent pas un état d'avancement
ni une attribution individuelle des contributions aux projets.

Le soutien personnel et la commandite restent définis dans le formulaire et
dans l'offre applicable. Cet encart ne sélectionne aucun type de contribution,
ne coche aucun consentement et ne modifie ni prix ni prestation. Son contenu
reste lisible si les données publiques sont indisponibles.

## Montants

`GET /api/public/funding-config` expose `allowed_contribution_amounts`, issu de
`FUNDING_ALLOWED_AMOUNTS`. Cette clé historique fournit les suggestions affichées
sur les boutons; elle ne limite plus les nouvelles contributions personnelles à
une liste fixe. `personal_contribution_minimum_amount` annonce le minimum personnel,
en CAD et en unités majeures : 5 $ dans la politique courante.

Le formulaire permet un montant libre à partir de ce minimum, par exemple 7 $,
20 $, 75 $ ou 12,34 $. Les commandites conservent leur minimum et leurs prestations
propres. Une saisie personnalisée valide reste utilisable lors d'un changement de
type; un montant invalide reste visible et doit être corrigé explicitement.

Ces champs sont optionnels pour les déploiements progressifs. Le nouveau Web
n'affiche le champ personnel « Autre montant » qu'après réception d'un minimum
serveur valide. Un ancien serveur conserve ses boutons et sa validation de liste;
un ancien Web ignore le nouveau champ et continue de proposer ses montants fixes.
L'API valide toujours chaque nouvelle demande indépendamment du navigateur.

La règle courante s'applique aux nouvelles opérations. Le rejeu exact d'une
opération durable déjà acceptée conserve son montant et ses conditions; il ne
permet pas de créer une nouvelle contribution sous le minimum.

Le parseur accepte le point ou la virgule et au plus deux décimales. Il vérifie
des unités mineures entières avant conversion vers le contrat Checkout existant
en unités majeures; aucune écriture financière ni migration n'est modifiée.
Les signes, notations exponentielles et décimales supplémentaires sont refusés,
sans transformation silencieuse du montant.

L'API exige un objet JSON, un montant numérique sans arrondi et convertible en
unités mineures entières sûres, ainsi que `currency: "CAD"` selon le contrat
Checkout existant. Une valeur de montant textuelle, des décimales supplémentaires
ou une devise absente ou différente donnent `400` avant tout appel Stripe.
Les clients qui omettaient la devise doivent maintenant la fournir; le Web
actuel l'envoie déjà.

## Progression et confirmation

Chaque tentative Checkout porte une clé d'idempotence. Le Web conserve la clé et
une empreinte du contenu pour réessayer après une erreur, y compris après
rechargement lorsque le stockage de session est disponible, et regroupe les
soumissions concurrentes identiques. Une réponse acceptée termine la tentative;
une erreur réseau ou fournisseur reste une erreur, même en développement local.
Le [contrat Checkout](technical/checkout.md) décrit les
conflits, la persistance requise et les limites de reprise.

La progression et le montant restant utilisent `monthly_summary` pour le mois
UTC courant et la devise du rapport. L'absence de ligne pour ce mois vaut zéro
après réception du rapport. Les indicateurs du fonds conservent les totaux
cumulatifs. Le mois est réévalué lors de l'actualisation, toutes les 30 secondes.
Le premier chargement et les erreurs sans données ne sont jamais affichés comme
des montants nuls confirmés.

Le retour `checkout=success` reste en attente tant que la recherche de référence
côté API n'indique pas `paid`. Le suivi effectue au maximum 12 tentatives sur une
fenêtre de deux minutes, espacées de cinq secondes après chaque réponse, avec
un délai maximal de dix secondes par requête. Une seule requête est active.
Une fermeture ou une navigation annule le suivi et invalide les réponses tardives.
Après la pause, l'utilisateur peut vérifier à nouveau; sans référence, le support
reste accessible. Une pause ou une erreur ne constitue jamais un paiement refusé
ou confirmé.

## Images et validation locale

Les variantes WebP sont générées à partir des PNG existants :

```sh
yarn images:funding-home
```

Les vignettes ont des variantes de 480 et 960 pixels; les grandes illustrations,
de 960 et 1920 pixels. Le navigateur choisit via `srcset`; les images hors écran
sont différées. Les sources PNG restent disponibles pour les autres pages.
La même commande produit les variantes de l’illustration À propos en 960 et
1672 pixels.

```sh
yarn build
node --test tests/funding-home.test.mjs
yarn test:ui:funding-home
```

La suite navigateur utilise uniquement des API simulées et ne nécessite ni
Docker, ni Stripe, ni données de production. Elle couvre les montants, les
consentements, la confirmation serveur, les erreurs de transparence, le changement
de mois, les réponses tardives, la reprise et le clavier. Le build Angular valide
également les templates et le prérendu FR/EN.

L'encart du cap collectif et ses liens sont couverts par
[`public-progress.spec.ts`](../tests/playwright/public-progress.spec.ts), dans
`yarn test:ui:public-journeys` : FR/EN, clavier, consentements inchangés,
indisponibilité des données, accessibilité et mobile.
