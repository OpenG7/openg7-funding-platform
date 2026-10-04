# Barrières de sécurité de la plateforme

La plateforme de financement OpenG7 intègre plusieurs couches de protection
pour les accès, les paiements, les données, les publications et l’exploitation.
Ce document décrit ce « bouclier intégré » avec ses preuves et ses limites.
Il permet d’expliquer les contrôles présents sans confondre une fonctionnalité
livrée avec son activation ou sa qualification en production.

Inventaire établi le **3 octobre 2026** par lecture du dépôt à la révision
**`9aa8eb9`**. Mise en documentation sur une base de travail à la révision
`d39e1ab8cf25261ee6e05aff881816230783e2bc` : les références tiennent compte
des extractions de modules intervenues depuis l’analyse. Le résultat des tests
reste attaché à `9aa8eb9` ; les suites applicatives n’ont pas été réexécutées
pour cette sauvegarde documentaire.

[Index documentaire](../README.md) · [Matrice de validation](../development/validation.md)

## Portée des preuves

Les sources ci-dessous sont des fichiers du dépôt et des symboles de code,
plutôt que des numéros de ligne susceptibles de devenir obsolètes. Ces liens
suivent les fichiers courants ; la date et la révision indiquent le périmètre
de l’analyse initiale. Les paramètres précis restent dans la configuration
et ses tests, afin de ne pas dupliquer des valeurs susceptibles de changer.

Trois niveaux de preuve doivent rester distincts :

- **Implémentation** : le code ou le manifest contient le contrôle décrit.
- **Validation locale** : une commande réellement exécutée vérifie un comportement
  sur la révision et l’environnement consignés.
- **Qualification opérationnelle** : le contrôle est activé et vérifié sur une
  cible donnée, avec les fournisseurs et la configuration effectifs.

Cet inventaire couvre les deux premiers niveaux. Aucune vérification de
production ni qualification d’un fournisseur réel n’a été effectuée.
Les contrôles Traefik nécessitent que les requêtes passent par ce frontal.
Les garanties persistantes nécessitent PostgreSQL et les migrations applicables.
Les contrôles d’identité nominatifs nécessitent le mode OIDC.

## Réseau navigateur et disponibilité

| Barrière                   | Contrôle constaté et portée                                                                                                                                                         | Sources                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Communications chiffrées   | Redirection HTTP vers HTTPS, TLS 1.2 minimum, suites cryptographiques explicites et HSTS. Paramètres fournis par Traefik.                                                           | [Traefik](../../traefik/traefik.yml), [options TLS et en-têtes](../../traefik/dynamic.yml)                                                                                         |
| Protection du navigateur   | CSP limitant les scripts à l’origine, objets interdits, formulaires encadrés, interdiction des cadres, `nosniff`, politique de référent et restrictions des permissions navigateur. | [Middleware `secure-headers`](../../traefik/dynamic.yml), [Nginx](../../apps/funding-web/nginx.conf)                                                                               |
| Limitation des abus        | Quotas distincts dans Traefik et dans l’API pour les familles de routes sensibles. L’API renvoie `429` avec `Retry-After` lorsque son quota est dépassé.                            | [Quotas Traefik](../../traefik/dynamic.yml), [`createRequestRateLimit`](../../apps/funding-api/src/http-rate-limit.ts)                                                             |
| Confiance dans les proxies | `X-Forwarded-For` ignoré par défaut. Son utilisation exige un nombre explicite de proxies de confiance ; l’adresse est choisie depuis le côté de confiance.                         | [`requestClientIp`](../../apps/funding-api/src/request-client-ip.ts)                                                                                                               |
| Requêtes coûteuses         | Taille des corps bornée avant traitement ; quotas de concurrence et délais de lecture, écriture et inactivité au frontal. Les uploads disposent de limites propres.                 | [Buffering et concurrence](../../traefik/dynamic.yml), [délais](../../traefik/traefik.yml), [`readBodyBuffer`](../../apps/funding-api/src/http-transport.ts)                       |
| Isolation réseau           | PostgreSQL sur le réseau interne `data`, sans port public ; Web sur `edge`. Dashboards techniques liés à la boucle locale par défaut.                                               | [Services et réseaux Compose](../../docker-compose.yml)                                                                                                                            |
| Confinement des processus  | API et Web sans utilisateur root, `no-new-privileges` et ressources bornées. Worker de sauvegarde avec système racine en lecture seule et capacités supprimées.                     | [Dockerfile API](../../apps/funding-api/Dockerfile), [Dockerfile Web](../../Dockerfile), [Compose](../../docker-compose.yml), [worker sauvegarde](../../docker-compose.backup.yml) |
| Disponibilité contrôlée    | Healthchecks et dépendances de démarrage sur services sains. Les versions serveur exposées sont réduites par la configuration du frontal et de Nginx.                               | [Healthchecks Compose](../../docker-compose.yml), [Traefik](../../traefik/dynamic.yml), [Nginx](../../apps/funding-web/nginx.conf)                                                 |

