# Audit des preuves historiques de commandite

L'inventaire examine les obligations déjà `fulfilled` et leur preuve qualifiée
immuable. Il compare les éléments enregistrés avec le bénéfice de l'offre acceptée
ou qualifiée, sans appliquer le barème actuel. Une conclusion administrative
conserve l'historique; elle ne corrige aucun solde commercial, fait financier,
autorisation éditoriale ou état de visibilité.

## Lecture réservée au propriétaire

`GET /api/admin/sponsorship-commitments/historical-audit` et son alias sans `/api`
exigent une session administrative valide et le rôle propriétaire. Lecteurs et
opérateurs reçoivent `403 COMMITMENT_OWNER_REQUIRED` avant toute lecture de base.
Toutes les réponses portent `Cache-Control: no-store`.

Les paramètres acceptés sont `pageSize` (`25`, `50` ou `100`, défaut `25`),
`contributionId` (UUID), `finding` et `cursor`. Un paramètre inconnu, répété ou
invalide reçoit `400 HISTORICAL_AUDIT_INVALID`. Les filtres d'observation sont :

| Filtre                     | Observation                                                 |
| -------------------------- | ----------------------------------------------------------- |
| `duration_unverified`      | Durée promise sans attestation de continuité correspondante |
| `required_element_missing` | Élément requis absent d'un affichage enregistré connu       |
| `snapshot_incomplete`      | Informations historiques insuffisantes pour conclure        |
| `no_issue_detected`        | Aucun problème détecté parmi les faits enregistrés          |

Un même élément peut porter plusieurs observations. `requirements` distingue
`satisfied`, `missing` et `unknown`. Une collection d'images connue peut établir
l'absence d'un logo requis. Des métadonnées insuffisantes, une identité absente du
snapshot ou une image sociale dont le propriétaire historique est indéterminé
restent `unknown`. Pour une publication sociale textuelle, la présence d'une photo
approuvée préalable ne se déduit pas du seul texte effectivement envoyé.

L'audit utilise les sources, versions, empreintes et droits conservés **au moment
de la livraison**, pour son canal et sa destination exacts. Il ne remplace pas ces
faits par le dossier ou les droits actuels. Un retrait ultérieur des droits ou un
masquage ne devient donc pas une ancienne preuve invalide. Les fichiers historiques
ne sont pas relus sur un fournisseur externe; une observation `satisfied` décrit
les faits enregistrés, sans garantir leur visibilité actuelle.

Une durée est vérifiée seulement par l'attestation de la
[migration 051](../../apps/funding-api/migrations/051_sponsorship_obligation_timing.sql)
liée à cette obligation et à cette preuve exactes. Un affichage ponctuel ne prouve
aucune durée. Le [contrat temporel](sponsorship-obligation-timing.md) décrit les
observations, bornes et attestations humaines nécessaires.

## Pagination et données retournées

Chaque page contient au plus `pageSize` éléments, ordonnés par `recorded_at` puis
identifiant de preuve. Le curseur opaque conserve ces deux bornes, la date `asOf`,
le filtre et le dossier sélectionné. Réutiliser un curseur avec d'autres filtres
est refusé. Les preuves enregistrées après `asOf` restent hors de cette traversée;
recharger la première page crée un nouvel inventaire.

`totals.evidence`, `unreviewed` et les compteurs par observation couvrent toutes
les preuves de l'inventaire, indépendamment de la page et des filtres.
`totals.filtered` compte celles qui correspondent aux filtres. Les examens peuvent
évoluer entre deux pages; `asOf` borne les preuves, sans figer les futures conclusions
administratives. Les compteurs par observation peuvent se chevaucher.

Le DTO minimal contient les identifiants, canal, destination, bénéfice, date de
livraison, durée, observations des exigences, `reviewVersion` et `latestReview`.
Ce dernier expose seulement identifiant, conclusion et date. Aucun message privé,
coordonnée, référence documentaire, clé de stockage, acteur ou raison interne
n'est retourné dans cet inventaire.

## Examen explicite et reçus

`POST /api/admin/sponsorship-commitments/historical-audit/review` exige le même rôle,
un corps JSON et les champs suivants :

- `requestId` et `evidenceId` : UUID;
- `expectedVersion` : version d'examen entière, initialement `0`;
- `confirmation` : identifiant exact de cette preuve;
- `conclusion` : `confirmed`, `follow_up_required` ou `inconclusive`;
- `reason` : raison privée non vide, au plus 2 000 caractères après normalisation.

Un champ inattendu ou invalide reçoit `400 HISTORICAL_AUDIT_INVALID`. L'API
sérialise la clé de requête et la preuve, vérifie le reçu existant **avant** la
version courante, puis ajoute l'examen et son audit dans la même transaction.
`409 HISTORICAL_AUDIT_VERSION_CONFLICT` impose une nouvelle lecture avant une
nouvelle conclusion. Réutiliser une clé avec un autre contenu reçoit
`409 HISTORICAL_AUDIT_REQUEST_CONFLICT`; une preuve absente reçoit `404`.

Même UUID et contenu renvoient le reçu initial sans nouvel examen, même si une
conclusion plus récente existe. La réponse contient `evidenceId`, la version
suivante et `review` (UUID, conclusion, date UTC). Le Web ne déclare le succès
qu'après validation du reçu exact correspondant à la commande. Un ancien reçu
rejoué ne remplace pas une version plus récente déjà lue et ne redécrémente pas
le compteur des preuves sans examen.

Une réponse perdue, incohérente, une session expirée ou un conflit non reconnu
conserve la commande capturée et son UUID en mémoire. Une nouvelle commande reste
bloquée; la reprise réutilise exactement les mêmes paramètres. Après une fermeture
ou destruction de cette interface, cette mémoire locale est perdue : vérifier
l'inventaire et la piste administrative avant toute nouvelle conclusion. Le
transport authentifié refuse toute reprise sans session ou rôle autorisé.

## Persistance et limites

La migration additive
[052](../../apps/funding-api/migrations/052_sponsorship_historical_evidence_reviews.sql)
ajoute `sponsorship_historical_evidence_reviews`, les clés uniques de requête et de
version, ainsi que les index de lecture. Les examens sont immuables et le rôle API
ne reçoit aucun droit de les réécrire ou supprimer. Elle ne lance aucun examen,
publication, remboursement ou correction. Les migrations déjà appliquées restent
inchangées.

Une conclusion `confirmed` n'efface aucune observation automatique. Une lacune
commerciale demande un examen et une résolution distincts, explicitement autorisés
et tracés. La réception utilise des preuves et bases PostgreSQL jetables; elle ne
qualifie ni une ancienne campagne réelle ni la continuité d'un service en production.

Sources propriétaires : [contrats partagés](../../packages/funding-core/src/sponsorship-historical-audit.ts),
[service API](../../apps/funding-api/src/sponsorship-commitments/historical-audit.ts),
[projection des snapshots](../../apps/funding-api/src/sponsorship-commitments/historical-audit-projection.ts)
et [contrôleur Web](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-historical-audit-controller.ts).
