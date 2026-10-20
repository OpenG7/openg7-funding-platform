# Réponse au blueprint du Guide administratif OpenG7 — proposition UX/UI V3

**Objet :** réponse à l'inspection UX/UI du panneau « Mode guidé » et directives d'évolution pour Codex.

**Référence fonctionnelle :** _Blueprint du panneau Guide pour inspection UI UX_, daté du **19 octobre 2026**, code de référence **`30e812a6`**.

**Référence visuelle choisie :** la **dernière maquette OpenG7 4K validée** (rail vertical des quatre modes, carrousel de six bons, carte centrale de prochaine intervention, contrôles à droite, commandes Xbox en pied).

**Nature :** proposition **non implémentée** ; aucun code, permission, test ou déploiement n'est présumé modifié. La maquette est une référence esthétique et de composition, **pas** un contrat de données ni une preuve de fonctions livrées.

## 1. Décision de conception

Je retiens la dernière maquette comme **direction visuelle cible**, mais **je conserve l'architecture métier actuelle** : un Guide administratif **non modal**, quatre modes, navigation contextuelle, préparation serveur sous commande explicite, formulaires propriétaires et confirmations dédiées.

Le Guide doit répondre en quelques secondes à quatre questions : **Où suis-je ? Quel est le prochain obstacle ? Quelle action puis-je réellement effectuer ? Que se passera-t-il si je l'effectue ?**

### Diagnostic du modèle mental — les trois problèmes principaux

1. **Quatre intentions dans un même outil.** Découverte pédagogique, suivi du paiement, préparation de dossiers et exploration des six parcours ont des objectifs différents. L'étiquette actuelle « Automatique » entretient particulièrement une ambiguïté : ouvrir ce mode ne démarre pas automatiquement un passage.
2. **Hiérarchie trop étendue.** L'action réellement utile (« Compléter l'accord » dans la capture) se cache derrière « Actions », tandis que les mêmes blocages réapparaissent dans le reçu, les contrôles et le panneau contextuel. La colonne gauche présente de grands espaces vides lorsque les actions sont ouvertes.
3. **Progressions et interruptions peu évidentes.** Bon courant, bons examinés, contrôles satisfaits et progression du lot sont des mesures indépendantes ; réduire le Guide peut interrompre la conduite côté navigateur **sans annuler une requête déjà envoyée au serveur**.

Ces observations mêlent **faits du blueprint**, **constats sur les trois captures**, et **risques à confirmer par des essais**. Elles ne constituent pas un audit d'exécution du code.

## 2. Nouvelle architecture de contenu

### A. Rail gauche : intentions stables

Afficher, avec icône et libellé explicite, les **quatre modes existants** :

- **Découvrir** — apprendre à se repérer sur une page.
- **Suivi d'un paiement** — suivre un paiement explicitement sélectionné.
- **Préparation des dossiers** — parcourir un lot et préparer les éléments admissibles ; **aucun traitement ne démarre à l'ouverture du mode**.
- **Explorer les parcours** — découvrir les six parcours documentés, sans effet métier.

Conserver les identifiants techniques, préférences, repères mémorisés et `aria-pressed` tant que les contrats existants l'exigent. Ne pas recréer quatre nouvelles routes. Les libellés restent **stables**, sans remplacer silencieusement trois modes par des icônes ambiguës.

Le **dragon**, la marque OpenG7 et, dans le style de la maquette, la princesse et le lion, peuvent enrichir une zone décorative secondaire. Les éléments décoratifs n'empiètent jamais sur les contrôles ni sur l'ordre de lecture. Ne pas inventer d'actifs graphiques ou bloquer la livraison s'ils sont absents.

### B. Bandeau haut : un seul contexte, trois dimensions indépendantes

Dans « Préparation des dossiers » :

- **Bon consulté :** « Bon 4 sur 6 » (position dans le carrousel).
- **Passage / lot :** « 4 sur 6 examinés » **uniquement si le serveur donne réellement cette information**, jamais déduit de la position consultée.
- **Bon courant :** référence, version, état, montant, paiement et **contrôles satisfaits X/Y** selon la projection serveur.