## Identité accès et décisions administratives

| Barrière                             | Contrôle constaté et portée                                                                                                                                                                                                                  | Sources                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autorisation côté API                | Contrôle avant lecture privée ou mutation. Administration non configurée refusée en production. Un guard Angular ou un bouton masqué ne remplace pas cette vérification.                                                                     | [`createAdminAuthorization`](../../apps/funding-api/src/admin-authorization.ts), [intégration API](../../apps/funding-api/src/main.ts)                                                                                                                                                                 |
| Rôles OIDC                           | Rôles lecteur, opérateur et propriétaire vérifiés serveur. Mutations refusées par défaut hors catalogue autorisé ; remboursements, dépenses et exports privés réservés au propriétaire.                                                      | [`AdminIdentityService` et `adminRoleAllows`](../../apps/funding-api/src/admin-identity.ts)                                                                                                                                                                                                            |
| Sessions par jeton                   | Sessions HMAC-SHA256, comparaison à temps constant, nonce aléatoire, échéance, acteur et format vérifiés côté serveur.                                                                                                                       | [`createAdminTokenSessionService`](../../apps/funding-api/src/admin-token-session.ts)                                                                                                                                                                                                                  |
| Connexion OIDC                       | Validation des jetons signés, PKCE, `state`, `nonce`, challenge à usage unique et expirant, vérification du MFA et du compte nominatif autorisé. Une panne ne déclenche pas de retour au secret racine.                                      | [`AdminIdentityService`](../../apps/funding-api/src/admin-identity.ts), [autorisation API](../../apps/funding-api/src/admin-authorization.ts)                                                                                                                                                          |
| Sessions OIDC révocables             | Cookie `HttpOnly`, `SameSite`, `Secure` sous HTTPS ; secret aléatoire et vérificateur haché en DB ; expiration, révocation, issuer et désactivation du compte vérifiés à chaque requête.                                                     | [`AdminIdentityService`](../../apps/funding-api/src/admin-identity.ts)                                                                                                                                                                                                                                 |
| Administration des comptes           | Confirmation liée à la cible, révocation des sessions après modification du compte, protection du dernier propriétaire actif et audit transactionnel.                                                                                        | [Gestion des accès et sessions](../../apps/funding-api/src/admin-identity.ts)                                                                                                                                                                                                                          |
| Origines et redirections             | CORS limité aux origines configurées en production. Origine publique exacte exigée pour les mutations OIDC. Retour de connexion limité au parcours administratif ; retour Checkout limité aux origines autorisées.                           | [`createHttpTransport`](../../apps/funding-api/src/http-transport.ts), [identité OIDC](../../apps/funding-api/src/admin-identity.ts), [`createCheckoutReturnUrlResolver`](../../apps/funding-api/src/api-runtime-config.ts)                                                                            |
| Entrées administratives              | Validation de méthode, corps, champs autorisés, types, identifiants, états et longueurs selon l’endpoint. Des limites de corps plus petites s’appliquent à certaines commandes.                                                              | [Adaptateur pilotage](../../apps/funding-api/src/admin-pilotage.http.ts), [adaptateur sauvegardes](../../apps/funding-api/src/admin-backups.http.ts), [transport HTTP](../../apps/funding-api/src/http-transport.ts)                                                                                   |
| Confirmation des actions sensibles   | Confirmation explicite dans l’UI et validation serveur selon l’action. Une confirmation en attente est annulée à la navigation ; cible et version sont recontrôlées.                                                                         | [Confirmations UI](../../apps/funding-web/src/app/features/funding/services/admin-confirmation.service.ts), [publication UI](../../apps/funding-web/src/app/features/funding/services/admin-sponsor-publication-workflow.ts), [service pilotage](../../apps/funding-api/src/admin-pilotage.service.ts) |
| Commandes répétables                 | Catalogue fermé, identifiant de requête, cible, version, acteur et contenu liés à un reçu persistant. Une répétition compatible restitue le reçu ; une réutilisation incompatible est un conflit.                                            | [`AdminPilotageService`](../../apps/funding-api/src/admin-pilotage.service.ts)                                                                                                                                                                                                                         |
| Décisions périmées ou incertaines    | Contrôles de version avant mutation. Reçus limités à leur auteur ; résultat incertain conservé sans rejeu automatique et reprise exigeant confirmation et raison.                                                                            | [Service pilotage](../../apps/funding-api/src/admin-pilotage.service.ts), [modèle de lecture](../../apps/funding-api/src/admin-pilotage.read-model.ts), [contrôle de version](../../apps/funding-api/src/admin-pilotage-version.ts)                                                                    |
| Accès aux sauvegardes et au backfill | Sauvegardes réservées à une session signée ou OIDC ; secret statique et accès de développement refusés. Backfill refusant l’accès de développement, mais acceptant le token statique. Entrées et confirmations contrôlées selon l’opération. | [Sauvegardes admin](../../apps/funding-api/src/admin-backups.http.ts), [backfill admin](../../apps/funding-api/src/admin-stripe-backfill.http.ts), [test du token statique en backfill](../../tests/admin-stripe-backfill-http.test.mjs)                                                               |

