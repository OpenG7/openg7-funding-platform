# Guide administratif OpenG7 — Plan de recette V3.2

**À exécuter par Codex après modification du code.** Les données des captures de référence sont synthétiques. Les tests de la V3.1, même exécutés antérieurement, ne constituent **pas** un résultat V3.2. Les scénarios PR 2 sont **hors portée de la première PR**.

## A. Scénarios obligatoires dans la PR 1 : diagnostic + CTA + menu

| ID         | Scénario                                                      | Résultat attendu                                                                                                          |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **PR1-01** | Baseline `HEAD`, branche et worktree                          | Commit noté ; changements locaux identifiés et préservés ; `1108d8a9` traité comme référence, pas reset imposé            |
| **PR1-02** | Contrôle avec CTA déjà présent                                | CTA dans le pilote, **une seule fois hors « Autres actions »** ; même descripteur, ID, version et propriétaire            |
| **PR1-03** | Contrôle sélectionné affiché dans liste et détail             | Nom fonctionnel du contrôle visible dans les **deux** zones ; diagnostic central condensé sans perte d'information        |
| **PR1-04** | Motif d'accord absent, affichage desktop                      | Pas de trois panneaux imbriqués répétant le même motif ; action proportionnée et texte exact                              |
| **PR1-05** | Motif inexistant mais données prêtes                          | Pas de message « accord manquant » fictif ni CTA de correction sans besoin                                                |
| **PR1-06** | Contrôle déjà satisfait conserve sa sélection après relecture | État et CTA reflètent les capacités réelles ; pas de faux « À compléter »                                                 |
| **PR1-07** | Contrôle sans CTA admissible                                  | Pas de bouton factice ; explication de l'absence d'action si approprié                                                    |
| **PR1-08** | Menu ouvert depuis contrôle sélectionné                       | Affichage **inline** dans la zone existante ; aucun nouveau popover/overlay ni POST                                       |
| **PR1-09** | Action absente/non applicable                                 | Pas d'item gris artificiel ni de divulgation de permission non accordée                                                   |
| **PR1-10** | Action réelle mais temporairement désactivée                  | Commande inactivable ; raison existante visible ou annoncée de manière accessible                                         |
| **PR1-11** | Actions secondaires différentes selon contrôle                | Actions réellement filtrées par sélection, rôle, capacité et version ; pas de liste hardcodée                             |
| **PR1-12** | Assistance avec source absente                                | Aucune proposition/source fictive ; prérequis expliqué si commande visible                                                |
| **PR1-13** | Assistance avec source valide                                 | Lecture et examen restent accessibles selon droits ; une relance ne part que sur activation explicite                     |
| **PR1-14** | Historique absent puis existant                               | Aucun faux événement ; présentation correcte de l'état vide et accès au vrai historique                                   |
| **PR1-15** | Bascule d'un contrôle/bon/version à l'autre menu ouvert       | Anciennes actions fermées/recalculées, aucun dispatch d'une mauvaise contribution/version                                 |
| **PR1-16** | Lecteur (`reader`) et opérateur/propriétaire                  | Les commandes affichées reflètent capacités autorisées ; refus serveur toujours respecté                                  |
| **PR1-17** | Ouverture « Pourquoi ? », « Assistance », « Autres actions »  | Consultation sans création de brouillon, approbation, `advance` ou relance implicite                                      |
| **PR1-18** | Approbation du bon prête, non prête, déjà approuvée           | Une seule entrée propriétaire ; confirmation/version/`requestId`/audit inchangés                                          |
| **PR1-19** | Conflit ou résultat incertain                                 | Relecture/réconciliation ; pas de répétition automatique de mutation                                                      |
| **PR1-20** | **Xbox : A sur contrôle non choisi**                          | Sélection uniquement, aucune action principale exécutée                                                                   |
| **PR1-21** | **Xbox : A sur contrôle déjà choisi en `peek`**               | Ouvre les actions `open` ; pas de CTA exécuté                                                                             |
| **PR1-22** | **Xbox : A sur CTA focalisé**                                 | Exécute le CTA exact, sous ses propres contrôles                                                                          |
| **PR1-23** | **Xbox : B / Échap / Retour**                                 | Ferme les actions, restitue le focus au déclencheur et respecte les priorités de dialogue                                 |
| **PR1-24** | **Xbox : X/Y + profil réaffecté**                             | Badge et action cohérents avec profil/contexte ; aucune table fixe d'actions dans le Guide                                |
| **PR1-25** | Xbox : maintien A en transition vers confirmation             | Retour au neutre obligatoire, aucune double confirmation                                                                  |
| **PR1-26** | Clavier : Tab, Shift+Tab, flèches/Home/End                    | Ordre de lecture utile, cible visible, `aria-expanded` pertinent et aucun focus perdu                                     |
| **PR1-27** | Mobile 390 × 844 / 390 × 667 et bureau 1536 × 864             | Boutons accessibles malgré défilement ; Guide non modal, page sous-jacente atteignable après réduction                    |
| **PR1-28** | 1920 × 1080 à 125 % et zoom 200 %                             | Action principale/menu/texte non masqués, focus lisible, pas de débordement empêchant la lecture                          |
| **PR1-29** | FR-CA/EN, clair/nuit/graphite, mouvements réduits             | Traductions correctes, texte lisible, focus, pas de couleur seule pour signifier l'état                                   |
| **PR1-30** | Bon partagé sur Guide puis Campagnes/Publication              | Modifications de présentation du Guide n'altèrent pas droits, version, approbation, résumé ni liens dans les autres hôtes |
| **PR1-31** | Réduire le Guide pendant une requête serveur en cours         | Aucun abandon supposé du POST ; réconciliation/readback au retour si état incertain                                       |
| **PR1-32** | Pas de régression de la navigation du carrousel               | Positions numérotées, Précédent/Suivant et contrôle sélectionné conformes aux règles existantes                           |

