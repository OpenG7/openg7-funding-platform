# Blueprint du panneau Guide pour inspection UI UX

**État antérieur à la refonte du 19 octobre 2026.** Pour la prochaine inspection
et la préparation de la V3, utiliser le
[nouveau blueprint de l’état actuel et ses captures](openg7-guide-blueprint-etat-actuel/README.md).
Les constats et wireframes ci-dessous conservent leur portée initiale.

Ce document peut être joint tel quel à ChatGPT. Il décrit le panneau flottant
**Mode guidé**, ouvert notamment par le bouton **Guide** de l’administration
OpenG7 Funding. Il fournit la structure, les interactions et les contraintes
nécessaires pour examiner sa compréhension, sa densité et son usage avec la page.

État du code au **19 octobre 2026**, révision **30e812a6**. Les schémas sont des
wireframes descriptifs, sans échelle, et ne représentent pas des captures du
navigateur. L’inventaire fonctionnel détaillé reste le
[blueprint du Guide administratif](admin-guide-blueprint.md).

## Consigne à soumettre à ChatGPT

> Agis comme un spécialiste senior de conception d’interfaces administratives et
> d’expérience utilisateur. Inspecte le panneau décrit dans ce document pour un
> administrateur qui doit comprendre la situation, retrouver une action et garder
> la maîtrise de ses décisions.
>
> Analyse d’abord l’existant, puis propose une amélioration. Sépare les faits
> décrits, les risques que tu en déduis et les points nécessitant une capture ou
> un essai. Les liens vers les sources servent à la traçabilité : le document doit
> suffire à ton analyse fonctionnelle. N’invente pas de contenu d’écran manquant.
>
> Examine le modèle mental « Guide », l’architecture des quatre modes, les
> priorités visuelles, les libellés, le nombre d’actions concurrentes, la reprise,
> les erreurs et le recouvrement de la page. Évalue aussi le clavier, le focus,
> les lecteurs d’écran, les petites hauteurs, le zoom, les écrans tactiles et les
> variantes de langue et de thème. Ne conclus pas à une conformité d’accessibilité
> à partir de ce seul blueprint.
>
> Distingue une aide à la lecture, un suivi de dossier, une préparation et une
> commande métier. Conserve les autorisations, confirmations et responsabilités
> décrites. Le paiement confirmé, la préparation, l’approbation et la publication
> doivent rester des faits distincts. Les pistes futures déjà présentes dans
> l’aide ne sont pas des fonctions livrées.
>
> Rends :
>
> 1. Un diagnostic bref du modèle mental et des trois principaux problèmes.
> 2. Un tableau des constats : zone, scénario concret, fait ou hypothèse,
>    conséquence utilisateur, gravité, recommandation et critère de réussite.
> 3. Une architecture de contenu proposée, en justifiant ce qui reste dans le
>    panneau et ce qui devrait rejoindre un écran propriétaire.
> 4. Un wireframe desktop et un wireframe mobile de cette proposition, avec
>    priorité des actions et libellés français recommandés.
> 5. Une liste des états à concevoir et un plan de vérification par scénarios.
> 6. Une priorisation P0 à P3 et les informations visuelles manquantes pour
>    confirmer tes conclusions.
>
> Réserve P0 à un risque de décision ou d’effet métier grave, P1 à un obstacle
> majeur, P2 à une difficulté récurrente et P3 au confort. Relie chaque priorité
> à un scénario ; ne transforme pas une préférence esthétique en défaut prouvé.

## Contexte utilisateur et responsabilités

La plateforme administre contributions, commandites, facturation et publication.
Le panneau accompagne des pages de travail contenant déjà listes, dossiers,
commandes et confirmations. Une personne peut découvrir l’interface, suivre un
paiement précis ou travailler sur des préparations et des lots. Ces intentions
cohabitent actuellement dans la même carte.

L’interface existe en français canadien et en anglais. Les accès administratifs
sont différenciés : lecteur, opérateur et propriétaire. Les droits effectifs
restent vérifiés par l’API ; la présence d’un bouton ne prouve pas sa permission.

