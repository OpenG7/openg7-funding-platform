# Campagnes et prestations promises

La rubrique `/admin/fundraiser/campaigns`, accessible depuis le menu administratif,
regroupe les prestations enregistrées pour les achats de commandite confirmés.
Elle sert à suivre le travail prévu et réalisé ; sa consultation n’envoie aucune
publication et ne confirme aucun paiement.

## Liste et préparation

Une ligne représente une obligation de l’offre acceptée, identifiée par dossier,
canal, destination et numéro de passage. Plusieurs publications promises donnent
plusieurs lignes, même sans brouillon. La quantité vient de l’accord enregistré,
jamais du barème actuel. Les accords historiques non qualifiés restent à traiter
dans leur écran propriétaire avant de fournir des prestations à cette liste.

Les prestations à venir restent visibles lorsque le dossier est incomplet ou que
la préparation attend son approbation. Le tri initial place en premier les
préparations explicitement approuvées dans leur version actuelle. L’approbation
est réévaluée côté serveur à partir du dernier accord et des faits actuels ; une
version périmée apparaît comme une nouvelle revue requise.

Le détail reprend le [pilotage de la préparation](../operations/admin-pilotage.md#preparation-pilot),
le contenu disponible et les liens vers les écrans propriétaires. Le paiement,
la préparation, la revue du commanditaire, l’autorisation de publier et la
livraison conservent chacun leur état. Une date prévue ne vaut pas autorisation.
Le regroupement par dossier porte sur les lignes de la page courante ; les
filtres et le tri s’appliquent à toutes les prestations avant pagination.

Une livraison ne retire pas la prestation de la liste. Le détail peut donc
présenter une réalisation conservée avec une préparation à revoir. La preuve
doit être [qualifiée pour cette obligation exacte](sponsorship-fulfilment.md) :
un ancien statut « publié », une URL ou une simulation seuls ne suffisent pas.
Les preuves restent liées à leur canal, destination et passage ; la visibilité
actuelle demeure une information distincte de la livraison attestée.

## État de navigation et actualisation

La route fournit la feature NgRx `adminCampaigns` et sa
[façade de lecture](../../apps/funding-web/src/app/features/funding/services/admin-campaigns-store.service.ts).
Le store conserve en mémoire la requête appliquée, sa page, la sélection et le
dernier résultat serveur pendant la session de navigation. Quitter Campagnes
annule la lecture en cours. Revenir dans la même session reconstruit la page
avec la requête conservée et effectue une nouvelle lecture API ; la sélection
est rétablie si son obligation appartient encore à la réponse. Les saisies de
filtres non appliquées restent locales à la page et ne remplacent pas la requête.

La façade observe les mutations administratives confirmées par le transport API,
y compris lorsque Campagnes est fermée. Elle invalide alors les données en
conservant requête et sélection : la page active recharge immédiatement ; une
page fermée attend sa prochaine ouverture. Une approbation de préparation ne
modifie donc pas optimistement la liste ; celle-ci attend la réponse actualisée
du serveur.

Un changement de compte, de session ou de rôle, ou une déconnexion, purge aussi
la requête et la sélection, même depuis une autre rubrique. Les générations de
requêtes et l’annulation empêchent une ancienne réponse de réintroduire un état
privé ou d’appliquer un ancien refus à une nouvelle session. Une erreur retire
les données précédentes ; un refus 401 efface la session et revient à la connexion.
Cet état NgRx ne fait l’objet d’aucune persistance dans le navigateur : un
rechargement complet repart de la requête initiale.

## Lecture API

`GET /api/admin/campaigns` (alias `/admin/campaigns`) exige une session
administrative et renvoie `Cache-Control: private, no-store`. Les autres méthodes
sont refusées sans mutation. Les paramètres acceptés, chacun une seule fois, sont :

| Paramètre   | Valeurs                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------- |
| `page`      | Entier positif, défaut `1`                                                                   |
| `pageSize`  | `25`, `50`, `100`, défaut `25`                                                               |
| `channel`   | `website`, `facebook`, `linkedin`                                                            |
| `target`    | `openg7`, `openg20`                                                                          |
| `state`     | État du workflow : `waiting`, `action_required`, `blocked`, `error`, `uncertain`, `complete` |
| `search`    | Commanditaire ou référence, au plus 120 caractères, sans caractères de contrôle              |
| `sort`      | `preparation`, `paid_at`, `due_at`, défaut `preparation`                                     |
| `direction` | `asc`, `desc`, défaut `desc`                                                                 |

La réponse contient `generatedAt`, `items` et `pagination`. Chaque élément expose
la prestation, sa préparation versionnée, son workflow, le contenu disponible,
la preuve qualifiée éventuelle et le lien du dossier. Une lecture cohérente
PostgreSQL applique filtres et tri avant de sélectionner la page. Les paramètres
inconnus, répétés ou invalides renvoient 400 ; une source indisponible renvoie
503 et ne se présente pas comme une liste vide.

Le tri initial revalide la préparation de tous les dossiers candidats ayant une
approbation historique, pour vérifier leur version actuelle avant pagination.
Pour les autres dossiers, seuls ceux de la page sélectionnée nécessitent cette
projection. Un filtre sur l’état du workflow examine tous les dossiers candidats.
Ces lectures sont réutilisées par dossier dans le même snapshot, sans plafond
qui masquerait des prestations ni requête navigateur par passage. Leur coût
reste proportionnel au périmètre à vérifier ; cette tranche ne livre aucun test
de charge ni garantie de temps de réponse sur un grand historique.

Le contrat typé est [admin-campaigns.ts](../../packages/funding-core/src/admin-campaigns.ts).
Aucune nouvelle migration ni configuration fournisseur n’est nécessaire à cette
projection ; les migrations existantes des engagements et de la préparation
restent requises.

## Vérifications et limites

Les tests de projection et HTTP vérifient droits, validation, ordre global,
versions de préparation et rattachement des preuves. L’intégration
[admin-campaigns.integration.mjs](../../tests/integration/admin-campaigns.integration.mjs)
exerce HTTP et PostgreSQL jetables.

La recette [admin-campaigns.spec.ts](../../tests/playwright/admin-campaigns.spec.ts)
utilise Angular et un navigateur réels avec des API synthétiques interceptées.
Elle couvre la lecture des prestations approuvées et à venir, les filtres,
les états de chargement et d’erreur, le détail, le clavier et les langues FR/EN,
ainsi que le rafraîchissement après approbation et l’invalidation après changement
de rôle hors de la page, avec un ancien refus retardé.

Le parcours [admin-campaigns-journey.spec.ts](../../tests/identity/admin-campaigns-journey.spec.ts)
relie le Web compilé à la véritable API et à PostgreSQL jetable, avec fournisseur
OIDC local signé et sans interception des réponses API. Il compare les
prestations en base, la réponse HTTP privée et leur rendu, vérifie les filtres,
la pagination, la reprise de la sélection avec relecture au retour et le refus
d’une session réellement révoquée. Les paiements confirmés et accords de départ
sont synthétiques ; ce parcours ne constitue pas une recette Stripe ou d’envoi
fournisseur et ne qualifie pas la production.

Le registre administratif conserve 18 garanties : A02 rattache cette lecture
privée et sa révocation au scénario réel ; A17 conserve l’inventaire de la route.
