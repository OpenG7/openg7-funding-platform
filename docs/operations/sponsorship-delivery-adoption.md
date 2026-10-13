# Réception locale et adoption des engagements de commandite

Guide SP41–SP44 du chantier local. Il prépare une adoption; il n'autorise aucune
opération de production. La [réception datée du chantier](../development/sponsorship-publication-tasks.md)
reste la source des contrôles effectivement exécutés et des critères ouverts.
Les tests locaux utilisent des dossiers synthétiques, PostgreSQL jetable et des
fournisseurs simulés. La compilation ou une simulation ne qualifie pas un compte
social réel, une lecture distante, SMTP ou une diffusion publique.

## Préconditions et schéma

Identifier la révision API/Web, la cible, le propriétaire et la période examinée.
Conserver les courriels en attente, factures/avoirs, opérations Checkout,
autorisations, audits, objets média et preuves. Pour une cible existante,
préparer sauvegarde, durée/verrous, répétition sur copie isolée et retour avant
toute instruction d'application. Suivre la [procédure de migrations](database-migrations.md).
Les migrations appliquées ne sont ni modifiées ni rejouées.
L'inventaire ci-dessous couvre les ajouts relus; vérifier le répertoire des
migrations et la réception datée pour tout ajout ultérieur du chantier.

| Ajout                                                                                       | Rôle dans l'adoption                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [041](../../apps/funding-api/migrations/041_sponsorship_commitments.sql)                    | Offres capturées, provenance, obligations et changements immuables; anciens accords inconnus conservés à qualifier.                                                            |
| [042](../../apps/funding-api/migrations/042_publication_account_reservations.sql)           | Bail et réservations du compte effectif, séparation mock/live et quarantaine.                                                                                                  |
| [043](../../apps/funding-api/migrations/043_sponsorship_fulfilment_evidence.sql)            | Passage exact réservé, preuve qualifiée et observations de visibilité distinctes.                                                                                              |
| [044](../../apps/funding-api/migrations/044_sponsor_media_usage.sql)                        | Usages/préférences et preuves d'utilisation des médias.                                                                                                                        |
| [045](../../apps/funding-api/migrations/045_sponsorship_publication_formats.sql)            | Format social enregistré; absence historique conservée.                                                                                                                        |
| [046](../../apps/funding-api/migrations/046_obligation_reservation_release.sql)             | Libération par UPDATE, sans élargir les droits DELETE du rôle API.                                                                                                             |
| [047](../../apps/funding-api/migrations/047_publication_visual_sources.sql)                 | Formats visuels et sélection versionnée de leurs sources.                                                                                                                      |
| [048](../../apps/funding-api/migrations/048_qualified_derived_media_snapshot.sql)           | Snapshot qualifié d'un dérivé unique, sans détourner le couplage d'un média source.                                                                                            |
| [049](../../apps/funding-api/migrations/049_publication_draft_passages.sql)                 | Préparation locale du passage suivant sans écraser un brouillon/lot publié; nouveau rattachement inclus dans la revue éditoriale.                                              |
| [050](../../apps/funding-api/migrations/050_private_visual_moderation_projection.sql)       | Projection actuelle des faits visuels sans clés d'objets privées; anciens snapshots immuables, nouvelle revue si leur empreinte est devenue obsolète.                          |
| [051](../../apps/funding-api/migrations/051_sponsorship_obligation_timing.sql)              | Termes temporels par obligation, origine documentaire explicite, observations du site OpenG7 et attestations humaines de durée; aucune date historique ou continuité inventée. |
| [052](../../apps/funding-api/migrations/052_sponsorship_historical_evidence_reviews.sql)    | Examens historiques immuables, versionnés et audités; aucune modification des preuves ni du solde commercial existant.                                                         |
| [053](../../apps/funding-api/migrations/053_publication_provider_media_evidence.sql)        | Identités média LinkedIn immuables et collections qualifiées localement ; anciennes preuves conservées sans URN inféré.                                                        |
| [054](../../apps/funding-api/migrations/054_sponsorship_public_visibility_observations.sql) | Observations publiques append-only et curseur opérationnel ; aucune période commencée ou réalisée par la migration.                                                            |

Déployer des versions compatibles des contrats, API et Web seulement après la
réception correspondante. Les migrations de modération 034–040 restent des
prérequis; le maintien historique d'une visibilité ne fournit jamais une N0 ni
une autorisation de nouvel envoi. Garder feeds en pause et workers/SMTP désactivés
pendant l'examen et la coexistence. Vérifier aussi les droits du rôle API restreint:
aucune propriété des tables, aucune réécriture des preuves/offres/audits et aucune
suppression métier ne sont nécessaires à cette adoption.

