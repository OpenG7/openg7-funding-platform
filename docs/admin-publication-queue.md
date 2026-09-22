# Administration des publications

Le [pilotage des feeds](operations/publication-automation.md) est accessible à
`/admin/fundraiser/publications/automation` pour préparer les envois récurrents,
approuver le contenu final, consulter le calendrier des envois et traiter les exceptions.

`/admin/fundraiser/publications` est un accueil léger : trois liens vers des
espaces distincts et le carrousel des prochains lots. Aucun formulaire ne s’y
affiche. Chaque espace dispose de son adresse, de son titre et d’un lien
« Retour aux publications » :

| Espace                  | Adresse                                   | Usage                                                    |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Rédaction et validation | `/admin/fundraiser/publications/drafts`   | Écrire les textes et valider les brouillons              |
| Lots de publication     | `/admin/fundraiser/publications/batches`  | Regrouper les publications par canal et gérer leur envoi |
| Calendrier éditorial    | `/admin/fundraiser/publications/calendar` | Choisir les dates et attribuer les créneaux              |

Seul le contenu de l’espace actif est rendu. Les accès sont des liens natifs :
clavier, ouverture dans un autre onglet et historique du navigateur fonctionnent.
Le focus rejoint le titre après un changement de page, ou l’objet ciblé lorsqu’un
lien direct est utilisé. Les routes restent protégées par la session admin.

Dans Rédaction et validation, « Préparer une publication » ouvre le choix d’une commandite.
Le chargement parcourt toutes les pages de commandites approuvées et payées,
par groupes de 25, avant d'afficher celles qui ont un consentement public et une
cible avec au moins un canal. Une erreur sur une page affiche l'état d'erreur
avec possibilité d'actualiser, sans présenter une liste partielle comme complète.
Les formulaires
de nouveau lot et de nouveau créneau restent fermés jusqu’à leur ouverture
explicite. Les brouillons affichent un résumé et un bouton « Ouvrir » ; les lots
et créneaux se consultent dans une grille mensuelle. Un seul éditeur peut être
ouvert par espace. Les éléments publiés ou annulés sont
accessibles par le filtre de statut ou l’option d’historique. Un élément ouvert
reste visible après sa publication pour permettre de vérifier le résultat.

L’éditeur de brouillon privilégie le texte, l’enregistrement et la prochaine
étape de revue. La date, le lien, la note interne et les autres changements
de statut sont accessibles dans des panneaux repliables. Le marquage manuel
est nommé « Marquer comme publiée manuellement » et conserve sa confirmation.
L’envoi social reste une action distincte avec confirmation.

Les adresses partagent une instance du contrôleur de présentation grâce à un
matcher limité aux trois chemins déclarés. Changer d’espace ou revenir via
l’historique ne recharge pas les données. Les saisies de brouillons et de
créneaux sont conservées dans la page pendant une actualisation ou l’enregistrement
d’un autre élément. Elles ne constituent pas une sauvegarde serveur ; les
brouillons modifiés portent la mention « Modifications non enregistrées ».
Les anciens liens directs `draftId`, `batchId` et `slotId` redirigent vers la
nouvelle adresse correspondante, conservent leurs paramètres et ouvrent l’éditeur
avec le focus sur l’objet. Quitter ces liens ciblés recharge les listes complètes.
Un rechargement du navigateur ou une sortie de Publications abandonne les saisies
locales non enregistrées. Le serveur local de tests et la liste des routes clientes
Nginx acceptent les nouvelles adresses ; les chemins inconnus restent des 404.

## Calendriers des lots et des créneaux

Les pages Lots et Calendrier éditorial utilisent le même organisme de présentation
`AdminPublicationCalendarComponent`, standalone, OnPush et sans accès API.
La page adapte les données existantes au contrat `PublicationCalendarEntry` et
conserve la responsabilité des mutations et confirmations.

- Grille de six semaines, du lundi au dimanche, navigation précédent/suivant,
  choix direct d’un mois et retour à aujourd’hui. À l’ouverture, le calendrier
  rejoint la prochaine date connue, ou la dernière date passée si nécessaire.
- Les lots utilisent leur date planifiée, ou leur date de publication si la date
  planifiée manque. Les créneaux utilisent leur date de début. Les dates invalides
  ou absentes figurent dans « À planifier ».
