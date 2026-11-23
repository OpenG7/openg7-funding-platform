# Salle des moteurs intelligents — analyse des travaux

Date : 23 novembre 2026. Statut : proposition de travaux, non livrée.
Périmètre recommandé : administration Funding, avec raccordement contrôlé à Preflight.

## Intention à conserver

La salle doit permettre à un administrateur de comprendre ce qui travaille pour
la plateforme, pourquoi un dossier n’avance pas et quelle intervention est possible.
Sa valeur se mesure au temps nécessaire pour comprendre puis résoudre un blocage,
et non au nombre de moteurs ou de compteurs affichés.

Le cas déclencheur est concret : un bouton d’approbation désactivé indiquait de
vérifier « la connexion du feed », sans identifier clairement le compte, le réseau
ou le réglage concerné. La salle doit relier dossier, mission, dépendance, preuve
du problème et action disponible.

La direction retenue avec l’utilisateur est une salle commune, avec accès au détail
de chaque moteur. Elle réutilise les fonctions propriétaires et remplace les vues
de supervision redondantes à mesure que leur couverture est vérifiée.

L’image conceptuelle fournie inspire l’identité de la salle : moteurs identifiables,
mission visible, états et commandes. Ses nombres, scores et états sont illustratifs;
ils ne prouvent aucune capacité active. Le visuel ne constitue pas une spécification
technique ni une autorisation de démarrer des traitements.

## Définition d’un moteur

Un moteur représente une capacité chargée d’une mission, par exemple préparer les
reconnaissances des commanditaires. Facebook et LinkedIn sont ses destinations et
intégrations; un fournisseur IA est une dépendance éventuelle. Ils ne deviennent
pas automatiquement des moteurs distincts.

La préparation Preflight et la diffusion Funding ont des autorités différentes.
La salle peut les relier dans un parcours, mais doit montrer qui prépare, qui
approuve et qui exécute. « Intelligent » ne signifie pas que chaque tâche appelle
une IA : les étapes déterministes doivent rester identifiables.

| Dimension | Information à distinguer |
| --- | --- |
| Fonctionnement | Configuration activée, pause, traitement observé, arrêt |
| Santé | Diagnostic réussi, dégradé, échec, état inconnu ou périmé |
| Dépendances | Connexion, compte, autorisation fournisseur et disponibilité |
| Gouvernance | Lecture seule, préparation autorisée, approbation humaine attendue |
| Environnement | Simulation, réel, fournisseur désactivé |
| Résultat métier | Proposition préparée, décision approuvée, livraison attestée |

Un compte non vérifié n’est pas nécessairement en panne. Un réglage activé ne
prouve pas qu’un worker tourne. Une interruption Facebook ne doit pas masquer
un fonctionnement LinkedIn confirmé. Chaque observation doit conserver sa source,
sa date et sa portée; l’absence de mesure produit « inconnu », jamais un succès.

## Briques réutilisables et limites

Inventaire issu des sources locales inspectées. Une présence dans le code ne
prouve ni déploiement, ni activation, ni connexion de production. Le panneau
d’état ajouté pendant cette session appartient aux changements locaux en cours.

| Brique | Source propriétaire | Réutilisation / travail restant |
| --- | --- | --- |
| Publication automatique | `apps/funding-api/src/publication-automation/` et `packages/funding-core/src/publication-automation.ts` | Réutiliser états, destinations, connexions, pauses, livraisons et commandes natives. Ne pas réimplémenter l’envoi. |
| Réglages et confirmations des publications | `apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/` | Composer les écrans existants et conserver leurs permissions et confirmations. |
| État des publications depuis un dossier | `apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/` | Extraire la lecture et la présentation utiles du panneau local, puis rediriger son entrée vers la salle contextualisée. |
| Connexion Funding–Preflight | [Connecteur](../technical/preflight-connector.md), `apps/funding-api/src/preflight/` | Réutiliser missions, imports, provenance et contrôles des sources. Vérifier activation et contrat effectif. |
| Présence du relais Preflight Funding | `apps/funding-api/src/preflight-health.ts` | Réutiliser le signal daté existant avec son périmètre exact. Un contrôle réussi lorsque le connecteur est désactivé ne signifie pas « moteur actif ». |
| Missions et briefing Preflight | Dépôt `openg7-preflight`, `packages/engine/` et `apps/admin-web/src/app/features/` | Réutiliser les contrats et services propriétaires. Les composants de l’autre application ne sont pas des imports directs pour Funding. |
| Fournisseurs IA | Dépôt `openg7-preflight`, `packages/ai/` | Exploiter les informations exposées de fournisseur, simulation, provenance et coût estimé; ajouter un contrat de lecture si nécessaire. |
| Incidents et audit | [Fiabilité des publications](../technical/publication-reliability.md), services d’audit Funding | Relier incidents, dossier, action et résultat sans créer un historique concurrent. |
| Présentation admin | `components/admin-ui/`, `components/admin-layout/`, `components/admin-context-controller/` sous Funding Web | Réutiliser panneaux, cartes, badges, thèmes, confirmations et navigation accessible FR/EN. |