| Intention                             | Mode actuel             | Conséquence possible                                                       |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Comprendre la rubrique                | Découvrir les rubriques | Lecture, focus, défilement, repère local                                   |
| Savoir quoi faire pour un paiement    | Parcours du paiement    | Lecture privée du serveur et navigation                                    |
| Préparer et contrôler des dossiers    | Automatique             | Navigation, préparation, commandes serveur et confirmations selon l’action |
| Comprendre un enchaînement de travail | Six parcours            | Lecture, exploration d’étapes et mise en évidence de zones                 |

Stripe confirme les paiements. Une étape parcourue ne valide aucune opération.
Une préparation n’autorise pas une publication. Les actions sensibles gardent
leurs confirmations et leurs contrôles serveur, y compris lorsqu’elles sont
accessibles depuis le panneau.

## Position dans la page et entrées

Le panneau est intégré au layout commun, entre l’en-tête administratif et le
contenu principal. Il apparaît seulement avec une session administrative
disponible et une route du catalogue des 20 rubriques. Sans préférence enregistrée,
il est réduit et le mode sélectionné est la découverte.

- **Mode guidé** ouvre ou réduit la carte.
- **Guide**, dans le contrôleur, ouvre la même carte en conservant son mode.
- **Suivre ce paiement**, dans un contexte admissible, ouvre le suivi du paiement.
- **Démarrer un nouveau passage**, dans l’en-tête commun, ouvre Automatique et
  peut démarrer le passage après relecture ; un passage incomplet bloque ce
  nouveau démarrage.

```text
┌──────────────────────── Administration ──────────────────────────┐
│ En-tête commun                              [Nouveau passage…]  │
│ [Mode guidé]                                      [Contrôleur] │
├─────────────────────────────────────────────────────────────────┤
│ Page de travail                       ┌───────────────────────┐ │
│                                       │ Carte Mode guidé      │ │
│ Listes, dossier et actions             │ Barre commune         │ │
│ restent utilisables                   │ Choix du mode         │ │
│                                       │ Contenu du mode       │ │
│ Zone montrée : contour et halo dorés   │ Mémorisation          │ │
│                                       └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Il s’agit d’une `section` non modale : aucun voile de fond ni confinement du
focus. Les dialogues de confirmation et panneaux prioritaires conservent leur
priorité. Le **Guide pas à pas** du poste de pilotage et de **Ma semaine** est
une autre interface, réellement modale, avec une progression distincte.

## Structure commune du panneau

```text
┌─────────────────────────────────────────────────────────┐
│ [icône · Réduire le guide]            [Placer en bas]    │ A
│ Vous êtes ici · Contributions                           │ B
├─────────────────────────────────────────────────────────┤
│ [Découvrir les rubriques] [Parcours du paiement]         │ C
│ [Automatique]             [Six parcours]                 │
│                                                         │
│ Contenu du mode sélectionné                             │ D
│                                                         │
│ Message de cible absente ou de mémorisation impossible   │ E
│ ▸ Le guide conserve la rubrique, l’étape et…              │ F
│   [Effacer mon repère] lorsque ce volet est déplié        │
└─────────────────────────────────────────────────────────┘
```

| Zone | Comportement existant                                                              | Point d’attention pour l’inspection                            |
| ---- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A    | Deux boutons ; réduire conserve les repères, déplacer alterne haut et bas          | Sens prévisible de réduire, fermer et interrompre une activité |
| B    | Rubrique courante ; masquée visuellement dans les modes compacts                   | Distinguer page courante et paiement suivi                     |
| C    | Quatre boutons avec état `aria-pressed`, disposition flexible sur plusieurs lignes | Lisibilité des intentions et stabilité des emplacements        |
| D    | Un seul mode monté à la fois ; Automatique et Six parcours chargés à la demande    | Différences de densité, chargement et changement d’activité    |
| E    | Messages de statut ; échec d’effacement également visible carte réduite            | Visibilité, persistance et action de récupération              |
| F    | Un `details` dont le résumé est une longue phrase de confidentialité               | Découvrabilité du réglage et portée de l’effacement            |

Dans **Automatique** et **Six parcours**, la barre devient plus compacte : le
contexte « Vous êtes ici » est masqué visuellement ; Découvrir et Paiement sont
représentés par des icônes avec nom accessible et infobulle. Dans Automatique,
Six parcours devient aussi une icône. Les boutons de mode restent sur une seule
ligne dans les modes compacts. Le sélecteur change donc d’apparence avec
le mode choisi. Ce ne sont pas des onglets ARIA avec navigation par flèches
déclarée dans le template parent.

## Contenu du mode Découvrir les rubriques

Chaque rubrique comporte trois étapes de lecture. Exemple réel, première étape
de **Contributions** :

```text
Un pas à la fois                         Étape 1 sur 3
Lire les faits financiers
Repérez la contribution, son montant, sa devise et son statut.
Stripe confirme le paiement.