Le [runbook identité](../operations/admin-identity-and-alerts.md) et le
[runbook pilotage](../operations/admin-pilotage.md) restent propriétaires de
leurs contrats et préconditions opérationnelles.

## Paiements intégrité financière et accès privés

| Barrière                      | Contrôle constaté et portée                                                                                                                                                                                                            | Sources                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autorité du paiement          | Checkout crée une demande et une redirection. Un retour navigateur ne crée pas de paiement confirmé ; la confirmation provient du webhook ou d’une lecture serveur Stripe.                                                             | [`createPublicPaymentsHttpHandler`](../../apps/funding-api/src/public-payments.http.ts), [`processStripeWebhook`](../../apps/funding-api/src/stripe-webhook.service.ts), [`refreshSponsorshipFollowupPaymentStatus`](../../apps/funding-api/src/main.ts)                              |
| Authenticité des webhooks     | Signature vérifiée sur le corps brut avant accès à la DB. Signature absente ou invalide refusée ; échec de traitement non présenté comme un succès.                                                                                    | [Adaptateur webhook](../../apps/funding-api/src/stripe-webhook.http.ts), [service webhook](../../apps/funding-api/src/stripe-webhook.service.ts)                                                                                                                                      |
| Périmètre du projet           | Événements étrangers exclus, métadonnées contradictoires rejetées et références Stripe/locales contrôlées.                                                                                                                             | [Politique de périmètre Stripe](../../apps/funding-api/src/stripe-project-scope.ts)                                                                                                                                                                                                   |
| Déduplication durable         | Identifiant d’événement unique, verrou PostgreSQL par événement et traitement relançable. Déduplication des faits par PaymentIntent, remboursement ou payout, avec cohérence montant/devise.                                           | [`withStripeEventProcessing`](../../apps/funding-api/src/stripe-events.repository.ts), [`insertFundTransaction`](../../apps/funding-api/src/fund-transparency-registry.repository.ts)                                                                                                 |
| Événements désordonnés        | Transitions empêchant un événement tardif d’effacer un paiement confirmé ; états de remboursement et de litige préservés.                                                                                                              | [`allowedPreviousPaymentStatuses`](../../apps/funding-api/src/contribution-payment-state.ts), [écritures de contributions](../../apps/funding-api/src/contributions-write.repository.ts)                                                                                              |
| Cohérence monétaire           | Valeurs financières persistées en unités mineures avec devise explicite. Projection publique refusant les devises mélangées. Remboursements individuels confirmés, devise et cumul admissible vérifiés.                                | [Projection de transparence](../../apps/funding-api/src/fund-transparency.repository.ts), [`syncStripeChargeRefunds`](../../apps/funding-api/src/stripe-refunds.service.ts)                                                                                                           |
| Remboursements administratifs | Autorisation, confirmation exacte, raison et version ; opération persistante avant appel Stripe, clé idempotente et blocage d’un résultat ambigu.                                                                                      | [Endpoint remboursement](../../apps/funding-api/src/admin-sponsorship-refund.http.ts), [opérations de remboursement](../../apps/funding-api/src/sponsorship-refund-operations.ts)                                                                                                     |
| Factures et avoirs            | Références uniques par contribution/session ou remboursement. Rejeu conservant les montants, le numéro et l’émetteur existants.                                                                                                        | [Repository des documents](../../apps/funding-api/src/sponsorship-invoices.repository.ts), [migration factures](../../apps/funding-api/migrations/011_create_sponsorship_invoices.sql), [migration avoirs](../../apps/funding-api/migrations/012_create_sponsorship_credit_notes.sql) |
| Accès commanditaire privé     | Secrets aléatoires, vérificateurs SHA-256, expiration et contrôle du dossier et de son état. Récupération vers l’adresse de paiement vérifiée, avec réponse publique uniforme.                                                         | [Service d’accès](../../apps/funding-api/src/sponsorship-access.service.ts), [adaptateur de suivi](../../apps/funding-api/src/sponsorship-followup.http.ts)                                                                                                                           |
| Brouillons privés             | Champs et textes bornés ; coordonnées et liens validés à la soumission, les brouillons pouvant rester incomplets. Verrou de dossier, révision attendue et conflit en cas d’écrasement concurrent ; rejeu compatible sans nouvel effet. | [Accès et brouillons](../../apps/funding-api/src/sponsorship-access.service.ts), [validation partagée](../../packages/funding-core/src/sponsorship-validation.ts)                                                                                                                     |

