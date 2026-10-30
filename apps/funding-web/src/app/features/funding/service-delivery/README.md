# Feature de prestations Funding

Cette feature regroupe la démonstration des prestations Web et Facebook : liste,
dossiers, préparation, éditeur, historique, aperçus et protection des brouillons.
Les données et opérations restent celles du prototype local décrit dans le
[blueprint](../../../../../../../docs/development/service-demo-blueprint/blueprint-demo-prestations.md).

## Point d'entrée public

L'application et le guide chargent `index.ts` en différé. Il expose
`serviceDeliveryRoutes` pour la démo autonome et `ServiceDeliveryEmbeddedComponent`
pour l'espace embarqué. Les autres composants, directives, catalogues,
`ServiceDemoState` et `ServiceDemoNavigation` restent internes à la feature.
Les consommateurs externes passent par cet index, et les fichiers internes
s'importent directement entre eux.

Le préfixe public `/demo/prestations` appartient au routeur de l'application.
`service-delivery.routes.ts` compose ses routes enfants et fournit l'état sur le
shell parent, avec une instance de l'état et de la navigation. Le composant
embarqué fournit ses propres instances. Les pages et leurs métadonnées sont
communes aux deux présentations ; les brouillons d'une visite ne sont pas partagés
avec une autre instance.

## Accès depuis le guide administratif

Le menu du Guide administratif propose **Prestations** juste après **Découvrir**.
Ce bouton charge le composant public dans la zone à droite du menu, au sein du
guide. **Découvrir** accueille le module d’actualités et peut aussi demander
l’ouverture de cet espace ou d’un dossier synthétique précis. La rubrique
administrative, son URL, ses paramètres et son fragment restent en place.
La disposition s'adapte à la largeur disponible sur mobile.

La visite automatique est **temporairement désactivée** : Play, Pause et Arrêt
sont masqués et leur démarrage est bloqué. La navigation manuelle et les liens
des prestations restent utilisables. Pour réactiver le code conservé, passer
`SERVICE_DELIVERY_TOUR_ENABLED` à `true` dans la
[configuration du guide](../config/admin-guide-features.ts).

Une fois réactivé, **Play** ouvre la démonstration complète sur le premier
dossier synthétique, `atelier-boreal`, depuis Découvrir si nécessaire. Ses 26 étapes
présentent le résumé et l'accord. La visite active le lien **Présentation sur le
site**, consulte sa visibilité, puis revient aux prestations promises et active
le lien **Facebook**. Ces deux cartes sont aussi des liens utilisables au clavier.
Elle poursuit la préparation du contenu avec les cinq onglets de l'éditeur,
l'aperçu et l'approbation de préparation, puis la demande d'accord,
son aperçu d'envoi, l'accord reçu, les conditions, le contact et la confirmation
d'autorisation. La visite se poursuit avec la publication, sa planification, la
confirmation d'envoi et le résultat, puis les preuves et l'historique.

Chaque écran reste affiché 20 secondes ; la visite se termine après l'historique,
sans boucle. **Pause** conserve l'étape et le délai restant ; **Play** reprend ce
scénario sur le premier dossier, même si un autre a été ouvert manuellement.
**Arrêt** revient au résumé du premier dossier et remet la visite au début, sans
effacer les brouillons. Seuls les liens de navigation vers les prestations sont
activés automatiquement. Un lien absent ou différent de la cible synthétique
attendue met la visite en pause. La visite n'enregistre, n'approuve et n'envoie rien, ni ne
déclare une prestation accomplie. Elle n'appelle aucune API métier.

Le composant embarqué expose les signaux en lecture seule `tourState`
(`stopped`, `running`, `paused`, `completed`) et `tourStep`, le nombre `tourTotal`,
ainsi que `playTour()`, `pauseTour()` et `stopTour()`. L'input `active` suspend la
visite quand l'hôte masque cet espace. Un onglet navigateur masqué, un dialogue ouvert, une
interaction ou une navigation manuelle dans la démo suspendent aussi la visite ;
sa reprise reste volontaire. Le timer est détruit avec l'instance.

La navigation entre liste, dossier, éditeur et détails est conservée en mémoire
dans cette instance. Elle ne fait aucune navigation sur le routeur administratif
et ne réutilise pas les paramètres de recherche de la page hôte. Les ancres
conservent une URL valide vers la démo autonome pour l'ouverture volontaire dans
un autre onglet.