[Me montrer dans la page]
[Étape précédente — désactivé] [Étape suivante — principal]
                                          [Faire une pause]
Ces étapes aident à se repérer. Elles ne confirment aucune opération.
```

**Me montrer dans la page** déplace le focus et fait défiler vers une zone,
avec contour et halo. Plusieurs zones visibles d’une liste peuvent être
soulignées ensemble. Aucun bouton métier n’est activé. Si une cible manque, un
message l’explique ; la découverte peut se rabattre sur le contenu principal.

À la dernière étape, **Revenir à la première étape** remplace Étape suivante.
En pause, le texte de l’étape et ses contrôles disparaissent au profit du repère
enregistré et de **Reprendre mon repère**. Lorsque le repère appartient à une
autre rubrique, **Continuer ici** permet de le remplacer. Hors pause, le rappel
de cette autre rubrique peut coexister avec l’étape de la rubrique actuelle.

## Contenu du mode Parcours du paiement

Le paiement suivi est choisi explicitement. Ouvrir un autre dossier ne le
remplace pas : **Suivre ce paiement** propose ce remplacement lorsqu’un autre
contexte valide existe.

```text
Parcours du paiement
[Suivre ce paiement]                  si contexte différent
Référence suivie · état du parcours · étapes réglées X / Y

Votre prochaine étape
Titre de la responsabilité et motif issus du serveur
[Ouvrir la prochaine étape]           libellé adapté à l’attente
[Me montrer dans la page]             si destination exacte présente

▸ Voir tout le parcours               jalons, états et raisons
[Vérifier les faits]                  [Faire une pause]
Le paiement et les actions terminées viennent du serveur…
```

La prochaine étape peut exiger une action humaine, attendre la plateforme ou
être bloquée. **Ouvrir la prochaine étape** relit d’abord les faits ; une
recommandation modifiée est présentée avant une nouvelle décision. La navigation
ne réalise pas l’opération. **Me montrer dans la page** exige le bon dossier et
la bonne destination ; aucune zone étrangère ne sert de repli.

Sans paiement choisi, un texte invite à ouvrir une contribution ou un dossier.
En pause, **Reprendre ce paiement** remplace le contenu actif. Pendant une lecture
ou après une erreur, les anciennes données sont retirées. « Parcours à jour »
signifie que le serveur ne signale plus d’action restante, avec possibilité de
réouverture d’une étape à réception de nouveaux faits.

## Contenu du mode Automatique

Ce mode héberge une surface de travail plus large que l’aide contextuelle.
L’ouvrir charge un passage existant sans le démarrer ni le reprendre
automatiquement. Son contenu dépend du passage et des capacités disponibles.

```text
Préparation des dossiers
Position du bon consulté / nombre de bons
[Actualiser] [Précédent] [Suivant]
Bon de préparation partagé
  contrôles · contenu · historique · assistance selon droits
  accès aux prestations dans Campagnes
  approbation de préparation via confirmation si admissible

▸ Suivi du lot                       phase et progression visibles
  [Démarrer / Reprendre / Pause / Actualiser / Revérifier]
  Point de lecture : Périmètre → Dossier → Résultat → Bilan
  [J’ai lu, continuer]
  ▸ Rapport par dossier              entrées et preuves paginées

▸ Autre préparation                  ouverte sans passage
  Choisir paiement ou rubrique
  [Démarrer la préparation / Relire et reprendre]
  Phase · motif · prochaine responsabilité
  Actions contextuelles et pause