La charte publique reste inactive dans cette préparation. La qualification d'un
accord, un test, une migration ou le présent guide ne remplace aucune validation
éditoriale/juridique et n'active pas la charte. Consulter la
[procédure de modération et de charte](sponsorship-moderation.md).

## Classement et qualification individuelle

L'owner ouvre l'aperçu `/api/admin/sponsorship-commitments/adoption-preview` ou
le panneau **Engagements enregistrés** de l'onglet Publication du dossier.
Les pages de l'interface contiennent 25 ou 50 dossiers; l'API permet aussi 100.
Parcourir jusqu'à `nextCursor = null`; une seule page n'est pas un total global.
L'aperçu est en lecture seule, sans contacts, corps privés ni référence interne
de preuve et sans adoption en masse.

| Classe                 | Traitement                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted_snapshot`    | Conserver l'offre capturée et acceptée; comparer les obligations et preuves exactes, sans consulter le barème courant pour réécrire l'accord.     |
| `qualified_historical` | Conserver la provenance historique, la preuve de qualification et les changements; aucune acceptation Checkout passée n'est inventée.             |
| `legacy_declarations`  | Examiner les déclarations de brouillons/jobs/livraisons publiés; elles ne soldent pas une obligation et ne deviennent pas une preuve fournisseur. |
| `unqualified`          | Vérifier l'accord original et ses preuves; ne pas créer d'avantages à partir du seul montant payé.                                                |

Une session préparée avant 041 sans snapshot peut encore confirmer un paiement.
Ce fait financier est conservé; son accord reste `needs_confirmation`. Les
reprises Checkout gardent la clé et le payload d'origine, même après changement
de barème. Voir [Checkout](../technical/checkout.md).

Pour qualifier, l'owner saisit les termes établis par l'accord : canal,
destination, quantité, éléments requis et délai/durée seulement s'ils sont connus.
Les lignes partent vides; un délai/durée vide signifie `null`, pas une promesse
par défaut. Une durée fixe est prise en charge seulement pour le site OpenG7;
les réseaux sociaux et OpenG20 sont refusés à la qualification pour ce terme.
Le délai enregistré reste sans échéance tant que le propriétaire n'a pas
établi son origine UTC avec une référence documentaire, une raison, la version
du calendrier et une confirmation. Ni le paiement ni la date de qualification
ne prouvent cette origine. Chaque passage reçoit son origine contractuelle
documentée + délai, sans délai supplémentaire automatique par ordinal. Pour
un accord à origine commune, reporter la même origine démontrée dans chaque
obligation. Voir les
[échéances et durées](../technical/sponsorship-obligation-timing.md).
Montant en unités mineures et devise viennent du fait confirmé et
restent non modifiables. Le serveur exige version, UUID de confirmation, raison
et référence de preuve. Une devise non prise en charge reste à traiter explicitement,
sans lui appliquer les avantages CAD. Les [contrats d'engagements](../technical/sponsorship-commitments.md)
décrivent les réponses, conflits et limites.

Tout changement de destination/format ou dispense est une action distincte avec
confirmation, version et raison. L'offre originale reste immuable; l'obligation
évolue et les autorisations concernées sont révoquées. Une obligation réalisée
ou déjà dispensée n'est pas réécrite. Refus, remboursement ou retrait du
consentement bloquent le travail restant sans le solder. Aucune qualification
commerciale ne fournit une N0, une visibilité ou une approbation de livraison.

Un résultat incertain conserve la requête exacte; ne pas fabriquer un nouvel UUID
pour contourner la reprise. L'interface conserve ce payload en mémoire et bloque
un nouvel ordre jusqu'à sa reprise exacte. Elle ne stocke pas ce brouillon privé
dans le navigateur. Après fermeture/rechargement, relire l'état serveur et
l'historique avant toute nouvelle décision. Aucun rejeu aveugle du fournisseur
ou du courriel n'appartient à l'adoption.

## Examen des preuves historiques et durées

Depuis le panneau d'administration des commanditaires, l'owner peut inventorier
les preuves historiques, leurs exigences enregistrées et les éléments observables
dans leurs snapshots immuables. Les filtres distinguent durée non vérifiée,
élément requis manquant, snapshot incomplet et absence d'écart détecté. Les
compteurs portent sur tout l'inventaire à la borne datée `asOf`, indépendamment
des pages de 25, 50 ou 100 et du dossier sélectionné. La pagination conserve cette
borne et ses filtres; elle ne fige pas les examens ajoutés entre deux lectures.
Le [contrat d'examen historique](../technical/sponsorship-historical-audit.md)
précise les accès, résultats et limites des constats.

Un écart technique est un signal d'examen, pas une conclusion juridique ni une
nouvelle preuve. L'owner peut enregistrer « confirmé », « suivi nécessaire » ou
« indéterminé », avec raison privée, version d'examen, UUID et confirmation de
la preuve exacte. Ce reçu ne supprime ni preuve, ni attestation, ni offre; il ne
réouvre ni ne solde une obligation et n'envoie aucun courriel. Une correction
commerciale ou financière éventuelle exige sa propre décision et ses garde-fous.

Pour une durée du site OpenG7 encore ouverte, afficher la fiche exige les droits,
la N0 et les fichiers physiques courants. L'affichage enregistre une observation
privée datée et laisse le solde ouvert. Après la durée minimale, l'owner examine
des pièces privées de continuité, sélectionne l'observation de départ et confirme
explicitement la continuité avec raison et référence de preuve. L'API revalide
les sources, droits, médias et durée avant l'attestation, le solde et la mise en
file de leur notification atomiques. Un masquage, un changement de contenu ou
de droits invalide le départ précédent; l'observation historique reste conservée.
Deux observations ne démontrent pas à elles seules une disponibilité continue.

## Médias, visibilité et passages suivants

La conservation des fichiers et des faits historiques ne garantit pas leur
affichage. 044 place les anciens médias gérés en `needs_confirmation` et ajoute
les droits au contenu modéré : une ancienne N0 ou observation de visibilité ne
qualifie pas ce nouvel état. Galerie et endpoint public exigent désormais les
droits confirmés pour `website/openg7`; une photo historique peut disparaître ou
répondre 404. Le profil peut aussi sortir de l'annuaire s'il ne possède plus de
photo de présentation admissible. Mesurer ce changement sur la copie existante
avant adoption et préparer une qualification individuelle, puis une nouvelle
revue. Ne pas recopier des autorisations supposées ni rétablir une exposition par
SQL. Les logos déclaratifs hors `sponsor_media_assets` restent une voie historique
distincte, sans preuve qualifiée ni réutilisation dans un nouveau dérivé.

Pour portrait/montage, vérifier une photo propre à chaque dossier source du lot,
sa version, sa N0 et les droits du canal/destination. L'autorisation technique
seule ne permet ni portrait ni montage : les transformations correspondantes,
les restrictions relues et le crédit exact doivent être établis. Une préférence
acceptée ne remplace pas ces droits; une préférence en attente ou devenue
indisponible exige traitement humain. L'aperçu de réception est le JPEG final
versionné et vérifié, pas une miniature du fichier source. Voir les
[droits média](../technical/sponsor-media-usage.md).

049 conserve les brouillons et lots déjà publiés. Le passage suivant rattache
un nouveau brouillon à une obligation propre encore ouverte; ce rattachement
fait partie du contenu relu. La quantité enregistrée ne réautorise donc pas le
brouillon précédent. Format, sources, photos ou rattachements modifiés exigent
une revue courante avant approbation de la livraison. Un portrait exige un seul
dossier; l'approbation et l'envoi d'un montage exigent une sélection complète,
sans remplacement silencieux de la photo manquante. La réception de ces passages
reste séparée de celle des offres et de la modération.

## Mesures internes en lecture seule

Effectuer les lectures sur une connexion autorisée à la cible examinée, dans une
transaction de lecture stable. Les exemples agrègent le périmètre complet sans
LIMIT et ne sélectionnent aucun contact, message, clé d'objet ou token. Les
états stockés ne constituent pas un calcul d'admissibilité actuelle : utiliser
la progression du dossier et les gardes serveur pour les blocages de paiement,
consentement, média, modération ou approbation.

`GET /api/admin/publication-automation` expose aussi `reliability.scope=global`
dans le même snapshot de lecture que le state. Cette projection calcule toute
la file indépendamment des filtres dossier/livraison, des 200 lignes affichées
et du scan de préparation. Elle indique obligations ouvertes/non datées/âge,
réalisations avec preuve cohérente, saturation effective, conflits du compte,
incertitudes et écarts preuve/réservations/baux. Les corrélations affichées sont
bornées à 50 codes avec UUID internes; `incidentTotal` porte sur tous les écarts,
jamais sur cet extrait. Le panneau Fiabilité FR/EN garde cette portée explicite.
Ces lectures ne produisent ni audit, notification, adoption ou correction.

Le panneau permet également de parcourir les incidents par code et type, par
pages de 50, et d'ouvrir les dossiers, livraisons, lots ou créneaux existants.
Chaque incident explique l'action attendue; un lien n'exécute aucune réparation,
reprise ou approbation. L'échéance dépassée et l'origine encore inconnue sont
signalées séparément. Le curseur conserve filtres et empreinte de l'ensemble
des incidents; si cet ensemble change, `RELIABILITY_SNAPSHOT_CHANGED` impose
un rafraîchissement explicite. Voir la
[référence de fiabilité](../technical/publication-reliability.md).

Le détecteur complet alimente les épisodes d'alerte opérationnels existants,
sans limiter leur nombre aux corrélations visibles : répétition d'un même
incident actif sans doublon, résolution puis nouvel épisode s'il réapparaît.
Le raccord ne configure ni n'active un webhook. La clé interne contient type et
UUID; les corps externes conservent le contrat minimal des alertes existantes.
Un ancien envoi sans réservation ou une réserve retenue après changement de
termes appelle une investigation; ce diagnostic ne permet pas de supprimer la
preuve ou libérer un compte incertain.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT m.provenance, m.state, count(*) AS dossiers,
       min(c.paid_at) FILTER (WHERE m.state = 'needs_confirmation') AS oldest_payment_to_qualify
FROM sponsorship_commitments m
JOIN fund_contributions c ON c.id = m.contribution_id
WHERE c.status IN ('paid', 'refunded', 'disputed')
GROUP BY m.provenance, m.state;

SELECT channel, target, publication_format, state, count(*) AS obligations,
       min(created_at) FILTER (WHERE state IN ('pending', 'blocked')) AS oldest_open
FROM sponsorship_obligations
GROUP BY channel, target, publication_format, state;

SELECT channel, feed_target, status, count(*) AS unassigned_drafts,
       min(created_at) AS oldest_unassigned_draft
FROM sponsor_publication_drafts
WHERE batch_id IS NULL AND slot_id IS NULL AND status IN ('draft', 'approved')
GROUP BY channel, feed_target, status;

WITH occupancy AS (
  SELECT b.id, b.status, b.capacity, b.publication_format, count(d.id) AS used
  FROM sponsor_publication_batches b
  LEFT JOIN sponsor_publication_drafts d ON d.batch_id = b.id
  GROUP BY b.id, b.status, b.capacity, b.publication_format
)
SELECT status, capacity, publication_format, count(*) AS batches,
       count(*) FILTER (WHERE used > capacity) AS over_capacity,
       count(*) FILTER (WHERE publication_format = 'individual_portrait' AND used > 1) AS oversized_portraits
FROM occupancy GROUP BY status, capacity, publication_format;

WITH occupancy AS (
  SELECT s.id, s.status, s.capacity, count(DISTINCT d.id) AS used
  FROM publication_slots s
  LEFT JOIN sponsor_publication_batches b ON b.slot_id = s.id
  LEFT JOIN sponsor_publication_drafts d ON d.slot_id = s.id OR d.batch_id = b.id
  GROUP BY s.id, s.status, s.capacity
)
SELECT status, capacity, count(*) AS slots,
       count(*) FILTER (WHERE used > capacity) AS over_capacity
FROM occupancy GROUP BY status, capacity;

SELECT count(*) AS open_without_authorized_date
FROM sponsorship_obligations o
WHERE o.state IN ('pending', 'blocked') AND o.channel <> 'website'
  AND NOT EXISTS (
    SELECT 1 FROM sponsorship_obligation_reservations r
    JOIN publication_deliveries d ON d.id = r.delivery_id
    WHERE r.obligation_id = o.id AND r.obligation_version = o.version
      AND r.released_at IS NULL AND d.status = 'approved'
      AND d.approved_at IS NOT NULL AND d.mode = 'live'
  );

SELECT mode, status, count(*) AS reservations
FROM publication_account_reservations GROUP BY mode, status;
SELECT mode, count(*) AS accounts_with_uncertain_result,
       min(updated_at) AS oldest_uncertain_account_state
FROM publication_account_leases WHERE uncertain GROUP BY mode;
SELECT d.mode, count(*) AS unresolved_deliveries_without_account_lease
FROM publication_deliveries d
WHERE d.status IN ('publishing', 'uncertain') AND NOT EXISTS (
  SELECT 1 FROM publication_account_leases a WHERE a.delivery_id = d.id
)
GROUP BY d.mode;

SELECT count(*) AS fulfilled_with_inconsistent_evidence
FROM sponsorship_obligations o
LEFT JOIN sponsorship_fulfilment_evidence e ON e.id = o.fulfilment_evidence_id
WHERE o.state = 'fulfilled' AND (e.id IS NULL OR e.obligation_id <> o.id
  OR e.contribution_id <> o.contribution_id OR e.channel <> o.channel OR e.target <> o.target
  OR e.obligation_version + 1 <> o.version);

SELECT status, count(*) AS notices
FROM email_messages WHERE template_key = 'sponsorship_obligation'
GROUP BY status;
SELECT status, count(*) AS inherited_rejection_notices_to_review
FROM email_messages WHERE template_key = 'sponsorship_rejection'
  AND status IN ('queued', 'failed', 'sending', 'uncertain') GROUP BY status;

SELECT version, public_active FROM moderation_policies ORDER BY version;
COMMIT;
```

