# OpenG7 Funding Platform — consignes communes

Ce socle s'applique à tout le dépôt. Les instructions locales le complètent sans
assouplir ses garde-fous. Lire les consignes des répertoires concernés avant
modification, même si la session démarre à la racine; ne pas supposer qu'elles
ont été chargées automatiquement. Une référence liée n'impose sa lecture que
lorsque son déclencheur ci-dessous correspond à la tâche.

## Contexte et sources

Monorepo Yarn 4, Node 22, Angular 21 standalone/SSR, Tailwind 4, API TypeScript ESM,
Stripe, PostgreSQL 16 optionnel, Docker Compose et Traefik 3.2. Licence MIT.
Le code, les migrations, les manifests, Compose et la configuration effective font
foi. Documenter/corriger un écart avec les guides; ne pas inventer une troisième règle.
Avant un changement de version majeure/runtime, vérifier manifests, images, CI et
documentation de production.

<a id="garde-fous"></a>

## Garde-fous

1. Inspecter avant de modifier : `git status --short`, fichiers concernés, implémentations équivalentes et tests; préserver les changements existants.
2. Frontières : Web → API; aucun accès Web à PostgreSQL ou aux API Stripe secrètes. Aucun cycle ni import de `apps/**` par un package partagé.
3. Stripe confirme le paiement. URL, redirection de succès et état navigateur ne créent jamais de transaction payée.
4. Événements et opérations répétables sont idempotents, y compris livraisons retardées/désordonnées; aucun doublon financier ou effet externe logique.
5. Aucun secret, contenu privé inutile ou donnée de carte dans Git, bundles, tests, logs, captures ou documentation. Minimiser les projections publiques.
6. Séparer test et production : aucune commande `:live`, clé live ou cible de production sans demande explicite.
7. Montants en unités mineures entières avec devise explicite; aucun flottant comptable ni addition de devises différentes. Corriger les faits confirmés par compensation tracée.
8. Migrations additives et numérotées; ne jamais modifier une migration déjà appliquée.
9. PostgreSQL privé : aucun port `5432` public ni routage par Traefik.
10. Paiement, consentement, revue, visibilité et publication sont distincts. Toute publication exige une autorisation administrative; une préparation n'est pas une approbation.
11. Chaque endpoint admin vérifie les droits côté API; ni bouton masqué ni guard Angular ne constitue une sécurité.
12. Actions sensibles auditées : acteur, action, cible, date, résultat et corrélation, sans secret. Confirmation UI et validation serveur pour remboursement, suppression de logo, publication, refus, masquage, retry massif, backfill, correction de destinataire et export privé.
13. Aucun déploiement, restauration, migration de production, remboursement réel, suppression de données, rollback, changement de secret, approbation/publication ou lot réel de courriels sans instruction explicite et garde-fous.
14. Aucun commit, push ou ouverture de PR sans demande explicite.
15. Rapporter uniquement les validations réellement exécutées. Une issue externe ambiguë exige réconciliation/revue humaine, jamais un faux succès ou une relance aveugle.

## Lectures selon la tâche

Appliquer les lignes pertinentes par chemin **et** par sujet, y compris aux tests
et packages. Lire la section utile, puis ses dépendances indispensables; ne pas
charger tout `docs/` ni suivre récursivement tous les liens.

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

Lire `package.json` et le manifest du workspace pour les commandes/dépendances
concernées; `.env.example` pour une configuration touchée, jamais un secret réel
pour documenter un exemple. L'[index documentaire](docs/README.md) oriente vers
les contrats fonctionnels actuels; les bilans historiques ne sont pas le backlog.

## Procédure et risque

- **Faible** : documentation, texte/style/UI de présentation, test isolé ou script
  local non destructif; inspection, changement ciblé, validations applicables.
- **Modéré** : endpoint, métier, session, file, document comptable, projection,
  Docker/Traefik, migration locale ou contrat partagé; examiner états, compatibilité,
  sécurité, idempotence et tests.

<a id="risque-eleve"></a>

- **Élevé** : live, production, remboursement réel, secret, restauration/rollback,
  suppression/correction financière, exposition réseau ou modèle comptable.
  Ne pas exécuter par défaut. Présenter l'opération exacte, cible, portée,
  préconditions, sauvegardes et retour; obtenir une instruction explicite,
  procéder une étape à la fois, vérifier et consigner le résultat.

Définir le plus petit changement cohérent, préserver les contrats sauf décision
explicite, éviter les refactorisations sans rapport. Ajouter tests adaptés et
migration si le schéma change; mettre à jour les guides touchés dans le même
changement. Vérifier erreurs et reprises; ne jamais cacher un échec par un succès.

Une nouvelle dépendance doit être utile, maintenue, de licence compatible et
placée dans son workspace; examiner taille, surface d'attaque et postinstall.
Ne pas désactiver TLS, CORS, CSRF ou signature en production. Origines explicites.
Chaque nouvelle variable : documentée dans `.env.example`, publique/secrète
classée, validée au démarrage, propagée et testée présente/absente; `.env` hors Git.

Pour tout effet externe, préciser input/output, autorisation, idempotence, audit,
échec et reprise. Un agent IA hérite des droits humains : moindre privilège,
scopes, expiration, confirmation, limite de volume et annulation si possible.
Une intégration IA administrative est en lecture seule par défaut.

Après modification : relire le diff, exécuter les contrôles applicables de la
matrice, `git diff --check` et `git status --short`. Rapport proportionné : résultat,
fichiers, décisions, validations exécutées/omises avec raisons, risques et
migrations/opérations manuelles nécessaires; omettre les rubriques sans objet.
Tout bilan distingue **valeur visible pour l'utilisateur** et **preuves de fiabilité**
(tests/E2E, CI, migrations, Docker, intégrations et production réellement vérifiée).
