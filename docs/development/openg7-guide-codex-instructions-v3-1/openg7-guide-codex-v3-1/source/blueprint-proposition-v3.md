# OpenG7 Funding Platform — Guide administratif UX/UI V3

**Réponse au blueprint actuel et aux sept captures — proposition de conception, non implémentée**\
**Source de vérité fonctionnelle :** `README.md`, état de travail du 19 octobre 2026 à 23 h 49 (Toronto), commit `30e812a6e9f981e67a92022e040c84b7fdbd4bf2` **avec modifications locales non commitées**. Les captures utilisent des données synthétiques et des réponses d'API interceptées.\
**Référence esthétique :** maquette OpenG7 claire, bleu marine et or, panorama discret et dragon ; la maquette n'est pas une preuve fonctionnelle.

## 1. Décision de conception

Faire du Guide une **surface de pilotage à intention explicite**, sans le transformer en modal, en moteur métier ni en deuxième version des écrans propriétaires.

**Conserver l'existant déjà livré :**

- Les **quatre modes** : Découvrir, Suivi d'un paiement, Préparation des dossiers, Explorer les parcours ; le rail desktop et la grille 2 × 2 dans un conteneur étroit.
- Le **CTA du contrôle sélectionné**, les contrôles nécessitant une intervention en premier, le groupe « Vérifiés » replié et les contrôles dynamiques.
- Les positions numérotées et Précédent/Suivant dans le carrousel (ce sont des positions, pas des états de dossier).
- Le bon partagé `AdminPreparationReceiptComponent`, son unique approbation versionnée et confirmée, ses droits et son historique.
- Les réessais locaux déjà ajoutés, les préférences, le focus restauré et les rendus FR/EN/thèmes.
- Les deux conducteurs distincts (lot / préparation ciblée), le manifeste figé et les réconciliations sans répétition aveugle.
- La lecture et les préparations privées, distinctes du paiement, consentement, approbation, visibilité, publication, livraison, courriel et remboursement.

**Changer en V3 :** clarifier **la cible exacte**, **l'activité en cours**, **la portée des chiffres**, **l'effet du prochain geste Xbox**, l'accès rapide au bilan et à la préparation ciblée, ainsi que l'ergonomie aux petites hauteurs.

## 2. Diagnostic — faits, observation des captures et inférences

### Diagnostic principal : trois cibles simultanément valides

**Fait du blueprint :** le Guide peut présenter un **bon B** consulté (`carousel.position`), être en attente du contrôle serveur du **dossier C** (`run.nextContributionId`) et suivre le **paiement A** (`guidance.snapshot().payment`). Naviguer dans le carrousel ne change ni la cible du lot ni celle du paiement suivi. La rubrique « Vous êtes ici » ne désigne que la route ouverte.

**Risque UX (à vérifier en test) :** un administrateur pourrait supposer que toutes les actions concernent le bon visible. L'API revérifie la cible et les droits, mais l'interface doit aussi indiquer la portée avant un geste.

**Proposition :** une ligne compacte **« Contexte des interventions »** n'affichant que les identifiants réellement connus :

- **Bon consulté :** référence du bon et version (cible de ses contrôles et de son approbation).
- **Lot — prochain à vérifier :** référence du dossier fournie par le checkpoint actif, si disponible.
- **Paiement suivi :** référence suivie, seulement si un suivi est effectivement sélectionné.

Lorsque deux cibles sont différentes, afficher un avis neutre explicite : « Tu consultes un autre bon ; cela ne change pas le dossier que le passage doit vérifier ». **Ne jamais synchroniser implicitement** les identifiants. Le bandeau change lorsque les faits serveur ou le mode changent. Sur téléphone, condenser en « Cibles du travail · Voir les 3 » ; avant une action sensible, afficher la cible exacte dans son contexte et sa confirmation.

### Diagnostic secondaire : trois tâches superposées dans « Préparation des dossiers »

