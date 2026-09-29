# Lot 4 — Dossier commandite, progression et badges

Réalisé le 16 septembre 2026 selon le [plan](./admin-ux-plan-de-travail.md), les [requis](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

## Résultat visible

- **Modifier le dossier** permet de corriger les coordonnées depuis chaque onglet, avec confirmation, gestion des conflits et historique. Voir le [parcours et son contrat](./admin-sponsorship-editing.md).
- Sept onglets : **Résumé, Identité, Médias, Publication, Facturation, Remboursements, Historique**. URL directe : `/admin/fundraiser/sponsors?sponsorshipId=<uuid>&tab=billing`. Les changements d’onglet conservent les filtres de la liste ouverte, le lien de retour vers la file filtrée et la position de défilement dans la limite de la hauteur du nouvel onglet. Le focus reste sur le bouton activé; sélectionner à nouveau l’onglet courant ne déclenche pas de navigation. Les autres navigations et les boutons précédent/suivant du navigateur gardent le comportement du routeur.
- Six jalons indépendants avec état, explication et lien : paiement, identité, médias, revue, facturation, publication. Leurs liens conservent le défilement et le focus lorsqu’ils changent uniquement l’onglet du dossier ouvert, y compris lors d’un nouveau clic sur l’étape courante. Depuis le cockpit ou vers un autre dossier, la navigation reste celle du routeur. Une facture déjà émise reste terminée avant l’approbation administrative.
- Bloc **Prochaine étape** dans le dossier et carte **Commandite en cours** à côté de « À traiter » dans le cockpit large. Les jalons se réorganisent selon la largeur disponible.
- **Guide pas à pas du dossier**, repliable sous la progression : l’étape recommandée par l’API est ouverte par défaut, avec son état, la personne qui intervient, trois instructions et la condition de validation. Les boutons précédent/suivant parcourent les six jalons ; un incident prioritaire (remboursement, Stripe ou courriel) apparaît comme un contrôle supplémentaire. Parcourir le guide ne valide rien. Une actualisation ou un changement de dossier reprend la recommandation courante. Les lecteurs accèdent aux sections en consultation ; les opérateurs/propriétaires peuvent ouvrir le formulaire existant de correction d’identité, et le propriétaire peut rejoindre le contrôle de renvoi du lien privé. Ces raccourcis conservent les confirmations existantes. Les dossiers terminés restent consultables ; chargement, erreur et refus d’accès retirent le guide avec les faits devenus indisponibles.
- Identité séparée des contrôles de médias existants. L’Assistant contextuel se trouve dans **Résumé**, avec ses faits dépliables. Les formulaires existants de revue, publication et remboursement restent les points d’exécution.
- L’étape **Publication** présente les avantages inclus, les prérequis manquants et une carte par réseau avec état et date. Les liens ouvrent le moteur sur ce dossier, ou directement sur son envoi, sans préparation ni autorisation au clic. Les anciens réglages restent dans **Paramètres avancés**. La visibilité du site est distincte des envois sociaux ; une simulation ne termine pas l’étape.
- Factures et notes de crédit émises, publications et états de leurs lots/créneaux/livraisons automatiques (anciennes tentatives en repli), total confirmé remboursé, remboursements partiels, note de crédit manquante, erreurs Stripe et courriels échoués. Une tentative de publication simulée est identifiée.
- Consentement, revue, admissibilité au répertoire public et publication restent distincts. L’ancien badge « Visible » devient un badge de consentement. L’admissibilité reflète les règles actuelles du répertoire, pas une preuve de présence sur les réseaux sociaux.
- Badges de navigation issus de la même projection que la file, hors entrées informatives. Un dossier refusé incomplet ne déclenche plus une demande d’informations. Les compteurs inconnus ne sont pas présentés comme des zéros.
- Le dossier sélectionné est mémorisé par son UUID dans `sessionStorage`, jusqu’à la déconnexion ou l’expiration de session. Sans sélection, le cockpit charge le premier dossier lié à une action selon le tri de la file complète, avant filtres et pagination. Une sélection mémorisée supprimée est effacée; une URL directe introuvable ne charge pas un autre dossier.

Révision visuelle du 17 septembre 2026 : le tableau utilise les surfaces sombres du thème admin avec une légère teinte et un liseré par état de traitement (ambre, vert, bleu, turquoise, rose ou gris). La sélection et le focus clavier sont soulignés en bleu clair. Les libellés de statut restent présents; les badges conservent des couleurs de texte lisibles, y compris les niveaux Or, Argent et Bronze.

## Revue des commandes du dossier — 27 septembre 2026

Les actions tiennent compte du rôle : le lecteur consulte les notes et les médias sans modification; le remboursement Stripe et le renvoi du lien privé sont réservés au propriétaire (ou à la session du mode token). L’API reste responsable de l’autorisation. Les contrôles de revue, de médias et d’enregistrement sont bloqués pendant une action de la page ou après un conflit de version. Les décisions de revue déjà appliquées sont désactivées.

**Refuser** ouvre le résumé avec une URL cohérente et place le focus sur la raison obligatoire. **Rembourser Stripe** place le focus sur le montant; annuler revient au bouton déclencheur. Les boutons de fermeture affichent une croix. **Tout approuver** transmet les textes alternatifs saisis; un média approuvé offre **Enregistrer le texte alternatif** lorsqu’il a changé. Un échec conserve la saisie pour la reprise.

Les **Actions de validation** restent accessibles dans une barre flottante au bas du dossier pendant sa lecture, sur tous ses onglets. La barre rappelle le nom et la référence du commanditaire sélectionné. Elle suit le défilement interne du panneau sur grand écran et celui de la page en affichage empilé ; les boutons occupent deux colonnes sur mobile. Elle est absente en lecture seule et à la fermeture du dossier. Les droits, états désactivés et confirmations des actions restent ceux du dossier.

**Accepter** affiche un anneau d’attente pendant la requête. Après confirmation de la mise à jour par l’API, une coche se dessine, deux ondes et des éclats émeraude/or accompagnent le bouton et la barre s’illumine brièvement. Un échec affiche un contour d’erreur sans célébration. Le retour visuel est temporaire, lié au dossier courant et annulé lorsqu’on le quitte ; il ne modifie aucun statut métier. Avec la préférence de mouvement réduit, seuls les repères statiques et le message de résultat sont conservés.

Le lien `data-og7="dossier-next"` nomme sa destination : **Voir les actions de validation**, **Voir les médias**, **Voir la facturation**, etc. Il ouvre l’onglet recommandé par l’API puis fait défiler et place le focus sur la section correspondante, même si cet onglet est déjà ouvert. Les ancres `#dossier-…` fonctionnent aussi depuis le cockpit et après ouverture directe ou rechargement; le focus attend le rendu des données du dossier. Une navigation ultérieure annule une demande de focus encore en attente. Les boutons précédent/suivant du navigateur conservent la restauration du défilement. Le lien n’exécute aucune mutation et reste utilisable par un lecteur; lorsque `next.reason` vaut `complete`, il laisse place au message **Dossier terminé**. Les onglets et jalons ordinaires conservent leur défilement, y compris après une visite par ancre.

La [suite navigateur du dossier](../tests/playwright/admin-sponsorship-progress.spec.ts) vérifie les commandes suivantes avec une API interceptée :

| Groupe                        | Contrôles exercés                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation et liste           | Sept onglets, six jalons, lien vers la prochaine étape, fermeture, actualisation/reprise, copie de référence, filtres, réinitialisation et pagination    |
| Résumé et identité            | Modification avec confirmation, note interne, annulation, clavier, conflits, expiration et historique                                                    |
| Médias                        | Aperçu, ajout de logo, refus de MIME/taille, suppression confirmée, approbation individuelle/groupée, texte alternatif et reprise après erreur           |
| Publication et facturation    | Enregistrement, confirmation du statut publié, conservation du brouillon après erreur, liens vers publications, factures et courriels échoués            |
| Refus, remboursement et accès | Raison obligatoire, référence/montant, annulation sans mutation, verrouillage pendant l’envoi, destinataire confirmé et identifiant de reprise du renvoi |
| Permissions et langues        | Lecteur, opérateur, propriétaire, états financiers bloquants, français/anglais et mobile 390 px                                                          |

Les parcours de l’Assistant sont couverts séparément par [ses tests contextuels](../tests/playwright/admin-assistant-context.spec.ts). Ces contrôles valident l’interface et les requêtes émises; ils n’exécutent aucun remboursement réel, aucune publication réelle ni livraison de courriel et ne qualifient pas les fournisseurs externes.

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
- Molécule [AdminSponsorshipGuideComponent](../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-guide.component.ts) : explication des étapes reçues, navigation et ouverture des contrôles existants ; aucune requête ni validation métier autonome.
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
