# Documentation de la plateforme

Révision : 29 octobre 2026.
L'[état de la plateforme](platform-status.md) distingue fonctions livrées,
préconditions et preuves, sans présumer leur activation en production.

## Guides fonctionnels actuels

Partir du [socle agent](../AGENTS.md), puis lire les règles du chemin et du domaine.
[Validation](development/validation.md) : commandes et garanties.
Architecture en [français](ARCHITECTURE.md) **ou** [anglais](ARCHITECTURE.en.md).

La [consolidation](development/application-consolidation.md) recense règles
partagées, propriétaires et vérifications.

Blueprints : [pages de la plateforme](development/platform-functional-visual-blueprint.md)
et [démo des prestations](development/service-demo-blueprint/README.md).

La [référence CSS et frameworks](development/css-frameworks.md) présente l'inventaire
reproductible, l'intégration Tailwind et les correspondances avec Material/CDK.

Références techniques extraites du README : [configuration](technical/configuration.md),
[API admin](technical/admin-api.md), [API publique](technical/public-api.md) et
[Stripe/webhooks/backfill](technical/stripe.md). Lire la section utile seulement.

L’[inventaire des barrières de sécurité](technical/security-barriers.md) décrit
le bouclier intégré, ses preuves de code et de tests, ses conditions d’activation
et ses limites. Les résultats de validation y sont datés et rattachés à la
révision examinée ; ils ne certifient pas l’état de production.

L’[inventaire daté des 71 scénarios de bout en bout](development/end-to-end-scenarios-inventory.md)
conserve les parcours recensés pour préparer les prochaines recettes. Ses numéros
servent de repères ; la présence d’un scénario ne constitue pas une preuve de test.

