# Suivi de commandite — notes UX du 20 septembre 2026

Statut : premier lot implémenté et validé localement le 20 septembre 2026
(points 1 à 3). Les points 4 et 5 restent à reprendre. Les observations
ci-dessous décrivent la revue initiale, avant modification de l'interface.

Le lot porte sur la présentation et l'orchestration du suivi côté navigateur,
en français et en anglais. Risque modéré ; aucun changement de contrat API.

Page examinée : `https://localhost/fonds-des-batisseurs/suivi-commandite`.

## Contexte et objectif

Faciliter l'accès au dossier, rendre la prochaine action évidente et réduire
le défilement sur mobile. Conserver l'identité visuelle OpenG7 et les garanties
existantes de confidentialité, de paiement et de publication.

Deux situations distinctes ont été examinées :

- Visite sans lien privé : formulaire de récupération d'accès.
- Dossier ouvert : scénario synthétique avec paiement confirmé, informations
  d'entreprise à compléter et revue en attente.

La récupération par courriel, les brouillons persistants, les étapes du parcours
et le bouton « Compléter mes informations » existent déjà. Il s'agit surtout
de mieux les présenter. Voir les comportements livrés dans
[le suivi de commandite](./sponsorship-followup-improvements.md) et
[la reprise d'accès et les brouillons](./sponsorship-access-and-drafts.md).

## Recommandations pour l'utilisateur

### 1. Alléger le haut de page — priorité 1

Constat : le bandeau occupe environ 350 px en largeur mobile de 390 px.
Le formulaire d'accès est très large sur ordinateur et le bouton touche
visuellement le bas du champ courriel.

- Réduire la hauteur du bandeau, particulièrement sur mobile.
- Proposer « Accéder à ma commandite » à l'entrée sans dossier ; conserver
  « Suivi de votre commandite » après ouverture du dossier.
- Limiter la largeur du formulaire d'accès sur ordinateur.
- Ajouter de l'espace entre le champ courriel et le bouton.

### 2. Remonter la prochaine action et le formulaire — priorité 1

Constat : dans le dossier synthétique à compléter, le premier champ apparaît
à environ 2 400 px du haut sur mobile. Le paiement et la revue sont répétés
dans les cartes de synthèse, les explications et la liste d'étapes.

- Placer un bloc « Votre prochaine action » avant le récapitulatif détaillé.
- Donner davantage de poids à « Compléter mes informations » qu'à
  « Actualiser le statut », lorsque des informations sont attendues.
- Afficher rapidement le formulaire, puis regrouper les informations
  secondaires dans un résumé compact ou dépliable sur mobile.
- Adapter la présentation aux dossiers à compléter, soumis ou approuvés :
  ne pas inviter systématiquement une personne à modifier ses informations.

### 3. Distinguer brouillon et soumission — priorité 1

Constat : le brouillon est sauvegardé automatiquement, tandis que le bouton
« Enregistrer les informations » soumet les modifications à la revue.
L'explication actuelle est longue et séparée de l'action finale.

- Proposition de libellé : « Soumettre mes informations à l'équipe ».
- Garder un statut discret et visible « Brouillon enregistré », uniquement
  après confirmation serveur.
- Rapprocher l'explication de la soumission et conserver l'avertissement de
  retour en revue lorsqu'un dossier approuvé est modifié.
- Maintenir les états de sauvegarde en cours, d'erreur et de conflit.
- Préserver l'indépendance des téléversements de médias et du brouillon texte.

### 4. Afficher l'avancement réel de la publication — priorité 2

Constat : la rubrique Publication affiche actuellement un texte général
indiquant que le calendrier n'est pas communiqué dans le suivi.

- Présenter chaque avantage applicable : mention OpenG7, publication Facebook
  et publication LinkedIn, selon les engagements du dossier.
- Afficher l'état réel et le lien lorsqu'une publication existe ; afficher
  une date seulement si elle est connue et destinée au commanditaire.
- Prévoir une évolution du contrat API et de sa projection autorisée.
  Le contrat actuel ne fournit pas ces états au suivi.
- Ne jamais déduire une publication du paiement ou de l'approbation.
  Ne pas exposer les notes administratives ou les brouillons internes.

Ce point est une évolution fonctionnelle de risque modéré, à traiter dans
un lot distinct après analyse des contrats et des données disponibles.

### 5. Renforcer l'aide à l'accès — priorité 1

- Ajouter un lien « Besoin d'aide ? » accessible depuis l'entrée normale,
  pas seulement depuis l'état de lien invalide.
- Rendre la confirmation de demande plus visible et annoncer clairement
  la suite, avec le rappel de vérifier les indésirables déjà présent.
- Conserver une réponse identique pour une adresse connue ou inconnue.
  Une demande acceptée ne prouve pas la livraison d'un courriel.
- Déplacer le bouton musical sur cette page pour éviter le recouvrement
  du texte d'aide observé sur mobile.

Référence : [notifications de formulaire du W3C WAI](https://www.w3.org/WAI/tutorials/forms/notifications/),
pour des résultats et instructions de correction courts et compréhensibles.

## Garanties d'exécution : observations et limites

Contrôles ponctuels effectués pendant la revue, via Chromium et Playwright :

- Page locale accessible, réponse HTTP 200.
- Affichage examiné à 1 440 × 1 000 et 390 × 844 px.
- Aucun débordement horizontal observé sur les états examinés.
- Message de validation du courriel vide observé ; confirmation de demande
  examinée avec réponse API interceptée, sans envoi réel.
- Aucun problème signalé par axe sur les états d'entrée et de dossier testés.
  Cela ne constitue pas un audit complet d'accessibilité.
- Dossier examiné avec API interceptée et données fictives ; les mesures de
  longueur concernent ce scénario, pas tous les états possibles.

La première simulation du dossier interceptait mal la route des médias et
affichait donc une erreur artificielle. Une seconde simulation avec la route
correcte a été effectuée ; cette erreur n'est pas un défaut établi du produit.
La tentative automatisée de clic sur « Compléter mes informations » a échoué
à cause de l'encodage du sélecteur dans le script : cette interaction reste
à vérifier, sans conclure à un défaut de l'interface.

Les scripts ponctuels ont produit des observations, pas un résultat de suite
de tests verte. Aucun build, lint, suite complète, recette Docker, test de
livraison réelle des courriels ou contrôle de production n'a été exécuté
pour cette revue. Les captures temporaires ne sont pas des artefacts durables
du dépôt. Aucun changement applicatif n'a été réalisé.

## Reprise du travail

Premier lot : points 1 à 3, en français et en anglais, avec conservation des
comportements existants. Le point 5 pourra suivre dans un lot ciblé ; le point 4
demande une analyse API séparée.

Points d'entrée dans le code, relatifs à la racine :

- `apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/`
- `apps/funding-web/src/app/features/funding/components/sponsorship-followup/`
- `apps/funding-web/src/app/features/funding/services/sponsorship-draft.service.ts`
- `apps/funding-web/src/assets/i18n/fr-CA.json` et `en.json`
- `packages/funding-core/src/sponsorship-followup.ts`
- `tests/playwright/sponsorship-followup.spec.ts`
- `tests/playwright/sponsorship-access.spec.ts`

À la reprise, relire les sources et l'état Git avant de modifier. Vérifier les
états sans accès, lien invalide, dossier à compléter, soumis, approuvé et erreur
réseau. Contrôler le clavier, le focus, les annonces de statut, le mobile et
les deux langues. Exécuter les validations applicables d'AGENTS.md, notamment
la suite `yarn test:ui:followup` pour les changements d'interface ; ne pas
confondre ses fixtures interceptées avec une recette de la vraie API.

Les résultats d'implémentation et de validation du premier lot sont consignés
dans [le suivi des améliorations](./sponsorship-followup-improvements.md).
Les scénarios FR/EN à 390 × 844 px vérifient maintenant que le premier champ
est entièrement dans le premier écran, avant toute interaction ou défilement.