Une incohérence de preuve doit être examinée, jamais corrigée par effacement.
Une autorisation en mode mock n'est pas une date de diffusion réelle. Un dossier
sans accord qualifié n'a pas d'obligation inventée à compter. Évaluer les plans
et coûts de lecture sur la copie synthétique représentative avant un grand
inventaire; les petites réceptions locales ne prouvent pas le coût d'un arriéré
de production. Les alertes/audits existants donnent corrélation, répétitions,
conflits et âge; conserver les causes sûres sans publier les notes internes.
Le contrôle des conflits examine les réservations actives d'un même compte :
son coût peut croître avec le nombre de paires. Le
[profil de performance sur un arriéré synthétique](../development/publication-performance.md)
mesure les vraies lectures et préparations, leurs transactions et plans PostgreSQL.
Les latences locales ne constituent pas un budget de production; répéter les
mesures sur le volume, la répartition des comptes et le matériel représentatifs.
Avant toute activation SMTP, examiner aussi la file héritée de refus selon le
runbook de modération : un ancien payload peut contenir une note interne.
L'inventaire n'en lit pas le corps et ne purge ni ne réécrit automatiquement la file.

L'ordre de préparation porte sur les brouillons admissibles de même format,
par `created_at,id`; le scan est borné à 400 et ignore les lignes verrouillées.
Ce n'est pas une garantie FIFO globale sous concurrence. Un premier passage
commence au plus tôt à l'établissement de ses faits; le passage suivant reçoit
une nouvelle ancienneté. Une source individuellement trop longue est diagnostiquée
par empreinte, puis réexaminée après correction; elle n'est pas tronquée. Le
débordement collectif reporte les candidats suivants en conservant leur ordre.
Les mesures ci-dessus montrent l'arriéré stocké et les capacités numériques,
pas l'admissibilité ni le budget du texte final. Vérifier aussi ce budget, les
formats compatibles et le partage du créneau avec les gardes API.

