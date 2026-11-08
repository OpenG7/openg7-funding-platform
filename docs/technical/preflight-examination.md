# Atelier d’examen des prestations

L’atelier prolonge [Mon comptoir](preflight-workspace.md) sur la route
`/admin/fundraiser/preflight`. Il présente le contenu privé d’une prestation,
ses contrôles, ses médias et les décisions humaines sans déclencher sa livraison.
Funding conserve l’autorité métier. La boîte de propositions Preflight distante
reste distincte tant que leur rattachement n’a pas été vérifié.

## A. Audit et réutilisation

Les campagnes possèdent déjà les obligations exactes, les brouillons privés et
les preuves qualifiées. La préparation du dossier possède ses contrôles et son
approbation versionnée. Cette approbation porte sur un dossier entier; elle ne
doit pas être présentée comme une décision limitée à la carte sélectionnée.

Le nouvel atelier réutilise ces projections, la médiathèque administrative et
les parcours d’édition et de livraison propriétaires. La confirmation des actions
réutilise `AdminConfirmationService`. Le Comptoir de démonstration et les
interfaces de publication existantes conservent leurs responsabilités.

## B. Architecture et contrat

Le contrat typé `AdminServicePreparationReceipt`, dans
`packages/funding-core/src/admin-service-preparation.ts`, identifie la contribution,
l’obligation, le brouillon et leur version. Il expose les prestations voisines,
les contrôles, les conditions bloquantes, les droits de décision et l’historique.
La migration `064_service_preparation_decisions.sql` et les grants du rôle API
sont requis avant cette version; suivre le [runbook des migrations](../operations/database-migrations.md).

- `GET /api/admin/sponsorships/preparation/service?sponsorshipId=…&obligationId=…`
  lit la préparation de la prestation exacte. Une paire incohérente ou absente
  ne sélectionne jamais une autre obligation.
- `POST /api/admin/sponsorships/preparation/service/decision` reçoit
  `contributionId`, `obligationId`, `expectedVersion`, `requestId`,
  `confirmed: true`, `decision` et une justification lorsque nécessaire.
  La décision vaut `approved`, `correction_requested` ou `rejected`.

Les droits sont contrôlés par l’API. La version de lecture inclut l’identité
de la dernière décision afin de détecter les décisions concurrentes. La décision
conserve l’acteur, le brouillon, sa version, la version du contenu, sa justification,
une référence d’audit et l’identifiant de requête. Le serveur réutilise un résultat
connu plutôt que créer une seconde décision pour un même identifiant.

La version de prestation couvre ses faits communs déterminants — paiement,
accord, consentement, identité et revue — puis l’obligation, le brouillon et les
contrôles de médias/modération de son canal et de sa destination exacts. Elle
ne reprend pas aveuglément le hash ni tous les blocages du dossier entier.
Modifier un brouillon LinkedIn n’invalide pas une décision Facebook distincte;
un manque propre à LinkedIn ne bloque pas une préparation Web complète.

La préparation demeure distincte de l’autorisation de publier, de l’exécution et
de la preuve. Refuser son contenu ou demander une correction n’annule pas
l’obligation contractuelle. Approuver ne crée aucune preuve de livraison.

## C. Implémentation et navigation

Les paramètres `sponsorshipId`, `obligationId` et `preparationVersion` ouvrent
l’atelier depuis Mon comptoir. Les filtres `deskStatus`, `deskSearch` et `deskPage`
restent dans l’URL. Le rechargement retrouve la prestation exacte; précédent et
suivant suivent les prestations du même dossier. Retour ferme l’atelier en
conservant les filtres et retrouve la carte concernée lorsqu’elle est visible.

La lecture du reçu ciblé est indépendante de la pagination et du filtre du
comptoir. La prestation reste consultable si une décision modifie sa catégorie.
Les réponses tardives d’une autre sélection ou session sont ignorées. Les faits
serveur sont relus après décision; une panne réseau ne devient jamais un refus
métier ni un succès confirmé.