**Fait :** le composant affiche successivement le bon, le suivi du lot (rapport + bilan) et « Autre préparation ». Les deux conducteurs ont des cycles de vie distincts. Le volet de suivi peut s'ouvrir au checkpoint requis et sa fermeture **ne** met **pas** le lot en pause.

**Observation des captures :** le Guide déborde fortement sur la page de travail en bureau ; en mobile, la vue montre souvent le problème sélectionné sans l'en-tête du bon ou ses actions finales. Cela ne prouve pas un masquage définitif : ces zones peuvent être atteintes par défilement.

**Proposition :** trois **vues de présentation locales** à l'intérieur du seul mode « Préparation des dossiers », sans route ni machine de traitement supplémentaire :

1. **Bon consulté** (vue initiale si un bon existe) : diagnostic, CTA, contrôles, détails, approbation ; accès direct au prochain checkpoint du lot si celui-ci exige une lecture.
2. **Passage et bilan** : phase et commandes du conducteur, checkpoints, derniers résultats, bilan et rapport daté (rapport repliable au départ si aucun détail requis).
3. **Autre préparation** : préparer un paiement ou une rubrique, uniquement avec les capacités et conditions existantes.

Le changement de vue doit être **purement visuel**, sans requête de mutation, démarrage, redémarrage, pause implicite, destruction de formulaire ou modification de cible. Ne pas démonter un sous-composant avec des requêtes en vol si cela brise ses identifiants de reprise. Laisser un message visible « Passage en attente de lecture » dans la vue Bon lorsque le conducteur nécessite une validation de checkpoint, avec lien « Rejoindre le passage ». En cas de passage vide, sélectionner directement la vue pertinente selon l'état déjà observé.

### Troisième diagnostic : vocabulaire et commandabilité contextuelle

**Fait :** dans le rapport, « Examiner le dossier » ou « Voir le suivi » **met le lot en pause**, adopte explicitement un paiement et démarre une préparation ciblée ; ce n'est pas qu'un lien en lecture seule. « Revérifier » recommence une passe sur **le même manifeste** ; seul « Nouveau passage » inclut des paiements postérieurs. A sur la liste de contrôles n'exécute pas nécessairement le CTA.

**Proposition :** nommer les effets plutôt que les intentions vagues. Afficher les actions indisponibles selon les capacités API et expliquer pourquoi, notamment pour `reader`. Les profils de manette sont réaffectables : les badges doivent toujours venir du contrôleur courant, **jamais** d'un texte « A = toujours approuver » codé en dur.

## 3. Architecture cible et frontières de responsabilités

| Niveau                             | Contenu visible                                                                | Propriétaire conservé                                                          | Ne doit jamais faire                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Enveloppe Guide                    | « Vous êtes ici », réduire/placer, quatre modes, contexte                      | `admin-guidance` + `admin-layout`                                              | Bloquer la page comme un dialogue modal ou confirmer un geste métier     |
| Préparation — barre secondaire     | « Bon consulté / Passage et bilan / Autre préparation » + état du lot          | `admin-automatic.component`                                                    | Démarrer/pauser le conducteur au simple changement de vue                |
| Bon consulté                       | Manifeste/position, cible/version, contrôle sélectionné, CTA, approbation      | `admin-preparation-carousel`, `admin-preparation-receipt`, `preparation-pilot` | Approuver en choisissant un contrôle ; inventer des contrôles            |
| Passage et bilan                   | Phase, checkpoint, commandes, observations datées, rapport, nouveaux paiements | `admin-automatic-portfolio` + machine existante                                | Modifier le manifeste courant, transformer une lecture en fait financier |
| Autre préparation                  | Choisir paiement ou rubrique, lancer l'outil ciblé, retour                     | `admin-automatic.service` + registre propriétaire                              | Rejouer le lot ou exécuter une mutation arbitraire du DOM                |
| Commandes contextuelles            | Badges de profil, action réelle selon focus et état, retour au neutre          | `controller.service` + actions natives                                         | Introduire une deuxième table A/B/X/Y dans le Guide                      |
| Confirmation ou résultat incertain | Objet, version, cible, conséquence, reconciliation                             | Composants de confirmation/API actuels                                         | Rejouer automatiquement après erreur ou incertitude                      |

