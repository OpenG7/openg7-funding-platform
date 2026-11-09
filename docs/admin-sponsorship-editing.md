# Modification d’un dossier commanditaire

Depuis `/admin/fundraiser/sponsors`, sélectionner le dossier puis choisir **Modifier le dossier** dans sa barre d’outils. Le formulaire est accessible depuis chaque onglet, en français et en anglais, sur ordinateur et mobile.

**Identité** possède les coordonnées, les consentements et la transmission du
formulaire commanditaire. **Fiche et médias** possède la bibliothèque privée du
dossier actif : galerie, ressources de présentation, documents pris en charge et
corrections. Aucun formulaire d’identité n’est répété dans la galerie; une alerte
contextuelle rejoint la section propriétaire lorsque nécessaire. L’en-tête et les
outils globaux du dossier restent accessibles. Voir la
[cartographie et les capacités de la galerie](technical/intelligent-media-gallery.md).

## Parcourir le dossier

La correction d’identité conserve les consentements. Pour un accord public déjà
reçu mais absent du dossier, l’[atelier d’examen](technical/preflight-examination.md)
propose une commande distincte avec preuve, date, droits et confirmation. Voir
le [périmètre du consentement documenté](technical/sponsorship-public-consent.md).
Cette commande maintient le profil en attente de visibilité et n’approuve
aucun contenu.

L’en-tête affiche la référence et sa commande de copie, le montant avec sa devise
et des états distincts pour la revue, le paiement, la visibilité Web et le
remboursement éventuel.
**Aperçu** présente six statistiques, une priorité actuelle et un tableau navigable
des domaines. Les étapes réglées, prestations livrées, blocages opérationnels
consolidés, visibilité publique et validations de médias sont projetés depuis les
faits métier disponibles. Une donnée inconnue reste indiquée indisponible. Le nombre
de propositions Preflight prêtes reste indisponible tant qu’aucune source courante
et examinable n’est chargée ; les obligations ou brouillons de publication ne sont
pas assimilés à ces propositions.

La priorité rejoint un seul espace responsable selon les prérequis et permissions
connus. Une confirmation discrète remplace l’action lorsqu’aucune intervention n’est
requise. Les lignes du tableau rejoignent Identité, Fiche et médias, Publication
(y compris la revue administrative) ou Finances. Aucun formulaire, liste détaillée
de blocages, prestation ou décision de publication n’est reproduit dans Aperçu.
Identité, Finances et Historique conservent leur rappel contextuel existant ; dans
Identité, il est masqué lorsqu’il vise déjà ce domaine. Publication possède son
propre suivi individuel. Les liens n’exécutent aucune décision.

Les six onglets sont `overview`, `identity`, `media`, `publication`, `billing` et
`audit`. **Identité** et **Fiche et médias** sont deux espaces distincts; leurs
indicateurs reflètent leurs propres jalons serveur. Les liens `dossier-identity`,
`dossier-media` et `dossier-media-gallery` rejoignent leurs contrôles respectifs.
L’alias `refund` reste
rattaché à **Finances**. Aucun onglet supplémentaire n’est créé.

<a id="outils-du-dossier-a-la-demande"></a>

## Outils du dossier à la demande

L’en-tête du dossier propose **Modération éditoriale** pour l’opérateur ou le
propriétaire. La barre conserve **Accès au suivi** pour le propriétaire. Un
panneau non modal affiche un seul de ces outils à la fois. La modération
réutilise le composant de décisions existant et sa confirmation du contenu exact.

À l’ouverture, le focus rejoint un contrôle utilisable au clavier et à la
manette. **Fermer l’outil du dossier** ou Échap rend le focus au déclencheur
concerné et le révèle dans la fenêtre s’il est masqué. Hors opération en cours,
changer d’onglet masque l’outil courant ; les
outils déjà ouverts restent montés pour le même dossier, afin de conserver
notamment l’identifiant d’une demande d’accès incertaine. Changer de dossier ou
de session, même avec le même rôle, réinitialise les outils visités et efface
le contexte de modération précédent. Dans la nouvelle session, la modération repart au niveau
**Demander une correction (N1)** ; le niveau choisi reste conservé pour la même
session et le même dossier. Leur fermeture est bloquée pendant une
opération de modération ou d’accès en cours.
Un raccourci d’accès ouvre ou focalise l’outil déjà ouvert ; il n’envoie aucun message.