```

Les commandes ci-dessus sont conditionnelles, et ne sont pas toutes proposées
simultanément. La position consultée dans le carrousel est indépendante du nombre
de dossiers contrôlés. Consulter le bon suivant ne contrôle pas ce dossier.

**J’ai lu, continuer**, après l’aperçu Dossier, peut déclencher un contrôle
serveur et les préparations privées admissibles. Cet accusé de lecture n’est pas
une approbation de préparation ni une autorisation de publication.

L’approbation du bon est une commande distincte, sur une version explicite et
avec confirmation. Le résultat du lot et son rapport sont conservés côté
serveur. Un résultat incertain impose **Réconcilier le résultat serveur**, puis
**Vérifier le résultat sans rejouer** dans un dialogue ; la reprise reste séparée.

**Examiner le dossier** et **Voir le suivi**, dans le résultat ou le rapport,
mettent le lot en pause et démarrent l’outil de préparation ciblée. L’inspection
doit examiner si ces libellés permettent d’anticiper ce changement d’activité.

L’outil ciblé rejoint les écrans propriétaires et ouvre les préparations
déclarées par leurs composants. Les formulaires et confirmations métier restent
dans ces écrans. Une pause empêche la suite du conducteur ; une requête déjà
envoyée peut encore aboutir. Réduire la carte interrompt le conducteur navigateur
actif, sans annuler rétroactivement une requête serveur.

## Contenu du mode Six parcours

L’explorateur contient six parcours et 21 étapes : accord de commandite,
préparation, autorisation, livraison, fiche Web et suivi historique.

```text
Explorer les six parcours
Explorer le guide ne prépare, n’autorise et ne publie rien.
▸ Choisir un parcours · parcours courant
Objectif du parcours
[1] [2] [3] […]                         étape au choix

Titre de l’étape
Action à examiner                       explication
Résultat attendu                        explication

[Étape précédente] [Étape suivante]
[Montrer cette zone] [Arrêter le parcours / Reprendre le parcours]
▸ Emplacement actuel / Organisation proposée · à réaliser
```

Les étapes sont librement consultables. Montrer une zone exige un dossier de
commandite dans son onglet Publication ; sinon un message et **Ouvrir un dossier
de commandite** permettent de rejoindre ce contexte. La mise en évidence peut
ouvrir des volets de lecture, sans activer les commandes métier.

Le volet **Organisation proposée** décrit des pistes futures marquées à réaliser.
Leur présence dans l’aide ne signifie pas que cette organisation est disponible.
La pause retire la surbrillance sans fermer les formulaires du dossier.

## Dimensions et langage visuel

Les valeurs en pixels ci-dessous supposent une racine à 16 px. Le layout peut
modifier les dimensions selon le contrôleur et le contexte de pilotage.

| Propriété                                           | Valeur déclarée ou comportement                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Placement desktop par défaut                        | Position fixe, en haut à droite ; haut 6 rem, soit 96 px                                                       |
| Largeur habituelle                                  | Maximum 32 rem, soit 512 px ; limitée aussi par l’espace disponible                                            |
| Hauteur habituelle                                  | Maximum de base `min(36rem, 70dvh, 100dvh - 7.5rem)`, avec surcharges du layout                                |
| Hauteur de base Automatique                         | `min(45rem, 100% - 7.5rem)` ; également modifiée par le layout                                                 |
| Variante Automatique élargie                        | À partir de 48 rem, jusqu’à 62 rem si le pilotage de préparation porte des problèmes                           |
| Placement bas                                       | Alternance volontaire haut/bas ; déplacement automatique également possible pour dégager une zone montrée      |
| Petit écran jusqu’à 480 px                          | Largeur du viewport moins 1,5 rem, marge latérale 0,75 rem, boutons d’étape empilés                            |
| Avec coque de contrôleur jusqu’à 480 px             | Hauteur maximale plafonnée à 45 dvh                                                                            |
| Avec simulateur de contrôleur ouvert jusqu’à 860 px | Espace inférieur réservé au dock de 34 dvh ; placement bas au-dessus du dock                                   |
| Défilement                                          | Barre commune hors du corps défilant ; modes, contenu et confidentialité défilent ensemble                     |
| Carte                                               | Bordure 1 px, rayon 1,1 rem, ombre portée ; surface opaque                                                     |
| Boutons                                             | Hauteur minimale courante 2,75 rem, soit 44 px ; marges intérieures et texte réduits dans la variante compacte |
| Typographie                                         | Segoe UI puis polices système ; petites informations à 0,875 rem, navigation à 0,9375 rem, selon préférences   |
| Animation d’ouverture                               | 180 ms, fondu et léger déplacement, seulement sans préférence de mouvement réduit                              |

```text
Petit écran · découverte ouverte
┌──────────────────────────────────┐
│ [Réduire le guide] [Placer en bas]│
│ Vous êtes ici · Contributions    │
├──────────────────────────────────┤
│ Modes sur plusieurs lignes       │
│                                  │
│ Étape 1 sur 3                    │
│ Titre et explication             │
│ [Me montrer dans la page       ] │
│ [Étape précédente — désactivé  ] │
│ [Étape suivante               ] │
│ [Faire une pause              ] │
│ Notice et mémorisation           │
└──────────────────────────────────┘
  Corps défilant selon la hauteur
  Carte superposée à la page