Les [règles financières](../development/financial-rules.md) précisent les
invariants attendus. Cet inventaire décrit leur implémentation observée et
ses limites ; une règle documentaire seule ne prouve pas son enforcement.

## Médias confidentialité et publication

| Barrière                       | Contrôle constaté et portée                                                                                                                                                                                           | Sources                                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Images modernes contrôlées     | Formats JPEG/PNG/WebP, taille et pixels bornés, décodage réel, réduction des dimensions, réencodage WebP, checksum et nom nettoyé. Cette garantie ne couvre pas l’ancien upload de logo.                              | [Limites médias](../../apps/funding-api/src/sponsor-media-limits.ts), [traitement des images](../../apps/funding-api/src/sponsor-image.service.ts)                                                                                         |
| Stockage contrôlé              | Clés relatives validées, chemins confinés au répertoire prévu, écritures locales exclusives et distinction entre objets privés et publics.                                                                            | [Stockage médias](../../apps/funding-api/src/sponsor-media-storage.ts)                                                                                                                                                                     |
| Projection publique limitée    | Champs publics explicitement sélectionnés. Consentement, approbation, visibilité et état du média vérifiés avant exposition par les parcours contrôlés.                                                               | [Transparence](../../apps/funding-api/src/fund-transparency.repository.ts), [repository médias](../../apps/funding-api/src/sponsor-media.repository.ts)                                                                                    |
| Paiement et visibilité séparés | Payer ne suffit pas pour publier. Consentement, revue et visibilité restent distincts ; un nouveau commanditaire approuvé demeure privé jusqu’à une décision de visibilité.                                           | [Écritures commanditaires](../../apps/funding-api/src/contributions-write.repository.ts), [admissibilité Web](../../apps/funding-api/src/sponsorship-website-eligibility.ts)                                                               |
| Autorisation du contenu exact  | Publication liée à la version, au contenu, au média, à la destination, au mode et à l’horaire. Une édition retire l’autorisation. Des triggers protègent les objets autorisés contre les anciens parcours d’écriture. | [Service publication](../../apps/funding-api/src/publication-automation/service.ts), [migration publication](../../apps/funding-api/migrations/022_create_publication_automation.sql)                                                      |
| Revalidation avant envoi       | Sources, consentement, paiement, admissibilité, média et hash, calendrier, destination et état de pause recontrôlés avant dispatch.                                                                                   | [Préconditions de dispatch](../../apps/funding-api/src/publication-automation/preflight.ts), [sources](../../apps/funding-api/src/publication-automation/sources.ts), [médias](../../apps/funding-api/src/publication-automation/media.ts) |
| Résultats sociaux incertains   | Réponse perdue, timeout ou expiration de réservation peuvent placer une opération en quarantaine. Aucune relance aveugle ; réautorisation après résolution motivée et auditée.                                        | [Reprise de publication](../../apps/funding-api/src/publication-automation/service.ts)                                                                                                                                                     |
| Appels fournisseur bornés      | Timeout, refus des redirections HTTP et URL d’upload LinkedIn limitée au protocole et à l’hôte attendus. Protection ciblée, sans garantie anti-SSRF universelle.                                                      | [Adaptateur fournisseur](../../apps/funding-api/src/publication-automation/provider.ts)                                                                                                                                                    |
| Liens publics prudents         | Liens commanditaires HTTPS sans credentials et ouverture externe avec `noopener noreferrer`.                                                                                                                          | [Utilitaires commanditaires](../../apps/funding-web/src/app/features/funding/models/public-sponsors.utils.ts), [page commanditaires](../../apps/funding-web/src/app/features/funding/pages/sponsors-page/sponsors-page.component.html)     |

