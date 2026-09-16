# Lot 3 — Assistant contextuel

Réalisé le 16 septembre 2026 selon le [plan de travail](./admin-ux-plan-de-travail.md), les [requis](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

## Résultat visible

- Carte **Assistant contextuel** après « À traiter » dans le cockpit, avec faits dépliables, et dans la commandite sélectionnée. L’ouverture du dossier dans l’Assistant conserve son identifiant dans l’URL : `/admin/fundraiser/assistant?sponsorshipId=<uuid>`.
- Faits distincts : paiement, remboursement, revue, visibilité, consentement, médias approuvés/à réviser/refusés, informations manquantes et couverture des canaux de publication promis.
- Prochaine étape déterministe, accessible sans fournisseur de modèle : vérifier le paiement/remboursement/refus, compléter la fiche, réviser les médias, effectuer la revue, vérifier le consentement, préparer ou suivre les publications.
- Préparation d’une relance, d’une note de revue ou d’un brouillon de publication. Chaque proposition indique qu’elle n’est ni envoyée, ni publiée, ni enregistrée.
- **Demander des informations** présente le destinataire enregistré, un objet et un message modifiables. Un dialogue récapitule le message avant **Confirmer l’envoi**. Le résultat distingue mise en file, demande déjà en file, déjà envoyée et livraison échouée, avec lien vers le courriel exact.
- Présentation des brouillons et des réponses extraite en composants réutilisés par la page Assistant existante et la carte contextuelle. Les réponses séparent faits, interprétation, recommandations et limites.
- Interface contextuelle et brouillons de dossier en FR/EN. Chargement, absence de tâche, dossier introuvable, erreur, conflit de version et accès refusé sont explicites. Une session expirée revient à la connexion; une réponse tardive ne remplace pas un nouveau dossier.

La carte du cockpit choisit actuellement la première commandite des détecteurs d’attention, triée par priorité, sans limite globale de 100 ou 2 000 dossiers. La sélection mémorisée pendant la session et la progression complète du dossier appartiennent au lot 4.

## Contrats et garanties

| Endpoint protégé                                        | Comportement                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/assistant/context?sponsorshipId=<uuid>` | Lecture exacte, y compris d’un dossier en attente de paiement. Sans identifiant, sélection d’un dossier actionnable pour le cockpit. Réponse `ok`, `empty`, `not_found` ou `unavailable`; une erreur de source ne devient pas un succès vide.              |
| `POST /api/admin/assistant/prepare`                     | Préparation existante, enrichie du paramètre optionnel `language` (`fr-CA`/`en`). Les préparations de commandite chargent le dossier et ses publications directement avant toute limite. Une relance admissible retourne aussi un aperçu privé `delivery`. |
| `POST /api/admin/assistant/query`                       | Paramètre optionnel `sponsorshipId`. Le contexte est limité au dossier; les outils de totaux financiers globaux, de courriels et de calendrier sont retirés de ce périmètre. Un dossier absent ne provoque pas un repli vers un autre dossier.             |
| `POST /api/admin/sponsorships/request-information`      | Action administrative distincte des outils conversationnels. Corps : `contributionId`, `contextVersion`, `recipient`, `subject`, `body`, `confirmed: true`. Validation serveur puis mise en file transactionnelle et audit.                                |

Les alias sans `/api` sont conservés. Contexte et aperçu privé utilisent `Cache-Control: private, no-store`. Le contexte présenté au modèle ne reçoit pas l’aperçu de livraison ni l’adresse du destinataire. Les changements de contrat sont additifs.

### Envoi confirmé

1. Valider la confirmation, l’UUID, l’empreinte de version, le destinataire et les longueurs. Refuser les retours à la ligne et le caractère NUL dans l’objet.
2. Verrouiller la commandite dans une transaction PostgreSQL.
3. Retrouver une éventuelle demande identique par sa clé de déduplication (dossier, destinataire, objet et message). Un retry retourne le même courriel, même si le dossier a changé depuis.
4. Pour une nouvelle demande, relire la version et l’adresse. Exiger une commandite payée, sans remboursement demandé, non refusée et avec fiche incomplète.
5. Insérer un message `sponsorship_information_request` dans la file existante et l’audit `sponsorship.request_information` dans la même transaction. L’audit contient l’identifiant du message, sans adresse ni contenu privé. Un échec d’audit annule la mise en file.
6. Le worker de courriels existant assure l’envoi après validation de la transaction. Un échec se reprend depuis la file, sans recréer le fait métier.

La lecture, la question et la préparation ne déclenchent aucun envoi ni changement de revue, de paiement ou de publication. Les traces d’utilisation déjà présentes sur les endpoints Assistant sont conservées. Aucun outil conversationnel n’appelle l’endpoint d’envoi.

Une modification du texte constitue une nouvelle demande, soumise à une nouvelle confirmation. L’adresse est affichée en lecture seule; sa correction passe par le dossier. La relance rappelle le lien de suivi déjà transmis, sans générer ni exposer un nouveau token.

## Composition

- Organisme Funding : [AdminAssistantContextComponent](../apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-context.component.ts), responsable du chargement du dossier et du parcours confirmé.
- Molécules de présentation : [brouillon](../apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-draft.component.ts) et [réponse](../apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-answer.component.ts).
- Lecture et règles : [repository ciblé](../apps/funding-api/src/admin-assistant/context.repository.ts), [projection déterministe](../apps/funding-api/src/admin-assistant/context.service.ts).
- Action métier : [demande d’informations](../apps/funding-api/src/sponsorship-information.service.ts), réutilisant les repositories, la file et l’audit existants.
- [Contrats partagés](../packages/funding-core/src/admin-assistant-context.ts), intégration dans le service Angular, le cockpit, les commandites, le bandeau et la page Assistant.

Composants standalone, OnPush et signals; aucun chargement contextuel côté SSR. Le dialogue natif prend en charge le clavier, Échap et le retour du focus. Les requêtes devenues obsolètes après changement de contexte sont ignorées.

## Validation

- `yarn test` sous Node 22 : **200 tests réussis**, compilation API/packages incluse.
- `yarn test:ui:admin` : compilation Angular, **22 routes publiques pré-rendues**, typage des tests et **33 tests navigateur réussis**, dont 14 pour ce lot.
- PostgreSQL 16 jetable, exposé sur loopback uniquement : scénario d’intégration réussi avec **2 006 commandites**, publications au-delà de la limite de liste, lecture exacte, préparation sans écriture métier, envois concurrents dédupliqués, conflit de version, destinataire imposé, échappement HTML, reprise après résultat incertain et annulation sur échec d’audit.
- ESLint ciblé, format des nouveaux fichiers et `git diff --check` vérifiés. Le lint global conserve 15 erreurs d’import préexistantes et un avertissement hors périmètre; le format global comporte encore des écarts historiques.
- Capture et contrôle mobile à 390 px, langue anglaise, absence de débordement; tests de focus, session expirée, accès refusé et réponse tardive.

Rejouer l’intégration uniquement sur une base locale **neuve** nommée `assistant_test` :

```sh
yarn build
ASSISTANT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55480/assistant_test node --test tests/integration/admin-assistant-context.integration.mjs
```

Le test ne charge pas `.env`, ne démarre aucun worker et n’envoie aucun courriel. Sans variable explicite, il est ignoré.

## Limites et suite

- Aucune migration nouvelle ni opération manuelle sur les données. Les migrations existantes des commandites, médias, publications, courriels et audits sont nécessaires.
- Le fournisseur conversationnel existant reste `mock` ou désactivé. Ses réponses de démonstration restent en français; aucun nouveau fournisseur externe n’a été ajouté.
- La livraison réelle SMTP/Resend et les E2E de la pile Docker/Stripe complète n’ont pas été exécutés. Les tests prouvent la mise en file et le parcours UI avec des données synthétiques.
- Prochain lot : **lot 4 — Dossier commandite, progression et badges**.