Une approbation désactivée explique son blocage directement dans la zone de
décision, avec un texte associé au bouton. L’explication distingue préparation
incomplète, rôle de consultation, session personnelle à reprendre, brouillon non
enregistré, version obsolète, opération en cours et résultat incertain. Les actions
proposées réutilisent la reprise, la sauvegarde et les lectures existantes, ou
ouvrent le dossier propriétaire; elles ne contournent aucun contrôle d’approbation.

Le filtre `deskStatus=to_prepare` ne désactive pas lui-même le bouton. Un formulaire
de commanditaire enregistré pour plus tard peut contenir un nom sans avoir encore
transmis de profil à Funding. Son contenu privé n’est pas assimilé à une
transmission, à un consentement, à une revue ni à un brouillon de publication prêt.
Le lien de dossier conserve la sélection. L’espace Identité possède les
coordonnées et la transmission; la [galerie de préparation](intelligent-media-gallery.md)
possède les médias et leurs associations privées aux prestations. L’accès au
suivi reste dans la barre d’outils globale. Examiner consulte ces mêmes références
versionnées et rejoint la galerie pour les modifier, sans seconde bibliothèque.
L’onglet « Médias du dossier » affiche tous les fichiers du dossier en consultation,
même lorsqu’aucun n’est affecté à la prestation. Recherche et pagination portent
sur cette même bibliothèque; des repères distinguent les affectations courantes
et obsolètes. L’aperçu du rendu conserve sa sélection propre et ses contrôles de
version, de revue et de droits. Consulter un fichier dans cet onglet ne l’ajoute
pas au rendu et ne crée aucune affectation.
Le commanditaire transmet ses informations par l’action
« Soumettre mes informations à l’équipe »; l’atelier ne le fait pas à sa place.

Le comptoir projette la décision courante de la prestation : une préparation
approuvée rejoint À livrer, tandis qu’une correction ou un refus de son contenu
la remet À préparer. Une modification du contenu invalide sa décision courante
et conserve son historique. Le compteur Livrées reste fondé sur la preuve
qualifiée du système responsable de l’exécution.

## D. Fidélité à la maquette

### Compléter les prérequis

Le parcours guidé présente les contrôles serveur confirmés et ceux à compléter,
avec une action par responsabilité. Paiement et accord rejoignent leurs sections
du même dossier. Les revues du commanditaire et du dossier partagent le contrôle
natif de revue dans **Aperçu**. Identité, présentation et médias rejoignent leurs
espaces propriétaires, sans changer de commanditaire.

Le consentement ouvre le formulaire d’[accord public documenté](sponsorship-public-consent.md).
L’accord reçu, sa preuve, sa date et une confirmation sont nécessaires; son
enregistrement ne rend pas les autres contrôles valides. Le texte d’une
publication existante peut être examiné dans un panneau qui réutilise la
modération native, sur le brouillon exact et sa version. Une proposition absente
se prépare dans son parcours propriétaire avant de pouvoir être examinée.

Changer de dossier, de brouillon, de version ou de session ferme le contexte
de décision concerné. Après enregistrement, l’atelier relit les faits du serveur.
L’approbation finale de préparation conserve toutes ses gardes et sa confirmation;
elle n’est jamais déclenchée par la résolution d’un prérequis.

L’atelier suit les palettes administratives Clair (`mineral`), Nuit et Graphite.
Textes, panneaux, champs, états, boutons et focus utilisent des couples de
couleurs cohérents avec le thème sélectionné. L’aperçu public conserve sa palette
blanche et marine dans une surface isolée.
La validation couvre les trois palettes sur mobile et bureau : ratios texte/fond
rendus, bordures de champ et focus, états sans proposition, décisions et erreurs.
Les parcours UI vérifient aussi les contrastes du formulaire de consentement.

La composition conserve le cadre Funding, l’en-tête de prestation, le bandeau de
synthèse, la navigation latérale, le grand aperçu, les contrôles et la zone de
décision. Les vues Aperçu, Texte, Médias, Vérifications, Détails et Historique
partagent l’espace central. Les formats bureau, tablette et mobile changent la
largeur réelle de l’aperçu; l’agrandissement dispose d’une fermeture au clavier.

Les trois colonnes deviennent un parcours vertical lorsque l’espace manque.
Les libellés FR/EN, les focus visibles, les états textuels et les noms accessibles
complètent les couleurs. Les noms, nombres et images fictifs de la maquette ne
remplacent jamais les données absentes.