Les contrats propriétaires sont les [règles commandites](../development/sponsorship-rules.md),
le [runbook publication](../operations/publication-automation.md) et le
[runbook stockage](../operations/ovh-object-storage.md).

## Exports courriels assistant et audit

| Barrière                   | Contrôle constaté et portée                                                                                                                                                                                      | Sources                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export privé contrôlé      | Confirmation, sélection unique et bornée, versions attendues, génération auditée et refus si l’audit requis échoue. Neutralisation des préfixes de formule CSV.                                                  | [`parseContributionExport`, `buildAdminContributionsCsv` et `exportAdminContributions`](../../apps/funding-api/src/admin-contributions-export.service.ts)                                                                                                                                                         |
| File de courriels          | Persistance, clé de déduplication logique, réservation avec `SKIP LOCKED`, reprise après réservation expirée, tentatives bornées et backoff. Envois différés hors traitement transactionnel métier.              | [Repository courriels](../../apps/funding-api/src/email-queue.repository.ts), [worker courriels](../../apps/funding-api/src/services/email/email-queue.service.ts)                                                                                                                                                |
| Contenu des courriels      | Destinataires validés, HTML échappé et erreurs SMTP normalisées avec masquage ciblé des adresses. Secrets de transport côté serveur.                                                                             | [Service courriel](../../apps/funding-api/src/services/email/email.service.ts), [`escapeHtml`](../../apps/funding-api/src/services/email/email-rendering.ts)                                                                                                                                                      |
| Assistant en lecture seule | Désactivé par défaut, fournisseurs `mock` ou `disabled`, registre fermé de lectures, aucun SQL libre ni action financière ou publication depuis les outils. Préparation consultative sans envoi.                 | [Configuration assistant](../../apps/funding-api/src/admin-assistant/config.ts), [registre](../../apps/funding-api/src/admin-assistant/tool-registry.ts), [préparation](../../apps/funding-api/src/admin-assistant/preparation.service.ts)                                                                        |
| Budgets de l’assistant     | Longueur de question, nombre d’appels, nombre de résultats et durée bornés. Arguments inconnus refusés ; outils disponibles réduits au contexte sélectionné.                                                     | [Configuration](../../apps/funding-api/src/admin-assistant/config.ts), [orchestrateur](../../apps/funding-api/src/admin-assistant/orchestrator.ts), [registre](../../apps/funding-api/src/admin-assistant/tool-registry.ts)                                                                                       |
| Traçabilité des décisions  | Acteur, action, cible, résultat et contexte conservés sur les opérations auditées. Certaines mutations lient état et audit dans la même transaction.                                                             | [Identité](../../apps/funding-api/src/admin-identity.ts), [pilotage](../../apps/funding-api/src/admin-pilotage.service.ts), [export privé](../../apps/funding-api/src/admin-contributions-export.service.ts)                                                                                                      |
| Erreurs et logs publics    | Réponses génériques pour les erreurs internes et diagnostics fournisseur minimisés sur les parcours concernés. Traefik exclut chemins, lignes de requête et headers ; Nginx ne journalise pas les accès `/api/`. | [Entrée API](../../apps/funding-api/src/main.ts), [logs Traefik](../../traefik/traefik.yml), [Nginx](../../apps/funding-web/nginx.conf)                                                                                                                                                                           |
| Sessions côté Web          | Expiration et nettoyage des anciennes clés root dans les stockages navigateur. OIDC utilise un marqueur de session cookie ; le mode token conserve un jeton de session accessible au JavaScript.                 | [Session Web](../../apps/funding-web/src/app/features/funding/services/funding-admin-session.ts)                                                                                                                                                                                                                  |
| Cache des données privées  | `no-store` sur les réponses privées ciblées, les téléchargements PDF et les lectures de session. Les surfaces admin ne sont pas pré-rendues avec des données privées. Le contrôle de cache n’est pas universel.  | [Transport PDF](../../apps/funding-api/src/http-transport.ts), [adaptateur pilotage](../../apps/funding-api/src/admin-pilotage.http.ts), [session Web](../../apps/funding-web/src/app/features/funding/services/funding-admin-session.ts), [routes de rendu](../../apps/funding-web/src/app/app.routes.server.ts) |

