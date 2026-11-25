# Salle des moteurs intelligents — supervision en lecture seule

Route admin : `/admin/fundraiser/engine-room`. Cette première version compose
les lectures Funding existantes; elle ne crée ni orchestrateur ni commande moteur.
Elle dépend de la branche de clarification de l’admin (PR #424).

## Capacités et sources

| Capacité | Propriétaire | Observation | Limite |
| --- | --- | --- | --- |
| Publications des commanditaires | Funding | Réglage du worker, destinations, comptes, connexions, pauses, préparation et livraisons | Aucune mesure de présence du processus de publication; réglage activé distinct de fonctionnement confirmé |
| Préparation Preflight | Preflight pour les propositions; Funding pour la décision métier | Activation du connecteur ou de la préparation locale, signal du relais Funding, attente et quarantaine | Le service Preflight distant n’est pas contacté par cette consultation; les compteurs concernent le tenant du connecteur globalement |

Facebook et LinkedIn sont des dépendances du moteur de publications. Leur mode
simulation/réel et leur état sont affichés séparément. Une pause ou une connexion
non vérifiée ne devient pas une panne générale. Aucune clé, URL interne ou
configuration de fournisseur IA n’est renvoyée.

Les capacités et modules de diffusion sont représentés par des turbines dessinées
dans une scène industrielle CSS/SVG. L’en-tête et le contexte sont compacts; les
deux grandes machines Funding et Preflight occupent la scène, avec les modules de
diffusion physiquement reliés à Funding. Sélectionner une turbine ne fait que
changer l’inspecteur adjacent (ou vertical sur tablette/mobile). Celui-ci propose
Vue d’ensemble et Diagnostic : mission, état, conséquence, décision humaine,
provenance et liens d’intervention. Compteurs et fraîcheur occupent le bandeau
secondaire. Le dessin est statique : il ne simule pas une
rotation ou un fonctionnement que les observations disponibles ne prouvent pas.

Le mode de présentation `immersive` du cadre Angular admin est optionnel et désactivé
par défaut. Il applique la palette sombre uniquement à cette salle et regroupe les
outils globaux dans un menu sur mobile, sans retirer leurs fonctions. Sur mobile,
un sélecteur montre un moteur principal à la fois avec ses modules; le diagnostic
reste vertical. La scène décorative ne contient aucun contrôle : les turbines sont
de vrais boutons, avec noms, focus et états textuels indépendants de la couleur.

## Contrat HTTP et droits

`GET /api/admin/engine-room` (alias `/admin/engine-room`) accepte uniquement
`sponsorshipId` et `deliveryId`, UUID uniques. Les deux filtres se combinent par
intersection. Les paramètres inconnus, répétés ou invalides sont refusés avant
les lectures. Après autorisation, une autre méthode retourne 405, même pour le propriétaire.

L’authentification utilise `ensureAdminAccess`, y compris pour le rôle lecteur.
La salle conserve les frontières Funding : elle n’accède pas à la base Preflight.
Le connecteur utilise uniquement son tenant configuré côté serveur. Les réponses
sont privées et non mises en cache. Aucun diagnostic brut d’exception n’est exposé.

Le contrat public `EngineRoomSnapshot` dans `packages/funding-core/src/engine-room.ts`
décrit deux observations indépendantes. Une source en échec n’efface pas les
faits retournés par l’autre et ne devient pas un résultat vide réussi. Le champ
`observedAt` date le début de la lecture agrégée; les sources ne forment pas un
snapshot transactionnel commun. Connexion et signal de présence ont leurs dates
propres.

## Contexte, fraîcheur et parcours

- Vue globale : destinations et publications retournées par le service natif.
- Dossier : publications du commanditaire et destinations des sources/préparations
  retournées pour ce dossier. Les lectures natives sont limitées et peuvent être
  partielles; un résultat vide ne prouve pas l’absence d’obligations.
- Publication collective : le bouton de Décisions transmet `deliveryId` lorsque
  plusieurs dossiers sont regroupés, sans choisir arbitrairement un commanditaire.
- Le paramètre de navigation `decisionId` sert au retour exact vers Décisions et
  n’est pas envoyé à l’API de supervision. Aucun retour libre vers une URL externe.

Les publications sont limitées à 200 par le service propriétaire. Le signal
`partial` indique cette limite ou une file de préparation paginée. Les observations
de plus de trois minutes sont signalées comme anciennes. Le relais est récent
si son signal date de 45 secondes au plus; un signal absent ou invalide reste
inconnu. Cela ne prouve pas la santé du service distant ni celle du modèle IA.

Ouvrir et actualiser ne lance aucun test de compte, mission ou publication.
Les liens renvoient aux écrans propriétaires pour consulter ou intervenir avec
leurs droits et confirmations. Le panneau d’état ajouté dans Décisions est
remplacé par la salle pour éviter deux diagnostics concurrents.

Les réponses tardives sont invalidées après changement de périmètre, de session,
de rôle ou destruction de page. Un rafraîchissement en échec retire les anciennes
données privées. La page réutilise le cadre et les thèmes admin; les parcours sont
traduits en français et anglais, avec commandes natives accessibles au clavier.

## Recette et valeur à mesurer

Les tests `tests/admin-engine-room.test.mjs` vérifient projection, périmètre,
droits, absence de mutation HTTP, échecs partiels et interprétation des observations.
Les tests `tests/playwright/admin-engine-room.spec.ts` utilisent des API simulées
sur le Web compilé : FR/EN, mobile/ordinateur, accessibilité, contexte, échec et
réponse tardive. L’entrée depuis Décisions est couverte par
`tests/playwright/admin-decision-focus.spec.ts`.

La recette `tests/playwright/admin-engine-room-acceptance.spec.ts` est reliée au
registre admin et sélectionnée par le lanceur Docker isolé. Elle compare les
observations et réglages API avant/après consultation; sa découverte ne prouve
pas son exécution.

Cette recette ne qualifie ni les fournisseurs réels ni une connexion de production.
La référence humaine du temps de diagnostic reste à mesurer. Utiliser les mêmes
cas avant/après : compte non vérifié, compte expiré, destination en pause, moteur
désactivé, livraison en échec et attente d’approbation. Relever temps jusqu’au bon
diagnostic, nombre d’écrans visités et erreurs de compréhension; ne pas inventer de
pourcentage de gain.

Les commandes unifiées, la supervision des missions distantes et l’élargissement
aux courriels ne sont pas livrés ici. Leur ordre et leurs critères restent dans
l’[analyse des travaux](../development/salle-des-moteurs-intelligents.md).

Références propriétaires : [publications](../operations/admin-pilotage.md),
[connecteur Preflight](preflight-connector.md),
[règles de validation](../development/validation.md).
