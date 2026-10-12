# Modération des commandites : contrats et limites

La politique éditoriale V1 est représentée par les contrats de
[funding-core](../../packages/funding-core/src/moderation.ts). Les décisions sont
humaines : l'assistance locale propose quelques indices, peut s'abstenir, et ne
prouve aucune détection exhaustive de haine ou de contenu illicite. Aucun
fournisseur d'IA, OCR ou analyse distante de liens n'est activé par ces routes.

## Décisions et droits

Les sujets sont typés : `sponsorship`, `media`, `publication_draft` et
`publication_delivery`. Le UUID seul ne suffit pas à identifier un sujet.
`GET /api/admin/moderation/content?subjectType=…&subjectId=…` retourne le contenu
actuel, son `contentVersion`, son empreinte et la décision courante. Cette révision
éditoriale est distincte des versions de commande, de claim worker et des dates
de changement financier.

`POST /api/admin/moderation/decisions` reçoit `{ subject, decision }` ; les champs
requis sont définis dans le contrat partagé. La confirmation égale l'identifiant
du sujet. `expectedDecisionId`, la révision et l'empreinte protègent une revue
contre les changements concurrents. Une même requête et son contenu sont
idempotents ; une réutilisation incompatible est refusée. La politique doit
encore être approuvée côté serveur. Chaque décision conserve une preuve du
contenu et un historique immuable ; les notes internes et l'explication destinée
au commanditaire sont deux champs séparés.

N0 autorise éditorialement ; les validations commerciales, financières, de
consentement, de média et d'envoi restent requises. N1 demande une correction,
N2 suspend, N3 refuse un élément, N4 refuse le dossier et N5 retire son exposition
locale. Les décisions graves nécessitant une seconde revue restent
`pending_independent_review` jusqu'à
`POST /api/admin/moderation/independent-review` avec
`{ decisionId, requestId, confirmation: decisionId }`. Cette confirmation exige
une personne OIDC distincte, identifiée durablement ; une session token partagée
ne satisfait pas l'indépendance. Les réponses de mutation sont `{ decision }`.

Toutes les lectures de preuves, décisions, recours et assistance sont réservées
à `operator` ou `owner`, y compris `GET` et les alias sans `/api`. Le rôle
`reader` n'a pas accès à ces nouvelles routes de preuves et de motifs internes. Les réponses portent
`Cache-Control: no-store`.

`POST /api/admin/moderation/assignment` est réservé au propriétaire et reçoit
`{ subject, assignedTo, expectedAssignedTo, confirmation: subject.id }`.
L'affectation est `null` ou `admin:<UUID>` d'un compte actif `operator`/`owner`.
Une affectation concurrente incompatible retourne `409` ; un compte inadmissible
est refusé. La mutation et l'audit sont atomiques ; le rejeu du même état n'ajoute
pas d'audit. Cette affectation organisationnelle n'accorde aucun droit, décision
ni autorisation de publication. La réponse est `{ assignedTo }`.

Le worker revalide le rendu final, les dossiers et le média sélectionné avant
chaque nouvel appel fournisseur. Le rendu N0 couvre les brouillons jamais
décidés individuellement; tout brouillon portant déjà une décision doit avoir
une N0 courante, sans recours ouvert. Un refus, une suspension, une seconde revue
en attente ou un contenu obsolète bloque l'envoi. Une atténuation ultérieure N0
ne rétablit pas l'autorisation commerciale d'un claim marqué comme révoqué.
`040` permet seulement de projeter le statut de refus après une restriction
versionnée pendant un envoi; elle n'autorise aucune édition de contenu, de lot
ou de date pendant ce claim. Les notes structurées de décision conservent la
justification; une note legacy n'est pas modifiée dans cette projection restreinte.

## Suivi privé, correction et réexamen

`GET /api/sponsorship-followup/moderation?token=…` renvoie les décisions du dossier
autorisé, leur explication externe, et les indicateurs `canCorrect` et
`canRequestReconsideration`. Cette projection ne contient ni notes internes,
acteurs, empreintes privées ou détails d'autres membres d'une publication
collective. Une décision sur une `publication_delivery` est liée au commanditaire
seulement si son snapshot immuable comporte exactement un dossier source
distinct. Cette identité historique ne change pas lorsque le lot est recomposé :
un autre dossier ne reçoit pas l'explication antérieure. Les lots collectifs
restent dans le périmètre administratif ; ils ne sont pas projetés dans le suivi
ni notifiés aux commanditaires. Les décisions historiques enregistrées sans
propriétaire unique ne sont pas réattribuées artificiellement. Une explication
propre à chaque dossier sera nécessaire avant d'ouvrir ce suivi aux lots collectifs.
Le même contrôle de jeton, d'appartenance et d'expiration
que pour le [suivi commanditaire](../sponsorship-access-and-drafts.md) s'applique.