Certains ports d’intégration de Preflight décrivent des interfaces sans adaptateur
raccordé. Un catalogue cible ne doit pas les présenter comme actifs. La préparation
locale et le connecteur externe doivent aussi respecter leurs exclusions d’activation
existantes; la salle ne doit pas permettre de les activer simultanément.

## Première version proposée

- Une entrée globale dans l’admin Funding : moteurs connus, états explicites,
  blocages et dernière observation.
- Une fiche par moteur : mission, dépendances, activité récente, dossiers concernés
  et commandes réellement prises en charge.
- Une entrée depuis Décisions et les dossiers : même salle, avec contexte conservé
  et lien de retour vers le dossier exact.
- Deux capacités initiales : publication automatique Funding et préparation
  Preflight, cette dernière avec un état de raccordement explicite.

Le contexte d’un dossier doit annoncer son périmètre. Une publication collective
peut concerner plusieurs dossiers; la salle ne doit pas présenter un lot collectif
comme une opération exclusive au dossier affiché. Pagination, limites et données
partielles doivent être visibles.

Les courriels et d’autres capacités pourront rejoindre la salle après validation
de ce premier parcours. La première version exclut un orchestrateur universel,
la gestion de processus Docker depuis l’admin et un bouton « tout démarrer ».
Aucun score de santé en pourcentage ne sera affiché sans méthode de calcul et
preuves explicables.

## Travaux à exécuter

### Lot 1 — Cartographier les faits et mesurer le parcours actuel

- Inventorier chaque capacité, son propriétaire, ses dépendances et ses commandes.
- Identifier pour chaque état la source réelle, la fraîcheur et les droits d’accès.
- Distinguer contrat existant, configuration, raccordement, simulation et mesure absente.
- Mesurer le parcours actuel sur des blocages synthétiques représentatifs : connexion
  non vérifiée, accès expiré, destination en pause et attente d’approbation.

Livrable : matrice des capacités et référence de mesure avant changement.
Critère de sortie : aucun état ni bouton prévu ne repose sur une capacité supposée.

### Lot 2 — Définir le contrat de supervision et les frontières

- Définir une projection commune typée : identifiant stable, mission, propriétaire,
  fonctionnement, santé, dépendances, mode, observations datées, incidents et actions.
- Définir les contextes global, moteur, dossier et publication collective.
- Spécifier les données inconnues, indisponibles, périmées ou partiellement chargées.
- Décrire séparément chaque commande : effet exact, cible, droits, confirmation,
  idempotence, audit, résultat incertain et possibilité de reprise.
- Garder les secrets hors des réponses et vérifier droits, tenant et applications
  autorisées côté services propriétaires.

Livrable : contrat de lecture, matrice de commandes et décision d’architecture si
les frontières changent. Critère : la salle n’acquiert aucune autorité métier nouvelle.

### Lot 3 — Assembler la supervision Funding en lecture seule

- Réutiliser les lectures natives des publications et les incidents existants.
- Fournir une projection serveur qui limite les données au périmètre autorisé;
  aucun accès Web à PostgreSQL ou aux secrets fournisseurs.
- Associer les destinations aux publications du contexte, sans mélange avec des
  comptes ou dossiers non concernés.