- Toutes les cases et heures utilisent explicitement `America/Toronto` afin de
  comparer les événements dans le même fuseau. Le détail d’un créneau conserve
  sa date dans son propre fuseau. Les conversions des anciens champs de saisie
  ne sont pas modifiées par cette vue.
- Couleur et nom du canal, capacité et statut textuel figurent dans les cartes.
  Le filtre Facebook/LinkedIn est local. L’historique reste facultatif.
- Jusqu’à trois cartes par jour ; « + N autres » révèle tous les événements du
  jour dans l’agenda sous la grille. Sur mobile, les cases affichent les dates et
  le nombre d’événements ; un toucher sélectionne l’agenda du jour.
- Les flèches du clavier déplacent le jour sélectionné, y compris entre les mois.
  Cliquer sur un événement ouvre son éditeur dans le drawer admin existant.
  Échap ferme le panneau et restitue le focus. Le panneau signale aussi les erreurs
  d’action et conserve les confirmations de publication et d’annulation.
- Après confirmation serveur d’une nouvelle date, la carte se replace dans le
  calendrier. Naviguer dans les mois ou sélectionner un jour n’écrit rien côté API.

Le calendrier porte uniquement sur les données chargées par les endpoints
existants ; il ne charge pas un historique exhaustif en changeant de mois.

## Carrousel

La vue d’ensemble de `/admin/fundraiser/publications` présente un carrousel
horizontal. Ce composant de présentation Funding, standalone et OnPush, utilise
les lots, brouillons et créneaux déjà lus par la page. Il n’effectue aucune mutation.

- Les lots planifiés avec une date valide sont classés par date croissante, tous
  canaux confondus. Le premier est mis en avant. Une date passée reste dans la file
  tant que le lot n’est pas publié ou annulé ; il s’agit de l’ordre prévu, sans
  promesse de publication automatique.
- Les lots ouverts et les lots sans date exploitable viennent ensuite, par date
  de création puis identifiant. Leur position ne constitue pas une planification.
- Les lots publiés et annulés restent dans les détails existants, hors carrousel.
- Chaque carte indique le canal, les cibles connues, la date dans le fuseau du
  créneau (ou `America/Toronto` sans créneau), la capacité et jusqu’à deux noms de
  commanditaires. Le nombre restant renvoie au détail, y compris si certains
  brouillons ne figurent pas dans la réponse chargée.
- « Voir le lot » ouvre l’espace Lots et place le focus sur le lot existant sans
  requête supplémentaire ni perte des saisies des autres espaces.
- Le défilement est manuel : boutons, clavier (gauche/droite, Début/Fin) et geste
  tactile natif. La préférence de réduction des animations est respectée.
- Les états de chargement, erreur avec reprise et absence de lots sont traduits
  en français et en anglais.

Le résumé porte sur les réponses actuellement affichées, pas sur un total global.
Les limites existantes des endpoints (dont 100 lots) et le ciblage par `batchId`
continuent de s’appliquer. Aucune migration, variable d’environnement ou intégration
sociale supplémentaire n’est nécessaire. Les conversions des champs de saisie
historiques restent un sujet distinct de cet affichage.

Validation navigateur isolée avec API synthétique :

```sh
yarn workspace @openg7/funding-web build
yarn tsc -p tests/tsconfig.admin-ui.json
yarn playwright test --config tests/playwright-admin-ui.config.mjs admin-publication-queue.spec.ts
```

La suite vérifie les adresses directes, leur rechargement, la protection de session,
l’historique précédent/suivant, les chemins inconnus, l’ordre, les exclusions, le fuseau affiché, les accès clavier et
mobile, le focus vers le détail, la conservation des saisies lors de cette ouverture,
les langues et les états vide/erreur/reprise. Elle couvre aussi les formulaires
repliés, l’historique, les confirmations et la conservation des modifications d’un
autre brouillon lors d’un enregistrement. Les tests de calendrier couvrent le
changement d’année, les filtres, les jours chargés, les drawers, les erreurs et
les petits écrans. Les tests Node de `publication-calendar.test.mjs` vérifient
les années bissextiles, le tri et les dates Toronto près de minuit et des changements
d’heure. Elle n’envoie aucune publication réelle.