## Secrets sauvegarde et livraison

| Barrière                             | Contrôle constaté et portée                                                                                                                                                                                             | Sources                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets hors du Web et de Git        | Secrets Stripe et DB fournis côté serveur, absents du service Web. `.env`, ACME et sauvegardes exclus de Git ; `.env` exclu du contexte Docker. Les workers d’exploitation autorisés peuvent aussi recevoir l’accès DB. | [Compose](../../docker-compose.yml), [worker exploitation](../../docker-compose.operations.yml), [.gitignore](../../.gitignore), [.dockerignore](../../.dockerignore)                                                                       |
| Sauvegardes privées                  | `umask` et permissions restrictifs, verrou de sauvegarde, artefacts DB et médias avec configuration et manifeste d’intégrité.                                                                                           | [Sauvegarde](../../scripts/backup.sh), [vérification des artefacts](../../scripts/backup-artifacts.mjs)                                                                                                                                     |
| Restauration isolée                  | Refus des cibles, volumes et réseaux existants ; vérification des artefacts, verrou, import DB en transaction et maintien des applications/workers arrêtés après restauration.                                          | [Restauration](../../scripts/restore-from-backup.sh), [état de reprise](../../scripts/recovery-state.mjs)                                                                                                                                   |
| Livraison vérifiable                 | Révision et images contrôlées, validation et E2E avant déploiement, livraisons sérialisées et environnement GitHub `production`. Retour aux images précédentes prévu en cas d’erreur, distinct d’une restauration DB.   | [Pipeline](../../.github/workflows/deploy.yml), [déploiement](../../scripts/deploy.sh), [rollback](../../scripts/rollback.sh)                                                                                                               |
| Séparation locale test et production | Outils de démarrage contrôlant les clés Stripe test/live, le listener local et la configuration du Checkout simulé.                                                                                                     | [Tests docker-up](../../tests/docker-up.test.mjs), [tests docker-update](../../tests/docker-update.test.mjs), [Checkout simulé](../../apps/funding-api/src/stripe-checkout-config.ts)                                                       |
| Contrôles opérationnels disponibles  | Script de contrôle TLS, headers, services et permissions. Certaines conditions produisent un avertissement ; la présence du script ne prouve pas son exécution en production.                                           | [Contrôle sécurité](../../scripts/security-check.sh), [smoke public](../../scripts/smoke-public.mjs)                                                                                                                                        |
| Outil VPS optionnel                  | ProductionLaunchAgent possède simulation par défaut, rôle `viewer`, catalogue de commandes, contrôles de rôle et historique. Ses limites SSH et de reprise excluent une qualification générale de sécurité.             | [Exécuteur](../../apps/production-launch-agent/src/commands/command-executor.ts), [catalogue](../../apps/production-launch-agent/src/commands/command-registry.ts), [outils](../../apps/production-launch-agent/src/tools/tool-registry.ts) |

Les [procédures de sauvegarde et récupération](../operations/backup-recovery.md)
et de [déploiement Docker](../docker-deployment.md) restent les références
opérationnelles. Cet inventaire n’autorise aucune opération de production.

## Scénarios de refus démontrés localement

Ces tests sont inclus dans la suite Node exécutée sur `9aa8eb9`.
Ils utilisent les fixtures et adaptateurs décrits dans leurs sources ; ils
ne constituent pas un test d’intrusion ni une qualification du fournisseur réel.