**P0 si reproduit :** mauvaise cible, décision implicite, double approbation ou rejeu aveugle. Ne pas bloquer comme P0 pour une préférence esthétique ou une absence non confirmée.

## B. PR 2 ultérieure — sous-vues, **ne pas implémenter durant PR 1**

| ID         | Scénario                                               | Résultat attendu                                                                                            |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **PR2-01** | Passer Bon → Passage → Bon                             | Même `carousel.position`, même bon/version, même contrôle sélectionné et retour logique du focus            |
| **PR2-02** | Bon B consulté, checkpoint du lot C, paiement suivi A  | Cibles indépendantes, libellés précis, aucune synchronisation implicite                                     |
| **PR2-03** | Sous-vue masquée pendant opération en vol              | Instance/état/requête/`requestId` préservés ; pas de duplication à la réapparition                          |
| **PR2-04** | Passer Bon → Autre préparation pendant brouillon ciblé | Brouillon, cible et traitement restent conservés selon comportement existant ; pas de relance automatique   |
| **PR2-05** | Checkpoint d'attente arrive pendant vue Bon            | Alerte discrète « Passage : lecture requise », entrée « Rejoindre le passage », sans bascule forcée ni POST |
| **PR2-06** | Checkpoint arrive pendant Autre préparation            | Notification similaire ; prévenir les conflits entre les deux conducteurs sans les démarrer mutuellement    |
| **PR2-07** | Vue Passage rouverte après alerte                      | Phase serveur relue ; lecture/confirmation sous ses propres conditions                                      |
| **PR2-08** | Dernière observation du lot                            | Horodatage et nature de snapshot affichés ; jamais présentée comme « état courant » du dossier              |
| **PR2-09** | Rapport paginé daté                                    | Historique et preuves avant/après/auteur/audit conservés ; données actuelles non déduites                   |
| **PR2-10** | Bon 3/6, contrôlés 4/6, satisfaits 4/7                 | Significations non confondues ; chiffres non additionnés                                                    |
| **PR2-11** | Bilan à traiter/clarifier/vérifier                     | Comptages éventuellement recoupés annoncés comme non additionnables                                         |
| **PR2-12** | Revérifier / reprendre / nouveau passage               | Même manifeste pour revérifier ; seuls nouveaux passages incluent paiements ultérieurs                      |
| **PR2-13** | Rapport « Examiner le dossier »                        | Effet réel annoncé : lot mis en pause, paiement adopté et préparation ciblée lancée                         |
| **PR2-14** | Changement de sous-vue, session supprimée              | Données privées révoquées, action obsolète non réactivable                                                  |
| **PR2-15** | Petit écran avec dock Xbox ouvert                      | Sous-vues, checkpoint et actions atteignables sans perte de focus ou masquage complet                       |

## C. Outils et fichiers de test existants à examiner

```text
tests/playwright/admin-guidance.spec.ts
tests/playwright/admin-workflow-guide.spec.ts
tests/playwright/admin-automatic-portfolio.spec.ts
tests/playwright/admin-preparation-receipts.spec.ts
tests/playwright/admin-preparation-assistance.spec.ts
tests/playwright/admin-sponsorship-preparation.spec.ts
tests/playwright/admin-campaigns.spec.ts
tests/playwright/admin-controller-journeys.spec.ts
```

**Ne pas supposer les commandes exactes disponibles** : inspecter scripts Yarn, environnement Node et sélection de tests du checkout. Vérifier tests ciblés, typecheck/lint/build selon portée et exécuter les tests navigateur appropriés avec données synthétiques. Rien ici ne vaut preuve d'une opération Stripe/Meta/LinkedIn réelle ni essai d'une manette physique.

## D. Format du compte rendu Codex

Pour **PR 1 uniquement** : commit/branche/worktree ; inventaire des actions avant/après ; fichiers modifiés et raisons ; commandes/tests réellement exécutés avec succès/échec/ignorés ; état de chaque scénario `PR1-*` (passé/échoué/non exécuté) ; captures avant/après desktop/mobile ; note séparée des limitations physiques et fournisseurs ; liste précise des risques restant à investiguer. **PR 2 requiert une approbation distincte.**
