# Suivi de commandite — fiabilité et expérience

## Tâches réalisées

1. **Enregistrement et reprise** : attendre `received: true` et `recorded: true`, bloquer les soumissions concurrentes, conserver la saisie sur erreur et distinguer une sauvegarde confirmée d'une actualisation échouée. Les erreurs de validation du POST ne sont pas assimilées à un lien expiré.
2. **États du parcours** : distinguer les paiements en attente, confirmés, échoués, expirés, remboursés et en litige. L'approbation ne complète jamais l'étape de publication : le contrat public actuel ne fournit aucun état de publication. Une commandite approuvée s'ouvre en consultation ; modifier les renseignements annonce le retour en révision et une sauvegarde identique est bloquée dans l'interface.
3. **Formulaire et langues** : afficher les erreurs après interaction ou soumission, placer le focus sur le premier champ invalide, proposer des liens de correction, conserver la saisie lors d'une actualisation et synchroniser l'autoremplissage. Textes, erreurs, médias, dates et montants disponibles en français et en anglais. Le changement de langue conserve la route privée et reprend le jeton de session.
4. **Composition et tests** : séparer le statut, le formulaire et les médias dans trois composants standalone OnPush de la feature Funding. Ajouter une suite navigateur locale avec API interceptée et adapter les contrôles historiques au découpage.

## Résultat visible

- Boutons d'actualisation et de reprise après indisponibilité ; lien invalide ou expiré distingué des erreurs réseau.
- Aucun succès d'enregistrement déduit du seul statut HTTP 200. Après une première sauvegarde confirmée, une erreur de relecture ne permet pas de soumettre de nouveau le même contenu.
- Les renseignements restent consultables lors d'une panne transitoire, avec indication qu'ils peuvent être anciens. Un accès devenu invalide retire le dossier de l'écran et efface son jeton de session.
- Les fichiers sont enregistrés dès le téléversement, indépendamment du bouton d'enregistrement du formulaire. Les limites viennent de l'API ; les miniatures réussies survivent à un échec de relecture puis sont réconciliées avec la liste serveur. La suppression nécessite une confirmation.
- Aucun nouveau mécanisme de publication, de paiement ou de remboursement. Les états `paid`, `refunded` et `disputed` conservent leur admissibilité d'édition actuelle, avec des messages distincts.

## Composition

- Page routée : chargement, jeton, sauvegarde, erreurs et actualisation.
- `SponsorshipFollowupStatusComponent` : organisme de présentation, lecture seule des faits reçus.
- `SponsorshipFollowupFormComponent` : organisme de formulaire, validation, consultation/édition et événement de sauvegarde typé.
- `SponsorshipFollowupMediaComponent` : organisme Funding dédié au cycle de vie des médias privés et de leurs aperçus.
- `sponsorship-followup-ui.ts` : normalisation du brouillon, comparaison sans changements et erreurs de transport structurées.
- Les catalogues restent dans `src/assets/i18n`. Les styles sont limités aux composants de ce suivi.

## Validation de la PR #119

Sous Node 22 :

```sh
yarn test
yarn test:ui:followup
yarn lint
git diff --check
```

`yarn test:ui:followup` construit Angular, vérifie les types et exécute uniquement des scénarios avec données synthétiques via un serveur local. Il ne charge pas `.env`, ne démarre pas l'API et n'utilise ni Stripe ni PostgreSQL.

Les cas navigateur couvrent notamment la reprise réseau, la confirmation tardive du paiement, `recorded: false`, les erreurs de validation serveur, les doubles soumissions, l'autoremplissage, le retour en révision, les jetons invalides, les médias, le clavier, les deux langues et les largeurs mobile/desktop.

Résultats locaux : 230 tests Node réussis ; 22 tests navigateur réussis ; build Angular et 22 routes publiques pré-rendues ; vérification TypeScript complète réussie. Le lint termine sans erreur, avec un avertissement existant dans `scripts/smoke-public.mjs`. Le format des fichiers de ce changement et `git diff --check` sont conformes. Le contrôle de format global signale encore 323 fichiers hors périmètre.

