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

La galerie administrative affiche 25 tuiles par page, des filtres, la sélection
multiple et un inspecteur unique. Les miniatures privées sont chargées à la demande,
avec une concurrence bornée. Le fichier source n'est chargé que pour l'inspection.
Les anciens champs de logo restent consultables dans une section de compatibilité ;
les nouveaux téléversements administratifs créent des médias du modèle courant.

Les règles sont définies au niveau dossier, lot ou média. Le média référence ses
règles ; les valeurs héritées ne sont pas recopiées. Chaque qualification exige
une référence privée de preuve, une portée et une confirmation. Une liste de
fichiers couverts ne s'étend pas aux futurs ajouts. L'option de portée future exige
une confirmation explicite ; les droits inconnus des médias historiques sont conservés.
Une nouvelle règle ne rattache pas silencieusement les fichiers historiques :
l'action collective de rattachement confirme les médias et leurs versions.

Modifier des droits hérités invalide les revues et livraisons dépendantes, y compris
les sources de montages et collections. Le retrait reste bloquant ; une exception
ne donne de nouveaux droits qu'après qualification explicite avec sa preuve.

`ready`, `needs_review` et `blocked` préparent la revue. Ce ne sont pas des états
d'autorisation de publication. Sans analyse visuelle, l'absence de signal ne rend
pas une image conforme : la personne peut examiner manuellement le manifeste.
Les restrictions, le texte alternatif, les refus et les recours restent contrôlés.

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

| Route                                       | Contrat                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspace?contributionId=…`           | Médias, règles effectives, provenance, lots, révision et capacité d'écriture ; preuve privée omise pour le lecteur.                            |
| `POST /rules`                               | UUID, dossier/révision, portée, droits, preuve, IDs couverts et confirmation de la portée.                                                     |
| `POST /batches`                             | UUID, dossier/révision, nom et confirmation du dossier.                                                                                        |
| `POST /batch/plan`                          | UUID, action, dossier/révision et sélection IDs/versions ; contenu candidat et raisons selon l'action.                                         |
| `POST /batch/execute`                       | UUID, plan, confirmation du plan et `humanReviewed: true`.                                                                                     |
| `GET /receipt?contributionId=…&requestId=…` | Réconciliation d'une commande appartenant à l'acteur ; aucune relance automatique.                                                             |
| `GET /workspace/history`                    | Historique paginé du dossier ou média, réservé aux opérateurs/propriétaires.                                                                   |
| `GET /content/:id?variant=thumbnail`        | WebP privé borné, contrôlant le checksum de la source.                                                                                         |
| `POST /upload`                              | Multipart : UUID stable, dossier, type et fichier. Le reçu est atomique avec la création ; le même UUID et payload ne dupliquent pas le média. |

Les actions de lot sont accepter, refuser, supprimer, déplacer dans un lot du même
dossier, rattacher des règles, sélectionner ou retirer du site. Le refus exige une
raison de modération valide et une explication humaine. Chaque action utilise les
mêmes intentions depuis les boutons et le Context Controller. L'assistant reste
en lecture seule.

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

Appliquer les migrations additives `060` et `061`, puis rafraîchir les grants du
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
