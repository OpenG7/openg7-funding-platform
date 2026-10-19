# Campagnes et prestations promises

La rubrique `/admin/fundraiser/campaigns`, accessible depuis le menu administratif,
regroupe les prestations enregistrées pour les achats de commandite confirmés.
Elle sert à suivre le travail prévu et réalisé ; sa consultation n’envoie aucune
publication et ne confirme aucun paiement.

<a id="vocabulaire-des-operations"></a>

## Vocabulaire des opérations

Ces termes sont communs au Guide, aux dossiers de commandite et à Campagnes.
Le menu **Campagnes** ouvre **Suivi des prestations promises** ; il ne désigne
pas un regroupement éditorial ayant son propre objectif ou sa propre période.
Les clés de traduction, identifiants et états des contrats techniques restent
stables ; les libellés précisent leur sens dans l'interface.

<!-- prettier-ignore -->
| Terme d'interface | Responsabilité |
| --- | --- |
| Commanditaire | Organisation qui soutient le fonds. |
| Dossier de commandite | Achat identifié et ses faits, coordonnées, décisions et prestations ; une organisation peut avoir plusieurs dossiers. |
| Accord de commandite | Conditions commerciales acceptées lors de l'achat ou établies par qualification historique documentée. |
| Prestation promise | Unité de travail issue de cet accord ; `obligation` reste le nom du contrat technique. Plusieurs publications promises donnent plusieurs unités suivies. |
| Publication 2 sur 3 | Occurrence d'une prestation de publication ; distincte de la vérification d'un lot de dossiers. |
| Fiche de préparation | Contrôles et contenu versionnés du dossier, avec leur état de préparation. |
| Reçu d'opération | Résultat serveur d'une demande identifiée, notamment une décision sur des médias ; permet d'en vérifier l'issue sans répéter la mutation. Ce n'est pas la fiche de préparation. |
| Approbation de la préparation | Décision sur la version courante de la préparation du dossier entier ; son historique est l'**Historique des approbations**. |
| Autorisation de publication | Décision distincte portant sur le contenu exact, la destination, le mode et la programmation. |
| Livraison confirmée | Réalisation étayée par une preuve qualifiée pour la prestation exacte. |
| Dispense | Décision tracée qui termine le suivi d'une prestation sans déclarer de livraison. |
| Preuve de l'accord / preuve de livraison | Justificatif des conditions promises / justificatif de leur réalisation ; une preuve de livraison est rattachée à la prestation, pas un livrable autonome dans ce modèle. |
| Vérification du lot | Traitement d'un ensemble de dossiers ; **Préparer ce dossier** annonce l'entrée dans la préparation ciblée. |
| Flux de publication | Destination configurée du moteur social, avec compte, canal, cible et cadence ; `feed` reste le terme technique et apparaît encore dans certains libellés. |
| Statut social déclaré | Suivi historique renseigné dans le dossier, notamment `feedStatus` ; ne décrit ni la visibilité Web effective ni une livraison confirmée du moteur. |
| Suivi social déclaré | Zone regroupant le statut social déclaré et ses références ou notes historiques ; distincte de la fiche publique Web et du suivi des livraisons du moteur. |

Les noms suivants désignent les responsabilités des outils transversaux dans la
documentation. Certains sont descriptifs : **Guide administratif** précise le
Guide commun, et **Aide pas à pas du dossier** précise le volet local affiché
**Aide pas à pas**. Cette nomenclature n'annonce pas un renommage complet de
l'interface. Les citations de libellés existants, les noms de composants et les
identifiants techniques restent explicites lorsqu'ils diffèrent.

<a id="outils-transversaux"></a>

