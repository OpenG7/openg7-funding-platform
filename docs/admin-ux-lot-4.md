# Lot 4 — Dossier commandite, progression et badges

Réalisé le 16 septembre 2026 selon le [plan](./admin-ux-plan-de-travail.md), les [requis](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

## Résultat visible

- **Modifier le dossier** permet de corriger les coordonnées depuis chaque onglet, avec confirmation, gestion des conflits et historique. Voir le [parcours et son contrat](./admin-sponsorship-editing.md).
- Sept onglets : **Résumé, Identité, Médias, Publication, Facturation, Remboursements, Historique**. URL directe : `/admin/fundraiser/sponsors?sponsorshipId=<uuid>&tab=billing`. Les changements d’onglet conservent les filtres de la liste ouverte et le lien de retour vers la file filtrée.
- Six jalons indépendants avec état, explication et lien : paiement, identité, médias, revue, facturation, publication. Une facture déjà émise reste terminée avant l’approbation administrative.
- Bloc **Prochaine étape** dans le dossier et carte **Commandite en cours** à côté de « À traiter » dans le cockpit large. Les jalons se réorganisent selon la largeur disponible.
- Identité séparée des contrôles de médias existants. L’Assistant contextuel se trouve dans **Résumé**, avec ses faits dépliables. Les formulaires existants de revue, publication et remboursement restent les points d’exécution.
- Factures et notes de crédit émises, publications et états de leurs lots/créneaux/tentatives, total confirmé remboursé, remboursements partiels, note de crédit manquante, erreurs Stripe et courriels échoués. Une tentative de publication simulée est identifiée.
- Consentement, revue, admissibilité au répertoire public et publication restent distincts. L’ancien badge « Visible » devient un badge de consentement. L’admissibilité reflète les règles actuelles du répertoire, pas une preuve de présence sur les réseaux sociaux.
- Badges de navigation issus de la même projection que la file, hors entrées informatives. Un dossier refusé incomplet ne déclenche plus une demande d’informations. Les compteurs inconnus ne sont pas présentés comme des zéros.
- Le dossier sélectionné est mémorisé par son UUID dans `sessionStorage`, jusqu’à la déconnexion ou l’expiration de session. Sans sélection, le cockpit charge le premier dossier lié à une action selon le tri de la file complète, avant filtres et pagination. Une sélection mémorisée supprimée est effacée; une URL directe introuvable ne charge pas un autre dossier.

Révision visuelle du 17 septembre 2026 : le tableau utilise les surfaces sombres du thème admin avec une légère teinte et un liseré par état de traitement (ambre, vert, bleu, turquoise, rose ou gris). La sélection et le focus clavier sont soulignés en bleu clair. Les libellés de statut restent présents; les badges conservent des couleurs de texte lisibles, y compris les niveaux Or, Argent et Bronze.

## Contrats et exécution

`GET /api/admin/sponsorships/progress?sponsorshipId=<uuid>` est protégé et servi avec `Cache-Control: private, no-store`. Sans identifiant, il utilise la priorité de la file. Réponses : `ok`, `empty`, `not_found`, `unavailable`; une erreur de lecture produit un 503, sans faux état terminé.

- Lecture du dossier exact dans une transaction **REPEATABLE READ READ ONLY**, avec libération de la connexion même en cas d’erreur. Aucun appel Stripe, envoi, publication ou écriture métier lors de l’ouverture.
- Projection financière en unités mineures entières avec devise explicite. Le navigateur ne fait que formater les montants.
- Remboursements confirmés provenant des audits Stripe réussis, événements `charge.refunded` traités et dernier résultat confirmé enregistré. Déduplication par remboursement; maximum par charge pour ses instantanés cumulatifs. Les notes de crédit ne confirment jamais un remboursement en attente. Une couverture insuffisante ou une référence de remboursement sans note reste signalée.
- Facture Stripe attendue uniquement pour une contribution rattachée à une session Stripe; aucun identifiant Stripe inventé pour les autres provenances.
- Les publications terminées restent des faits historiques, même si la revue ou le consentement change. Les annulations et erreurs sont présentées sans déduire un succès depuis la seule planification.
- Contrats de la file enrichis de `actionCounts` et `firstSponsorshipId`, sans supprimer les champs existants. L’Assistant sans identifiant utilise la même priorité de dossier.
- Les mutations existantes conservent `expectedVersion`. Les conflits 409 proposent une actualisation, les actions en cours sont désactivées et les lectures obsolètes sont ignorées après changement de dossier. Les réponses 401 effacent la session; les réponses 403 effacent les faits du bloc concerné.

## Composition

- [Contrats de progression](../packages/funding-core/src/sponsorship-progress.ts).
- [Projection et lecture API](../apps/funding-api/src/sponsorship-progress.service.ts), raccordées aux routes et à la file existantes.
- Organisme Funding [AdminSponsorshipProgressComponent](../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-progress.component.ts) : chargement, états, progression et navigation.
- Molécule [AdminSponsorshipFactsComponent](../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-facts.component.ts) : documents et faits persistés, sans mutation.
- Composants d’identité et de médias séparés, onglets, navigation, cockpit et service admin adaptés. Nouvelles chaînes en français et anglais; composants standalone, OnPush et compatibles SSR.

## Garanties vérifiées

- `yarn test`, Node 22 : **213 tests réussis**, compilation API/packages comprise.
- `yarn test:ui:admin` : build Angular, **22 routes publiques pré-rendues**, typage et **42 tests navigateur réussis**, dont neuf pour ce lot.
- PostgreSQL 16 jetable : **2 006 commandites**, dossier exact au-delà de l’ancienne limite, facture antérieure à la revue, priorité globale, annulation, remboursement partiel dédupliqué, crédits, erreurs de courriel/Stripe, minimisation des données et absence d’écriture à l’ouverture.
- Navigateur : URLs directes, rechargement d’onglet, retour à la file filtrée, sélection de session, actualisation des badges, conflit de version, désactivation pendant une action, réponse tardive, refus d’accès, expiration, clavier, anglais et largeur mobile de 390 px.
- ESLint ciblé et format des nouveaux fichiers vérifiés, ainsi que `git diff --check`. Le lint global garde **14 erreurs d’import et un avertissement préexistants hors périmètre**. Le contrôle de format global relève encore des écarts historiques; ces commandes globales ne sont pas vertes.

Depuis le lot 8, l’intégration crée sa propre base jetable avec Docker local. Reproduction avec Node 22 et Yarn 4 :

```sh
docker pull postgres:16-alpine
yarn build
node --test tests/integration/sponsorship-progress.integration.mjs
```

Le scénario ne charge ni `.env` ni `SPONSOR_PROGRESS_TEST_DATABASE_URL` et ne démarre aucun worker. Il s’exécute systématiquement et supprime son conteneur en fin de test. Voir la [recette actuelle](./admin-ux-lot-8.md) ; les résultats ci-dessus décrivent la validation initiale du lot 4.

## Limites et suite

- Aucune nouvelle migration ni opération manuelle sur les données. Les tables opérationnelles existantes sont nécessaires; une source manquante rend la projection indisponible.
- Les tests navigateur utilisent une API simulée; le test PostgreSQL vérifie séparément les requêtes réelles. La pile Docker/Stripe complète et la livraison réelle de courriels n’ont pas été testées pour ce lot.
- Les anciens formulaires gardent leur présentation actuelle. Leur harmonisation complète et leur traduction relèvent du lot 7; les nouveaux blocs et onglets sont traduits.
- Prochain lot : **lot 5 — Indicateurs, activité et état des systèmes**.
