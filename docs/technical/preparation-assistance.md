# Assistance locale aux accords historiques

Le propriétaire peut conserver un texte d’accord privé et examiner les clauses
dans le dossier commanditaire. Une nouvelle version de source lance son indexation
locale automatiquement si l’engagement historique reste à qualifier, dans la même
transaction que l’enregistrement et l’audit. Le traitement conserve chaque ligne
non vide avec sa provenance et produit un tableau de détails explicites à examiner.
Il ne lit pas de PDF, ne pratique pas d’OCR et n’appelle aucun fournisseur IA.
Aucun montant ni offre commerciale n’est déduit du texte. Les nouvelles analyses
repèrent certaines quantités, destinations et certains formats explicitement cités,
avec leurs extraits exacts. L’offre reste renseignée et vérifiée par une personne
dans le formulaire de qualification existant. Aucun score de confiance
probabiliste n’est affiché.

## Proposition structurée locale

Les nouveaux jobs utilisent `local_rules_v2`. Chaque ligne conserve sa citation
et ajoute `structured` : version du contrat, nature (`publication`, `proof`,
`other`), quantité, destination, format, faits cités et points à vérifier.
Le vocabulaire FR/EN est borné ; ce n’est pas une lecture sémantique générale.
Une quantité exige un nombre explicite lié à une publication et à un canal unique.
Un nombre de mots, de visuels ou d’heures ne devient pas une quantité de publications.
La destination exige un marqueur explicite comme « sur OpenG7 » ; le format
exige « format » suivi d’une valeur prise en charge. Les négations, conditions,
exemples, instructions et portées ambiguës laissent les valeurs à confirmer.

Articles dédiés, quotas de mots ou de visuels, hashtags et promesses de remise de
preuves restent visibles avec leurs citations mais n’étendent pas le modèle
d’engagement. Les points hors modèle bloquent leur inclusion dans la qualification.
`proposedOffer` reste `null` : les détails du tableau ne remplissent ni n’appliquent
automatiquement l’offre. Les compteurs distinguent clauses de publication,
clauses de preuve et lignes ; ils n’additionnent pas les quantités commerciales.

Les faits ont des offsets UTF-16 dans la source enregistrée. Le serveur vérifie
le résultat v2 contre l’analyse locale attendue avant de le conserver et à sa
lecture, sans dépendre de l’ordre des clés JSONB. Une quantité, citation ou donnée
structurée forgée est rejetée. Les éditeurs de résolution et de justification
du tableau utilisent le même brouillon, les mêmes droits et le même workflow
d’application que le formulaire existant. Sur un espace étroit, chaque ligne
devient une carte dont l’ordre de lecture reste prestation, détails, source, revue.

Les sources et résultats `local_rules_v1` restent inchangés. Les jobs v1 en attente
se terminent avec l’ancien indexeur ; une réanalyse explicitement demandée crée
un nouveau job v2. Consulter un ancien résultat ne l’enrichit pas et ne lance rien.
Toute évolution future du comportement d’analyse doit préserver l’adaptateur
des résultats existants et disposer d’une version distincte.

## Contrat HTTP privé

Les routes acceptent les préfixes `/api/admin` et `/admin`. Session, origine des
mutations et rôle propriétaire sont vérifiés côté API, y compris en lecture.
Le texte source reste privé ; les réponses portent `Cache-Control: no-store`.

| Route sous `/api/admin/preparation-assistance` | Entrées                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                                          | Paramètre unique `contributionId` UUID ; lecture sans lancement de traitement                                                          |
| `GET /summary`                                 | Même paramètre ; résumé scalaire réservé au propriétaire, sans source ni contenu de revue                                              |
| `POST /source`                                 | `contributionId`, `requestId`, `expectedSourceVersion` (null initialement), `title`, `text`                                            |
| `POST /runs`                                   | `contributionId`, `requestId`, `sourceVersion`, `expectedCommitmentVersion`, `rerun`                                                   |
| `POST /runs?view=summary`                      | Même commande et mêmes garde-fous ; réponse compacte pour le pilotage                                                                  |
| `POST /review`                                 | `contributionId`, `requestId`, `runId`, `expectedReviewVersion` (0 initialement), `decision` (`save` ou `reject`), `draft`             |
| `POST /apply`                                  | `contributionId`, `requestId`, `runId`, `sourceVersion`, `expectedCommitmentVersion`, `expectedReviewVersion`, `confirmation`, `draft` |

