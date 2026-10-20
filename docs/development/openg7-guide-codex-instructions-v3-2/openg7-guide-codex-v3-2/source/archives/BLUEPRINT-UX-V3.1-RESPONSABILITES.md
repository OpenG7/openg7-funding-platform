# OpenG7 Funding Platform — Guide administratif V3.1

## Addendum : séparation des responsabilités, menu « Autres actions » et interface apaisée

**Statut :** proposition de refonte UX/UI non implémentée.\
**Origine :** blueprint actuel du 19 octobre 2026 (révision `30e812a6e9f981e67a92022e040c84b7fdbd4bf2` + modifications locales non commitées), sept captures de recette synthétique, proposition V3 et échanges UX du 20 octobre 2026.\
**Référence fonctionnelle :** `source/README-blueprint-actuel.md` et le code de **l'arbre de travail effectivement ouvert dans Codex**.\
**Document antérieur conservé :** `source/blueprint-proposition-v3.md`. Le présent addendum précise les choix de V3 pour la responsabilité des composants et le contrôle sélectionné. Les autres recommandations V3 demeurent ouvertes, à vérifier dans le code actuel.

## 1. Décision centrale

**Le Guide doit accompagner et piloter les parcours explicitement prévus, sans devenir une copie des outils métier.** Ce principe possède une exception importante : le mode « Préparation des dossiers » pilote déjà un conducteur de lot qui peut, **sur action explicite**, appeler l'API `/api/admin/automatic-runs/advance` afin de vérifier un dossier et préparer des brouillons privés admissibles. Il ne faut **ni supprimer ce pouvoir existant**, ni l'assimiler à l'approbation de la préparation ou à la publication.

Trois classes d'effets :

1. **Lecture/orientation (L/N)** — expliquer, inspecter, changer de vue, sélectionner un contrôle, montrer une zone, naviguer dans les espaces propriétaires ; aucune décision métier.
2. **Préparation explicite (P/M délimitée)** — démarrer/reprendre le conducteur autorisé, vérifier/préparer un dossier via son POST actuel, préparer des brouillons privés ou lancer une assistance existante ; droits, limites, versions, machine d'état, confirmations propres et reçus restent applicables.
3. **Décision métier / effet externe (M/E)** — approuver une préparation versionnée, modérer, publier, modifier l'offre, envoyer un courriel, rembourser. Ces actes **demeurent exclusivement dans leur propriétaire et leur parcours de confirmation existants** ; aucun contrôle générique du Guide ne doit les exécuter implicitement.

**Ne pas créer** de nouveau moteur de lot, moteur d'accord, permission parallèle, assistant LLM fictif, route de modération ou écran média autonome. Préserver les 4 modes, le panneau **non modal**, le carrousel numéroté, la séparation des 3 cibles (bon consulté / prochain dossier du lot / paiement suivi), les sous-vues V3 envisagées et les raccourcis Xbox réaffectables.

## 2. Responsabilités : frontières à respecter

| Zone                           | Responsable actuel / à conserver                      | Affichage/commande autorisée                                                                                 | Ne doit pas devenir                                                      |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Enveloppe du Guide             | `admin-guidance` + `admin-layout`                     | Ouvrir, réduire, déplacer, indiquer le mode et la rubrique courante                                          | Éditeur universel ni boîte modale de validation                          |
| Découvrir                      | Guide pédagogique                                     | Lecture des 3 étapes, surbrillance et focus                                                                  | Validation de tâche ou clic métier automatique                           |
| Suivi d'un paiement            | `admin-payment-journey`                               | Faits serveur, responsabilité, navigation explicitement ciblée                                               | Création d'un paiement ou commande de validation Stripe                  |
| Préparation des dossiers — lot | `admin-automatic-portfolio`, machine existante et API | Lire, commencer/reprendre/pauser/revérifier selon état, `advance` volontaire, réconcilier                    | Réécriture du manifeste ni approbation de commandite                     |
| Bon consulté                   | `admin-preparation-carousel` et reçu partagé          | Position, sélection du contrôle, projection de progression, approbation unique existante                     | Deuxième fiche de préparation indépendante                               |
| Diagnostic du contrôle         | `preparation-pilot` / projection / liste              | Motif unique, explication sur demande, CTA de navigation vers propriétaire                                   | Reprise des formulaires métier dans le Guide                             |
| **Autres actions**             | `preparation-context-actions` + contrôleur natif      | Menu secondaire filtré par rôle/état/contrôle/version                                                        | Deuxième panneau de traitement complet, clone du CTA ou de l'approbation |
| Aide / analyse de l'accord     | Composants d'assistance et d'accord existants         | Consulter source/proposition ; relancer l'analyse **si la capacité existe réellement**, via son propriétaire | Nouveau job d'IA déclenché sur simple ouverture du menu                  |
| Campagnes / engagements        | Écrans et services Campagnes/accord                   | Consulter/documenter/qualifier selon parcours métier                                                         | Formulaire d'accord recopié dans la fiche du Guide                       |
| Revue/modération               | Flux de revue et panneau transversal                  | Rejoindre le sujet/version exacts et la modération existante                                                 | « Accepter » transversal ou conclusion implicite                         |
| Publication et livraison       | Brouillons, moteur et tiroir partagé                  | Consulter contexte/état, ouvrir l'espace propriétaire                                                        | Déclenchement d'envoi social à partir d'une simple lecture               |
| Xbox/contrôleur                | `controller.service` + navigation + descripteurs      | Actions selon profil courant, focus, priorité et neutralité                                                  | Table A/B/X/Y codée en dur dans le composant Guide                       |

