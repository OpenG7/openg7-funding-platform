# Guide administratif OpenG7 — Spécification UX/UI corrective V3.2

**Statut : proposition, pas fonctionnalité livrée.** Fonctionnement de référence : snapshot fourni le 19 octobre ; refonte signalée par Codex comme commitée à `1108d8a9`. Le code courant prime si un écart est constaté.

## 1. Architecture des responsabilités — inchangée

| Surface                             | Responsabilité                                                                                                         | Limite non négociable                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Guide administratif**             | Orienter, expliquer, afficher les cibles, conduire la lecture ; exposer ses fonctions existantes de préparation privée | Ne pas transformer une consultation en décision métier              |
| **Bon partagé**                     | Présenter contrôles, version, contenu, historique ; déclencher son **unique approbation** autorisée                    | Ne pas republier ni approuver au simple changement de contrôle      |
| **Pilote du contrôle**              | Exposer le diagnostic du contrôle sélectionné, son **CTA déjà existant** et ses secondaires                            | Pas de nouveau moteur de décision ni liste codée en dur             |
| **Menu intégré « Autres actions »** | Donner accès aux commandes **secondaires** existantes selon rôle, contrôle, état et version                            | Aucun doublon du CTA ou de l'approbation ; aucun job à l'ouverture  |
| **Conducteur du lot**               | Créer volontairement le passage, vérifier/préparer selon API, gérer pause/reprise, rapport et réconciliation           | Aucune mutation lors d'une simple lecture ou d'un changement de vue |
| **Préparation ciblée**              | Choisir un sujet et appeler l'outil propriétaire explicitement enregistré                                              | Ne pas supposer qu'une navigation vaut enregistrement ou envoi      |
| **Écrans propriétaires**            | Modifier accords et médias, modérer, autoriser publication, facturer, rembourser, etc.                                 | Ne pas déplacer leurs mutations dans le Guide                       |

## 2. PR 1 — diagnostic principal + action existante + menu intégré

### 2.1 Réduire les couches visuelles sans supprimer l'identité du contrôle

Le **diagnostic explicatif central** doit apparaître comme une information cohérente : intitulé du contrôle, nature précise du manque, conséquence et état. **Le nom du contrôle peut et doit rester visible** à la fois dans la liste (pour choisir) et dans le détail sélectionné (pour se situer). Ne pas chercher à supprimer ces libellés au nom d'une règle générale « une seule fois ».

**Ce qui est redondant :** trois encadrés signalant exactement « aucune source d'accord enregistrée », puis un bouton plein écran répétant le même message.

**Ce qui n'est pas redondant :** une ligne « Publications promises » dans la liste de droite, et « Publications promises » dans le détail sélectionné, chaque surface remplissant une fonction différente.

Le CTA **existe déjà** hors du menu. Préserver sa source de descripteur, son propriétaire, ses conditions et son activation. Changer uniquement la composition CSS nécessaire pour le rendre proportionné et stable sur ordinateur ; largeur pleine possible sur mobile. « Approuver la préparation » demeure à sa place actuelle dans le bon partagé.

**Exemple desktop du contrôle sélectionné (présentation, pas données inventées)** :

```text
Préparation du bon                               4 / 7 contrôles satisfaits
──────────────────────────────────────────────────────────────────────────

Publications promises                                     À compléter
Accord d'origine manquant
Les prestations promises ne peuvent pas encore être établies.
  Pourquoi ?    Assistance

                                         [Compléter l'accord →]  (raccourci contextuel)
[Autres actions ▾]

                             Liste de contrôles — Publications promises
```

Règles : ne pas ajouter un second bouton `Compléter l'accord`, un second filtre « prêt », des métriques inventées ou une nouvelle source de vérité pour les contrôles ; préserver `not_required`, l'état reçu et la sélection après relecture.

### 2.2 Politique exacte « Autres actions »

**Implémentation préférée et demandée :** **liste compacte directement intégrée au contrôleur déjà existant**, fondée sur ses états `peek` et `open`. Pas de popover flottant, pas de superposition ni de gestion de clic extérieur ajoutée pour cette PR.

Le bouton du menu et les items utilisent les descripteurs/contextes existants et les autorisations serveur déjà prévues. Deux cas distincts :

- **Action absente/non applicable/non offerte à ce rôle :** ne pas créer d'entrée factice, ne pas exposer des données privées, ne pas afficher systématiquement une ligne grisée.
- **Action existante mais temporairement indisponible** (source manquante, requête en cours, version inadmissible) : si elle est présentée, la rendre inactivable et **expliquer sa raison** dans un texte accessible ; ne jamais fabriquer une justification non retournée par la projection ou le backend.

Exemples **conditionnels** d'actions secondaires réelles à conserver lorsqu'elles sont exposées : consulter les prestations dans Campagnes, ouvrir un historique existant, lire la source, examiner une proposition assistée, relancer une assistance spécialisée. La relance peut être une **mutation de job** : toujours déclenchement volontaire et contrôle de version, jamais à l'ouverture du menu.

**Définition de la fermeture :** reprendre les comportements déjà implémentés (`Retour`, `Échap`, B selon contexte), restituer le focus à l'ouvreur, recalculer ou fermer les actions lorsqu'on change de contrôle, de bon, de version, de mode ou de session. Les dialogues métiers prioritaires restent prioritaires. Ne pas inventer une nouvelle règle « clic extérieur ferme le menu » si elle n'existe pas aujourd'hui.