### Décisions de contenu et doublons

- **Progression du bon** : X/Y contrôles satisfaits (hors `not_required`), une seule projection visible dans la vue Bon. Ne jamais appeler ce compteur « dossiers vérifiés ».
- **Progression du passage** : X/Y dossiers contrôlés, affiché dans le bandeau global comme rappel réduit et en détail dans « Passage et bilan ». Si les lectures n'ont pas le même instant, afficher leur provenance ou une date « actualisé à » ; ne pas créer deux calculs concurrents.
- **Dernier résultat** : résumé de l'état courant et lien vers le rapport ; **rapport** : données historiques datées, avant/après, auteur, preuve et audit. Préserver ce qui relève d'un snapshot.
- **Bilan** : « équilibrés », « restant à traiter », « à clarifier » et « restant à vérifier » se recoupent ; les présenter dans deux groupes (« Avancement du passage » et « Situations observées ») avec la note « indicateurs non additionnables ». Un dossier non vérifié peut déjà apparaître dans « à clarifier » selon la projection ; aucune fausse addition ne doit être proposée.
- **Hors couverture** : la projection actuelle émet 0 ; ne pas transformer cette valeur en garantie de couverture complète. Garder un contexte explicatif ou réserver ce KPI à une vue avancée avec sa limite connue.
- **Accord historique / version** : si le contrôle a été choisi puis est devenu vérifié après relecture, sa sélection persiste ; le libellé du CTA doit annoncer l'opération réellement disponible (« Voir l'accord », « Modifier l'accord » ou libellé existant qualifié selon le descripteur) et ne pas inciter à « compléter » ce qui n'est plus manquant. À vérifier dans le descripteur avant modification.
- **Six parcours** : isoler clairement les éléments « Organisation proposée — à réaliser » des tâches exécutables ; pas d'illusion de disponibilité.
- **Mémorisation et pause** : une carte masquée ou réduite conserve le repère mais interrompt le conducteur navigateur ; les requêtes déjà transmises peuvent terminer. Expliquer cette distinction au moment utile, sans répéter un long avertissement sous chaque carte.

## 4. Wireframe — bureau 1536 × 864 et 1920 × 1080 à 125 %

```text
┌────────────────────── Guide administratif OpenG7 ──────────────────────────────┐
│ Vous êtes ici : Cockpit                 [Réduire] [Placer en bas]              │
├───────────────┬────────────────────────────────────────────────────────────────┤
│ Découvrir     │ [Bon consulté] [Passage et bilan] [Autre préparation]          │
│ Suivi paiement│ État du passage : En pause | 4/6 contrôlés | [Rejoindre]      │
│ Préparation ● │ Cibles : Bon = B · Prochain du lot = C · Paiement suivi = A    │
│ Six parcours  ├──────────────────────────────────────┬─────────────────────────┤
│               │ BON B · 50,00 CAD · Paiement confirmé│ Contrôles du BON B      │
│ Décor discret │ Version • À compléter                 │ 4/7 satisfaits          │
│               │                                      │ À compléter :           │
│               │ PROCHAINE INTERVENTION               │   Publications promises │
│               │ Documenter l'accord d'origine        │   Présentation/contenus │
│               │ Cause et destination propriétaire    │   Modération            │
│               │ [Compléter l'accord]                 │ ▸ Vérifiés (4)         │
│               │ ▸ Pourquoi ?  ▸ Assistance           │                         │
│               ├──────────────────────────────────────┴─────────────────────────┤
│               │ ▸ Contenu exact  ▸ Accord  ▸ Historique                        │
│               │ Approbation : non disponible — prérequis non satisfaits         │
├───────────────┴────────────────────────────────────────────────────────────────┤
│ Commandes Xbox : [d'après profil + focus actif]   [Bon précédent] [Bon suivant]│
└────────────────────────────────────────────────────────────────────────────────┘
```

