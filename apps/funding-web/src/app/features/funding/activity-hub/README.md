# Guide administratif — actualités et inspirations

La démo `/demo/actualites`, avec ou sans slash final, présente un tableau de bord
éditorial pour les administrateurs d’OpenG7. Sa composition reprend le guide
illustré : panorama de montagne, rail latéral, titres serif bleu nuit et accents
or. Elle est chargée en différé par [l’entrée publique](index.ts).

Comme la démo Prestations, cette page est accessible sans authentification :
elle contient uniquement des exemples synthétiques identifiables et aucun
dossier administratif réel. Le même workspace est injecté dans l’onglet
**Découvrir** du Guide administratif, au sein des rubriques authentifiées.

## Intégration au Guide administratif

La frontière publique `index.ts` expose la page autonome et
`ActivityHubEmbeddedComponent`. Le workspace et ses composants de présentation
restent internes à la feature ; les consommateurs passent par cet index.

L’hôte charge le composant embarqué à la première ouverture de **Découvrir**.
Il fournit déjà le bandeau, les commandes de réduction et de placement, le rail
et le défilement du contenu. Le module injecté n’ajoute pas de fenêtre, de rail
ou de `main` au cadre administratif et ne change ni l’URL hôte, ni ses paramètres,
ni son fragment.

L’instance est masquée entre les onglets et pendant la réduction du guide. Sa
réouverture retrouve lectures, favoris, filtres, briefing et scénario de visite.
L’input public `active` ferme les détails ouverts quand cet espace devient
invisible. Le chargement initial conserve le focus sur le contrôle Découvrir.
Les panneaux modaux conservent la priorité du composant partagé de dialogue.

À l’ouverture, les sept choix de navigation apparaissent en cascade de gauche à
droite, sur moins de 600 ms. La préférence de réduction des mouvements désactive
cette animation ; un choix atteint au clavier reste immédiatement visible.

L’output public `serviceDeliveryRequested` demande l’onglet **Prestations** :
`null` retrouve son contexte courant ; un identifiant synthétique demande ce
dossier via `ServiceDeliveryEmbeddedComponent.openDossier()`. L’hôte attend le
chargement si nécessaire et les brouillons de Prestations restent séparés par
dossier. Les ancres conservent leur URL publique pour une ouverture volontaire
dans un autre onglet.

Une déconnexion ou un changement de session détruit l’instance et invalide les
réponses de chargement tardives. Les réessais sont manuels, bornés à trois et
limités aux fichiers de l’application. Lecture et favoris n’ajoutent aucune
confirmation de départ ; la protection des brouillons de Prestations reste
applicable dans son propre parcours.

## Découvrir

Le bandeau propose de réduire ou rouvrir le guide et de le placer en bas ou en
haut. Ces commandes organisent la présentation locale ; elles ne changent aucune
donnée administrative. Le rail conserve deux entrées principales : **Découvrir**
et **Prestations**, qui rejoint `/demo/prestations`. La rubrique avancée
**Explorer** donne accès à l’archive et à ses filtres.

| Bloc                  | Contenu de démonstration                                          |
| --------------------- | ----------------------------------------------------------------- |
| Découvrir             | Introduction, date fixe et panorama illustré                      |
| Journal du jour       | Quatre événements initiaux, puis un ajout local sur actualisation |
| À retenir aujourd’hui | Trois repères à consulter avant une intervention                  |
| Citation du jour      | Texte éditorial et illustration, sans attribution personnelle     |
| Nouveautés            | Quatre ressources illustrées ouvrant leur lecture détaillée       |
| Cette semaine         | Compteurs d’éléments distincts reliés à leur liste détaillée      |

Les images réutilisent les assets locaux `admin-guide-panorama.webp` et
`admin-guide-princess-lion.webp`. Les quatre illustrations de ressources sont
regroupées dans `/assets/activity-hub-resource-atlas.webp` : atlas de quatre
scènes généré avec `image_gen` natif, puis converti en WebP qualité 88, dimensions
2172 × 724 pixels. L’image de référence fournie localement n’est pas copiée dans
le dépôt.

Le [prompt complet des miniatures](resource-illustrations.prompt.txt) conserve
les instructions de génération et les paramètres de l’asset final.

Les chiffres, dates, activités et propositions ne prouvent ni opération réelle
ni fonctionnalité livrée. Les contenus et contrôles existent en français
canadien et en anglais.

## Journal, contexte et compteurs

Le journal opérationnel est distinct du fil éditorial. Il propose une recherche
sans distinction de casse ni d’accents, le type d’activité, l’origine humaine ou
automatique, la période et les éléments à vérifier. Les événements sont classés
du plus récent au plus ancien. Les périodes utilisent l’instantané fixe du
28 octobre 2026 à 14 h 30, heure de Toronto : aujourd’hui, semaine du 26 au
28 octobre ou tout l’historique. Un exemple du 23 octobre reste hors de la
semaine courante.

Ouvrir un événement montre sa date, son acteur fictif, son origine, sa référence
et son contexte. Les liens de dossier rejoignent exclusivement les dossiers
synthétiques de `/demo/prestations`. Consulter un événement ne valide aucune
action métier et ne change pas l’état d’un dossier.

