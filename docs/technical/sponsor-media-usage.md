# Autorisations et préférences d’image

Les contrats sont définis dans `packages/funding-core/src/sponsor-media-usage.ts`.
La migration additive `044_sponsor_media_usage.sql` conserve les fichiers
historiques en `needs_confirmation` : ni l’ancien paiement, ni une ancienne
approbation, ni une préférence ne crée une autorisation d’usage.
Les anciennes photos gérées par `sponsor_media_assets` cessent d’être visibles
jusqu’à qualification des droits et nouvelle revue du contenu courant. Les
fichiers restent conservés ; cette interruption ne vaut ni suppression ni accord.

Le suivi privé demande explicitement les canaux, destinations, transformations,
crédit et restrictions avant un téléversement. L’acceptation du commanditaire
enregistre automatiquement la preuve correspondante. Les droits initiaux et leurs
modifications sont conservés dans un historique immuable, avec acteur et requête.
L’administration présente les autorisations en lecture seule, sans saisie de preuve
ni formulaire de règles communes, d’exceptions ou d’héritage.

## Conditions d’utilisation et preuve automatique

Le suivi commanditaire propose les fichiers avant leur envoi. Le commanditaire
voit la liste choisie, le périmètre d’utilisation et les conditions FR/EN de
[`sponsor-media-terms.ts`](../../packages/funding-core/src/sponsor-media-terms.ts).
La proposition courante est Site Web / OpenG7 / adaptation technique; les autres
canaux, destinations, transformations, crédits et restrictions restent modifiables.
La confirmation est décochée à chaque sélection. **Envoyer les fichiers** transmet
uniquement cette sélection et l’acceptation explicite du texte affiché.
Les mêmes conditions accompagnent une nouvelle confirmation de droits dans le suivi.

Le contrat `SponsorMediaTermsAcceptance` contient version, empreinte, langue et
`accepted: true`. Le serveur vérifie ces valeurs contre le texte canonique puis
enregistre le texte accepté, les usages exacts, les empreintes originale et WebP,
le média, la date serveur et le mode d’identification par lien privé. Ce mode
identifie le dossier; il ne constitue pas une identité civile vérifiée.
Droits, preuve, historique, audit et reçu sont enregistrés dans la même transaction.
La modification d’un texte publié exige une nouvelle version et de nouvelles empreintes.
La lecture de la politique publique ne crée aucune acceptation.

Chaque envoi public porte un UUID stable `requestId`. Le même UUID et le même
contenu retrouvent le reçu; un contenu incompatible est refusé. Après une réponse
incertaine, la sélection est suspendue et son reçu est recherché par
`GET /api/sponsorship-followup/media/upload-receipt?requestId=…`, avec le jeton
dans `X-Sponsorship-Followup-Token`. Une nouvelle tentative explicite conserve
UUID, fichier et acceptation. Aucun nouveau fichier n’est envoyé en arrière-plan.
Une sélection suivante demande une nouvelle confirmation et ne reçoit pas
automatiquement les autorisations de l’envoi précédent.

La projection privée `usageAcceptance` expose uniquement la preuve correspondant
au dernier accord direct, aux usages et aux empreintes actuels. Un retrait ou
une nouvelle règle d’usage retire cette indication lorsqu’elle ne correspond plus.
Le texte et la preuve enregistrés restent immuables.

Dans l’administration, **Examiner et accepter** et A ouvrent le panneau
**Examiner le média** pour le fichier courant. **Autorisations** et Y ouvrent le
même résumé : image, état des autorisations, preuve automatique lorsqu’elle existe,
date, usages, description et restrictions. Les choix sont **Approuver**,
**Refuser** et **Annuler**. L’approbation constitue la confirmation humaine du
fichier affiché. L’interface prépare le plan natif, vérifie qu’il correspond
exactement au dossier, média, version, description, droits et preuve affichés,
puis exécute cette seule décision si aucun blocage n’est présent. **Annuler**
ferme le panneau sans préparer ni exécuter de décision. Une réponse incertaine
suspend les écritures et conserve le parcours de réconciliation existant.
L’acceptation d’un média conserve la sélection Web et la publication comme
décisions séparées. L’administrateur ne ressaisit aucune preuve pour cet accord.
La décision conserve automatiquement son acteur, sa date, la version examinée,
son audit et son reçu. **Refuser** utilise le parcours de refus motivé existant ;
le motif et l’explication humaine ne constituent pas une preuve de consentement.

