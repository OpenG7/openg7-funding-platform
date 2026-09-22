# OpenG7 Funding Platform — consignes

## Mission

Financement OpenG7 : contributions, commandites, comptabilité, transparence et
administration, avec confirmation Stripe et publication autorisée séparément.

<!-- openg7:common:start -->

## Socle commun OpenG7

<!-- openg7-standard: 1 -->

- Respecter la mission du dépôt. Le code, les manifests et les tests décrivent
  l'existant; une architecture cible ou une roadmap ne prouve pas une livraison.
- Avant modification : `git status --short`, instructions des chemins concernés,
  code utile et équivalents existants. Préserver les changements de l'utilisateur.
- Lire uniquement les références déclenchées par le chemin ou le sujet traité,
  même pour un test ou un package. Chercher avec `rg`, lire la section utile;
  ne pas charger tout `docs/`, les registres ou les historiques par défaut.
- Réutiliser les contrats publics; éviter cycles, imports privés entre domaines,
  duplication métier et refactorisations étrangères à la demande.
- Ne placer aucun secret ni donnée privée inutile dans Git, sorties, logs, tests
  ou documentation. Exemples synthétiques; droits vérifiés côté serveur.
- Respecter l'autorisation déjà donnée et son périmètre. Préparer et vérifier les
  changements locaux autorisés; une demande de code n'autorise pas une opération
  de production, un envoi externe, une publication ou une destruction de données.
- Commit, push et ouverture de PR seulement dans le cadre demandé par l’utilisateur;
  une autorisation déjà donnée reste valable pour cette même opération et portée.
- Pour un effet externe : cible, droits, entrées/sorties, limites, idempotence,
  audit et reprise explicites. Réconcilier un résultat incertain avant de relancer.
- Choisir les validations selon le changement et les scripts réellement présents.
  Tester le comportement et les échecs pertinents; une modification documentaire
  seule ne déclenche pas les suites applicatives, les seeds ou un déploiement.
- Mettre à jour la référence propriétaire et les consommateurs d'un contrat dans
  le même changement. Les différences locales justifient une mission, une stack
  effective ou un risque métier; elles ne recopient pas le socle.
- Terminer par le diff, les contrôles applicables et `git diff --check`. Rapporter
  résultat, validations exécutées, limites et opérations restantes, sans faux succès.

<!-- openg7:common:end -->

## Contexte et sources

Monorepo Yarn 4, Node 22, Angular 21 standalone/SSR, Tailwind 4, API TypeScript ESM,
Stripe, PostgreSQL 16 optionnel, Docker Compose et Traefik 3.2. Licence MIT.
Avant un changement de version majeure/runtime, vérifier manifests, images, CI et
documentation de production.

<a id="garde-fous"></a>

## Périmètre local

1. Frontières : Web → API; aucun accès Web à PostgreSQL ou aux API Stripe secrètes. Aucun cycle ni import de `apps/**` par un package partagé.
2. Stripe confirme le paiement. URL, redirection de succès et état navigateur ne créent jamais de transaction payée.
3. Événements et opérations répétables sont idempotents, y compris livraisons retardées/désordonnées; aucun doublon financier ou effet externe logique.
4. Séparer test et production : aucune commande `:live`, clé live ou cible de production sans demande explicite.
5. Montants en unités mineures entières avec devise explicite; aucun flottant comptable ni addition de devises différentes. Corriger les faits confirmés par compensation tracée.
6. Migrations additives et numérotées; ne jamais modifier une migration déjà appliquée.
7. PostgreSQL privé : aucun port `5432` public ni routage par Traefik.
8. Paiement, consentement, revue, visibilité et publication sont distincts. Toute publication exige une autorisation administrative; une préparation n'est pas une approbation.
9. Chaque endpoint admin vérifie les droits côté API; ni bouton masqué ni guard Angular ne constitue une sécurité.
10. Actions sensibles auditées : acteur, action, cible, date, résultat et corrélation, sans secret. Confirmation UI et validation serveur pour remboursement, suppression de logo, publication, refus, masquage, retry massif, backfill, correction de destinataire et export privé.
11. Aucun déploiement, restauration, migration de production, remboursement réel, suppression de données, rollback, changement de secret, approbation/publication ou lot réel de courriels sans instruction explicite et garde-fous.

## Lectures selon la tâche

<!-- prettier-ignore -->
| Déclencheur | Lire avant intervention |
| --- | --- |
| Web, UI, SSR, i18n | [Web](apps/funding-web/AGENTS.md) |
| API, contrat, persistance, autorisation | [API](apps/funding-api/AGENTS.md) |
| Package partagé | [Packages](packages/AGENTS.md) |
| Script, Docker, Traefik, CI/CD, outil VPS | [Exploitation](scripts/AGENTS.md) |
| Paiement, montant, webhook, facture/avoir, remboursement, courriel, backfill, transparence | [Règles financières](docs/development/financial-rules.md) |
| Commandite, reconnaissance, publication, média | [Règles commandites](docs/development/sponsorship-rules.md) |
| Authentification, rôles ou sessions admin | [Identité](docs/operations/admin-identity-and-alerts.md) |
| Pilotage administratif, Gamepad, catalogue de commandes | [Pilotage](docs/operations/admin-pilotage.md) et règles Web/API concernées |
| Schéma ou exécution de migrations | [Migrations et limite de réexécution](docs/operations/database-migrations.md) |
| Frontière, dépendance ou décision structurante | [Architecture](docs/ARCHITECTURE.md), une seule langue |
| Choix des vérifications | [Matrice de validation](docs/development/validation.md) |
| Maintenance des consignes/documentation | [Organisation et budgets](docs/development/documentation.md) |

Configuration : `.env.example` et manifest du workspace; contrats fonctionnels :
[index](docs/README.md). Les bilans historiques ne sont pas le backlog.

## Validation

Appliquer la [matrice](docs/development/validation.md) selon le changement, puis
`node scripts/check-project-standards.mjs` et `node scripts/check-agent-docs.mjs`
pour les consignes. Pour les opérations à risque, appliquer les conditions suivantes.

<a id="risque-eleve"></a>

Live, production, remboursement réel, secret, restauration/rollback, suppression
ou correction financière, exposition réseau ou modèle comptable : présenter
opération exacte, cible, portée, préconditions, sauvegardes et retour; exiger
l’instruction explicite correspondante, vérifier et consigner chaque étape.
Une opération préparée n’est pas une opération autorisée.

Dépendances : utiles, maintenues, licence compatible, workspace propriétaire;
examiner taille, postinstall et surface d’attaque. Aucun contournement TLS, CORS,
CSRF ou signature. Variables : exemple non secret, classification publique/privée,
validation au démarrage, propagation et tests présente/absente.
Les effets externes conservent droits, idempotence, audit et reprise. Un agent IA
hérite des droits humains : moindre privilège, scopes, expiration, confirmation,
limites de volume et annulation. L’assistant administratif est en lecture seule
par défaut. Rapporter valeur utilisateur et preuves de fiabilité séparément.

## Maintenance

Pour changer les consignes : [standard et budgets](docs/standards/README.md).
Conserver le bloc commun synchronisé et les différences dans leur périmètre.
