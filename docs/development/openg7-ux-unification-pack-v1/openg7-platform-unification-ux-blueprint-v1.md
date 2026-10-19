# OpenG7 Funding Platform — Blueprint transversal d'unification UX/UI (V1)

> **Statut : proposition de conception — non implémentée, non fusionnée, non déployée.**
> **Date : 18 octobre 2026.** Cette V1 complète le plan directeur existant ; elle ne remplace ni l'inventaire fonctionnel, ni les contrats API, ni les blueprints de domaine.

## 0. Sources, autorité et périmètre

### Sources de vérité examinées

1. **Plan directeur fonctionnel et visuel** : [`platform-functional-visual-blueprint.md`, commit documentaire `9bd24edb1c2d86d942907023e7fa53aa12fd41fd`](https://github.com/OpenG7/openg7-funding-platform/blob/9bd24edb1c2d86d942907023e7fa53aa12fd41fd/docs/development/platform-functional-visual-blueprint.md), qui inventorie **la révision de code `b00ad2b2`**, branche `feat/admin-campaigns`, au 18 octobre 2026. La révision documentaire et la révision applicative inventoriée sont différentes : ne pas les interchanger.
2. **Blueprint spécialisé du dossier de commandite**, fourni dans la conversation (`admin-sponsorship-dossier-blueprint.md`, inventaire initial `bc593f7f` avec compléments locaux). Il précise les actions `DOS-*`, la séparation des décisions, les cinq onglets et les outils partagés.
3. **Proposition UX ciblée « Dossier V2 »**, `admin-sponsorship-dossier-blueprint-v2.md`, travail de conception fondé sur l'inventaire précédent. Ses dispositions *cibles* ne sont **pas** présumées déjà présentes dans le code.
4. **Captures et maquettes échangées** : elles établissent des intentions visuelles, pas des états serveur ni des opérations effectives.

**Hiérarchie en cas de divergence :** code et API de la révision réellement vérifiée → contrats métier et décisions versionnées → inventaires documentés → propositions UX spécialisées → maquettes décoratives. Les contradictions entre snapshots doivent faire l'objet d'un relevé et d'une décision, pas d'une fusion silencieuse.

### Portée

- Inclus : Web public FR/EN, suivi privé du commanditaire, administration Web, cohérence des parcours, navigation, couches transversales, ergonomie ordinateur/mobile, pilotage clavier/manette *lorsqu'il est disponible dans le Web*, états et validation.
- Exclus de cette V1 : nouveau moteur de règles, réécriture des API, création d'un LLM de production, application Xbox/Windows native, nouvelles politiques financières, opérations réelles Stripe/SMTP/Meta/LinkedIn, déploiement, nouveaux profils publics routés.
- **Le document ne constitue ni audit de sécurité exécuté, ni compte rendu d'essais de production.** Les sources indiquent elles-mêmes que certaines PR n'étaient pas fusionnées dans `main` à la date de leur inventaire.

## 1. Décision stratégique

**Une même opération métier, un seul propriétaire ; plusieurs raccourcis contextuels possibles.**

La plateforme existe déjà sous forme d'espaces nombreux : 26 routes publiques/localisées, 22 routes administratives et trois outils locaux, soit **51 chemins explicites, alias et variantes inclus** dans l'inventaire. Le principal chantier n'est pas l'ajout de pages : il est de rendre le travail lisible, de préserver la cible lors des changements de contexte et d'aligner chaque commande avec l'organisme qui possède réellement l'action.

### Principes de composition

1. **Comprendre avant d'agir** : état et prochain obstacle visibles sans défilement excessif ; origine et fraîcheur explicites.
2. **Une action primaire par situation** : une recommandation navigue au bon propriétaire. Elle ne se substitue pas au formulaire de validation et ne provoque pas d'effet externe par raccourci.
3. **Une source par fait** : ne pas copier les statuts de paiement, consentement, revue, visibilité, autorisation et livraison dans un « statut global » trompeur.
4. **Action secondaire à la demande** : `Plus`, menus contextuels et tiroirs partagés au lieu de barres multiligne permanentes ; les actions autorisées restent découvrables.
5. **Rôle visible = rôle serveur** : une commande interdite n'est pas une promesse ; la politique API reste souveraine, la présentation doit lui correspondre.
6. **Préparation ≠ exécution** : ouvrir un assistant, préparer un brouillon, modifier un formulaire ou afficher un aperçu n'autorise ni envoi ni publication.
7. **Conserver la position** : dossier, onglet, prestation, livraison, filtre, page et focus restaurés lorsque la navigation est réellement réversible.
8. **Aucun écran ne ment par omission** : distinguer vide confirmé, chargement, erreur, accès interdit, données anciennes, simulation, résultat incertain et état réel.
9. **Une esthétique qui sert l'action** : thème clair premium OpenG7, accents bleu marine et or ; dragon / identité canadienne non intrusifs, jamais aux dépens du contraste, de la taille des cibles ou de l'espace métier.

## 2. Carte des responsabilités : source → rôle → surface → conséquence

| Objet / question de l'utilisateur | Surface propriétaire inventoriée | Accès secondaires permis | À ne jamais confondre |
| --- | --- | --- | --- |
| Faire une contribution personnelle | `/fonds-des-batisseurs` + Checkout externe | Retour Checkout, support | Retour navigateur ≠ paiement confirmé |
| Souscrire une commandite | Formulaire de contribution + offre serveur figée | Suivi privé, dossier admin | Paiement ≠ offre rétroactivement remaniable |
| Corriger identité / pièces fournies | Suivi privé commanditaire, ou `Fiche et médias` selon rôle | Assistant, prochain point | Correction admin ≠ soumission effective du commanditaire |
| Accorder consentement / droits média | Suivi privé et éditeurs de droits appropriés | Revue des médias, publication | Droits d'usage ≠ média approuvé ni fiche visible |
| Examiner la commandite | Barre de revue du dossier et workflow serveur | À traiter, Pilotage | Revue du commanditaire ≠ décision de modération éditoriale |
| Modérer une version de contenu | Service et panneau transversal de modération | **Bouton dans l'en-tête du dossier** (préférence V1), livraisons/médias | Choix de mesure ≠ validation de la commandite |
| Préparer/approuver un dossier | Fiche de préparation partagée | Campagnes, Guide | Préparation approuvée ≠ publication |
| Qualifier l'accord / les prestations | Engagements du dossier ; Campagnes pour détail par prestation | Fiche de préparation, Qualité | Offre historique ≠ barème actuel |
| Exposer une fiche sur le Web | Publication du dossier / visibilité Web | Annuaire public (lecture) | Statut social déclaré ≠ visibilité Web |
| Préparer, autoriser et suivre un post | Brouillons, lots, calendrier, **automatisation**, tiroir de livraison partagé | Publication du dossier / Pilotage | Brouillon ≠ autorisation ≠ preuve d'envoi |
| Lire la preuve d'une prestation | Campagnes et ses obligations/preuves ; audit local si autorisé | Dossier, Qualité portefeuille (owner) | Déclaration « publié » ≠ preuve qualifiée |
| Gérer factures/avoirs | `/admin/fundraiser/invoices` et Finances du dossier | Inspecteur, file courriel | Document émis ≠ mail remis |
| Rembourser | Finances/dossier, workflow Stripe propriétaire | Pilotage si parcours autorisé | Demande ≠ remboursement confirmé, avoir distinct |
| Gérer allocations / transparence | Dépenses/allocations (édition) ; Transparence (lecture) | Transparence publique | Allocation publiée ≠ avancement réalisé |
| Réconcilier les courriels | File courriel | Messages d'échec contextuels | Mise en file ≠ réception |
| Comprendre l'état global | Cockpit | À traiter, Pilotage, Assistant, Configuration | Santé technique ≠ parcours client réussi |
| Contrôler la qualité du portefeuille | Qualité des commandites (owner) | Retour depuis audit local | Audit du dossier ≠ audit global |
| Lire les événements | Historique local / Journal administratif | Inspecteur | Note synthétique ≠ intervention datée ≠ événement d'audit |

**Règle d'implémentation** : les boutons situés hors de leur surface propriétaire n'exécutent pas de mutation directe. Ils ouvrent la route ou le tiroir existant en transférant les identifiants stables requis ; la page de destination réévalue droits, versions et préconditions.

## 3. Architecture cible de l'expérience administrative

### 3.1 Quatre portes d'entrée distinctes

- **Cockpit `/admin/fundraiser` — OBSERVER** : santé, indicateurs, anomalies et raccourcis ; pas de console de mutation reconstituée.
- **À traiter `/admin/fundraiser/attention` — PRIORISER** : file déterministe des problèmes, raisons, échéances et destination propriétaire ; pas de second moteur métier.
- **Poste de pilotage `/admin/fundraiser/pilotage` — DÉCIDER** : une décision à la fois, conséquences, confirmation et reçu, avec clavier/manette en alternative de saisie.
- **Assistant `/admin/fundraiser/assistant` — COMPRENDRE ET PRÉPARER** : faits, explications et brouillons privés ; la conversation est actuellement décrite en modes `disabled`/`mock`, non comme un LLM de production.

L'en-tête de chaque espace doit porter un sous-titre de rôle explicite (`Observer`, `Prioriser`, `Décider`, `Préparer`), sans inventer de nouvelles routes ou permissions. Chaque élément affiché qui exige une intervention propose un lien profond et documenté vers le domaine propriétaire.

### 3.2 Barre commune et espace utile

Réutiliser `AdminLayout` : navigation latérale, recherche Ctrl/⌘ K, indicateur d'identité, activité, Assistant et accès au Guide. Ne pas dupliquer la barre globale dans chaque page. S'assurer qu'un élément critique ne disparaisse pas derrière le contrôleur de manette, un tiroir ou une barre sticky de décision.

Sous écran Windows **1920×1080 à 125 %**, le viewport CSS attendu est proche de **1536×864** *si le navigateur et le zoom n'ajoutent pas une autre mise à l'échelle*. Tester et mesurer le viewport réel dans Playwright, plutôt que figer cette hypothèse. La combinaison navigation globale (~15rem), liste dossier (~14rem) et tiroir de 40rem peut réduire l'espace utile ; préférer une superposition contextuelle avec retour de focus, pas une troisième colonne permanente. Une bannière de dragon doit être compacte ou repliable.

### 3.3 Contrat des tiroirs et surcouches

Créer **une convention d'usage**, pas un nouveau composant remplaçant les contrôleurs existants :

| Type | Fonction | Priorité de fermeture |
| --- | --- | --- |
| Inspecteur | Lecture exacte d'un objet/preuve/document | Ferme sans mutation, retourne au déclencheur |
| Outil contextuel | Modération, édition, suivi, accès, aide | Peut conserver brouillon/requête ; fermeture parfois bloquée |
| Confirmation | Cible, version, conséquence, accord humain | Prioritaire sur outil/inspecteur ; annuler n'émet rien |
| Opération en cours | Requête mutation, autorisation externe | Empêcher fermeture/rejeu non sûr ; résultat incertain à réconcilier |

Clavier et manette : ordre d'ouverture, `Escape` et retour au neutre ; ne jamais fermer une confirmation en activant l'outil sous-jacent. Conserver les requêtes idempotentes pendant un changement de sous-outil lorsqu'il est permis.

## 4. Modèle unique de guidage, sans moteur de règles supplémentaire

### 4.1 Contrat « Prochaine intervention »

Un seul objet de recommandation *provenant de la projection métier existante*, affiché selon les contextes. Structure de présentation cible :

| Champ | Exemple non normatif | Règle |
| --- | --- | --- |
| Domaine | Identité | Ne pas renommer une exigence en erreur technique |
| État | À compléter | Texte + couleur ; état chargé ou périmé précisé |
| Motif | Courriel du contact manquant | Origine API/projection, aucune inférence IA présentée comme fait |
| Responsable | Commanditaire / opérateur / propriétaire / système | N'afficher que si établi, sinon « À déterminer » |
| CTA | Ouvrir l'identité | Navigation ou focus uniquement |
| Suite attendue | Poursuivre l'examen | Pas de garantie de publication si d'autres préconditions existent |

Dans un même dossier, pas de double carte « prochaine action » sous prétexte que Guide, Assistant et bandeau sont ouverts. Le Guide explique ; la projection de progression expose des jalons ; la fiche de préparation évalue sa propre version ; l'Assistant peut proposer. **Aucun de ces éléments n'accorde les droits ou la décision d'un autre.**

### 4.2 Blocages et état transversal

Rendre jusqu'à **trois familles de blocages** visibles en aperçu, et un accès « Tout voir » pour le reste. L'existence et la nature des blocages proviennent des contrôles propriétaires. Un canal non promis = `Non requis`, et non « Bloqué ». Un champ incomplet de soumission privée ne devient pas une erreur Stripe. Exposer « Données anciennes » plutôt que faire comme si la relecture avait réussi.

### 4.3 Vocabulaire de statut

- Faits : `Payé`, `Remboursé`, `En litige` (selon serveur), jamais déduits du navigateur.
- Travail : `À compléter`, `À revoir`, `En attente`, `Bloqué`, `Prêt`, `Approuvé`, `Non requis` selon domaine.
- Observabilité : `Chargement`, `Indisponible`, `Erreur`, `Partiel`, `Données anciennes`, `Résultat incertain`.
- Effet externe : `Brouillon`, `En file`, `Envoyé`/`Publié` *confirmé*, `Simulation` et `À réconcilier` avec leurs définitions métier.

Une couleur ne suffit jamais. Pour les statuts « Publié » et « Livré », afficher la source et la portée de preuve lorsqu'elles existent.

## 5. Parcours cibles de bout en bout

### P-A — Contribution personnelle

`Accueil → Formulaire → Offre/conditions appropriées → Checkout → Retour informatif → Confirmation serveur → Transparence/support`.

UX cible : séparer dès l'écran de retour les états « reçu », « en cours de vérification », « confirmé », « annulé » et « erreur ». Pas de faux « payé » basé sur l'URL. Une lecture publique ne révèle pas de données non consenties. Critère : un retour Checkout sans confirmation n'augmente aucun compteur de paiements confirmés dans l'UI.

### P-B — Commandite Web/social

`Accueil → Offre contractuelle versionnée → Checkout → Accès privé → Identité/consentements/médias → Revue humaine → Préparation approuvée → Décision de visibilité Web / autorisation sociale → Livraison → Preuve`.

UX cible : permettre au commanditaire de comprendre **ce qui est attendu de lui** et au gestionnaire de savoir **ce qu'il est autorisé à faire**. Les canaux/cibles ne sont affichés comme obligations que s'ils figurent à l'offre acceptée ou à une qualification historique justifiée. Critères : la mise à jour du barème courant n'ajoute aucun engagement ancien ; droits d'utilisation, validation média et sélection Web demeurent distincts ; publication sociale requiert un contenu et horaire exacts.

### P-C — Dossier commanditaire administrateur

`À traiter / registre → Dossier → En-tête compact + états indépendants → Action recommandée → Propriétaire de la correction → Retour au dossier → Nouvelle projection`.

Conserver les **cinq onglets** `overview`, `identity`, `publication`, `billing`, `audit` et les alias `media`, `refund`. Dans `Fiche et médias`, distinguer identité/soumission et revue média en sous-sections sans sixième onglet. La modération doit être disponible sous forme d'un **bouton identifiable dans l'en-tête** pour les rôles autorisés, ouvrant le panneau transversal existant `DOS-C` pour le sujet/version exacts, sans rendre la modération égale à la revue du dossier. Voir le blueprint spécialisé V2 pour les `DOS-*`.

### P-D — Publication et engagements

`Dossier Publication (synthèse) → Campagnes (prestations/échéance/preuve) → Brouillon source → Lot/créneau éventuel → Automatisation (livraison exacte) → Confirmation → Résultat externe / réconciliation`.

Réutiliser le tiroir de livraison et l'organisme de préparation. Afficher explicitement les libellés « Prestations promises », « Préparation », « Visibilité Web », « Livraison sociale ». Éviter que la section Publication du dossier réimplémente Campagnes ou le moteur automatique. Critère : toute action de publication navigue au détenteur de l'autorisation et ne s'exécute pas depuis un résumé.

### P-E — Incident / argent / courriel

`Cockpit ou À traiter → Objet exact → Inspecteur → Propriétaire (Stripe, factures, remboursement, file) → Confirmation → Reçu → Audit`.

Les états incertains interdisent les nouvelles tentatives non réconciliées ; conserver l'identifiant de requête. Une facture émise reste un snapshot, un remboursement confirmé ne prouve pas l'envoi de l'avoir. Présenter la raison des droits insuffisants et, si approprié, une destination en lecture seule ; ne pas masquer une erreur financière derrière un libellé d'interface.

## 6. Changements proposés par espace — inventaire de lacunes

**Nature des entrées :** `P` = proposition UX ; `É` = écart potentiel explicitement signalé par la source ; `V` = vérification requise. Aucun `É` n'est décrit comme une faille exploitée ou un défaut de production prouvé.

| ID | Source / route | Nature et observation | Proposition précise | Critère de réception |
| --- | --- | --- | --- | --- |
| UX-01 | Shell admin + quatre portes | P : modes proches peu distincts par leur titre | Sous-titre Observer / Prioriser / Décider / Préparer + libellés de navigation | Test de navigation depuis chaque type de tâche sans mutation hors propriétaire |
| UX-02 | `/admin/fundraiser/sponsors` | P : densité des commandes | En-tête compact, bouton de modération explicite, secondaires dans `Plus` en conservant actions selon rôle | Aucune action autorisée perdue ; ouverture/retour au même dossier |
| UX-03 | `overview` du dossier | P : faits et guidage dispersés | Une carte de prochaine intervention et familles de blocages liées aux propriétaires | Une seule priorité dérivée, aucun clic ne publie |
| UX-04 | `identity` du dossier | P : identité et revue des médias de natures distinctes | Sous-sections claires, `tab=media` conservé et focus galerie | Alias, droits, manifestes et analyses intacts |
| UX-05 | Publication du dossier + Campagnes | P : plusieurs niveaux de lecture des prestations | Synthèse au dossier, détail des engagements/proof à Campagnes, livraison à l'automate | Aucune preuve ni obligation copiée dans un second workflow |
| UX-06 | Fiche modération | P : choix de mesure peut paraître décision acquise | Libellé « Préparer l'examen », snapshot de version, étape confirmation | Un choix local ne modifie rien sans serveur et confirmation |
| UX-07 | `/admin/fundraiser/invoices` | **É** : génération présentée potentiellement à `operator` (`canManage`) tandis que backfill est réservé au propriétaire selon contrat cité | Faire dépendre visibilité/état de la capacité exacte et expliquer lecture seule | `reader/operator/owner` cohérents avec réponse API, y compris 403 |
| UX-08 | `/admin/fundraiser/expenses` | **É** : formulaires rendus sans garde-fou global de rôle dans le template | Désactiver/masquer commandes non autorisées selon capacités, conserver API | Opérateur voit une lecture appropriée sans mutation trompeuse |
| UX-09 | Assistant | **É** : conversation décrite `disabled`/`mock`, aucun LLM externe connecté | Indiquer « simulation » ou « indisponible » honnêtement ; ne pas vendre l'IA comme décisionnaire | Aucun écran ne qualifie une sortie mock de conseil réel généré |
| UX-10 | Médias | **É** : analyse technique Sharp présente, vision/OCR `not_configured` | États de capacité détaillés et chemin manuel de revue | L'administrateur peut réviser sans halluciner une classification IA |
| UX-11 | Contrôle et surcouches | P : contrôleurs, sticky bar et drawers coexistent | Politique de couches, focus et espace réservé | Escape/retour focus et action sensible accessibles à 1536×864 |
| UX-12 | Web public FR/EN et musique | **V** : normalisation de `/en/music` et `/en/boutique` citée à vérifier | Test ciblé des déclenchements audio par route/langue | Même règle produit sur route FR et équivalent EN |
| UX-13 | Transparence publique | P : montants, provenances et dates importantes | Homogénéiser indicateurs de fraîcheur, données manquantes, sources | Indisponible ≠ 0 ; déclaration ≠ preuve |
| UX-14 | Support et suivi privé | P : récupération + différentes sources d'état | CTA d'étape propriétaire et messages de résultat sobres | Aucun token privé dans URL persistante ; pas d'affichage nominatif public |
| UX-15 | Publications automatiques | P : autorisation et résultats externes complexes | En-tête de statut exact, source, blocage et réconciliation | Un `uncertain` ne rejoue pas un post ; mode mock explicite |
| UX-16 | Page Qualité | P : audit portefeuille distinct | Conserver périmètre owner et retour contextualisé | Audit global jamais implicite dans dossier local |
| UX-17 | Bundle Web initial | **É** : budget d'avertissement 800 ko dépassé par 898,39 ko dans l'inventaire | Analyse du bundle, lazy-loading par module si faisable ; pas de refonte prématurée | Build sous budget d'avertissement visé **ou** écart documenté ; mesure comparative |
| UX-18 | Pilotage manette | **V** : tests simulateur ≠ périphérique physique | Matrice focus/confirmations, essai USB réel séparé | Aucun succès « manette physique » annoncé avant essai |

## 7. Livrables de conception partagés

### 7.1 Contrat de navigation

Les liens profonds doivent préserver **l'identifiant exact** et éviter une sélection arbitraire :

- Dossier : `sponsorshipId`, `tab` (`overview` / `identity` / `publication` / `billing` / `audit`), fragment propriétaire ; `media`/`refund` acceptés.
- Assistant : `/admin/fundraiser/assistant?sponsorshipId=<id>` ; préparer n'envoie pas.
- Prestations : `/admin/fundraiser/campaigns?sponsorshipId=<id>` ; `obligationId` seulement s'il est connu.
- Livraison : `/admin/fundraiser/publications/automation?sponsorshipId=<id>&deliveryId=<id>` lorsque connu ; sans `deliveryId`, sélectionner explicitement.
- Facture : `/admin/fundraiser/invoices?contributionId=<id>` ; message : `/admin/fundraiser/email-queue?messageId=<id>`.
- Qualité : `/admin/fundraiser/sponsors/quality?returnSponsorshipId=<id>` dans le parcours décrit.

Ces modèles sont documentés dans le blueprint spécialisé ; leur présence dans le code actuel doit être contrôlée sur la révision de travail réelle. Le retour doit restaurer l'onglet, le focus et, quand le contrôleur le permet, la recherche/pagination, sans attribuer à l'URL une persistance qu'elle n'assure pas.

### 7.2 Contrat visuel « premium fonctionnel »

- Couleurs : fond blanc/gris très clair ; textes bleu marine ; accents or seulement pour action recommandée ; rouge pour blocage réel, vert pour fait confirmé.
- Typographie : titre de dossier 24–28 px CSS selon place, contenu principal 15–16 px, aides ≥ 13–14 px ; vérifier rendu et zoom, pas figer le design par dimensions absolues.
- Écartements : famille de tokens Tailwind/CSS du projet ; 8/12/16/24 px comme base selon densité. Les boutons prioritaires ont une surface suffisamment grande pour clic et manette.
- Bannière OpenG7/dragon : intégrée au shell en décor limité ; ne doit pas pousser la prochaine action hors de la première hauteur d'écran 1536×864 CSS.
- Colonnes : liste compacte seulement à largeur suffisante ; un volet latéral recouvre ou remplace une zone plutôt que de réduire le contenu à un ruban illisible.
- Badges : libellés textuels nécessaires ; couleur ne porte jamais seule un fait financier ou une autorisation.
- Cibles focus visibles ; tests WCAG AA à effectuer sur les combinaisons réelles.

### 7.3 État visuel standard d'un bloc de données

Chaque widget qui charge des données distantes expose les états pertinents parmi : `initial`, `loading`, `ready`, `empty_confirmed`, `stale`, `partial`, `forbidden`, `unavailable`, `error`, `pending_mutation`, `conflict`, `uncertain`. Cette nomenclature est **une convention de présentation** à mapper aux états existants, pas un nouvel enum API imposé. Une action de relance n'est offerte que si sa portée et son idempotence sont définies.

## 8. Plan de réalisation incrémental

| Lot | Risque | Portée | Sortie attendue | Validation minimale |
| --- | --- | --- | --- | --- |
| **0 — Inventaire et preuves** | Faible | Comparer snapshot `9bd...` / code actif / Dossier V2 ; captures par rôle et tailles | Registre « constat / source / divergence / propriétaire / test » | Aucun changement métier, rapport d'écarts signé |
| **1 — Alignement permissions et statut** | Moyen | `invoices`, `expenses`, statuses mock/incident | Présentation cohérente avec capacités API ; libellés exacts | Tests rôles, refus 403, source indisponible |
| **2 — Coquille et navigation** | Moyen | `AdminLayout`, Cockpit, À traiter, Pilotage, Assistant, couche commune | Quatre modes lisibles ; convention focus/tiroirs | Navigation clavier, retour, 1536×864 + mobile |
| **3 — Dossier de commandite V2** | Moyen | `DOS-T/O/I/M/P/F`, NextStep, Progress, boutons contextuels | En-tête compact, bouton modération, action principale, sous-sections identité/médias | Tests d'invariants, alias, version, décision |
| **4 — Publications et engagements** | Élevé | Campagnes, Publication, brouillons, lots, calendrier, automate | Liens contextuels, responsabilité unique, statut fournisseur exact | Scénarios de simulation et issues incertaines |
| **5 — Parcours publics et suivi privé** | Moyen | Contribution, retour Checkout, suivi, support, annuaires, transparence | États visibles, navigation FR/EN harmonisée | Autorisation/consentement, mobile, paiement non présumé |
| **6 — Évaluation de bout en bout** | Élevé | Tests E2E d'intégration, accessibilité, rendu, performance | Mesures vérifiées, dettes et limitations documentées | Tests en environnement autorisé ; aucune action live accidentelle |

**Ne pas commencer le lot 3 avant le lot 0** : le plan directeur a été écrit pour la révision `b00ad2b2`, tandis que la V2 spécialisée découle d'un autre snapshot de travail. La réconciliation est nécessaire pour éviter de réimplémenter une extraction déjà livrée ou de réintroduire un panneau retiré.

### Ordre de priorité P0/P1/P2

- **P0** : droits présentés ≠ API, actions à effets externes, protection des versions, résultats incertains, honnêteté simulation/production.
- **P1** : clarté des quatre modes, barre dossier et bouton modération en en-tête, action principale, séparation identité/médias, publication/dossier/Campagnes.
- **P2** : harmonisation de la marque et micro-interactions, contenu public secondaire, optimisation visuelle et audits non bloquants.

## 9. Scénarios d'acceptation transversaux

| ID | Scénario | Résultat attendu |
| --- | --- | --- |
| QA-01 | Paiement confirmé, identité manquante | `Payé` visible ; `À compléter` indépendant ; pas de revue automatique |
| QA-02 | Correction admin de raison sociale | Ne simule pas `sponsor_details_submitted_at` |
| QA-03 | Offre Web sans Facebook/LinkedIn | Aucun blocage social artificiel ; `Non requis` si pertinent |
| QA-04 | Commanditaire lecteur | Peut consulter données autorisées ; aucune mutation offerte comme active |
| QA-05 | Opérateur face à backfill facture owner-only | Action non offerte / explicitement réservée ; API 403 reste sûr |
| QA-06 | Modération depuis en-tête | Sujet/version exacts, outil partagé, puis confirmation ; revue commandite inchangée |
| QA-07 | Publication Web et sociale | Approbation préparation ne publie ni Web ni post ; actes séparés |
| QA-08 | Livraison externe incertaine | Quarantaine/réconciliation ; pas de nouvel envoi aveugle |
| QA-09 | Courriel mis en file | Libellé `En file`, jamais `Reçu` sans fait fournisseur |
| QA-10 | Remboursement initié | Owner, montant/version/confirmation ; preuve Stripe/avoir/courriel séparées |
| QA-11 | Retour Assistant/Campagnes → dossier | Identifiant, onglet, fragment, focus conservés lorsque supportés |
| QA-12 | Écran 1536×864 CSS | Prochaine action accessible, bouton modération visible, pas de recouvrement décision/tiroir |
| QA-13 | Mobile 390px | Liste accessible, tiroirs plein écran, actions/fermeture au clavier/focus |
| QA-14 | Mode FR puis EN | Étiquettes, navigation, règles audio et destinations équivalentes testées |
| QA-15 | Assistant mock/désactivé | Simulation ou indisponibilité explicitement indiquée ; pas de fausse IA « active » |
| QA-16 | Perte réseau pendant une mutation | Résultat affiché incertain ; aucun bouton de renvoi dangereux |

Tests déjà rapportés **dans l'inventaire**, non réexécutés ici : `yarn test` 7 202 réussis / 8 ignorés ; 29 tests Playwright ciblés avec données synthétiques ; build Angular réussi avec avertissement initial à 898,39 ko versus budget 800 ko. Ces preuves ne valident ni publication live, ni SMTP live, ni manette physique, ni restauration réelle d'une sauvegarde.

## 10. Mesures de progrès à instrumenter (sans inventer de valeurs actuelles)

- Temps médian avant identification de la **prochaine intervention** dans un dossier.
- Nombre d'interactions pour rejoindre le formulaire propriétaire depuis une alerte.
- Pourcentage de tâches dont la raison, le responsable et l'état sont réellement disponibles.
- Taux d'erreurs de navigation/retour de contexte ; événements de focus perdu.
- Nombre de commandes présentées mais refusées systématiquement par un rôle API (après déduction des refus contextuels légitimes).
- Part des états « simulation », « données anciennes » ou « résultat incertain » correctement identifiés par les utilisateurs lors de tests.
- Poids du bundle initial, temps de chargement, décalage visuel et accessibilité par scénario/viewport.

**Mesure avant/après obligatoire** : ne pas promettre un pourcentage d'amélioration avant la collecte de la référence.

## 11. Dépendances et questions ouvertes à vérifier

1. **Code en cours** : préciser la branche et la révision qui doivent recevoir les travaux ; comparer la structure et les PR 347/348 avant de reprendre un outil retiré.
2. **Rôles exacts** : exposer côté UI les capacités précises déjà calculées par l'API ; éviter un calcul générique `canManage` quand `owner` est requis.
3. **Modération** : confirmer le déclencheur d'en-tête présent dans `b00ad2b2` et son comportement réel ; si le code actif diffère, rétablir une entrée explicite sans second panneau de décision.
4. **Assistant** : vérifier état des fournisseurs/flags, ne pas présumer de conversation LLM disponible.
5. **Intégrations** : confirmer mode réel/simulé de chaque service externe avant tests ; préserver les environnements live.
6. **Navigation** : définir pour chaque raccourci les IDs réellement connus et le mode de retour (route, onglet, fragment, sélection/focus).
7. **Charte graphique** : vérifier licences et poids des illustrations avant toute bannière OpenG7 à usage administratif.
8. **Responsive / manette** : vérifier la taille du viewport CSS et un essai sur matériel réel indépendamment des tests simulés.

## 12. Décision de conception et prochaine PR

**Proposition de première PR : « Admin UX — aligner droits, états et points d'entrée »** :

- Documenter l'état réel et les écarts de code (`lot 0`).
- Aligner l'interface Factures et Dépenses sur les capacités serveur (`UX-07`, `UX-08`).
- Afficher honnêtement `mock`, `disabled`, `unknown`, `stale`, `uncertain` là où cela s'applique (`UX-09`, `UX-10`, `UX-15`).
- Tester et documenter les parcours sans modifier les décisions métier ou déclencher d'effet externe.

Puis **PR 2** pour le shell et **PR 3** pour le dossier V2, bouton de modération compris. Les autres lots progressent une fois les invariants vérifiés.

---

**Conclusion :** ne pas reconstruire OpenG7 Funding Platform. **Unifier la lecture et l'orientation du travail autour des organismes existants**, tout en préservant les faits financiers, la volonté du commanditaire, la responsabilité humaine, les versions et les preuves. Cette V1 sert de pont entre le plan directeur (état inventorié), les blueprints spécialisés (détails métier) et les futures PR d'implémentation.