```

Trois thèmes sont déclarés. Ils partagent une hiérarchie fond, surface, texte,
texte secondaire et accent. La couleur seule ne suffit pas à prouver le contraste
de tous les états.

| Thème    | Surface   | Texte     | Texte secondaire | Action principale |
| -------- | --------- | --------- | ---------------- | ----------------- |
| Clair    | `#ffffff` | `#172b50` | `#52627b`        | `#edca72`         |
| Nuit     | `#142338` | `#f1f5fc` | `#bdcbe0`        | `#f4c957`         |
| Graphite | `#25292f` | `#f3f4f6` | `#c4cbd5`        | `#f1ce80`         |

La découverte utilise un bouton principal doré pour Étape suivante. Les modes
sélectionnés ont une bordure dorée. Les repères dans la page reçoivent un halo
doré ; trois pulsations douces précèdent le halo fixe lorsque le mouvement est
autorisé.

## États et reprise à inspecter

| État ou transition                                        | Présentation et comportement actuels                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Réduit                                                    | Bouton Mode guidé ; mode et repères conservés, sans contenu de mode visible                                     |
| Ouvert                                                    | Barre commune, sélecteur, mode et confidentialité                                                               |
| Session absente ou révoquée                               | Panneau retiré ; le stockage local ne constitue pas une permission                                              |
| Route non cataloguée                                      | Panneau absent                                                                                                  |
| Chargement Automatique ou Six parcours                    | Texte de chargement annoncé comme statut                                                                        |
| Échec de chargement de ces modes                          | Alerte invitant à recharger la page, sans bouton local de réessai                                               |
| Paiement en lecture                                       | Message de vérification, anciennes étapes retirées, actualisation désactivée                                    |
| Paiement en erreur, interdit, introuvable ou indisponible | Message distinct, sans faits anciens présentés comme actuels ; actualisation et pause avec un identifiant suivi |
| Recommandation modifiée                                   | Nouvelle situation présentée, sans suivre silencieusement l’ancienne destination                                |
| Cible absente                                             | Message explicite ; repli de découverte distinct de l’exigence de cible exacte du paiement                      |
| Stockage indisponible                                     | Avertissement et repère conservé pendant la visite                                                              |
| Effacement non confirmé                                   | Repère masqué pour la visite, message indiquant sa réapparition possible au rechargement                        |
| Résultat de lot incertain                                 | Réconciliation explicite avant reprise, sans rejeu aveugle                                                      |
| Dialogue métier ouvert                                    | Priorité au dialogue ; aucune confirmation obtenue en avançant une étape pédagogique                            |

Les préférences enregistrent, par compte dans ce navigateur, activation, mode,
rubrique/étape/pause, identifiant de paiement/pause et parcours/étape/pause. Les
faits de dossier et résultats métier ne sont pas enregistrés dans ce repère.
Avec une connexion par jeton, le repère est partagé entre utilisateurs du même
navigateur. Le placement haut/bas est local à la vie du composant.