Notes : le dessin est conceptuel, non une capture de code. La barre Xbox n'est pas une nouvelle autorité d'actions ni un nouveau raccourci global ; elle reflète les commandes contextuelles réelles. Lorsque le passage attend un checkpoint, son état est visible même si la vue Bon reste affichée. Un lien vers une page métier doit conserver la cible, la version et le retour connus sans garantir la restauration universelle d'une navigation arbitraire.

### Vue « Passage et bilan » au même endroit

```text
┌─────────────── Passage et bilan ────────────────────────────────────────────────┐
│ Passage 1 · En pause · manifeste figé 6 dossiers · 4 dossiers contrôlés       │
│ [Reprendre le passage] [Actualiser l'état] [Revérifier ce passage]            │
│ Texte court : « Revérifier reprend le même manifeste ; nouveaux paiements     │
│                seulement dans un nouveau passage. »                          │
│ Checkpoint : Dossier C en attente de lecture/contrôle [Examiner le checkpoint] │
├────────────────────────────────────────────────────────────────────────────────┤
│ AVANCEMENT                        OBSERVATIONS DU PASSAGE                      │
│ 4/6 contrôlés, 2 à vérifier        1 équilibré, 5 à clarifier (dont non vérifiés)│
│ 5 restant à traiter*              Hors couverture 0 (limite de projection)     │
│ *indicateurs se recoupant, à ne pas additionner                               │
│ Nouveaux paiements hors passage : 1 → [Démarrer un nouveau passage]           │
│ ▸ Dernier résultat   ▸ Rapport daté par dossier (preuves/audit/pagination)    │
└────────────────────────────────────────────────────────────────────────────────┘
```

Les chiffres de la maquette sont illustratifs, issus des captures antérieures et non d'un dossier en direct. La vue affiche ses compteurs **seulement s'ils sont réellement disponibles**.

## 5. Wireframe — mobile 390 × 844, 390 × 667 et zoom 200 %

```text
┌───────────────────────────────┐
│ Guide OpenG7  [Réduire] [⋯]   │  En-tête compact fixe
│ Vous êtes ici · À traiter      │
│ Mode : Préparation des dossiers│  Sélecteur accessible même après défilement
├───────────────────────────────┤
│ [Bon] [Passage] [Autre]       │  Vue locale, sans mutation
│ Bon 3/6   ·   4/7 satisfaits   │
│ Cibles du travail [Afficher]  │  Déplié si divergences importantes
│ 125,00 CAD · Paiement confirmé│
│ À compléter                   │
│ Publications promises         │
│ Accord manquant, explication  │
│ [Compléter l'accord]          │
│ ▸ Pourquoi ?  ▸ Autres actions│
│ ▸ Contrôles à compléter (3)   │
│ ▸ Vérifiés (4)               │
│ ▸ Contenu exact et historique │
│ Approbation indisponible : ...│
├───────────────────────────────┤
│ [Précédent]       [Suivant]   │  Navigation du carrousel si cette vue
└───────────────────────────────┘
```

- Préserver l'en-tête compact et l'accès aux quatre modes (grille existante au début ; sélecteur court après défilement). **Ne pas dupliquer deux jeux interactifs concurrents** : le sélecteur compact représente les mêmes modes et leur même état.
- Garder accessible la vue « Passage » depuis un petit écran sans devoir parcourir tout le bon. Les barres fixes et le dock de manette doivent partager l'espace, pas recouvrir le CTA ou le pied du carrousel.
- Conserver une région de défilement cohérente ; vérifier le clavier virtuel, l'orientation, `safe-area-inset-*`, et la page derrière, qui reste utilisable lorsque le Guide est réduit.
- Si une fenêtre de confirmation prioritaire s'ouvre, elle reprend la priorité du focus et de la manette ; aucune navigation du Guide ne peut déclencher sa validation.
- Le panorama et le portrait restent décoratifs, facultatifs et masqués lorsque la hauteur utile est insuffisante ; ils ne portent aucun statut métier.

