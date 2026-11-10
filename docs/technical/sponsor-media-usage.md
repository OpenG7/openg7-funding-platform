# Autorisations et préférences d’image

Les contrats sont définis dans `packages/funding-core/src/sponsor-media-usage.ts`.
La migration additive `044_sponsor_media_usage.sql` conserve les fichiers
historiques en `needs_confirmation` : ni l’ancien paiement, ni une ancienne
approbation, ni une préférence ne crée une autorisation d’usage.
Les anciennes photos gérées par `sponsor_media_assets` cessent d’être visibles
jusqu’à qualification des droits et nouvelle revue du contenu courant. Les
fichiers restent conservés ; cette interruption ne vaut ni suppression ni accord.

Le suivi privé demande explicitement les canaux, destinations, transformations,
crédit et restrictions avant un téléversement. Une qualification administrative
exige la référence privée de l’autorisation obtenue. Les droits initiaux et leurs
modifications sont conservés dans un historique immuable, avec acteur et requête.
Le portail, l’annuaire et les courriels ne reçoivent pas cette référence privée.

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

Dans l’administration, A ouvre le panneau **Examiner le média** lorsque cette
preuve est présente : image, autorisation recueillie, date, usages, description et
restrictions. **Approuver et continuer** constitue la confirmation humaine du
fichier affiché. L’interface prépare le plan natif, vérifie qu’il correspond
exactement au dossier, média, version, description, droits et preuve affichés,
puis exécute cette seule décision si aucun blocage n’est présent. **Annuler**
ferme le panneau sans préparer ni exécuter de décision. Une réponse incertaine
suspend les écritures et conserve le parcours de réconciliation existant.
L’acceptation d’un média conserve la sélection Web et la publication comme
décisions séparées. L’administrateur ne ressaisit aucune preuve pour cet accord.

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

## Revue par lot et héritage

La galerie administrative affiche 8 tuiles par défaut (choix 8, 16 ou 25), des filtres,
la sélection multiple et un inspecteur unique. Les miniatures privées sont chargées à la demande,
avec une concurrence bornée. Le fichier source n'est chargé que pour l'inspection.
Les logos utilisent la même bibliothèque et la même revue; les nouveaux
téléversements administratifs créent des médias du modèle courant. Les quatre
vues et la séparation de l’identité sont décrites dans la
[galerie de préparation](intelligent-media-gallery.md).

Les règles sont définies au niveau dossier, lot ou média. Le média référence ses
règles ; les valeurs héritées ne sont pas recopiées. Chaque qualification exige
une référence privée de preuve, une portée et une confirmation. Une liste de
fichiers couverts ne s'étend pas aux futurs ajouts. L'option de portée future exige
une confirmation explicite ; les droits inconnus des médias historiques sont conservés.
Une nouvelle règle ne rattache pas silencieusement les fichiers historiques :
l'action collective de rattachement confirme les médias et leurs versions.

À l’ouverture des autorisations communes ou d’une exception, les canaux et
destinations sont proposés à partir des prestations du dossier qui acceptent des
images (`preparationObligations.acceptsMedia`). Les prestations textuelles,
réalisées ou dispensées ne complètent pas cette proposition. Le préremplissage
s’applique uniquement en l’absence de choix de canal et de destination, avec des
droits absents ou à confirmer. Il conserve les choix existants, les retraits et
les autres métadonnées. Les transformations, la référence de preuve et la
confirmation restent explicites; la proposition n’accorde aucun droit et n’est
pas enregistrée avant validation humaine.

Modifier des droits hérités invalide les revues et livraisons dépendantes, y compris
les sources de montages et collections. Le retrait reste bloquant ; une exception
ne donne de nouveaux droits qu'après qualification explicite avec sa preuve.

`ready`, `needs_review` et `blocked` préparent la revue. Ce ne sont pas des états
d'autorisation de publication. Sans analyse visuelle, l'absence de signal ne rend
pas une image conforme : la personne peut examiner manuellement le manifeste.
Les restrictions, le texte alternatif, les refus et les recours restent contrôlés.