Une incertitude conserve le bail/réservation du compte effectif, y compris entre
deux feeds qui utilisent le même compte. Expiration, pause, changement de termes
ou retrait des droits ne prouvent pas l'absence d'envoi et ne libèrent pas ce
hold automatiquement. La séparation mock/live et l'espacement technique actuel
ne constituent ni quota fournisseur ni délai commercial promis. Réconcilier le
résultat exact avant une reprise; les comptes sans résultat certain restent
dans le parcours d'investigation.

## Préparer les décisions opérationnelles

La livraison du code ne remplit pas les pièces d'un accord historique et ne
choisit pas un délai commercial. Préparer un dossier de décision distinct pour
chaque campagne ; ne pas modifier les snapshots d'offres déjà acceptées.

<!-- prettier-ignore -->
| Décision | Entrées à réunir | Résultat attendu avant exécution |
| --- | --- | --- |
| Adoption historique | Périmètre de dossiers, pagination terminée, référence des pièces, termes réellement convenus, responsable et sauvegarde vérifiée. | Inventaire classé : accord démontré, déclaration à confirmer, exception. Chaque qualification conserve son UUID, version, confirmation et preuve ; les ambiguïtés restent `needs_confirmation`. |
| Délai des nouvelles offres | Canal, quantité, point de départ documenté, délai choisi, pauses applicables, formats disponibles et texte présenté avant Checkout. | Nouvelle version d'offre à recevoir séparément ; une valeur vide reste `null`. Aucun départ ou délai supplémentaire n'est déduit du paiement ou de l'ordinal. |
| Qualification des comptes | Compte effectif, organisation/page et rôle, droits de lecture et écriture, expiration, version fournisseur, limites et format demandé. | Reçu daté distinguant documentation, appels synthétiques et qualification réelle ; un accès de lecture absent conserve la réconciliation inconnue. |
| Activation | Révision et migrations exactes, cible, comptes qualifiés, petit lot autorisé, pauses, autorisations finales sélectionnées, file SMTP, responsable et critères d'arrêt. | Plan borné avec audit, idempotence, reprise et retour aux pauses. La décision d'activer reste distincte de la préparation. |