Le carrousel garde **un seul bon actif**, la navigation précédent/suivant et ses états de chargement, erreur et borne. Les vignettes de la maquette sont purement illustratives : utiliser les données réelles disponibles ou de simples cartes numérotées, sans inventer des images de commanditaires.

### C. Colonne centrale : prochaine intervention puis détails

Ordre recommandé :

1. **Bon de préparation :** référence, version, montant, statut de paiement, état global.
2. **Prochaine intervention :** titre clair, cause serveur, responsabilité, CTA principal visible sans ouverture de menu.
3. **Faits résumés :** ce que le paiement / l'accord / le contenu indiquent réellement.
4. **Détail du contrôle sélectionné :** explication, « Pourquoi ? », assistance admissible et destination propriétaire.
5. **Contenu exact, historique et autres actions :** repliables, jamais supprimés.

**Exemple provenant uniquement des captures :** « Documenter l'accord d'origine » ; « Aucune source de l'accord d'origine enregistrée » ; CTA « Compléter l'accord d'origine ». Ce texte ne doit **pas** devenir une recommandation codée en dur pour tous les dossiers. L'action suit le contrat de destination du contrôleur existant et ne crée pas une nouvelle source d'accord.

Éviter le dédoublement « Publications promises » : une **seule** carte résume l'intervention principale ; le contrôle à droite sert à sélectionner/inspecter son état, pas à afficher une seconde copie complète du diagnostic.

### D. Colonne droite : pilotage compact des contrôles

Afficher `X / Y contrôles satisfaits` et la liste des contrôles **applicables au bon courant**, avec statuts issus du serveur : vérifié, à compléter, en attente, indisponible, non requis, selon ce que l'API expose.

Présenter **d'abord les contrôles demandant une attention**, puis les contrôles satisfaits résumés dans une section repliable, sauf lorsqu'il est utile de conserver l'ordre contractuel du reçu partagé. La sélection d'un contrôle met à jour la zone de détail à gauche ; elle **ne le valide pas**.

Le nombre **7** du bon observé est un **exemple**, jamais une constante produit. Les `not_required` ne doivent pas gonfler artificiellement un dénominateur.

La commande **« Approuver la préparation »** reste celle du **composant partagé** et obéit uniquement à `canApprove`, aux rôles, à la version, à la confirmation et au résultat du serveur. Elle ne devient pas active parce qu'une barre graphique semble pleine.

### E. Pied fixe : navigation et Xbox

Pied d'interface : **Précédent / Suivant**, action contextuelle quand elle est disponible, aide A/B/X/Y tirée du contrôleur existant et état de préparation. Garder les raccourcis **dans leur contexte** : ne pas réaffecter A/B/X/Y si cela casse le mapping actuel ou une confirmation prioritaire.

« Actions contextuelles » devient un panneau secondaire à la demande, sans dupliquer l'action principale. Les options indisponibles restent inspectables avec leur motif, mais ne dominent plus visuellement la surface. Une opération en cours ou incertaine demeure protégée contre le rejeu.

## 3. Wireframe cible — bureau / TV (concept)