Dans l’inspecteur, **Examiner et accepter** et le bouton contextuel **A** ouvrent
les autorisations du fichier lorsque leur confirmation constitue le seul obstacle.
Le formulaire reste limité à ce média et exige une preuve réelle, le périmètre
d’utilisation et une confirmation explicite. Après une sauvegarde confirmée,
l’interface revient au même fichier et à sa version actuelle, sur le texte alternatif
à compléter ou l’action d’examen. La sauvegarde des droits ne prépare ni n’exécute
automatiquement une acceptation. Les retraits, refus, blocages techniques,
restrictions et recours restent bloquants; les conditions de sélection groupée
restent identiques. Un changement de dossier, de fichier ou de version invalide
le contexte guidé et empêche une reprise sur une autre cible.

Les commandes collectives préparent un plan valable dix minutes, avec sélection,
versions, contenu exact et effets. La confirmation humaine porte sur ce plan.
Le serveur revalide tous les membres, puis écrit leurs décisions et le reçu dans
une transaction. Un conflit ne laisse pas un sous-ensemble accepté. Les octets,
checksums, formats et dimensions sont contrôlés hors transaction avant préparation
et avant exécution ; les versions sont à nouveau vérifiées dans la transaction.

L'acceptation collective conserve les fichiers hors sélection Web. Une action
distincte sélectionne ou retire un média du site admissible. Elle n'autorise aucun
envoi social. Les sélections historiques restent soumises aux contrôles existants.
Sur un dossier déjà visible, cette sélection peut modifier immédiatement les
images affichées ; le manifeste présente cet effet avant confirmation.

### Routes administratives

Routes sous `/api/admin/sponsorships/media`, avec aliases sans `/api` :

| Route                                       | Contrat                                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspace?contributionId=…`           | Médias, règles effectives, provenance, lots, révision, capacité d'écriture, obligations et associations préparatoires; preuve privée omise pour le lecteur.                             |
| `POST /rules`                               | UUID, dossier/révision, portée, droits, preuve, IDs couverts et confirmation de la portée.                                                                                              |
| `POST /batches`                             | UUID, dossier/révision, nom et confirmation du dossier.                                                                                                                                 |
| `POST /batch/plan`                          | UUID, action, dossier/révision et sélection IDs/versions ; contenu candidat et raisons selon l'action.                                                                                  |
| `POST /batch/execute`                       | UUID, plan, confirmation du plan et `humanReviewed: true`.                                                                                                                              |
| `GET /receipt?contributionId=…&requestId=…` | Réconciliation d'une commande appartenant à l'acteur ; aucune relance automatique.                                                                                                      |
| `GET /workspace/history`                    | Historique paginé du dossier ou média, réservé aux opérateurs/propriétaires.                                                                                                            |
| `GET /content/:id?variant=thumbnail`        | WebP privé borné, contrôlant le checksum de la source.                                                                                                                                  |
| `POST /upload`                              | Multipart : UUID stable, dossier, type et fichier. Le reçu est atomique avec la création ; le même UUID et payload ne dupliquent pas le média.                                          |
| `POST /export`                              | Copie privée WebP traitée, opérateur/propriétaire; UUID, dossier, média, version attendue et confirmation égale à l’ID du média. Contrôle du contenu, reçu et audit; aucun lien public. |

Les actions de lot sont accepter, refuser, supprimer, déplacer dans un lot du même
dossier, rattacher des règles, sélectionner ou retirer du site. Le refus exige une
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
  `MediaReviewCommands` conservent chacun leur état et leur reprise ; le composant
  de commandes présente les règles, lots et manifestes à confirmer.

La [recette navigateur](../../tests/playwright/media-review-workspace.ui.ts) conserve
son point d'enregistrement ; ses fixtures interceptées, décisions de revue et
scénarios d'analyse sont séparés dans le répertoire voisin `media-review-workspace/`.