Les droits et secrets sont vérifiés sans les copier dans le dossier, Git ou les
sorties. Le registre peut conserver une référence privée autorisée, jamais les
pièces personnelles inutiles. En cas de résultat incertain, relire le serveur et
réconcilier avant de reprendre la même opération ; un nouvel UUID n'est pas une
solution à une incertitude.

## Réception avant mise en service

Répéter sur base neuve puis sur copie synthétique existante : paiement confirmé
et rejeux désordonnés, snapshot antérieur au changement de barème, historique
inconnu, qualification interrompue/reprise, rôle owner refusé aux autres rôles,
ajustements concurrents et conservation des anciens documents/proofs. Vérifier
la restitution privée après correction et les notifications de termes/date/solde
dans leur transaction, avec destinataire confirmé et dédoublage exact. Ne lancer
aucun SMTP réel pour cette réception.

La recette transversale des huit dossiers doit distinguer les tailles 5+3 et
3+3+2, les huit portraits individuels et un montage lisible. Inclure une première
source trop longue, correction et nouvelle N0, compte partagé, concurrence,
capacité/régulation, pause, heure exacte, refus humain, consentement retiré,
résultat incertain, accès croisés et périmètre des photos. Préparation, aperçu,
approbation et résultat fournisseur sont observés séparément. Les guides
[publication](publication-automation.md), [preuves](../technical/sponsorship-fulfilment.md)
et [formats](../technical/publication-formats.md) portent leurs contrats.

