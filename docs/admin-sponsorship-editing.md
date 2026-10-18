# Modification d’un dossier commanditaire

Depuis `/admin/fundraiser/sponsors`, sélectionner le dossier puis choisir **Modifier le dossier**, sous son en-tête. Le formulaire est accessible depuis chaque onglet, en français et en anglais, sur ordinateur et mobile.

Dans **Identité**, le bouton **Modifier l’identité et les coordonnées** ouvre le même formulaire. Deux états distincts expliquent ce qui manque : les coordonnées requièrent un nom d’entreprise et un courriel de contact ; la transmission nécessite que le commanditaire ait soumis son formulaire depuis son lien privé. Une correction administrative ne crée pas cette transmission. Le propriétaire peut rejoindre le contrôle **Renvoyer le lien de suivi** depuis cette section ; les autres rôles voient qui contacter. Rejoindre ce contrôle n’envoie rien : le renvoi conserve sa confirmation du destinataire.

L’encadré **Coordonnées et transmission : deux actions distinctes** explique la différence entre une saisie administrative (par exemple après un appel) et la transmission datée du commanditaire qui soumet le dossier à la revue. Tant que cette transmission manque, l’onglet Identité et le formulaire de correction précisent que remplir tous les champs ne permet pas de valider cette étape à sa place. La progression et le guide rappellent cette règle. Les libellés ne présument pas que les coordonnées actuellement affichées ont été saisies par un administrateur.

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

Les cinq onglets conservent leurs responsabilités. Le bloc commun **À traiter**
présente la prochaine étape choisie par le serveur, le responsable de la publication
et les prérequis encore ouverts. Les liens ciblent la section concernée, y compris
au clavier sur mobile. Les indicateurs des onglets reprennent les états disponibles;
une lecture indisponible ne conserve pas les indicateurs du dossier précédent.
La préparation, la revue, le paiement et l’autorisation de publication restent
distincts. Le guide conserve les explications détaillées à la demande.

Dans le bon de préparation, sélectionner un contrôle affiche son détail, puis
**Actions** ouvre le controller partagé. L'action proposée rejoint l'écran
propriétaire; relire ensuite le bon pour obtenir la progression serveur. L'accord
sur une préparation admissible conserve sa confirmation explicite et la version
consultée. Voir le [parcours de préparation](operations/admin-pilotage.md#preparation-pilot)
pour la sélection, les commandes et les limites de la simulation Gamepad.

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

**Aperçu** conserve la référence et les avantages enregistrés, avec des raccourcis
vers la fiche et les finances. **Note interne** ouvre l’éditeur de la note de revue
depuis chaque onglet; cette note reste distincte des interventions successives.

**Finances** conserve les montants confirmés et les documents du dossier. Lorsqu’aucun
remboursement n’est demandé, le suivi affiche une indication compacte, sans répéter
le montant ni la référence de la commandite. Un processus existant conserve ses
montants, références Stripe, jalons, notes, erreurs et actions administratives.
Une demande reste distincte du montant effectivement remboursé et confirmé.
Le numéro d’une facture ouvre son inspection dans le dossier; l’accès au registre
complet reste disponible. Les entrées directes `billing` et `refund` partagent les
mêmes sections et la même commande de suivi.

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