| Tentative ou échec                                      | Comportement attendu vérifié                                                            | Test                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Webhook Stripe falsifié                                 | Signature invalide refusée avant connexion DB.                                          | [stripe-webhook-recovery.test.mjs](../../tests/stripe-webhook-recovery.test.mjs)                                                   |
| Modification du JSON signé                              | Corps brut conservé ; reformatage rejeté lors de la vérification.                       | [stripe-webhook-http.test.mjs](../../tests/stripe-webhook-http.test.mjs)                                                           |
| Session falsifiée ou expirée                            | Refus de la signature incorrecte, des champs invalides et de l’expiration.              | [admin-token-session.test.mjs](../../tests/admin-token-session.test.mjs)                                                           |
| Action financière avec rôle insuffisant                 | Politique refusant les mutations réservées au propriétaire.                             | [admin-identity-policy.test.mjs](../../tests/admin-identity-policy.test.mjs)                                                       |
| Requêtes excessives ou adresse proxy falsifiée          | Quota appliqué, réponse `429` et protection du choix de bucket.                         | [http-rate-limit.test.mjs](../../tests/http-rate-limit.test.mjs)                                                                   |
| Export non confirmé ou formule CSV                      | Sélection invalide refusée et formules neutralisées sans modifier les données stockées. | [admin-contributions-export.test.mjs](../../tests/admin-contributions-export.test.mjs)                                             |
| Image invalide ou dimensions excessives                 | Rejet par décodage et limite de pixels.                                                 | [sponsor-image-processing.test.mjs](../../tests/sponsor-image-processing.test.mjs)                                                 |
| Traversée de chemin de stockage                         | Clé hors du répertoire prévu refusée.                                                   | [sponsor-media-storage.test.mjs](../../tests/sponsor-media-storage.test.mjs)                                                       |
| URL fournisseur étrangère ou réponse ambiguë            | URL rejetée ou résultat classé pour une reprise contrôlée.                              | [publication-automation.test.mjs](../../tests/publication-automation.test.mjs)                                                     |
| Sauvegarde corrompue ou cible de restauration existante | Artefacts ou préconditions refusés avant récupération.                                  | [backup-artifacts.test.mjs](../../tests/backup-artifacts.test.mjs), [recovery-state.test.mjs](../../tests/recovery-state.test.mjs) |

## Résultat de validation daté

| Élément                           | Résultat de la revue du 3 octobre 2026                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Révision examinée et testée       | `9aa8eb9`                                                                                          |
| Commande exécutée                 | `yarn test`, incluant compilation TypeScript et tests Node                                         |
| Résultat                          | 3 906 tests réussis ; 0 échec, 0 annulé, 0 ignoré                                                  |
| Environnement disponible          | Node `24.21.0`, Yarn `4.9.4` ; les consignes du dépôt prescrivent Node 22                          |
| Vérification Git lors de la revue | Dépôt propre et `git diff --check` réussi                                                          |
| Non exécuté dans cette revue      | Intégrations PostgreSQL/Docker, suites navigateur, fournisseur réel et vérifications de production |

Les suites d’intégration et d’identité présentes dans le dépôt fournissent
des scénarios supplémentaires, notamment concurrence, révocation et reprise.
Leur présence ne signifie pas qu’elles ont été exécutées pendant cette revue.
Les commandes et préconditions sont dans la [matrice de validation](../development/validation.md).

## Limites à conserver dans toute présentation

1. **Configuration effective non vérifiée.** Les garanties Traefik peuvent être
   contournées par un accès direct au service. Le dashboard Traefik utilise un
   mode sans authentification propre et repose sur son confinement réseau par
   défaut. L’inscription effective sur la liste HSTS preload et les règles
   d’approbation GitHub ne sont pas établies par les seuls fichiers YAML.
2. **OIDC et token ont des garanties différentes.** Le mode token accepte encore
   le secret racine sur des endpoints ordinaires. Il ne fournit ni MFA nominatif
   ni révocation individuelle persistante ; son jeton de session est accessible
   au JavaScript du Web. En dehors de `FUNDING_PLATFORM_ENV=production`, l’absence
   de token peut autoriser l’administration de développement sans vérifier une
   adresse de boucle locale. Voir [autorisation](../../apps/funding-api/src/admin-authorization.ts)
   et [session Web](../../apps/funding-web/src/app/features/funding/services/funding-admin-session.ts).
3. **Quotas locaux et configurables.** Le limiteur API est en mémoire par
   processus, désactivable avec zéro et fondé sur une liste explicite de routes.
   Il ne couvre pas automatiquement un nouvel endpoint et ne constitue pas
   une protection distribuée ou une défense DDoS volumétrique.