<!-- prettier-ignore -->
| Outil transversal | Responsabilité et limite |
| --- | --- |
| Cadre administratif commun | Enveloppe commune de navigation, recherche, session et outils ; les pages fournissent leur contexte métier. |
| Recherche globale | Retrouver une entité administrative ou une pièce et rejoindre son aperçu ou sa page. |
| Guide administratif | Carte commune d'orientation et ses modes ; distincte de l'aide du dossier et du dialogue de découverte du pilotage. |
| Aide pas à pas du dossier | Explications repliables propres au dossier ouvert ; une étape pédagogique ne réalise aucune décision. |
| Assistant contextuel | Synthèse, recommandations et propositions liées au dossier ; tout envoi conserve son parcours de confirmation. |
| Revue assistée de l'accord | Source privée, extraction et revue des clauses avant qualification humaine de l'accord de commandite ; distincte de l'Assistant contextuel et de ses propositions générales. |
| Fiche de préparation | Rendu commun des contrôles et de leur approbation ; `AdminPreparationReceipt` est son nom de composant, pas un reçu d'opération. |
| Navigation de préparation | Rejoindre le formulaire propriétaire d'un blocage et conserver un retour borné. |
| Prochaine étape du dossier | Présenter le prochain point d'action à partir des faits du dossier ; ne pas le confondre avec un paiement suivi séparément dans le Guide. |
| Revue des médias | Galerie, droits d'utilisation, analyse et décisions sur les fichiers ; `MediaReviewWorkspace` reste le nom technique. L'acceptation d'un média n'autorise pas une publication. |
| Éditeur des droits d'utilisation | Définir les droits prouvés, restrictions et crédits, avec leur périmètre et leur couverture ; distinct de l'acceptation éditoriale du média. |
| Inspecteur transversal | Consultation contextuelle d'une pièce ou d'une trace ; distincte de la décision métier. |
| Tiroir commun | Enveloppe d'ouverture, fermeture et focus des panneaux ; ne porte pas leurs droits ou décisions métier. |
| Contrôleur d'actions contextuelles | Présenter les commandes du sujet courant et leur portée ; chaque commande conserve son propriétaire et ses confirmations. |
| Confirmation d'action | Présenter la cible et recueillir une confirmation ; les droits et préconditions restent dans la commande propriétaire. |
| Modération éditoriale | Décision versionnée sur une commandite, un média ou une livraison ; ces cibles conservent leurs décisions distinctes. |
| Tiroir de livraison sociale | Revue du contenu exact et actions sur une livraison, y compris avant son envoi ; **Publication finale** est son titre actuel. Seule une preuve qualifiée établit une livraison confirmée. |
| File de courriels | Suivre les messages réels et leur issue dans le parcours existant ; une mise en file ne prouve pas la réception. |
| Factures et avoirs | Consulter les pièces d'une contribution dans la rubrique **Factures** ; ouvrir une pièce n'en émet pas une nouvelle. |
| À traiter | Identifier et examiner un incident administratif avec son type et sa cible ; distinct du registre des dossiers. |
| Suivi des prestations promises | Parcours de la rubrique **Campagnes** ; sélectionner une prestation ne limite pas à celle-ci l'approbation de préparation du dossier. |
| Qualité des commandites | Consultations de portefeuille réservées au propriétaire : inventaire d'adoption et audit historique ; chaque chargement reste explicite. |

**Accord de commandite** reste réservé aux conditions commerciales. Les décisions
sur la préparation sont des **approbations** ; les décisions permettant l'envoi
social sont des **autorisations de publication**. Le bouton actuel **Accepter et
programmer** relève de cette dernière responsabilité et peut aussi approuver les
commanditaires en attente selon le parcours combiné. Ni les droits d'utilisation
d'un média, ni la sélection de ce média pour le site ne remplacent cette autorisation.

Les libellés hérités encore affichés **Visibilite / statut feed**, **Commanditaire et feeds** ou
**Pilotage des feeds** sont des citations de l'interface, pas des synonymes à
employer indistinctement : le premier filtre le statut social déclaré ; le
moteur configure et traite les flux de publication. La fiche publique Web garde
sa décision de visibilité séparée.

Le filtre **État du suivi** conserve l'état API `complete`. Son option
**Terminée — livrée ou dispensée** inclut les deux situations ; chaque ligne
distingue **Livrée** et **Dispensée**. L'approbation affichée sur une ligne reste
explicitement celle de la préparation du dossier. Une prestation enregistrée
peut attendre sa préparation ou l'autorisation de sa publication.

Dans l'onglet Publication du dossier, **Prestations promises** conserve la
référence contractuelle pour qualifier et ajuster l'accord de commandite. Un
résumé générique des avantages reste affiché ; il ne remplace ni cet accord ni
une preuve de livraison. La synthèse du workflow rejoint Campagnes pour le
détail des prestations et de leurs preuves.