Un fichier sans consentement reçu ou dont les droits sont retirés reste consultable
dans ce panneau. **Approuver** reste indisponible ; **Refuser** reste accessible.
Le panneau ne crée aucun droit, aucune acceptation des conditions et aucune preuve
à la place du commanditaire. Un média existant dont les droits sont déjà confirmés
conserve sa provenance : sa revue ne lui invente pas une acceptation automatique.

### Demander le consentement pour les photos ajoutées par l’administration

**Demander le consentement des photos** ouvre un seul message pour le dossier,
depuis la bibliothèque ou le résumé d’une photo sans autorisation. La préparation
serveur sélectionne toutes les photos courantes en attente de consentement,
non refusées et disposant de leur empreinte originale. Les autorisations retirées,
les logos et les anciens fichiers sans empreinte originale sont exclus.

Le message présente son destinataire, son texte et la liste versionnée des photos
dans son contexte de confirmation. Il utilise l’adresse de paiement qui possède
déjà l’accès au suivi privé ; une adresse de contact différente ne reçoit pas
implicitement cet accès au dossier. Préparer ou annuler ne crée aucun courriel,
jeton ou accord. Après confirmation explicite, un seul courriel contient un seul
lien privé vers l’ensemble des photos, avec `section=media-consent`.

La commande réutilise les [reçus de demande d’information](assistant-information-receipts.md)
avec `purpose: media_consent`, la langue et un snapshot des identifiants et
versions de photos. Le serveur revalide dossier, destinataire et snapshot avant
la mise en file. Courriel, empreinte du jeton, audit et reçu sont transactionnels ;
le worker assure ensuite la livraison. Une réponse incertaine se réconcilie par
lecture du reçu, sans nouvel envoi. Aucune URL privée ne revient dans le reçu ou
l’audit.

Le lien ouvre les autorisations dans le suivi privé après chargement des médias.
Il ne coche aucune case et n’accorde aucun droit. Le commanditaire peut examiner
les photos et confirmer les conditions pour chacune ; ces confirmations restent
distinctes de la revue administrative et de la publication. Le paramètre de section
ne réduit ni n’élargit les droits du lien privé existant. Les fichiers ajoutés
après la demande ne sont pas couverts par le snapshot de cette demande.

La migration additive
[`070_sponsor_media_terms_acceptance.sql`](../../apps/funding-api/migrations/070_sponsor_media_terms_acceptance.sql)
ajoute le registre et son raccordement aux historiques. Appliquer la migration et
les grants correspondants avant de démarrer ensemble l’API et le Web mis à jour.
Les nouveaux champs sont validés strictement; les procédures sont dans le
[runbook des migrations](../operations/database-migrations.md). Cette livraison
ne reconstruit aucun accord ancien et ne réécrit aucun historique.

`POST /api/sponsorship-followup/media/usage` vérifie le jeton, le propriétaire,
la version du fichier, la confirmation et la clé de requête. Son équivalent admin
vérifie aussi les droits et la confirmation de l’identifiant du fichier. Même clé
et contenu : même reçu ; une autre intention avec cette clé est refusée. Une
réponse incertaine conserve la même demande, avec sa clé et son contenu exacts.
Un refus explicite `VERSION_CONFLICT` libère cette commande refusée et recharge
le média ou la préférence ; une nouvelle décision confirmée utilise la version
actuelle et une nouvelle clé. Une erreur réseau, un 5xx, un conflit de reçu ou
un 409 sans code reconnu conserve la commande à vérifier. Le suivi privé et les
contrôles administratifs appliquent cette distinction. Modifier ou retirer les
droits remet le fichier en revue, invalide sa N0 et bloque les prochains envois concernés.
Le retrait ne prétend pas supprimer une publication déjà diffusée ailleurs.