Les contrats exportés par
[`preparation-assistance.ts`](../../packages/funding-core/src/preparation-assistance.ts)
définissent les champs des réponses et leur validation. Un brouillon contient
l’offre complète ou `null`, la décision sur chaque clause et le motif humain.
Les champs inconnus sont refusés. Les UUID de demande sont liés à l’action,
l’acteur et au contenu : un rejeu identique retrouve l’état persistant ; un
contenu incompatible donne un conflit. Une issue transactionnelle incertaine
est réconciliée par lecture, sans rejouer la commande.

L’enregistrement d’une source strictement identique ne crée aucune génération,
même après un échec ou un rejet. Un changement de titre crée une nouvelle version,
comme un changement de texte. Une source déjà présente avant cette automatisation
ne lance aucun job rétroactif par consultation ou réenregistrement identique :
la commande explicite de lancement reste disponible. Un engagement déjà qualifié
ne reçoit aucun nouveau job automatique. Une erreur d’insertion du job annule
aussi la nouvelle source et son audit.

Une source accepte au plus 16 000 unités UTF-16 et un titre de 200 caractères.
Le traitement accepte au plus 60 lignes non vides ; un dépassement échoue
explicitement sans tronquer le contrat. Les citations utilisent les offsets
UTF-16 du texte exact enregistré, son identifiant et sa version. Chaque ligne
non vide doit apparaître exactement une fois. Le texte, les liens et les
instructions éventuelles dans l’accord ne sont ni exécutés ni suivis.

## États et décision humaine

La source, le résultat original et les révisions humaines sont immuables. Les
jobs PostgreSQL passent par `queued`, `processing`, puis `succeeded`, `failed`
ou `cancelled`, indépendamment de la revue (`saved`, `rejected`, `accepted`) et
de la qualification commerciale. Les phases ne sont pas des pourcentages de
progression. Le worker traite un job à la fois par instance, avec réservation
SQL, bail et jeton de tentative pour refuser un résultat tardif. Les demandes
concurrentes sur les mêmes entrées sont dédupliquées, y compris entre les
adaptateurs v1 et v2 pendant une mise à jour. L’index unique de 059 interdit
deux jobs actifs pour une même source et version d’engagement. Une réanalyse est une
nouvelle génération explicite, sans écrasement du résultat ni du refus précédent.

Une nouvelle source ou une nouvelle version d’engagement rend une ancienne
proposition périmée. Le serveur revérifie les entrées et les citations avant
revue et application. Un succès d’indexation ne satisfait aucun contrôle métier.
Une consultation ne relance jamais un job, notamment après un refus ou un échec.

## Pilotage et commandes contextuelles

La fiche de préparation du dossier et le guide chargent le même résumé compact, uniquement pour
le propriétaire et le contrôle `accepted_offer` applicable. Paiement, consentement
et autres contrôles ne déclenchent pas cette assistance. Le résumé contient les
versions, états, compteurs et capacités ; il exclut titre, texte, extraits, notes,
acteur et offre. Sa révision peut évoluer sans modifier `receipt.version` ni une
approbation de la préparation. Les compteurs de clauses n’augmentent pas le compteur
des contrôles satisfaits.

Le [registre sémantique](../../packages/funding-core/src/preparation-assistance-summary.ts)
projette **Examiner**, **Voir la source** et **Relancer** uniquement dans le Context
Controller du pilotage. Le détail d’assistance conserve les états, explications et
une actualisation de lecture en cas d’erreur. Les deux premières actions rejoignent l’écran existant
et son focus, sans écriture. La relance utilise `/runs?view=summary`, les versions
courantes et un UUID conservé pour une reprise identique. Elle reste désactivée
pendant un job actif. Le dernier résultat réussi reste consultable après rejet,
application ou péremption tant qu’aucun nouveau job ne le remplace dans cette
vue ; cette consultation n’autorise pas son application. Les générations
antérieures restent conservées en base, sans écran d’historique dédié.

Sélection, révision du résumé et version de la fiche forment le contexte des commandes.
Une modification ferme les actions et exige un retour au neutre. Clavier, boutons
et Gamepad utilisent le même dispatcher ; le composant Context Controller conserve
son rôle de présentation. Ces métadonnées n’activent aucun outil de mutation dans
l’assistant administratif en lecture seule.

Le suivi du résumé ne sonde que les jobs actifs, pendant au plus deux minutes,
et conserve un rafraîchissement demandé pendant une commande. Il retire les états
en cache après perte d’accès ou erreur et ignore les réponses d’un ancien dossier
ou d’une ancienne session. Un résultat incertain est relu sans rejouer le POST.
Dans un dossier déjà ouvert, une relance depuis le pilotage provoque aussi une
lecture du formulaire complet. Ses brouillons restent préservés jusqu’à la
résolution explicite des conflits de version.

