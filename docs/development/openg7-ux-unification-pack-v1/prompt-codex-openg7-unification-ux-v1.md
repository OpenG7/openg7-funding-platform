# Prompt Codex — OpenG7 Funding Platform — Unification UX/UI : PR-UX-00 puis PR-UX-01

Tu interviens dans `OpenG7/openg7-funding-platform`, sans réécriture fonctionnelle générale.

## Références obligatoires

1. `docs/development/platform-functional-visual-blueprint.md` — version documentaire fournie depuis le commit `9bd24edb1c2d86d942907023e7fa53aa12fd41fd`, dont l'inventaire du **code** est `b00ad2b2` sur `feat/admin-campaigns`.
2. `openg7-platform-unification-ux-blueprint-v1.md` — proposition d'unification transverse, **non implémentée**.
3. `openg7-ux-backlog-priorise-v1.md` — tâches proposées et critères de réception.
4. `admin-sponsorship-dossier-blueprint-v2.md` — proposition spécialisée fondée sur un autre snapshot : **ne pas supposer que son état « présent » reflète ton checkout courant**.
5. Contrats API, politiques de rôles et tests **du checkout réel** ; ils ont priorité sur tout exemple UX.

Si les fichiers de proposition ne sont pas dans le dépôt, demande qu'ils y soient fournis ou utilise les versions transmises dans l'espace de travail. Ne fais pas semblant de les avoir lus.

## Mission : étape A — PR-UX-00 (audit sans changements métier)

1. Relever la branche, le commit HEAD, l'état du working tree et les PR déjà fusionnées qui touchent les surfaces. Ne pas écraser de modifications non commitées.
2. Comparer l'inventaire `b00ad2b2` et le code actuel sur : `AdminLayout`, en-têtes et routes du Cockpit / À traiter / Pilotage / Assistant ; page Commandites et déclencheur de modération **dans l'en-tête** ; panneau transversal ; Factures et Dépenses ; modes IA/médias/automate ; navigation contextuelle ; confirmateurs et tiroirs.
3. Pour chaque observation, établir une matrice `Route | composant source | comportement constaté | source du blueprint | compatible / divergence / inconnu | importance | test existant`.
4. Vérifier notamment : boutons `owner` dans Factures/Dépenses ; présence exacte de la modération dans l'en-tête (ne pas introduire un doublon) ; Assistant `mock/disabled` ; Sharp vs vision/OCR ; progression unique ; alias de dossier `media/refund` ; gestion d'issues incertaines.
5. Repérer les tests existants et noter leur niveau de preuve. **Ne pas exécuter de paiement, remboursement, publication sociale, mail ni opération réelle.**
6. Livrer le rapport d'écarts et proposer une liste restreinte de fichiers pour PR-UX-01.

## Mission : étape B — PR-UX-01 (après audit)

Sur la branche prévue et après avoir confirmé les capacités serveur du code courant :

- **Factures** : aligner l'affichage du bouton de génération/backfill sur la capacité exacte, pas seulement un générique `canManage`. Conserver lecture, aperçu PDF et liens de consultation permis à chaque rôle.
- **Dépenses** : aligner les champs et actions de création/édition/publication sur les droits effectifs, avec mode lecture seule cohérent ; conserver les confirmations métier.
- **IA / médias / publications** : indiquer explicitement les capacités `disabled`, `mock`, `not_configured`, ou une confirmation externe réellement observée. Ne pas transformer une analyse technique Sharp en conclusion de vision/OCR, ni un statut social déclaré en preuve de livraison.
- **Issues incertaines** : garantir dans l'interface l'accès au workflow existant de réconciliation et l'absence de bouton déclenchant un nouvel effet externe sans vérification préalable.

Ne jamais modifier les autorisations côté API pour rendre une mauvaise action UI « valide ». Corriger l'UI en respectant les contrats serveur ; si la capacité manque dans les projections, documenter le besoin avant ajout.

## Invariants absolus

- Paiement confirmé par le processeur ≠ offre acceptée ≠ consentement/droits ≠ revue ≠ préparation approuvée ≠ visibilité Web ≠ autorisation de livraison ≠ preuve de livraison.
- La soumission du commanditaire ne peut pas être fabriquée par une correction administrative de ses coordonnées.
- Offre et prestations historiques ne sont pas réécrites par le barème courant.
- Le modèle de rôles `reader/operator/owner` et les confirmations/version/idempotence du serveur restent souverains.
- `uncertain` signifie réconciliation ; aucune reprise aveugle avec une nouvelle requête.
- Un CTA de synthèse peut naviguer, non approuver, rembourser, publier ou expédier directement.
- Pas de composant de modération concurrent : utiliser l'organisme transversal actuel, avec sujet et version exacts.
- Préserver les cinq onglets du dossier, alias `tab=media`/`tab=refund`, IDs profonds et retour contextuel.
- En environnement de test, toutes les données externes sont fictives/contrôlées ; aucune action live involontaire.

## Tests et comptes rendus

Tests disponibles à considérer selon configuration réelle et temps acceptable :

```sh
yarn test
yarn lint
yarn workspace @openg7/funding-web build --configuration production
node scripts/check-e2e-selection.mjs
```

Cibler aussi les tests Playwright existants portant sur rôles, dossier commanditaire, modération, Assistant, Campagnes, automatisation et responsive. L'inventaire source rapporte 7 202 tests réussis, 8 ignorés, 29 Playwright ciblés réussis avec API synthétiques, et un bundle initial à 898,39 ko pour un budget d'avertissement de 800 ko ; **ne pas présenter ces anciens chiffres comme des tests que tu viens d'exécuter**.

Ajouter les tests nécessaires pour :

1. `reader`, `operator`, `owner` : même API et UI cohérentes, cas de refus 403.
2. Chargement, erreur, données anciennes et capacité indisponible.
3. Simulation vs service réel : mentions véridiques.
4. Aucun clic d'aperçu ou de navigation ne cause de mutation.
5. Pas de deuxième tentative aveugle après réponse incertaine.
6. Clavier/focus et viewport CSS 1536×864 (1920×1080 @ 125 % en hypothèse), 390 px, zoom 200 %.

## Livrables Codex

- Rapport PR-UX-00 daté, avec HEAD, écarts et périmètre de preuve.
- Diff PR-UX-01 ciblé, liste de fichiers, justification et captures si les outils le permettent.
- Tableau des tests réellement lancés (réussis/échoués/ignorés), risques résiduels et contraintes de production.
- Actualisation documentaire distinguant `état inventorié`, `proposé`, `implémenté`, `vérifié` et `déployé`.

**Suite volontairement hors de cette première PR :** refonte du shell, harmonisation de Cockpit/À traiter/Pilotage/Assistant, V2 du dossier avec bouton de modération en en-tête, simplification de la chaîne des publications, finitions visuelles et nouvelles capacités IA. Ces lots font l'objet d'autres PR et ne doivent pas être mélangés avec les corrections de permissions.
