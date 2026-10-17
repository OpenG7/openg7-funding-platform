# Poste de pilotage administratif

Route : `/admin/fundraiser/pilotage`, accessible depuis la navigation admin.
La page utilise le cadre commun de l'administration : menu latéral, recherche,
langue et menu repliable sur mobile. Les espaces de pilotage sont des filtres
dans le contenu, sous le titre; ils changent la file sans quitter la page.
Une décision centrale, la file « À suivre » et les commandes contextuelles conservent
le parcours spécialisé. Les raccourcis du pilotage sont neutralisés lorsque
le focus est dans la navigation globale ou la recherche; le retour aux décisions
exige de relâcher la manette.

Un rappel de créneau, lot ou brouillon sans livraison renvoie à son dossier ;
il ne propose pas une décision de modération pour `publication_delivery`.
Une livraison réelle conserve son panneau lié à son identifiant exact.

La carte d'état du traitement automatique est un lien **Ouvrir les réglages**
vers `/admin/fundraiser/publications/automation?settings=feeds`, avec la section
des connexions et cadences dépliée. Ce raccourci ne change aucun réglage.
Le propriétaire peut activer ou arrêter le moteur sur cette page avec le bouton
On / Off; les réglages des destinations restent distincts. Voir le
[runbook de publication](publication-automation.md) pour les conditions d'activation.

La vue d’ensemble affiche les décisions à examiner dans l’espace sélectionné,
les décisions traitées et les ouvertures de dossiers pendant la visite. Ces deux
derniers compteurs sont locaux et repartent à zéro au rechargement; ils ne sont
pas un historique d’activité. Les espaces disposent de repères colorés et nommés.
Les transitions et animations respectent la préférence de mouvement réduit.

**Ma semaine** ajoute briefing, session de cinq minutes, calendrier proposé,
répétition générale, variantes de texte, préférences éditoriales et solutions
aux incidents. Les contrats, la migration 025 et les limites sont décrits dans
le [runbook éditorial](editorial-programme.md).

## Apparence et concentration

**Apparence** propose OpenG7 Premium Light (perle, bleu marine et or, par défaut), Nuit OpenG7
et Graphite, ainsi que les densités Confort et Compact. Les choix enregistrés sont
conservés. La palette couvre le cadre de navigation et le
contenu de toutes les pages utilisant le layout admin partagé. Elle est conservée
après un changement de page ou un rechargement. La densité reste propre au pilotage.
**Suivre le thème du système** alterne entre Premium Light et Nuit OpenG7 selon
la préférence de l'appareil, y compris lorsqu'elle change hors du pilotage.