## 6. Tableau des écarts et plan priorisé

**Qualification :** « Fait » est documenté dans le README ; « Observation » provient d'une capture ; « Risque » est une hypothèse à vérifier. **P0** n'est attribué qu'à un défaut grave démontré en mutation / sécurité. Aucun défaut de ce type n'est confirmé par ces seules pièces.

| ID / priorité | Problème et scénario                                                                        | Fondement                          | Changement V3                                                                                                                   | Propriétaire à faire évoluer                                                | Effet préservé / risque                                                         | Critère de réception                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| G3-01 **P1**  | Bon B consulté, lot C en attente et paiement A suivi : cible de chaque action ambiguë       | Fait                               | Barre de cibles, identité sur CTA et confirmations ; avis de divergence                                                         | `admin-guidance`, `admin-preparation-carousel`, `admin-automatic-portfolio` | Aucune synchronisation implicite ; risque de confusion                          | Chaque action annonce le bon `id/version`, la cible du passage ou le paiement suivi ; trois identifiants peuvent diverger sans changement d'état |
| G3-02 **P1**  | On confond Examiner le dossier avec une simple consultation alors que le lot passe en pause | Fait                               | Renommer selon l'effet : « Mettre le passage en pause et préparer ce dossier » ; avertissement bref avant changement d'activité | `admin-automatic-portfolio`, `admin-automatic.service`                      | Réutilisation du parcours propriétaire ; risque d'ajout de confirmation inutile | L'utilisateur sait avant le geste que le lot sera mis en pause et que le suivi sera adopté ; aucune action métier appliquée par navigation       |
| G3-03 **P1**  | Lecteur voit une commande de lot éventuellement exécutable avant refus API                  | Fait                               | Présentation `canManage`/capacités exactes ; état désactivé explicatif ou masqué selon intention                                | `admin-automatic-portfolio`, `admin-guidance`                               | API reste autorité ; risque d'exposer/masquer des lectures permises             | Lecteur accède aux lectures autorisées, voit pourquoi les mutations sont impossibles, ne peut lancer un POST                                     |
| G3-04 **P1**  | Ordre Tab et lecture non alignés sur les colonnes du bon                                    | Fait, résultat à tester            | Audit du DOM, ordre focus, `aria-labelledby` et relation contrôle/détail/CTA ; réordonner le DOM si nécessaire                  | `admin-preparation-receipt`, `preparation-pilot`, liste des problèmes       | Éviter rupture d'autres hôtes du bon                                            | Tab/Shift+Tab et lecteur d'écran suivent un ordre compréhensible sur desktop et mobile, sans focus perdu                                         |
| G3-05 **P1**  | Petite hauteur/mobile : modes et actions métier loin du cadrage                             | Observation, accès encore possible | Contexte de mode compact accessible, vues locales, en-tête et pied non superposés                                               | `admin-guidance`, `admin-layout`, `admin-preparation-carousel`              | Panneau demeure non modal ; risque de deux scrollbars                           | À 320/390 × 667/844, accéder au CTA, suivi du lot, approbation et navigation sans masquage ni piège de défilement                                |
| G3-06 **P1**  | A/B/X/Y ont des effets différents selon le focus et `peek/open`                             | Fait                               | Aide « prochain geste » issue du profil et du scope ; ordre de priorité clair                                                   | `controller.service`, `preparation-context-actions`, navigation             | Conserver mapping réaffectable et retour au neutre                              | La commande annoncée correspond à l'action exécutée ; maintien d'A ne valide pas un nouveau dialogue                                             |
| G3-07 **P1**  | Même menu « Préparation » empile bon, lot, bilan, autre parcours                            | Fait                               | Trois vues de présentation locales, un seul contenu principal actif, état du lot toujours repérable                             | `admin-automatic.component` + `admin-automatic-portfolio`                   | Aucune duplication de machines ou mutation à l'ouverture                        | Passer de Bon à Passage puis Autre ne lance ni pause, ni POST, ni perte de requête en cours                                                      |
| G3-08 **P1**  | « Revérifier » peut laisser penser qu'il inclut de nouveaux paiements                       | Fait                               | Libellé avec même manifeste et accès distinct au nouveau passage                                                                | `admin-automatic-portfolio`, `admin-layout`                                 | Nouveau manifeste créé seulement par action existante                           | Revérifier garde la liste figée ; seul un nouveau passage inclut un paiement tardif                                                              |
| G3-09 **P2**  | 4/6 dossiers contrôlés affiché à deux endroits, avec lectures potentiellement différentes   | Fait                               | Bandeau résumé et vue détail utilisant dates/états cohérents, sans dupliquer les calculs                                        | `admin-preparation-carousel`, `admin-automatic-portfolio`                   | Ne pas confondre position X/Y avec progrès                                      | Compteurs étiquetés, horodatage si divergence, aucune affirmation d'avancement lors d'un simple changement de bon                                |
| G3-10 **P2**  | 1 équilibré, 5 à traiter, 5 à clarifier, 2 à vérifier : catégories chevauchantes            | Fait                               | Deux groupes de métriques + note de recoupement ; ne pas afficher une somme artificielle                                        | `admin-automatic-portfolio`                                                 | Les définitions API ne changent pas                                             | Les utilisateurs comprennent que les chiffres ne s'additionnent pas, même avec des non-vérifiés                                                  |
| G3-11 **P2**  | Même dossier détaillé dans dernier résultat et rapport                                      | Fait                               | Résultat court (courant) ; rapport historique daté/détaillé à la demande                                                        | `admin-automatic-portfolio`                                                 | Audit, preuves, pagination préservés                                            | Consulter rapport conserve auteur, date, avant/après, preuve sans masquer le checkpoint actuel                                                   |
| G3-12 **P2**  | CTA « Compléter l'accord » peut persister quand le contrôle sélectionné est vérifié         | Fait                               | Texte basé sur action permise et état réel du descripteur ; distinguer consulter / modifier / résoudre                          | `preparation-pilot` et descripteurs                                         | Pas de changement métier de l'accord                                            | Le CTA n'affirme pas qu'un élément est incomplet lorsqu'il est déjà satisfaisant                                                                 |
| G3-13 **P2**  | « Suivi du lot » et « Autre préparation » sont loin sous le bon                             | Fait, observation mobile           | Vues locales, bouton de retour au passage si checkpoint attend lecture                                                          | `admin-automatic.component`, `admin-automatic-portfolio`                    | Deux conducteurs gardés distincts                                               | Trouver bilan ou outil ciblé sans défiler la totalité du bon ; activité en cours clairement identifiée                                           |
| G3-14 **P2**  | Choix futurs « Organisation proposée » parmi les six parcours                               | Fait                               | Séparer visuellement « À réaliser » et « Disponible aujourd'hui »                                                               | `admin-workflow-guide`                                                      | Aucun module fictif                                                             | Aucun bouton futur présenté comme action métier active                                                                                           |
| G3-15 **P2**  | Chargement de traductions du mode préparation sans indicateur spécifique                    | Fait                               | Retour d'attente local FR/EN, sans flash de libellé périmé                                                                      | `admin-guidance` + i18n                                                     | Chargement différé et SSR                                                       | L'attente est perceptible et les actions restent inactives jusqu'aux libellés cohérents                                                          |
| G3-16 **P2**  | Réduire/mettre en pause pendant une requête en vol                                          | Fait                               | Texte circonstanciel au moment de l'interruption, lien vers réception/relecture                                                 | `admin-automatic-portfolio`, `admin-guidance`                               | Requêtes en vol non annulées ; pas de rejeu aveugle                             | Au retour, distinguer état local arrêté et opération serveur potentiellement achevée ; réconcilier si incertain                                  |
| G3-17 **P3**  | Panorama, portrait et hauteurs décoratives sollicitent l'espace                             | Observation                        | Conserver thème premium discret avec suppression responsive des décors                                                          | `admin-guidance`, styles et assets                                          | Aucune information métier portée par l'image                                    | Aucune perte de titre, contrôle ou message en thème clair/nuit/graphite à 200 % de zoom                                                          |