Les contrôles historiques de présence de chaînes dans les sources restent des garanties statiques. La suite isolée vérifie les interactions, sans prouver le fonctionnement de la pile Docker ou des fournisseurs externes. Les scénarios Docker ont été adaptés au nouveau mode d'édition dans la PR #119 ; ils n'avaient pas été rejoués dans ce lot.

## Recette du suivi après la PR #119

Les workflows `admin-acceptance.yml` (pull requests) et `deploy.yml` (validation de `main`) exécutent explicitement `yarn test:ui:followup`. Un échec bloque la suite du job. Les traces et captures sont conservées dans les artefacts `test-results/` déjà prévus par ces workflows. Docker écrit dans son propre sous-répertoire pour ne pas effacer les preuves de la suite isolée au démarrage. La suite utilise Chromium sur ordinateur et un Pixel 5 émulé pour les scénarios marqués `@mobile`, chacun exécuté une seule fois.

`playwright.config.ts` exclut ces fixtures interceptées de ses suites Docker, à partir du `testMatch` de leur propre configuration. Le test `playwright-followup-selection.test.mjs` interroge la découverte Playwright pour vérifier l'absence de doublons et la présence des parcours persistés dans les deux modes Docker.

La commande suivante utilise la vraie API et PostgreSQL dans une pile locale jetable, sans charger `.env`. Stripe est remplacé par le serveur de test et SMTP est désactivé :

```sh
yarn test:e2e:acceptance tests/playwright/sponsor-navigation.spec.ts tests/playwright/sponsor-rejected-state.spec.ts
```

Le scénario de resoumission dispose d'une fixture approuvée dédiée. Il vérifie la consultation initiale, le blocage d'une sauvegarde identique, la persistance des changements, le maintien du paiement confirmé, le retour en révision et le retrait de l'annuaire public. Le rechargement doit retrouver les renseignements enregistrés grâce au jeton conservé en session. Les tests d'annuaire et de validation du formulaire conservent leur propre fixture approuvée et ne dépendent plus de cette resoumission.

Résultats locaux du 18 septembre 2026, sous Node 22 :

- `yarn test` : 231 tests Node réussis.
- `yarn test:ui:followup` : 22 tests navigateur réussis ; build Angular et 22 routes pré-rendues.
- Recette Docker ciblée ci-dessus : 10 tests réussis, après construction des images, migrations sur la base jetable et chargement des fixtures. La pile a été supprimée par le runner à la fin.
- Vérification TypeScript complète réussie ; lint sans erreur, avec le même avertissement préexistant dans `scripts/smoke-public.mjs`.
- Format des fichiers du lot et `git diff --check` conformes. Le contrôle de format global reste en échec et signale 345 fichiers hors lot dans cette exécution.

Ce lot porte sur les garanties d'exécution, sans changement de comportement applicatif ni nouvelle migration. La suite Docker complète et les workflows GitHub n'ont pas été exécutés pour ce lot ; les intégrations externes réelles restent hors de cette recette locale.

## Portée et limites

Ces limites décrivent les PR #119 et #120. Le lot suivant ajoute une [récupération d'accès et un brouillon persistant](./sponsorship-access-and-drafts.md), avec contrats API, migration et garanties d'idempotence côté serveur.

- Risque modéré : modification du suivi et de son orchestration côté navigateur.
- Aucun changement de contrat API, migration, backfill ou opération de production.
- La protection contre une sauvegarde identique est locale à cette visite ; elle n'ajoute pas de garantie d'idempotence entre appareils côté API.
- Le suivi reste rendu côté client, comme auparavant ; le build vérifie également le pré-rendu des routes publiques.
- Les modifications de saisie sont conservées lors des actualisations de statut. Elles ne constituent pas un brouillon persistant après fermeture ou rechargement de la page.