Le guide garde l'instance masquée lorsqu'on revient à **Découvrir** ou qu'on réduit
le panneau : la rouvrir retrouve les saisies et la page locale. Le contrat public
`canLeave()` permet au guard administratif de demander confirmation avant un
départ réel de la rubrique ; `cancelLeave()` annule une décision devenue caduque.
L'événement `closeRequested` permet de revenir au guide sans naviguer.
Annuler un départ conserve les brouillons. Un rechargement ou une fermeture du
navigateur reste soumis à la protection native des saisies locales.

Le contrat public `openDossier(id: string): boolean` accepte uniquement un
identifiant de `DEMO_DOSSIERS`. Il change la navigation locale de cette instance,
met la visite en pause, conserve les brouillons séparés par dossier et retourne
`false` pour une cible inconnue. L’hôte peut attendre le chargement différé avant
de transmettre la demande issue de Découvrir. Aucun accès aux composants ou
services internes de la feature n’est nécessaire. Ouvrir volontairement une ancre dans un autre onglet
conserve l’URL publique de la démo autonome.

Une déconnexion ou un changement de session détruit l’instance embarquée et
invalide les chargements encore en cours. Les essais de chargement et leur source
de réessai sont aussi réinitialisés ; aucun brouillon d’une ancienne instance
n’est transmis à une autre identité.

Le retrait des sélecteurs de suivi d'un paiement, de préparation et d'exploration
des parcours concerne le rail du guide. Leurs rendus contextuels, les préférences
historiques et les accès métier depuis Contributions ou **Vérifier un nouveau lot** restent
compatibles. La démo ne charge aucun dossier réel et n'exécute aucune de ces
opérations.

## Démo autonome

L'accès direct `/demo/prestations` conserve le routeur Angular et ses liens
profonds. Son guard protège les brouillons quand on quitte la feature.
Le paramètre optionnel `returnTo` accepte uniquement un chemin local sous
`/admin/fundraiser`, sans recherche ni fragment. **Retour à l’administration**
rejoint ce chemin ; sans destination valide, la sortie revient au cockpit.
Ce paramètre ne sert pas à l'injection dans le guide.

## Ressources et dépendances

Les composants standalone, templates, styles et animations sont colocalisés;
`i18n/` contient les traductions françaises et anglaises propres à la feature.
Les clés de traduction, hooks et URL publiques sont définis par les parcours
existants. Les images restent des assets partagés de l'application.

La liste réutilise l'illustration incluse dans le brouillon de chaque dossier,
sans changer de dossier courant. `DossierMediaPreviewComponent` est une molécule
de présentation interne : jusqu'à trois images selon sa propre largeur,
miniature si fournie, compteur des images restantes et retrait des sources
inaccessibles. Son lien rejoint la consultation **Médias** existante. Le survol
ou le focus de la ligne déplace lentement les images ; le tactile et la préférence
de mouvement réduit conservent un aperçu fixe. Les aperçus sont masqués lorsque
la largeur disponible privilégie l'identité et l'intervention.

Le prototype contient actuellement une seule illustration sélectionnée par
dossier, parmi les deux assets du guide. Il ne simule ni photos de partenaires
ni médias supplémentaires et ne charge aucune URL privée. La capacité multiple
du composant n'ajoute aucune source de données ni autorisation de publication.

Les dépendances communes Funding sont le service de traduction et les primitives
de présentation `AdminIconComponent` et `AdminDrawerComponent`. La feature ne
charge aucun client métier API, de paiement ou d'identité administrative.

Les [tests de frontière et de routage](../../../../../../../tests/service-demo-routing.test.mjs),
les [tests de navigation](../../../../../../../tests/service-demo-navigation.test.mjs)
et les [parcours navigateur](../../../../../../../tests/playwright/service-demo.ui.spec.ts)
vérifient les points d'entrée, les routes et les comportements. Les tests Node de
navigation utilisent `dist` et demandent d'abord `yarn build`.
Les [tests du guide administratif](../../../../../../../tests/playwright/admin-guidance.spec.ts)
vérifient la désactivation et la navigation manuelle sur le Web compilé avec des
fixtures, sans API métier. Les scénarios de lecture et de cadence restent conservés
et sont sélectionnés lorsque la visite est réactivée.