### Priorité P0 conditionnelle — garde-fous de livraison

Si les tests démontrent qu'un geste du Guide **s'applique à une autre cible que celle annoncée**, qu'une mutation se produit au changement de vue, ou qu'une reprise **réexécute** une opération incertaine, traiter cela comme **P0 bloquant**. Ce document n'affirme pas qu'un tel défaut existe déjà.

## 7. Libellés FR/EN recommandés (à traduire, ne pas figer en TS)

| Contexte           | Français proposé                                           | Anglais indicatif                                       | Condition                                    |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Vue locale         | Bon consulté                                               | Viewed receipt                                          | Bon existant                                 |
| Vue locale         | Passage et bilan                                           | Run and summary                                         | Lot existant                                 |
| Vue locale         | Autre préparation                                          | Other preparation                                       | Selon état actuel                            |
| Avertissement      | Le bon consulté diffère du dossier attendu par le passage. | The viewed receipt differs from the run's next dossier. | Divergence réelle                            |
| Action bascule     | Rejoindre le passage                                       | Go to run                                               | Checkpoint en attente                        |
| Action de lot      | Reprendre le passage                                       | Resume run                                              | En pause et admissible                       |
| Action de lot      | Revérifier ce passage (même liste)                         | Recheck this run (same list)                            | Manifeste figé                               |
| Action de création | Démarrer un nouveau passage                                | Start a new run                                         | Nouvelle création autorisée                  |
| Action de rapport  | Mettre le passage en pause et préparer ce dossier          | Pause run and prepare this dossier                      | Action réellement composée                   |
| Bilan              | Indicateurs pouvant se recouper                            | Counts may overlap                                      | Plusieurs compteurs affichés                 |
| Vue mobile         | Cibles du travail                                          | Work targets                                            | Au moins une cible connue                    |
| Préparation        | Approuver la préparation                                   | Approve preparation                                     | Seulement si `canApprove` et version valides |