Une restriction libre exige une lecture humaine explicitement confirmée et auditée
avant l’approbation N0 du contenu courant. Le contrôle d’envoi revalide les droits,
le canal, la destination, les transformations, la revue et le crédit exact.

Les demandes de préférence ou de correction utilisent une révision du dossier et
une clé de requête. L’équipe décide avec une explication externe et confirmation.
Une préférence acceptée ne sélectionne pas automatiquement une photo et ne donne
aucun droit supplémentaire. Une photo supprimée ou retirée reste identifiée comme
indisponible ; aucun autre fichier ne la remplace silencieusement.

Les aperçus sociaux utilisent le JPEG final préparé par la même chaîne que l’envoi.
Leur accès admin exige livraison, version et hash ; le client contrôle ces valeurs
et les octets reçus. Un aperçu du fichier source ne permet pas d’approuver l’envoi.
Portrait et montage nécessitent une photo propre à chaque commanditaire, une N0
courante et les transformations explicitement autorisées. Nom et crédit restent
complets ; un dépassement du budget est refusé.

L’annuaire sert des WebP contrôlés. Sa preuve fige le premier fichier de
présentation et le logo qualifié choisis par la projection publique, avec leurs
versions, hashes, usages et crédits. Les crédits exacts accompagnent ces images
dans l’annuaire. Avant une nouvelle transition visible, le service vérifie hors
transaction la présence, le checksum, le format et les dimensions des WebP
privés. Il revalide en transaction la sélection, les versions, les droits et la
revue ; un fichier absent, corrompu ou changé ne crée ni visibilité ni réalisation.
Cette capture conserve `visibility: unknown` : elle ne vérifie aucune réponse
HTTP publique et ne prétend pas que le JPEG social est affiché. Le point d’accès
média refuse aussi les octets dont le checksum diffère du contenu revu.
Les logos legacy hors `sponsor_media_assets` restent des déclarations historiques.
Ils ne servent ni à une nouvelle preuve qualifiée, ni aux nouveaux dérivés, ni à
une nouvelle publication explicite du site sans média propre qualifié. Les
représentations déclaratives de ces logos déjà visibles sont conservées.

Voir les [règles commandites](../development/sponsorship-rules.md) et le
[runbook de publication](../operations/publication-automation.md) pour les
autorisations commerciales, la reprise et les effets externes.

<a id="revue-par-lot-et-héritage"></a>

## Revue des médias et compatibilité des règles

La galerie administrative affiche 8 tuiles par défaut (choix 8, 16 ou 25), des filtres,
la sélection multiple et un inspecteur unique. Les miniatures privées sont chargées à la demande,
avec une concurrence bornée. Le fichier source n'est chargé que pour l'inspection.
Les logos utilisent la même bibliothèque et la même revue; les nouveaux
téléversements administratifs créent des médias du modèle courant. Les quatre
vues et la séparation de l’identité sont décrites dans la
[galerie de préparation](intelligent-media-gallery.md).

Les contrats API des règles au niveau dossier, lot ou média sont conservés pour
les données et intégrations existantes. Le média référence ses règles ; les valeurs
héritées ne sont pas recopiées. Ces contrats exigent toujours une autorisation
réellement reçue, une référence privée de preuve, une portée et une confirmation.
Ils ne sont plus exposés par un éditeur, une action de rattachement ou une
restauration d’héritage dans la galerie administrative. Aucun accord historique
n’est reconstruit et aucun droit n’est étendu aux futurs dépôts par l’interface.
Les changements de droits continuent d’invalider les revues et livraisons
dépendantes, y compris les sources de montages et collections. Le retrait reste
bloquant.

