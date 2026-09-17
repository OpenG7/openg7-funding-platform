# Lot 7 — Panneaux latéraux et harmonisation

## Expérience livrée

Les pages contributions, commandites, publications, factures, dépenses, transparence, courriels, audit, configuration et Assistant utilisent le même layout administratif : navigation, recherche globale, choix FR/EN, couleurs et formulaires. La connexion reprend ce thème et propose le changement de langue. Les anciennes saisies de jeton sur les pages déjà authentifiées sont retirées; la connexion demeure le point d’entrée de session.

| Consultation courte | Déclencheur                                 | Source / suite                                                                                  |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Note interne        | Onglet Vue d’ensemble du dossier            | Formulaire existant, version du dossier et sauvegarde auditée; brouillon conservé après erreur. |
| Facture             | Liste des factures ou résultat de recherche | Snapshot autorisé, lignes et montants; PDF protégé ouvert dans un nouvel onglet.                |
| Événement Stripe    | Intervention Stripe dans À traiter          | Lecture minimale de l’événement enregistré; lien vers l’intervention.                           |
| Courriel            | Destinataire dans la file                   | État, tentatives, prochaine tentative et erreur déjà retournés par l’API admin.                 |
| Audit               | Action dans le journal                      | Entrée sélectionnée, puis lien vers sa page filtrée.                                            |
| Justificatif        | Carte de dépense                            | Métadonnées du justificatif; lien externe HTTP(S) sans identifiants intégrés dans l’URL.        |
| Média               | Onglet Médias                               | Chargement authentifié de l’image privée, JPEG/PNG/WebP.                                        |
| Historique          | Onglet Historique du dossier                | Entrées d’audit déjà chargées avec ce dossier.                                                  |

Les panneaux présentent un titre accessible, un bouton de fermeture, un lien vers la page complète et un retour au contexte d’origine. La note s’édite depuis son dossier complet. Sur mobile, le panneau occupe toute la largeur. Échap ferme le panneau et restaure le focus; Tab reste dans la modale. Pendant une sauvegarde de note, les commandes de fermeture et le champ sont désactivés.

L’aperçu de facture est un rendu HTML du snapshot, avec accès au PDF original. Il n’utilise pas de visionneuse PDF intégrée qui pourrait capturer le clavier. Les erreurs se traitent dans le panneau avec un retry; une fermeture invalide les réponses tardives et révoque les URL de fichiers temporaires. Un refus d’accès retire les données affichées; une session expirée retourne à la connexion avec l’URL de retour.

## Organisation du code

- [AdminDrawerComponent](../apps/funding-web/src/app/features/funding/components/admin-ui/admin-drawer.component.ts) : molécule de présentation standalone/OnPush, dialog natif, focus et projection de contenu. Aucun routeur ni client métier.
- [AdminInspectionService](../apps/funding-web/src/app/features/funding/services/admin-inspection.service.ts) : contexte temporaire de consultation, effacé à la navigation. Aucune persistance dans le navigateur.
- [AdminInspectorComponent](../apps/funding-web/src/app/features/funding/components/admin-inspector/admin-inspector.component.ts) : organisme Funding, chargements protégés, états, liens et cycle de vie des blobs. Les courriels, preuves et historiques proviennent du snapshot de la page; les factures, médias et événements Stripe sont relus à l’ouverture.
- [AdminConfirmationService](../apps/funding-web/src/app/features/funding/services/admin-confirmation.service.ts) et son composant : une décision à la fois, annulation par défaut et à la navigation. Les mutations restent dans leurs pages et services existants.
- `admin-forms.css` complète les tokens et contrôles du socle admin. Les textes historiques sont extraits dans `admin.legacy`; les messages d’exécution dans `admin.messages`. `FundingI18nService.t()` suit désormais la version des traductions, ce qui actualise aussi les libellés calculés.

Les confirmations couvrent la publication, le refus, le masquage/annulation, la suppression de médias, le retour en attente, les renvois de courriels et documents, le rattrapage de factures et l’export CSV privé. Le remboursement conserve son formulaire spécialisé : montant, devise, raison, montant admissible, texte à recopier, notification et résultat serveur. Aucune confirmation générique ne remplace ces informations.

## Contrats API et navigation

### Événement Stripe

`GET /api/admin/stripe-event?eventId=evt_…`, alias `/admin/stripe-event`, exige l’autorisation admin avant toute lecture.