Dans le texte utilisateur, ne pas remplacer « approuver la préparation » par « approuver la commandite » et ne pas traduire `awaiting_approval` par « approbation du bon » lorsque c'est un checkpoint de lecture locale.

## 8. Scénarios de réception V3

**Précondition générale :** données synthétiques ; épreuves Web/Node non exécutées par cette analyse ; conserver les scénarios actuels du blueprint et leurs `data-og7` quand pertinents.

1. Bon B consulté ; passage doit vérifier C ; paiement suivi A. Modifier seulement la sélection du bon et démontrer que les deux autres cibles ne changent pas. Vérifier libellés et contexte des actions.
2. Avant chaque action qui change de parcours, confirmer le bon ID/cible et l'effet de pause, sans déclencher de nouvelle mutation au simple clic de navigation.
3. `reader` peut lire les éléments autorisés mais ne voit pas de mutation suggérée comme exécutable ; une tentative d'accès API reste interdite.
4. Ouvrir les trois vues locales successivement pendant un passage en pause : aucune reprise ou requête POST ; conserver l'état du conducteur et le formulaire non soumis.
5. Ouvrir « Passage et bilan » en état de checkpoint obligatoire : accès à la confirmation de lecture ; revenir au Bon sans simuler un dossier vérifié.
6. Visiter les six positions numérotées et utiliser Précédent/Suivant : `processedCount` inchangé.
7. Lire le bon incomplet, puis satisfait, puis approuvé et historique : aucune approbation automatique, version et confirmation conservées.
8. Sélectionner un contrôle satisfait après relecture : annonce et bouton cohérents, aucun nouvel état de blocage fictif.
9. Page 1536 × 864, 1280 × 720, 1920 × 1080 avec zoom du système à 125 % ; vérifier chevauchements et hiérarchie d'actions.
10. Mobile 320/390 × 667/844, FR/EN, clavier virtuel et dock de manette : état de mode et navigation accessibles, CTA non masqué.
11. Zoom navigateur 200 %, thèmes clair/nuit/graphite, réduction des mouvements : lecture et focus sans décalage inattendu.
12. Tab/Shift+Tab, Home/End, ↑↓, lecteur d'écran : ordre DOM et annonces de sélection/situation explicites.
13. Manette simulée : A sélectionne / ouvre Autres actions / active CTA selon focus ; B, X, Y et LB/RB respectent le profil et les priorités de dialogue ; maintien/retour au neutre.
14. « Examiner le dossier » met le lot en pause et démarre la préparation ciblée selon ses contrats ; la conséquence est annoncée avant activation.
15. `Revérifier` réexamine seulement le manifeste courant ; un nouveau paiement n'est éligible qu'après un nouveau passage.
16. Pendant requête de lot, réduire/placer/fermer une vue ; relire le résultat et réconcilier une issue incertaine sans rejouer de mutation.
17. Rapport paginé : données historiques et bilan cohérents ; le total monétaire reste ventilé par devise, sans addition des catégories chevauchantes.
18. Si sauvegarde de préférences impossible ou session révoquée : message, effacement du contexte privé, pas d'ancienne réussite utilisée comme nouvelle preuve.
19. Vérifier deux instances du bon partagé, Guide et dossier/Campagnes : pas de divergence de version, décision ou confirmation ; les améliorations `guided=true` ne cassent pas les autres hôtes.
20. Valider la vue « Six parcours » sans dossier sélectionné, avec dossier et avec proposition future : repère lecture seulement ; le contenu « à réaliser » n'est pas une action.
21. Lorsque les traductions ou un module différé échouent, afficher l'erreur/reprise existante, sans supposer une préparation terminée.
22. Compléter les tests avec une manette Xbox One **physique** et des interactions réelles seulement dans un environnement approprié ; la simulation ne vaut pas qualification matérielle ou de services externes.

