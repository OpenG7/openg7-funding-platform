# Changelog — Dossier Codex OpenG7 Guide V3.1

## Ajouté

- Contrat explicite entre **orientation**, **préparation contrôlée** (dont `advance` existant) et **décision/effet métier propriétaire**.
- Politique du menu **« Autres actions »** : secondaire, contextualisé, fermé par défaut, alimenté par les descripteurs existants, sans répéter le CTA ou l'approbation.
- Distinction entre **lire une source**, **examiner une proposition** et **relancer une analyse** : cette dernière peut être un vrai job et exige une activation explicite.
- Règles de fermeture/invalidation des actions lors d'un changement de contrôle, bon, version, mode ou session ; conservation de la priorité des confirmations.
- Instruction visuelle d'éviter les **boîtes imbriquées** et les grands boutons jaunes par défaut, tout en préservant une action principale lisible et accessible.
- **30 scénarios de recette V3.1**, comprenant lecture seule, états vides, cible B/C/A, A/B/X/Y, focus, conflits, résultats incertains et vue mobile.
- Nouveau prompt de démarrage Codex, lisible indépendamment du blueprint, mais pointant vers ses sources.

## Conservé depuis V3

- Quatre modes du Guide ; panneau non modal.
- Vues Bon consulté / Passage et bilan / Autre préparation comme **propositions de navigation locale**, à implémenter seulement si absentes.
- Priorisation des contrôles bloqués et groupe Vérifiés repliable ; carrousel numéroté.
- Trois cibles indépendantes ; compteurs non interchangeables ; manifeste figé.
- Confirmation unique et versionnée de l'approbation du bon.
- Conducteurs de lot/préparation ciblée distincts, demandes explicites, réconciliation.
- Profil Xbox réaffectable, priorités de dialogue, retour au neutre, DOM/focus accessible.
- Catégories d'aide et outils propriétaires ; droits serveur, FR/EN, thèmes, SSR et sélecteurs `data-og7`.

## Rectification conceptuelle

La formule **« le Guide accompagne, les modules exécutent »** ne doit **pas** conduire à supprimer le fonctionnement opérationnel déjà documenté de la **préparation automatique** : le Guide peut lancer volontairement un POST d'avancement du lot et des brouillons privés. Cette opération ne remplace aucune **décision métier** (approbation, revue, publication, remboursement, envoi).

## Non réalisé dans cette version documentaire

- Aucun refactoring Angular, aucune modification API, aucune PR créée.
- Aucun test nouveau de l'application ni essai avec manette physique.
- Aucune validation réelle du bon d'accord, de Stripe ou d'un fournisseur social.