L'identifiant clair enregistré `mineral` est conservé. Les fondations et les
primitives sont décrites dans le [design system](../development/css-frameworks.md#openg7-premium-light--design-system-v1).

Ces préférences sont locales au navigateur (`openg7.pilotage.appearance.v1`),
communes aux comptes sur cet appareil et synchronisées entre ses onglets,
même hors du pilotage.
Elles ne contiennent aucun dossier ni secret. Un script chargé avant Angular
applique la palette enregistrée avant le rendu de la page. Un stockage bloqué
est signalé dans le panneau; le choix reste utilisable pendant la visite.

**Concentration** masque navigation globale, indicateurs et outils secondaires
pour agrandir le dossier. **Afficher la file** rétablit les décisions suivantes;
**Quitter la concentration** reste accessible pendant le défilement.
L'entrée et la sortie conservent la sélection. Les changements d'apparence,
y compris système, ne rechargent pas les dossiers et préservent les saisies.
La concentration revient au mode normal après rechargement.

Le controller reste propre au Pilotage. Le layout réserve une palette à droite
dès 1440 pixels CSS et 700 pixels de hauteur, reliée au bandeau inférieur par une
coque décorative CSS continue. La grille réserve les deux zones, sans recouvrir
le dossier; le bandeau passe aussi sous la navigation latérale. Les dimensions
sont de 12rem et 5rem, puis 15rem et 5,5rem dès 1760 × 800 pixels CSS.
La palette est rétractable; son bouton conserve le focus et son ouverture
ne déclenche aucune commande. Le bandeau reste utilisable pendant la rétraction.
Le guide flottant réserve la largeur de la palette et la hauteur du bandeau.

Entre 1280 × 650 et le format complet, le bandeau mesure 4rem et les décisions
reprennent leur disposition classique sous le dossier. Sous ces seuils, ou avec
le simulateur ouvert, le bandeau disparaît et les actions classiques restent
accessibles même après une rétraction. Sur mobile, la coque est absente.
1920 × 1080 à 125 % correspond généralement à environ 1536 × 864 pixels CSS,
avec une hauteur utile réduite par le navigateur : mesurer le viewport effectif.

Le radial expose les quatre intentions existantes : accepter, refuser, modifier,
détails. Le bandeau propose accueil, décision précédente/suivante, dossier complet,
file et diagnostic manette. Aucun historique ou gestionnaire de documents
universel n'est simulé. Les vrais boutons conservent la préparation automatique,
les profils Gamepad réaffectés et les confirmations métier; aucun raccourci de
remboursement ou d'envoi de courriel n'est ajouté au catalogue du Pilotage.
Les raccourcis configurés restent affichés sans manette; l'état matériel reste
indiqué séparément. Menu/View/Y gardent leurs fonctions existantes.

Tab parcourt les contrôles HTML dans l'ordre du document. Les flèches parcourent
verticalement le radial et horizontalement le bandeau; Droite depuis le radial
rejoint le bandeau, Haut depuis le bandeau revient au radial. Bas depuis le dernier
contrôle radial rejoint aussi le bandeau. À la manette, A active le contrôle
focalisé et B depuis le bandeau revient au radial sans préparer de refus.
LB/RB changent de décision hors dialogue. Un changement de zone ou de cible
impose le retour au neutre. Les panneaux ouverts conservent leur priorité.
Les intentions différées sont revérifiées contre la cible et sa version;
accueil et diagnostic gardent un contexte de workspace même lorsque la file est vide.
Le stick droit fait défiler l'espace de travail ou le panneau ouvert.
La coque et ses raccords restent décoratifs, sans Canvas, WebGL, flou de fond ni
animation permanente; les contrôles natifs partagent le même composant générique.
Le texte d'une décision reste entier dans cet espace, sans défilement imbriqué.
Apparence garde la priorité du panneau et impose le retour au neutre après
chaque choix; aucune préférence ne déclenche une commande métier.

## Guides interactifs

### Mode guidé dans l'administration

Le bouton **Mode guidé**, sous la barre commune, accompagne les 18 rubriques
administratives authentifiées. **Découvrir les rubriques** affiche **Vous êtes ici**,
une seule étape de lecture et **Me montrer dans la page** pour déplacer le focus vers le repère
correspondant. Chaque zone visible correspondant à ce repère reçoit un contour
et un halo dorés. Trois pulsations douces accompagnent le clic, puis l'or reste
fixe jusqu'au changement d'étape, à la pause ou à la fermeture. La préférence
de réduction des mouvements supprime la pulsation, même modifiée en cours de
lecture. Les styles initiaux reviennent au retrait du repère ; aucun contrôle
métier n'est activé. Le défilement tient compte des conteneurs imbriqués, de la
barre de commandes du pilotage et de son introduction fixe en Concentration.
Il expose la zone entière si elle tient dans l'espace disponible ; sinon,
son début et son titre restent visibles. Ouvert, le guide flotte dans une carte ombrée.
**Placer en haut / Placer en bas** déplace la carte pour dégager la lecture ;
les panneaux de confirmation conservent leur priorité. Une brève animation
d'entrée respecte la préférence de réduction des mouvements et ne se répète
pas pendant la lecture. Les étapes suivantes restent volontaires. Ce repère
reste accessible dans le mode Concentration du pilotage. Sur un écran étroit,
réduire temporairement la carte dégage les contrôles recouverts ; la rouvrir
retrouve la même étape.

Dans ce guide de découverte, **Faire une pause** garde la rubrique et l'étape.
**Reprendre mon repère** revient
à cette rubrique, sans paramètres de recherche ou identifiants de dossier.
**Continuer ici** permet de repartir dans une autre rubrique. Réduire le guide
conserve le repère ; **Effacer mon repère**, dans les informations de mémorisation,
le retire. Le guide ne confirme aucune opération ; le résultat d'une action se
vérifie dans son écran habituel.

**Parcours du paiement** suit le travail restant sur un paiement précis. Depuis
**Contributions**, **Suivre ce paiement** ouvre ce mode dans la carte flottante.
Un dossier ouvert propose aussi de le suivre. Changer de rubrique ou ouvrir un
autre dossier ne remplace pas le paiement suivi ; ce remplacement est volontaire.
La carte présente une seule prochaine action, son motif et, à la demande,
l'ensemble des étapes. **Ouvrir la prochaine étape** relit les faits du serveur
avant de rejoindre l'écran habituel. Si la recommandation a changé, la carte
présente la nouvelle situation et laisse décider à nouveau. Aucune opération
métier n'est réalisée par cette navigation.

`GET /api/admin/payment-journey?contributionId=<uuid>` (alias `/admin`) exige
la session administrative et un UUID explicite unique ; les autres paramètres
sont refusés. La réponse privée `no-store` contient `status` (`ok`, `not_found`,
`unavailable`), `generatedAt` et `journey`. Ce dernier est nul si la lecture
ne peut pas aboutir ; sinon il expose les jalons, leur compte et `next`.
Son état est `complete`, `action_required`, `waiting` ou `blocked` ; `next` est
nul seulement si toutes les étapes requises sont réglées. Les faits sont lus
dans une transaction cohérente en lecture seule. Les méthodes autres que GET
renvoient 405 et n'exécutent aucune opération.

Le parcours constitue une console de travail : les étapes de publication
précisent la responsabilité administrative ou celle de la plateforme. Une
publication autorisée programmée, en cours ou en reprise automatique prévue
reste en attente des faits serveur ; le guide permet de les actualiser sans
demander une attestation manuelle de livraison ni rouvrir sa préparation.
Une décision humaine encore nécessaire ailleurs dans le dossier reste proposée.
Le succès réel enregistre automatiquement la preuve du passage correspondant ;
un résultat incertain exige sa réconciliation avant un nouvel envoi.

Le soutien personnel ne crée aucune contrepartie de commandite : sa confirmation
et les éventuels incidents ou communications constituent son suivi. Pour une
commandite, les jalons portent sur paiement, identité, médias, revue, facturation
et publication, selon l'offre acceptée et les faits du dossier. Les remboursements,
avoirs, erreurs Stripe, échéances et incidents de publication peuvent demander
une intervention avant la clôture. Un jalon non requis compte comme réglé.
La réalisation d'une contrepartie exige la preuve qualifiée prévue par son contrat ;
un statut historique « publié », un essai simulé ou une visibilité actuelle ne
constitue pas cette preuve. Paiement, consentement, revue et publication restent
distincts. Les confirmations et droits habituels s'appliquent dans leurs écrans.

**Faire une pause** garde l'identifiant du paiement. **Reprendre ce paiement**
relit les faits et les droits avant d'afficher la suite, y compris après un
rechargement. **Vérifier les faits** permet une nouvelle lecture ; les mutations
administratives confirmées et les changements de page actualisent aussi le
parcours actif. Pendant une vérification ou après une erreur, les anciennes
étapes et une ancienne fin ne sont pas présentées comme actuelles. Le message
**Parcours à jour** vient des faits serveur ; une nouvelle information peut
rouvrir une étape.

Seuls l'activation, le mode choisi, le repère de découverte et, pour un parcours,
l'UUID du paiement et sa pause sont mémorisés dans ce navigateur, par compte OIDC,
dans la clé `og7-admin-guidance:v1:<compte>`. Aucun statut de paiement, référence,
résultat d'action, contenu de dossier, saisie ou information de santé n'est conservé.
Le mode token partage ces repères entre ses utilisateurs. Un stockage bloqué conserve le repère
en mémoire pendant la visite et affiche sa limite ; un effacement refusé est
signalé séparément. Les guides de découverte détaillés restent disponibles.

La recette UI `admin-guidance.spec.ts`, avec réponses API interceptées, vérifie navigation et reprise, comptes,
révocation, stockage indisponible ou corrompu, absence de commande métier,
FR/EN, clavier, mobile, concentration et présence dans les 18 rubriques. Elle
vérifie aussi reprise d'un paiement, erreurs, réponses tardives, remplacement
volontaire du dossier et recommandation devenue obsolète. Cette recette UI ne
prouve pas à elle seule le traitement financier ou la réalisation des engagements.
Les recettes `personal-contribution-acceptance.spec.ts` et
`sponsorship-tiers-acceptance.spec.ts` exercent Checkout, API et PostgreSQL jetables,
avec fournisseur de paiement simulé. Elles couvrent le soutien personnel et,
pour la commandite, une réalisation Web justifiée, ainsi que les parcours restant
incomplets sans consentement ou avec publication sociale seulement simulée.
Leur définition ne remplace pas le résultat d'une exécution et ne qualifie aucune
publication ou paiement de production.

### Mode automatique de rapprochement

**Démarrer un nouveau passage**, dans l'en-tête ou **Mode guidé → Automatique**,
lance un passage sur les paiements confirmés. Le serveur fige la liste des dossiers,
leurs références, montants et devises ; chaque dossier est ensuite relu à partir
du paiement, de l'offre enregistrée, des obligations et de leurs preuves.
Les quantités et les passages promis doivent tous être présents. Les devises
restent séparées. Le soutien personnel ne crée aucune contrepartie commerciale.

Le carrousel affiche un seul **Bon de préparation** à la fois. Sa position dans
la liste figée est distincte du nombre de dossiers examinés par le serveur.
**Précédent**, **Suivant** et **Actualiser** consultent les faits actuels, y compris
ceux d'un dossier pas encore examiné ; ils ne lancent aucune préparation,
n'accusent réception d'aucune lecture et ne reprennent pas le passage.
Le bon présente paiement, offre acceptée, contrôles, autorisations, brouillons
privés, contenu à relire et éléments manquants. Les liens ouvrent les écrans
propriétaires pour compléter le dossier.

Le même bon est accessible directement dans **Publication**, sixième étape du
dossier consulté, avant les détails des engagements. Aucun passage automatique
n'est requis ou créé. La qualification historique reste accessible dans ces
détails ; son absence apparaît comme un blocage dans le bon. Les deux accès
partagent la version du contenu et l'historique des accords : une préparation
déjà approuvée dans sa version actuelle ne demande pas un deuxième accord.

**Approuver la préparation** est un accord explicite sur la version consultée,
réservé à un opérateur ou propriétaire. Le serveur revérifie la version et les
préconditions puis conserve acteur, date, version, référence d'audit et contenu
approuvé dans une transaction. Un changement déterminant exige une nouvelle
revue et conserve les accords précédents dans l'historique. Un accord sur la
préparation ne réalise aucun avantage et n'autorise ni publication, refus,
remboursement ni envoi. Il ne fait pas avancer le carrousel ou le traitement.
Le rôle lecteur conserve uniquement la consultation.

Une base incompatible ou des droits PostgreSQL insuffisants empêchent le
démarrage de l'API et sont revérifiés à chaque lecture ou accord. Si la
configuration change après démarrage, les deux accès au bon affichent une erreur
de mise à jour de la base ou de droits serveur. L'accord reste désactivé jusqu'à
une actualisation réussie après correction. Les diagnostics et codes sûrs sont
décrits dans le [contrat des bons](../technical/admin-automatic-runs.md#runtime-preparation-readiness).
La détection ne lance aucune migration et ne répète aucun accord.

Le guide attend **J’ai lu, continuer** à chaque point de lecture : périmètre,
aperçu du prochain dossier, résultat confirmé de ce dossier, puis bilan final.
L'aperçu relit le parcours du paiement sans mutation ; sa validation permet un
seul contrôle serveur et les préparations privées admissibles. Chaque résultat,
y compris le dernier, reste à lire avant la suite. Les zones utiles gardent leur
halo avec une pulsation douce continue jusqu'au clic ; le mouvement réduit
conserve un halo fixe. Ce clic accuse réception de la lecture ; il n'approuve
aucune publication, aucun remboursement ni aucun courriel et ne remplace aucune
confirmation métier. Le serveur peut avoir terminé son contrôle alors que le
résultat ou le bilan attend encore la lecture ; ces deux états restent distincts.

Au bilan, le rapport complet reste consultable par pages ; le chargement d'une
page bloque la confirmation de lecture. Une page indisponible se réessaie sans
relancer les contrôles et conserve le repère ; un refus 401/403 arrête la lecture
et retire les données privées affichées.

Le mode explique le dossier contrôlé et sa raison, prépare les brouillons privés
admissibles, puis inscrit le résultat dans un rapport durable avant de passer
au suivant. Ces préparations réutilisent les services métier : elles ne publient
ni n'envoient de message. Une publication, un refus, un remboursement, une facture
à réparer ou un courriel à reprendre conserve sa confirmation et ses droits
habituels. **Examiner ce dossier** permet de rejoindre sa prochaine étape.
Un dossier qui attend une personne, une information ou une échéance reste ouvert
dans le rapport pendant le contrôle des autres dossiers.

Le bilan distingue avantages réalisés avec preuve qualifiée, dispenses humaines
auditées, responsabilités restantes et faits inconnus. Une offre historique non
qualifiée, une obligation manquante, une preuve étrangère ou simulée et une durée
sans attestation ne permettent pas de solder une responsabilité. Les incidents
de paiement, de document et de communication restent également visibles.

Le rapport conserve, par dossier et passage, les faits avant/après, actions,
raisons, acteur, date et références d'audit, de requête et de preuve. Il est
accompagné du détail des avantages promis : quantité, format, éléments requis,
échéance et durée. Les réalisations hors délai restent signalées pour le suivi
humain. Le rapport est
consultable par son acteur après rechargement, avec pagination. Le mode token
partage le même acteur entre ses utilisateurs ; OIDC conserve les comptes
nominatifs. Aucune donnée de rapport n'est enregistrée dans `localStorage`.
**Passage terminé** indique la fin de la liste contrôlée. **Responsabilités
équilibrées lors de ce passage** décrit les observations datées du rapport ;
un fait ultérieur peut rouvrir une responsabilité.

Les paiements confirmés après la capture apparaissent comme nouveaux dossiers à
inclure dans un nouveau passage. **Revérifier** relit la même liste figée après
les interventions humaines. La reprise est explicite : ouvrir le panneau ou
recharger la page relit le rapport sans relancer les opérations. Pause, fermeture du guide,
changement de mode, saisie, navigation manuelle, formulaire ou dialogue ouvert,
onglet masqué, changement de session et erreur interrompant le passage retirent
le halo et arrêtent l'avancement. Les accusés de lecture restent en mémoire pendant le passage,
sans reprise automatique après rechargement. Une requête déjà partie peut se terminer ;
la pause empêche le dossier suivant. Un résultat incertain exige sa
réconciliation et n'est jamais rejoué automatiquement.

**Réconcilier le résultat** demande confirmation puis consulte les commandes
durables. Le serveur récupère un résultat déjà enregistré ou prouve l'absence
de préparation validée avant de laisser le passage en pause. **Reprendre** est
un second geste volontaire ; une incohérence conserve le blocage.

Le contrat privé et les droits des endpoints sont décrits dans
[l'API administrative](../technical/admin-automatic-runs.md).
La migration additive `055_admin_automatic_responsibility_runs.sql` conserve
manifestes, commandes idempotentes et entrées de rapport immuables ; elle
n'active aucun worker. La migration additive
`056_admin_preparation_approvals.sql` ajoute l'historique immuable des accords
sur les préparations privées, sans créer d'accord existant ni déclencher
d'opération. `057_dossier_preparation_approvals.sql` rend ce bon accessible sans
passage et conserve les accords précédents. Appliquer la procédure de
[migration](database-migrations.md) avant d'utiliser le nouveau mode.

### Préparation d'un dossier ou d'une rubrique

Les outils de préparation du guide flottant proposent le paiement suivi ou l’une des
18 rubriques administratives. **Démarrer la préparation** montre l’étape et sa
raison, rejoint l’écran, met la zone utile en évidence et ouvre les préparations
explicitement déclarées par les composants propriétaires. Lorsque plusieurs
décisions sont possibles, l’administrateur choisit celle à préparer. Les
formulaires déjà affichés attendent les informations et preuves manquantes.

Les préparations ouvrent un aperçu, un formulaire ou la confirmation habituelle.
Aucune validation finale n’est enregistrée dans ce registre. Paiement,
consentement, revue, visibilité et publication restent des décisions distinctes ;
aucun montant, consentement, motif ou justificatif n’est inventé. Les actions
globales et les courriels sans lien explicite au paiement restent exclus d’un
parcours ciblé. Les contrôles du mode sont accessibles à la manette commune.

Le parcours d’un paiement relit les faits privés du serveur après une mutation,
avant chaque préparation et toutes les dix secondes pendant l’attente, au plus
trente fois avant pause. Il ne passe à la suite qu’après changement de la
prochaine étape ; une visite ou un POST réussi ne solde aucune obligation.
Un formulaire ouvert, un dialogue ou un reçu non résolu bloque la navigation et
la fin du parcours. Un résultat incertain exige toujours sa réconciliation.

**Pause immédiate**, saisie dans un dossier, navigation manuelle, onglet masqué
et changement de session interrompent l’exécution. La reprise relit les faits.
Après rechargement, seule la préférence du mode est conservée ; démarrage et
confirmations restent volontaires. Le journal de repères est borné, en mémoire
et purgé au changement de session. Il ne remplace pas l’audit du serveur.

Les tests `admin-automatic-run.test.mjs`,
`admin-automatic-preparation.test.mjs` et `admin-guidance.spec.ts` couvrent moteur,
préparations explicites et interactions navigateur. Ils ne qualifient ni une
manette physique ni les fournisseurs de production.

### Découverte des commandes

Le bouton **Guide pas à pas** du poste de pilotage présente dix repères :
préparation automatique, espaces, dossier, situation/proposition/conséquence,
détails, décisions, file, semaine, calendrier et manette. Dans **Ma semaine**,
un second guide parcourt les six outils en ouvrant leur vue. Ces guides sont
volontaires et consultables aussi en lecture seule. Ils expliquent les contrôles
sans les activer, sans envoyer de commande métier ni confirmer une publication.

Chaque étape met son élément en évidence et propose **Précédent**, **Suivant**
ou **J’ai compris** à la fin. **Quitter le guide** et Échap ferment uniquement
le guide et rendent le focus au bouton de départ. Dans Ma semaine, la vue
initiale et les saisies non enregistrées sont préservées tant que le panneau
reste ouvert. Tab/Entrée et les flèches gauche/droite fonctionnent au clavier.
À la manette, LB/RB changent d'étape, A active le bouton sélectionné, B quitte;
les autres raccourcis métier sont neutralisés pendant le guide. Chaque changement
d'étape exige le retour au neutre habituel.
Le repère reste dans la partie visible du conteneur défilant; son contour est
limité à cette zone lorsque la cible en dépasse les limites.

La progression (identifiant d'étape et fin du guide) est conservée dans
`localStorage`, par guide, version du parcours et compte OIDC. Le mode token
partage une progression locale entre ses utilisateurs. Aucun contenu de dossier
ou secret n'est enregistré. Le bouton devient **Reprendre le guide**, puis
**Revoir le guide** une fois terminé. La reprise est volontaire, jamais ouverte
automatiquement. Elle reste limitée à ce navigateur; pas de synchronisation
entre appareils. Un stockage indisponible est signalé et garde seulement la
progression en mémoire. Un élément absent est expliqué sans bloquer le parcours.

La recette `admin-pilotage.spec.ts` couvre reprise après rechargement, fin et
relecture, isolation des comptes, absence de commande métier, priorité manette,
focus, panneaux imbriqués, stockage indisponible, état vide, FR/EN,
accessibilité et redimensionnement. La qualification physique reste distincte.

## Parcours disponibles

| Espace                    | Dans le pilotage                                                                                                                        | Dossier complet                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Publications              | Aperçu privé, texte exact, destination, date, acceptation groupée des commanditaires, refus, édition du texte et de la date, calendrier | Composition avancée, remplacement de média, réconciliation d’un envoi incertain, historique |
| Commanditaires            | Photo, revue privée, acceptation ou refus motivé                                                                                        | Correction de fiche et revue détaillée des médias                                           |
| Courriels                 | Aperçu du destinataire et du texte au moment de la décision, nouvelle tentative ciblée                                                  | Correction d’adresse et investigation de livraison                                          |
| Factures et contributions | Anomalies, inspection protégée des factures disponibles et événements Stripe                                                            | Émission manquante, remboursement, backfill et corrections financières                      |
| Projets                   | Contenu public d’une réalisation en brouillon, publication par le propriétaire                                                          | Modification du budget, des preuves et du contenu détaillé                                  |
| Opérations                | État des destinations, pause/reprise explicite d’un feed                                                                                | Configuration et diagnostics avancés                                                        |

Le compteur porte sur les décisions de la projection, pas sur l’ensemble des
objets du portail. La lecture se fait par pages de 30 décisions. Les publications
réutilisent la fenêtre du moteur (200 derniers dossiers, exceptions prioritaires).
Une couverture incomplète est signalée. Une actualisation ne remplace pas le
dossier lu : sa nouvelle version doit être relue avant décision.

## Commandes et contextes

### Manette dans toute l’administration

Le contrôleur est partagé par les pages utilisant le cadre administratif. La
connexion d’une manette reconnue active la navigation, sans ajouter de droit ni
d’opération métier. Hors des raccourcis propres au Pilotage :

- Croix ou stick gauche : rejoindre un contrôle ; LB/RB : précédent/suivant
  dans l’ordre de lecture. Un cadre doré indique le focus.
- A : activer le contrôle sélectionné. Sur un champ, ouvrir la saisie à l’écran ;
  sur une liste, ouvrir le choix des valeurs. X ouvre aussi la saisie.
- B : annuler le panneau supérieur ou revenir au contenu. Y rejoint le mode
  guidé. Menu/View présentent les commandes. Le stick droit fait défiler.

Le guide du paiement, ses liens, sa pause et sa reprise utilisent ces mêmes
contrôles, y compris après changement de rubrique. Les coordonnées, motifs,
preuves, dates et montants se saisissent dans un éditeur transitoire. La valeur
d’origine reste intacte jusqu’à **Appliquer la saisie** ; **Annuler** ne la change
pas. Les contraintes du champ restent vérifiées. Une liste conserve aussi son
choix jusqu’à application. Si le champ ou ses choix changent pendant l’édition,
il faut fermer et relire avant de reprendre. Aucun texte saisi n’est mémorisé.

Cela permet de rejoindre et utiliser les écrans existants pour fiche, médias
transmis, consentements, engagements et preuves, factures/avoirs/remboursements,
courriels et réconciliation. Les boutons soumis à un rôle, à une preuve ou à une
confirmation conservent ces conditions. Le contrôle Xbox ne remplace aucun
écran métier et ne soumet pas un formulaire à la fermeture de la saisie.

Dans Pilotage, les raccourcis de décision gardent la priorité lorsque le focus
est dans le poste. Le guide flottant, la navigation commune et les éditeurs
globaux reprennent la main lorsqu’ils sont sélectionnés. Le dialogue au-dessus
des autres possède le focus ; B ferme seulement ce dialogue. A respecte le bouton
sélectionné, y compris **Annuler**. Toute activation exige un relâchement ;
changement de page, de contexte ou de périphérique impose le retour au neutre.

Les tests de parcours manette sont définis dans
`tests/playwright/admin-controller-journeys.spec.ts`. Les recettes personnelles
et commandites utilisent aussi une manette simulée pour ouvrir, suspendre et
reprendre le parcours sur l’API et PostgreSQL jetables. Le cas 100 CAD avec
consentement public vérifie également la revue des médias transmis, l’acceptation
du dossier, la préparation éditoriale, la nouvelle revue et la mise en visibilité
à la manette jusqu’à la fin du parcours serveur. Les preuves UI, les
effets métier et la qualification d’une Xbox physique restent distincts.
Les dialogues du système d’exploitation, l’authentification externe et les
contrôles d’un autre onglet ne font pas partie de la capture de cette page.
En particulier, la sélection d’un nouveau fichier sur le disque utilise la fenêtre
du navigateur. Le parcours administratif à la manette examine les médias transmis
par le commanditaire depuis son formulaire privé ; le renvoi de ce lien conserve
sa confirmation et les droits habituels.

### Manette virtuelle et paiements de test

Dans la [sandbox locale séparée](admin-sandbox.md), **Manette virtuelle · Essais**
ouvre un panneau réservé à côté du contenu, ou en bas sur écran étroit. Les
17 boutons Xbox, les deux sticks et les gâchettes sont actionnables à la souris.
Les entrées empruntent le même parseur que la manette physique. Les boutons
sans commande métier affichent seulement leur état ; ils ne créent aucune action.
**Maintenir LT** permet les combinaisons ; **Tout relâcher** remet au neutre.

Le panneau rejoint le dialogue natif actif pendant une confirmation ou une
édition, puis revient dans son emplacement réservé. Le focus reste sur le
contrôle métier. Relâcher A demeure nécessaire avant une nouvelle confirmation.
Le guide conserve son espace et ne recouvre pas le panneau.

La rubrique des paiements de test propose les types, montants et consentements
du site. Checkout et son webhook signé simulé passent par l'API normale ; le
parcours n'est proposé qu'après lecture du paiement confirmé côté serveur.
Une reprise conserve le même Checkout. Un autre scénario garde le dossier
précédent dans la base temporaire. Aucun état privé du parcours n'est conservé
dans le stockage du navigateur.

Après une commandite, **Jouer le commanditaire** ouvre son Checkout déjà confirmé
dans un autre onglet. **Continuer vers OpenG7** rejoint la fiche privée où fournir
des médias fictifs, avant de revenir les examiner dans l'administration.

Le panneau exige un manifeste local versionné, fourni uniquement par le lanceur
de sandbox ; un site habituel ne l'affiche pas. Cela ne confère aucun droit API.
La recette navigateur et les limites de cette simulation sont dans le runbook
de sandbox ; elle ne qualifie pas une manette USB/Bluetooth physique.

### Raccourcis du poste de pilotage

**Détails** présente le contenu à examiner, le statut, la destination et la date
(America/Toronto), puis les informations du dossier. **Si vous acceptez** décrit
la conséquence de la décision proposée; ce texte n'est pas un reçu d'exécution.
L'aperçu reste consultatif. **Fermer** et **Ouvrir le dossier complet** restent
accessibles dans le pied du panneau, y compris pendant le défilement au clavier
ou au stick droit. Factures et événements Stripe gardent leur inspection dédiée.

Pour un courriel, destinataire, objet et corps sont chargés à l'ouverture. Une
version différente est signalée sans remplacer silencieusement le dossier lu;
**Charger la version à jour** permet de le relire avant toute décision. Les états
indisponible, retiré, accès refusé et session expirée sont explicites. Une réponse
arrivée après fermeture ou changement de dossier ne remplace pas l'aperçu courant.

- Profil initial : A accepter/sélectionner, B refuser/revenir, X modifier, Y détails.
- LB/RB : décision précédente/suivante. LT + LB/RB : espace précédent/suivant.
- LT + Y : calendrier. Menu : commandes et pauses. View : aide.
- Croix/stick gauche : navigation dans les contrôles. Stick droit : défilement.
- Clavier : Tab/Entrée, A/B/X/Y, crochets précédent/suivant, C, M et `?`.
  Les champs de saisie gardent leurs touches normales.
- Les champs numériques et listes des panneaux se règlent à gauche/droite.
  L’édition propose des décalages de date et un clavier visuel pour le texte court.

Une action sensible ouvre un panneau indiquant la cible et la conséquence.
Relâcher la manette avant la seconde étape. Le maintien ne répète jamais une
mutation. Un changement de contexte, de périphérique ou de focus impose un
retour au neutre. Les combinaisons n’activent pas en même temps leur bouton seul.
Le panneau ouvert a priorité sur la carte et sur la file.

Les réglages proposent sensibilité, délai, réaffectation distincte des quatre
boutons, retour au profil initial et vibration facultative. Le diagnostic expose
les indices bruts. Pour une disposition non standard, une correspondance complète
de 16 boutons et 4 axes, vérifiée explicitement, est liée à l’identifiant de modèle
fourni par le navigateur. Si les entrées requises manquent, la capture reste inactive.
Le profil est local à l’appareil, sans contenu métier. Aucun périphérique n’est
déclaré compatible sur la seule base d’une simulation.

## Autorité, droits et reçus

`GET /api/admin/pilotage` projette les sources existantes. `POST
/api/admin/pilotage/command` accepte un catalogue fermé, une cible, une version,
une confirmation identique à la cible et un UUID de requête. Les alias `/admin`
partagent les mêmes contrôles. Les réponses sont privées et `no-store`.

Le lecteur consulte. L’opérateur traite publications, revues, courriels et pauses.
La publication/masquage des réalisations reste réservée au propriétaire, comme
les mutations du domaine dépenses dans le portail. Le mode token conserve les
garanties de son mode historique, sans devenir une identité nominative OIDC.

La migration **024** ajoute `admin_command_receipts`. Une même requête ne peut
pas être exécutée une seconde fois, ni réutilisée avec un autre contenu/acteur.
Les reçus ne contiennent ni le corps privé d’un courriel ni le texte de publication.
Ils sont lisibles uniquement par leur auteur via `GET /api/admin/pilotage/receipt`.
Les commandes et leurs résultats sont audités. Les règles existantes de paiement,
consentement, média et version s’exécutent côté API.

Le reçu et certaines mutations métier utilisent des transactions distinctes.
Après une interruption, un reçu `executing` ancien devient `uncertain`. Le client
vérifie le reçu au lieu de rejouer la commande; il conserve son identifiant en
session pour reprendre après rechargement. Une incertitude persistante demande
une investigation du dossier et de l’audit. Le panneau « Examiner cet incident »
permet ensuite à son auteur de consigner un constat audité et de libérer le
pilotage. Le reçu conserve son statut incertain; cette déclaration ne simule
aucun succès et ne réexécute aucune commande. Ne pas effacer le reçu pour relancer.
Un reçu `completed` confirme la commande, pas un envoi externe déjà terminé.
Après récupération d'un reçu au rechargement, le pilotage sélectionne une
décision disponible sans effacer le résultat récupéré. Un reçu échoué conserve
son explication après l'actualisation des décisions. Le parcours complet de
composition et de reprise est décrit dans la
[recette éditoriale](editorial-programme.md#calendrier-et-répétition-générale-avec-api-réelle).

## Activation et retour au portail

1. Livrer les builds Web/API compatibles. La route est additionnelle et ne change
   pas la page d’entrée des administrateurs.
2. Appliquer uniquement les migrations manquantes, dont 024, selon le
   [runbook des migrations](database-migrations.md). Les runners actuels ne doivent
   pas rejouer aveuglément les anciennes migrations sur une base existante.
3. Vérifier les rôles, le calendrier et les destinations en simulation avant
   toute activation réelle des fournisseurs.

Sans 024, la projection annonce une couverture partielle et désactive les commandes.
Le changement n’active aucun worker et ne modifie aucune variable d’environnement.
Suspendre la capture manette arrête les entrées physiques uniquement. Suspendre
un feed bloque ses prochains envois, avec possibilité de terminer un envoi déjà
en cours. Le worker est un troisième contrôle, distinct de ces deux pauses.
Revenir au portail ne révoque pas les autorisations d’envoi déjà enregistrées.

## Recette et limites de preuve

Les tests couvrent les transitions de boutons, la calibration, la répétition et
les contextes; PostgreSQL jetable vérifie la migration depuis 023, la concurrence,
les versions, les revues, la file de courriels et les véritables routes HTTP OIDC.
Playwright exerce 20 décisions à la manette simulée, édition, refus, calendrier,
réponse perdue, rechargement, focus, version périmée, accessibilité et vue étroite.
Les mesures de session (décisions, détails, sorties portail) restent en mémoire.

`tests/playwright/admin-pilotage.spec.ts` vérifie aussi les compteurs avant le
reçu serveur, après annulation, échec ou résultat incertain, puis leur remise à
zéro au rechargement. Les commandes restent accessibles au clavier et pendant
le défilement sur mobile et desktop; le mode de mouvement réduit et l'état vide
FR/EN sont couverts avec des réponses API simulées.

`tests/playwright/admin-pilotage-acceptance.spec.ts` utilise la pile Docker
jetable : navigateur, API et PostgreSQL réels. Deux parcours vérifient la
confirmation d'un brouillon synthétique, son reçu, son audit et sa persistance,
dont une réponse perdue après exécution serveur, récupérée sans seconde commande.
Ils exercent aussi la validation du contrat : les métadonnées d'affichage du
panneau, comme son titre, restent côté client.
Ils exigent le runner isolé, le worker désactivé et une destination suspendue en
mode `mock`. Le fournisseur social reste simulé; l'approbation ne prouve pas un
envoi externe. Le workflow `Admin acceptance` découvre ces tests automatiquement.

La [recette OIDC du pilotage](../../tests/identity/pilotage-moderation-journey.spec.ts)
vérifie la file mixte et l'approbation de deux commanditaires puis de leur livraison.
L'annulation du second panneau n'enregistre aucune décision. Un conflit concurrent
annule toute l'opération ; le succès et le rejeu conservent trois décisions et une
seule autorisation, sans publication sur le site ni envoi social.

Commandes de recette :

```sh
yarn workspace @openg7/funding-web build --configuration production
yarn build
node --test tests/admin-controller.test.mjs tests/integration/admin-pilotage.integration.mjs
yarn tsc -p tests/tsconfig.admin-ui.json
yarn playwright test --config tests/playwright-admin-ui.config.mjs admin-pilotage.spec.ts
yarn test:e2e:acceptance admin-pilotage-acceptance.spec.ts --project=chromium
```

Le build Angular efface la sortie TypeScript des helpers Web; relancer `yarn build`
avant les tests Node qui importent ces helpers. Les tests PostgreSQL créent leur
conteneur jetable et ne lisent pas `.env`.

**Qualification matérielle encore à réaliser :** Xbox One réelle, USB puis
Bluetooth, modèle exact, version du système et navigateur, reconnexion, perte de
focus et manette tenue pendant l’ouverture d’une confirmation. Aucune publication
réelle ni activation en production n’a été effectuée dans cette recette.

Voir [la décision d’architecture](../decisions/2026-09-21-admin-controller.md)
et [le plan approuvé](../admin-controller-plan-de-travail.md).
