# Transparence du Fonds des Bâtisseurs

La page `/fonds-des-batisseurs/transparence` (et sa version `/en/…`) présente la projection publique de `GET /api/public/fund-transparency`. Elle ne confirme aucun paiement et ne calcule aucun solde comptable autoritaire.

## Lecture des chiffres

- Les quatre indicateurs sont cumulatifs : contributions, frais renseignés, remboursements et **net avant dépenses opérationnelles**. Le champ API historique `current_available_estimate` conserve sa formule : net des paiements moins remboursements. Un versement Stripe est un transfert bancaire, pas une dépense supplémentaire.
- La progression mensuelle utilise `FUNDING_PROJECT_CONFIG` et les mêmes fonctions de période UTC et de contributions mensuelles que l’accueil. L’objectif actuel est de 270 CAD. Les contributions historiques ne remplissent pas l’objectif du mois courant. Une devise différente de celle de la campagne laisse la progression indisponible.
- Le registre présente les contributions, frais et remboursements des périodes mensuelles fournies par l’API, jusqu’aux 12 dernières périodes. Le filtre de type agit uniquement sur le tableau; la période choisie agit sur le tableau et les deux exports.
- Les allocations affichées sont les dernières publications retournées par l’API, avec avancement et preuve lorsqu’ils sont renseignés. Une allocation n’est pas une dépense exécutée. La page ne publie plus de pourcentages de répartition sans source.
- `pending_fee_count` compte les paiements dont les frais ne sont pas documentés par une transaction de solde du fournisseur. Une valeur positive affiche « net provisoire »; zéro distingue des frais complets, y compris des frais réellement nuls. Le champ est optionnel pour les anciens serveurs : absent ou `null`, la complétude reste inconnue. Le compteur est aussi disponible par mois et dans les exports.

En PostgreSQL, les mois proviennent de l’union des contributions et des mouvements du registre, puis sont limités aux 12 plus récents. Les remboursements et versements d’un mois sans contribution restent visibles. Les regroupements sont explicitement UTC, indépendamment du fuseau de la connexion.

La règle de remboursement cumulée est conservée : dès qu’un montant de remboursement existe dans le registre, celui-ci est prioritaire. Cette même règle s’applique désormais à tous les mois; le repli sur le statut `refunded` ne double plus un remboursement enregistré dans un mois ultérieur. Sans registre de remboursements, le repli historique reste rattaché au mois du paiement.

La projection PostgreSQL refuse les contributions confirmées de plusieurs devises, les mouvements de plusieurs devises et les devises incompatibles entre contributions et mouvements. Les contributions non confirmées n’influencent pas la devise publique. Ce refus retourne une indisponibilité, jamais un total additionnant CAD et USD.

## Disponibilité et actualisation

Le premier chargement, une erreur initiale et `data_source: empty` affichent des montants inconnus (`—`), sans date de données inventée. Un rapport valide à zéro conserve un vrai zéro. Les réponses financières malformées ou contenant des agrégats de devises différentes sont refusées par la page.

La page relit l’API toutes les 60 secondes lorsqu’elle est visible et propose une action manuelle. Il n’y a qu’une requête active, avec abandon après 15 secondes. La navigation interrompt la requête et le minuteur. En cas d’échec, les derniers chiffres restent affichés avec un avertissement; les exports sont désactivés jusqu’à une lecture réussie.

Deux dates UTC sont distinguées : `last_updated_at` fourni par la source et la dernière lecture réussie dans ce navigateur. En mode Stripe direct, `last_updated_at` est la date de construction de la projection. En mode base de données, sa sémantique reste celle du contrat existant. La lecture du navigateur ne garantit pas que les webhooks ou la projection amont sont à jour.

Le champ API optionnel `generated_at` donne le début de lecture de la projection et reste inchangé dans le cache. La progression du mois courant reste inconnue si cette lecture appartient au mois précédent, même lorsque la requête HTTP réussit. Après une panne au changement de mois, l’ancien rapport ne peut donc pas produire un faux zéro pour le nouveau mois. Pour un serveur ancien qui n’émet pas ce champ, la page utilise le début de sa requête réussie comme repère.

## Rapports téléchargeables

- **JSON** : schéma version 1, source, devise, date des données, date d’export et agrégats mensuels de la période choisie. `scope: month` exclut les totaux cumulatifs. `scope: cumulative_totals_and_available_months` les conserve avec les mois disponibles; il ne prétend pas fournir un historique mensuel exhaustif.
- **CSV** : une ligne par mois, avec devise, contributions, frais, net, remboursements, versements et nombre de contributions. Chaque ligne porte aussi la source et les dates. Si aucun mois n’est disponible, le CSV contient seulement les en-têtes.
- Les exports sélectionnent explicitement les champs financiers publics. Ils ne sérialisent ni champs supplémentaires reçus, ni coordonnées, ni fiches de bâtisseurs. Les noms de fichiers incluent le mois lorsqu’une période précise est choisie.

