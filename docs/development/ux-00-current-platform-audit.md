# PR-UX-00 — audit du checkout et des propositions UX

Audit arrêté le **18 octobre 2026, 21 h 52 (America/Toronto)**, avant toute
modification applicative PR-UX-01. Lecture croisée des sources, contrats et tests;
aucun paiement, remboursement, courriel ou publication exécuté.

## Révisions et portée de la preuve

- Départ : `docs/platform-functional-visual-blueprint`, HEAD
  `9bd24edb1c2d86d942907023e7fa53aa12fd41fd`; aucun changement suivi local.
- Branche locale préparée : `fix/ux-01-admin-permissions-and-uncertainty`, même HEAD.
- Le dossier utilisateur `openg7-ux-unification-pack-v1/` est non suivi au début de
  l'audit. Ses cinq fichiers sont conservés sans modification.
- L'[inventaire fonctionnel et visuel](platform-functional-visual-blueprint.md)
  décrit le code `b00ad2b281087db0b4563b2f510667c1f9e187fa`. Il ne décrit pas
  automatiquement HEAD, main ou une installation déployée.
- Main distant vérifié : `8e121a45f481aea864893568d3afdb374bbb2064`.
  [PR 346](https://github.com/OpenG7/openg7-funding-platform/pull/346) et
  [PR 349](https://github.com/OpenG7/openg7-funding-platform/pull/349) fusionnées;
  [PR 347](https://github.com/OpenG7/openg7-funding-platform/pull/347),
  [PR 348](https://github.com/OpenG7/openg7-funding-platform/pull/348) et
  [PR 350](https://github.com/OpenG7/openg7-funding-platform/pull/350) ouvertes lors
  du relevé. Ne pas attribuer leurs fonctionnalités à main.
- Les propositions [transverse V1](openg7-ux-unification-pack-v1/openg7-platform-unification-ux-blueprint-v1.md),
  [backlog](openg7-ux-unification-pack-v1/openg7-ux-backlog-priorise-v1.md),
  [dossier V2](openg7-ux-unification-pack-v1/admin-sponsorship-dossier-blueprint-v2.md)
  et [mission](openg7-ux-unification-pack-v1/prompt-codex-openg7-unification-ux-v1.md)
  ont été confrontées au code. V2 repose sur un autre snapshot : ses mentions
  « présent » ne sont pas des preuves de ce checkout.

Les sources financières, modes et workflows incertains inspectés ne changent pas
entre `b00ad2b2` et HEAD. Le déclencheur de modération du dossier change de
composition; le composant proposé dans PR 348 n'est pas dans ce checkout.

## Matrice avant correction

Dans cette table, `W/` désigne
`apps/funding-web/src/app/features/funding/`, `A/` désigne
`apps/funding-api/src/`. « Test existant » signifie source du test examinée,
**sans nouvelle exécution**. Compatible signifie cohérence du code inspecté,
sans qualification de production. Les positions correspondent au DOM courant.

<!-- prettier-ignore -->
| Route / position | Composant source | Comportement constaté | Source du blueprint | Évaluation | Importance | Test existant et niveau |
| --- | --- | --- | --- | --- | --- | --- |
| Toutes routes admin, colonne latérale et barre supérieure | `W/components/admin-layout/admin-layout.component.ts` | Navigation, recherche, activité, identité, Assistant, guide et inspecteur partagés; un panneau de décision de modération | Inventaire shell; V1 §3.2 | Compatible structurellement; ergonomie à mesurer | P1 hors lot | `admin-dashboard-layout.spec.ts`, fixtures UI |
| Cockpit, À traiter, Pilotage, Assistant, titre en tête de contenu | Pages dashboard/attention/pilotage/assistant | Quatre pages réelles; sous-titres et responsabilités non harmonisés selon la proposition Observer/Prioriser/Décider/Préparer | V1 espaces de travail | Divergence avec cible proposée | P1 hors lot | `admin-pilotage.spec.ts`, fixtures et Gamepad simulé |
| Commandites, barre d'outils au-dessus du véritable en-tête | `W/pages/admin-sponsors-page/admin-sponsors-page.component.html` | Déclencheur existant dans la barre d'outils, hors élément `header.detail-header`; ne pas ajouter un second bouton. PR 348 non fusionnée | Mission A.4; V2 en-tête | Divergence de position confirmée | P1 hors lot | `tests/playwright/admin-sponsor-tools.ui.ts`, fixtures |
| Commandites, panneau transversal du shell | `W/components/admin-moderation/funding-moderation-actions.component.ts`, panneau de décision | Sujet exact, version, empreinte, policyVersion, requestId et confirmation conservés; un organisme de décision | V1 UX-06; V2 modération | Compatible | P0 à préserver | `funding-moderation-session.test.mjs`, ports simulés; parcours dossier UI |
| Dossier, progression et prochaine intervention | `W/components/admin-sponsors/admin-sponsorship-progress-controller.ts`, page Commandites | Une projection serveur; seconde carte « prochaine étape » désactivée dans le composant enfant; obligations distinctes | V1 progression; V2 DOS-X | Compatible | P0 à préserver | `admin-sponsorship-progress-controller.test.mjs`, ports simulés |
| Dossier, rangée d'onglets | `W/components/admin-sponsors/admin-sponsor-detail-tabs.component.ts` | overview, identity, publication, billing, audit; alias media/refund et fragments profonds préservés | V1 navigation; V2 onglets | Compatible | P0 à préserver | `admin-sponsors-navigation-adapter.test.mjs`; `tests/playwright/admin-sponsor-workspace.ui.ts` |
| Dossier → liste et Assistant contextuel | Liste et adaptateur de navigation; lien Assistant | Filtres, page, scroll et focus restaurés dans l'instance; retour Assistant vers onglet/fragment/focus d'origine non établi | V1 §7.1 | Compatible partiellement / inconnu | P1 hors lot | `admin-sponsor-list-controller.test.mjs`; retour interroute à vérifier |
| Tiroirs et confirmation centrale | `W/components/admin-ui/admin-drawer.component.ts`, confirmation | Dialog natif, piège Tab, Escape bloqué si occupé, focus restauré; outils non modaux gèrent leur état | V1 clavier et panneaux | Compatible en code; zoom inconnu | P0 à préserver | `tests/playwright/admin-sponsor-tools.ui.ts`, fixtures FR/EN desktop/mobile |
| Factures, commande backfill en tête | `W/pages/admin-invoices-page/admin-invoices-page.component.ts`; `W/services/admin-document-delivery-controller.ts` | `canManage = role !== reader` offre backfill à operator; API owner uniquement | V1 UX-07; OUX-003 | Divergence confirmée | P0 | `admin-identity-policy.test.mjs` couvre trois rôles; contrôleur teste capacité générique |
| Factures, liste/détail/PDF/renvois | Même page; `A/admin-documents.http.ts`; `A/admin-identity/policy.ts` | Lecture et PDF pour les trois rôles; renvois operator/owner. Ne pas rendre toute la page owner-only | Inventaire Factures; V2 DOS-F | Compatible | P0 à préserver | `admin-documents-http.test.mjs`, HTTP injecté; politique rôles |
| Factures, états d'accès et lecture | Page Factures et contrôleur livraison | 401/403 purgent le privé et invalident réponses tardives; erreur technique garde snapshot explicitement ancien | V1 états et identité | Compatible | P0 à préserver | `admin-document-delivery-controller.test.mjs`; recette `identity/financial-access-revocation.spec.ts` non relancée |
| Factures, statut courriel du détail | `W/pages/admin-invoices-page/admin-document-email-status.component.ts`; `A/sponsorship-documents/queries.ts` | SQL projette uncertain, UI retombe sur « jamais envoyé » et autorise renvoi | OUX-006; QA-08/16 | Divergence confirmée | P0 | File courriel couvre uncertain; pas de test de ce statut sur Factures repéré |
| Factures, formulaire de renvoi | `W/services/admin-document-delivery-controller.ts`; composant livraison | UUID persisté par document+destinataire; changer adresse après réponse perdue crée une nouvelle requête. POST confirmé suivi de GET échoué devient à tort erreur d'envoi | OUX-006; invariant uncertain | Divergence confirmée | P0 | `admin-document-delivery-controller.test.mjs` attend actuellement nouvel UUID après changement d'adresse; `admin-document-resend-ui.spec.ts` intercepte l'API |
| Dépenses, création et cartes éditables | Page Dépenses, create/card/form-fields; workflow mutations | Trois rôles voient champs et commandes create/save/publish/hide/archive; API owner uniquement | V1 UX-08; OUX-004 | Divergence confirmée | P0 | `admin-identity-policy.test.mjs`; `admin-accounting-http.test.mjs`, HTTP injecté |
| Dépenses, confirmation et version | `W/pages/admin-expenses-page/admin-expenses-mutation-workflow.ts` | Publication/masquage confirmés, draft figé, expectedVersion; pas de succès financier optimiste | Règles financières; OUX-004 | Compatible | P0 à préserver | `admin-expenses-mutation-workflow.test.mjs`, ports simulés |
| Dépenses, chargement du registre | Contrôleur de lecture et page | Ancien snapshot conservé après erreur mais pas de mention de données anciennes; 401/403 purgent contexte | V1 états | Divergence sur stale | P1 | `admin-expenses-read-controller.test.mjs`; recette révocation non relancée |
| Dépenses, création après perte de réponse | Workflow mutations; `packages/funding-core/src/admin-expenses.ts` | Pas de requestId/reçu de création. Erreur libère busy avec draft conservé; nouvelle création potentiellement distincte | OUX-006; QA-16 | Lacune de contrat et UI | P1 | Test échec générique présent; réponse persistée mais perdue non couverte |
| Assistant global, au-dessus de la question | `W/pages/admin-assistant-page/admin-assistant-question.component.html`; `A/admin-assistant/config.ts` | disabled/mock explicites; pas de LLM externe implémenté | UX-09; OUX-005 | Compatible | P0 à préserver | `funding-admin-assistant.test.mjs`; `admin-assistant-http.test.mjs`, synthétiques |
| Assistant contextuel, contexte et préparation | Composant/context-controller Assistant | Modes explicites; préparation distincte de l'envoi confirmé | UX-09; invariants | Compatible | P0 à préserver | `admin-assistant-context-controller.test.mjs`; UI API interceptée |
| Assistant contextuel, demande d'information | Même contrôleur; `A/sponsorship-information.service.ts` | Erreur réseau laisse draft modifiable; déduplication serveur par payload, donc texte modifié peut créer un autre envoi | OUX-006; QA-16 | Divergence confirmée | P0 | Test existant attend nouvelle confirmation, sans payload modifié après réponse perdue |
| Dossier, espace revue média | `A/sponsor-media-analysis/worker.ts`; `W/components/media-review/media-review-analysis.component.html` | Sharp technique local; vision/OCR not_configured; classification unknown; aucun droit inféré | UX-10; OUX-005 | Compatible | P0 à préserver | `sponsor-media-analysis.test.mjs`, images locales; aucun fournisseur vision |
| Revue média, commande incertaine | `W/components/media-review/media-review-analysis.ts` | UUID conservé; mutations bloquées; lecture de reçu actor-bound sans rejouer job | OUX-006 | Compatible | P0 à préserver | `media-review-workspace-controller.test.mjs`; contrats injectés |
| Automatisation, liste et tiroir livraison | Page automation; publication-delivery-drawer | Mode, configuration, connexion et mock exposés; ne prouvent pas une connexion réellement déployée | UX-15; OUX-005 | Compatible en code / déploiement inconnu | P0 à préserver | `admin-publication-automation.spec.ts`, fixtures |
| Dossier, Publication et paramètres avancés | Composant publication/panel | Mock « simulée »; déclaration sans preuve à qualifier; social déclaré distinct de preuve | V2 DOS-X03/DOS-W | Compatible | P0 à préserver | Tests publication/dossier, aucune visibilité extérieure observée |
| Livraison uncertain, bas du tiroir | `W/components/admin-publications/publication-delivery-controller.ts` | Édition/approbation bloquées; référence externe ou absence motivée et confirmée; pas de renvoi direct | V2 DOS-S; OUX-006 | Compatible | P0 à préserver | `admin-publication-delivery-controller.test.mjs`; UI fixtures |
| Automatisation, observation de visibilité après perte POST et GET | Workflow commande et contrôleur livraison | GET de récupération tenté; échec libère busy. Clic manuel observation peut recréer UUID; pas de nouveau post social par cette observation | OUX-006; QA-16 | Divergence partielle | P1 | `admin-publication-automation-command-workflow.test.mjs` couvre récupération, pas second clic |
| File courriel, message exact | `W/pages/admin-email-queue-page/admin-email-queue-controller.ts` | uncertain/sending/sent non rejouables; réconciliation versionnée avec preuve; lecture avant reprise d'une réponse perdue | OUX-006; V2 DOS-F | Compatible | P0 à préserver | `admin-email-queue-controller.test.mjs`, ports synthétiques; recette SMTP non lancée |
| Pilotage, reçu de commande | `W/pages/admin-pilotage-page/admin-pilotage-command-workflow.ts` | UUID/reçu avant mutation, nouvelle commande bloquée, vérification reçue; incident revu ne signifie pas réussite financière | OUX-006; runbook pilotage | Compatible | P0 à préserver | `admin-pilotage-command-workflow.test.mjs`, reçus simulés |
| Dossier → Finances → remboursement | `W/services/admin-sponsor-refund-workflow.ts`; `A/sponsorship-refund-operations.ts` | Code uncertain explicite recharge; erreur transport générique garde brouillon et permet autre clic. Serveur protège claim/version/idempotence Stripe | OUX-006; QA-16 | Divergence UI, protection serveur présente | P0 | `admin-sponsor-refund-workflow.test.mjs` couvre code explicite seulement |

## Capacités vérifiées et manquantes avant implémentation

La politique `apps/funding-api/src/admin-identity/policy.ts` reste souveraine :
owner pour backfill et écritures Dépenses; operator/owner pour renvois; trois
rôles pour lectures/PDF. Aucune modification des autorisations API n'est prévue.
Les projections Factures/Dépenses n'ont pas de capacités opérationnelles dédiées.
L'identité expose le rôle. Le mode local historique utilise une session signée
sans identité OIDC : ne pas assimiler toute identité absente à owner.

Facture/avoir expose dernier statut/destinataire, **pas le dernier messageId**.
L'UUID de renvoi est dédupliqué côté serveur mais il n'existe pas de GET public de
reçu par requestId. La demande d'information est dédupliquée par payload sans
lecture de reçu par empreinte. La création Dépenses n'a ni requestId ni reçu.
Un GET de réconciliation certain de ces opérations nécessiterait un contrat
serveur explicite, à concevoir séparément. Ne pas inventer un messageId ni un reçu.
La correction minimale peut verrouiller les commandes incertaines, orienter vers
le registre ou la file existants et préserver l'identité de la demande initiale;
elle ne doit pas prétendre résoudre automatiquement ces lacunes serveur.

Les capacités Assistant/médias/publications nécessaires aux mentions honnêtes
sont déjà projetées. Les claims de remboursement et l'état du dossier existent;
aucune nouvelle API Stripe n'est nécessaire pour verrouiller et relire l'UI.

## Périmètre restreint proposé pour PR-UX-01

1. Page Factures et contrôleur livraison : capacité `canBackfill` distincte,
   revalidation après confirmation, renvois operator/owner préservés.
2. Page Dépenses et composants create/card/form-fields, contrats locaux et
   workflow : présentation owner, gardes avant/après confirmation, lecture seule,
   stale et création incertaine explicitement bloquée.
3. Modèles locaux Factures, statut courriel et formulaire livraison : uncertain
   véridique, payload initial conservé, pas de nouvelle requête après perte de
   réponse; POST acquitté distinct d'une erreur de rafraîchissement.
4. Workflow remboursement et contrôleur/template Assistant contextuel : lecture
   ou navigation de vérification, aucune nouvelle mutation aveugle.
5. Contrôleur/workflow d'observation de visibilité seulement si nécessaire pour
   conserver la commande non résolue, sans modifier moteur ni droits de publication.
6. Traductions FR/EN, tests contrôleurs et fixtures UI ciblés; éventuel helper
   local de capacité de présentation réutilisé par Factures/Dépenses.
7. Compte rendu d'implémentation et de validations distinct de cet audit initial.

Justification : OUX-003/004/006 corrigent des commandes incompatibles avec les
droits ou l'issue connue. OUX-005 ne justifie aucune nouvelle capacité IA : les
mentions inspectées sont déjà honnêtes. Les tests garantiront leur maintien.
Les fichiers shell, dossier V2, navigation générale, API financière et migrations
sont exclus. Les contrats manquants ci-dessus restent des limites explicites.

## Preuves et suite

L'étape A a utilisé lectures, recherches, comparaison Git ciblée et vérification
des PR; `git diff --check` réussi. **Aucune suite applicative nouvellement
exécutée pour cet audit.** Les chiffres de l'inventaire sont historiques.
Le périmètre a été confronté indépendamment aux sources finance, shell/dossier et
modes/uncertitude. Les validations de l'étape B seront consignées dans un
document distinct avec commandes, résultats et limites.

État inventorié : b00; état audité : 9bd; cible proposée : pack utilisateur;
implémentation/vérification : à établir par PR-UX-01; déploiement : non vérifié.

Suite : [diff et validations PR-UX-01](ux-01-admin-capabilities-and-uncertainty.md),
consignés séparément de cette matrice initiale.
