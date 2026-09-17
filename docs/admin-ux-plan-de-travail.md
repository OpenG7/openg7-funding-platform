# Plan de travail — Centre de pilotage admin

Date : 15 septembre 2026.

## 1. Objectif et portée

Transformer l’administration en un espace qui indique **ce qui demande une intervention, pourquoi et quelle action effectuer ensuite**, selon les [requis UX](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

Ce document prépare l’implémentation. Les propositions contenues dans les documents sont des exigences à analyser et à organiser; elles ne constituent pas une instruction d’exécuter les opérations illustrées.

**Avancement au 17 septembre 2026 :** lots 1 à 7 réalisés ; recette locale du lot 8 validée, exécution CI à confirmer dans la PR. Voir les bilans du [socle visuel](./admin-ux-lot-1.md), de la [file À traiter](./admin-ux-lot-2.md), de l’[Assistant contextuel](./admin-ux-lot-3.md), du [dossier commandite](./admin-ux-lot-4.md), des [indicateurs, activité et systèmes](./admin-ux-lot-5.md), de la [recherche globale](./admin-ux-lot-6.md), des [panneaux latéraux et de l’harmonisation](./admin-ux-lot-7.md) et de la [recette et des preuves d’exécution](./admin-ux-lot-8.md).

Le présent changement documentaire est à risque faible. L’implémentation prévue sera à risque modéré pour les contrats API, les sessions, les projections et les parcours administratifs. Toute opération réelle sur les paiements ou la production reste une intervention distincte.

Références de réalisation : [AGENTS.md](../AGENTS.md) et [architecture](./ARCHITECTURE.md). Les constats ci-dessous résultent d’une inspection du code; ils ne constituent pas une validation de son exécution.

## 2. Point de départ dans le dépôt

| Surface                  | Existant inspecté                                                                                                                            | Travail à prévoir                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tableau de bord          | Indicateurs, résumés de revue/publication/Stripe, dernières contributions dans `admin-dashboard-page.component.ts`.                          | Composition de la maquette, file centrale, dossier en cours, activité transverse et état des services.    |
| File de travail          | `admin-assistant/attention.service.ts` produit déjà des éléments déterministes avec priorité, faits et liens.                                | Réutiliser cette source hors de la page Assistant; compléter les catégories et la pagination.             |
| Assistant                | Résumé, questions et préparation de brouillons; fournisseur conversationnel `disabled` ou `mock`.                                            | Présence permanente et contexte du dossier. Un fournisseur IA réel constitue une extension distincte.     |
| Commandites              | Liste avec recherche et pagination, sélection par `sponsorshipId`, composants de détail, revue, médias, publication, remboursement et audit. | Prochaine action, progression visible, sept onglets et intégration de la facturation au dossier.          |
| Navigation               | `AdminNavComponent` partagé; structure de page et styles encore répétés.                                                                     | Layout admin commun, quatre groupes, badges d’action, bandeau et navigation mobile.                       |
| Factures et publications | Factures/PDF/avoirs, rattrapage de factures, brouillons, lots et créneaux de publication.                                                    | Relier les objets dans les parcours et exposer les anomalies pertinentes.                                 |
| État des services        | `/admin/setup-status` décrit la configuration, la connexion DB et la file de courriels.                                                      | Mesures de santé horodatées; la configuration seule ne prouve pas le fonctionnement du service.           |
| Recherche                | Recherche métier des commandites et filtres propres à plusieurs pages.                                                                       | Recherche globale des objets liés, protégée côté API.                                                     |
| Garanties                | Tests Node et Playwright admin présents; CI avec compilation Angular, tests et E2E Docker.                                                   | Adapter les scénarios, ajouter la couverture du cockpit et obtenir les résultats sur la version réalisée. |

### Points de code à réutiliser

- [Dashboard](../apps/funding-web/src/app/features/funding/pages/admin-dashboard-page/admin-dashboard-page.component.ts), [navigation](../apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts), [routes](../apps/funding-web/src/app/app.routes.ts) et [client admin](../apps/funding-web/src/app/features/funding/services/funding-admin.service.ts).
- [Dossiers commandites](../apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts), [modèles UI](../apps/funding-web/src/app/features/funding/models/admin-sponsors-ui.models.ts) et [Assistant actuel](../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.ts).
- [Détection des points d’attention](../apps/funding-api/src/admin-assistant/attention.service.ts), [préparation des brouillons](../apps/funding-api/src/admin-assistant/preparation.service.ts), [repositories contributions](../apps/funding-api/src/fund-contributions.repository.ts) et [contrats existants](../packages/funding-core/src/index.ts).
- [Styles et couleurs existants](../apps/funding-web/src/styles.css), [traductions françaises](../apps/funding-web/src/assets/i18n/fr-CA.json) et [anglaises](../apps/funding-web/src/assets/i18n/en.json).

## 3. Décisions de conception proposées

### Traduire la maquette en interface exploitable

- Reprendre le fond bleu nuit, les surfaces légèrement contrastées, l’accent or, les pictogrammes, les quatre indicateurs et la hiérarchie des blocs. Réutiliser les couleurs du projet et mesurer les contrastes avant de figer les nuances.
- Structurer la navigation selon les quatre groupes des requis : **Pilotage**, **Opérations**, **Finances**, **Système**. Conserver **Transparence** sous Finances, même si elle n’est pas visible dans la maquette.
- Ordre desktop : bandeau; titre et date; indicateurs; file de travail et dossier en cours; Assistant, activité et systèmes. Sur mobile, afficher une seule colonne avec « À traiter » avant les blocs secondaires et un menu repliable.
- Définir les états chargement, vide, erreur, données partielles, données périmées, accès refusé et action en cours dès la conception. Un bloc indisponible ne doit pas empêcher l’accès aux autres blocs.

### Résoudre les écarts entre l’illustration et les faits

| Sujet                     | Décision proposée                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Montants nets             | `current_available_estimate` soustrait remboursements et litiges, mais pas les frais Stripe. Le résumé Assistant retourne actuellement `processingFees` et `netReceived` à `null`. Créer une projection documentée des frais/net avant d’utiliser le libellé de la maquette.                                                  |
| Tendances et mini-courbes | Ajouter des séries réelles et des périodes comparables. En l’absence d’historique exploitable, afficher l’indisponibilité de la tendance. Les chiffres de la maquette restent des données de démonstration.                                                                                                                   |
| Ordre du workflow         | Les factures peuvent déjà être créées pendant le traitement du webhook de paiement. La progression visuelle doit accepter une facture émise avant la revue; elle ne doit pas imposer une nouvelle règle comptable séquentielle.                                                                                               |
| « Factures à générer »    | Traiter une facture admissible manquante comme une anomalie à résoudre. Le bouton ouvre une opération ciblée et vérifiable; il ne déclenche pas implicitement un rattrapage global.                                                                                                                                           |
| Identité et responsable   | La session actuelle expose un acteur technique, sans profil nominatif. Afficher « Administration » avec la session réelle; le nom, l’avatar et l’assignation à une personne nécessiteraient un chantier identité distinct.                                                                                                    |
| Cloche                    | Première version : accès aux alertes de la file avec le même comptage. Un centre de notifications avec états lu/non lu et préférences serait une extension persistante à cadrer séparément.                                                                                                                                   |
| Assistant                 | Rendre le résumé et la prochaine action utilisables sans fournisseur IA. La conversation réelle nécessite un fournisseur à sélectionner et une décision sur les données transmises.                                                                                                                                           |
| Confirmations             | Appliquer la gradation des requis : actions ordinaires directes; confirmation contextualisée pour les actions sensibles; confirmation forte pour le financier ou l’irréversible. Conserver les confirmations explicites de publication, refus, masquage, suppression de média et opérations massives exigées par `AGENTS.md`. |

## 4. Lots de réalisation

### Lot 1 — Cadrage des données et socle visuel

**Priorité : P0. Dépendance : aucune. Statut : réalisé.**

Travail :

- Définir pour chaque bloc la source API, le sens des valeurs, les droits requis, les états et la politique d’actualisation.
- Fixer le sens de « commanditaires » : organismes distincts ou dossiers de commandite. Si seul le nombre de dossiers est fiable, afficher « Commandites » jusqu’à disposer d’une déduplication métier explicite.
- Définir les périodes des indicateurs, la journée métier et le fuseau de référence. Proposition : `America/Toronto`, cohérent avec les créneaux existants; affichage selon la langue active.
- Préparer le layout admin commun, le bandeau et les groupes de navigation. Maintenir les URL existantes et la destination Assistant.
- Définir les primitives nécessaires : carte, badge de statut, badge d’action, bouton et icône. Les composants Funding restent dans la feature; seules les primitives réellement neutres peuvent rejoindre `funding-ui`.
- Prévoir les vues desktop, tablette et mobile à partir de la maquette, ainsi que les traductions `fr-CA` et `en`.

**Livrable :** matrice données/écrans et socle visuel appliqué au tableau de bord, prêt à recevoir les blocs fonctionnels.

**Acceptation :** navigation clavier complète, accès à toutes les destinations actuelles, session/connexion/déconnexion cohérentes, absence de débordement mobile et rendu SSR sans accès navigateur non protégé.

### Lot 2 — « À traiter » et première version du cockpit

**Priorité : P0. Dépendance : lot 1. Statut : réalisé.**

Travail :

- Réutiliser les détecteurs de `attention.service.ts` : informations manquantes, revue de commandite, préparation de publication, publication en retard, courriel échoué et avertissement financier.
- Compléter les cas des requis : facture admissible manquante, événement Stripe en échec ou bloqué, publication prête et créneau proche. Définir les délais qui rendent un événement ou un créneau actionnable.
- Fournir une file paginée et filtrable par type, priorité et échéance. Le résumé actuel matérialise au maximum 100 éléments par défaut; filtrer cette seule liste dans le navigateur ne suffit pas pour une file complète.
- Produire les compteurs sur le périmètre global réellement analysé et signaler toute couverture partielle. Dédupliquer les alertes d’un même événement logique, en particulier les relations publication/lot/créneau.
- Afficher un résumé « À traiter aujourd’hui » dans le cockpit et créer une destination complète « À traiter ». Règle proposée : urgences et échéances du jour dans le résumé; cette semaine et informations dans la file complète.
- Relier chaque action au dossier ou à l’objet exact. Ajouter les liens manquants vers un courriel, une facture, un créneau ou un événement Stripe; vérifier aussi les objets hors première page.
- Actualiser la file et les compteurs après confirmation serveur d’une mutation. Une tâche disparaît lorsque sa condition métier est résolue; aucune table de tâches parallèle n’est nécessaire pour ce premier périmètre.

**Livrable :** un tableau de bord qui ouvre immédiatement le travail pertinent et une file complète consultable.

**Acceptation :** priorités déterministes, compteurs cohérents avec les filtres, accès à tous les résultats, message explicite si la DB est indisponible, absence de double alerte et conservation du contexte au retour d’un dossier.

### Lot 3 — Assistant contextuel

**Priorité : P0. Dépendance : lot 2.**

Travail :

- Extraire les éléments de présentation réutilisables de la page Assistant : faits, recommandation, liens et aperçu de brouillon.
- Ajouter un bouton permanent au bandeau et une carte contextuelle dans le cockpit et la commandite sélectionnée.
- Charger explicitement le contexte du dossier côté API. Ne pas déduire son absence en filtrant les 100 premières alertes globales.
- Afficher le statut du paiement, les informations ou médias manquants, la revue et les engagements de publication à partir des services métier.
- Réutiliser la préparation des relances, notes et publications. Ajouter, si nécessaire, une préparation de revue contenant les faits et les points à vérifier.
- Pour « Demander des informations », présenter le destinataire et le message préparé. Relier l’envoi à un parcours administratif explicite, avec audit et déduplication; un brouillon reste clairement non envoyé.
- Conserver une prochaine action déterministe quand la conversation est désactivée ou indisponible. Les éventuelles réponses conversationnelles distinguent faits, interprétation et limites.

**Livrable :** un Assistant disponible dans le contexte courant, utilisable sans fournisseur externe.

**Acceptation :** aucune mutation sensible ni communication déclenchée par la simple ouverture, question ou préparation; contexte exact; états désactivé, erreur et dossier introuvable couverts; validation humaine dans le parcours normal de l’action.

### Lot 4 — Dossier commandite, progression et badges

**Priorité : P0. Dépendances : lots 2 et 3.**

Travail :

- Faire évoluer les composants de dossier existants : en-tête organisation/montant/référence, statuts indépendants et bloc « Prochaine étape ».
- Organiser les sept onglets : **Résumé**, **Identité**, **Médias**, **Publication**, **Facturation**, **Remboursements**, **Historique**.
- Afficher les six jalons de la maquette : paiement, identité, médias, revue, facturation et publication. Chaque jalon expose son état réel, son éventuel blocage et le lien utile.
- Projeter les états existants (`pending_review`, `approved`, `rejected`, etc.) en libellés UX sans renommer les contrats pour reproduire l’illustration.
- Afficher aussi la progression des publications et des remboursements depuis leurs faits persistés. Couvrir les annulations, remboursements partiels, erreurs Stripe, avoir manquant et courriel échoué; ne pas inventer une étape terminée à partir de la seule précédente.
- Rendre explicite la différence entre revue approuvée, consentement, visibilité et publication. Approuver ne publie pas et refuser ne signifie pas qu’un remboursement est terminé.
- Ajouter les badges de navigation alimentés par la même file que le cockpit, uniquement pour les actions requises.
- Définir « Commandite en cours » : dossier actuellement sélectionné pendant la session, sinon premier dossier actionnable selon le tri de priorité. Afficher un état vide lorsqu’il n’y en a aucun.

**Livrable :** un dossier complet avec la prochaine action disponible depuis l’en-tête et une version compacte dans le cockpit.

**Acceptation :** URL directe du dossier et de l’onglet, filtres préservés au retour, gestion des conflits de version, actions désactivées pendant leur exécution et actualisation après résultat serveur. Une facture antérieure à la revue reste correctement représentée.

### Lot 5 — Indicateurs, activité et état des systèmes

**Priorité : P1. Dépendances : lots 1 et 2; intégration au dossier du lot 4. Statut : réalisé.**

Travail :

- Compléter les quatre indicateurs de la maquette : encaissements, net, commanditaires ou commandites selon le cadrage, publications prévues.
- Calculer les nouvelles projections monétaires côté serveur à partir des unités mineures entières et d’une devise explicite. Les contrats admin existants exposent aussi des montants d’affichage en unités majeures : documenter l’adaptation et préserver leur compatibilité.
- Définir précisément brut, frais confirmés, remboursements, litiges et net. Distinguer net reçu et argent disponible; indiquer source, période, complétude et date de mise à jour.
- Ajouter les séries et variations avec des périodes homogènes. Traiter une période précédente nulle et les frais reçus tardivement sans afficher une variation trompeuse.
- Compter les publications selon l’unité choisie — publication par cible/canal, par exemple — sans additionner le lot et le créneau qui la représentent.
- Construire une activité récente transverse à partir des contributions, factures, publications et audits existants : événement lisible, horodatage, lien vers l’objet et absence de doublon. Inclure les faits « aujourd’hui » des requis.
- Compléter la santé Stripe, courriel, stockage et PostgreSQL avec des vérifications bornées ou des observations récentes. Exposer « opérationnel », « dégradé », « indisponible », « non configuré » et « inconnu », selon la preuve disponible.
- Prévoir des délais d’expiration et une durée de validité des contrôles; la lecture du cockpit ne doit pas envoyer de courriel ni écrire un fichier de test. Employer le nom du fournisseur de courriel réellement configuré.

**Livrable :** tous les blocs informatifs du cockpit reliés à des données vérifiables.

**Acceptation :** agrégats financiers rapprochés des fixtures, frais manquants visibles, montants séparés par devise, aucun état vert fondé uniquement sur une configuration présente et panne d’un bloc indépendante des autres.

### Lot 6 — Recherche globale

**Priorité : P1. Dépendances : lots 1 et 4.**

Travail :

- Ajouter une recherche persistante accessible au clavier avec `Ctrl+K` / `Cmd+K` et fermeture par Échap.
- Couvrir entreprise, courriel, identifiant Stripe, facture, référence publique, montant/devise, slug et identifiant de contribution.
- Fournir une recherche côté API, avec autorisation, requêtes paramétrées, limites et pagination. Les nouveaux contrats restent compatibles avec les recherches existantes.
- Regrouper les objets liés : commandite, contribution, facture et publication. Naviguer avec des identifiants internes, sans placer la requête privée dans les URL ou les journaux.
- Prévoir temporisation des frappes, annulation des requêtes précédentes, ordre de pertinence, résultats vides et indisponibilité partielle.
- Vérifier les requêtes réelles avant d’ajouter des index. Tout index ou schéma nécessaire passe par une nouvelle migration additive.

**Livrable :** accès transversal aux dossiers et documents depuis le bandeau.

**Acceptation :** un numéro de facture ouvre la bonne facture et son dossier; un courriel retrouve uniquement les résultats autorisés; fonctionnement clavier complet; aucun résultat obsolète affiché après une réponse réseau arrivée en retard.

### Lot 7 — Panneaux latéraux et harmonisation des pages

**Priorité : P1. Dépendances : lots 1 à 6.**

Travail :

- Construire un panneau latéral accessible réutilisable : titre, fermeture, focus initial, confinement du focus quand il est modal et restauration au déclencheur.
- Couvrir les opérations courtes des requis : note, aperçu de facture, événement Stripe, courriel, entrée d’audit, justificatif, média et historique.
- Ajouter une lecture admin minimale des événements Stripe si nécessaire; présenter les identifiants, états et erreurs sûres, sans corps brut de webhook.
- Conserver un lien vers la page complète et une navigation arrière cohérente. Adapter le panneau en vue pleine largeur sur mobile.
- Uniformiser boutons, confirmations, erreurs et retours de succès. Le formulaire de remboursement conserve montant, devise, raison, montant restant, confirmation et résultat serveur.
- Étendre le layout, les composants visuels et les traductions aux pages contributions, commandites, publications, factures, dépenses, transparence, courriels, audit, configuration et Assistant. Adapter aussi la connexion pour une expérience cohérente.

**Livrable :** administration visuellement cohérente, avec moins de changements de page pour les consultations courtes.

**Acceptation :** contexte préservé, aucun piège clavier, PDF/médias privés protégés, erreurs récupérables sans fermeture forcée et confirmations adaptées au risque réel de chaque action.

### Lot 8 — Recette et preuves d’exécution

Recette et outillage : voir le [bilan du lot 8](./admin-ux-lot-8.md), qui distingue les résultats locaux de la validation CI à obtenir.

**Priorité : transversale; clôture après les lots 1 à 7.**

**État :** recette locale validée ; résultats du workflow GitHub Actions à obtenir sur le commit final. Les limites de vérification visuelle et des fournisseurs externes sont détaillées dans le bilan.

Les tests sont ajoutés avec chaque lot. Ce lot termine la recette de l’ensemble.

**Recette utilisateur :**

- Depuis « À traiter », ouvrir une commandite, comprendre le blocage, préparer une demande d’informations ou effectuer la revue, puis retrouver la file actualisée.
- Depuis un courriel échoué, consulter l’erreur et passer par le parcours de retry confirmé, sans doublon logique.
- Retrouver une facture par la recherche, la prévisualiser puis ouvrir son dossier.
- Suivre une publication jusqu’à son état confirmé, avec respect du consentement et des validations humaines.
- Suivre un remboursement simulé localement jusqu’aux états Stripe, avoir et courriel, y compris en cas d’échec partiel.
- Comparer les captures de fixtures synthétiques à la maquette à 1672 × 941, puis vérifier tablette et mobile, clavier, zoom, contraste et les deux langues.

**Garanties d’exécution :**

- Tests unitaires des priorités, compteurs, regroupements, prochaines actions, états et agrégats.
- Tests API d’autorisation, expiration de session, absence de données sensibles, conflits de version et disponibilité partielle.
- Tests de déduplication, double soumission et retry sur les mutations touchées. Réutiliser les suites paiement, facture, publication et remboursement existantes.
- Tests Playwright du cockpit, navigation, Assistant contextuel, dossier, recherche et panneaux; fixtures au-delà des limites de pagination et cas sans données.
- Tests responsive admin en lecture seule ou sur fixtures isolées. La convention `@mobile` couvre désormais les lectures publiques/admin et les parcours aux mutations interceptées, sans rejouer les mutations métier contre la même DB.
- Compilation Angular/SSR, compilation TypeScript et résultats CI sur la version finale du changement. Les réponses IA simulées ne constituent pas une validation d’un fournisseur réel.

**Livrable :** rapport de recette distinguant comportement visible, résultats automatisés, limites restantes et étapes de livraison.

**Acceptation :** critères des lots vérifiés, suites pertinentes réussies, documentation des contrats à jour et aucune anomalie bloquante ouverte sur les parcours concernés.

## 5. Ordre de livraison et dépendances

| Jalon                    | Lots              | Résultat vérifiable                                                                                                  |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| A — Travail centralisé   | 1 et 2            | Nouvelle structure et file « À traiter » reliée aux actions existantes.                                              |
| B — Dossier guidé        | 3 et 4            | Assistant contextuel, prochaine étape, dossier complet et badges. C’est la première cible fonctionnelle prioritaire. |
| C — Cockpit complet      | 5 et 6            | Indicateurs, activité, systèmes et recherche globale.                                                                |
| D — Expérience finalisée | 7 et clôture du 8 | Panneaux, cohérence de toutes les pages et recette complète.                                                         |

La définition des données financières commence au lot 1 pour éviter de découvrir trop tard une absence de source. Le lot 5 peut être préparé pendant l’intégration des dossiers, une fois les contrats de lecture stabilisés. Les validations du lot 8 accompagnent chacun des jalons.

Le chiffrage en jours est à établir après le lot 1. Les principales variables sont la disponibilité des frais et séries historiques, le volume de recherche, les endpoints manquants pour les anomalies et le périmètre éventuel d’identité nominative ou d’IA réelle.

## 6. Architecture et données

- **Pages et orchestration Funding** : chargement, route, sélection du dossier et invalidation après mutation.
- **Layout admin — template** : navigation et placement responsive, sans décision financière.
- **Composants de domaine — organismes/molécules** : file de travail, carte dossier, progression, Assistant, activité et état des services; inputs/outputs typés.
- **Primitives** : boutons, badges et panneau accessibles, sans client HTTP ni connaissance de la session.
- **API** : composition des repositories et des règles déterministes, autorisation et contrats de lecture. Les badges, le cockpit et l’Assistant consomment la même définition des actions requises.
- **Contrats** : faire évoluer les exports actuels de `funding-core` de façon additive; éviter une migration opportuniste des contrats existants vers un autre package.
- **État Angular** : composants standalone et OnPush, signals pour l’état local; réutilisation des mécanismes de données existants. Tout nouvel état global exige la justification prévue dans le dépôt.
- **Persistance** : aucune migration nécessaire pour ce document. Pendant l’implémentation, créer une migration uniquement si un index, un fait métier ou un état persistant nouveau est requis; conserver les migrations existantes immuables.

Les états de présentation peuvent être dérivés des faits actuels. Si une étape UX exige un fait absent — responsable assigné, demande d’information suivie ou revue de publication distincte, par exemple — cadrer son contrat, sa transition et son audit avant d’affirmer que cette étape est suivie par le système.

## 7. Commandes de validation prévues

Pour l’implémentation, selon les fichiers touchés :

```bash
yarn format:check
yarn lint
yarn workspace @openg7/funding-web build
yarn test
yarn test:e2e
yarn test:e2e:playwright
yarn test:e2e:acceptance
git diff --check
git status --short
```

- `yarn test` inclut la compilation TypeScript; la compilation Angular reste une commande distincte.
- `yarn test:e2e` lance la suite Node de couverture commandite. Les parcours navigateur sont exécutés par `yarn test:e2e:playwright`.
- Le script Playwright prépare Docker, applique les migrations et charge les fixtures : l’exécuter uniquement sur l’environnement local de test vérifié. Si une migration est ajoutée, vérifier une DB locale propre et une DB locale avec données existantes.
- Pour la recette, préférer `yarn test:e2e:acceptance` : cette commande crée une pile jetable sans charger le `.env` applicatif ni réutiliser les volumes locaux. Les tests UI interceptés sont exécutés séparément avec `yarn test:ui:admin`.
- Réutiliser notamment les suites `admin-readonly-pages`, `admin-assistant`, `admin-sponsorship-review`, `admin-sponsorship-publication`, `admin-publication-batches`, `admin-email-queue` et `admin-refund-integrity`.

Pour ce livrable documentaire, les validations applicables sont la relecture des liens et chemins et `git diff --check`. Les tests applicatifs et E2E seront exécutés lors de la réalisation; ils n’ont pas été exécutés pour établir ce plan.

## 8. Première action recommandée

Les **lots 1 à 7** livrent le layout admin, la file « À traiter », l’Assistant contextuel, le dossier commandite, les indicateurs du cockpit, la recherche globale et les panneaux latéraux. Le **lot 8** apporte une recette locale validée et un workflow de PR. Prochaine étape : obtenir les résultats CI sur le commit final et les joindre à la revue, en s’appuyant sur le [bilan de recette](./admin-ux-lot-8.md).