```text
┌────────────────────── Guide administratif OpenG7 ─────────────────────────────────────────┐
│ OpenG7 / dragon              [Réduire] [Haut/Bas] [Agrandir si disponible]               │
├─────────────────┬──────────────────────────────────────┬────────────────────────────────┤
│ MODES           │ BON ACTIF / CARROUSEL                │ PROGRESSION DES BONS           │
│                 │ [◀] [1] [2] [3] [4 ACTIF] [5] [6] [▶]│ 4/6 examinés (si confirmé)     │
│ Découvrir       ├──────────────────────────────────────┼────────────────────────────────┤
│                 │ Bon de préparation · Réf / version    │ CONTRÔLES DU BON : 4/7        │
│ Préparation ✓   │ 50 CAD · Paiement confirmé            │ -----------------------------  │
│                 │                                      │ À COMPLÉTER                   │
│ Suivi paiement  │ ⚠ PROCHAINE INTERVENTION             │ • Publications promises       │
│                 │ Documenter l'accord d'origine        │ • Présentation et contenus    │
│ Explorer        │ Aucune source d'accord enregistrée   │ • Modération                  │
│                 │ [Compléter l'accord d'origine →]     │ ▸ Vérifiés (4)                │
│                 │                                      │                                │
│ Illustration    │ Détail sélectionné + Pourquoi ?      │ [Approuver préparation]       │
│ décorative      │ ▸ Contenu exact ▸ Historique          │ (inactif si non admissible)   │
│ facultative     │ ▸ Autres actions                      │                                │
├─────────────────┴──────────────────────────────────────┴────────────────────────────────┤
│ A = action contextuelle  B = retour  X/Y = selon mapping existant  [← Préc.] [Suivant →]│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Dimensions de recette** : inclure **1920 × 1080 à mise à l'échelle 125 %** (viewport CSS proche de **1536 × 864** dans les configurations usuelles), 1536 × 864 CSS, zoom 200 %, différents ratios, manette/dock simulé. Dimensionner selon le **conteneur réel** et la hauteur disponible, non seulement selon des captures 4K. Éviter les trois défilements verticaux concurrents.

**Non-modalité :** la maquette donne une allure de grande fenêtre, mais le contrat actuel reste un panneau non modal. Si l'espace de travail agrandi masque une commande essentielle de la page, offrir un retour compact clair et une organisation adaptée ; ne pas introduire automatiquement `role="dialog"`, voile bloquant ou confinement du focus. Les confirmations métier conservent leur priorité.

## 4. Wireframe cible — mobile ou petite hauteur

```text
┌───────── Guide administratif ────────────┐
│ [Préparation des dossiers ▾] [Réduire]  │
│ Bon 4/6 consulté                        │
│ 4/7 contrôles satisfaits                │
├─────────────────────────────────────────┤
│ ⚠ Documenter l'accord d'origine        │
│ Source manquante                        │
│ [Compléter l'accord →]                  │
├─────────────────────────────────────────┤
│ À compléter (3)                         │
│ • Publications promises   [Détails ▾]   │
│ • Présentation et contenus              │
│ • Modération                            │
│ ▸ Vérifiés (4)                          │
│ ▸ Autres actions  ▸ Contenu exact       │
├─────────────────────────────────────────┤
│ Préparation non approuvable             │
│ [← Précédent]             [Suivant →]   │
└─────────────────────────────────────────┘
```

Prévoir les cas **390 × 844** et **390 × 667** pixels CSS avec contrôleur affiché : menu de modes repliable, zone centrale prioritaire, contrôles sous forme d'accordéon, barre d'action atteignable sans masquer les boutons de la page, défilement maîtrisé. Les quatre modes restent accessibles par clavier et lecteur d'écran.

## 5. Tableau des constats et priorités (faits, hypothèses et critères)

| ID   | Zone / scénario                           | Source du constat                                                   | Risque utilisateur                                   | Priorité                                  | Action proposée                                                          | Critère de réception                                              |
| ---- | ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| UX01 | Changer de mode                           | **Fait blueprint** : 4 modes ; compaction en icônes                 | Intention et commandes difficiles à reconnaître      | **P1**                                    | Rail avec libellés stables et responsive                                 | Les quatre modes sont nommés, sélection visible, focus accessible |
| UX02 | Entrer dans « Automatique »               | **Fait blueprint** : charge sans démarrer                           | Automatisation supposée immédiate                    | **P1**                                    | Renommer « Préparation des dossiers »                                    | Aucun démarrage/mutation à l'ouverture                            |
| UX03 | Carrousel bon 4/6 / progression 4/7       | **Faits blueprint + captures** : décomptes différents               | Confusion entre bon consulté, lot examiné, contrôles | **P1**                                    | Libeller chaque portée séparément                                        | Chaque compteur provient de sa source et est juste                |
| UX04 | Identifier la prochaine action            | **Capture** : action derrière « Actions »                           | Recherche et défilement inutiles                     | **P1**                                    | CTA direct via projection existante                                      | Une action principale accessible sans menu intermédiaire          |
| UX05 | Contrôle « Publications promises » répété | **Capture** : duplication visuelle                                  | Charge cognitive                                     | **P2**                                    | Résumé central + détail sélectionné, sans copie                          | Aucun deuxième CTA effectuant la même opération                   |
| UX06 | « J'ai lu, continuer »                    | **Fait blueprint** : peut contrôler/préparer côté serveur           | Effet masqué derrière une formule pédagogique        | **P1**                                    | « Vérifier et préparer ce dossier » si applicable ; conséquence annoncée | Action testée distincte d'une simple lecture                      |
| UX07 | Réduire pendant une requête               | **Fait blueprint** : navigateur interrompu, serveur peut continuer  | Rejeu et fausse impression d'annulation              | **P0 en prévention** ; défaut à prouver   | Avertissement clair + réconciliation + mêmes requestIds                  | Jamais de deuxième effet accidentel                               |
| UX08 | Approuver une préparation                 | **Fait blueprint** : version et confirmation                        | Approbation non autorisée si règle UI recréée        | **P0 en prévention**                      | Réutiliser contrôleur et `canApprove` serveur                            | Aucune approbation sans autorisation exacte                       |
| UX09 | Ouvrir dossier depuis lot                 | **Fait blueprint** : met passage en pause                           | Perte du point de retour                             | **P1**                                    | Annoncer mise en pause, retour au même bon                               | Passage et sélection restaurés                                    |
| UX10 | Recouvrement et dimensions                | **Blueprint + captures** : panneau fixe agrandi et blanc vide       | Actions cachées et espace gaspillé                   | **P1**                                    | Disposition compacte/agrandie, une zone de défilement prioritaire        | Commandes accessibles à 1536×864 et 390×667                       |
| UX11 | Erreur de chargement d'un mode            | **Fait blueprint** : demande de recharger la page                   | Perte du contexte                                    | **P2**                                    | Réessai local conservant sélection                                       | Réessayer sans rechargement global                                |
| UX12 | Suivi paiement A / dossier B              | **Fait blueprint** : sélection volontaire                           | Confusion de cible                                   | **P1**                                    | Références toujours distinctes, bascule explicite                        | A reste suivi jusqu'au choix de B                                 |
| UX13 | Mode « Six parcours »                     | **Fait blueprint** : suggestions futures                            | Confusion planifié/livré                             | **P2**                                    | Afficher « À réaliser » sur chaque proposition future                    | Aucun lien fictif menant à une fonction absente                   |
| UX14 | Lecture au clavier/manette                | **Blueprint** : focus, contrôleur, annonce ARIA                     | Perte de contexte et commandes imprévues             | **P1**                                    | Priorité des panneaux, focus rétabli, mapping existant                   | Parcours clavier + Xbox simulée validés                           |
| UX15 | Repères persistés / jeton local           | **Fait blueprint** : préférences navigateur, jeton partagé possible | Repères d'une autre personne visibles                | **P2**, investigation sécurité si constat | Réviser texte mémoire, isolation et effacement                           | Session différente ne révèle pas le repère précédent              |
| UX16 | Thèmes, traduction, décorations           | **Blueprint** : Clair/Nuit/Graphite, FR/EN                          | Troncature, contraste, encombrement                  | **P2 / P3**                               | Tokens accessibles ; décorations subordonnées                            | Contraste, langue, zoom, mouvement réduit vérifiés                |

**Précision :** « P0 en prévention » signifie **invariant critique à protéger et à tester**, pas qu'une faille a été constatée sur le dépôt.

## 6. États indispensables

- **Global :** réduit, ouvert, compact, agrandi si pris en charge, mode actif, position haut/bas, sauvegarde de repères, échec de mémorisation, session expirée, route non cataloguée, dialogue prioritaire ouvert.
- **Découvrir :** lecture, première/dernière étape, mise en évidence, cible introuvable, pause/reprise, passage à une autre rubrique, retour de focus.
- **Suivi paiement :** aucune cible, paiement A suivi et dossier B affiché, lecture serveur, changement de recommandation, tâche humaine ou attente plateforme, erreur/interdit/introuvable, pause.
- **Préparation :** passage absent, chargé/non démarré, en cours, pause, passage terminé, bon consulté, contrôle sélectionné, autre action repliée, dossier examiné, préparation privée, blocage, conflit de version, `canApprove` faux/vrai, approbation confirmée, résultat incertain/réconcilié, erreur partielle.
- **Explorer les parcours :** six parcours, 21 étapes du document, sans dossier compatible, cible absente, surbrillance active, pause/reprise, « organisation future » identifiée.

Ne jamais afficher « terminé », « approuvé », « envoyé » ou « publié » en se fondant uniquement sur une animation, un clic, une donnée mock ou une estimation du navigateur.

## 7. Plan de vérification : scénarios concrets

| Test | Scénario                                                      | Attendu                                                                                 |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| T01  | Ouvrir « Préparation des dossiers »                           | Aucun démarrage automatique, aucun effet externe                                        |
| T02  | Bon 4/6 ; contrôles 4/7 ; progression du lot                  | Les trois notions restent séparées                                                      |
| T03  | « Compléter l'accord » sur un bon dont la source manque       | La bonne page propriétaire s'ouvre avec dossier ciblé, aucun accord créé par navigation |
| T04  | Changer de contrôle                                           | Diagnostic et actions se mettent à jour sans modifier les faits                         |
| T05  | Réduire/réouvrir pendant une requête lente                    | État serveur reconnu, aucun rejeu, historique conservé                                  |
| T06  | Conflit de version / autre acteur                             | Confirmation d'approbation impossible jusqu'à relecture correcte                        |
| T07  | Rôle lecteur / opérateur / propriétaire                       | Présentation cohérente et API toujours autoritaire                                      |
| T08  | Ouvrir dossier depuis passage                                 | Passage mis en pause ; retour au même bon                                               |
| T09  | Suivre paiement A, ouvrir dossier B                           | A continue d'être suivi jusqu'à bascule explicite                                       |
| T10  | Mode « Explorer les parcours » avec étapes futures            | « À réaliser » affiché, pas de commande métier fantôme                                  |
| T11  | Mode en erreur de chargement                                  | Réessai local sans perdre le contexte                                                   |
| T12  | Clavier et lecteur d'écran                                    | Ordre logique, focus rétabli, annonces appropriées                                      |
| T13  | Xbox A/B/X/Y et simulateur                                    | Raccourcis conformes au contrôleur existant ; pas de contournement de sécurité          |
| T14  | 1920×1080 à 125 %, 1536×864 CSS, 390×844, 390×667, 200 % zoom | Aucune commande inaccessible, pas de défilement horizontal parasite                     |
| T15  | Trois thèmes, FR/EN, mouvement réduit                         | Lisibilité, textes complets, contraste mesuré et animation désactivable                 |
| T16  | Session révoquée ou changement de compte local                | Aucune donnée privée d'une autre session réaffichée                                     |

**Méthode :** tests sur données synthétiques, captures avant/après, traces de mutations et compte rendu des tests **effectivement exécutés**. Des captures et des tests simulés ne prouvent pas une opération Stripe, SMTP ou publication sociale en production.

## 8. Composants existants : à faire évoluer, pas à remplacer

| Responsabilité                                | Emplacement annoncé dans le blueprint                                                                           | Directive                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Enveloppe, rail, mode, position, mémorisation | `admin-guidance/admin-guidance.component.{html,ts,css}`, `admin-guidance.service.ts`, `admin-guidance-state.ts` | Refondre composition, labels et état sans casser persistance ou focus |
| Découverte                                    | Composants existants du Guide                                                                                   | Préserver surbrillance et lecture seule                               |
| Suivi paiement                                | `admin-guidance/admin-payment-journey.component.html`                                                           | Conserver cible explicite et relecture                                |
| Préparation/lot                               | `admin-automatic/admin-automatic.component.html`, `admin-automatic-portfolio.component.html`                    | Recomposer carrousel et progression, réutiliser logique serveur       |
| Bon partagé et approbation                    | `admin-preparation/admin-preparation-receipt.component.html`, pilote/projection/contrôleur du bon existants     | Aucun nouveau moteur d'approbation ; version/confirmation intactes    |
| Six parcours                                  | `admin-guidance/admin-workflow-guide.component.html`                                                            | Déplacer l'accès, pas le contenu métier                               |
| Layout et manette                             | `admin-layout/admin-layout.component.css`, contrôleur transversal/manette et simulateur                         | Respecter zone réservée, priorités, mapping                           |
| Tokens/themes                                 | `styles/admin-appearance.css` et styles partagés                                                                | Clair, Nuit, Graphite, contrastes                                     |
| Langues                                       | `src/assets/i18n/admin-base.fr-CA.json`, `admin-automatic.fr-CA.json`, `admin-workflow-guide.fr-CA.json` (+ EN) | Traduire nouveaux textes, ne pas changer IDs métiers                  |
| Tests                                         | `tests/playwright/admin-guidance.spec.ts`, `admin-workflow-guide.spec.ts`, `admin-automatic-portfolio.spec.ts`  | Étendre les scénarios existants                                       |

Auditer ces chemins dans le **checkout actuel** avant toute modification : le blueprint documente une révision et n'est pas une garantie de l'état courant.

## 9. Ordre de réalisation recommandé

**Lot 0 — Audit et invariants (priorité P0 préventive).** Lire code courant, différencier lecture/préparation/approbation/publication, capturer états, tester reprises et versions. Ne pas modifier l'API métier pour résoudre une question de mise en page.

**Lot 1 — Navigation et modèle mental (P1).** Rail des quatre modes, libellés stables, paiement suivi explicite, bon et lot distingués, retour contextuel, gestion locale des erreurs.

**Lot 2 — Bon de préparation compact (P1).** CTA prioritaire direct, deux colonnes de contenu, contrôles accessibles, détails repliables, autres actions secondaires, carrousel, pied fixe et possibilité de travailler à la manette.

**Lot 3 — Responsive et accessibilité (P1/P2).** Ajustements à 125 %, mobile, zoom, focus, simulations Xbox, 3 thèmes, FR/EN, mouvement réduit, état de la page non masqué.

**Lot 4 — Raffinement visuel (P3).** Signature dragon/OpenG7, dorures discrètes, hiérarchie plus premium, illustration secondaire dans les espaces réellement disponibles, sans ajouter du bruit ou inventer des données.

Chaque lot doit produire un **diff réversible**, une liste de parcours touchés, des captures synthétiques et les résultats réels de tests.

## 10. Décision de réception finale

J'accepterai la V3 lorsque, sur le bon courant, un administrateur pourra :

1. Identifier le bon, son état, son montant, sa version et son paiement sans ouvrir de sous-menu.
2. Distinguer **bon consulté**, **passage examiné** et **contrôles satisfaits**.
3. Repérer immédiatement l'obstacle prioritaire et accéder en une action à son **vrai formulaire propriétaire**.
4. Comprendre quelles actions sont disponibles, interdites ou en attente, avec des motifs visibles.
5. Parcourir les bons et revenir d'une intervention sans perdre le contexte.
6. Utiliser le panneau sur bureau, petit écran, clavier et manette, sans masquer les opérations importantes.
7. Conserver **toutes** les décisions et confirmations existantes — aucune approbation automatique ou publication implicite.

**Conclusion :** retenir la dernière maquette comme **référence de composition**, conserver le Guide existant et ses contrats, puis faire de la prochaine intervention un point d'entrée simple vers les composants métiers qui savent déjà traiter la situation.
