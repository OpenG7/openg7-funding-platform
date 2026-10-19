# Blueprint du Guide administratif

Inventaire initial au **18 octobre 2026**, révision `bc593f7f`. Ce document décrit
les surfaces, leurs responsabilités et les séparations proposées. L'évolution
appliquée de G-A06 et le retrait des propositions futures de G-W10 sont signalés
ci-dessous ; les autres propositions restent à
réaliser. Aucune opération métier décrite n'est exécutée par l'analyse. Vue d’ensemble :
[blueprint transversal](admin-operations-blueprint.md).

Les libellés de cet inventaire daté se lisent désormais avec le
[vocabulaire harmonisé des opérations](../technical/admin-campaigns.md#vocabulaire-des-operations) :
fiche de préparation, approbation de préparation et vérification du lot. Le
rapport emploie **Préparer ce dossier** pour annoncer la préparation ciblée.

## Périmètre et vocabulaire

Le mot « Guide » recouvre deux interfaces différentes :

- **Mode guidé** : une carte flottante non modale du layout administratif. Ses
  quatre sélecteurs de mode donnent accès à la découverte, au parcours d’un
  paiement, au traitement automatique et aux six parcours de lecture.
- **Guide pas à pas** : un véritable élément `dialog`, ouvert par `showModal()`,
  dans le poste de pilotage et dans **Ma semaine**. Il bloque l’interaction avec
  l’écran de fond pendant la visite.

La distinction compte : le premier contient aujourd’hui des opérations métier et
des données privées ; le second sert à expliquer des commandes. Le dialogue de
réconciliation et les confirmations de préparation sont encore d’autres dialogues,
ouverts depuis le mode Automatique.

Sources propriétaires : [layout](../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.ts),
[carte et modes](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.html),
[guide modal](../../apps/funding-web/src/app/features/funding/components/admin-guide/admin-guide.component.ts),
[runbook](../operations/admin-pilotage.md#guides-interactifs).

Les identifiants `G-*` ci-dessous servent à discuter du rangement. Ils ne sont pas
des identifiants de commandes en production. **L** = lecture/requête sans mutation
métier ; **N** = navigation ; **P** = présentation ou préparation d’une interface ;
**M** = écriture serveur ; **B** = préférence ou repère du navigateur. Une action
peut porter plusieurs effets. Le rôle indiqué décrit la politique actuelle ; la
validation de l’API reste obligatoire.

## Carte des zones actuelles

```text
Layout administratif
├─ Mode guidé : carte flottante, non modale
│  ├─ Barre : ouvrir/réduire, position, rubrique
│  ├─ Découvrir les rubriques : 3 repères par page
│  ├─ Parcours du paiement : prochaine responsabilité + jalons
│  ├─ Six parcours : choix → étape → zone du dossier
│  ├─ Automatique
│  │  ├─ Carrousel → bon partagé → commandes/confirmations
│  │  ├─ Suivi du lot → lecture → contrôle → résultat → bilan
│  │  ├─ Rapport → entrées → preuves et préparation ciblée
│  │  └─ Autre préparation → paiement/rubrique → propriétaire
│  └─ Confidentialité et effacement du repère flottant
└─ Poste de pilotage / Ma semaine
   └─ Guide pas à pas : dialogue modal et progression distincte
```

<!-- prettier-ignore -->
| Zone | Responsabilité actuelle | Données et dépendances | Multipérimètre ? |
| --------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| G-Z01 · Barre du guide | Ouvrir/réduire la carte, déplacer haut/bas, rappeler la rubrique | Layout, route, préférence d’activation | Non, présentation commune |
| G-Z02 · Choix des quatre modes | Sélectionner une activité conservée dans le navigateur | `AdminGuidanceService` | Oui : aide à la lecture, suivi métier, exécution de lot et préparation |
| G-Z03 · Découvrir les rubriques | Expliquer trois repères de la rubrique courante | Catalogue de 20 rubriques et cibles DOM fixes | Périmètre cohérent d’aide contextuelle |
| G-Z04 · Repère sauvegardé | Reprendre une lecture, ici ou dans sa rubrique d’origine | Repère page/étape/pause par compte | Non |
| G-Z05 · Parcours du paiement | Lire la prochaine responsabilité calculée par le serveur et tous les jalons | UUID suivi, projection privée et destination serveur | Suivi d’un dossier, distinct de la découverte de l’interface |
| G-Z06 · Six parcours | Explorer librement les étapes du dossier, mettre les zones en évidence | Catalogue statique, dossier en onglet Publication | **Allégé** : lecture actuelle uniquement ; propositions futures conservées dans le blueprint |
| G-Z07 · Automatique / carrousel | Consulter un bon courant dans une liste figée, accéder aux décisions du bon | Manifeste de passage, bon versionné, assistance locale | Dossier individuel hébergé dans un outil de lot |
| G-Z08 · Automatique / Suivi du lot | Démarrer, interrompre, reprendre et contrôler un passage | Commandes serveur, progression, points de lecture | Traitement opérationnel, pas uniquement un guide |
| G-Z09 · Automatique / bilan et rapport | Consulter observations, engagements, preuves et références d’audit | Rapport durable paginé, avant/après et montants par devise | Lecture de lot cohérente ; voisinage ambigu avec les commandes de préparation |
| G-Z10 · Automatique / autre préparation | Naviguer vers un paiement ou une rubrique et ouvrir les préparations déclarées | Registre de préparations des composants propriétaires | Orchestration transversale de tâches distincte du lot |
| G-Z11 · Confidentialité et effacement | Expliquer et effacer les repères locaux | `localStorage` avec repli mémoire | Texte actuel incomplet pour le mode Six parcours, voir constats |
| G-Z12 · Guide pas à pas | Présenter un repère à la fois sous interaction modale | Catalogue Pilotage/Ma semaine, progression locale séparée | Même finalité pédagogique que G-Z03, moteur différent |
| G-Z13 · Confirmation de réconciliation | Confirmer la vérification d’un résultat incertain sans rejouer l’action | Dialogue natif local au rapport de lot | Confirmation sensible réimplémentée localement |

### Barre commune et préférences

La carte n’existe que sur une route déclarée et avec un contexte administratif
disponible après rendu navigateur. Elle n’a pas le rôle de sécurité d’un guard.
Découverte est le mode par défaut ; Automatique et Six parcours se chargent
dynamiquement. L’échec de leur chargement laisse un message dédié ; aucun bouton de
réessai local n’est présent dans cet état. Les repères appartiennent au compte
OIDC ; le mode token utilise un compte local partagé.

<!-- prettier-ignore -->
| ID | Contrôle visible | Responsabilité / effet | Condition et propriétaire |
| ----- | -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| G-C01 | **Mode guidé** / **Réduire le guide** | Afficher ou masquer la carte ; conserver son mode et ses repères, B/P | `guidance.toggle()` ; réduire interrompt le conducteur automatique actif |
| G-C02 | **Placer en bas** / **Placer en haut** | Déplacer la carte et retirer la surbrillance en cours, P | Carte ouverte ; `moveCard()` ; position conservée pendant la vie du composant |
| G-C03 | **Découvrir les rubriques** | Sélectionner l’aide à la lecture de la page, B/P | `setMode('discovery')` |
| G-C04 | **Parcours du paiement** | Sélectionner le suivi métier d’un UUID, B/L | `setMode('payment')` ; la lecture n’a lieu que pour un paiement suivi et non en pause |
| G-C05 | **Automatique** | Monter le composant du lot et de préparation ; relire le passage existant, B/P/L | `setMode('automatic')` ; ouvrir ce mode ne démarre pas un passage |
| G-C06 | **Six parcours** | Monter l’explorateur de parcours, B/P | `setMode('workflows')` |
| G-C07 | Déplier le texte de confidentialité | Lire les limites du stockage et l’avertissement du mode token, P | `details` commun aux quatre modes |
| G-C08 | **Effacer mon repère** | Réinitialiser et masquer le guide local ; tenter d’effacer la clé du compte, B | `guidance.forget()` ; échec d’effacement signalé séparément |

État local : `og7-admin-guidance:v1:<compte>`. Il conserve activation, mode,
rubrique/étape/pause, UUID du paiement/pause et parcours interactif/étape/pause.
Il ne conserve pas les faits ou le rapport métier.
[Contrat du stockage](../../apps/funding-web/src/app/features/funding/services/admin-guidance-state.ts)
et [service de présentation](../../apps/funding-web/src/app/features/funding/services/admin-guidance.service.ts).

## Mode Découvrir les rubriques

La même structure est appliquée à chaque page : **read**, **choose**, **verify**.
Le catalogue choisit les zones montrées ; il ne définit aucune action métier.
L’absence d’une cible prévue affiche un avertissement. Dans ce mode, la
surbrillance peut retomber sur le contenu principal ; ce repli ne sélectionne pas
automatiquement de dossier.

<!-- prettier-ignore -->
| ID | Zone/action | Responsabilité / effet | Condition |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| G-D01 | Titre de l’étape et position | Expliquer le repère courant ; annoncer le changement, L/P | Repère non en pause |
| G-D02 | **Me montrer dans la page** | Déplacer le focus, faire défiler et entourer les zones visibles correspondantes, P | Aucune activation de bouton métier ; cibles fixes du catalogue |
| G-D03 | **Étape précédente** | Reculer le repère, B/P | Désactivé à la première étape |
| G-D04 | **Étape suivante** | Avancer le repère, B/P | Avant la dernière étape |
| G-D05 | **Revenir à la première étape** | Recommencer la lecture, B/P | À la dernière étape |
| G-D06 | **Faire une pause** | Conserver page et position ; montrer le bloc de reprise, B/P | L’étape reste mémorisée |
| G-D07 | **Reprendre mon repère** | Rejoindre la route de rubrique sauvegardée, sans anciens paramètres privés, N/B | Repère en pause ou sur une autre rubrique |
| G-D08 | **Continuer ici** | Remplacer le repère par celui de la rubrique courante, B/P | Repère enregistré sur une autre rubrique |

### Repères par page

Préfixe des routes : `/admin/fundraiser`. Les trois colonnes sont les cibles
`data-og7` de **read / choose / verify** ; `—` signifie absence de cible déclarée,
pas absence de texte d’aide. Ce tableau complète G-D01 à G-D08 pour chaque page.

<!-- prettier-ignore -->
| Rubrique / suffixe | Lire | Choisir | Vérifier |
| ------------------------------------------- | ------------------------ | --------------------------- | ----------------------- |
| Tableau de bord · route racine | `cockpit-metrics` | `cockpit-systems` | `cockpit-activity` |
| Poste de pilotage · `/pilotage` | `pilot-summary` | `pilot-details` | `pilot-receipt` |
| Accès · `/access` | `admin-access` | — | — |
| Attention · `/attention` | `attention-panel` | `attention-items` | — |
| Assistant · `/assistant` | `assistant-summary` | `assistant-recommendations` | `assistant-state` |
| Contributions · `/contributions` | `contributions-list` | `contribution-row` | — |
| Commandites · `/sponsors` | — | `sponsorship-dossier` | — |
| Qualité des commandites · `/sponsors/quality` | `sponsors-quality-page` | `commitments-adoption` | `historical-evidence-audit` |
| Campagnes · `/campaigns` | `campaigns-page` | `campaigns-filters` | `campaigns-list` |
| Factures · `/invoices` | `invoice-selection` | — | — |
| Publications · `/publications` | `publications-page` | `publication-space` | — |
| Brouillons · `/publications/drafts` | `publications-page` | `publication-draft` | — |
| Lots · `/publications/batches` | `publications-page` | `publication-batch` | — |
| Calendrier · `/publications/calendar` | `publications-page` | `publication-slot` | — |
| Automatisation · `/publications/automation` | `publication-automation` | `publication-feed-settings` | — |
| Dépenses · `/expenses` | `allocation-filters` | `allocation-card` | — |
| Transparence · `/transparency` | `transparency-summary` | `transparency-allocations` | `transparency-snapshot` |
| Audit · `/audit` | `admin-audit` | `audit-entry` | — |
| Courriels · `/email-queue` | — | — | — |
| Réglages · `/setup` | `admin-setup` | `setup-checklist` | — |

Source des 20 pages et de leurs 60 étapes :
[catalogue de découverte](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-pages.ts).
Un repère peut entourer plusieurs lignes visibles d’une liste ; il n’identifie
pas alors une prochaine action propre à un dossier.

## Mode Parcours du paiement

Ce mode suit un UUID choisi explicitement ou reçu via `paymentJourney` dans l’URL.
Sur Commandites et Assistant, le contexte est `sponsorshipId` ; sur Contributions
et Factures, `contributionId`. Ouvrir un autre dossier ne remplace pas
silencieusement le paiement suivi. Une recommandation est issue des faits serveur,
avec sa responsabilité administrative ou plateforme ; son ouverture relit les
faits et refuse une recommandation devenue différente.

<!-- prettier-ignore -->
| ID | Zone/action | Responsabilité / effet | Condition / appel |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| G-P01 | **Suivre ce paiement** | Remplacer volontairement l’UUID suivi, B/L | UUID de contexte valide et différent ; `guidance.followPayment()` |
| G-P02 | État, référence et avancement | Présenter les faits courants et le changement détecté, L | Données retirées pendant chargement/erreur ; état complet distinct d’un paiement seulement confirmé |
| G-P03 | Prochaine étape et sa raison | Distinguer intervention humaine et attente de la plateforme, L | Projection serveur `journey.next` |
| G-P04 | **Ouvrir la prochaine étape** / libellé d’attente du suivi | Relire la recommandation puis naviguer vers sa destination admin locale, L/N | `journey.openNext()` ; aucun POST métier |
| G-P05 | **Me montrer dans la page** | Souligner la cible exacte de la recommandation, P | Même page et paramètres de destination, cible présente ; aucun repli sur un dossier étranger |
| G-P06 | **Voir tout le parcours** | Déplier tous les jalons, états et raisons, P/L | Liste informative sans boutons de validation des jalons |
| G-P07 | **Vérifier les faits** | Relire le parcours privé, L | UUID suivi, non en pause ; désactivé pendant lecture |
| G-P08 | **Faire une pause** | Conserver l’UUID et suspendre le suivi, B | `guidance.pausePayment()` |
| G-P09 | **Reprendre ce paiement** | Réactiver le mode et relire les faits avant affichage, B/L | Parcours en pause |

Propriétaires : [vue](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-payment-journey.component.html),
[chargement, revalidation et navigation](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-payment-journey.service.ts).
Lecture : `GET /api/admin/payment-journey?contributionId=<uuid>`, privée et
`no-store`, accessible selon les droits administratifs. Aucun état sauvegardé dans
le navigateur ne remplace la réponse de cet endpoint.

## Mode Six parcours

L’explorateur est une aide de lecture disponible aussi au lecteur. Il exige un
dossier sélectionné sur Commandites avec `tab=publication` pour montrer ses zones.
Il peut ouvrir des éléments `details` mais n’ouvre pas lui-même les commandes de
revue ni les dialogues métier. Un dialogue déjà ouvert garde la priorité et
suspend sa surbrillance. **Évolution appliquée** : les encadrés **Organisation
proposée · à réaliser** sont retirés du produit. Le volet **Emplacement actuel**
reste disponible ; les propositions de réorganisation sont conservées dans ce
blueprint.

<!-- prettier-ignore -->
| ID | Action | Responsabilité / effet | Condition |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| G-W01 | Déplier **Choisir un parcours** | Ouvrir le choix, P | Toujours dans ce mode |
| G-W02 | Choisir l’un des six parcours | Changer le parcours et reprendre à sa première étape, B/P | `guidance.selectWorkflow(id)` |
| G-W03 | Choisir une étape numérotée | Examiner librement cette étape, B/P | Aucun ordre métier imposé par le guide |
| G-W04 | **Ouvrir un dossier de commandite** | Naviguer vers Commandites, onglet Publication, avec le contexte UUID valide s’il existe, N | Absence du contexte de dossier attendu |
| G-W05 | **Étape précédente** | Sélectionner l’étape précédente, B/P | Désactivé au début |
| G-W06 | **Étape suivante** | Sélectionner l’étape suivante, B/P | Désactivé à la fin |
| G-W07 | **Montrer cette zone** | Retenter la révélation et le halo, ouvrir seulement les `details` de présentation nécessaires, P | Contexte disponible, parcours non en pause |
| G-W08 | **Arrêter le parcours** | Mémoriser la pause et retirer la surbrillance, B/P | Ne ferme pas les formulaires du dossier |
| G-W09 | **Reprendre le parcours** | Retirer la pause et montrer l’étape courante, B/P | Parcours en pause |
| G-W10 | Déplier **Emplacement actuel** | Consulter le repère de l'écran actuel, P/L ; propositions futures retirées de l'aide produit. | Aucune transformation du dossier |

### Chaque parcours et chaque étape

Les 21 étapes ont toutes les mêmes trois zones : titre, **Action à examiner** et
**Résultat attendu**. Le tableau donne la responsabilité pédagogique de chaque
étape et ses cibles actuelles. Les verbes de la colonne responsabilité décrivent
l’opération expliquée, qui reste à effectuer volontairement dans son propriétaire.

<!-- prettier-ignore -->
| ID d’étape | Responsabilité expliquée | Zones ciblées dans le dossier |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| G-W-agreement-pilot | Identifier le contrôle des publications promises | `preparation-pilot` |
| G-W-agreement-source | Lire/documenter la source d’origine versionnée | `assistance-source-form`, `assistance-source-view` |
| G-W-agreement-proposal | Comparer la proposition locale à sa source | `assistance-suggestion` |
| G-W-agreement-qualification | Documenter les prestations et leurs correspondances | `commitments-qualification` |
| G-W-agreement-confirm | Relire et confirmer explicitement les prestations | `commitments-qualify`, `commitments-confirmation` |
| G-W-preparation-obligations | Lire la synthèse, puis ouvrir Campagnes pour les prestations détaillées | `publication-obligations` |
| G-W-preparation-prepare | Repérer la commande de préparation d’un canal | `publication-prepare` |
| G-W-preparation-draft | Examiner l’état du brouillon préparé | `publication-channel` |
| G-W-authorization-review | Repérer l’accès volontaire au tiroir de revue | `publication-review` |
| G-W-authorization-content | Vérifier le contenu exact dans le tiroir ouvert | `publication-channel` |
| G-W-authorization-schedule | Vérifier créneau, fuseau et mode | `publication-next-slot` |
| G-W-authorization-authorize | Confirmer une autorisation dans le propriétaire | `publication-review` |
| G-W-delivery-status | Distinguer attente, simulation, échec et réussite | `publication-channel` |
| G-W-delivery-responsibility | Identifier la prochaine responsabilité | `publication-obligations` |
| G-W-delivery-evidence | Repérer le lien volontaire vers Campagnes pour les preuves disponibles du dossier | `publication-campaign-benefits` |
| G-W-website-presentation | Examiner slug et résumé publics | `publication-public-address`, `publication-public-summary` |
| G-W-website-preview | Vérifier le rendu avant visibilité | `publication-public-preview` |
| G-W-website-visibility | Examiner les prérequis et la décision de visibilité | `publication-website` |
| G-W-history-tracking | Lire les déclarations historiques existantes | `publication-historical-declaration-help` |
| G-W-history-declare | Renseigner un statut déclaré, un lien et des notes | `publication-manual-status`, `publication-manual-link`, `publication-manual-notes` |
| G-W-history-save | Enregistrer les champs modifiés de la fiche et du suivi déclaré par la commande commune | `publication-tracking-save` |

Le guide affiche un avertissement si la zone n’est pas disponible ; certaines
étapes demandent donc d’ouvrir volontairement un tiroir avant de retrouver la
cible. Le parcours **history** ne produit pas de preuve qualifiée de livraison.
Le guide ouvre les `details` de présentation ancêtres, y compris **Fiche publique
et suivi déclaré** puis **Suivi social déclaré**, avant de montrer leurs champs.
Il ne les enregistre pas. L’étape de preuve met en évidence le lien Campagnes
filtré par dossier ; elle ne le suit pas et ne confirme aucune livraison.
Sources : [catalogue](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-workflow-guide.catalog.ts),
[vue et contrôles](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-workflow-guide.component.html),
[comportement](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-workflow-guide.component.ts),
[libellés FR](../../apps/funding-web/src/assets/i18n/admin-workflow-guide.fr-CA.json).

## Mode Automatique

### Entrées et carrousel des bons

La rubrique **Préparation des dossiers** charge le passage existant. Elle place
le carrousel avant **Suivi du lot** ; ce dernier est repliable. La position du bon
consulté est indépendante du nombre de dossiers déjà traités par le serveur.

<!-- prettier-ignore -->
| ID | Action ou zone | Responsabilité / effet | Condition et propriétaire |
| ----- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-A01 | **Démarrer un nouveau passage**, raccourci de l’en-tête commun | Ouvrir Automatique, charger le passage puis démarrer si aucun passage incomplet ne bloque, B/L/M | `AdminGuidanceComponent.startPortfolio()` → `AdminAutomaticComponent.startPortfolio()` ; un passage existant incomplet est montré sans reprise automatique |
| G-A02 | Position et progression du carrousel | Distinguer bon consulté et dossiers vérifiés, L | Manifeste non vide |
| G-A03 | **Actualiser** le bon | Relire le bon courant, L | Désactivé pendant chargement ou approbation |
| G-A04 | **Précédent** | Consulter la position précédente du manifeste, L | Désactivé au début, pendant lecture ou approbation |
| G-A05 | **Suivant** | Consulter la position suivante, L | Désactivé à la fin, pendant lecture ou approbation |
| G-A06 | Pilotage de la préparation et ses commandes | Consulter contrôles, contenu et historique ; rejoindre les propriétaires ; approuver la version si permis, L/N/M. **Évolution appliquée** : volet Détails de l'accord retiré ; **Voir les prestations dans Campagnes** ouvre le dossier courant dans Campagnes, N. | Organisme partagé en mode `campaigns` ; détail du [bon](admin-sponsorship-dossier-blueprint.md#bon-de-preparation-partage) et [entrée contextuelle](../technical/admin-campaigns.md#entree-contextuelle-et-details-de-laccord) |
| G-A07 | Résumé d’assistance et ses commandes contextuelles | Lire, actualiser, ouvrir la source/revue ou relancer explicitement l’assistance, L/N/M | Même bon partagé ; assistance réservée au propriétaire dans ce contexte ; voir son registre propriétaire |

G-A03 à G-A05 n’examinent aucun dossier du lot, ne lancent aucune préparation et
ne donnent aucun accusé de lecture. G-A06 peut ouvrir la confirmation commune
d’approbation ; le rôle lecteur n’a que la consultation. Le bon et ses contrôles
proviennent du serveur : aucun nombre fixe de contrôles applicables n’est à
déduire d’un exemple de maquette. Le contexte de lot peut ajouter un contrôle de
dossier examiné.

Sources : [carrousel](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-preparation-carousel.component.html),
[adaptateur et approbation](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-preparation-carousel.component.ts).
API : `GET /api/admin/automatic-runs/preparation?runId=<uuid>&position=<n>` ;
`POST /api/admin/automatic-runs/preparation/approve` pour l’approbation versionnée.
La même préparation est disponible sans passage dans le dossier et dans Campagnes.
Le volet **Détails de l'accord et traçabilité** est désormais réservé à Campagnes.
La commande du Guide transmet `sponsorshipId` du bon courant ; elle n'invente pas
un ID d'obligation à partir du contrôle sélectionné. Une prestation sélectionnée
du même dossier peut être reprise depuis le store ; sinon la destination choisit
l'unique prestation ou laisse choisir parmi plusieurs. Un dossier sans prestation
reste un résultat vide explicite, sans obligation fabriquée. Les commandes de
relecture, d'historique et d'approbation du Guide ne changent pas.

### Suivi du lot, points de lecture et commandes

<!-- prettier-ignore -->
| ID | Zone/action | Responsabilité / effet | Condition / appel |
| ----- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| G-L01 | Déplier **Suivi du lot** | Montrer commandes, lecture, bilan et rapport, P | Phase et progression restent visibles même replié ; pas de démarrage par dépliage |
| G-L02 | Déplier **Fonctionnement et limites** du périmètre | Lire mission, paiements couverts, brouillons privés et confirmations séparées, P/L | Aucun changement du manifeste |
| G-L03 | **Démarrer** | Capturer la liste figée des paiements confirmés et commencer les points de lecture, M/P | Serveur opérateur/propriétaire ; pas de passage incomplet actif |
| G-L04 | **Reprendre** | Reprendre volontairement le passage ou une lecture encore inachevée, L/M/P | Passage non terminé ou conducteur en pause ; interdit si résultat incertain |
| G-L05 | **Pause** | Arrêter le conducteur navigateur et empêcher le dossier suivant ; conserver la situation serveur, P/M | Conducteur actif ; une requête déjà partie peut se terminer |
| G-L06 | **Actualiser** | Relire le passage et le rapport sans reprendre le conducteur, L | Conducteur inactif |
| G-L07 | **Revérifier** | Ouvrir une nouvelle passe sur le même manifeste figé, M/P | Passage terminé ou en pause ; pas de résultat incertain |
| G-L08 | Lecture **Périmètre** | Expliquer la liste et les limites du passage, L/P | Point d’arrêt de lecture local |
| G-L09 | Lecture **Dossier** | Lire une projection fraîche du prochain paiement avant sa vérification, L | `GET /api/admin/payment-journey` ; montant, référence, raison et date d’observation |
| G-L10 | Déplier **Détail de la vérification** | Lire ce qui sera relu et préparé, P/L | Dans l’aperçu Dossier |
| G-L11 | **J’ai lu, continuer** | Accuser réception du point de lecture courant ; après l’aperçu Dossier, permettre un seul contrôle serveur et ses préparations privées admissibles, P/M selon l’étape | Identifiant local du point courant ; désactivé si page de rapport en lecture ou erreur |
| G-L12 | Lecture **Résultat** | Présenter bilan du dossier, raisons, brouillons créés/préservés et prochaine responsabilité, L | Doit rester à lire même pour le dernier dossier |
| G-L13 | **Examiner le dossier** / **Voir le suivi** | Mettre le lot en pause, sélectionner le paiement et démarrer l’outil de préparation ciblée, B/P/L/N | `open(entry)` → `prepare` → `preparePayment(entry)` ; uniquement si une destination sûre existe |
| G-L14 | Lecture **Bilan** | Distinguer fin du passage et responsabilités équilibrées à la date observée, L/P | Comptages, nouveaux paiements exclus et totaux séparés par devise |
| G-L15 | **Réconcilier le résultat serveur** | Ouvrir le dialogue de confirmation, P | Passage `uncertain`, conducteur inactif |
| G-L16 | **Annuler** ou fermeture native du dialogue | Fermer sans réconciliation serveur, P | Dialogue de réconciliation ouvert |
| G-L17 | **Vérifier le résultat sans rejouer** | Fermer le dialogue puis demander la réconciliation durable ; reprise séparée, M/L | `portfolio.reconcile()` ; aucune répétition automatique de l’action incertaine |

L’ouverture ou la fermeture d’un `details` reste une action de présentation. Les
points de lecture ne constituent pas une approbation de publication ou de
préparation. Leur accusé est conservé seulement pendant la visite ; les commandes
de passage et le rapport sont durables côté serveur.

Routes propriétaires : `GET/POST /api/admin/automatic-runs`,
`POST /api/admin/automatic-runs/advance`,
`POST /api/admin/automatic-runs/control` avec `pause`, `resume`, `recheck` ou
`reconcile`. Les commandes portent requête et version attendue ; les lectures
sont privées et les passages appartiennent à leur acteur. Les lecteurs peuvent
consulter leurs rapports ; les commandes serveur sont réservées aux opérateurs
et propriétaires. La vue des boutons du lot n’applique pas de masquage spécifique
au rôle lecteur : refus API et disponibilité UI sont donc deux niveaux distincts.

Sources : [vue du lot](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio.component.html),
[service](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio.service.ts),
[conducteur](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio-run.ts),
[client](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio.client.ts),
[contrat API](../technical/admin-automatic-runs.md),
[politique des rôles](../../apps/funding-api/src/admin-identity/policy.ts).

### Rapport et traçabilité

<!-- prettier-ignore -->
| ID | Zone/action | Responsabilité / effet | Condition |
| ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| G-R01 | Déplier **Rapport par dossier** | Lire les entrées durables chargées, P/L | Un passage existe |
| G-R02 | Déplier une entrée par référence et statut | Lire observation datée, acteur, avant/après, avantages promis, raisons, actions, échéances et preuves, P/L | Chaque entrée du rapport |
| G-R03 | **Consulter la preuve** | Ouvrir le lien HTTP(S) de réalisation dans un autre onglet, N | URL de preuve valide ; ne crée ni rattachement ni preuve |
| G-R04 | **Examiner le dossier** / **Voir le suivi** d’une entrée | Même délégation à la préparation ciblée que G-L13, B/P/L/N | Ce n’est pas un simple lien vers une fiche |
| G-R05 | **Afficher la suite du rapport** | Charger la page suivante et l’ajouter au rapport, L | Curseur existant ; bloqué pendant une autre phase active sauf lecture du bilan, et pendant chargement |
| G-R06 | Déplier **Fonctionnement et limites** du rapport | Lire référence du passage, date et portée des observations, P/L | Aucun nouveau contrôle serveur |

Lecture : `GET /api/admin/automatic-runs/report?runId=<uuid>&after=<seq>&limit=50`.
La table n’est pas une liste de prestations courantes équivalente à Campagnes :
elle contient des observations datées, passage par passage. La relecture d’une
page du rapport ne prépare aucun brouillon.

### Préparer un dossier ou une rubrique

Cette section est affichée d’emblée sans passage ; avec un passage, elle est
repliable sous **Autre préparation**. Elle doit rester ouverte pendant une
préparation active ou un blocage/une erreur à traiter.

<!-- prettier-ignore -->
| ID | Action | Responsabilité / effet | Condition / propriétaire |
| ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| G-T01 | **Autre préparation** | Afficher/replier l’outil ciblé, P | Repli empêché si outil actif, bloqué ou en erreur |
| G-T02 | Sélecteur paiement / rubrique | Choisir le paiement suivi ou l’une des 20 rubriques et mettre les conducteurs en pause, P | Désactivé pendant activité ; paiement indisponible sans UUID suivi |
| G-T03 | **Démarrer la préparation** / **Relire et reprendre** | Revalider le contexte, rejoindre l’écran et présenter ses préparations admissibles, L/N/P | Désactivé pendant activité ou sans UUID requis ; met le lot en pause |
| G-T04 | **Pause immédiate** | Suspendre ce conducteur de préparation, P | Outil actif |
| G-T05 | Phase, dernière préparation, rubrique et raison | Expliquer le travail en cours et ce qui attend une personne ou la plateforme, L/P | Les anciennes observations ne valent pas confirmation actuelle |
| G-T06 | **Vérifier et continuer** / **Actualiser le suivi** | Relire les faits et recalculer la prochaine étape, L | En attente humaine ou plateforme |
| G-T07 | **Me montrer la zone** | Entourer la cible déclarée, P | Cible du plan disponible |
| G-T08 | **Préparer : <action du propriétaire>** | Exécuter uniquement l’ouverture ou la préparation explicitement déclarée par le composant propriétaire, P | Seulement en attente humaine, entrée visible/admissible, bon UUID et bonne région |
| G-T09 | Déplier l’historique | Lire le journal de repères borné de la visite, P/L | Événements présents ; ce journal ne remplace pas l’audit serveur |

G-T08 n’est pas un catalogue parallèle de mutations : le registre contient des
callbacks opt-in de présentation (`prepare`, `confirmation_required`), jamais une
recherche arbitraire de boutons à cliquer. Le formulaire, ses champs et sa
confirmation appartiennent toujours au composant d’origine. Les préparations du
dossier — identité, interventions, revue, remboursement, visibilité Web,
obligations, revue éditoriale — sont inventoriées dans le
[blueprint Dossier](admin-sponsorship-dossier-blueprint.md). Les préparations des
17 autres rubriques dépassent le périmètre d’inventaire de leurs écrans : leur
propriétaire reste chaque déclaration `openg7AutomaticPrepare`.

Sources : [vue](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic.component.html),
[orchestration](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic.service.ts),
[registre et conditions](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-preparation.service.ts),
[directive de délégation](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-preparation.directive.ts).
La lecture automatique d’un paiement en attente est bornée ; saisie, navigation
manuelle, onglet masqué, dialogue et changement de session suspendent l’activité.
Le redémarrage après rechargement reste volontaire.

## Guide pas à pas : vraie modale

### Zones et actions communes

<!-- prettier-ignore -->
| ID | Zone/action | Responsabilité / effet | Condition |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| G-M01 | **Guide pas à pas** / **Reprendre le guide** / **Revoir le guide** | Ouvrir la visite modale au repère sauvegardé, ou au début après une fin, B/P | Rendu navigateur prêt, étapes disponibles, composant non désactivé |
| G-M02 | Masque et repère visuel | Isoler l’interaction et expliquer la zone sans activer sa commande, P | Cible fixe ; cible absente signalée, parcours non bloqué |
| G-M03 | En-tête, étape n/N, titre et explication | Présenter une responsabilité à la fois, P/L | Annonce `aria-live` et focus dans la carte |
| G-M04 | **Précédent** / flèche gauche | Reculer et sauvegarder le repère, B/P | Désactivé à la première étape |
| G-M05 | **Suivant** / flèche droite | Avancer et sauvegarder le repère, B/P | Avant la dernière étape |
| G-M06 | **J’ai compris** | Marquer la visite terminée et fermer la modale, B/P | Dernière étape ; aucune approbation métier |
| G-M07 | **Quitter le guide** / Échap | Fermer et restaurer le focus au bouton d’entrée, P | Ne supprime pas la progression |
| G-M08 | Message de sauvegarde | Expliquer la persistance disponible ou son repli mémoire, L | Aucun bouton d’effacement propre à cette progression |

La clé est distincte de G-C08 :
`og7-admin-guide:v1:<compte>:<guide>`. Elle contient seulement l’identifiant
d’étape et le marqueur de fin. **Effacer mon repère** du guide flottant ne supprime
donc pas cette progression. Tab fait circuler le focus entre les boutons ; la
manette est capturée pendant la visite, avec retour au neutre entre étapes.

### Chaque page et chaque étape modale

<!-- prettier-ignore -->
| Page / guide | Étape | Responsabilité expliquée / cible |
| ------------------------------ | ------------ | ------------------------------------------------------- |
| Poste de pilotage / `pilotage` | `automation` | Préparation automatique / `pilot-automation` |
| Idem | `domains` | Choix des espaces / `pilot-domains` |
| Idem | `decision` | Dossier ou décision courante / `pilot-decision` |
| Idem | `summary` | Situation, proposition et conséquence / `pilot-summary` |
| Idem | `details` | Détails de la proposition / `pilot-details` |
| Idem | `actions` | Décisions disponibles / `pilot-actions` |
| Idem | `queue` | File de travail / `pilot-queue` |
| Idem | `week` | Accès à Ma semaine / `open-programme` |
| Idem | `calendar` | Calendrier / `pilot-calendar` |
| Idem | `controller` | Commandes à la manette / `pilot-controller` |
| Ma semaine / `programme` | `brief` | Synthèse / `programme-brief` |
| Idem | `calendar` | Composition du calendrier / `programme-compose` |
| Idem | `rehearsal` | Répétition / `programme-rehearsal-title` |
| Idem | `editorial` | Consigne éditoriale / `programme-instruction` |
| Idem | `memory` | Mémoire / `programme-memory` |
| Idem | `incidents` | Incidents / `programme-incidents` |

La visite Pilotage est désactivée pendant une opération ou lorsqu’un panneau
est ouvert. Son ouverture retire le mode concentration. La visite Ma semaine est
désactivée pendant chargement, opération ou confirmation en attente, et sans état
chargé. Elle change la vue de présentation pour révéler chaque outil, puis
restaure la vue initiale à la fermeture ; la vue Répétition déclenche la lecture
de son aperçu, sans enregistrer de proposition. Les saisies sont préservées tant
que le panneau demeure ouvert.

Sources : [catalogues des 10 et 6 étapes](../../apps/funding-web/src/app/features/funding/components/admin-pilotage/pilotage-guides.ts),
[template modal](../../apps/funding-web/src/app/features/funding/components/admin-guide/admin-guide.component.html),
[intégration Pilotage](../../apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/admin-pilotage-page.component.html),
[intégration Ma semaine](../../apps/funding-web/src/app/features/funding/components/admin-pilotage/editorial-programme.component.ts).

## Constats et équivalents transversaux

<!-- prettier-ignore -->
| Constat prouvé | Conséquence | Rangement proposé, non implémenté |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Le sélecteur de modes héberge aide, suivi de dossier, contrôle de lot et préparation de tâches | Le terme Guide ne permet pas de prévoir la portée d’un clic | Garder une aide contextuelle ; déplacer les opérations vers leurs espaces propriétaires |
| Le bon de préparation est déjà partagé entre carrousel, dossier et Campagnes | Extraire un nouveau formulaire de préparation du Guide créerait une quatrième implémentation | Conserver l’organisme partagé et changer ses points d’entrée, voir blueprint Dossier |
| **Examiner le dossier / Voir le suivi** démarre la préparation ciblée | Un libellé de consultation masque un changement d’activité et d’écran | Distinguer **Ouvrir le dossier** et **Préparer la prochaine étape**, avec effets explicites |
| Le rapport comporte historique durable et preuves ; Campagnes présente des prestations actuelles | Les deux listes ne sont pas interchangeables | Garder un rapport de passage propriétaire ; ouvrir Campagnes avec contexte lorsqu’un suivi courant est demandé |
| Les Six parcours contenaient à la fois une description actuelle et une organisation future | La proposition d’architecture pouvait être lue comme une fonction disponible | **Appliqué** : aide produit limitée au fonctionnement actuel ; propositions conservées dans ce blueprint |
| Découverte et Guide pas à pas ont leurs propres progression, navigation, halo et reprise | Deux modèles d’aide et deux clés locales restent à comprendre et maintenir | Étudier une enveloppe de visite commune ; conserver explicitement la différence modal/non modal et la priorité des dialogues |
| La description de confidentialité énumère rubrique, étape et paiement, mais omet parcours interactif et mode | L’explication visible est plus étroite que les données réellement mémorisées | Aligner le texte sur le schéma ; donner une portée explicite à l’effacement |
| Effacer le repère flottant ne supprime pas le guide pas à pas | Deux commandes de progression ne partagent pas le même cycle de vie | Proposer un réglage commun des aides avec choix de portée, sans effacer de données métier |
| La réconciliation du lot utilise son dialogue local ; le layout fournit déjà `AdminConfirmationService` et sa vue commune | Deux mécanismes de confirmation sont maintenus | Réutiliser la confirmation transverse si elle préserve l’action distincte et l’absence de rejeu |
| Les commandes du lot ne sont pas masquées spécifiquement aux lecteurs, malgré le refus serveur des POST | Une commande visible peut conduire à un refus d’autorisation prévisible | Exprimer les capacités serveur dans l’UI et conserver la vérification API |

Équivalents existants à réutiliser : bon partagé, service de confirmation,
registre opt-in de préparations, utilitaires de halo/défilement et routes des
propriétaires. Il n’existe pas dans cette analyse de preuve d’une page routée
autonome pour les passages : ce serait une extraction à créer, pas une réutilisation
déjà disponible. Ni Campagnes ni le poste de pilotage ne doivent absorber toutes
ces responsabilités par simple déplacement de la carte.

## Propositions retirées de l’aide produit

Ces pistes proviennent des anciens encadrés des six parcours. Leur conservation
ici ne prouve pas leur réalisation ; l’état des zones concernées est décrit dans
les blueprints du dossier et de Campagnes.

<!-- prettier-ignore -->
| Parcours | Piste de rangement |
| --- | --- |
| Accord de commandite | Rassembler source, proposition locale, prestations et confirmation dans un parcours continu. |
| Préparation | Regrouper les prestations et leurs brouillons, avec une prochaine action visible pour chaque canal. |
| Autorisation | Rendre le passage de la revue à l’autorisation plus lisible, avec les préconditions près de la confirmation. |
| Livraison | Présenter ensemble le statut, la prochaine responsabilité et la preuve qualifiée de chaque prestation. |
| Fiche Web | Réunir présentation, aperçu et visibilité dans une zone distincte du suivi social déclaré. |
| Suivi historique | Distinguer le suivi social déclaré de la fiche Web et préciser la portée des déclarations manuelles. |

## Découpage cible proposé

1. **Aide** : découverte de la rubrique et visites pédagogiques ; lecture,
   navigation et préférences uniquement. Leurs explications restent attachées à
   l’écran réel et accessibles au lecteur.
2. **Suivi d’un dossier** : prochaine responsabilité, contexte de paiement et bon
   courant ; réutiliser le dossier propriétaire et ses entrées depuis Campagnes.
   Le suivi ne décide pas à la place de la personne autorisée.
3. **Passages de contrôle** : capture du manifeste, conducteur, points de lecture,
   commandes de reprise/réconciliation et rapport durable dans un espace de lot
   explicite. Un panneau compact peut montrer son état et un lien de reprise.
4. **Préparation transversale** : outil volontaire qui rejoint le bon propriétaire
   et ouvre uniquement ses actions enregistrées. Réutiliser le registre actuel,
   les confirmations communes et un contexte de retour stable.

Ces frontières sont fonctionnelles : elles n’imposent pas de créer quatre routes
avant d’avoir validé les parcours ni de dupliquer les stores et contrats existants.

## Priorités et critères de recette

<!-- prettier-ignore -->
| Priorité | Résultat attendu | Critères concrets |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 | Prédictibilité des actions | Un bouton de lecture ne démarre pas de préparation ; un accusé de lecture n’approuve pas un bon ; effets et droits sont annoncés avant commande |
| P1 | Propriétaires uniques | Bon et décisions conservés dans les composants existants ; aucune copie des règles métier dans l’aide |
| P1 | Séparation du lot et du dossier | Position de consultation distincte de progression ; sortie vers un dossier identifiable ; résultat incertain réconcilié avant reprise explicite |
| P2 | Aide et propositions séparées | Chaque guide décrit uniquement une commande existante ; les propositions restent identifiées comme travaux à réaliser |
| P2 | Préférences compréhensibles | Texte aligné sur les deux schémas de stockage ; portée d’effacement testée, comptes et mode token explicités |
| P2 | Confirmation et capacités cohérentes | Même service de confirmation lorsque pertinent ; lecteur limité aux consultations sans pouvoir lancer de POST interdit |

Vérifications à préserver lors d’une future implémentation : FR/EN, clavier,
restauration du focus, mobile, mouvement réduit, contrôleur simulé, priorité des
dialogues, erreurs/absence de cibles, données retirées sur refus d’accès, annulation
des lectures tardives, absence de reprise automatique et conservation des
rapports/audits. Un essai simulé de manette ne qualifie pas une manette physique.

Sources de recette existantes, **lues et non exécutées pour ce blueprint** :
[découverte et paiement](../../tests/playwright/admin-guidance.spec.ts),
[six parcours](../../tests/playwright/admin-workflow-guide.spec.ts),
[lot](../../tests/playwright/admin-automatic-portfolio.spec.ts),
[bons](../../tests/playwright/admin-preparation-receipts.spec.ts),
[guide modal](../../tests/playwright/admin-pilotage.spec.ts),
[parcours réel API/PostgreSQL du lot](../../tests/identity/admin-automatic-responsibilities.spec.ts).
Ces fichiers ne prouvent pas leur réussite récente ni un paiement, envoi ou
publication de production.

## Limites de l’inventaire

L’inventaire couvre les contrôles déclarés par les templates et leur délégation,
pas un relevé visuel de chaque état de la base locale. Les jalons du paiement,
les contrôles du bon, les entrées de rapport et les préparations disponibles sont
calculés dynamiquement : leurs familles et propriétaires sont inventoriés, aucune
liste issue d’un seul dossier n’est présentée comme exhaustive. Les formulaires
et décisions métier ouverts par délégation appartiennent au blueprint Dossier,
ou aux écrans hors périmètre pour les autres rubriques. Aucune écriture de base,
approbation, préparation, publication ou commande de lot n’a été exécutée pour
rédiger ce document.