- Identifiant : préfixe `evt_`, puis 1 à 196 caractères alphanumériques ou `_`; invalide → 400.
- Réponse : `{ available, event }`. Sans base/table : `available: false`; identifiant absent d’une source disponible : `available: true, event: null`.
- Projection : `id`, `type`, `status`, `receivedAt`, `processedAt`, `error`.
- `error` vaut `processing_failed` uniquement si l’état persistant est `failed`. La table ne conserve pas de détail d’erreur : l’interface l’indique, sans inventer une cause Stripe.
- Le SELECT ne lit jamais `payload`. Transaction de lecture seule via le lecteur du cockpit, paramètres SQL liés, réponse non mise en cache; erreur technique → 503 générique.
- Cette lecture ne rejoue aucun événement et ne contacte pas Stripe.

### Pages complètes

Les GET existants acceptent deux filtres additifs :

| Endpoint               | Paramètre                                             | Effet                                                                    |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `/api/admin/audit-log` | `entryId`, UUID                                       | Filtre avant la limite de 100 entrées.                                   |
| `/api/admin/expenses`  | `expenseId`, entier positif représenté par une chaîne | Filtre avant la limite de 250 dépenses, dans la plage PostgreSQL BIGINT. |

Les résumés globaux restent globaux. Sans filtre, les listes conservent leur portée. Ces endpoints historiques exigent toujours une base configurée : sans base, 503 avant validation du filtre. Avec stockage disponible, un filtre invalide donne 400 et un objet absent une liste vide.

Audit, dépenses et file de courriels réagissent aux changements de paramètres sur la même route, nettoient le contexte précédent et ignorent les anciennes réponses. Les liens ne contiennent que des identifiants; la note, le destinataire et le contenu des aperçus ne sont pas ajoutés à l’URL.

Les montants affichés réutilisent les contrats existants : les enregistrements historiques de facture et dépense exposent des montants convertis en unités majeures. Le stockage financier et les nouvelles projections du cockpit conservent leurs unités mineures. Ce lot ne change aucune règle de calcul ou d’écriture financière.

## Vérification et reproduction

Avec Node 22 et Yarn 4 :

```powershell
yarn test
yarn test:ui:admin
node --test tests/integration/admin-inspection.integration.mjs
git diff --check
```

Le test PostgreSQL utilise le helper de base jetable existant. Il exige Docker local et l’image `postgres:16-alpine`, crée son propre conteneur en mémoire sur une adresse loopback, applique les migrations, puis détruit uniquement ce conteneur. Il ne lit ni `.env` ni `DATABASE_URL` et ne touche pas aux services Compose existants.

Les tests navigateur interceptent l’API avec des fixtures synthétiques. Ils couvrent notamment clavier/focus, mobile, FR/EN, note après erreur, accès PDF 401/403, type MIME inattendu, libération des blobs, réponse tardive, inspection de médias, pages exactes et confirmations. Les anciens tests de couverture statique résolvent maintenant les seules clés référencées dans leur source et vérifient leur présence en FR et EN; ils ne remplacent pas ces scénarios navigateur.

### Résultats

- Compilation TypeScript et **226 tests Node réussis**.
- Compilation Angular/SSR réussie, **22 routes pré-rendues**.
- **76 scénarios Playwright réussis**, dont les nouveaux cas de panneaux et confirmations; captures synthétiques desktop 1672 × 941 et mobile 320 px relues.
- Test PostgreSQL 16 réussi : projection Stripe sans payload ni mutation, audit ancien hors des 100 entrées et dépense ancienne hors des 250 éléments.
- ESLint des fichiers modifiés et nouveaux, format ciblé et `git diff --check` réussis.
- Le lint global conserve **11 erreurs d’import et un avertissement préexistants hors périmètre**. Le format global signale encore des fichiers historiques et des artefacts locaux; aucune remise en forme générale du dépôt.
- La vérification TypeScript de l’ensemble des anciens tests (`tsc --noEmit -p tsconfig.json`) relève **23 erreurs préexistantes** dans les fixtures/intégrations de paiement et les tests publics. Les fichiers concernés et leurs fixtures sont inchangés; la compilation applicative et la vérification TypeScript de la suite UI admin passent.
- Les tests Docker existants concernés ont été adaptés aux confirmations HTML. Leur exécution sur la pile applicative complète reste à la recette du lot 8.

### Limites et suite

La pile Docker applicative complète, les fournisseurs externes réels et la recette transverse des remboursements restent au **lot 8 — Recette et preuves d’exécution**. Les contenus saisis, snapshots de documents et messages fournis par les systèmes externes restent dans leur langue d’origine.

Aucune migration, dépendance ou variable d’environnement applicative ajoutée. Aucune opération de production, aucun envoi réel, aucun commit ou push effectué pendant ce lot.
