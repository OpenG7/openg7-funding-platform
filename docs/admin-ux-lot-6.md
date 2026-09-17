# Lot 6 — Recherche globale

## Expérience livrée

La recherche ouvre les dossiers et leurs documents depuis toutes les pages administratives qui utilisent le layout ou la navigation partagée. Le bandeau du cockpit contient le déclencheur; les pages historiques le présentent dans leur navigation, en attendant leur harmonisation au lot 7.

- Ouverture par bouton, `Ctrl+K` ou `Cmd+K`; fermeture par Échap, retour du focus au déclencheur.
- Fenêtre modale nommée, focus confiné, navigation par Tab ou flèches et activation par Entrée.
- Recherche temporisée de 300 ms, annulation de la requête précédente et rejet des réponses tardives, y compris si un adaptateur ignore l’annulation.
- Un résultat par contribution, avec les liens de commandite, contribution, facture et publications associées.
- États distincts : saisie insuffisante, chargement, aucun résultat, couverture partielle, indisponibilité, refus d’accès et limitation de débit. Un 401 efface la session et retourne à la connexion.
- FR/EN et mobile. La saisie et les résultats restent dans la mémoire du composant et sont effacés à la fermeture.

## Contrat API

`POST /api/admin/search` (alias `/admin/search`) est une **lecture protégée**. Le corps JSON contient :

```json
{ "query": "FAC-2026-001", "page": 1, "pageSize": 10 }
```

Le POST évite de mettre un courriel ou un autre terme privé dans l’URL. Aucun résultat ne recopie la requête ni les courriels recherchés. Les erreurs sont génériques; le gestionnaire ne journalise pas les erreurs SQL qui pourraient contenir les paramètres.

| Paramètre  | Règle                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `query`    | Chaîne de 2 à 120 caractères après retrait des espaces aux extrémités et normalisation NFC; caractères de contrôle refusés. |
| `page`     | Entier de 1 à 10 000, défaut 1.                                                                                             |
| `pageSize` | Entier de 1 à 20, défaut 10.                                                                                                |
| Corps      | JSON obligatoire, au plus 4 Kio.                                                                                            |

L’autorisation précède la validation et la lecture. La limitation de débit administrative existante s’applique. Les réponses du gestionnaire portent `Cache-Control: private, no-store`. Une méthode autre que POST produit 405, un type de contenu incorrect 415, une saisie invalide 400 et une panne de lecture 503.

Le [contrat partagé](../packages/funding-core/src/admin-search.ts) retourne `groups`, `total`, `page`, `pageSize`, `available` et `missingSources`. Le total compte les **dossiers**, avant pagination, pour les sources disponibles; il ne compte pas les documents liés.

## Recherche et regroupement — points de transfert

Le [service API](../apps/funding-api/src/admin-search.service.ts) interroge trois sources :

| Source        | Champs recherchés                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contributions | Entreprise, nom public, courriels privé et de contact, référence publique, slug, UUID, identifiants Checkout Session, PaymentIntent et remboursement conservé sur le dossier. |
| Factures      | Numéro, UUID, référence, entreprise et courriel du snapshot, identifiants Checkout Session et PaymentIntent.                                                                  |
| Publications  | UUID et titre du brouillon.                                                                                                                                                   |

La recherche Stripe porte sur les identifiants persistés dans ces sources. Elle n’interroge pas Stripe en direct et n’est pas un moteur de recherche des payloads bruts d’événements.