| Parcours                                                      | Référence                                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonds, montants et retour Checkout                            | [Accueil](funding-home.md), [confirmation des paiements](payment-trust-validation.md)                                                         |
| À propos et navigation entre pages                            | [À propos](funding-about.md)                                                                                                                  |
| Totaux, frais, allocations, filtres et exports                | [Transparence](funding-transparency.md)                                                                                                       |
| Annuaire, consentements et médias des commanditaires          | [Commanditaires](public-sponsors.md)                                                                                                          |
| Reconnaissance personnelle, aide et recherche de contribution | [Bâtisseurs et support](public-builders-and-support.md)                                                                                       |
| Suivi privé, récupération et brouillons                       | [Accès et brouillons](sponsorship-access-and-drafts.md)                                                                                       |
| Comptes admin, MFA, rôles, révocation et alertes              | [Accès et alertes](operations/admin-identity-and-alerts.md), [décision d'architecture](decisions/2026-09-19-admin-identity-and-operations.md) |
| Courriels transactionnels et rappels                          | [SMTP](email-smtp.md)                                                                                                                         |

La configuration actuelle des commandites propose 50, 100, 250 et 500 CAD,
avec un minimum de 50 CAD. Les avantages cumulatifs commencent à 50 CAD pour
la mention Web, 250 CAD pour Facebook et 500 CAD pour LinkedIn. Les sources
sont `packages/funding-core/src/index.ts` et la configuration Funding du Web.
Le paiement, le consentement, la revue et la publication restent distincts.

Les [engagements durables](technical/sponsorship-commitments.md) décrivent l'offre
acceptée avant Checkout et les dossiers historiques à qualifier.
Les [preuves de reconnaissance](technical/sponsorship-fulfilment.md) distinguent
livraisons attestées, simulations et visibilité actuelle.
Le [suivi des délais et durées](technical/sponsorship-obligation-timing.md)
décrit les origines justifiées et les attestations humaines pour le site OpenG7.
L'[audit des preuves historiques](technical/sponsorship-historical-audit.md)
organise leur examen sans réécrire les faits conservés.
Les [incidents de fiabilité](technical/publication-reliability.md) permettent une
consultation filtrée et paginée avec accès au dossier concerné. La
[mesure des grandes files](development/publication-performance.md) décrit la recette synthétique.
Les [formats de publication](technical/publication-formats.md) indiquent les
capacités vérifiées des adaptateurs et les formats encore indisponibles.

Les pages `/ecosystem`, `/music` et `/boutique` sont des surfaces éditoriales
avec liens externes, disponibles également sous `/en`. La politique publique
se trouve sous `/politique-utilisation-remboursement`. Les routes effectives
sont définies dans `apps/funding-web/src/app/app.routes.ts`; le rendu initial
est décrit dans `app.routes.server.ts` et le statut HTTP dans `nginx.conf`.
Les pages inconnues renvoient HTTP 404, avec textes FR/EN et `noindex`.

Pour renseigner les photos, prix et liens de la sélection NorthDragon, consulter
le [guide des produits vedettes](boutique-products.md).

## Administration

La [sandbox locale et sa manette virtuelle](operations/admin-sandbox.md) permet
de créer des paiements synthétiques et de parcourir leurs actions administratives
avec des boutons Xbox cliquables, dans une installation jetable séparée.

La [modération des commandites](operations/sponsorship-moderation.md) décrit les
décisions versionnées, les corrections et réexamens privés, la charte préparée,
les droits et les conditions de mise en service.

Le [suivi des contributions reçues](operations/contribution-activity.md) relie
confirmation, toast global, courriel admin, SMS simulé et préparation privée
d’une cartouche Web. Il nécessite la migration 027 ; les envois sont configurés
séparément de la préparation.

L'entrée est `/admin/login`. Les pages protégées sous `/admin/fundraiser`
couvrent le cockpit, À traiter, l'Assistant, les contributions, commandites, campagnes,
factures/avoirs, publications, dépenses, transparence, audit, courriels,
configuration et accès/sessions. Les routes sont dans `admin.routes.ts`.

L’[administration des publications](admin-publication-queue.md) propose un accueil
avec carrousel et trois pages distinctes : rédaction et validation, lots de
publication et calendrier éditorial.

Les [campagnes](technical/admin-campaigns.md) rassemblent les prestations promises,
leur préparation et leurs preuves, y compris les prestations à venir sous réserve
d’approbation.

Les [lots 1](admin-ux-lot-1.md), [2](admin-ux-lot-2.md),
[3](admin-ux-lot-3.md), [4](admin-ux-lot-4.md), [5](admin-ux-lot-5.md),
[6](admin-ux-lot-6.md) et [7](admin-ux-lot-7.md) décrivent les contrats et
les fonctionnalités livrées à chaque étape; le [lot 8](admin-ux-lot-8.md)
documente leur recette initiale. Les résultats datés de ces lots ne sont pas
les résultats de la révision courante. Les règles OIDC du runbook actuel
complètent les descriptions historiques de connexion par token.

L'Assistant contextuel utilise des règles déterministes. Le volet
conversationnel est optionnel et possède un fournisseur `mock`; aucun
fournisseur IA externe n'est actuellement raccordé à ce volet dans l'API.

La [vue d'ensemble de l'Assistant](admin-assistant-overview.md) propose une
synthèse, des catégories filtrables, des groupes de courriels et un détail avec
retour au contexte, à partir de la file complète et paginée de **À traiter**.

L'[audit et la réception des corrections admin](development/admin-e2e-correction-plan.md)
relient les 21 URL, les 18 garanties et les recettes avec API et
PostgreSQL réels. Le registre vérifié en CI conserve les scénarios exacts.

## Travaux envisagés

- [Chargement local](development/development-loading-recovery.md).
- [Blueprint des opérations Guide, commandites et campagnes](development/admin-operations-blueprint.md) :
  inventaire des zones et actions par surface et onglet, responsabilités,
  périmètres à séparer et composants transversaux à réutiliser.
- [Analyse de mise en œuvre de la modération des commandites](development/sponsorship-moderation-implementation-analysis.md) :
  écarts avec la politique V1.0, textes FR/EN, décisions versionnées, corrections,
  réexamens et 25 tâches P0 à P3 à réaliser et vérifier.
- [Plan de tâches — Reconnaissance et diffusion des commandites](development/sponsorship-publication-tasks.md) :
  **Construction active** : 44 tâches de réalisation locale autorisées, dépendances,
  réception et suivi des 19 garanties.
- [Garanties de diffusion des commandites à traiter](development/sponsorship-publication-guarantees.md) :
  suivi des engagements, répartition des lots, conflits de calendrier et preuves de diffusion.
- [Analyse de la reconnaissance et de la diffusion des commandites](development/sponsorship-visibility-analysis.md) :
  diagnostic, photos individuelles et collectives, suivi privé et plan de réalisation.
- [Plan de travail — OpenG7 Admin pour Windows](funding-windows-plan-de-travail.md) :
  application de gestion des contributions et commandites, à réaliser ultérieurement.
- [Plan de travail pour le pilotage OpenG7 sur Xbox One](funding-xbox-plan-de-travail.md) :
  maquettes TV, parcours après paiement, architecture proposée, estimation et lots
  à reprendre ultérieurement.

## Exploitation et validation

| Besoin                                          | Référence                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Démarrer et contribuer                          | [README principal](../README.md), [contribution](../CONTRIBUTING.md)                   |
| Frontières et règles de travail                 | [Architecture](ARCHITECTURE.md), [AGENTS.md](../AGENTS.md)                             |
| Déployer selon le périmètre choisi              | [Checklist](production-launch-checklist.md), [Docker/VPS](docker-deployment.md)        |
| Configurer Keycloak local sous Windows/Docker   | [Keycloak local, HTTPS et OTP](operations/keycloak-local.md)                           |
| Préparer le fournisseur OIDC sur le même VPS    | [Keycloak, MFA et récupération identité](operations/keycloak-vps.md)                   |
| Préparer le premier compte au déploiement       | [Provisionnement Keycloak et reprise](operations/keycloak-provisioning.md)             |
| Appliquer le schéma et connaître ses limites    | [Migrations PostgreSQL](operations/database-migrations.md)                             |
| Retrouver une commande                          | [Aide-mémoire](command-cheatsheet.md)                                                  |
| Vérifier configuration et services              | [Smoke tests](operations/production-smoke-tests.md)                                    |
| Stocker les médias                              | [Stockage OVH](operations/ovh-object-storage.md)                                       |
| Exercer SMTP, S3, restauration et accessibilité | [Recette contrôlée](operations/integration-rehearsal.md)                               |
| Sauvegarder et récupérer sur une cible dédiée   | [Récupération applicative](operations/backup-recovery.md)                              |
| Comprendre la portée des tests                  | [Bilan courant](platform-status.md), [matrice commandite](sponsorship-e2e-coverage.md) |
| Utiliser l'outil VPS optionnel                  | [ProductionLaunchAgent](../apps/production-launch-agent/README.md)                     |

Limite confirmée par lecture du code : les runners de migrations rejouent tous
les fichiers, alors que `019`–`021` créent des tables sans garde de réexécution.
La procédure liée ci-dessus explique pourquoi une recette sur base vide ne
prouve pas la réussite d'un déploiement répété sur une base existante.

## Analyses et bilans historiques

Ces documents conservent les décisions, propositions ou preuves de leur époque.
Leurs formulations « à faire », « non implémenté » ou leurs nombres de tests
ne constituent pas le backlog actuel :

- [Analyse fonctionnelle initiale](fundraiser-functional-analysis.md).
- [Plan initial avec contrainte de budget](openg7-fundraiser-functional-analysis-codex-budget.md).
- [Périmètre MVP](fundraiser-mvp-scope.md) et [bilan MVP](fundraiser-mvp-status.md).
- [Direction UX admin](admin-ux-direction.md) et [plan des huit lots](admin-ux-plan-de-travail.md).
- [Améliorations du suivi, PR #119/#120](sponsorship-followup-improvements.md).
- [Cadrage des contributions externes/La Ruche](external-contributions-laruche-cadrage.md) : proposition toujours distincte d'une fonctionnalité d'import livrée.
- [Parcours virtuel d’une contribution d’entreprise de 50 CAD](development/virtual-contribution-journey-analysis.md) : diagnostic daté et proposition de notifications admin et de préparation privée, distincts d’un parcours E2E livré.

## Entretien

Lorsqu'une fonctionnalité change, mettre à jour son guide et les préconditions
d'exploitation dans le même changement. Réserver les preuves datées aux
commandes réellement exécutées et à leur révision. Vérifier les liens locaux,
les scripts de `package.json`, les routes et les noms de variables contre le
code; conserver les secrets hors de la documentation.