`POST /api/sponsorship-followup/correction` reçoit
`{ token, decisionId, requestId, expectedRevision, data, locale? }`. La correction
porte sur une décision N1 active et actuelle du dossier. Elle remet les détails
en revue, produit une nouvelle preuve éditoriale, clôt le brouillon soumis et
conserve l'ancienne décision. La réponse contient
`{ received: true, recorded: true, contentVersion, revision }`. Elle n'accorde
aucune nouvelle approbation et ne change aucun fait financier.

`POST /api/sponsorship-followup/reconsideration` reçoit
`{ token, decisionId, requestId, explanation, locale? }` et répond
`202 { id, state }`. L'explication est bornée à 10–2000 caractères ; dix demandes
au maximum sont acceptées par dossier sur trente jours. Seule une décision
défavorable active et actuelle est recevable ; un seul recours peut rester ouvert
pour le cas. Le rejeu ne crée pas une autre demande ni un autre courriel.

Les opérateurs lisent les demandes via
`GET /api/admin/moderation/reconsiderations` et enregistrent une nouvelle décision
par `POST /api/admin/moderation/reconsiderations/resolve`
`{ appealId, subject, decision }`. Le recours et la nouvelle décision sont liés
dans la même transaction. Une nouvelle décision grave reste en attente de sa
revue indépendante. Toute résolution exige une explication externe non vide,
y compris N0 ; N0 n'exige pas de motif de refus. Aucun dépôt de demande ne
rétablit la publication et aucun
remboursement n'est déclenché par ces services.

## Notifications et charte publique

Les décisions défavorables actives et les reçus de correction ou de recours
utilisent la file de courriels persistante existante, dans la transaction métier.
Le worker envoie après commit. Les destinataires sont les adresses confirmées
au paiement, pour les états `paid`, `refunded` ou `disputed`, jamais un contact
modifiable du formulaire. Un dossier sans paiement confirmé ne génère pas ces
notifications. Les messages FR/EN
contiennent l'explication externe, sans notes de revue, texte privé du recours ou
identité du relecteur. Une décision en attente de revue indépendante n'envoie
pas de notification de refus. Les anciens messages déjà en file ou livrés ne
sont pas réécrits par ce changement. Voir [SMTP](../email-smtp.md).

`GET /api/sponsorship-charter` retourne
`{ active, policyVersion, fingerprint, text }`. Par défaut, `active=false` et
`fingerprint=text=null` : le texte préparé n'est pas publié ni présenté comme un
contrat validé. L'activation exige une validation éditoriale explicite, une date
de validation publique, une date d'effet et l'empreinte exacte du texte FR/EN
servi. Aucun endpoint d'activation n'est fourni dans ce chantier.

Le propriétaire peut lire `GET /api/admin/moderation/charter-preview` pour examiner
les textes FR/EN de la charte, leur empreinte exacte et les conditions de
reconnaissance proposées. La réponse privée indique séparément l'état public,
la date de validation et la date d'effet. Cette lecture utilise un snapshot en
lecture seule ; elle ne valide aucun texte, n'enregistre aucune acceptation et
n'active rien. Les conditions proposées décrivent l'offre figée, les quantités,
les droits des photos, les dates provisoires et les preuves. Toute adoption
publique exige une décision éditoriale explicite et une version additive
compatible avec les acceptations et preuves historiques. Consigner texte FR/EN,
version, empreinte, personne ayant validé, date et cible avant une mise en service
séparément autorisée. Voir [les engagements](../technical/sponsorship-commitments.md)
et [les preuves](../technical/sponsorship-fulfilment.md).

Pour une charte active seulement, un nouveau Checkout de type
`sponsorship_interest` exige
`charterAcceptance: { accepted: true, policyVersion, fingerprint, locale }`.
La preuve et l'opération durable sont enregistrées ensemble avant Stripe.
Une contribution personnelle reste possible sans cette preuve. Un replay
durable conserve son acceptation initiale ; il ne fabrique pas une nouvelle
acceptation après retrait ou changement de politique. Les erreurs
`CHARTER_ACCEPTANCE_REQUIRED`, `CHARTER_VERSION_CHANGED` et `CHARTER_NOT_ACTIVE`
imposent une nouvelle lecture et une nouvelle action du commanditaire.

## Gouvernance et mise en service