Les collections LinkedIn acceptent de 2 à 10 photos. La
[réception de dix grandes photos](../development/publication-performance.md#dix-grandes-photos)
mesure l'ingestion, le rendu et les appels d'aperçu concurrents côté API sur
stockage local. Un contrôle navigateur distinct vérifie le décodage et l'affichage
des dix JPEG en français sur ordinateur et en anglais sur mobile. Qualifier
séparément les performances navigateur, le stockage distant et les comptes réels
avant de fixer leurs limites opérationnelles. Les collections Facebook restent
indisponibles faute de qualification. Un JPEG composite ne remplace pas un album. LinkedIn compare
les URNs des images remis au fournisseur, avec le compte et le contenu exacts.
Les anciennes preuves sans URN et les photos Facebook sans identité distante
qualifiée restent dans l'investigation. Accès refusé, 404 ou timeout donnent
`unknown` et ne prouvent pas une suppression ni le droit de renvoyer. L'empreinte
de l'aperçu local ne qualifie pas les permissions d'un compte fournisseur réel.

Avant une éventuelle activation réelle, préparer séparément la cible, comptes,
droits lecture/écriture, modes, pauses, limites de volume, sélection exacte des
autorisations, queue SMTP, critères d'arrêt et responsable de reprise. Prévoir
le retour aux pauses en conservant les preuves, réservations incertaines et
migrations additives. Une ancienne API dépourvue de ces gardes ne constitue pas
un rollback sûr. Activation fournisseur, charte ou production exige sa propre
instruction et sa qualification; aucune n'est effectuée par ce guide.

Clôturer seulement les garanties liées à une révision et à des résultats
effectivement exécutés : compilation runtime, build Angular, Node, PostgreSQL,
UI FR/EN/mobile/clavier et recette transversale selon le diff. Vérifier format,
lint, standards/liens et `git diff --check`. Consigner échecs, omissions, reprises
et limites externes dans la réception; ne pas les convertir en réussite globale.