## 9. Découpage en PR recommandé

- **PR-1 — P1 Contexte et permissions :** références de cibles, libellés des changements d'activité, capacités visibles et tests de divergence B/C/A.
- **PR-2 — P1 Navigation interne :** vues locales Bon / Passage / Autre, accès aux checkpoints, mobile et état des conducteurs sans mutations involontaires.
- **PR-3 — P1 Clavier / Xbox / focus :** affichage des gestes contextuels, ordre DOM, navigation petite hauteur, priorités de confirmation.
- **PR-4 — P2 Lisibilité :** bilan chevauchant, rapport daté, libellés de CTA satisfait, répétitions et états de langue.
- **PR-5 — P2/P3 Finition :** responsive, thèmes, décors, 200 % zoom et validation transverse.

Chaque PR doit documenter les fichiers touchés, le comportement conservé, les tests réellement exécutés et ce qui reste non vérifié. **Aucun changement d'API ou d'état métier n'est exigé pour cette refonte de présentation.**

## 10. Sources

- `README.md` joint par l'utilisatrice, sections « Améliorations déjà réalisées », « Trois cibles indépendantes », « Bon courant et décisions », « Automatisation et validation humaine », « Pilotage Xbox et clavier », « Répétitions » et « Consigne V3 ».
- `captures/01-decouverte-desktop.png` à `captures/07-parcours-accord-desktop.png` : rendus datés et cadrages décrits par le README, avec données de test.
- Pour vérifier l'état réel, inspecter les chemins de composants listés dans la section « Architecture à réutiliser » du README **sur la copie de travail portant aussi les modifications non commitées**. Ne pas considérer le commit distant seul comme source de la refonte actuelle.