## Revue humaine et application

L’écran distingue source, revue des prestations et confirmation. Une source déjà
enregistrée se consulte en lecture ; son éditeur s’ouvre explicitement et reste
ouvert en cas de saisie ou conflit. **Documenter cette prestation** ouvre le
formulaire métier depuis une clause représentable : une première ligne vide de
brouillon est ajoutée si nécessaire, sans remplir ni appliquer une offre. Le
retour à la clause conserve les prestations saisies. Le motif global est saisi
une seule fois et partagé avec la qualification ; les justifications de clauses
restent distinctes. La progression compte des résolutions de brouillon, jamais
des engagements appliqués. Les blocages situés près de la confirmation donnent
accès aux clauses ou champs concernés ; les validateurs métier restent requis.

**Retour au Pilotage de la préparation** conserve en mémoire uniquement une route
admin autorisée, le dossier, le contrôle et la position de la vérification. Il relit la
fiche serveur avant de restaurer la sélection et le focus, sans lancer de vérification du lot
ni approuver un contrôle. Ce repère disparaît au rechargement complet ou au
changement d’identité/session. Un retour au guide qui quitterait une saisie non
enregistrée exige de confirmer son abandon. Si le contrôle a disparu, le focus
revient aux actions disponibles ou à l’actualisation en cas d’erreur de lecture.

Chaque clause reste à résoudre : rattachement à un bénéfice de l’offre, attente,
terme non représentable, ou exclusion motivée hors périmètre contractuel. Une
clause en attente ou non représentable bloque l’application. Un signal local
`unsupported_terms` interdit également son rattachement : une exclusion motivée
peut corriger un faux positif, sans escamoter un véritable terme contractuel.
Les articles longs, quotas de mots, hashtags, lots de visuels ou preuves de
livraison peuvent dépasser le contrat commercial actuel. Leur traitement exige
une décision métier adaptée ; l’assistance ne les convertit pas en prestations
différentes. Chaque bénéfice final doit être rattaché à une clause examinée.

L’application exige l’offre complète, le motif, la confirmation du dossier et
les versions courantes. Elle réutilise `qualifySponsorshipCommitment` dans la
même transaction que la revue acceptée et l’audit. Les règles de qualification
historique demeurent applicables, notamment le montant et la devise confirmés,
l’état `needs_confirmation` et l’unicité de qualification. Elle n’approuve ni la
préparation, ni la visibilité, ni une publication, et ne prouve aucune livraison.
La qualification manuelle reste accessible si l’assistance est indisponible.

## Adoption et reprise

Appliquer la migration additive
[`058_preparation_assistance.sql`](../../apps/funding-api/migrations/058_preparation_assistance.sql)
et la migration
[`059_preparation_structured_analysis.sql`](../../apps/funding-api/migrations/059_preparation_structured_analysis.sql)
avant cette API, puis rafraîchir les grants du rôle applicatif avec le runner
mis à jour selon la [procédure de migrations](../operations/database-migrations.md).
059 élargit la liste des adaptateurs autorisés, sans réécrire de source, résultat
ou engagement. Le démarrage vérifie tables, droits et contrainte de compatibilité v2.
Arrêter les anciennes instances de l’API et leurs workers avant de démarrer
cette version : les workers v1 ne savent pas produire une suggestion v2.
Les jobs v1 en attente sont repris par le nouveau worker avec leur ancien indexeur.
Sources, suggestions, revues et reçus de requêtes sont append-only. Seul l’état
opérationnel des jobs est modifiable ; leurs entrées restent immuables.
La migration ne crée aucun texte, job, accord ou envoi existant. La production
reste une opération séparément autorisée.

Le worker reprend les jobs persistants après redémarrage et borne les tentatives.
Un échec terminal conserve les résultats et revues antérieurs en base ;
l’interface expose le dernier job et garde le chemin manuel accessible.
Le navigateur ne sonde que les jobs actifs et protège ses saisies contre les
réponses tardives d’un autre dossier ou d’une ancienne session. L’UUID d’une
mutation incertaine doit être conservé pour une reprise identique.

Les tests de contrat, HTTP, permissions, intégration PostgreSQL et interface
couvrent les garanties livrées. Les fournisseurs externes, l’import documentaire,
la généralisation aux autres contrôles et une manette physique restent des
travaux ou qualifications distincts.