## E. Capacités opérationnelles et limites

L’atelier examine les préparations Funding réellement disponibles. Leur origine
est explicitement Funding et le lien avec une proposition Preflight demeure
`unverified`. Les scénarios de passerelle restent identifiés comme simulations
IA dans leur espace de recette; ils ne prouvent pas un import de contenu réel.

Le rendu Web utilise la présentation publique réutilisable et les médias admis
pour cette destination. Les fichiers privés sont chargés avec l’authentification
administrative; une URL interne n’est pas recopiée dans un contenu public.
Les aperçus sociaux sont indicatifs et ne qualifient pas le rendu d’un fournisseur.
L’édition et la sélection de médias suivent les mécanismes existants.

Une demande de correction est enregistrée avec justification et historique.
Elle n’annonce pas un renvoi automatique vers Preflight. Aucun bouton ne simule
une régénération IA, une analyse de médias ou une publication distante absente.
Un contrôle absent ou non requis n’est pas compté comme une vérification réussie.

## F. Validation

La suite `tests/playwright/admin-preflight-examination-ui.spec.ts` utilise des
fixtures synthétiques typées des contrats publics. Elle couvre la navigation
exacte, le retour et le rechargement, FR/EN, mobile/tablette/bureau, le clavier,
Axe, les trois thèmes, les décisions, le lecteur et les erreurs de lecture.
Les contrôles de contraste mesurent les couleurs réellement rendues, y compris
dans le formulaire de consentement Graphite.

Les parcours de consentement vérifient la preuve et la date obligatoires,
l’absence de POST avant confirmation, la commande unique, la relecture du reçu
et de la préparation, les conflits, les réponses incertaines et la purge des
réponses privées tardives. Résoudre ce contrôle ne valide pas les autres.
Les liens propriétaires conservent leurs paramètres et fragments, y compris
lors d’une ouverture native. La revue du texte cible le brouillon de publication
exact et réutilise la modération N0.

Les unités du contrôleur vérifient aussi l’acteur du reçu, la reprise avec le
même identifiant et l’absence de preuve dans le stockage navigateur.
Les tests de modération couvrent les refus d’accès du dialogue et de sa commande,
la purge du contexte et les sessions OIDC remplacées sans jeton local.

Les tests PostgreSQL du [consentement documenté](sponsorship-public-consent.md)
complètent ces interceptions navigateur : migration additive, préservation des
empreintes historiques, audit atomique, CAS concurrent, idempotence, droits,
registre immuable, maintien privé et invalidation des anciennes autorisations.
Les suites de préparation par prestation et d’affectation des médias restent
des régressions distinctes.

Appliquer la [matrice de validation](../development/validation.md) : compilation
TypeScript et UI, build Angular production, unités, PostgreSQL jetable,
parcours navigateur, lint ciblé, format, documentation et `git diff --check`.
Ces essais n’enregistrent aucun consentement réel et ne qualifient aucune
publication externe. L’[activation locale](../operations/documented-consent-activation.md)
est un contrôle séparé des tests sur fixtures.

## G. Mutualisation

L’ancien panneau inline du comptoir cède sa place à l’atelier ciblé. Le reçu de
préparation du dossier, les campagnes, la médiathèque, les éditions et les parcours
de publication restent utilisés dans leurs autres écrans. Aucun second moteur
de publication, stockage média ou modèle de commande n’est créé.

## H. Évolutions restantes

La continuité du travail, sa sauvegarde et sa reprise sont décrites dans le
[contrat des sessions d’examen](preflight-work-sessions.md). Ces sessions
personnelles réutilisent les décisions et brouillons propriétaires ci-dessus.

L’adoption d’une proposition distante exige un rattachement persistant et vérifié
à la contribution, à l’engagement versionné, aux obligations et aux brouillons.
Les droits et consentements média doivent être vérifiés pour chaque destination.
La correction automatisée et la régénération demandent un contrat Preflight réel,
versionné et soumis à un nouvel examen. Ces limites ne désactivent pas l’examen
des préparations Funding existantes.