Les compteurs et leurs listes utilisent le même sélecteur : une ligne par
`entityId`, avec l’événement le plus récent du type dans la période choisie.
Le journal complet conserve tous les événements. Les deux événements du média
Boréal n’ajoutent donc qu’un seul média au compteur. Les filtres du détail
portent sur cet état récent, sans faire réapparaître un état ancien du même
élément.

Le guide contextuel associé à un événement explique le sujet concerné. Le retour
retrouve le détail de l’activité et les contrôles conservent la restauration du
focus. Le guide aide à comprendre ; il ne constitue ni une approbation ni une
commande administrative.

## Lecture éditoriale et briefing

Le fil éditorial propose inspirations, nouveautés, ressources et favoris. Sa
recherche porte sur le titre, le résumé, l’auteur et le thème, sans distinction
de casse ni d’accents. Les filtres par thème et par contenus non lus se combinent
à la recherche. Changer de rubrique réinitialise ces filtres.

Ouvrir un contenu affiche son détail dans le panneau modal partagé et le marque
comme lu. Le parcours de lecture se recalcule depuis cet état local, séparément
des compteurs fictifs du tableau de bord. `AdminDrawerComponent` conserve les
protections clavier et la restauration du focus. Les favoris peuvent être
ajoutés ou retirés depuis les cartes et le détail.

Le briefing propose trois repères de visite fictifs : 26, 27 et 28 octobre. La
comparaison se fait par jour, car les contenus éditoriaux portent une date sans
heure ; elle ne prétend pas reconstruire une visite réelle. Les nouveautés non
lues, les favoris restant à lire et les guides sont calculés à partir des
contenus disponibles et des lectures et favoris de cette visite.

L’actualisation simulée ajoute deux contenus éditoriaux et un événement
opérationnel préparés dans les fixtures, une seule fois par visite. Elle ne
recharge aucun flux externe.

## Scénarios de disponibilité

Le sélecteur de démonstration expose cinq scénarios : normal, vide, chargement,
partiel et indisponible. Ils concernent les données opérationnelles ; les
contenus éditoriaux et leur lecture restent accessibles.

Une source connue vide produit zéro et une liste vide. Une source manquante ou
indisponible conserve une valeur inconnue, sans la remplacer par zéro. Les
indications de fraîcheur et de dernière valeur connue utilisent des dates fixes
du scénario ; elles ne prouvent aucune connexion ni synchronisation en cours.

## Responsabilités et limites

- [Page](activity-hub-page.component.ts) : cadre de la démo autonome et chargement
  du workspace.
- [Workspace](activity-hub-workspace.component.ts) : orchestration commune du
  tableau de bord, archive, filtres, lecture, favoris et panneaux de détail.
- [Composant embarqué](activity-hub-embedded.component.ts) : contrat public de
  visibilité et de demandes d’ouverture de Prestations, sans routeur hôte.
- [Dashboard](activity-hub-dashboard.component.ts) : organisme interne qui
  présente le journal, les repères, la citation, les guides et les compteurs
  synthétiques ; il émet des demandes de lecture et de changement de rubrique.
- [Activité](activity-hub-activity.ts) : contrats typés, événements synthétiques,
  bornes temporelles et sélecteurs de périodes et d’éléments distincts.
- [Journal](activity-hub-journal.component.ts) : organisme de filtrage des
  événements et de consultation des éléments uniques derrière un compteur.
- [Briefing](activity-hub-briefing.component.ts) : comparaison journalière des
  repères de visite avec les lectures, favoris et contenus éditoriaux locaux.
- [Expérience](activity-hub-experience.ts) : scénarios de disponibilité et
  contrat des compteurs, avec `null` pour une valeur inconnue.
- [Molécule d’entrée](activity-hub-entry.component.ts) : présentation d’un
  contenu et événements typés d’ouverture ou de sélection ; aucun chargement.
- [Fixtures](activity-hub-fixtures.ts) : données synthétiques typées et dates
  déterministes ; textes correspondants dans `i18n/`.
- [Index](index.ts) : frontière publique pour le chargement de la page.

Lecture, favoris, filtres et actualisation restent locaux à la visite. Les états
en mémoire sont conservés entre les rubriques et réinitialisés au rechargement.
Il n’y a ni API, ni stockage serveur, ni connexion à un flux réel, ni journal
d’audit. Le module ne collecte aucune télémétrie globale sur les interactions
des utilisateurs. Aucune lecture ou sélection ne partage, n’approuve ou ne
publie de contenu.

Un branchement réel devra identifier la source des contenus et définir les droits
d’accès vérifiés côté API. Le prototype ne constitue pas cette autorisation ni
la preuve d’une intégration livrée.

## Vérifications applicables

Depuis la racine du dépôt, avec les prérequis de la
[matrice de validation](../../../../../../../docs/development/validation.md) :

```sh
node --test tests/activity-hub-activity.test.mjs
yarn workspace @openg7/funding-web build --configuration production
yarn exec playwright test --config tests/playwright-activity-hub.config.mjs
yarn lint
git diff --check
```

Ces commandes décrivent les vérifications à exécuter, sans attester leur résultat.
Les tests Node couvrent les sélecteurs purs. La configuration navigateur regroupe
`activity-hub.ui.spec.ts` et `activity-hub-journal.ui.spec.ts` sur le Web compilé,
avec contenus fictifs et sans API, base de données ou fournisseur externe. La
présence du code et des scénarios ne constitue pas une preuve de recette UI.