4. **Idempotence Checkout incomplète.** `checkout.sessions.create()` ne reçoit
   pas de clé d’idempotence ; une répétition peut créer plusieurs sessions.
   La déduplication du traitement financier ne corrige pas cette création.
   Voir [Checkout](../../apps/funding-api/src/public-payments.http.ts).
5. **Frontières monétaires à renforcer.** Le montant Checkout est coercé et
   arrondi avant conversion. La validation de commandite ne fixe pas de plafond
   ni de vérification systématique d’entier sûr à cette frontière. Les unités
   mineures persistées ne prouvent pas l’absence totale de calculs flottants.
   Voir [normalisation Checkout](../../apps/funding-api/src/main.ts) et
   [validation du montant commanditaire](../../packages/funding-core/src/sponsorship-benefits.ts).
6. **Journal et documents sans immutabilité générale.** L’enrichissement peut
   modifier des valeurs du registre ; l’audit n’est pas cryptographiquement
   inviolable. Les factures conservent numéro, montants et émetteur, mais certains
   champs absents ou provisoires peuvent être enrichis. Voir [registre](../../apps/funding-api/src/fund-transparency-registry.repository.ts)
   et [documents](../../apps/funding-api/src/sponsorship-invoices.repository.ts).
7. **Confidentialité et logs partiels.** Le hachage protège les vérificateurs
   d’accès ; des liens privés bruts peuvent rester dans les URL Stripe,
   les payloads d’événements et les corps de courriels persistés. `no-store`
   et le filtrage des diagnostics ne sont pas universels. Aucun chiffrement
   exhaustif des données stockées n’est démontré par cette revue.
8. **Anciens logos moins contrôlés.** Le parcours legacy vérifie MIME et
   signature de fichier sans décodage complet. Un objet S3 déjà publié peut
   être directement accessible, et une copie téléchargée ne peut être retirée
   par le filtre API. Voir [upload logo](../../apps/funding-api/src/sponsor-logo-upload.ts)
   et [stockage médias](../../apps/funding-api/src/sponsor-media-storage.ts).
9. **Effets externes sans garantie universelle d’exécution unique.** SMTP peut
   accepter un message avant un crash précédant l’enregistrement du succès ;
   une reprise peut le renvoyer. Les contrôles avant dispatch ne peuvent pas
   annuler un appel fournisseur déjà parti. Un fournisseur externe et PostgreSQL
   ne partagent pas une transaction atomique ; les résultats partiels nécessitent
   persistance et réconciliation. Voir [worker courriel](../../apps/funding-api/src/services/email/email-queue.service.ts).
10. **Défenses ciblées.** La CSP autorise encore des styles inline et des images
    HTTPS de plusieurs origines. Le contrôle d’URL fournisseur est ciblé ;
    aucune protection anti-SSRF universelle avec résolution DNS et filtrage de
    toutes les adresses privées n’a été démontrée. L’assistant dispose seulement
    de fournisseurs simulé ou désactivé ; ses tests ne qualifient pas un modèle
    externe contre les injections de prompts.
11. **Outil VPS optionnel à qualifier séparément.** Aucun contrôle explicite de
    clé d’hôte SSH n’a été identifié. `healthPath` entre dans une commande shell
    sans validation spécifique ; les reprises SSH peuvent rejouer un résultat
    incertain et le workflow peut poursuivre après un échec. Sa sauvegarde de
    configuration ne remplace pas une sauvegarde DB. Voir [SSH](../../apps/production-launch-agent/src/ssh/ssh-service.ts),
    [catalogue](../../apps/production-launch-agent/src/commands/command-registry.ts)
    et [moteur de workflow](../../apps/production-launch-agent/src/workflows/workflow-engine.ts).
12. **Protections externes non démontrées.** Aucun WAF fournisseur, service
    anti-DDoS externe, scan automatisé général des dépendances/images/secrets
    ni rotation effective des secrets n’a été établi dans les fichiers examinés.

## Entretien de cette référence

Lors d’une modification de sécurité, mettre à jour le guide propriétaire et
les lignes concernées de cet inventaire. Revalider les liens et les symboles,
les conditions d’activation et les limites. Toute nouvelle preuve d’exécution
doit indiquer date, révision, commande, environnement et résultat réel.

Une nouvelle révision ne reprend pas automatiquement les résultats précédents.
Les limites recensées sont des constats datés à vérifier avant correction ;
elles ne constituent ni un backlog approuvé ni une autorisation d’intervention
sur une cible de production.