## 3. Nouvelle composition du contrôle sélectionné

### 3.1 Une seule information centrale

Le contrôle sélectionné affiche **une seule fois** :

- son intitulé métier (ex. « Publications promises »),
- le constat compréhensible (ex. « Accord d'origine manquant »),
- l'effet concret (ex. « Les prestations promises ne peuvent pas encore être établies »),
- l'état factuel (« À compléter », « Vérifié », « Non requis », « Indisponible », etc., selon la projection réelle),
- **une seule action principale** issue du descripteur existant, ou aucune si le contrôle ne le permet pas.

« Pourquoi ? » et « Assistance » peuvent être des entrées de lecture discrètes si leurs organismes existent et leurs capacités sont disponibles. Elles ne doivent pas répéter mot pour mot le constat dans de gros panneaux imbriqués. Si le contrôle devenu satisfait conserve sa sélection après relecture, ne pas promettre « Compléter » si l'action réelle est désormais consulter ou modifier ; consulter les descripteurs du contexte.

### 3.2 Hiérarchie visuelle souhaitée

```
Préparation                               4 contrôles satisfaits / 7
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━             3 à compléter

Publications promises              [À compléter]
Accord d'origine manquant
Les prestations promises ne peuvent pas encore être établies.
[Pourquoi ?]  [Assistance]
                                   [Compléter l'accord  →]  (A si réellement associé)
[Autres actions  ▾]
```

Cette structure constitue un **exemple de présentation**, pas une nouvelle source de données ni une refonte des règles. Dans le contexte réel du Guide, le contrôle peut cohabiter avec la liste à droite et l'approbation du bon partagé.

### 3.3 Politique de style

- **Éviter l'empilement** d'une carte bleu/gris contenant un bandeau jaune contenant lui-même un grand bouton jaune pleine largeur.
- Utiliser le blanc/blanc cassé comme surface de base, bleu marine pour le texte, or comme **accent**, pas comme fond dominant ; préférer une séparation par espacement et typographie à trois bordures imbriquées.
- Bouton principal proportionné au contenu : taille adaptée, emplacement stable, au moins 44 × 44 px de cible. Sur petits conteneurs, sa largeur peut devenir complète **si nécessaire à la lisibilité**, pas par défaut desktop.
- Conserver l'état et le motif accessibles **par texte**, non par couleur uniquement. Ne pas rendre un contrôle non satisfait automatiquement « erreur grave ».
- Ne pas multiplier pictogrammes, halos ou bandeaux d'alerte pour un prérequis ordinaire.
- Le fond illustré, le dragon et la princesse/le lion peuvent rester décoratifs, mais n'empiètent pas sur l'espace de travail et disparaissent aux hauteurs contraintes. Tous les thèmes et les deux langues sont concernés.

## 4. Menu « Autres actions » : contrat V3.1

### Objectif

Le menu répond à une seule question : **« Quelles opérations complémentaires sont disponibles pour ce contrôle, en plus de l'action principale ? »**

### Contenu

1. **Navigation/consultation** : ex. « Voir les prestations dans Campagnes », historique accessible, liens de lecture vers source connue.
2. **Assistance spécialisée** : ex. « Examiner la proposition assistée », « Voir la source », « Relancer l'assistance » **uniquement si fournies par les descripteurs et les capacités existants** ; préserver leurs garde-fous et le fait que relancer peut déclencher un vrai job.
3. **État indisponible** : si la commande existe mais manque un prérequis, elle peut apparaître désactivée avec une **raison concise** ; si elle n'existe pas pour ce rôle/contrôle, ne pas créer un item fictif.

Ces catégories sont une **présentation éventuelle**, pas trois nouvelles machines fonctionnelles ni des routes. L'état exact de l'offre/assistance peut faire varier fortement la liste ; ne pas hardcoder une liste statique de trois actions.

### Règles fermes

- L'unique CTA principal n'apparaît **jamais** une deuxième fois dans « Autres actions » ; idem pour **Approuver la préparation**, qui appartient au bon partagé et suit sa confirmation dédiée.
- Le menu est **fermé initialement** ; il s'ouvre de façon volontaire par son bouton natif ou le raccourci du contexte courant, avec focus sur la première commande admissible.
- La liste provient des **descripteurs existants**, filtrés selon rôle, capacités, disponibilité, contrôle sélectionné et version ; `permission` serveur demeure l'autorité.
- Le menu conserve les accès actuels vers Campagnes, historique et assistance lorsque pertinents. Un transfert visuel vers une section d'assistance est autorisé **seulement s'il conserve une entrée équivalente, un propriétaire unique et les mêmes préconditions**.
- La sélection du contrôle/bon, sa version, le changement de mode ou l'expiration de session ferment le menu ou réévaluent ses actions ; aucune commande retardée ne reste liée à une ancienne cible.
- « Retour », B ou Échap ferment l'état `open` et restituent le focus au déclencheur selon la navigation existante ; ne pas exposer deux boutons « Retour » visuellement identiques pour le même niveau de fermeture.
- Une action de consultation ne devient pas un « job » ; une action de relance existante reste explicitement identifiée comme traitement et passe par l'autorisation/réconciliation du propriétaire.
- Si le menu ne contient aucune action admissible, annoncer « Aucune autre action disponible pour ce contrôle » et désactiver/masquer l'ouverture selon le comportement accessible le plus cohérent avec le contrôleur (à confirmer dans le code).

### Effet clavier et Xbox

- **Sur un contrôle non sélectionné**, A peut le sélectionner.
- **Sur le contrôle déjà sélectionné en mode `peek`**, A ouvre les actions secondaires : ce geste n'exécute pas le CTA.
- **Sur le bouton principal focalisé**, A active sa commande native.
- **Dans les actions ouvertes**, B retourne à `peek` et au déclencheur ; les actions X/Y restent contextuelles (assistance/source/historique selon le profil courant).
- Le mapping A/B/X/Y est **réaffectable**. Afficher l'action annoncée pour le profil actif, jamais un mapping global inventé. Aucune capture ne prouve l'utilisation d'une manette physique.
- Les confirmations prioritaires empêchent tout geste maintenu de confirmer une deuxième fois (retour au neutre).

## 5. Bon, lot, préparation ciblée : ne pas déplacer les responsabilités

La V3 a proposé trois vues de présentation : **Bon consulté**, **Passage et bilan**, **Autre préparation**. Cette proposition reste valable, sous conditions :

- Le **bon** indique le contrôle et son action ; son approbation reste une décision à part, conditionnée à version/rôle/confirmation.
- Le **lot** possède son propre checkpoint et sa progression. `Bon consulté X/Y` est une position de navigation ; `Dossiers contrôlés X/Y` est une opération serveur ; `Contrôles satisfaits X/Y` concerne le bon. Les chiffres ne sont pas interchangeables.
- Le **bilan** est une lecture d'observations datées. « À traiter », « À clarifier » et « À vérifier » peuvent se recouper et ne doivent pas être additionnés.
- **Autre préparation** démarre un travail ciblé distinct du lot. Le Guide ne doit pas démarrer la préparation à la simple activation de l'onglet de présentation.
- Les changements de vue ne doivent pas remonter/détruire des sous-composants contenant une requête en vol, des identifiants idempotents ou un brouillon local.
- Les changements visuels n'affectent jamais le manifeste figé ; `Revérifier` réexamine le même manifeste, tandis qu'un nouveau passage est nécessaire pour de nouveaux paiements.
- En cas de relecture ou d'issue incertaine, afficher un état exact et préserver la réconciliation sans POST répété.

## 6. Priorités de mise en œuvre — nouveaux écarts G31

| Écart      | Priorité | Constat / objectif                                                          | Propriétaire probable                                    | Critère de réussite                                                                       |
| ---------- | -------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **G31-01** | P1       | Menu secondaire contient ou suggère trop d'intentions concurrentes          | `preparation-context-actions` + contrôleur               | Unique CTA hors du menu ; toutes les actions secondaires admissibles toujours accessibles |
| **G31-02** | P1       | Action et responsabilité du Guide confondues avec décision métier           | `admin-guidance`, `admin-automatic`, `preparation-pilot` | Aucun clic de lecture/menu ne déclenche une décision ; `advance` volontaire conservé      |
| **G31-03** | P1       | Focus Xbox variable et conséquence du prochain geste insuffisamment visible | `controller.service`, contrôleur natif, menu             | Le geste annoncé correspond à l'action exécutée selon focus/profil                        |
| **G31-04** | P1       | Contrôle sélectionné réexplique trois fois le même prérequis                | `preparation-pilot`, `preparation-issue-list`, styles    | Un constat principal ; détails accessibles sans duplication textuelle dominante           |
| **G31-05** | P2       | CTA jaune pleine largeur et boîtes imbriquées envahissent le travail        | Styles `preparation-pilot` / reçu partagé                | Interface sobre et lisible sur desktop et mobile ; contraste mesuré ; 44 px min           |
| **G31-06** | P1       | Actions disponibles/indisponibles changent avec contrôle, version et rôle   | Descripteurs et contrôleurs existants                    | Aucune action orpheline après changement ; motif d'indisponibilité exact                  |
| **G31-07** | P1       | Actions d'assistance peuvent déclencher des jobs, pas de simples lectures   | Assistance existante / actions contextuelles             | Aucun déclenchement sur ouverture ; job initié seulement explicitement et selon capacités |
| **G31-08** | P2       | Présentation multi-vues Bon / Passage / Autre demeure à vérifier dans code  | `admin-automatic.component`                              | Les vues réduisent le scroll sans modifier cycles de vie et sans POST implicite           |
| **G31-09** | P2       | Retour du module métier perd parfois le point du contrôle                   | Navigation existante                                     | Retour bon/version/focus quand garanti ; ne pas promettre un retour universel inexistant  |
| **G31-10** | P2       | Historique vide ou assistance indisponible peu explicites                   | Menu / assistance                                        | État vide réel et prérequis compris sans faux succès ni fausse disponibilité              |

**Priorité P0 uniquement si un test démontre** une action sur une mauvaise cible, une décision implicite, une duplication d'approbation ou un rejeu de mutation incertaine. Ce document ne conclut pas à l'existence de ces défauts.

## 7. Wireframes de principe

### Desktop : contenu centré et menu discret

```
┌─ Guide administratif · Préparation des dossiers ─────────────────────────────┐
│ [Bon consulté] [Passage et bilan] [Autre préparation]             [Réduire]  │
│ Bon 3/6 · DEMO-PREP-003              Dossiers contrôlés 3/6 (portée lot)   │
│ ┌──────────────────────────────────────────┬─────────────────────────────┐ │
│ │ Préparation · 4/7 contrôles satisfaits    │ À compléter (3)            │ │
│ │ ────────────────────────── 57 %           │ Publications promises       │ │
│ │ Publications promises       À compléter  │ Présentation et contenus   │ │
│ │ Accord d'origine manquant                │ Modération                 │ │
│ │ Prestations promises non établies.       │ ▸ Vérifiés (4)             │ │
│ │ [? Pourquoi] [✧ Assistance]              │                             │ │
│ │       [Compléter l'accord →]             │                             │ │
│ │ [⋯ Autres actions ▾]                    │                             │ │
│ │ (optionnel : menu contextuel compact)   │                             │ │
│ └──────────────────────────────────────────┴─────────────────────────────┘ │
│        [Précédent]                    [Suivant]                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Mobile : une seule colonne

```
┌─ Guide · Préparation ──────────────────┐
│ Bon 3/6 · Controles 4/7                │
│ Publications promises · À compléter    │
│ Accord d'origine manquant              │
│ Les prestations ne sont pas établies.  │
│ [? Pourquoi] [Assistance]              │
│ [Compléter l'accord →]                 │
│ [⋯ Autres actions ▾]                   │
│ ▸ Autres contrôles (3)                  │
│ ▸ Vérifiés (4)                          │
│ [Précédent]           [Suivant]        │
└────────────────────────────────────────┘
```

Ces schémas ne décident pas de l'ordre DOM ni de la priorité Xbox : les composants réels le font. Exiger un parcours clavier/lecteur d'écran cohérent avant d'implémenter le défilement compact.

## 8. Critère général de livraison

**Le dossier est simplifié, mais aucune action existante n'est perdue** ; les actions métier demeurent versionnées, autorisées, tracées et confirmées dans leurs écrans. Toute refonte visuelle doit être testée en mode lecteur et opérateur/propriétaire, sur desktop/mobile/FR/EN, thèmes clair/nuit/graphite, clavier et profils Xbox simulés. Seuls des tests réellement exécutés pourront être présentés comme réussis.
