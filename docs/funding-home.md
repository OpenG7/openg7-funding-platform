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

## Montants

`GET /api/public/funding-config` expose désormais `allowed_contribution_amounts`,
issu de `FUNDING_ALLOWED_AMOUNTS`, en plus des champs existants. Ce champ est
optionnel dans le contrat pour les déploiements progressifs : un ancien serveur
conserve le comportement fondé sur la configuration locale du Web. L'API continue
à valider chaque demande de Checkout.

Les contributions personnelles sont limitées à cette liste. Les commandites
acceptent les montants personnalisés respectant le minimum existant. Le passage
de personnel à commandite remplace un montant prédéfini incompatible par le
premier montant admissible. Une saisie personnalisée reste visible et doit être
corrigée explicitement si elle devient invalide.

Le parseur accepte le point ou la virgule et au plus deux décimales. Il vérifie
des unités mineures entières avant conversion vers le contrat Checkout existant
en unités majeures; aucune écriture financière ni migration n'est modifiée.
Les signes, notations exponentielles et décimales supplémentaires sont refusés,
sans transformation silencieuse du montant.

## Progression et confirmation

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
