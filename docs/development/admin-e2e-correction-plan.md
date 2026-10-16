# Administration — corrections et preuves E2E

Audit du **13 octobre 2026** sur `e35256f4`, puis corrections et réception locale
du **14 octobre 2026**. Les **17 points A01–A17 sont traités dans le dépôt**.
Le périmètre comprend les 20 URL administratives, leurs panneaux et opérations.
Les parcours publics servent à vérifier les conséquences des décisions admin.

Les responsabilités sont regroupées ici :

- Les [routes Angular](../../apps/funding-web/src/app/admin.routes.ts) définissent
  les URL existantes.
- Le [registre de couverture](../../tests/admin-e2e-coverage.json) conserve les
  routes, rôles, états, fichiers et titres exacts des scénarios.
- Ce bilan conserve les constats, les corrections et les résultats datés.
  Les contrats détaillés restent dans les références propriétaires citées.

## Niveaux de preuve

**UI** : navigateur et Angular réels, réponses API interceptées.
**Intégration** : services ou HTTP et PostgreSQL réels, sans parcours navigateur
complet. **E2E** : navigateur → API → PostgreSQL réels, avec fournisseurs locaux
de test possibles. **SMTP local** : livraison capturée dans la pile jetable.

Une déclaration sélectionnée en CI ne prouve pas la réussite de ses assertions.
Un HTTP 200 seul ne prouve ni la bonne cible, ni l'audit, ni l'absence de doublon.
Les défauts reproduits sont distingués des raccordements qui manquaient de tests.

## Corrections et couverture livrées

### A01 — Totaux admin multidevises · P0

Le résumé Contributions additionnait les montants puis choisissait
`MAX(currency)` ; Factures et Dépenses avaient la même faiblesse. La reproduction
initiale additionnait 1 000 unités mineures CAD et USD en un faux total de 20 USD.

Les résumés scalaires refusent maintenant les devises incompatibles avec
`409 ADMIN_FINANCIAL_CURRENCY_CONFLICT`, expliqué dans l'UI. Le cockpit reste
ventilé par devise ; lignes, CSV et faits financiers conservent leur devise.
Les allocations archivées et les paiements non confirmés ne créent pas de
conflit avec les montants réellement agrégés.

Preuves : [intégration financière](../../tests/integration/admin-financial-currencies.integration.mjs)
et [cockpit réel](../../tests/identity/cockpit-financial-values.spec.ts).
Contrat : [API admin](../technical/admin-api.md).

### A02 — Données privées après refus d'accès · P0

Factures et File courriel conservaient leurs données après certains refus de
lecture ; le transport courriel perdait le statut HTTP.

Factures, File courriel et Dépenses purgent données, sélections, brouillons et
panneaux sur refus d'accès. Les générations de session et de lecture empêchent
une ancienne réponse de restaurer des données, télécharger un PDF ou relancer
une action. Un 401 conduit à la reconnexion ; un 403 explique le refus.

Preuve : [révocation et réponses tardives](../../tests/identity/financial-access-revocation.spec.ts).
Règles : [identité admin](../operations/admin-identity-and-alerts.md).

### A03 — Audit du retry avant SMTP · P0

Le retry et la livraison précédaient l'inscription de l'intention administrative.

L'intention et le claim sont désormais transactionnels et durables avant SMTP.
Le même UUID reste lié à l'acteur et au message. Le résultat est audité ; une
panne après acceptation conserve une reprise traçable, sans renvoi aveugle.

