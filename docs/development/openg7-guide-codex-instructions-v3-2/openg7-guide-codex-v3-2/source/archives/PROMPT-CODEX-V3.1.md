# Mission Codex — OpenG7 Funding Platform, Guide administratif V3.1

Travaille dans le dépôt local `openg7-funding-platform`. Voici le dossier de référence :

- `INSTRUCTIONS-CODEX.md` — consignes détaillées et lots ;
- `BLUEPRINT-UX-V3.1-RESPONSABILITES.md` — spécification UX et contrat « Autres actions » ;
- `RECETTE-V3.1.md` — scénarios à préserver/compléter ;
- `source/README-blueprint-actuel.md` — état de l'implémentation **avec modifications locales non commitées** ;
- `source/blueprint-proposition-v3.md` — proposition V3 préexistante ;
- `captures/` — sept captures de référence ;
- `reference/extrait-avant-a-simplifier.png` — exemple de densité visuelle à améliorer.

## Objectif prioritaire

Simplifier **« Pilotage de la préparation »** et **« Autres actions »**, sans retirer une seule action secondaire admissible ni créer de deuxième composant de décision métier. La séparation cible :

1. **Le Guide oriente et lit** ;
2. **le conducteur du Guide prépare explicitement** les brouillons privés via ses services/API actuels, quand l'utilisateur le commande ;
3. **les écrans propriétaires modifient, modèrent, approuvent, publient, envoient ou remboursent**, avec leurs droits, versions et confirmations.

**« Autres actions »** doit être un menu secondaire compact et contextuel, fermé par défaut, dont les entrées proviennent des descripteurs existants. Le CTA principal reste visible **une seule fois** hors du menu ; **Approuver la préparation** conserve son entrée unique et confirmée dans le bon partagé. Garder les actions de consultation de Campagnes/historique et les actions d'assistance/source/relance lorsque réellement disponibles, avec leurs préconditions et propriétaires ; ne pas lancer un job à l'ouverture du menu. Pour une action indisponible, expliquer la raison, sans grande carte grise répétée.

Remplacer la composition actuelle de multiples cadres imbriqués et du gros CTA jaune par une disposition **premium légère** : un titre métier, un constat concis, une conséquence, des liens Pourquoi/Assistance discrets, une action proportionnée et le menu secondaire. Conserver le bleu marine, les fonds lumineux et l'or en accent. Préserver tous les thèmes, FR/EN, lisibilité et responsive.

## Ordre obligatoire

**1. AUDITE avant toute modification.** Donne `git status`, branche/HEAD, état des modifications locales, matrice réelle du CTA et des actions secondaires (par rôle, contrôle, version, préconditions), composants et tests concernés. Ne réinitialise pas l'arbre de travail.

**2. Propose et réalise le lot minimal** de séparation des actions et du menu, avec comparaison avant/après. Ne commence pas par modifier les API ou fabriquer une nouvelle route. Ne fais jamais disparaître une action valide simplement pour simplifier le visuel.

**3. Réalise ensuite la simplification visuelle**, les traductions et l'accessibilité, en préservant le bon partagé utilisé par Guide, Campagnes et le dossier Publication.

**4. Vérifie le clavier et la manette simulée** : le profil A/B/X/Y est contextuel et réaffectable ; A sur un contrôle sélectionné en `peek` peut ouvrir Autres actions, tandis que A sur un bouton focalisé active ce bouton ; B/Échap ferme, conserve le focus, confirmations prioritaires et retour au neutre.

**5. Ne poursuis l'unification Bon/Passage/Autre que si elle manque réellement** dans le worktree et après vérification des effets. Un changement de vue ou de bon ne lance aucun POST ; le lot continue d'utiliser son seul moteur, le manifeste figé, la reprise/réconciliation et les cibles indépendantes.

## Invariants essentiels

Paiement, consentement, accord accepté, revue, modération, approbation privée, visibilité, autorisation sociale, livraison, preuve et courriel livré sont **des faits distincts**. Une lecture ou un menu ouvert n'autorise aucune mutation. `advance` reste un geste de préparation explicite. Ne pas dupliquer l'approbation ni le job d'assistance. Les droits API, la version, la confirmation, l'audit et l'idempotence restent souverains. Pas d'annonce de succès avant retour confirmé. Panneau **non modal** et aucun piège de focus.

## Livraison

Pour chaque lot : explique les changements, cite les fichiers et les scénarios `R31-xx` réellement couverts, exécute les tests ciblés (unitaires/E2E/typecheck/build/lint selon portée), produis les captures desktop/mobile avec données synthétiques et énumère ce qui n'a pas été testé. Si un risque P0 apparaît (mauvaise cible, décision implicite, rejeu d'opération incertaine ou approbation dupliquée), arrête l'évolution visuelle et corrige ou rapporte d'abord ce risque.

**Commence maintenant par l'audit et le lot minimal « Autres actions / CTA ».**
