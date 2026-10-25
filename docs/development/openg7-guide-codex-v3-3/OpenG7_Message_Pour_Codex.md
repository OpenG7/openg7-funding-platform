# Message à transmettre à Codex

Tu travailles sur OpenG7 Funding Platform. Ce dossier constitue la référence de conception pour l’espace **Prestations de services** et ses vues de préparation, d’autorisation, de publication, de correction et d’historique.

**Commence par lire** `README.md`, `01_BLUEPRINT.md`, `02_ARBORESCENCE.md`, puis les sections pertinentes de `03_ECRANS.md` et `04_ACTIONS.md`. Consulte les neuf images dans `images/`, leur statut dans `donnees/images.json` et la direction artistique dans `05_DIRECTION_ARTISTIQUE.md`. Les images sont des références visuelles, pas des preuves d’implémentation ou d’états métier.

Le cas principal est concret : une commandite payée prévoit une présentation Web et une publication Facebook. Je dois voir ce qui a été promis, ce qui manque, la prochaine intervention et la preuve du résultat. Employer les mots de ce parcours; éviter les libellés génériques qui cachent l’effet.

## Avant de modifier

Lis les instructions du dépôt et les fichiers concernés. Vérifie `git status --short` et conserve les changements locaux. Identifie les composants propriétaires, routes, projections, capacités serveur, versions, confirmations, mécanismes de reprise et tests. Les fichiers de `sources/` sont des références historiques : confronte-les au code actuel.

Rends un premier tableau **Conserver / Adapter / Retirer / Manquant** pour chaque écart important. Précise le fichier ou composant, l’action du registre, l’effet et le test. Ne crée pas un nouveau module si le propriétaire existe déjà. Ne suppose pas qu’une fonction dessinée est disponible.

## Direction à appliquer

Garde le style blanc et apaisant des images : bleu nuit, action principale bleue, cartes sobres, aperçu à droite, espace, hiérarchie claire. Adapte au vrai viewport, notamment 1920×1080 à 125 %, sans compresser artificiellement la page ou la typographie. Ne génère pas de nouvelles images et ne modifie pas les références fournies.

Une seule action principale par situation. Menu « Autres actions » compact et contextuel. Une seule entrée d’approbation de préparation. Réutilise les confirmations existantes; ne crée pas une cascade de modales ni deux validations identiques. Préserve le contexte, la sélection, les opérations en cours et le retour au contrôleur/Guide, y compris Bon/Passage/Autre.

Le registre contient les boutons, liens, onglets, champs, chevrons, menus et éléments à rendre non interactifs. Les commandes retirées restent documentées pour éviter leur réintroduction. Les actions de sous-écrans non dessinés sont des compléments proposés et conditionnels aux capacités réelles.

## Garde-fous

Paiement ≠ accord/consentement client ≠ revue/modération ≠ préparation approuvée ≠ visibilité Web ≠ autorisation d’envoi ≠ preuve de réalisation. Enregistrer ne publie pas. Une proposition IA ne valide rien. Un accord du client ne se fabrique pas en cochant une case administrative.

Conserve les versions, permissions, préconditions, confirmations, audits et l’idempotence. Réconcilie les résultats incertains au lieu de relancer sous un nouvel identifiant. Ne change pas rétroactivement l’offre acceptée. Une correction réévalue les décisions affectées selon leurs règles existantes.

Ne déclenche aucun courriel réel, publication réelle, remboursement, traitement massif ou déploiement pour réaliser cette refonte. Utilise des environnements et jeux de données de test isolés. N’ajoute aucune API, intégration IA, nouvelle table ou dépendance majeure simplement pour reproduire une maquette.

## Travail attendu

Après le diagnostic, avance par les lots de `08_ECARTS_ET_IMPLEMENTATION.md` dans la mesure où les capacités existent. Réalise les modifications sûres et leurs tests. Pour les fonctions absentes ou les changements métier, documente la lacune et isole le travail nécessaire au lieu de fabriquer une implémentation visuelle trompeuse.

La livraison doit contenir : fichiers modifiés; correspondance actions/écrans; écarts résolus; capacités manquantes; tests réellement exécutés et leurs résultats; captures du rendu réel aux viewports contrôlés; limites restantes. N’affirme pas qu’un test ou une qualification Xbox a été réalisé s’il ne l’a pas été.

Le résultat recherché : **j’ouvre un dossier, je comprends ce qui reste à fournir, je fais l’intervention nécessaire et je vois la preuve du travail réalisé, sans approuver deux fois la même chose.**