**Note interne** ouvre le même tiroir depuis chaque onglet, sans quitter celui-ci.
Les brouillons, la limite de 1 000 caractères, la lecture seule, la sauvegarde
versionnée et le retour du focus au déclencheur conservent leur mécanisme existant.
Cette note privée reste distincte du journal d’interventions.

La rédaction, la conversation, les propositions de l’Assistant et l’aide pas à pas sont accessibles
par l’entrée unique **Assistant et aide**, avec le même `sponsorshipId` ; le lien
Assistant du cadre administratif transporte aussi cette sélection et son origine.
Sur cette page commune, l’Assistant occupe deux tiers et l’aide un tiers ; ils
sont empilés sous 1 100 px. L’aide quitte le panneau des outils du dossier.

**Retour au dossier** retrouve l’onglet et le fragment d’origine validés, même
si la lecture de l’Assistant échoue. **Ouvrir le dossier** conserve la prochaine
étape recommandée. Le retour utilise le même dossier et le contrat `returnTo`
décrit dans le [guide de l’Assistant](admin-ux-lot-3.md#retour-au-dossier--oux-002),
sans texte de question ni brouillon dans l’URL. Le focus retrouve le déclencheur
dans le même onglet ; après rechargement, le fragment valide retrouve sa section.

Les liens `tab=identity&action=edit-identity` et
`tab=identity&action=followup-access` vérifient la sélection du dossier et les
droits, puis retirent `action` par `replaceUrl` avant d’ouvrir le contrôle
propriétaire. Une cible différente ou un autre onglet n’ouvre aucun formulaire.
La navigation n’enregistre aucune saisie et n’envoie aucun courriel; les commandes
conservent leurs confirmations et contrôles API.

Dans **Publication**, le suivi individuel présente l’état, les exceptions et les
prestations du dossier. Leurs détails rejoignent les preuves dans Campagnes et les
parcours de travail du Comptoir. La fiche publique et le suivi social déclaré sont
dans **Fiche et médias** ; leur sauvegarde conserve le workflow versionné existant.
Le propriétaire trouve l’inventaire d’adoption et l’audit global dans
`/admin/fundraiser/sponsors/quality`, **Qualité des commandites**. L’audit affiché
dans un dossier reste borné à ce dossier.

## Identité et coordonnées

L’onglet **Identité** présente deux étapes, **Coordonnées du commanditaire** et
**Transmission par le commanditaire**, avec un seul encadré expliquant le rôle de
l’administration. Leurs états restent indépendants : des coordonnées complètes
ne prouvent aucune transmission, et une transmission existante ne complète pas
les coordonnées manquantes.

Les cinq tuiles affichent l’organisation, le courriel, la personne-ressource, le
site web et le nom public. Seuls le nom de l’organisation et le courriel de contact
déterminent l’état **Complet** ou **À compléter** des coordonnées. L’absence d’un
champ facultatif reste neutre. Le nom public distingue **Non fourni**, lorsque le
consentement existe sans nom enregistré, de **Non consenti**, qui ne dévoile pas
un nom public enregistré sans cet accord. Le message reçu du commanditaire,
lorsqu’il existe, reste consultable dans cet onglet.

**Modifier l’identité et les coordonnées** ouvre le formulaire de correction
existant pour les opérateurs et propriétaires; les lecteurs conservent la lecture
seule. Après confirmation de l’enregistrement, le dossier est relu depuis le
serveur. Corriger les coordonnées conserve les consentements et la revue, ne
soumet pas le formulaire au nom du commanditaire et ne crée aucune date de
transmission.

L’étape de transmission affiche **En attente** ou **Transmis**, avec la date
réellement enregistrée lorsqu’elle existe. **Voir l’accès au suivi commanditaire**
rejoint l’outil privé existant, réservé au propriétaire; ouvrir cet outil n’envoie
aucun courriel. Les autres rôles disposent de l’explication pour solliciter un
propriétaire. Les deux étapes s’empilent sur mobile et conservent l’ordre de
lecture et l’accès clavier.

La progression expose `identity_missing` / `blocked` lorsque le nom ou le courriel manque, `identity_submission_pending` / `pending` lorsque seules les informations transmises sont attendues, et `identity_complete` / `complete` lorsque les deux conditions sont satisfaites. Le nouveau motif s’applique au jalon et à la prochaine étape du dossier/cockpit. Le format de la réponse est conservé ; déployer les traductions Web avant ou avec l’API qui émet ce motif. Les dossiers existants ne sont pas marqués comme transmis automatiquement.

Les cinq champs sont préremplis avec les informations du dossier sélectionné dès l’ouverture du formulaire. Un champ non renseigné reste vide. Après une annulation, rouvrir le formulaire reprend les informations enregistrées ; le brouillon annulé n’est pas conservé.

Champs corrigibles : entreprise (obligatoire, 200 caractères), nom public (100 caractères), contact et courriel (200 caractères), site web (URL HTTP/HTTPS sans identifiants, 2 048 caractères). Les champs facultatifs peuvent être effacés. Choisir un motif : correction d’une erreur, mise à jour du contact ou de l’entreprise, puis enregistrer et confirmer le récapitulatif. Annuler ne sauvegarde rien et restaure le focus.

La correction conserve le paiement, la devise, les montants, les identifiants Stripe, les factures et notes de crédit déjà émises, le courriel original du paiement, les consentements, la revue et les statuts de publication. Le courriel du contact corrigé sert aux prochains messages qui ciblent ce contact ; les messages déjà en file et les snapshots de facturation ne sont pas réécrits. Le nom et le site d’un dossier déjà admissible au répertoire public peuvent changer après cette confirmation administrative.

Un échec conserve les saisies. Une relance identique réutilise l’identifiant de la demande. Un conflit signale que le dossier a changé : fermer le formulaire et utiliser **Actualiser le dossier** avant de reprendre la correction. Un refus d’accès efface le brouillon ; une session expirée revient à la connexion.

## Contrat et garanties

`POST /api/admin/sponsorships/details` (alias `/admin/sponsorships/details`) exige une session administrative autorisée, PostgreSQL et un corps JSON limité à 16 Kio. En mode OIDC, les opérateurs et propriétaires peuvent corriger ; les lecteurs sont refusés. La vérification d’origine des mutations OIDC existante s’applique.

Le corps contient `contributionId`, `expectedVersion`, `requestId` (UUID), `confirmed: true`, `reason` (`correction`, `contact_update`, `organization_update`) et les cinq champs `companyName`, `publicName`, `contactName`, `contactEmail`, `websiteUrl`. Les propriétés inconnues sont refusées. Les coordonnées sont normalisées et validées côté API ; aucune donnée financière n’est acceptée dans ce contrat.

Le dossier est verrouillé pendant une transaction. La version est vérifiée avant correction ; la modification et l’audit `sponsorship.details.update` sont atomiques. L’audit conserve l’acteur, la cible, la date, les noms des champs modifiés, le motif, l’identifiant de demande, son empreinte et le résultat. Les anciennes et nouvelles coordonnées ne sont pas copiées dans l’audit. Le dossier présente un libellé traduit dans son historique.

Les parcours d'accès privé, de demande d'informations, d'intervention, de correction
et de visibilité Web partagent la même [enveloppe transactionnelle PostgreSQL](../apps/funding-api/src/postgres-transaction.ts).
Chaque service conserve ses validations, ses verrous et ses règles d'idempotence;
les audits restent dans les actions métier qui les exigent. Le résultat est retourné
après validation de la transaction et libération
de la connexion; une erreur tente l'annulation sans rejouer automatiquement l'action.
Les demandes d'informations, les interventions et la visibilité Web réutilisent
le [verrou de dossier commanditaire](../apps/funding-api/src/fund-contributions.repository.ts),
qui exclut les contributions personnelles. Les verrous médias et le snapshot de
lecture de la progression restent propres à leurs parcours.

La correction et le journal d'interventions partagent la
[lecture du reçu dans l'audit](../apps/funding-api/src/fund-admin.repository.ts).
Le reçu est recherché pour le dossier, l'action et l'identifiant de demande exacts;
chaque service conserve sa propre empreinte et vérifie le rejeu avant les nouvelles
préconditions de version ou de date.

Une demande identique déjà appliquée retourne son résultat enregistré, sans second audit. Réutiliser son identifiant avec un autre contenu produit un conflit. Une soumission sans changement ne modifie ni version ni audit. Réponses : 200 (`updated`, `version`), 400 (entrée invalide), 401/403 (accès), 404 (dossier absent), 409 (conflit), 405 (méthode), 415 (type de contenu), 503 (stockage indisponible ou échec). Les réponses sont privées et non mises en cache.

Aucune nouvelle migration ni opération sur les données existantes n’est nécessaire. Les tables `fund_contributions` et `admin_audit_log` doivent déjà être migrées. La validation commune appartient à `funding-core`. L’API utilise son chemin relatif de module pour respecter la compilation actuelle sous `dist/packages/funding-core/src` ; les alias TypeScript du dépôt ne réécrivent pas les imports Node à l’exécution. L’image Docker API inclut désormais ce package compilé pour rendre la validation disponible à l’exécution.

## Suivi des dossiers incomplets et interventions

La commande **Suivi et interventions** reste accessible au-dessus des onglets du
dossier. Elle ouvre le même panneau depuis chaque onglet; sa première lecture
est différée jusqu’à cette ouverture. Fermer le panneau ou changer d’onglet
conserve le brouillon et l’identifiant d’une tentative à reprendre dans le même
dossier. Changer de dossier ou de session, ou perdre l’accès, efface le contexte
privé; une réponse de l’ancienne session ne peut pas le rétablir.
Le journal conserve les démarches effectuées, leur résultat, l’acteur authentifié et la
date serveur d’enregistrement. Une intervention antérieure peut préciser sa date
dans la note. En mode token partagé, l’acteur reste commun : seule une session
nominative permet d’attribuer la note à une personne distincte.

Les types sont : courriel déjà envoyé, appel/échange effectué, note interne ou
correction, prolongation et examen d’un éventuel remboursement. Ces notes privées
ne sont ni un envoi de courriel, ni une décision de remboursement, ni une preuve
de lecture du lien. Pour corriger une note, ajouter une nouvelle intervention :
l’interface ne propose ni modification ni suppression. Le journal reste accessible
après remboursement, par pages de 25, y compris au-delà des 20 événements présentés
dans l’ancien résumé d’audit du dossier. Les notes ne sont pas exposées au suivi
public et ne doivent contenir aucun secret ni lien privé.

Les repères internes `SPONSORSHIP_FOLLOWUP_DAYS` sont centralisés dans
`packages/funding-core/src/sponsorship-interventions.ts` : 7 jours pour envisager
une première relance, 14 pour une nouvelle prise de contact, 30 pour examiner une
décision. Ils sont calculés depuis le paiement confirmé, indépendamment de la
date d’expiration du lien. Ils ne promettent aucun remboursement ni courriel
automatique et ne modifient pas la politique publique au cas par cas.

Le suivi utilise la complétude de l’Assistant : formulaire transmis, entreprise,
courriel et image de présentation présents. Un dossier complet sort des relances,
même si la revue administrative reste à faire. Un paiement non confirmé, un refus
ou un remboursement engagé sort du suivi des informations. Une prolongation exige
une note et une date UTC strictement future : jusqu’à cette date le panneau indique
le délai accordé, puis réclame un réexamen. Une nouvelle note ordinaire ne repousse
pas cette échéance. Le dernier courriel de suivi distingue mise en file, envoi et
échec ; « envoyé » ne signifie pas « lu ».

### Contrat du journal

`GET /api/admin/sponsorships/interventions?sponsorshipId=<UUID>&before=<UUID>`
(alias sans `/api`) retourne `entries`, `nextCursor` et `followup`. `before` est
facultatif ; le curseur est limité au même dossier. Les pages sont ordonnées par
date et identifiant décroissants, sans décalage des anciennes pages lors d’un
nouvel ajout. L’échéance est recherchée dans tout le journal, pas seulement dans
la page affichée. Les métadonnées privées des courriels ne sont pas retournées.

`POST` au même endpoint exige `contributionId`, `requestId` (UUID), `kind`
(`email`, `phone`, `internal`, `extension`, `refund_review`), `note` (1 à 2 000
caractères après normalisation, entrée limitée à 2 000) et `nextReviewOn` (`null`,
ou `YYYY-MM-DD` exclusivement pour une prolongation). Les propriétés inconnues
sont refusées. L’acteur et la date proviennent du serveur. Le verrou du dossier
sérialise les ajouts ; l’entrée `sponsorship.intervention.recorded` dans
`admin_audit_log` constitue la note et sa trace d’audit atomique. Même demande et
acteur : même entrée ; même identifiant avec contenu ou acteur différent : 409.
Une relance identique reste récupérable après expiration de la prolongation.

Tous les rôles admin lisent ; opérateurs et propriétaires ajoutent ; lecteurs
refusés en écriture par l’API. Les contrôles d’origine existants s’appliquent.
Corps JSON limité à 16 Kio, réponses privées sans cache : 200, 400, 401/403, 404,
405, 409, 415 ou 503 selon le résultat. Aucun endpoint d’édition/suppression,
aucune modification des faits financiers, du dossier, des consentements ou de
la publication. Aucun effet externe n’est déclenché. Pas de nouvelle migration :
les tables d’audit, courriels et accès commanditaires existantes sont réutilisées.
Livrer l’API avec le Web ; une API indisponible affiche une erreur de journal.

## Lecture des finances et de l’activité

Les six onglets conservent leurs responsabilités. Dans Aperçu, la priorité unique
et le tableau des domaines remplacent le bloc détaillé **À traiter**. Identité,
Finances et Historique conservent leur orientation contextuelle selon leurs règles
d’affichage ; le suivi de Publication présente ses propres états et prérequis.
Les liens ciblent la section concernée, y compris
au clavier sur mobile. Les indicateurs des onglets reprennent les états disponibles;
une lecture indisponible ne conserve pas les indicateurs du dossier précédent.
La préparation, la revue, le paiement et l’autorisation de publication restent
distincts. Le guide conserve les explications détaillées à la demande.

Dans la fiche de préparation du Comptoir, sélectionner un contrôle affiche son détail, puis
**Actions** ouvre le controller partagé. L'action proposée rejoint l'écran
propriétaire; relire ensuite la fiche pour obtenir la progression serveur. L'approbation
d'une préparation admissible conserve sa confirmation explicite et la version
consultée. Voir le [parcours de préparation](operations/admin-pilotage.md#preparation-pilot)
pour la sélection, les commandes et les limites de la simulation Gamepad, ainsi
que le [vocabulaire commun](technical/admin-campaigns.md#vocabulaire-des-operations).

Pour un accord historique à qualifier, le propriétaire peut enregistrer un texte
privé versionné et lancer une **assistance locale** depuis la section de l’accord.
Une nouvelle source admissible démarre le traitement dès son enregistrement ;
une source identique ou la simple consultation ne le relance pas.
Le tableau rapproche les détails explicitement repérés de leur source : nature,
quantité, destination, format, mots, visuels ou remise de preuves. Les ambiguïtés
et termes hors modèle restent visibles, sans fournisseur IA ni offre automatique.
Les décisions et modifications humaines sont conservées ; l’offre complète se
renseigne dans le formulaire habituel. Une clause
non résolue ou non représentable bloque l’application. La qualification exige
toujours motif, confirmation et versions courantes. La voie manuelle reste
accessible. Voir les [états, limites et règles de reprise](technical/preparation-assistance.md).

La revue administrative et ses actions existantes sont accessibles dans
**Publication**, à la section `dossier-review`. Les incidents Stripe sont consultables
dans **Finances**, à la section `dossier-stripe`, puis rejoignent **À traiter**.

**Finances** conserve les montants confirmés et les documents du dossier. Lorsqu’aucun
remboursement n’est demandé, le suivi affiche une indication compacte, sans répéter
le montant ni la référence de la commandite. Un processus existant conserve ses
montants, références Stripe, jalons, notes, erreurs et actions administratives.
Une demande reste distincte du montant effectivement remboursé et confirmé.
Le numéro d’une facture ouvre son inspection dans le dossier; l’accès au registre
complet reste disponible. Les entrées directes `billing` et `refund` partagent les
mêmes sections et la même commande de suivi.

Dans **Publication**, chaque prestation donne accès à son état courant, aux détails
disponibles et au parcours propriétaire : Comptoir collectif, espace de préparation,
Examiner, planification ou preuve. Le suivi distingue les propositions des
livraisons et conserve les erreurs de lecture explicites. **Voir la préparation**,+lorsqu’une activité enregistrée existe, ouvre son tiroir transversal depuis
l’en-tête du suivi. Les engagements restent accessibles dans ce même onglet à
`dossier-agreement` ; leurs formulaires existants conservent versions et confirmations.
L’autorisation reste celle du contenu et de la livraison exacts dans le tiroir
partagé. Le suivi Web et les canaux sociaux gardent leurs décisions indépendantes ;
un canal non promis n’est pas un prérequis de livraison. Les références de preuve
qualifiées dans l’accord rejoignent la prestation exacte dans **Campagnes**.
Les dates et la portée de la réalisation restent distinctes de l'observation
actuelle de visibilité ; une référence déclarée seule ne solde pas une prestation.
Voir le [contrat de visibilité des preuves](technical/admin-campaigns.md).

Dans **Factures**, le badge **Courriel** décrit uniquement le dernier état d'envoi
de la facture ou de l'avoir concerné. Une mise en file, un envoi ou une issue
incertaine ne change ni l'émission du document ni le remboursement confirmé.

Dans **Historique**, **Filtrer l’activité** sélectionne les événements de la fiche
et des médias, de la revue, de la publication, des finances ou du suivi. Les actions
inconnues restent consultables sous **Autres actions**. Le compteur indique le nombre
d’événements affichés parmi les événements disponibles; un résultat vide ne signifie
pas que le dossier est sans historique. **Tous les domaines** rétablit la liste.
Ces filtres locaux conservent l’ordre chronologique et ne modifient aucun fait.
**Consulter le journal** ouvre toujours les actions administratives disponibles,
indépendamment du filtre choisi; le journal d’interventions paginé garde son périmètre
distinct.

## Vérification locale

- `yarn build` puis `node --test tests/admin-sponsorship-details.test.mjs` : validation et autorisations.
- `node --test tests/integration/admin-sponsorship-details.integration.mjs` : PostgreSQL jetable local et API réelle, atomicité, relances, conflits, audit et conservation des données financières. Aucun `.env` ni fournisseur réel utilisé.
- `yarn test:ui:admin` : tests navigateur du formulaire dans `admin-sponsorship-progress.spec.ts`, avec des données synthétiques.
- `node --test tests/sponsorship-interventions.test.mjs tests/integration/sponsorship-interventions.integration.mjs` après compilation : seuils, validation, rôles, API réelle et PostgreSQL jetable ; audit, rejeu concurrent, pagination, confidentialité, prolongation et conservation après remboursement simulé.
- Les cas « intervention journal » de `admin-sponsorship-progress.spec.ts` couvrent saisie, clavier, onglets, erreurs/reprise, droits, pagination, réponses tardives et anglais mobile, avec API interceptées.
