# Détection des problèmes de chargement en développement

Statut : à implémenter ultérieurement, à la demande du 29 octobre 2026.

## Contexte

Sur `http://localhost:4200`, l'onglet Découvrir du guide administratif est resté
vide après l'intégration du module Actualités. Le serveur Angular conservait un
ancien template HMR, également servi aux nouveaux contextes navigateur. Son
redémarrage a rétabli l'affichage ; rafraîchir le navigateur seul ne suffisait pas.

Le [détecteur de nouvelle version](../../apps/funding-web/src/app/features/funding/services/app-update.service.ts)
et son [montage](../../apps/funding-web/src/app/features/funding/components/app-update/app-update.bootstrap.ts)
sont désactivés en développement. Ils comparent les noms des bundles compilés
de production et ne couvrent pas cet incident.

## Travail à reprendre

- Définir les signaux fiables pour détecter un échec de chargement d'un module
  différé ou une incohérence du rendu en développement, sans alerte pendant un
  chargement normal.
- Proposer explicitement un rafraîchissement lorsqu'il peut rétablir la page,
  en laissant l'utilisateur enregistrer ses modifications avant de confirmer.
- Signaler distinctement un problème du serveur Angular nécessitant un
  redémarrage, sans promettre qu'un rafraîchissement suffira et sans boucle
  de rechargements automatiques.
- Vérifier le comportement avec le serveur de développement réel, y compris
  les échecs de chargement et la reprise, en préservant le mécanisme de production.