## Liste et préparation

Une ligne représente une obligation de l’offre acceptée, identifiée par dossier,
canal, destination et numéro de publication. Plusieurs publications promises donnent
plusieurs lignes, même sans brouillon. La quantité vient de l’accord enregistré,
jamais du barème actuel. Les accords historiques non qualifiés restent à traiter
dans leur écran propriétaire avant de fournir des prestations à cette liste.

Les prestations à venir restent visibles lorsque le dossier est incomplet ou que
la préparation attend son approbation. Le tri initial place en premier les
préparations explicitement approuvées dans leur version actuelle. L’approbation
est réévaluée côté serveur à partir de la dernière approbation et des faits actuels ; une
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
Les preuves restent liées à leur canal, destination et occurrence ; la visibilité
actuelle demeure une information distincte de la livraison attestée.

<a id="entree-contextuelle-et-details-de-laccord"></a>

## Entrée contextuelle et détails de l'accord

Le volet **Détails de l'accord de commandite et traçabilité** de la fiche partagée est réservé à
Campagnes (`detailsMode="inline"`). Il reste replié et conserve les clauses de
l'offre, la date de paiement, les états de brouillons, le bilan et la version
complète du dossier. Commandites masque ce volet et sa commande (`hidden`). Le
Guide remplace cette commande par **Voir les prestations dans Campagnes**
(`campaigns`). La qualification de l'accord d'origine dans Commandites, la
relecture du contenu, l'approbation et son historique restent disponibles.

Le Guide ouvre `/admin/fundraiser/campaigns?sponsorshipId=<uuid>` avec le dossier
de la fiche courante. La page reprend la prestation déjà sélectionnée de ce même
dossier en mémoire. À défaut, elle sélectionne l'unique résultat ou demande de
choisir parmi plusieurs. Un dossier sans prestation fournit un état vide
explicite ; aucune prestation n'est choisie arbitrairement ni créée depuis le barème.
Une origine connaissant la prestation exacte peut ajouter `obligationId=<uuid>` ;
ce paramètre exige toujours `sponsorshipId` et ne peut élargir son périmètre.

Les identifiants ciblent la requête API avant tri et pagination, indépendamment
de l'ancienne page ou des filtres mémorisés. Une cible absente ou appartenant à
un autre dossier renvoie zéro ligne. Des identifiants malformés, répétés ou une
obligation sans dossier produisent un état d'entrée invalide, sans repli vers
tous les dossiers. Un repère annonce le périmètre ciblé ; l'action de retour à
toutes les campagnes retire explicitement ces identifiants et réinitialise la
requête ciblée. Ce contexte n'accorde aucun droit supplémentaire.

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
rechargement complet sans identifiants de contexte dans l'URL repart de la
requête initiale. Un lien ciblé réapplique son dossier après changement de
session, avec les filtres et la sélection précédents purgés.

## Lecture API

`GET /api/admin/campaigns` (alias `/admin/campaigns`) exige une session
administrative et renvoie `Cache-Control: private, no-store`. Les autres méthodes
sont refusées sans mutation. Les paramètres acceptés, chacun une seule fois, sont :

| Paramètre       | Valeurs                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `page`          | Entier positif, défaut `1`                                                                   |
| `pageSize`      | `25`, `50`, `100`, défaut `25`                                                               |
| `sponsorshipId` | UUID exact du dossier ; limite le périmètre avant pagination                                 |
| `obligationId`  | UUID exact de la prestation ; exige `sponsorshipId` et reste limité à ce dossier             |
| `channel`       | `website`, `facebook`, `linkedin`                                                            |
| `target`        | `openg7`, `openg20`                                                                          |
| `state`         | État du workflow : `waiting`, `action_required`, `blocked`, `error`, `uncertain`, `complete` |
| `search`        | Commanditaire ou référence, au plus 120 caractères, sans caractères de contrôle              |
| `sort`          | `preparation`, `paid_at`, `due_at`, défaut `preparation`                                     |
| `direction`     | `asc`, `desc`, défaut `desc`                                                                 |

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
