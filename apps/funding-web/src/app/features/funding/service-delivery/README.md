# Feature de prestations Funding

Cette feature regroupe la démonstration des prestations Web et Facebook : liste,
dossiers, préparation, éditeur, historique, aperçus et protection des brouillons.
Les données et opérations restent celles du prototype local décrit dans le
[blueprint](../../../../../../../docs/development/service-demo-blueprint/blueprint-demo-prestations.md).

## Point d'entrée public

L'application charge `index.ts` en différé depuis `app.routes.ts`. Son seul
export est `serviceDeliveryRoutes`; les composants, directives, catalogues et
`ServiceDemoState` restent internes à la feature. Les consommateurs externes
passent par cet index, et les fichiers internes s'importent directement entre eux.

Le préfixe public `/demo/prestations` appartient au routeur de l'application.
`service-delivery.routes.ts` compose ses routes enfants et fournit l'état sur le
shell parent. Le guard de sortie et la durée de vie des brouillons sont donc
communs à tous les écrans de la feature.

## Ressources et dépendances

Les composants standalone, templates, styles et animations sont colocalisés;
`i18n/` contient les traductions françaises et anglaises propres à la feature.
Les clés de traduction, hooks et URL publiques sont définis par les parcours
existants. Les images restent des assets partagés de l'application.

Les dépendances communes Funding sont le service de traduction et les primitives
de présentation `AdminIconComponent` et `AdminDrawerComponent`. La feature ne
charge aucun client métier API, de paiement ou d'identité administrative.

Les [tests de frontière et de routage](../../../../../../../tests/service-demo-routing.test.mjs)
et les [parcours navigateur](../../../../../../../tests/playwright/service-demo.ui.spec.ts)
vérifient son point d'entrée, ses routes et ses comportements.
