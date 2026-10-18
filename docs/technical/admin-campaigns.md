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
les états de chargement et d’erreur, le détail, le clavier et les langues FR/EN.
Elle n’atteste aucun envoi fournisseur ni accès à la production. Le registre
administratif conserve 18 garanties ; le rattachement de cette route à A17
documente son inventaire et ne constitue pas une preuve E2E métier réelle.