- Exposer les réglages et mesures disponibles sans déduire une santé de processus
  à partir d’un simple indicateur d’activation.

Livrable : consultation globale et contextualisée sur données synthétiques.
Critère : ouvrir ou actualiser la salle n’écrit aucune décision, ne teste aucun
compte externe et ne lance aucun envoi.

### Lot 4 — Construire l’interface et consolider les parcours

- Réaliser les cartes des moteurs, le détail et les états de chargement/erreur/vide.
- Donner priorité au problème, à sa preuve et à l’action utile; employer des
  libellés précis plutôt que « feed », « Accept » ou « erreur » sans contexte.
- Conserver dossier, sélection, filtres et retour lors des déplacements.
- Réutiliser les composants admin, les thèmes, les traductions et les raccourcis.
- Raccorder le bouton « Voir l’état des publications » à la salle.
- Retirer les diagnostics redondants seulement après couverture fonctionnelle
  vérifiée; garder les écrans propriétaires pour les opérations détaillées.

Livrable : parcours FR/EN sur mobile et ordinateur. Critère : un admin identifie
la destination et l’intervention attendue sans devoir chercher un second diagnostic.

### Lot 5 — Raccorder Preflight et les commandes autorisées

- Réutiliser le connecteur existant; compléter uniquement les lectures de supervision
  manquantes avec un contrat vérifié et une recette interapplications.
- Afficher les missions et résultats persistés, leur provenance, leur simulation
  et leur éventuelle obsolescence.
- Réutiliser les commandes métier natives prises en charge : pause, reprise,
  vérification ou réglages, selon les droits.
- Préciser l’effet avant confirmation : préparer des propositions ou reprendre
  des envois déjà approuvés sont des actions différentes.
- Réconcilier une réponse incertaine avant toute relance; garder le contrôle des
  versions et empêcher l’action depuis un dossier devenu obsolète.

Livrable : interventions ciblées, auditées et vérifiées. Critère : aucune commande
générique ne contourne les approbations Funding ou les restrictions Preflight.

### Lot 6 — Qualifier la valeur et préparer la mise en service

- Comparer aux mêmes scénarios du lot 1 le temps de diagnostic et de résolution,
  les erreurs de compréhension et le nombre d’écrans nécessaires.
- Fixer les objectifs chiffrés après la mesure initiale, puis documenter les résultats.
- Vérifier les droits, l’isolation, les réponses tardives, les erreurs partielles,
  les confirmations et l’absence de double effet après une interruption.
- Vérifier clavier, focus, lecteur d’écran, contraste, mobile et FR/EN.
- Compléter les guides propriétaires et préparer une activation progressive avec
  retour possible aux écrans existants. La mise en production exige son autorisation.

Critère de sortie : amélioration démontrée du parcours bloqué et absence de
régression sur les règles métier; une capture d’écran seule ne vaut pas recette.

## Séquence recommandée et décisions restantes

Commencer par les lots 1 à 4 pour les publications Funding, en lecture seule.
Raccorder ensuite la supervision Preflight et les commandes du lot 5. Élargir à
d’autres moteurs seulement après la mesure de valeur du lot 6.

À préciser pendant le cadrage : nom et route de l’entrée admin, granularité des
moteurs, durée de validité des observations, données de santé manquantes, périmètre
des opérateurs et mode de navigation vers les réglages propriétaires. Ces choix
ne justifient pas de créer dès maintenant des API ou intégrations hypothétiques.

L’effort principal se situe dans la fiabilité des états et des contrats, puis dans
la consolidation des parcours. L’habillage visuel vient après. Aucun chiffrage
calendaire n’est engagé avant l’inventaire des raccordements manquants.

## Règle de décision durable

Accepter une nouvelle carte, mesure ou commande si elle aide à répondre à une
question opérationnelle : que fait ce moteur pour ce dossier, sur quelle preuve
son état repose-t-il, et quelle intervention est possible maintenant ? Sinon,
éviter d’ajouter un tableau de bord supplémentaire.

Références : [architecture](../ARCHITECTURE.md),
[pilotage administratif](../operations/admin-pilotage.md),
[connecteur Preflight](../technical/preflight-connector.md),
[validation](validation.md).