La comparaison textuelle ignore la casse, conserve les accents et classe les correspondances exactes avant les préfixes, puis les sous-chaînes. L’UUID du dossier départage les égalités pour stabiliser la pagination. Les caractères `%`, `_` et `\` sont littéraux; les valeurs sont toujours liées aux paramètres SQL.

Les montants sont comparés exactement au champ entier `amount_cents` existant. Exemples : `100,50 CAD`, `CAD 100.50`, `100.50`. Deux décimales au plus, sans séparateurs de milliers. Sans devise, chaque dossier conserve sa propre devise; aucun montant n’est additionné. Il ne s’agit pas d’une conversion monétaire.

Les correspondances provenant de plusieurs sources sont regroupées par `contribution_id` avant la pagination. Les documents sont joints seulement pour la page retenue. Une facture est unique par contribution; les brouillons sont uniques par contribution/cible/canal.

Le service réutilise le [lecteur transactionnel du cockpit](../apps/funding-api/src/admin-cockpit/read.ts) : `REPEATABLE READ READ ONLY`, acquisition de connexion bornée à 2 secondes et requêtes bornées à 5 secondes. Les lectures ne génèrent ni courriel, ni document, ni audit métier. Une table de factures ou de publications absente donne des résultats partiels; la source contributions absente rend la recherche indisponible. Une erreur SQL rend la requête indisponible, sans faux succès.

## Navigation exacte

Les liens contiennent uniquement des identifiants internes :

- Commandite : `sponsors?sponsorshipId=<uuid>`.
- Contribution : `contributions?contributionId=<uuid>`.
- Facture : `invoices?contributionId=<uuid>`.
- Publication : `publications?draftId=<uuid>`.

Le filtre optionnel `contributionId` de `GET /api/admin/contributions` est désormais appliqué avant la limite de 250 lignes. Le résumé global et l’export CSV existants conservent leur portée. Sans ce paramètre, le comportement de la liste reste identique.

Les pages contributions, factures et publications observent les changements de paramètres, effacent le contexte précédent et chargent le nouvel objet même sur la même route. Un compteur de génération empêche une ancienne réponse de rétablir le mauvais dossier.

Le [composant Angular](../apps/funding-web/src/app/features/funding/components/admin-search/admin-global-search.component.ts) est un organisme métier standalone et OnPush. Il porte uniquement l’état local de recherche et de navigation; aucun store global ni persistance de la requête.

## Reproduction des validations

Node 22 et Yarn 4 :

```powershell
yarn test
yarn test:ui:admin
```

Le [test PostgreSQL](../tests/integration/admin-search.integration.mjs) exige une base **locale neuve** nommée `search_test`. Il refuse une base déjà initialisée, applique les migrations existantes et crée des fixtures synthétiques. Aucun fichier `.env` n’est chargé et aucun worker n’est démarré.

```powershell
yarn build
$env:SEARCH_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55483/search_test'
node --test tests/integration/admin-search.integration.mjs
```

Ce scénario est ignoré sans la variable explicite et reste séparé de `yarn test`.

## Résultats de validation

- `yarn test`, Node 22 : **225 tests réussis**, compilation API/packages comprise.
- Build Angular réussi avec **22 routes publiques pré-rendues**; vérification TypeScript des tests UI.
- **50 scénarios navigateur existants réussis** lors de la suite complète; après correction du clavier, **13 scénarios de recherche réussis** lors de la relance ciblée. Couverture : raccourcis, focus, Échap, confidentialité, temporisation, annulation et réponse tardive, pagination, pannes et sessions, navigation sur la même route, FR/EN et largeur de 320 px.
- Test PostgreSQL 16 réussi sur **2 008 contributions** : recherche sur chaque champ, exactitude des centimes, caractères SQL littéraux, pertinence, regroupement, pagination stable, ancien dossier hors limite, sources manquantes et absence d’effets métier.
- Captures desktop et mobile relues. Conteneur de test et volume supprimés après validation.
- ESLint des fichiers TypeScript modifiés et nouveaux, format des nouveaux fichiers et `git diff --check` réussis.
- Le lint global conserve **14 erreurs d’import et un avertissement préexistants hors périmètre**. Le format global reste non vert (302 fichiers signalés, dont des fichiers historiques et des artefacts locaux); aucune remise en forme générale du dépôt.

## Portée et suite

Aucune nouvelle migration, dépendance ou variable applicative requise. Le test mesure la requête SQL réelle avec `EXPLAIN (ANALYZE, BUFFERS)` : environ 6 ms d’exécution sur 2 008 contributions dans PostgreSQL 16 local. Cette mesure ne prédit pas les performances d’un volume de production; aucun index ajouté sans preuve de besoin.

Les tests navigateur emploient des réponses API simulées; le test PostgreSQL vérifie les requêtes réelles séparément. La pile Docker applicative complète et les intégrations externes réelles restent à couvrir lors de la recette transverse. Prochain lot : **lot 7, panneaux latéraux et harmonisation des pages**.
