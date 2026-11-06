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
Le commanditaire transmet ses informations par l’action
« Soumettre mes informations à l’équipe »; l’atelier ne le fait pas à sa place.

Le comptoir projette la décision courante de la prestation : une préparation
approuvée rejoint À livrer, tandis qu’une correction ou un refus de son contenu
la remet À préparer. Une modification du contenu invalide sa décision courante
et conserve son historique. Le compteur Livrées reste fondé sur la preuve
qualifiée du système responsable de l’exécution.

## D. Fidélité à la maquette

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

Complément du 5 novembre 2026 : les 43 scénarios de l’atelier et de sa continuité
passent, dont les deux nouvelles recettes FR/EN de guidage d’approbation. Elles
couvrent les raisons métier détaillées, leur ouverture au clavier, le lien
« Compléter le dossier » vers « Fiche et médias », le conseil de transmission et
l’absence de mutation. Les gardes de rôle, reprise, saisie non enregistrée, version
obsolète et résultat incertain conservent leur effet. Les 49 scénarios voisins
passent également. Build Angular production avec 25 routes prérendues,
compilation typée UI, ESLint ciblé, format et contrôles documentaires réussis.
Les captures synthétiques finales restent sous
`test-results/preflight-approval-guidance-final`.

La suite `tests/playwright/admin-preflight-examination-ui.spec.ts` utilise des
fixtures synthétiques typées du contrat réel. Elle couvre la navigation exacte,
le retour et le rechargement, les formats d’aperçu, FR/EN, mobile/tablette/bureau,
le clavier, Axe, les décisions et leur justification, le lecteur, les blocages,
les conflits de version et les erreurs de lecture. Les interceptions de navigateur
ne remplacent pas les tests du serveur et de ses droits.

Appliquer la [matrice de validation](../development/validation.md). Vérification
locale du 4 novembre 2026 sur cette révision :

- Compilation typée de la suite UI administrative, ESLint des deux suites
  concernées, format ciblé, documentation et liens réussis.
- Build Angular de production réussi avant les essais navigateur.
- Suite complète finale `yarn test` : 7 615 réussites, aucun échec et 8 tests
  ignorés. `yarn lint` réussit avec un avertissement préexistant de directive
  inutilisée dans `scripts/smoke-public.mjs`; aucun fichier étranger n’est reformatté.
- Dernier build de l’atelier : 24 scénarios réussis en 31 secondes, y compris
  FR/EN sur trois largeurs, Axe, activation répétée, réponses tardives et refus
  local des identifiants incomplets ou malformés sans lecture ni décision API.
  Les 11 scénarios du comptoir ont également réussi. Les captures privées finales
  restent dans `test-results/preflight-examination-visual-final`.
- Un premier passage avait rencontré un timeout de fermeture du contexte Chromium
  sous Windows dans le scénario médias, sans échec d’assertion. Son rejeu immédiat
  sans modification, puis les 24 scénarios du dernier build, réussissent.
- Régressions : 28 scénarios Preflight recette/boîte/preuves et 40 scénarios de
  l’annuaire public, sur Chromium et Chrome mobile, réussis. Le composant public
  partagé conserve les crédits, les filtres de diffusion et les états d’erreur.
- Les 103 scénarios UI uniques concernés sont ainsi validés. Ils restent distincts
  des contrôles serveur : 22 tests Node préparation/campagnes/comptoir et 8 tests
  d’intégration préparation de prestation/dossier passent sur PostgreSQL jetable.
  Ceux-ci couvrent notamment la concurrence, l’idempotence, les droits, le retrait
  de consentement et l’isolation des canaux. Aucun essai ne qualifie une publication
  externe ou un environnement de production.

La mise à jour localhost a été vérifiée séparément : sauvegarde PostgreSQL privée
validée avant les migrations additives 062 à 064, registre réconcilié sans migration
en attente et compteurs métier inchangés. Ces migrations ajoutent des reçus; elles
ne créent ni demande d’information, ni dépense, ni décision. API et Web ont été
reconstruits sous Node 22.23.3 avec la même empreinte de sources, puis recréés avec
les overlays existants. Les neuf autres conteneurs, les volumes, l’identité, TLS
et le proxy Angular sont conservés. La page HTTPS et l’API répondent, et la nouvelle
route refuse une lecture sans session avec HTTP 401.

Une lecture compilée avec PostgreSQL en mode lecture seule retrouve les deux
obligations locales exactes, leurs versions et leurs blocages réels. Elles restent
à préparer, sans contenu importé ni décision inventée. Le journal 064 est vide
avant et après ces contrôles. Les reçus privés de sauvegarde et d’exploitation
restent sous `var/preflight-examination/`, ignorés par Git.

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
