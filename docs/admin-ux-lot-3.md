# Lot 3 — Assistant contextuel

Réalisé le 16 septembre 2026 selon le [plan de travail](./admin-ux-plan-de-travail.md), les [requis](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

## Résultat visible

- Carte **Assistant contextuel** après « À traiter » dans le cockpit, avec faits dépliables, et dans la commandite sélectionnée. L’ouverture du dossier dans l’Assistant conserve son identifiant dans l’URL : `/admin/fundraiser/assistant?sponsorshipId=<uuid>`.
- **Ouvrir l’Assistant pour ce dossier** est masqué dans sa destination. Dans le même onglet, ce lien transmet une seule fois la question, la réponse et le brouillon avec ses saisies, uniquement en mémoire, sans stockage navigateur ni contenu privé dans l’URL ou l’historique. Le dossier est relu avant reprise : un changement de version invalide le brouillon et la réponse, avec un message explicite pour le brouillon. Un rechargement ou une ouverture dans un autre onglet ne conserve pas ces saisies; aucune confirmation d’envoi n’est transférée.
- Le lecteur consulte les faits et peut poser une question, mais ne voit pas les actions de préparation. Un refus d’action entraîne une nouvelle vérification de lecture : les faits restent visibles si l’accès au dossier est toujours autorisé; le brouillon refusé est effacé.
- Dans la commandite sélectionnée, **Ouvrir le dossier** affiche la fiche détaillée « Vue d’ensemble » et y place le focus, y compris sur mobile et lors d’une nouvelle activation. Depuis le cockpit ou l’Assistant, l’action conserve son lien vers la page du dossier.
- Faits distincts : paiement, remboursement, revue, visibilité, consentement, médias approuvés/à réviser/refusés, informations manquantes et couverture des canaux de publication promis.
- Prochaine étape déterministe, accessible sans fournisseur de modèle : vérifier le paiement/remboursement/refus, compléter la fiche, réviser les médias, effectuer la revue, vérifier le consentement, préparer ou suivre les publications.
- Préparation d’une relance, d’une note de revue ou d’un brouillon de publication. Chaque proposition indique qu’elle n’est ni envoyée, ni publiée, ni enregistrée.
- **Demander des informations** présente le destinataire enregistré, un objet et un message modifiables. Un dialogue récapitule le message avant **Confirmer l’envoi**. Le résultat distingue mise en file, demande déjà en file, déjà envoyée et livraison échouée, avec lien vers le courriel exact.
- Présentation des brouillons et des réponses extraite en composants réutilisés par la page Assistant existante et la carte contextuelle. Les réponses séparent faits, interprétation, recommandations et limites.
- Interface contextuelle et brouillons de dossier en FR/EN. Chargement, absence de tâche, dossier introuvable, erreur, conflit de version et accès refusé sont explicites. Une session expirée revient à la connexion; une réponse tardive ne remplace pas un nouveau dossier.

La carte du cockpit choisit actuellement la première commandite des détecteurs d’attention, triée par priorité, sans limite globale de 100 ou 2 000 dossiers. La sélection mémorisée pendant la session et la progression complète du dossier appartiennent au lot 4.

## Retour au dossier — OUX-002

Le **19 octobre 2026**, le retour dossier → Assistant contextuel → dossier est
implémenté et vérifié localement sur `feat/ux-followup-assistant-return-context`,
à la suite de l’[écart UX-00](development/ux-00-current-platform-audit.md).
Cette qualification de branche ne constitue ni une fusion dans `main`, ni un
déploiement.

Le parcours conserve deux destinations distinctes : **Retour au dossier**
retrouve l’origine connue ; **Ouvrir le dossier** conserve la prochaine étape
recommandée par le contexte. Le retour explicite reste disponible lorsqu’une
lecture de l’Assistant échoue.

L’origine réutilise le paramètre interne `returnTo`, reconstruit pour
`/admin/fundraiser/sponsors` et le même `sponsorshipId`. Seuls l’onglet connu
(`overview`, `identity`, `publication`, `billing`, `audit`, alias `media`/`refund`)
et un fragment propriétaire cohérent sont conservés. Recherche, autres paramètres,
retour imbriqué, URL externe et sélecteur de focus libre ne font pas partie du
contrat. Une origine absente ou invalide conserve le parcours de dossier existant,
sans choisir une autre commandite.

La restauration réutilise l’[adaptateur du dossier](../apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-navigation.adapter.ts)
et attend la lecture puis le rendu du dossier exact. Dans le même onglet, un
marqueur interne transitoire rend le focus au lien Assistant du dossier ou de
l’en-tête. Une nouvelle navigation annule cette intention. Après rechargement,
ce marqueur n’est pas conservé : un fragment valide restaure le focus de sa section,
sans promettre le focus du déclencheur. Aucun sélecteur libre, texte de question,
réponse, brouillon ou destinataire n’est ajouté à l’URL, à l’historique ou au
stockage navigateur.

Vérifications locales sous Windows et Node 22, sur le build Angular du
**19 octobre 2026 à 19:50:43 UTC**, sans nouvelle compilation pendant les recettes :

- **31 tests Node réussis** : [validateur de retour](../tests/admin-assistant-navigation.test.mjs)
  et [adaptateur dossier](../tests/admin-sponsors-navigation-adapter.test.mjs), dont
  les alias cohérents et le rejet des origines externes, autres dossiers et valeurs
  ambiguës ; paramètres privés/imbriqués retirés, fragment invalide supprimé.
- **52 cas contextuels réussis** dans le [fichier complet de l’Assistant](../tests/playwright/admin-assistant-context.spec.ts)
  en 57,8 s, sans retry, dont les 11 nouveaux cas aussi vérifiés séparément :
  dossier/en-tête FR/EN, lecture fraîche, focus exact, erreur de contexte, entrée
  directe, rechargement, origine invalide et navigation annulant un focus tardif.
  Les garanties existantes de brouillons privés, session et lectures tardives
  restent couvertes.
- **32 contrôles plateforme réussis**, quatre navigateurs, en 1,3 min : HTML
  prérendu sans JavaScript, entrée publique sans implémentations/locales admin,
  accès admin et changements de langue, HTTP 404 et récupération FR/EN, via la
  [suite plateforme](../tests/playwright-platform-accessibility.config.mjs).
- **14 contrôles dossier/shell réussis** en Chromium : alias média/remboursement
  FR/EN et [couches du shell](../tests/playwright/admin-shell-layers.ui.spec.ts),
  confirmations imbriquées, Échap, brouillon conservé et actions accessibles,
  en 23,4 s.

La compilation Angular produit 25 routes et un chargement initial de 505,39 kB.
Le typage admin, le lint global (sans erreur, avertissement historique dans
`scripts/smoke-public.mjs`), le format, les standards et les budgets/liens passent.
La suite Node ciblée a réussi 183 contrôles ; les 31 contrôles de navigation
ci-dessus ont ensuite été revérifiés après ajout des cas d’alias, sans additionner
ces passages qui se recouvrent.

Les recettes UI servent le Web compilé et interceptent des réponses synthétiques,
sans processus SSR serveur, API/DB réelles ni fournisseur externe. Elles ne
qualifient ni manette physique, ni production. CI de cette correction, intégration
dans `main` et déploiement restent à confirmer. Les tests contextuels restent
propriétaires de la confidentialité et de la remise à zéro des brouillons. Les
autres retours interroutes d’OUX-002 et la restauration de recherche/pagination après
rechargement restent hors de cette correction ciblée.

## Contrats et garanties

| Endpoint protégé                                        | Comportement                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/assistant/context?sponsorshipId=<uuid>` | Lecture exacte, y compris d’un dossier en attente de paiement. Sans identifiant, sélection d’un dossier actionnable pour le cockpit. Réponse `ok`, `empty`, `not_found` ou `unavailable`; une erreur de source ne devient pas un succès vide.              |
| `POST /api/admin/assistant/prepare`                     | Préparation existante, enrichie du paramètre optionnel `language` (`fr-CA`/`en`). Les préparations de commandite chargent le dossier et ses publications directement avant toute limite. Une relance admissible retourne aussi un aperçu privé `delivery`. |
| `POST /api/admin/assistant/query`                       | Paramètre optionnel `sponsorshipId`. Le contexte est limité au dossier; les outils de totaux financiers globaux, de courriels et de calendrier sont retirés de ce périmètre. Un dossier absent ne provoque pas un repli vers un autre dossier.             |
| `POST /api/admin/sponsorships/request-information`      | Action administrative distincte des outils conversationnels. Corps : `requestId` (UUID), `contributionId`, `contextVersion`, `recipient`, `subject`, `body`, `confirmed: true`. Validation serveur puis mise en file transactionnelle et audit.            |

Les alias sans `/api` sont conservés. Contexte et aperçu privé utilisent `Cache-Control: private, no-store`. Le contexte présenté au modèle ne reçoit pas l’aperçu de livraison ni l’adresse du destinataire. Les changements de contrat sont additifs.

### Envoi confirmé

Le [reçu de demande d’informations](technical/assistant-information-receipts.md)
définit le UUID `requestId` requis, le replay exact et la vérification GET après
réponse perdue. Une absence ou une erreur conserve le verrou ; les marqueurs
historiques sans UUID restent bloqués sans nouvelle commande.

1. Valider la confirmation, l’UUID, l’empreinte de version, le destinataire et les longueurs. Refuser les retours à la ligne et le caractère NUL dans l’objet.
2. Verrouiller la commandite dans une transaction PostgreSQL.
3. Retrouver le reçu du même UUID et acteur ; un replay exact conserve son acceptation et son courriel, même si le dossier a changé depuis.
4. Pour un nouvel UUID, relire la version et l’adresse. Exiger une commandite payée, sans remboursement demandé, non refusée et avec fiche incomplète, puis réutiliser un courriel de contenu identique s’il existe.
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

Depuis le lot 8, l’intégration crée sa propre base jetable avec Docker local. Reproduction avec Node 22 et Yarn 4 :

```sh
docker pull postgres:16-alpine
yarn build
node --test tests/integration/admin-assistant-context.integration.mjs
```

Le test ne charge ni `.env` ni `ASSISTANT_TEST_DATABASE_URL`, ne démarre aucun worker et n’envoie aucun courriel. Il s’exécute systématiquement et supprime son conteneur en fin de test. Voir la [recette actuelle](./admin-ux-lot-8.md) ; les résultats ci-dessus décrivent la validation initiale du lot 3.

## Limites et suite

- Aucune migration nouvelle ni opération manuelle sur les données. Les migrations existantes des commandites, médias, publications, courriels et audits sont nécessaires.
- Le fournisseur conversationnel existant reste `mock` ou désactivé. Ses réponses de démonstration restent en français; aucun nouveau fournisseur externe n’a été ajouté.
- La livraison réelle SMTP/Resend et les E2E de la pile Docker/Stripe complète n’ont pas été exécutés. Les tests prouvent la mise en file et le parcours UI avec des données synthétiques.
- Prochain lot : **lot 4 — Dossier commandite, progression et badges**.