`ready`, `needs_review` et `blocked` préparent la revue. Ce ne sont pas des états
d'autorisation de publication. Sans analyse visuelle, l'absence de signal ne rend
pas une image conforme : la personne peut examiner manuellement le manifeste.
Les restrictions, le texte alternatif, les refus et les recours restent contrôlés.

Le résumé de revue reste limité au média affiché. Un changement de dossier, de
fichier, de version, de révision du dossier ou de preuve invalide le contexte et
empêche une décision sur une autre cible. Les retraits, refus, blocages techniques,
restrictions et recours restent contrôlés ; les conditions de sélection groupée
restent identiques.

Les commandes sur une sélection explicite, limitée à 100 fichiers, préparent un
plan valable dix minutes, avec versions, contenu exact et effets. La confirmation
humaine porte sur ce plan.
Le serveur revalide tous les membres, puis écrit leurs décisions et le reçu dans
une transaction. Un conflit ne laisse pas un sous-ensemble accepté. Les octets,
checksums, formats et dimensions sont contrôlés hors transaction avant préparation
et avant exécution ; les versions sont à nouveau vérifiées dans la transaction.

L'acceptation collective conserve les fichiers hors sélection Web. Une action
distincte sélectionne ou retire un média du site admissible. Elle n'autorise aucun
envoi social. Les sélections historiques restent soumises aux contrôles existants.
Sur un dossier déjà visible, cette sélection peut modifier immédiatement les
images affichées ; le manifeste présente cet effet avant confirmation.

<a id="approbation-du-dossier-entier"></a>

### Tout approuver dans le dossier

**Tout approuver** utilise les contrats dédiés de
[`sponsor-media-approve-all.ts`](../../packages/funding-core/src/sponsor-media-approve-all.ts).
Le serveur inventorie toutes les photos et tous les logos du dossier, sans
consommer une page, un filtre ou la sélection du navigateur, et sans troncature
au plafond de 100 de l’ancien lot. Il fige un plan `kind: approve_all`, ses
versions et les catégories `eligible`, `blocked`, `already_approved` et
`not_processable`, avec nombres et raisons vérifiés.

Le résumé montre les aperçus réellement chargés des admissibles, leur texte
alternatif existant et leurs restrictions intégrales. L’agrandissement reste
dans la même fenêtre. **Confirmer l’approbation** constitue l’unique confirmation
humaine des images, descriptions et restrictions affichées ; aucune case par
fichier n’est requise. **Annuler** ne crée aucune décision. Avec zéro admissible,
l’interface ne propose pas de confirmation. Aucun accord ni texte alternatif
n’est inventé. Consentement absent ou retiré, refus, restriction de modération,
contenu invalide ou indisponible restent bloquants. Un média en attente déjà
sélectionné pour le site est exclu avec
`MEDIA_WEBSITE_SELECTION_REVIEW_REQUIRED` : l’approbation ne doit pas réactiver
son exposition publique.

L’exécution revalide chaque membre du manifeste et conserve un résultat par
média. Un changement de version, d’octets, de droits ou de modération peut laisser
ce fichier inchangé sans annuler les autres approbations. Les fichiers ajoutés
après préparation ne sont pas inclus automatiquement ; les déjà approuvés ne
reçoivent pas de nouvelle décision. La sélection Web, les affectations privées et
les autorisations de publication restent séparées.

Le journal immuable conserve démarrage, résultats individuels et finalisation,
liés au dossier, au plan, à l’UUID confirmé et à l’acteur. Le reçu porte aussi
`kind: approve_all` et distingue `in_progress`, `completed` et `partial`.
`in_progress` conserve le verrou, même avec `pending: 0` lorsque seule la
finalisation reste à reprendre. Un état terminal ne contient aucun média restant.