Preuves : [pannes d'audit et de finalisation](../../tests/integration/admin-email-retry-audit.integration.mjs)
et [SMTP navigateur](../../tests/identity/email-uncertain-reconciliation-journey.spec.ts).
Contrat de reprise : [courriels](../email-smtp.md).

### A04 — Sujets de modération du pilotage · P1

Le bug signalé proposait une modération de livraison sur un rappel sans
livraison. Les fixtures communes acceptaient tout couple type/identifiant et
l'E2E existant sélectionnait seulement une vraie livraison `news`.

Le pilotage réserve ce panneau aux vrais sujets et conserve le lien du rappel
vers son dossier. Les fixtures exigent des sujets déclarés ; sujet inconnu,
méthode non admise et JSON invalide reçoivent respectivement 404, 405 et 400.

Preuves : [pilotage réel](../../tests/identity/pilotage-moderation-journey.spec.ts)
et [régressions UI et fixtures](../../tests/playwright/admin-pilotage.spec.ts).
Parcours : [pilotage](../operations/admin-pilotage.md).

### A05 — Approbation groupée dans le pilotage · P1

L'acceptation groupée depuis Automation ne couvrait pas l'enchaînement des
panneaux du pilotage ; ses fixtures avaient `sponsors: []`.

La recette réelle examine deux commanditaires puis leur livraison. Annuler au
second panneau ne persiste aucune décision ; terminer est atomique. Une
modification concurrente provoque un conflit sans réussite partielle. Le rejeu
conserve le reçu, les trois décisions, leurs cibles, leur acteur et l'audit.

Preuve : [approbation groupée](../../tests/identity/pilotage-moderation-journey.spec.ts).

### A06 — Diagnostic du panneau de modération · P1

Le panneau traduisait toutes les erreurs de chargement par le même message.

Il distingue maintenant 401, 403, 404, 409 et indisponibilité technique.
Réessayer recharge le contenu exact et exige une nouvelle confirmation.
Fermeture/réouverture et réponse tardive ne remplacent pas le contenu courant ;
l'API refuse une version ou une empreinte obsolète.

Preuve : [panneau réel et refus](../../tests/identity/financial-access-revocation.spec.ts).
Les refus 403/404/503 ciblés sont injectés pour vérifier le diagnostic ;
révocation, conflit, handler et persistance restent réels.

### A07 — Correction et recours · P1

Les preuves UI et PostgreSQL étaient séparées pour cette boucle.

Le parcours réel couvre N1, correction dans le suivi privé, nouvelle version,
N2, recours, affectation propriétaire puis résolution expliquée N0. Il vérifie
les acteurs, l'audit, les notifications SMTP et la séparation des notes internes.
La revue commerciale et la publication conservent leurs autorisations distinctes.
N4 et sa seconde revue OIDC restent couverts par les recettes préexistantes.

Preuve : [correction et réexamen](../../tests/identity/moderation-correction-reconsideration.spec.ts).
Contrat : [modération](../operations/sponsorship-moderation.md).

### A08 — Calendrier éditorial manuel · P2

Rectification de l'audit : la chaîne Docker brouillon → lot → créneau →
autorisation finale → annulation était déjà réelle. La lacune retenue concernait
la replanification persistante de lots partageant un créneau et l'heure saisonnière.

La nouvelle recette conserve l'instant exact lors d'une modification de notes,
refuse une heure répétée à Toronto, vérifie la cascade vers deux lots et leurs
brouillons après rechargement, puis l'annulation confirmée.

Preuves : [calendrier manuel](../../tests/identity/manual-publication-calendar-journey.spec.ts)
et [chaîne Docker existante](../../tests/playwright/admin-publication-batches.spec.ts).
Parcours : [publications](../admin-publication-queue.md).

### A09 — Engagements et durée par le propriétaire · P1

Les acceptances utilisaient un helper API ; UI et contraintes PostgreSQL étaient
vérifiées séparément.

Le navigateur traverse maintenant qualification historique avec preuve,
ajustement motivé, origine temporelle et attestation de durée. La recette vérifie
termes initiaux immuables, droits propriétaire/opérateur/lecteur, conflit et
réponse perdue, sans prestation déduite du barème actuel.

Preuve : [engagement propriétaire](../../tests/identity/owner-obligation-journey.spec.ts).

### A10 — Backfill Stripe depuis l'admin · P1

Le panneau, le handler et la CLI étaient vérifiés séparément.

La recette couvre aperçu borné sans écriture financière, annulation, périmètre
expiré, compte Stripe changé et reprise du même import après réponse perdue.
Elle vérifie l'audit et l'absence de facture ou courriel historique implicite.

Preuve : [backfill navigateur](../../tests/identity/admin-stripe-backfill-journey.spec.ts).
Contrat : [backfill admin](../operations/admin-stripe-backfill.md).

### A11 — Réconciliation SMTP incertaine · P1

La nouvelle recette relie l'interface, la preuve fournisseur et la persistance :
acceptation SMTP sans renvoi, preuve de non-envoi, conflit de version puis retry
séparé. Une réponse perdue conserve l'UUID émis par l'UI ; son rejeu ne livre pas
un second message. Les audits d'intention et de résultat excluent les données
privées inutiles.

Preuve : [réconciliation SMTP](../../tests/identity/email-uncertain-reconciliation-journey.spec.ts).

### A12 — Révocation pendant une confirmation sensible · P1

La couverture d'identité existante ne reliait pas toutes les confirmations
financières déjà ouvertes à une révocation.

La recette révoque l'accès pendant une correction de destinataire, une
publication d'allocation et un remboursement. Le serveur refuse l'action,
les panneaux privés sont purgés et aucun effet métier n'est autorisé.

Preuve : [confirmations financières](../../tests/identity/financial-access-revocation.spec.ts).

### A13 — Demande de sauvegarde · P1

La recette relie confirmation OIDC, réponse perdue, job unique, claim et exécution
du worker. Elle vérifie dump PostgreSQL 16, chiffrement age, téléversement par le
vrai SDK, version/hash/rétention, refus d'écrasement, audits, rôles et révocation.

Preuve : [demande de sauvegarde](../../tests/identity/admin-backup-request-journey.spec.ts).
Conditions et limites : [sauvegardes admin](../operations/admin-database-backups.md).

### A14 — Valeurs financières affichées · P1

Les calculs PostgreSQL et la présentation du cockpit ne prouvaient pas ensemble
les valeurs réellement affichées après des événements financiers.

La recette utilise des paiements signés CAD/USD, des frais tardifs et un
remboursement partiel depuis l'UI. Elle compare les valeurs affichées aux faits
attendus en unités mineures après rafraîchissement et rechargement, par devise.

Preuve : [cockpit financier](../../tests/identity/cockpit-financial-values.spec.ts).

### A15 — Proposition de créneau FR/EN · P2

La proposition sortait avant la localisation anglaise. L'E2E a aussi révélé que
la projection de file supprimait `propose_slot`, rendant l'action inaccessible.

L'action est conservée et titre, champs, texte et absence de créneau sont
localisés. La référence du créneau prime sur celle d'un commanditaire associé.
La préparation ne crée ni créneau, ni envoi, ni autorisation.

Preuve : [Assistant HTTP réel](../../tests/identity/admin-assistant-contract-journey.spec.ts),
complétée par les tests de service, file et contrôleur.
Parcours : [Assistant](../admin-assistant-overview.md).

### A16 — Conversation Assistant et vrai contrat HTTP · P2

Le scénario conversationnel interceptait contexte et question ; orchestrateur
et handler étaient testés séparément.

La recette réelle vérifie question, faits, liens exacts, budget d'outils borné,
journal minimal, confidentialité, mode désactivé et session révoquée. Elle
n'effectue aucune mutation métier et utilise uniquement le modèle `mock` local.

Preuve : [Assistant HTTP réel](../../tests/identity/admin-assistant-contract-journey.spec.ts).

### A17 — Traçabilité et sélection CI · P1

La découverte vérifiait déjà les fichiers sélectionnés, sans connaître les
garanties administratives ni leur niveau de simulation.

Le registre versionné relie 20 URL et 18 garanties aux rôles, états et titres
exacts. La garde refuse route sans rattachement, garantie absente, titre non
sélectionné, test ignoré ou échec attendu et preuve uniquement UI.

Preuves : [contrôle de sélection](../../scripts/check-e2e-selection.mjs),
[garde de couverture](../../scripts/lib/admin-e2e-coverage.mjs) et
[régressions](../../tests/admin-e2e-coverage.test.mjs).
Le rattachement A17 reste un inventaire : il n'apporte pas une nouvelle preuve
métier réelle pour chaque URL, notamment `/admin/oidc-setup` déjà couvert en UI.

### A18 — Rapprochement des responsabilités et rapport durable

Le mode automatique parcourt les paiements confirmés, conserve les devises
séparées et distingue les prestations réalisées des dispenses et des faits
inconnus. La recette utilise Web, API, PostgreSQL et OIDC locaux réels : rapport
daté après rechargement sans rejeu, nouveau paiement hors passage et commandite
historique qui reste ouverte. Elle part de paiements déjà confirmés ; les
recettes Stripe restent responsables de la confirmation du paiement.

Contrat : [passages automatiques](../technical/admin-automatic-runs.md).
Recette : [rapprochement réel](../../tests/identity/admin-automatic-responsibilities.spec.ts).

## Recettes et limites

Les dix nouveaux fichiers identité ajoutent **16 scénarios E2E**. SQL et appels
API de préparation ne ciblent que les piles jetables ; l'action examinée part
du navigateur et traverse le vrai handler. Les réponses perdues sont abandonnées
après traitement serveur, sans fabriquer de succès ou de persistance.

La sélection et les commandes sont décrites par la
[matrice de validation](validation.md) et le
[workflow admin](../../.github/workflows/admin-acceptance.yml).
Les états FR/EN, mobile, clavier et erreurs sont multipliés dans les suites UI ;
les E2E ciblent les raccordements métier. Une manette simulée ne qualifie pas
une manette physique.

Le fournisseur A13 écrit des objets réels dans des fichiers privés locaux, mais
ses capacités de bucket et sa rétention sont synthétiques. Son adaptateur de
capture utilise le dump de la DB jetable et `age`. Les recettes de capture en
image, de restauration, d'IAM et de permissions S3 restent distinctes.
La CI identité installe `age` ; localement, configurer
`FUNDING_BACKUP_AGE_BINARY` si nécessaire.

Les fournisseurs Stripe, sociaux, OIDC et SMTP restent locaux et synthétiques.
Aucun modèle IA externe ni fournisseur de production n'est qualifié.
La [recette HTTPS/Keycloak/OTP](../../tests/identity/keycloak-local-https.integration.mjs)
avec CA approuvée demeure séparée ; OIDC navigateur et Keycloak sont aussi testés
séparément en CI.

## Réception des corrections du 14 octobre 2026

Ces résultats concernent le diff des corrections initiales, avant sa
consolidation. Les reprises sont indiquées ; un premier passage partiellement
en échec n'est pas présenté comme entièrement vert.

- **Builds et typage** : Angular production/SSR réussi, 25 routes pré-rendues ;
  API et TypeScript global/admin UI réussis. Aucune migration ni dépendance
  applicative ajoutée.
- **Node** : 6 392 réussites, zéro échec et huit ignorés sur 6 400 tests
  (`test-results/admin-all-node-final.log`). Les 26 tests runner/sélection/registre
  repassent après le renforcement de gouvernance. Les trois tests d'artefacts
  repassent avec `age`, dont le chiffrement initialement ignoré ; les sept autres
  exclusions concernent POSIX/symlinks indisponibles sur ce processus Windows.
- **Identité** : 24/25 réussites au passage complet
  (`test-results/admin-identity-final.log`), puis sauvegarde 1/1 avec `age`
  (`test-results/admin-backup-final.log`, sortie 0). Les 25 scénarios, dont les
  16 nouveaux, ont ainsi été validés.
- **PostgreSQL** : 11 réussites finance/export et 23 pour file, contexte Assistant,
  pilotage et planification partagée. L'intégration SMTP vérifie aussi les pannes
  avant intention, après acceptation et pendant finalisation avec Mailpit.
- **Docker** : 4/4 pour deux parcours pilotage, SMTP et file rendue, puis 1/1 pour
  les lots. Rapports `test-results/acceptance-admin-tools-9124689b` et
  `test-results/acceptance-publication-batches-4824a4f8` ; teardown confirmé.
- **UI** : 658 réussites et huit échecs sur 666 scénarios en 22,3 minutes
  (`test-results/admin-ui-audit-final.log`). Deux anciennes assertions excluaient
  le nouveau `requestId` ; elles exigent maintenant message exact, UUID valide
  et aucun champ supplémentaire. Les huit variantes corrigées repassent
  (`test-results/admin-ui-email-contract.log`) et le nouveau contrat de fixture
  passe séparément (1/1), soit 667 scénarios distincts validés avec reprises.
- **Sélection CI** : 125 fichiers, 20 URL et 17 garanties, sans `only`/`fixme`.
  Standards, budgets documentaires, format et diff contrôlés ; 260 liens locaux
  vérifiés dans les 11 Markdown du changement initial.
- **Avertissements conservés** : directive lint inutilisée dans
  `scripts/smoke-public.mjs` et bundle initial de 871,54 ko pour un budget
  d'avertissement de 800 ko. Aucun seuil d'erreur relevé.

Cette réception n'a exécuté aucune migration ni opération financière réelle.
Les services de l'installation locale ont conservé leur état.

## Consolidation du 14 octobre 2026

Cette passe regroupe le décodage HTTP, l'audit et les résultats de retry SMTP,
ainsi que la connexion OIDC des nouvelles recettes, dans leurs propriétaires
existants. Le registre reste la source des titres exacts ; ce document fusionne
le plan et son bilan. Les contrats, les gardes de session et les assertions
métier restent conservés.

Validations propres à la consolidation, sur les sources regroupées :

- Angular production/SSR (25 routes), compilation API et typage global réussis.
- Suite Node complète : **6 409 réussites, zéro échec et sept exclusions
  POSIX/symlinks** sur 6 416 tests, avec `age` disponible
  (`test-results/admin-defrag-node.log`).
- Les **16/16 nouveaux E2E** repassent ensemble en trois minutes
  (`test-results/admin-defrag-identity.log`). Les titres et chemins référencés
  restent identiques.
- **5/5 UI ciblés** pour messages documentaires et fallback financier
  (`test-results/admin-ui-defrag.log`).
- Intégration SMTP PostgreSQL/Mailpit : **1/1**, y compris audit sans ligne écrite
  avant envoi et après acceptation, puis rejeu sans second SMTP. Piles jetables
  arrêtées.
- Lint sans erreur, format, standards, budgets et `git diff --check` réussis.
  La découverte conserve **125 fichiers, 20 URL et 17 garanties** ; les 17
  entrées uniques et les 37 liens locaux de ce bilan sont vérifiés.

Les avertissements précédents restent inchangés. Cette validation a conservé
l'état des services locaux.
