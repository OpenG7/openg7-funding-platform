# Prompt Codex — Guide administratif OpenG7, refonte guidée par la maquette retenue

Je valide la direction de la **dernière maquette 4K OpenG7** : rail vertical de quatre modes à gauche, carrousel des bons en haut, bon et prochaine intervention au centre, contrôles de préparation à droite, bandeau des commandes Xbox et navigation en bas. **C'est la composition UX à rechercher ; ce n'est pas une preuve de données ni une demande de remplacer les processus métiers.**

Tu travailles sur `openg7-funding-platform` (Angular 21, Tailwind 4, API TypeScript). Je joins ou place dans le projet :

- `reponse-blueprint-guide-openg7-reference-finale.md` : analyse complète, wireframes, risques, critères et mapping des composants.
- La dernière image de maquette 4K OpenG7 retenue : référence visuelle uniquement.
- Les blueprints présents dans le dépôt, en particulier `docs/development/platform-functional-visual-blueprint.md`, `docs/development/admin-guide-blueprint.md` et le blueprint « Guide pour inspection UI UX » établi au code de référence `30e812a6`.

## Mission

**Commence par examiner le code réellement présent et la documentation, puis propose et réalise de petites modifications réversibles** pour simplifier le Guide sans dégrader ses quatre modes ni les décisions métier. N'invente pas de composants ou d'API déjà disponibles ; recherche leur propriétaire et réutilise-le.

### A. Audit préalable obligatoire

1. Note le commit de travail réel, les différences entre ce checkout et les blueprints et l'état des tests pertinents.
2. Identifie les composants réels de `admin-guidance`, `admin-automatic`, `admin-preparation`, `admin-layout`, leurs contrôleurs, les services de progression, le mapping Xbox, la gestion du focus, les thèmes et les traductions FR/EN.
3. Distingue **fait présent**, **constat sur capture**, **hypothèse**, **manque prouvé** et **amélioration souhaitée**.
4. Répertorie les préconditions et droits serveur, les versions, l'idempotence et la réconciliation des issues incertaines.
5. Avant mutation métier, présente un tableau : élément courant / composant propriétaire / modification prévue / risque / test.

### B. UI cible

- Sélecteur stable de quatre modes : **Découvrir**, **Suivi d'un paiement**, **Préparation des dossiers** (ancien « Automatique »), **Explorer les parcours**. Préserver les identifiants et les préférences existantes ou les migrer explicitement.
- Carrousel **un bon actif**, précédent/suivant, éventuellement jusqu'à six vignettes numérotées : ne pas inventer les images de chaque dossier. Distinguer **Bon consulté X/Y**, **Bons contrôlés X/Y si le serveur le fournit**, **Contrôles satisfaits X/Y** du bon ; ne jamais en déduire l'un à partir de l'autre.
- Bloc central clair : référence/version/montant/statuts exacts, **prochaine intervention avec CTA direct**, justification et destination propriétaire. Le texte « Documenter l'accord d'origine » concerne l'exemple illustré ; il ne doit pas être en dur.
- Panneau de droite : états dynamiques des contrôles du bon courant, sélection/inspection, problèmes priorisés, contrôles vérifiés repliables et `not_required` traité selon la projection. Ne pas coder sept contrôles fixes.
- **Autres actions** accessibles mais secondaires ; celles bloquées présentent la raison, sans bouton fictif ou mutation. Reprendre « Pourquoi ? », assistance, source, historique, Campagnes, contenu exact et restrictions dans les composants existants.
- Barre de bas : navigation et commandes Xbox A/B/X/Y **selon mapping existant**, focus et priorités. Aucune commande clavier/manette ne contourne droits, versions ou confirmations.
- Thème **premium light OpenG7** : blanc lumineux, bleu marine, doré modéré, dragon et identité visuelle canadienne ; illustrations (princesse/lion) décoratives et optionnelles. Garder le bon lisible avant tout.

### C. Contrats non négociables

1. Le Guide actuel est **non modal** ; son agrandissement ne doit pas introduire automatiquement de voile bloquant, de piège de focus ou masquer les commandes vitales de la page.
2. Ouvrir « Préparation des dossiers » ne **démarre** pas de passage ; voir le bon suivant ne le **contrôle** pas.
3. « J'ai lu, continuer » peut déclencher un contrôle serveur et des préparations privées : libellé et conséquence doivent l'annoncer, et non suggérer une validation métier.
4. Paiement confirmé ≠ accord accepté ≠ droits/consentement ≠ revue ≠ préparation approuvée ≠ fiche Web visible ≠ autorisation de publication ≠ preuve de livraison.
5. La préparation est approuvée uniquement via le contrôle `canApprove`, la version, le rôle et la confirmation du **bon partagé existant**, jamais via une barre graphique ou une déduction du client.
6. Réduire peut interrompre le conducteur navigateur **sans** annuler une opération serveur ; après état incertain, afficher la réconciliation et ne pas rejouer la requête à l'aveugle.
7. Les dossiers ouverts depuis un lot mettent ce lot en pause et doivent permettre le retour à la même cible.
8. Chaque module conserve son propriétaire de lecture ou de mutation ; pas de seconde implémentation de l'accord, de la revue, des médias ou de la publication dans le Guide.

### D. Procéder par petits lots

- **Lot 0 :** tests de sécurité, états serveur, versions, réduction pendant requête et navigation/contextes.
- **Lot 1 :** rail des modes, libellés, contexte paiement/dossier et progression bien nommée.
- **Lot 2 :** bon compact, intervention visible, contrôles à droite, actions repliées, carrousel et pied contextuel.
- **Lot 3 :** mobile/zoom/manette/focus/langues/thèmes, réessai local après erreurs de chargement.
- **Lot 4 :** finitions visuelles discrètes inspirées de l'image de référence.

### E. Vérifier réellement

Tests Playwright pertinents : `admin-guidance.spec.ts`, `admin-workflow-guide.spec.ts`, `admin-automatic-portfolio.spec.ts`, plus ceux du bon de préparation partagé s'ils existent. Inclure : ouverture sans effet ; décomptes indépendants ; navigation vers accord et retour ; réduction pendant requête ; refus d'approbation sans capacité ; conflit de version ; résultats incertains ; paiement A vs dossier B ; clavier, focus et Xbox ; données non requises ; FR/EN ; thèmes Clair/Nuit/Graphite ; mouvement réduit ; 1920×1080 à 125 % (environ 1536×864 CSS), 390×844, 390×667, zoom 200 %.

Ne confonds **jamais** tests exécutés et tests proposés. Si un test est uniquement simulé ou une manette physique n'a pas été essayée, précise-le.

### F. Compte rendu attendu

Fournis : tableau avant/après par composant, captures anonymisées/synthétiques, fichiers modifiés, invariants conservés, résultats des tests réellement exécutés, limites encore ouvertes et stratégie de retour arrière. **Ne fais ni publication, ni remboursement, ni envoi courriel, ni mutation réelle de données client pour valider une interface.**

**Critère final :** sur le premier écran, l'administrateur comprend le bon courant, le blocage prioritaire, la prochaine intervention, les conséquences de son clic et les contrôles satisfaits, sans perdre aucun processus existant.