**Effacer mon repère** réinitialise le guide flottant. Cela n’efface ni les
dossiers, ni le rapport serveur, ni la progression du Guide pas à pas modal.
Le texte de confidentialité actuel énumère rubrique, étape et paiement, sans
nommer explicitement le mode et le parcours interactif également sauvegardés.

Le panneau possède un nom accessible ; les boutons exposent leur sélection ou
leur développement. Les changements d’étape sont annoncés avec `aria-live`.
Montrer une zone déplace le focus vers elle ; avancer revient au titre d’étape.
Le parent ne définit pas de raccourci Échap pour réduire la carte. Le contrôle
clavier ou manette peut aussi être médié par le contrôleur commun ; sa simulation
ne qualifie pas un périphérique physique.

## Scénarios prioritaires pour la revue

1. Découvrir Contributions sans connaître l’interface, montrer une zone puis
   revenir au guide au clavier sans perdre le contexte.
2. Mettre la découverte en pause, changer de rubrique, puis distinguer Reprendre
   mon repère et Continuer ici.
3. Suivre le paiement A, ouvrir le dossier B et comprendre lequel alimente la
   prochaine étape avant de choisir volontairement un remplacement.
4. Ouvrir une recommandation pendant qu’un autre administrateur modifie le
   dossier ; comprendre la nouvelle étape sans croire l’ancienne exécutée.
5. Passer de découverte à Automatique et anticiper l’effet exact de Démarrer,
   J’ai lu, continuer, approuver le bon et autoriser une publication.
6. Distinguer position du carrousel, avancement du lot et avancement d’un paiement.
7. Interrompre une activité, réduire la carte puis la rouvrir ; savoir ce qui est
   arrêté, conservé ou encore en cours côté serveur.
8. Explorer Six parcours sans dossier admissible et distinguer écran actuel et
   organisation future proposée.
9. Utiliser la carte sur un viewport de 390 × 844 puis 390 × 667 pixels CSS, avec
   contrôleur affiché, sans perdre l’accès aux commandes de la page.
10. Vérifier les mêmes tâches en anglais, à 200 % de zoom, avec mouvement réduit,
    au clavier seul et dans les trois thèmes.

Pour confirmer l’inspection visuelle, les captures utiles sont : carte réduite,
découverte ouverte et en pause, paiement actif et en erreur, Automatique avec
bon et suivi du lot, Six parcours avec une zone montrée, puis un dialogue métier
ouvert au-dessus. Conserver la page environnante dans les captures permet
d’évaluer le recouvrement. Utiliser exclusivement des données synthétiques.

## Sources et portée de la vérification

Le blueprint décrit les templates, styles, services de présentation et libellés
du dépôt. Il ne constitue pas une recette navigateur exécutée ni une mesure du
contraste, du nombre de lignes ou de l’utilisabilité réelle.

- [Template du panneau](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.html),
  [comportement](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.ts)
  et [styles](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.css).
- [Service de repères](../../apps/funding-web/src/app/features/funding/services/admin-guidance.service.ts)
  et [contrat de stockage](../../apps/funding-web/src/app/features/funding/services/admin-guidance-state.ts).
- [Suivi du paiement](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-payment-journey.component.html),
  [Automatique](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic.component.html),
  [suivi du lot](../../apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio.component.html)
  et [Six parcours](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-workflow-guide.component.html).
- [Layout et surcharges responsive](../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.css),
  [thèmes](../../apps/funding-web/src/styles/admin-appearance.css)
  et [boutons communs](../../apps/funding-web/src/app/features/funding/components/admin-ui/admin-controls.css).
- [Libellés français](../../apps/funding-web/src/assets/i18n/admin-base.fr-CA.json),
  [libellés Automatique](../../apps/funding-web/src/assets/i18n/admin-automatic.fr-CA.json),
  [libellés Six parcours](../../apps/funding-web/src/assets/i18n/admin-workflow-guide.fr-CA.json)
  et [guide opérationnel](../operations/admin-pilotage.md#guides-interactifs).
- Scénarios existants à mobiliser lors d’une évolution :
  [guide et paiement](../../tests/playwright/admin-guidance.spec.ts),
  [Six parcours](../../tests/playwright/admin-workflow-guide.spec.ts)
  et [lot](../../tests/playwright/admin-automatic-portfolio.spec.ts).