Les migrations additives 034 à 040 doivent précéder l'API mise à jour. Elles ne
fabriquent ni décisions ni acceptations historiques. Les anciens contenus
nécessitent une revue humaine explicite avant une nouvelle autorisation.
La migration 038 conserve une observation des dossiers et médias historiques
admissibles à l'exposition publique : leur empreinte et leur visibilité doivent
encore être inchangées. Une modification ou un retrait invalide cette observation
durablement. Elle ne constitue aucune N0, n'autorise aucun nouvel envoi et ne
remplace pas les gardes d'approbation des parcours administratifs ou du worker.
La migration 039 protège l'identité des versions de politique et impose des
preuves non nulles pour les décisions défavorables. Le rôle applicatif ne peut
pas activer la charte ou réécrire la politique.
`GET /api/admin/moderation/adoption-preview` et `retention-preview` sont des
inventaires en lecture seule réservés au propriétaire. L'aperçu d'adoption compte
`legacyRejectionNotificationsToReview` : les anciens courriels
`sponsorship_rejection` encore `queued`, `failed`, `sending` ou `uncertain`.
Avant l'activation SMTP ou leur reprise, vérifier leur contenu dans le parcours
privé autorisé : ils peuvent conserver d'anciennes notes de revue. L'aperçu
n'expose aucun corps ni destinataire et ne supprime aucun message.
Aucun outil de purge n'est activé sans validation de la politique de conservation.
`metrics` fournit
des agrégats internes aux opérateurs, sans contenu privé ; les objectifs de
délai restent proposés et internes.
Les cas ouverts sont les états `unreviewed`, `correction_requested`, `on_hold`
et `pending_independent_review`. Les compteurs incluent corrections reçues,
recours résolus et renversements vers N0, ainsi que les observations de retrait
par statut. Les durées moyennes mesurent version de contenu → décision et
ouverture → résolution du recours ; aucune ventilation de motifs, contenu,
identité ou destinataire n'est exposée.

`GET /api/admin/moderation/remote-removals` expose aux opérateurs des observations
persistantes après N5. Une restriction locale ne démontre pas la suppression
d'une copie externe. Aucun effacement distant ni vérification automatique n'est
réalisé ; une preuve et une vérification humaine séparées restent nécessaires.
Une livraison en cours d'envoi produit une observation même si son identifiant
externe est encore inconnu. Un résultat fournisseur reçu ensuite peut compléter
cet identifiant ; il ne confirme jamais un retrait ni une vérification.
Une réponse déjà téléchargée, un ancien cache ou une requête externe déjà en vol
ne peut pas être retirée rétroactivement par un en-tête HTTP ou un verrou local.

Les scénarios ciblés se trouvent dans
[les tests des décisions](../../tests/integration/moderation-decisions.integration.mjs),
[les tests du suivi et de la charte](../../tests/integration/moderation-followup-charter.integration.mjs)
et [les contrôles HTTP](../../tests/moderation-http.test.mjs). Ils utilisent une
base jetable et des ports synthétiques, sans envoi SMTP ou Stripe réel. La
présence de ces scénarios ne constitue pas leur résultat : consigner les
validations effectivement exécutées avant mise en service.

## Validation locale du 11 octobre 2026

Les contrôles ci-dessous portent sur le chantier local non committé, sous Node
22.23.3, avec PostgreSQL 16 jetable et des fournisseurs synthétiques. Les logs
locaux sont conservés sous `test-results/moderation-*.log`.

| Contrôle                                                                           | Résultat exécuté                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilation `tsc -p tsconfig.build.json`                                           | Réussie.                                                                                                                                                                           |
| Suite Node `node --test --test-concurrency=4 "tests/**/*.test.mjs"`                | 5 990 réussites, aucun échec, 8 tests ignorés.                                                                                                                                     |
| Décisions, adoption historique, suivi privé, charte et publications sur PostgreSQL | 146 tests distincts réussis : 13 décisions/adoption, 16 suivi/charte, 117 publications et régressions.                                                                             |
| Runner de migrations et rôle applicatif                                            | 12 tests réussis, dont application de toutes les migrations jusqu'à 040 et rejeu sans nouvelle application.                                                                        |
| Parcours navigateur avec API interceptées                                          | 156 scénarios distincts validés : 16 nouveaux, 53 publications, 19 revue/médias/pilotage et 68 publics. Un scénario public a été repris après correction d'une assertion obsolète. |
| Build Angular de production                                                        | Réussi, 25 routes prérendues.                                                                                                                                                      |
| ESLint global                                                                      | Aucun défaut bloquant ; un avertissement préexistant dans `scripts/smoke-public.mjs`.                                                                                              |
| Format du changement, standards documentaires et `git diff --check`                | Réussis.                                                                                                                                                                           |

La suite Node complète précède la dernière précision de la charte proposée
FR/EN sur les contenus sexuels inappropriés et la proportionnalité. Après cette
précision, la compilation et 30 tests ciblés HTTP, contrats et suivi/charte
PostgreSQL ont été réexécutés avec succès. Les nombres des sous-suites ne
s'ajoutent pas à celui de la suite globale.

Ces preuves ne qualifient ni l'activation publique de la charte, ni l'OCR,
l'analyse distante de liens, un corpus de détection exhaustive, une suppression
sociale réelle ou une purge. Aucune migration de production ni aucun envoi
Stripe, SMTP ou social réel n'a été exécuté pour cette validation.