Les paramètres publics `?period=2026-09&type=refunds` rétablissent une vue lors de son chargement, de son partage et des navigations précédent/suivant. Les types admis sont `contributions`, `fees` et `refunds`; l’absence de paramètre correspond à « tous ». Une période syntaxiquement valide mais absente du rapport reste sélectionnée, affiche son indisponibilité et bloque l’export. Une valeur malformée revient au choix par défaut. La copie du lien ne reprend que ces paramètres validés et conserve la langue.

## Lecture Stripe direct

Les sessions Checkout et les versements sont parcourus par curseur jusqu’à la dernière page. Une erreur intermédiaire ou un curseur qui n’avance pas fait échouer la projection; aucun total partiel n’est retourné. Un même PaymentIntent ne peut être compté deux fois.

Le point d’entrée public mutualise cette lecture avec un cache mémoire de 60 secondes par lecteur Stripe configuré, dans chaque processus API. Les requêtes simultanées attendent la même promesse. L’expiration est calculée depuis le début de lecture; une lecture lente ne prolonge pas la fraîcheur. Les dates de la projection sont préservées. Après expiration, une erreur est retournée aux visiteurs concernés sans servir l’ancien résultat comme un succès; la requête suivante peut réessayer. La projection PostgreSQL n’utilise pas ce cache. Aucune nouvelle configuration ni infrastructure n’est nécessaire.

Le contrat reste mono-devise : plusieurs devises de contribution ou une conversion entre paiement et règlement provoquent une erreur explicite au lieu d’additionner des unités incompatibles. Les versements, qui concernent le compte Stripe, sont limités à la devise du fonds. Leur montant ne représente pas une dépense de projet. Sans contribution, la devise par défaut reste CAD.

Limites existantes : les frais indisponibles peuvent encore compléter le net; les contestations ne sont pas détaillées séparément; Stripe direct rattache les remboursements au mois du paiement d’origine, tandis que PostgreSQL peut utiliser leur date dans le registre. Les totaux cumulés ont la même sémantique, mais les répartitions mensuelles peuvent donc différer entre sources. Le coût d’une reconstruction Stripe direct augmente avec l’historique malgré le cache; PostgreSQL reste la projection persistante destinée aux usages opérationnels.

## Relations entre pages

Les actions de contribution conduisent à `/fonds-des-batisseurs#support`, dans la langue courante. Les montants, consentements et conditions sont ainsi présentés dans le formulaire commun. La page renvoie aussi vers À propos pour l’utilisation du fonds, `/ecosystem#platforms` pour les plateformes, la politique d’utilisation et `/support` pour le contact.

Les illustrations réutilisent les dérivés WebP existants. La galerie des 13 plateformes et le formulaire de paiement dupliqué ont été retirés de cette page.

## Validation locale

```bash
yarn test
yarn lint
yarn test:ui:funding-transparency
node --test tests/integration/funding-transparency.integration.mjs tests/integration/funding-payment-trust.integration.mjs
```

La suite UI sert le build pré-rendu sur `127.0.0.1:4179` avec les API interceptées, sur Chromium desktop et mobile. Elle couvre FR/EN, cohérence avec l’accueil, navigation clavier, preuves publiées, exports et confidentialité, chargement/erreur/reprise, expiration des requêtes, actualisation, source absente, vrai zéro et SSR sans JavaScript. Elle n’effectue ni seed, ni paiement, ni opération sur une base de données.

Les tests Node couvrent les calculs existants PostgreSQL et Stripe direct, les pages Stripe au-delà de 100 éléments, les erreurs de pagination, les devises, les champs exportés et le cache partagé. La suite navigateur couvre également le changement de mois pendant une panne, une réponse issue du cache du mois précédent, les états des frais et les liens avec période/filtre.

Les tests d’intégration utilisent PostgreSQL 16 dans des conteneurs jetables locaux, sans lire `.env` ni `DATABASE_URL`. Ils appliquent les migrations existantes et vérifient les mois sans contribution, les remboursements complets sans doublon, les frais manquants/tardifs, les devises, la limite des 12 périodes, les frontières UTC, le mode transaction seul et la concordance des sources. Ils nécessitent l’image locale `postgres:16-alpine`. La validation de la production et les parcours comptables E2E complets restent des vérifications distinctes.