Après une réponse perdue, le navigateur ne conserve si possible qu’un UUID opaque
dans la session et consulte explicitement le reçu dédié. `found: false` conserve
le verrou. Une reprise n’est proposée qu’après un reçu valide de la même
opération ; après chaque POST incertain, une nouvelle lecture est obligatoire.
**Reprendre les médias restants** ou **Reprendre la finalisation** utilise le même
UUID et le même plan, sans nouvelle approbation des membres déjà traités ni
confirmation humaine supplémentaire. Les lectures et reprises vérifient l’acteur
et les droits ; aucun POST n’est relancé automatiquement.

Seule la première confirmation peut être libérée sur un refus HTTP 409
`MEDIA_PLAN_EXPIRED` ou `MEDIA_NO_ELIGIBLE_ASSETS`, garanti avant démarrage après
vérification du rejeu. Le plan et son UUID sont abandonnés ; préparer à nouveau
exige une nouvelle confirmation. Tout autre conflit, résultat incertain ou
échec d’une reprise conserve le verrou et exige la lecture du reçu.

### Routes administratives

Routes sous `/api/admin/sponsorships/media`, avec aliases sans `/api` :

| Route                                                   | Contrat                                                                                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspace?contributionId=…`                       | Médias, règles effectives, provenance, lots, révision, capacité d'écriture, obligations et associations préparatoires; preuve privée omise pour le lecteur.                             |
| `POST /rules`                                           | UUID, dossier/révision, portée, droits, preuve, IDs couverts et confirmation de la portée.                                                                                              |
| `POST /batches`                                         | UUID, dossier/révision, nom et confirmation du dossier.                                                                                                                                 |
| `POST /batch/plan`                                      | UUID, action, dossier/révision et sélection IDs/versions ; contenu candidat et raisons selon l'action.                                                                                  |
| `POST /batch/execute`                                   | UUID, plan, confirmation du plan et `humanReviewed: true`.                                                                                                                              |
| `POST /approve-all/plan`                                | UUID, dossier et révision attendue ; inventaire complet, catégories et résumé `kind: approve_all`.                                                                                      |
| `POST /approve-all/execute`                             | UUID confirmé, plan, confirmation égale à l’ID du plan et `humanReviewed: true` ; résultat par média, éventuellement partiel.                                                           |
| `GET /approve-all/receipt?contributionId=…&requestId=…` | Reçu du dossier et de l’acteur, `found/result`, `kind: approve_all` ; lecture seule avant toute reprise explicite.                                                                      |
| `GET /receipt?contributionId=…&requestId=…`             | Réconciliation d'une commande appartenant à l'acteur ; aucune relance automatique.                                                                                                      |
| `GET /workspace/history`                                | Historique paginé du dossier ou média, réservé aux opérateurs/propriétaires.                                                                                                            |
| `GET /content/:id?variant=thumbnail`                    | WebP privé borné, contrôlant le checksum de la source.                                                                                                                                  |
| `POST /upload`                                          | Multipart : UUID stable, dossier, type et fichier. Le reçu est atomique avec la création ; le même UUID et payload ne dupliquent pas le média.                                          |
| `POST /export`                                          | Copie privée WebP traitée, opérateur/propriétaire; UUID, dossier, média, version attendue et confirmation égale à l’ID du média. Contrôle du contenu, reçu et audit; aucun lien public. |

Les actions de lot proposées sont accepter, refuser, supprimer, déplacer dans un
lot du même dossier, sélectionner ou retirer du site. Le contrat API conserve
également le rattachement de règles pour compatibilité. Le refus exige une
raison de modération valide et une explication humaine. Chaque action utilise les
mêmes intentions depuis les boutons et le Context Controller. L'assistant reste
en lecture seule.

### Affectations privées et corrections

Les actions `preparation_assign` et `preparation_unassign` utilisent les mêmes
plans, manifestes, confirmations et reçus. La demande précise
`targetObligationId` et `targetObligationVersion`. Le manifeste retourne
`preparationTarget` : destination, format et version de la prestation concernée.
La sélection et la prestation doivent appartenir au même dossier; types, droits,
restrictions, format et version restent contrôlés côté serveur.

`preparation_assign` conserve des références privées aux versions des médias et
de l’obligation. Elle ne modifie ni leur revue, ni `website_selected`, ni les
livraisons sociales ou leur autorisation. `preparation_unassign` retire cette
association sans supprimer le fichier. La projection `preparationAssignments`
signale les références obsolètes; `preparationObligations` décrit les prestations
réelles du dossier. Examiner consomme cette projection et intègre les changements,
y compris les retraits, à la version de préparation. Un retour à une ancienne
sélection ne réactive pas une ancienne approbation.

`request_correction` prépare une décision N1 native par média sélectionné, avec
motif et explication humaine. La confirmation porte sur les contenus exacts.
Cette commande enregistre la demande et son audit avec notification différée :
aucun courriel n’est mis en file. Le choix ne remplace pas les préférences déjà
transmises par le commanditaire et ne modifie pas les fichiers.

Le téléchargement collectif confirme la liste exacte, puis demande une copie
WebP privée par fichier. Chaque export vérifie version et checksum et possède
son reçu audité. Un résultat incertain arrête la suite; le reçu peut être relu
par le mécanisme existant. Ce parcours ne génère pas d’archive ZIP et ne prétend
pas fournir l’original. Le reçu atteste la préparation des octets par le serveur,
pas l’enregistrement final sur l’ordinateur.

### Assistance aux images

Les routes `/analyses` et `/analyses/review` conservent des jobs, propositions et
revues privées. L'analyse locale `local_technical_v1` vérifie réellement le WebP ;
vision et OCR sont `not_configured`. Elle n'invente ni texte descriptif visuel,
ni droits, ni décision N0. Un port d'adaptateur permet une analyse visuelle future,
mais aucun fournisseur externe n'est activé.

L'analyse d'une sélection crée des tâches individuelles avec une concurrence
bornée ; elle ne constitue aucune décision collective de modération. Le suivi
des tâches actives s'arrête quand la zone devient invisible et reste borné.
`GET /analyses/receipt?contributionId=…&requestId=…` réconcilie une demande
incertaine depuis son journal propriétaire, avec contrôle de l'acteur.

Le préremplissage explicitement demandé copie une proposition dans un brouillon
vierge. Une saisie commencée est protégée. Accepter la proposition applique les
métadonnées via le service existant et exige ensuite une nouvelle revue du contenu ;
cela n'accepte pas le média et ne l'expose pas. Résultats, capacités, versions et
incertitudes sont conservés ; un résultat obsolète ne peut être appliqué.

### Adoption et reprise

Appliquer les migrations additives `060`, `061` et `066`, puis rafraîchir les grants du
rôle applicatif avant de démarrer cette API. Les gardes refusent les tables ou droits
manquants. Les migrations ne lancent aucune analyse, suppression ou publication.
La limite des photos est configurable de 1 à 100, avec 100 par défaut ; la taille
par fichier reste bornée par le contrat existant. Un réglage local existant plus bas
reste effectif et n'est pas réécrit.

Les reçus et preuves sont immuables. Après une réponse de mutation perdue, conserver
UUID et payload, lire le reçu et réconcilier avant de continuer. Les suppressions
physiques décidées par lot utilisent des jobs durables, hors transaction, et
reprennent les erreurs. Le remplacement d'un logo en attente nettoie les anciennes
clés privées après commit ; un échec est signalé pour reprise sans annuler l'upload.
La conservation d'une publication déjà diffusée ou d'une copie téléchargée ne peut
être annulée par cette interface.

Pour revenir en arrière, arrêter les traitements et conserver une API sachant lire
les droits hérités ; ne pas supprimer les nouvelles tables ni réactiver une ancienne
autorisation. Préférer une correction en avant. Une restauration de production ou
un nettoyage des copies historiques demande son instruction séparée.

### Responsabilités internes

Les façades de service conservent les contrats existants. Les modules internes
séparent les responsabilités sans créer un second modèle de média :

- [Plans de lot](../../apps/funding-api/src/sponsor-media-workspace/plans.ts) :
  verrouillage, réconciliation et transaction. `plan-manifest.ts` prépare les
  candidats exacts ; `plan-mutations.ts` applique le manifeste déjà revalidé avec
  le même client transactionnel. `cleanup.ts` possède les baux et les appels au
  stockage, après la transaction de suppression.
- [Approbation du dossier](../../apps/funding-api/src/sponsor-media-workspace/approve-all.ts) :
  inventaire complet, attestations, décisions individuelles et journal immuable de
  reprise, indépendants du lot sélectionné atomique.
- [Analyse](../../apps/funding-api/src/sponsor-media-analysis/service.ts) :
  `commands.ts` valide les demandes et possède leur transaction idempotente ;
  `projection.ts` lit les résultats et reçus ; `start.ts` et `review.ts` exécutent
  respectivement la demande d'analyse et la décision humaine dans cette transaction.
- [Téléversement](../../apps/funding-api/src/sponsor-media-upload.service.ts) :
  `sponsor-media-upload/request.ts` valide l'entrée, l'empreinte et le reçu ;
  `storage.ts` possède uniquement les clés de la tentative et le nettoyage des
  fichiers remplacés. La façade décide quand la persistance transfère cette propriété.
- [Espace de revue Web](../../apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.component.ts) :
  composition de la galerie et de l'inspecteur unique. Les contrôleurs locaux
  `MediaReviewAnalysis`, `MediaReviewUpload`, `MediaReviewHistory` et
  `MediaReviewCommands` conservent chacun leur état et leur reprise.
  `MediaReviewApproveAll` possède le plan global, les aperçus et la vérification
  de son reçu ; le composant de commandes conserve les lots sélectionnés et les
  décisions individuelles. Les autorisations sont présentées en lecture seule.

La [recette navigateur](../../tests/playwright/media-review-workspace.ui.ts) conserve
son point d'enregistrement ; ses fixtures interceptées, décisions de revue et
scénarios d'analyse sont séparés dans le répertoire voisin `media-review-workspace/`.

### Fichiers du parcours Tout approuver

- **Contrats partagés** : `packages/funding-core/src/index.ts`, `packages/funding-core/src/sponsor-media-approve-all.ts`.
- **API et permissions** : `apps/funding-api/src/admin-identity/policy.ts`, `apps/funding-api/src/sponsor-media-workspace/approve-all.ts`, `apps/funding-api/src/sponsor-media-workspace/http.ts`, `apps/funding-api/src/sponsor-media-workspace/plan-mutations.ts`, `apps/funding-api/src/sponsor-media-workspace/plans.ts`, `apps/funding-api/src/sponsor-media-workspace/policy.ts`, `apps/funding-api/src/sponsor-media-workspace/service.ts`, `apps/funding-api/src/sponsorship-media-consent.ts`.
- **Interface et transport** : `apps/funding-web/src/app/features/funding/components/media-review/media-review-approve-all.ts`, `apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.component.css`, `apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.component.html`, `apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.component.ts`, `apps/funding-web/src/app/features/funding/services/funding-admin-media-review.client.ts`, `apps/funding-web/src/app/features/funding/services/funding-admin.service.ts`.
- **Traductions** : `apps/funding-web/src/assets/i18n/admin-media-review.en.json`, `apps/funding-web/src/assets/i18n/admin-media-review.fr-CA.json`.
- **Tests** : `tests/integration/sponsor-media-approve-all.integration.mjs`, `tests/integration/sponsor-media-approve-all-auth.integration.mjs`, `tests/media-approve-all-controller.test.mjs`, `tests/playwright/media-review-workspace/approve-all-scenarios.ts`, `tests/playwright/media-review-workspace/decision-scenarios.ts`, `tests/sponsor-media-approve-all.test.mjs`, `tests/sponsor-media-workspace-http.test.mjs`.
- **Documentation** : `docs/technical/intelligent-media-gallery.md`, `docs/technical/sponsor-media-usage.md`.