### 2.3 Clavier et Xbox : un même dispatch

| Situation réelle                                | Effet prévu, à vérifier dans le code avant modification                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| A avec focus sur un contrôle non sélectionné    | Sélectionner le contrôle ; aucune action métier                               |
| A sur le contrôle déjà sélectionné en `peek`    | Ouvrir les actions secondaires en `open`, pas déclencher le CTA               |
| A sur le CTA natif réellement focalisé          | Activer **ce CTA uniquement**                                                 |
| B / Échap dans les actions secondaires          | Fermer `open` et restaurer le focus sur le déclencheur                        |
| X/Y dans `open`                                 | Raccourcis du **profil courant** et des actions réellement disponibles        |
| Manette maintenue puis dialogue de confirmation | Exiger le retour au neutre ; pas de confirmation induite par la même pression |

Le mapping peut être personnalisé ; éviter une légende statique supposant que **A signifie toujours approuver**. Conserver LB/RB et le stick droit dans les portées actuelles. Ne pas faire d'escamotage arbitraire du focus lorsque le menu se referme.

### 2.4 Style discret, sans cacher l'information

- Palette claire : blanc ou ivoire, texte bleu marine, or comme accent **ponctuel** ; pas de bandeau d'alerte géant pour un simple prérequis.
- Une seule surface principale de diagnostic ; pas de boîte bleue > boîte crème > bouton jaune pleine largeur pour le même fait.
- Boutons 44 × 44 px minimum de cible si nécessaire ; contrastes, focus, texte « À compléter » lisibles sans couleurs.
- Limiter la réduction des composants au **Guide** : le reçu `AdminPreparationReceiptComponent` est partagé avec Campagnes et Publication. Toute modification globale requiert recette transverse.
- Tester notamment 1536 × 864 CSS (1920 × 1080 avec affichage Windows 125 %), 1280 × 720, 390 × 844, 390 × 667 et zoom 200 %, sans masquer le CTA ni le contrôle de retour.

## 3. PR 2 indépendante — sous-vues Bon / Passage / Autre

**Ne pas implémenter cette section dans PR 1.** Elle définit seulement les conditions d'une étape ultérieure après validation UX de PR 1.

```text
Préparation des dossiers
  [Bon consulté] [Passage et bilan] [Autre préparation]

Bon consulté       -> un bon sélectionné, contrôles, diagnostic, approbation
Passage et bilan   -> conducteur du lot, checkpoint, observation datée, rapport
Autre préparation -> conducteur ciblé, paiement/rubrique choisi, ses états
```

**État réellement à conserver au-delà du simple montage :** `carousel.position`, identifiant/révision du bon, contrôle sélectionné, mode `peek/open` à fermer/réévaluer au bon moment, scroll/focus pertinent, activité/`requestId`/brouillons non résolus de chaque conducteur, cible suivie et checkpoint du lot. Ne pas monter deux copies concurrentes d'un composant serveur pour préserver l'UI.

**Notification de checkpoint :** si le lot attend une lecture ou une action de passage pendant que l'utilisateur est sur « Bon consulté » ou « Autre préparation », afficher un repère **non intrusif** du type « Passage : lecture requise » et une commande « Rejoindre le passage » ; ne pas changer automatiquement de vue, mettre en pause, valider ni envoyer un POST en arrière-plan pour cette transition visuelle. Toujours revérifier la phase serveur lors du retour au passage.

**Trois cibles indépendantes :** bon B consulté, prochain dossier C du lot, paiement A suivi peuvent coexister. Le passage d'une vue à l'autre n'en synchronise aucun. Mentionner les trois cibles avec leurs bonnes références seulement lorsqu'elles sont disponibles, et rappeler la cible exacte dans toute confirmation d'action sensible.

**Indicateurs :**

- `Bon consulté : X / Y` = position dans le manifeste, pas dossiers examinés.
- `Dossiers contrôlés : X / Y` = avancement serveur du passage, pas longueur du carrousel.
- `Contrôles satisfaits : X / Y` = vérifications applicables de la version du bon sélectionné.
- « À traiter », « À clarifier » et « À vérifier » peuvent se **recouper** ; ne pas les additionner.
- `Dernière observation du passage` = **snapshot daté** avec horodatage/source si disponibles, **pas l'état courant du dossier**. Le rapport détaillé reste daté et comprend, selon les données disponibles, avant/après, auteur, preuve et audit. Une relecture fraîche du dossier doit être annoncée séparément comme telle.

**Bons partagés :** ne pas changer contrat de confirmation de l'approbation, route d'engagements, version historique d'offre, ou préparation/capacités métier.

## 4. Critères d'arrêt et preuve

PR 1 ne se conclut pas par « visuellement plus beau ». Elle est recevable si : un diagnostic central lisible, CTA toujours unique, menu **inline** compact, distinctions absent/désactivé, activation sûre au clavier/Xbox, aucune mutation involontaire et tests de non-régression sur Campagnes et Publication.

PR 2 ne commence pas avant validation explicite : elle exige preuve de restauration de la sélection, checkpoint joignable, événements en vol survivant aux sous-vues, horodatages exacts et navigation sans effet métier.

**P0 conditionnel :** mauvaise cible, double approbation, exécution métier à la lecture, ou rejeu d'une requête incertaine. Ne pas annoncer de P0 observé sans reproduction.
