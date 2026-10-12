# Plan de tâches — Reconnaissance et diffusion des commandites

Date : 11 octobre 2026. Référence de diagnostic : `8edb18ee6b3f`.

Statut des six priorités : **Réception locale terminée**. Les six priorités reprises
sur `main` sont suivies dans le compteur ci-dessous. Les 44 fiches conservent
le périmètre complet et leurs critères propres ; ce compteur ne déclare pas
livrés les formats indisponibles ou les opérations réelles non autorisées.

Le feu vert de l'utilisateur couvre la réalisation locale de tous les lots de
l'[analyse](sponsorship-visibility-analysis.md). Ce plan les découpe en **44 tâches**
avec dépendances, critères d'acceptation et validations. Les
[19 garanties](sponsorship-publication-guarantees.md) restent ouvertes jusqu'à
livraison et vérification de leurs critères. Ce fichier devient la référence
de suivi des tâches; l'analyse conserve le diagnostic et ses sources.

L'[état initial des fondations](#avancement-courant) conserve les acquis et
limites de SP07, SP08, SP09, SP12 et SP20 avant cette reprise. Les réceptions
des six priorités ci-dessous décrivent les changements et vérifications actuels.
L'approbation administrative de chaque publication reste
distincte du développement. Les essais utilisent des dossiers synthétiques et
des fournisseurs simulés; la mise en service réelle se prépare dans SP43.

## Règles de réalisation

### Progression des six chantiers autorisés

Feu vert confirmé le 11 octobre 2026, après `main` au commit `3dbe67d`.
Dernière réception locale : 12 octobre 2026, sur cette même base.
**Progression : 100 / 100 %**, après réception des vingt critères locaux des
notifications, engagements, calendrier, preuves, usages photo et gouvernance.
Ce compteur porte sur la réalisation locale des six chantiers autorisés. Il
compte vingt critères de réception, chacun valant cinq points. Un critère exige
code, contrats, tests pertinents réussis et documentation ; du code en cours ou
un test non exécuté ne rapporte aucun point. Il ne mesure pas le temps passé.

<!-- prettier-ignore -->
| Chantier | Poids | Critères de réception | Validé |
| --- | --- | --- | --- |
| Notifications admin et CI | 5 % | Actions accessibles avec notifications, clavier/mobile et recette Docker complète. | 5 / 5 |
| Offre figée et engagements — SP01–SP06 | 25 % | Contrats immuables ; capture avant Checkout ; activation Stripe idempotente ; blocages/ajustements audités ; consommateurs de l'offre figée. | 25 / 25 |
| Calendrier et capacité — SP07, SP12–SP17 | 20 % | Capacité/rendu communs ; réservation du compte effectif ; régulation réelle ; mutations et autorisation exacte. | 20 / 20 |
| Preuves et suivi — SP19–SP22, SP27–SP30 | 20 % | Solde sur preuve qualifiée ; réconciliation et visibilité ; projection privée ; notifications sans doublon. | 20 / 20 |
| Photos et formats — SP23–SP26, SP32–SP39 | 20 % | Usages/préférence ; aperçu du dérivé réel ; portraits ; montages et collections qualifiés par canal. | 20 / 20 |
| Charte et adoption — SP40–SP44 | 10 % | Textes et procédure de validation préparés, aperçu historique ; réception transversale et guide de mise en service. | 10 / 10 |

Les versions, commandes, résultats et limites figurent dans les réceptions de
chaque lot. La validation éditoriale de la charte, son activation publique et les
opérations réelles restent des décisions séparées ; leur préparation est incluse
dans ce compteur. Aucun ancien dossier ne reçoit une offre ou une preuve inventée.

Réception des notifications : build Angular de production réussi (25 routes),
compilation TypeScript UI réussie, deux scénarios clavier/desktop FR et mobile EN
réussis, puis `node scripts/admin-acceptance.mjs` : **255 scénarios réussis**,
sans échec, omission ou reprise. Cette recette utilise un checkout isolé de
`3dbe67d` avec les quatre fichiers du correctif ; elle ne valide pas encore les
nouveaux contrats d'offres ni de réservations. La documentation propriétaire
est [le suivi d'activité](../operations/contribution-activity.md). Aucun déploiement
ni résultat de CI distante n'est déduit de cette recette locale.

Réception des trois premiers critères des engagements : 44 tests Node des
engagements, du Checkout, des factures et de la progression réussis ; 21
validations PostgreSQL isolées réussies, sans omission. La migration additive
041 conserve les anciens dossiers sans offre connue ; les offres acceptées
et leur historique sont immuables. Les références propriétaires sont
[Checkout](../technical/checkout.md), [API admin](../technical/admin-api.md),
[règles commandites](sponsorship-rules.md) et
[migrations](../operations/database-migrations.md). Une réception complémentaire
valide les blocages, les ajustements audités et la révocation des publications :
116 tests Node et 24 tests PostgreSQL isolés réussis, sans omission. Le
raccordement Web passe 1 043 tests Node UI/transports et sept parcours navigateur
FR/EN, desktop/mobile, de qualification, ajustement, droits et reprise exacte.

Réception des réservations et de la régulation du compte : sept scénarios
PostgreSQL (huit tests avec parent) réussis, puis 82 tests Node de commandes et
worker réussis. La migration 042 utilise fournisseur, compte normalisé et mode ;
l'espacement technique en mode réel vaut 60 secondes, sans promesse commerciale
ni affirmation de quota fournisseur. Les tests couvrent comptes partagés,
concurrence, bail, pause, attente et protection des résultats incertains.
[Le runbook](../operations/publication-automation.md) décrit les limites et la
reprise.

La réception complémentaire du calendrier valide les passages successifs, le
refus humain conservé, les formats figés et le rendu commun sur PostgreSQL
jetable : dix tests réussis, complétés par le refus atomique d'une réparation
qui dépasserait le créneau partagé. Les réparations conservent les obligations et
photographies des participants retenus ; aucun portrait ou montage ne recrute
automatiquement une photo de remplacement. Les contrôles Node des réparations
et décisions d'annuaire passent 123 tests. La dernière suite Node globale
compte 6 113 réussites, zéro échec et huit omissions liées aux conditions
d'exécution. La recette Docker de l'ensemble est reçue ci-dessous.

Réception des preuves et de la réconciliation : sept tests PostgreSQL de
solde exact, annuaire, immutabilité et rôle API restreint réussis ; six tests
de réconciliation/visibilité réussis. Les HTTP de vérification ne gardent aucune
transaction ouverte et un changement concurrent d'autorité empêche le solde.
Six tests du vrai pipeline PostgreSQL visuel qualifient également les hooks
transactionnels de dates/solde : destinataire synthétique, événement, version
et obligation exacts, sans SMTP. Deux parcours privés FR/EN vérifient la date,
la provenance, la destination et les liens sûrs des preuves de dossiers distincts,
sans contact, note ou clé privée. Une visibilité inconnue ne devient pas une
présence ni une absence confirmée.
Voir [les preuves](../technical/sponsorship-fulfilment.md).

La garde physique de l'annuaire passe 169 tests Node/HTTP et six tests PostgreSQL
de présence, corruption, stockage absent, version concurrente et réussite réelle
sur fichiers synthétiques. Les suites existantes de preuves/exposition passent
neuf tests avec de vrais WebP ; 63 tests supplémentaires de décisions d'annuaire,
modération et automatisation passent après qualification des mêmes fixtures.
L'absence de fichier ne devient ni une visibilité autorisée ni un engagement soldé.

Réception des usages/préférences : huit tests PostgreSQL réussis, avec propriété,
versions, refus motivé, révocation N0 et rollback atomique de l'audit. Les tests
Node des médias, dérivés et consommateurs Web passent ; neuf tests PostgreSQL
du vrai pipeline et seize parcours navigateur FR/EN passent également.
Le montage à huit participants conserve tous les noms/crédits ; huit engagements
individuels préparent huit portraits distincts dans cinq tests PostgreSQL des
passages. Le JPEG envoyé correspond aux octets de l'aperçu authentifié ;
corruption, retrait de droits et réponse perdue ne créent aucune preuve ou relance.
Deux parcours supplémentaires de l'annuaire vérifient les crédits réellement
visibles et l'affichage intégral des photos, sans recadrage implicite.

Réception de la préparation de gouvernance : l'aperçu historique borné et privé
fait partie des 24 tests PostgreSQL des engagements ; les contrôles owner de la
charte et son aperçu en lecture seule passent les tests HTTP et PostgreSQL.
La charte publique demeure inactive et son texte existant n'est pas remplacé
par le projet de conditions. Voir [la procédure](../operations/sponsorship-moderation.md).

Réception du pilotage global SP41 : 21 tests Node, dix tests PostgreSQL et deux
parcours navigateur FR/EN réussis. Le calcul lit toutes les obligations et
livraisons, indépendamment des filtres et pages affichées ; les scénarios
comprennent 650 obligations et 225 livraisons. Les incidents, leurs épisodes et
leurs projections privées restent distincts des autorisations de publication.
Le [guide d'adoption](../operations/sponsorship-delivery-adoption.md) décrit la
qualification historique explicite, les gardes et les opérations restantes.

Réception transversale finale, le 12 octobre 2026, sur
`feat/sponsorship-delivery-completion` depuis `3dbe67d` :

- `yarn test` : 6 113 réussites, zéro échec, huit omissions liées aux conditions
  de l'hôte et des outils optionnels, parmi 6 121 tests.
- `node scripts/admin-acceptance.mjs` : **257 réussites**, zéro échec, omission
  ou reprise, sur une pile neuve avec fournisseurs et SMTP simulés. Les quinze
  échecs de la première recette ont tous un résultat réussi dans cette exécution
  complète. Résultat JSON et journal concordent ; la pile jetable est nettoyée.
- TypeScript sans émission, lint, format ciblé, build Angular de production
  (25 routes SSR), standards documentaires, liens et `git diff --check` réussis.
  Le lint conserve un avertissement préexistant dans `scripts/smoke-public.mjs`.
  Le build conserve un avertissement de taille initiale : 834,07 kB pour un
  seuil de 800 kB.

Les migrations 041–050 ont été vérifiées sur PostgreSQL jetable, sans réécriture
de migrations déjà appliquées. Les portraits et montages utilisent le JPEG
qualifié de l'aperçu ; les collections de plusieurs images restent indisponibles
dans les adaptateurs actuels. Les essais locaux ne qualifient aucun compte
fournisseur réel, aucune cible de production ni l'activation de la charte.
Cette réception clôt les six priorités locales, sans clôturer les 44 fiches ou
les dix-neuf garanties dans tous leurs formats et toutes leurs cibles.

Défragmentation structurelle du 12 octobre 2026 : les façades `planning.ts`,
`changes.ts` et `evidence.ts` conservent leurs exports. Préparation, réparation,
admissibilité, qualification, ajustements et écriture des preuves ont chacun une
responsabilité propre. Le contrôleur Web délègue catalogue, choix des photos et
aperçus privés à `publication-delivery-media-controller.ts` ; ses commandes,
signaux publics et confirmations restent compatibles. Les requêtes, verrous,
transactions, empreintes et traitements déplacés sont conservés.

La validation après extraction passe 6 113 tests Node (zéro échec, huit omissions),
64 tests PostgreSQL ciblés et dix parcours navigateur FR/EN (zéro échec ou omission).
TypeScript sans émission, lint, build Angular et contrôles documentaires passent.
Les avertissements déjà signalés ci-dessus sont inchangés. La recette Docker de
257 scénarios ci-dessus appartient à la réception avant extraction ; les nouvelles
validations sont celles décrites ici.

Les cinq P2 de la revue restent ouverts : solde avant la fin d'une durée promise,
logo promis absent de la preuve Web, anciens brouillons après ajustement,
commande de retrait des droits bloquée après conflit et visibilité refusée après
remboursement partiel. Cette défragmentation préserve ces comportements ; elle
ne constitue pas leur correctif.

- P0 : conformité de la reconnaissance, conservation des engagements et reprise
  des résultats incertains. P1 : file, réservations, dates et suivi fiable.
  P2 : personnalisation et nouveaux formats. La priorité ne remplace pas une dépendance.
- Chaque tâche livre ses contrats publics, producteurs, consommateurs, erreurs,
  tests utiles et documentation propriétaire ensemble. G19 s'applique à toutes.
- Les migrations nécessaires appartiennent à leur tâche et prennent le prochain
  numéro disponible au moment de leur création. SP40 traite l'adoption historique;
  il ne reporte pas les migrations de tous les autres lots à la fin.
- Une tâche terminée indique sa référence de changement, les commandes exécutées,
  leurs résultats et limites. Les statuts admis sont à faire, en cours, à vérifier,
  terminé, ou bloqué avec précondition précise et travaux indépendants possibles.
- Les tailles calendaires seront évaluées après stabilisation des contrats.
  Aucune durée commerciale ou estimation de livraison n'est inventée par ce plan.

Les offres et valeurs existantes restent le point de départ. Le portrait
individuel et le montage collectif font tous deux partie du développement
autorisé. Leur disponibilité technique n'adapte pas automatiquement une offre
déjà acceptée. Les formats multiples passent par une qualification par canal;
un format non supporté ou non accessible reste explicitement indisponible.

## Lots et ordre de travail

| Ensemble                 | Tâches      | Résultat                                                           |
| ------------------------ | ----------- | ------------------------------------------------------------------ |
| Cadrage                  | SP01        | Contrats, paramètres et ordre d'intégration stabilisés.            |
| A — Engagements          | SP02 à SP06 | Offre figée et avantages suivis indépendamment des lots.           |
| B — Contenu et file      | SP07 à SP11 | Participants réellement reconnus, surplus suivi et file équitable. |
| C — Calendrier           | SP12 à SP18 | Réservations et envois compatibles sur le compte effectif.         |
| D — Preuves et incidents | SP19 à SP22 | Avantages soldés sur preuve et résultats incertains réconciliés.   |
| E — Parcours et photos   | SP23 à SP31 | Photo propre, aperçu, suivi privé, décisions et reçu utiles.       |
| F — Visuels collectifs   | SP32 à SP39 | Montage équitable et formats multiples qualifiés séparément.       |
| Adoption et réception    | SP40 à SP44 | Historique classé, mesures complètes et livraison locale vérifiée. |

Le démarrage technique privilégie **SP07 et SP08** pour contrôler le contenu
final, **SP12** pour reproduire et protéger la dernière place et **SP20** pour
conserver les résultats fournisseur observés. SP01 et SP02 fixent en parallèle
les contrats nécessaires aux engagements durables. Ces premiers correctifs
réutilisent les dossiers et livraisons existants; ils n'attendent pas les
nouveaux formats photo et ne créent pas de suivi métier concurrent.

Après ces fondations, A et B convergent vers les obligations. C et D fiabilisent
leur livraison. E exploite les projections privées; F ajoute les capacités
visuelles. L'adoption historique commence par un aperçu de rapprochement et
reste distincte de l'activation des envois.

<a id="avancement-courant"></a>

## État initial des fondations

Ce tableau conserve le diagnostic des cinq fondations à l'ouverture du chantier.
Ses travaux restants sont repris par les réceptions actuelles des six priorités ;
il ne mesure pas leur avancement. Les critères détaillés demeurent dans leurs
fiches. Le fonctionnement actuel est décrit dans le
[runbook](../operations/publication-automation.md).

<!-- prettier-ignore -->
| Tâche | Acquis locaux | Travail restant et limites | Réception |
| --- | --- | --- | --- |
| [SP07](#sp07) — Rendu final | Politique pure partagée : identité du dossier, blocs complets, budget UTF-16 et sélection des retenus/différés/à corriger. Composition, rafraîchissement, préparation et réparation préservent les blocs. | Faire converger le calcul de capacité de tous les chemins d'affectation, puis raccorder les offres figées et engagements durables. | [Lot 1](#lot-local-01), [lot 2](#lot-local-02) |
| [SP08](#sp08) — Reconnaissance | Les livraisons automatiques contrôlent la source entière avant revue, autorisation, envoi et finalisation. Homonymes et mentions incidentes sont distingués; `SOURCE_CONTENT_MISSING` et liens de correction sont disponibles en FR/EN. | Relier les éléments promis des offres figées et les obligations SP19. Faire converger les jobs sociaux historiques et mutations manuelles de statut. | [Lot 1](#lot-local-01), [lot 2](#lot-local-02) |
| [SP09](#sp09) — File | Les sources individuellement impossibles sont isolées; les suivantes avancent. Un diagnostic inchangé est exclu avant la limite de scan; une correction conserve l'ancienneté. Le cockpit expose les sources sans livraison, les raisons et les totaux complets. | Raccorder les obligations SP04. Plusieurs passes peuvent être nécessaires; le coût des totaux sur un très grand arriéré reste à mesurer. Les textes finaux protégés exigent leur propre correction et une nouvelle approbation. | [Lot 2](#lot-local-02) |
| [SP12](#sp12) — Dernière place | Cinq courses reproduites sur PostgreSQL 16. Les trois affectations manuelles et la modification de créneau verrouillent le parent avant recompte; cascades transactionnelles et heure relue après attente. L'interblocage avec la modification de créneau est corrigé dans la finalisation automatique live, avec l'ordre livraison, créneau, lot, brouillons. | Raccorder planificateur automatique, rendu final et autres mutations historiques à la même protection. | [Lot 1](#lot-local-01), [concurrence](../../tests/integration/publication-capacity-concurrency.integration.mjs) |
| [SP20](#sp20) — Acquittement | Audit `provider_result_observed` commis avant la finalisation et indépendant de celle-ci, lié au claim et dédupliqué sous verrou. Échec ultérieur conservé comme incertain, sans projection publiée ni renvoi; références aussi retenues dans l'audit d'incertitude si l'observation initiale échoue. | Relier preuves des obligations SP19 et projection admin. Une identité modifiée après envoi peut empêcher la réconciliation actuelle : conserver les preuves et traiter dans SP19/SP21, sans attester l'absence d'un post existant. | [Lot 1](#lot-local-01) |

<a id="lot-local-01"></a>

## Premier lot local — 11 octobre 2026

Référence : [PR #302](https://github.com/OpenG7/openg7-funding-platform/pull/302),
branche `feat/sponsorship-publication-foundations`. Le premier lot implémente
les blocs de reconnaissance, leur contrôle avant approbation/envoi/finalisation,
les réservations manuelles atomiques et l'observation indépendante des résultats
fournisseur. [Décision et limites](../decisions/2026-10-11-sponsorship-recognition-blocks.md);
[procédure de reprise](../operations/publication-automation.md#exceptions-and-recovery).
Réception locale sous Node 22.23.3 et Yarn 4.9.4 : `yarn test` passe, **5 943 tests
réussis et 8 ignorés** par leurs préconditions de plateforme. Les neuf suites
PostgreSQL ciblées passent, **100 tests**, sur bases jetables :

```sh
node --test tests/integration/publication-capacity-concurrency.integration.mjs tests/integration/publication-calendar-boundaries.integration.mjs tests/integration/publication-batch-scheduling.integration.mjs tests/integration/publication-workflow-persistence-boundaries.integration.mjs tests/integration/publication-media-scope.integration.mjs tests/integration/publication-automation.integration.mjs tests/integration/publication-worker-claims.integration.mjs tests/integration/editorial-programme.integration.mjs tests/integration/sponsorship-benefit-policy.integration.mjs
```

Les suites ont été exécutées séparément, avec leurs propres conteneurs PostgreSQL
16; la commande ci-dessus en donne les fichiers. Le build Angular production
passe avec 25 routes prérendues. Compilation des tests UI via
`yarn exec tsc -p tests/tsconfig.admin-ui.json`, puis recette
`yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-publication-automation.spec.ts` :
43 cas existants passent initialement; le sélecteur anglais d'un nouveau cas est
corrigé, puis les dix cas de contenu manquant passent à la relance ciblée,
y compris quatre cas d'incertitude ajoutés après revue. Tous les 53 cas ont
donc été vérifiés; les autres cas déjà verts n'ont pas été relancés.

`yarn lint` passe avec l'avertissement préexistant de `scripts/smoke-public.mjs:165`.
Prettier ciblé, standards OpenG7, contrôle documentaire et `git diff --check`
passent. Les essais utilisent des dossiers synthétiques et fournisseurs simulés;
ils ne qualifient pas un envoi réel. Aucun nouveau schéma n'est nécessaire à ce lot.
Les 19 garanties complètes restent ouvertes.

Après fusion du cadrage #301, les recettes d'identité et Docker ont révélé des
fixtures qui attendaient des textes abrégés supprimant une partie des blocs.
Les fixtures conservent maintenant les sources complètes; une révision du nom
modifie aussi le titre source avant recomposition et nouvelle approbation.
Le scénario `editorial-preferences-journey.spec.ts` reproduit l'échec, puis passe
avec API/Web réels, PostgreSQL jetable et OIDC signé local. La recette ciblée
via `node scripts/admin-acceptance.mjs` passe : **11 cas dans six suites**
(paiement inadmissible, résultat incertain, médias, publication, révision et
niveaux de commandite). Elle vérifie aussi le refus `SOURCE_CONTENT_MISSING`
sans autorisation ni envoi. Compilation TypeScript complète sans émission,
lint, format, contrôles documentaires et diff passent. Ces correctifs ne changent
aucun garde-fou applicatif; la CI complète reste une validation distincte.

<a id="lot-local-02"></a>

## Deuxième lot local — 11 octobre 2026

Référence : [PR #305](https://github.com/OpenG7/openg7-funding-platform/pull/305),
code vérifié au commit `504b229`. Branche : `feat/sponsorship-rendered-queue`.
SP07 et SP09 avancent avec la
sélection des blocs complets dans le budget rendu, la progression au-delà des
sources individuellement trop longues et leur diagnostic dans le cockpit.
Le cache des sources inchangées réutilise l'audit existant; aucune migration
n'est ajoutée. Une correction conserve l'identifiant et l'ancienneté de la
source, sans approbation ni diffusion automatique.
[Fonctionnement et limites](../operations/publication-automation.md#source-preparation-queue).

Réception locale sous Node 22.23.3 et Yarn 4.9.4 : après raccordement de la
modération fusionnée dans `main`, les tests globaux passent, **6 004 tests
réussis et 8 ignorés** par leurs préconditions de plateforme. Les cinq suites
PostgreSQL suivantes passent séparément sur bases jetables : **85 tests**.

```sh
node --test tests/integration/publication-rendered-queue.integration.mjs tests/integration/publication-source-render-cache.integration.mjs tests/integration/publication-automation.integration.mjs tests/integration/editorial-programme.integration.mjs tests/integration/moderation-publication-guards.integration.mjs
```

La recette UI ciblée passe : **19 cas**, dont neuf nouveaux cas de file,
en français et en anglais, sur mobile et bureau. Les cas existants de contenu
manquant et de résultat incertain restent verts. La recette avec API/Web réels,
PostgreSQL jetable et fournisseurs simulés passe : **deux scénarios**, via
`node scripts/admin-acceptance.mjs tests/playwright/sponsorship-rendered-queue-acceptance.spec.ts tests/playwright/sponsorship-publication-acceptance.spec.ts --project chromium`.
Elle vérifie la source trop longue, sa visibilité après rechargement, la
correction sans changement d'ancienneté, la préparation privée et l'absence
d'approbation ou d'envoi; le parcours de paiement/publication existant passe aussi.

Le raccord de modération couvre N1/N2, les N0 obsolètes et les restrictions du
rendu final : les sources privées restent visibles, sans affectation nouvelle.
Une correction ou une affectation ne fabrique aucune revue favorable. Le retrait
de consentement continue de bloquer la livraison avant l'arrêt pour modération.
Une N0 courante ne suffit pas à approuver une reconnaissance incomplète : le
test PostgreSQL refuse `SOURCE_CONTENT_MISSING` sans modifier les sources ni
la livraison, ni appeler un fournisseur.

Le build Angular production passe avec 25 routes prérendues. Compilation
TypeScript sans émission, lint, format ciblé, standards OpenG7, contrôle
documentaire et `git diff --check` passent. Le lint conserve l'avertissement
préexistant de `scripts/smoke-public.mjs:165`. La CI distante reste une
validation distincte de cette réception locale.

Consolidation du même lot après `504b229` : préparation et réparation réutilisent
un prédicat de candidats commun; la file réutilise l'éligibilité financière
existante et conserve les restrictions de modération comme diagnostics.
Le suivi courant est regroupé ci-dessus. Les dates des scénarios PostgreSQL sont
réinitialisées ensemble à chaque scénario, avec les marges existantes, après
reproduction de leur expiration pendant une suite longue.

Réception de cette consolidation : `yarn build`, puis
`node --test tests/*.test.mjs`, **6 004 réussites et 8 ignorés**; trois suites
PostgreSQL séparées passent, **62 tests**, sans échec ni omission :

```sh
node --test tests/integration/publication-rendered-queue.integration.mjs tests/integration/publication-source-render-cache.integration.mjs tests/integration/publication-automation.integration.mjs
```

TypeScript sans émission, lint, format, standards, contrôle documentaire et diff
passent, avec le même avertissement lint préexistant. Les preuves UI et Docker
ci-dessus restent attachées à `504b229`.

Cette réception ne clôture pas SP07 ni SP09; leur travail restant figure dans
l'[avancement courant](#avancement-courant). Le périmètre privé, les limites de
scan/pagination et les corrections protégées sont définis dans le
[runbook](../operations/publication-automation.md#source-preparation-queue).
Les 19 garanties complètes restent ouvertes; aucun envoi réel n'est qualifié.

## Cadrage

<a id="sp01"></a>

### SP01 — Fixer les contrats, paramètres et responsabilités

- [ ] À faire · P0 · Dépendances : aucune · Garanties : G01, G10 à G15, G19.

**Périmètre :** contrats partagés, configuration, API, décision d'architecture.
Documenter offre, obligation, affectation, réservation, preuve et média dérivé,
en réutilisant les propriétaires existants.

**Acceptation :** formules collectives actuelles conservées comme base; capacités
individuelles et collectives futures identifiées; paramètres de délai, point de
départ, marge, intervalle et retard explicités. Un délai non défini est présenté
comme non défini. Aucune promesse nouvelle n'est déduite d'une valeur technique.
Définir erreurs stables, compatibilité historique et ordre commun des verrous.

**Validation :** revue des contrats et de leurs consommateurs; configuration
présente, absente et invalide; ADR si l'évolution structurelle le nécessite.

## A — Engagements et obligations

<a id="sp02"></a>

### SP02 — Définir l'offre figée et les obligations

- [ ] À faire · P0 · Dépendances : SP01 · Garanties : G01, G02, G15.

**Périmètre :** exports publics de `funding-core`/`funding-models`, persistance API.
Définir version d'offre, canal, destination logique, formule, quantité ou ordinal,
éléments requis, conditions, ancienneté et provenance.

**Acceptation :** l'offre enregistrée ne change pas avec le barème actif;
une obligation existe pour chaque passage convenu; unicités et transitions sont
explicites. Les obligations référencent les faits financiers existants et
n'ajoutent aucun second journal comptable.

**Validation :** immuabilité, devises et configuration; étendre
[la politique des avantages](../../tests/integration/sponsorship-benefit-policy.integration.mjs).

<a id="sp03"></a>

### SP03 — Enregistrer l'offre avant la soumission Checkout

- [ ] À faire · P0 · Dépendances : SP02 · Garanties : G01.

**Périmètre :** paiement public, opérations Checkout durables et contribution.
Enregistrer le snapshot calculé côté serveur dans l'opération idempotente.

**Acceptation :** même clé et même entrée conservent l'offre; entrée incompatible
produit un conflit. Un paiement confirmé après changement du barème retrouve
l'offre originale. La version ou empreinte de l'offre affichée est transmise
comme référence non autoritaire et vérifiée par le serveur. Si l'offre a changé
avant soumission, signaler la divergence et obtenir la confirmation de la nouvelle
présentation avant l'appel Stripe, sans accepter d'avantages fournis par le client.
Redirection, fermeture du navigateur et état Web ne confirment
aucun avantage. Une offre non traçable ne peut pas être promise silencieusement.

**Validation :** étendre
[Checkout idempotent](../../tests/integration/checkout-idempotency.integration.mjs)
et [les tentatives](../../tests/checkout-attempts.test.mjs); couvrir confirmation tardive
et changement de barème entre affichage et soumission.

<a id="sp04"></a>

### SP04 — Activer les avantages sur confirmation Stripe

- [ ] À faire · P0 · Dépendances : SP02, SP03 · Garanties : G01, G02, G15.

**Périmètre :** finalisation Stripe, contributions et obligations persistantes.
Créer les obligations une seule fois à partir de l'offre acceptée.

**Acceptation :** événements répétés, retardés ou désordonnés et chemins Session/
PaymentIntent convergent. Activation et écritures locales liées sont atomiques.
Une interruption se reprend sans doublon; montant, devise et association sont
vérifiés. Aucun effet externe n'est exécuté dans la transaction.
Une session déjà ouverte avant SP03, sans snapshot fiable, conserve son paiement
confirmé et crée une situation d'engagement à qualifier avec provenance. Ne pas
fabriquer une offre à partir du nouveau barème ni perdre le fait financier.

**Validation :** étendre
[la reprise webhook](../../tests/stripe-webhook-recovery.test.mjs); ajouter
interruptions avant et après activation, événements incompatibles et ancienne
session sans snapshot confirmée après mise à niveau, avec répétition de l'événement.

<a id="sp05"></a>

### SP05 — Préserver les obligations bloquées, refusées ou ajustées

- [ ] À faire · P0 · Dépendances : SP04 · Garanties : G02, G14, G15.

**Périmètre :** décisions commandite/publication, droits, versions et audit API.
Distinguer à fournir, bloquée avec raison, livrée sur preuve et ajustée par décision.

**Acceptation :** report, annulation de lot et refus de texte ne soldent rien.
Le refus humain reste conservé. Consentement, paiement, revue et média invalide
bloquent avec motif. Un ajustement est explicite, versionné et audité; un
remboursement partiel ne reconstruit pas l'offre depuis le montant restant.
Les règles Web et celles des nouveaux envois restent distinctes.

**Validation :** annulation, refus, retrait, reprise et ajustements concurrents;
étendre [la progression](../../tests/sponsorship-progress.test.mjs).

<a id="sp06"></a>

### SP06 — Faire utiliser l'offre figée par tous les consommateurs

- [ ] À faire · P0 · Dépendances : SP04, SP05 · Garanties : G01, G02, G17, G18.

**Périmètre :** suivi privé, progression, couverture, attention, sources du
planificateur, documents et consommateurs Web.

**Acceptation :** offre A affichée et planifiée après activation d'un barème B;
canaux, destination, formule et quantités concordent. Préparation et livraison
restent distinctes. Une offre historique inconnue est à confirmer; une facture
déjà émise conserve ses données.

**Validation :** vérification croisée des projections et
[stabilité des factures](../../tests/integration/sponsorship-invoice-benefits.integration.mjs).

## B — Contenu et file équitable

<a id="sp07"></a>

### SP07 — Centraliser la composition et le budget du rendu final

- [ ] En cours · P0 · Dépendances : SP01 · Garanties : G03 à G07.

**Avancement :** voir le [suivi courant](#avancement-courant).

**Périmètre :** politique pure partagée, composition et transformations éditoriales.
Produire rendu final, blocs de reconnaissance, bénéficiaires retenus, différés,
éléments nécessitant correction et longueur mesurée.

**Acceptation :** compter toutes les transformations, séparateurs et mentions;
unité UTF-16 explicite pour la limite applicative existante. Aucun participant
n'est supprimé silencieusement. Le contrat peut être utilisé avec les dossiers
actuels puis enrichi par SP02 sans second calcul métier.

**Validation :** limite exacte et dépassement, emoji, noms longs et transformations;
étendre [les frontières applicatives](../../tests/publication-application-boundaries.test.mjs)
et ajouter les tests de la politique pure.

<a id="sp08"></a>

### SP08 — Vérifier les bénéficiaires avant approbation et finalisation

- [ ] En cours · P0 · Dépendances : SP07 · Garanties : G03 à G05, G14, G17.

**Avancement :** voir le [suivi courant](#avancement-courant).

**Périmètre :** commandes, préflight et contrat du contenu approuvé.
Lier chaque dossier à ses éléments de reconnaissance et à l'empreinte du rendu.

**Acceptation :** supprimer un nom, lien ou élément promis bloque l'approbation
ou impose une réaffectation explicite. Homonymes et mentions incidentes ne
valident pas le mauvais bénéficiaire. L'édition libre ne peut plus laisser un
participant absent réputé publié. SP19 utilise la même correspondance avec les obligations.

**Validation :** étendre
[les commandes](../../tests/publication-automation-commands.test.mjs) et leurs
frontières; tester suppression, mauvais lien et deux noms identiques.

<a id="sp09"></a>

### SP09 — Isoler les textes trop longs et poursuivre la file

- [ ] En cours · P1 · Dépendances : SP04, SP07 · Garanties : G02, G04, G07 à G09.

**Avancement :** voir le [suivi courant](#avancement-courant).

**Périmètre :** préparation et réparation des sources, raisons de blocage.
Traiter individuellement un dossier qui ne tient même pas seul.

**Acceptation :** les suivants continuent d'avancer; le dossier bloqué conserve
obligation et ancienneté. Sa correction lui rend son rang utile. Huit dossiers
admissibles dont le rendu accepte trois participants produisent trois lots de
trois, trois et deux si trois créneaux admissibles sont disponibles, sans
réservation humaine incompatible. Sinon, conserver les dossiers sans place
et exposer la cause de leur attente.
Échec de composition et absence de livraison restent visibles.

**Validation :** étendre
[la préparation](../../tests/publication-automation-planning.test.mjs); couvrir
premier dossier trop long, plusieurs dossiers bloqués et corrections successives.

<a id="sp10"></a>

### SP10 — Appliquer une attribution équitable dans tous les parcours

- [ ] À faire · P1 · Dépendances : SP05, SP07, SP09, SP12 · Garanties : G02, G04 à G08, G14.

**Périmètre :** affectations manuelles, récurrentes, réparations et changements de lot.
Employer la politique commune et une ancienneté métier stable.

**Acceptation :** arrivées nouvelles et reports ne font pas disparaître les
anciens dossiers; priorités exceptionnelles motivées et auditées. Affectations,
réductions de capacité et changements de membres respectent nombre et rendu.
Refus, éditions humaines et autorisations sont protégés.

**Validation :** scénarios d'ancienneté, priorité, capacité réduite et changement
concurrent; étendre
[les frontières de persistance](../../tests/publication-workflow-persistence-boundaries.test.mjs).

<a id="sp11"></a>

### SP11 — Exposer la prochaine étape et les dossiers hors horizon

- [ ] À faire · P1 · Dépendances : SP04, SP09, SP16 · Garanties : G08 à G10, G18.

**Périmètre :** projection API de la file d'obligations, progression et attention.
Suivre aussi les dossiers non affectés, hors horizon ou sans livraison composée.

**Acceptation :** chaque avantage en attente a une date proposée exploitable ou
une absence de place motivée. Absence de donnée et erreur de chargement restent
distinctes. L'horizon affiché ne limite pas les totaux ni les recherches métier.

**Validation :** horizon d'un jour, saturation, dossier au-delà de l'horizon et
lot sans livraison; étendre progression et détecteurs de publication.

## C — Calendrier et envoi effectif

<a id="sp12"></a>

### SP12 — Protéger la dernière place sous concurrence réelle

- [ ] En cours · P0 · Dépendances : aucune pour reproduction; SP01 pour correction et ordre des verrous; SP07 pour contrôle du rendu · Garanties : G06, G14.

**Avancement :** voir le [suivi courant](#avancement-courant).

**Périmètre :** repositories de lots et créneaux, transaction d'affectation commune.
Reproduire le risque avec deux connexions PostgreSQL, puis verrouiller le parent
partagé, recompter et affecter dans la même transaction courte.

**Acceptation :** une seule demande prend la dernière place; associations directes
et lots ne sont pas comptés deux fois. Ordre de verrous cohérent avec les chemins
existants. Rejeu, rollback et réduction de capacité ne dépassent aucun plafond.
Le constat de course reste qualifié de risque tant que sa reproduction manque.

**Validation :** ajouter concurrence déterministe aux
[limites du calendrier](../../tests/integration/publication-calendar-boundaries.integration.mjs)
et à [la programmation des lots](../../tests/integration/publication-batch-scheduling.integration.mjs).

<a id="sp13"></a>

### SP13 — Créer la réservation commune du compte fournisseur

- [ ] À faire · P1 · Dépendances : SP01, SP16 · Garanties : G06, G11, G13.

**Périmètre :** service de réservation API, migration additive et identité de destination.
Clé par fournisseur, compte normalisé et mode; aucun secret dans la clé ou l'audit.

**Acceptation :** deux feeds utilisant le même compte partagent les réservations.
Comptes distincts et simulation restent indépendants. Une préparation sans compte
configuré peut proposer une date provisoire; l'approbation fixe la destination
effective et sa réservation. Concurrence et annulation ne créent pas de doublon.

**Validation :** nouvelle intégration de réservation avec compte partagé,
comptes distincts, contraintes, reprise et demandes simultanées.

<a id="sp14"></a>

### SP14 — Raccorder tous les chemins à la prévention des conflits

- [ ] À faire · P1 · Dépendances : SP10, SP12, SP13, SP17 · Garanties : G06, G09, G11, G14.

**Périmètre :** manuel, récurrent, éditorial, composition, édition, approbation,
déplacement et reprise. Supprimer les divergences entre contrôles locaux.

**Acceptation :** mêmes conflits refusés quel que soit le parcours; contrôle
sur toutes les réservations, au-delà des limites de réponse du cockpit.
Modification de compte ou d'horaire présente son impact et exige l'autorisation
appropriée. Les contraintes locales existantes restent utiles.

**Validation :** étendre
[l'intégration éditoriale](../../tests/integration/editorial-programme.integration.mjs)
et les commandes; ajouter conflits croisés et déplacements concurrents.

<a id="sp15"></a>

### SP15 — Réguler les envois au moment réel de diffusion

- [ ] À faire · P1 · Dépendances : SP13, SP16, SP17, SP20 · Garanties : G10, G12 à G14, G16.

**Périmètre :** claims, exécution et bail du compte; reprises certaines et
consignes fournisseur de nouvelle tentative lorsqu'elles existent.

**Acceptation :** après pause ou panne, plusieurs workers ne diffusent pas
presque ensemble sur le même compte. Comptes indépendants avancent séparément.
Aucune transaction DB n'est ouverte pendant HTTP. Retard dans la fenêtre
autorisée expliqué; au-delà, reprogrammation et nouvelle approbation.
Un résultat incertain conserve la protection applicable au compte.

**Validation :** horloge contrôlée, redémarrage, workers concurrents, retour tardif
et consigne fournisseur; étendre
[les claims concurrents](../../tests/integration/publication-worker-claims.integration.mjs).

<a id="sp16"></a>

### SP16 — Unifier dates, fuseaux, marge et retard autorisé

- [ ] À faire · P1 · Dépendances : SP01 · Garanties : G09, G13, G14.

**Périmètre :** contrats HTTP, politique temporelle et helpers de calendrier Web.
Instants avec offset ou Z, fuseau IANA pour l'affichage et fenêtres explicites.

**Acceptation :** instant exact du créneau, marge insuffisante et horizon sans
place traités sans fausse autorisation. Heures inexistantes ou ambiguës et
changement de fuseau expliqués. Le délai technique existant ne devient pas
une promesse commerciale. Revalider l'heure effective avant l'effet externe.

**Validation :** étendre
[les dates de publication](../../tests/publication-date-time.test.mjs), calendrier
et contrats HTTP; couvrir décalages d'heure et entrée sans offset.

<a id="sp17"></a>

### SP17 — Préserver l'approbation exacte dans toutes les mutations

- [ ] À faire · P0 · Dépendances : SP08, SP13, SP16 · Garanties : G14, G15.

**Périmètre :** commandes, affectations, calendrier, préflight et audit.
Étendre le contrôle versionné existant aux nouvelles données métier.

**Acceptation :** texte, bénéficiaires, photo, dérivé, compte, mode, date et fenêtre
pertinente sont ceux approuvés. Une mutation incompatible révoque l'ancienne
autorisation. Versions concurrentes, refus humains et approbation groupée restent
protégés. L'acceptation de présentation par le commanditaire ne vaut pas autorisation.

**Validation :** matrice des mutations après approbation et revalidation avant
envoi; étendre commandes, préflight et worker.

<a id="sp18"></a>

### SP18 — Suivre délais cibles et saturation

- [ ] À faire · P1 · Dépendances : SP05, SP11, SP13, SP16 · Garanties : G09, G10, G18.

**Périmètre :** configuration, calcul de retard, capacité effective et épisodes
d'attention administratifs; consommation visible dans SP29.

**Acceptation :** point de départ, dossier complet, blocages et pauses ont une
définition explicite. Retard distingue manque de capacité, contenu, approbation
et incident. Saturation durable déclenche une décision; aucune fréquence ou offre
n'est modifiée automatiquement pour masquer l'attente.

**Validation :** délais présents/absents, seuil, pause, blocage et saturation;
étendre [les détecteurs d'attention](../../tests/admin-attention-publication-detectors.test.mjs).

## D — Preuves et incidents

<a id="sp19"></a>

### SP19 — Solder exactement les avantages livrés sur preuve

- [ ] À faire · P0 · Dépendances : SP04, SP08, SP17 · Garanties : G03, G16, G17.

**Périmètre :** finalisation des livraisons, preuves, obligations et progression.
Rattacher succès réel, destination et bénéficiaires validés à chaque passage.

**Acceptation :** seule la bonne obligation est soldée, une seule fois.
Simulation, préparation, mauvais compte et simple déclaration historique ne
deviennent pas un succès fournisseur. Conserver contenu, médias, compte, mode,
date et référence distante; plusieurs passages sont suivis individuellement.

**Validation :** completion répétée, nom absent, mauvaise destination, plusieurs
passages et simulation; étendre
[l'intégration de progression](../../tests/integration/sponsorship-progress.integration.mjs).

<a id="sp20"></a>

### SP20 — Conserver l'acquittement fournisseur malgré une finalisation échouée

- [ ] En cours · P0 · Dépendances : aucune pour correction existante; SP19 pour raccordement des preuves · Garanties : G16, G17.

**Avancement :** voir le [suivi courant](#avancement-courant).

**Périmètre :** exécution, résultats, claims et observation persistante de tentative.
Conserver les références reçues indépendamment de la projection finale.

**Acceptation :** fournisseur accepté puis commit échoué donne un état incertain
avec les références disponibles. Observation liée à livraison et version de claim,
persistance idempotente, worker périmé incapable de remplacer une décision récente.
Base durablement indisponible ou arrêt avant persistance restent des cas à
réconcilier; aucune capture atomique fournisseur/DB n'est annoncée.

**Validation :** injection d'échec d'audit/commit après réponse, reprise et retour
tardif; étendre
[le worker](../../tests/publication-automation-delivery-worker.test.mjs)
et l'intégration de claims.

<a id="sp21"></a>

### SP21 — Qualifier la réconciliation et les preuves manuelles

- [ ] À faire · P0 · Dépendances : SP19, SP20 · Garanties : G16, G17.

**Périmètre :** adaptateur de lecture, commandes, provenance des preuves et audit.
Distinguer résultat observé, confirmation vérifiée et déclaration humaine.

**Acceptation :** mauvais auteur, contenu, compte ou mode refusé. Lecture
inaccessible ne démontre pas l'absence. Publication avec image incertaine exige
l'investigation appropriée. Attestation d'absence motivée ne relance rien
directement. Les anciennes déclarations restent identifiées par provenance.

**Validation :** preuve insuffisante, image, accès refusé et attestation;
étendre [la recette d'incertitude](../../tests/playwright/publication-uncertain-recovery-acceptance.spec.ts).

<a id="sp22"></a>

### SP22 — Traiter la visibilité perdue après diffusion

- [ ] À faire · P1 · Dépendances : SP05, SP19, SP21 · Garanties : G01, G15, G17, G18.

**Périmètre :** visibilité actuelle datée et décision de correction de reconnaissance.
Réutiliser la preuve historique, sans la remplacer.

**Acceptation :** message supprimé ou nom retiré conserve le fait initial;
lecture impossible reste inconnue. Si un contenu ou une durée durable était
promis, ouvrir un traitement explicite et audité. Toute nouvelle diffusion exige
sa propre autorisation; aucun renvoi ni remboursement automatique.

**Validation :** suppression, modification et lecture inaccessible après succès;
étendre progression et vérification distante.

## E — Photos, suivi privé et administration

<a id="sp23"></a>

### SP23 — Structurer les usages autorisés des photos

- [ ] À faire · P1 · Dépendances : SP02 · Garanties : G01, G14, G15.

**Périmètre :** contrats média, upload privé, persistance et revue administrative.
Usages par canal, crédit, restrictions et consentement aux dérivés.

**Acceptation :** approbation technique, droits d'usage et autorisation sociale
restent distincts. Restrictions contrôlées à la sélection et avant envoi;
retrait ou changement invalide l'usage concerné. Médias historiques sans faits
suffisants sont à confirmer, sans consentement inventé.

**Validation :** droits, versions et retrait; étendre
[l'audit média](../../tests/integration/sponsor-media-audit.integration.mjs)
et [la portée des médias](../../tests/integration/publication-media-scope.integration.mjs).

<a id="sp24"></a>

### SP24 — Proposer une photo préférée et demander une correction

- [ ] À faire · P2 · Dépendances : SP08, SP23 · Garanties : G03, G14, G15, G18.

**Périmètre :** contrat/HTTP de suivi privé, composants de suivi et décision admin.
La préférence porte uniquement sur les médias du propre dossier.

**Acceptation :** préférence distincte de photo retenue; version obsolète refusée.
Correction acceptée ou refusée avec motif et audit. Aucun droit global d'édition,
aucun dossier d'autrui et aucune autorisation d'envoi créée par la demande.

**Validation :** accès croisé, correction concurrente, suppression de photo et
choix finalement différent; étendre les tests HTTP/controller de suivi média.

<a id="sp25"></a>

### SP25 — Afficher le dérivé réellement préparé pour l'envoi

- [ ] À faire · P1 · Dépendances : SP08, SP23 · Garanties : G03, G14, G15, G17.

**Périmètre :** transformation image réutilisée, aperçu API privé et drawer admin.
Partager la préparation existante des octets sans exiger une connexion fournisseur.

**Acceptation :** texte, participants, image, version et empreinte cohérents.
Logos transparents et couleurs qualifiés; différences de rendu fournisseur
expliquées. Accès limité et révocable, aucune nouvelle URL publique implicite.
Les aperçus collectifs privés utilisent uniquement les éléments autorisés.

**Validation :** dérivé JPEG, refus d'accès, version retirée et rendu transparent;
étendre les frontières applicatives et le controller de livraison.

<a id="sp26"></a>

### SP26 — Réaliser les portraits individuels avec photo propre

- [ ] À faire · P2 · Dépendances : SP06, SP10, SP14, SP19, SP23, SP25 · Garanties : G01, G03, G06, G14, G17.

**Périmètre :** formule individuelle, composition, lots, sélection média et preuve.
Réutiliser le moteur existant pour un participant avec ses éléments convenus.

**Acceptation :** huit engagements individuels demandent huit publications.
Photo propre et reconnaissance sont validées ensemble. Image manquante ou
inadmissible déclenche correction ou décision explicite. Une offre collective
existante n'est pas transformée silencieusement en offre individuelle.

**Validation :** préparation, planification, média étranger et preuve du portrait;
étendre [la recette de publication](../../tests/playwright/sponsorship-publication-acceptance.spec.ts).

<a id="sp27"></a>

### SP27 — Exposer une projection privée des avantages et des preuves

- [ ] À faire · P1 · Dépendances : SP06, SP11, SP19, SP21 · Garanties : G09, G15, G17, G18.

**Périmètre :** API et contrat du suivi commanditaire. Avantages acceptés, dus,
livrés, prochaine étape, date, blocage, photo retenue et preuve disponible.

**Acceptation :** projection minimale réservée au bénéficiaire; aucune référence
Stripe, note admin, erreur interne ou donnée privée d'autrui. Simulation,
déclaration et preuve réelle distinctes. Date proposée et confirmée distinctes.
Erreur de lecture n'est pas présentée comme absence d'avantage.

**Validation :** accès absent/expiré/croisé, pagination et liens sûrs;
étendre [le HTTP de suivi](../../tests/sponsorship-followup-http.test.mjs)
et [les accès](../../tests/integration/sponsorship-access.integration.mjs).

<a id="sp28"></a>

### SP28 — Présenter le suivi commanditaire et l'aperçu

- [ ] À faire · P2 · Dépendances : SP24, SP25, SP27 · Garanties : G09, G10, G17, G18.

**Périmètre :** clients, controllers et composants Angular de suivi privé.
Remplacer l'information de publication inconnue lorsque des faits existent.

**Acceptation :** étapes, photo retenue, date et reçu compréhensibles; chargement,
vide, erreur et accès expiré complets. Une réponse tardive ne restaure pas les
données d'un ancien dossier. Aperçu collectif limité par les consentements;
à défaut, seule la contribution propre est montrée.

**Validation :** FR/EN, clavier, focus, mobile et SSR;
étendre [le parcours de suivi](../../tests/playwright/sponsorship-followup.spec.ts)
avec `yarn test:ui:followup`.

<a id="sp29"></a>

### SP29 — Compléter le cockpit, le calendrier et les décisions

- [ ] À faire · P1 · Dépendances : SP11, SP14, SP15, SP18, SP19, SP25 · Garanties : G06, G09 à G14, G18.

**Périmètre :** projections admin, pagination, listes, drawer, calendrier et progression.
Afficher raisons de répartition, conflits, retard et impact d'une modification.

**Acceptation :** retrouver toutes les obligations au-delà des limites d'affichage.
Conserver les compteurs globaux déjà présents et compléter leurs périmètres;
filtres, listes et compteurs concordent. Reprogrammation montre ancienne/nouvelle
date, dossiers déplacés et réapprobation. Les nouveaux droits sont vérifiés côté API.

**Validation :** grand jeu synthétique, rôles, confirmation et réponses tardives;
étendre [l'UI de publication](../../tests/playwright/admin-publication-automation.spec.ts)
avec les validations admin et d'accessibilité applicables.

<a id="sp30"></a>

### SP30 — Notifier date, correction et diffusion sans doublon

- [ ] À faire · P2 · Dépendances : SP17, SP19, SP24, SP27 · Garanties : G14, G16 à G18.

**Périmètre :** événements métier, templates FR/EN et file persistante de courriels.
Réutiliser déduplication, reprises et état incertain existants.

**Acceptation :** clé par dossier, événement et version; mise en file atomique
avec le fait concerné, aucun SMTP dans la transaction. Échec du courriel ne
retire pas une publication prouvée. Aucun aperçu collectif privé ni secret
dans le message. Destinataire corrigé par le workflow autorisé.

**Validation :** rendu, répétition, erreur et incertitude SMTP avec fournisseur simulé;
étendre [la livraison de courriels](../../tests/email-queue-delivery.test.mjs)
et [leurs templates](../../tests/email-notification-rendering.test.mjs).

<a id="sp31"></a>

### SP31 — Fournir un visuel de remerciement réutilisable

- [ ] À faire · P2 · Dépendances : SP19, SP23, SP25, SP27 · Garanties : G14, G15, G17, G18.

**Périmètre :** rendu déterministe, stockage privé, contrat et téléchargement de suivi.
Associer le visuel à une présentation autorisée et au reçu disponible.

**Acceptation :** artifact versionné, lisible et reproductible; photo, nom et crédit
autorisés. Aucun autre commanditaire privé ni accès public implicite. Ce visuel
ne constitue ni une seconde preuve fournisseur ni un reçu fiscal. Remplacement
et retrait contrôlés.

**Validation :** rendu, portée, téléchargement expiré et changement de version;
étendre stockage et suivi, ajouter les tests du rendu déterministe.

## F — Montages et formats multiples

<a id="sp32"></a>

### SP32 — Créer un média dérivé appartenant au lot

- [ ] À faire · P1 · Dépendances : SP08, SP23, SP25 · Garanties : G03, G14, G15, G17.

**Périmètre :** modèle média/publication, stockage, portée et API de sélection.
Référencer sources, propriétaires, versions, empreintes et bénéficiaires.

**Acceptation :** le collectif appartient au lot, sans attribution fictive à un
participant. Source retirée, membre déplacé ou consentement modifié invalide le
dérivé et l'autorisation. Ordre et version de composition traçables; binaires hors DB.

**Validation :** appartenance, source étrangère, remplacement et retrait;
étendre transactions média, stockage et intégration de portée.

<a id="sp33"></a>

### SP33 — Composer un montage collectif équitable

- [ ] À faire · P2 · Dépendances : SP07, SP25, SP32 · Garanties : G03 à G06, G15.

**Périmètre :** composition serveur déterministe et aperçu du lot.
Présenter photos/logos, noms et crédits selon une règle explicite.

**Acceptation :** zones comparables, proportions, logos clairs/sombres, noms longs
et recadrages maîtrisés. Lisibilité sur mobile; aucun participant disparu.
Alternative textuelle et reconnaissance hors image conservées.

**Validation :** images synthétiques et rendu mobile; tests de composition et
assertions visuelles pertinentes dans l'éditeur existant.

<a id="sp34"></a>

### SP34 — Intégrer la capacité visuelle aux affectations et aux preuves

- [ ] À faire · P1 · Dépendances : SP10, SP17, SP19, SP32, SP33 · Garanties : G02 à G07, G14, G17.

**Périmètre :** composition, file, aperçu, approbation et finalisation de montage.
Calculer la capacité effective avec la lisibilité du format visuel.

**Acceptation :** huit dossiers sont répartis si huit zones deviennent illisibles;
le surplus conserve son avantage. Tout changement de sources ou participants
impose recomposition et réapprobation. La preuve correspond au montage envoyé,
pas seulement au texte du groupe.

**Validation :** surcharge visuelle, membre retiré et reprise du lot;
étendre [la réparation collective](../../tests/playwright/collective-publication-repair-acceptance.spec.ts).

<a id="sp35"></a>

### SP35 — Qualifier les formats multiples séparément par canal

- [ ] À faire · P1 · Dépendances : SP01, SP23 · Garanties : G05, G06, G15 à G17.

**Périmètre :** contrats fournisseur Facebook et LinkedIn, capacités et runbook.
Étudier format, nombre, ordre, alternatives textuelles, permissions, upload et lecture.

**Acceptation :** conclusions appuyées sur documentation primaire et fixtures.
Capacité théorique distincte de l'accès effectif d'un compte. Format non qualifié
désactivé; aucune promesse ni substitution silencieuse. La qualification du
compte cible et tout essai distant ont une cible et une portée explicites.

**Validation :** fixtures de contrats, erreurs et résultats partiels; rapport
par canal indiquant ce qui est qualifié localement et ce qui reste à vérifier.

<a id="sp36"></a>

### SP36 — Étendre les contrats et l'éditeur aux collections d'images

- [ ] À faire · P2 · Dépendances : SP17, SP25, SP32, SP35 · Garanties : G03, G06, G14, G15.

**Périmètre :** contrats publics, persistance, sélection, aperçu et approbation admin.
Liste ordonnée et versionnée d'images admissibles avec leurs bénéficiaires.

**Acceptation :** parcours existant avec image facultative conservé; contraintes
par canal affichées et vérifiées côté serveur. Versions, ordre et droits de chaque
image font partie de l'approbation. Modifier un élément invalide l'autorisation.
Aucune image privée d'autrui n'est exposée dans le suivi.

**Validation :** liste vide/unique/multiple, ordre, quota, droits et version obsolète;
contrats HTTP, controller et parcours admin FR/EN, clavier et SSR.

<a id="sp37"></a>

### SP37 — Implémenter le format Facebook qualifié

- [ ] À faire · P2 · Dépendances : SP19, SP20, SP35, SP36 · Garanties : G03, G14 à G17.

**Périmètre :** adaptateur Facebook, uploads persistants, publication et preuve.
Implémenter le contrat établi par SP35, avec une seule livraison logique.

**Acceptation :** chaque image et chaque bénéficiaire sont vérifiés. Upload partiel,
image invalide et réponse perdue ont un traitement explicite. Aucun fallback
vers une seule image ne solde une promesse différente. Si SP35 établit une
incompatibilité, consigner la précondition manquante et conserver le format indisponible.

**Validation :** requêtes et réponses simulées, upload partiel et reprise idempotente;
étendre tests fournisseur et worker, sans diffusion réelle implicite.

<a id="sp38"></a>

### SP38 — Implémenter le format LinkedIn qualifié

- [ ] À faire · P2 · Dépendances : SP19, SP20, SP35, SP36 · Garanties : G03, G14 à G17.

**Périmètre :** adaptateur LinkedIn, traitement des uploads, publication et preuve.
Contrat distinct de Facebook; cette tâche peut avancer en parallèle de SP37.

**Acceptation :** ordre, alternative textuelle et état de chaque image vérifiés;
reprise sans uploads logiques inutiles. Résultats de traitement intermédiaires,
échec d'une image et réponse incertaine explicites. Format indisponible tant que
ses capacités nécessaires ne sont pas qualifiées.

**Validation :** fixtures LinkedIn et reprise de traitement; tests fournisseur,
worker et intégration synthétique avec les contrats réellement retenus.

<a id="sp39"></a>

### SP39 — Réconcilier les nouveaux formats visuels

- [ ] À faire · P1 · Dépendances : SP21 et SP34 pour les montages; SP36 et SP37 ou SP38 seulement pour les collections du canal concerné · Garanties : G16, G17.

**Périmètre :** observations, vérification distante qualifiée, audit et investigation admin.
Étendre la preuve aux montages et collections d'images effectivement activés.

**Acceptation :** vérification de texte seul ne confirme pas une promesse visuelle.
Lecture inaccessible reste inconnue. Références d'uploads et résultat observé
conservés. Investigation humaine dédiée lorsque la vérification automatique
n'est pas fiable; attestation d'absence et nouvelle autorisation avant renvoi.

**Validation :** incertitude sur montage, image manquante, collection partielle,
mauvaise version et absence non démontrée; tests de reprise par canal.

## Adoption, mesures et réception

<a id="sp40"></a>

### SP40 — Préparer le rapprochement et l'adoption historiques

- [ ] À faire · P0 · Dépendances : SP06, SP19, SP21, SP22 · Garanties : G01, G02, G16 à G18.

**Périmètre :** lecture de rapprochement et adoption bornée avec aperçu préalable.
Classer engagements documentés, déclarations, confirmations et données à confirmer.

**Acceptation :** aucune reconstitution aveugle du barème ni preuve inventée.
Factures, identifiants et audits conservés; reprises idempotentes et ajustements
tracés. Protéger autorisations actives et éviter deux chemins préparant la même
obligation. Documenter volumes, verrous, sauvegarde et reprise. L'adoption
n'active ni worker, ni feed, ni notification.

**Validation :** bases locales propre et synthétique existante, historique mixte,
ambiguïtés et interruption/reprise; respecter
[la procédure de migrations](../operations/database-migrations.md).
Inclure les anciennes sessions sans snapshot dont la confirmation arrive après
mise à niveau, puis le rapprochement idempotent de leur engagement à qualifier.

<a id="sp41"></a>

### SP41 — Mesurer la fiabilité et vérifier les écarts internes

- [ ] À faire · P1 · Dépendances : SP18, SP19, SP29, SP40 · Garanties : G10, G16 à G18.

**Périmètre :** agrégations serveur, audit et alertes existantes.
Mesurer avantages restants, âge, absence de date, saturation, conflits et incertitude.

**Acceptation :** compteurs sur le périmètre complet, indépendants de la pagination.
Écarts entre obligations, affectations et preuves visibles avec corrélation sûre.
Aucun secret ni donnée personnelle inutile. Éventuels chiffres d'audience
gardent source, période et fraîcheur; ils ne déterminent pas l'avantage livré.

**Validation :** grande file, écarts synthétiques, filtres et épisodes d'alerte répétés;
tests de détecteurs et projections API.

<a id="sp42"></a>

### SP42 — Réaliser la recette transversale des huit commandites

- [ ] À faire · P0 · Dépendances : SP06, SP10, SP14, SP15, SP19, SP28, SP29; SP26 et SP34 pour les variantes · Garanties : G19 et toutes les garanties concernées.

**Périmètre :** recette jetable API/PostgreSQL/Web avec fournisseurs simulés.
Vérifier les scénarios de l'analyse sur les flux intégrés, après les tests de chaque tâche.

**Acceptation :** avec dossiers admissibles et créneaux compatibles disponibles,
5+3 lorsque les textes tiennent, 3+3+2 avec capacité effective
de trois, huit portraits pour huit engagements individuels et montage collectif
uniquement si lisible et conforme. Inclure première source trop longue, nom retiré,
concurrence, pause, horaire exact, refus humain, consentement retiré, réponse
incertaine, historique ambigu, droits croisés et limites d'affichage.

**Validation :** compléter les recettes Node/PostgreSQL/Playwright appropriées;
ne pas assimiler simulation et qualification fournisseur réelle.

<a id="sp43"></a>

### SP43 — Préparer le guide d'adoption et de mise en service

- [ ] À faire · P1 · Dépendances : SP29, SP35, SP40, SP41, SP42; SP39 reçu sur les formats implémentés · Garanties : G14 à G19.

**Périmètre :** runbooks de publication, migrations et guides commanditaires/admin.
Consolider les documents déjà mis à jour avec chaque tâche.

**Acceptation :** ordre de migration, préconditions, réglages, pauses, volumes,
surveillance et reprise explicités. Qualification fournisseur distinguée des
tests locaux, cible et droits décrits. Préparer les opérations réelles exactes
pour examen : adoption, activation, notifications et publications autorisées.
Prévoir coexistence et retour en conservant les migrations additives et les preuves.
Les décisions d'indisponibilité issues de SP35 sont documentées; elles n'empêchent
pas la réception des portraits, montages et autres formats effectivement livrés.

**Validation :** répétition locale sur données synthétiques, revue des procédures,
format, standards et liens; aucune activation réelle dans cette tâche documentaire.

<a id="sp44"></a>

### SP44 — Vérifier la livraison locale et clôturer les garanties prouvées

- [ ] À faire · P0 · Dépendances : toutes les tâches applicables et SP43 · Garanties : G01 à G19.

**Périmètre :** diff final, contrôles applicables, traçabilité et compte rendu.
Réconcilier les tâches terminées, les limitations et les garanties ouvertes.

**Acceptation :** chaque clôture référence un changement et ses preuves.
Un format non accessible, une qualification distante manquante ou une exception
historique non résolue reste explicitement ouvert; aucune réussite globale fictive.
Livrer les changements locaux vérifiés et les opérations restantes préparées.

**Validation :** appliquer la matrice selon le diff final; vérifier `git diff --check`
et l'état du dépôt. Rapporter les tests exécutés et leurs limites.

## Traçabilité des garanties

Cette table indique les tâches principales; G19 s'applique également aux tâches
de configuration, contrat, média et UI qui y contribuent.

| Garantie                             | Tâches principales                                             |
| ------------------------------------ | -------------------------------------------------------------- |
| G01 — Avantages promis               | SP02 à SP06, SP22, SP26, SP40                                  |
| G02 — Report sans perte              | SP04, SP05, SP09, SP10, SP34, SP40                             |
| G03 — Présence réelle                | SP07, SP08, SP19, SP25, SP26, SP32 à SP39                      |
| G04 — Aucune suppression silencieuse | SP07 à SP10, SP33, SP34                                        |
| G05 — Texte définitif                | SP07, SP08, SP10, SP35                                         |
| G06 — Capacités atomiques            | SP10, SP12 à SP14, SP26, SP34, SP36                            |
| G07 — Texte trop long isolé          | SP07, SP09, SP34                                               |
| G08 — Équité                         | SP09 à SP11                                                    |
| G09 — Date ou absence explicite      | SP11, SP14, SP16, SP18, SP27 à SP29                            |
| G10 — Délai et alerte                | SP15, SP18, SP28, SP29, SP41                                   |
| G11 — Conflits globaux               | SP13, SP14                                                     |
| G12 — Espacement effectif            | SP15                                                           |
| G13 — Horaires fiables               | SP13, SP15, SP16                                               |
| G14 — Approbation exacte             | SP05, SP08, SP10, SP12, SP14 à SP17, SP23 à SP26, SP30 à SP39  |
| G15 — Exceptions explicites          | SP05, SP17, SP22 à SP25, SP27, SP31 à SP39                     |
| G16 — Reprise sans doublon           | SP15, SP19 à SP21, SP30, SP35, SP37 à SP40                     |
| G17 — Preuve réelle                  | SP06, SP08, SP19 à SP22, SP25 à SP28, SP30 à SP32, SP34 à SP41 |
| G18 — Suivi et audit                 | SP06, SP11, SP18, SP22, SP24, SP27 à SP31, SP40, SP41          |
| G19 — Validation                     | Chaque tâche; recettes intégrées SP42 et clôture SP44          |

## Organisation et parallélisation

- Une personne ou un agent possède chaque tâche pendant son exécution. Les
  politiques pures, la reproduction de concurrence, les contrats temporels et
  l'étude fournisseur peuvent avancer en parallèle.
- Les raccordements aux mêmes fichiers (`commands.ts`, `planning.ts`, `sources.ts`,
  finalisation et repositories du calendrier) sont séquencés. Les numéros de
  migration sont attribués par un seul intégrateur au moment d'écrire le fichier.
- SP37 et SP38 peuvent avancer indépendamment après le contrat SP36. SP39 est
  reçu par format réellement implémenté; une indisponibilité d'un canal ne
  bloque pas le contrôle du montage ni les autres formats qualifiés.
- L'UI peut être préparée sur fixtures typées après stabilisation des contrats;
  sa clôture exige le raccordement à l'API réelle et les contrôles de droits.

## Commandes de validation

Cette matrice guide les validations à venir; les exécutions déjà réalisées sont
consignées dans les réceptions datées des [lots 1](#lot-local-01) et [2](#lot-local-02).
Étendre les tests avec les comportements, puis
appliquer la [matrice du dépôt](validation.md) selon chaque changement.

| Changement              | Contrôles à choisir selon le périmètre                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Documentation           | Prettier ciblé, `yarn docs:check`, `git diff --check` et liens des nouveaux fichiers.                                           |
| API/contrats/politiques | Format, `yarn lint`, `yarn test`; contrats HTTP, erreurs, droits et reprises utiles.                                            |
| Concurrence/persistance | Intégrations PostgreSQL jetables, dont deux connexions réellement concurrentes; migrations sur base locale propre et existante. |
| Suivi commanditaire     | Build Angular et `yarn test:ui:followup`; FR/EN, mobile, clavier, accès et SSR.                                                 |
| Administration          | Build Angular et `yarn test:ui:admin`; rôles, confirmations, versions et compteurs.                                             |
| Réception intégrée      | Recettes jetables appropriées via `yarn test:e2e:acceptance`; aucune simulation présentée comme preuve de publication réelle.   |

Consigner dans chaque tâche les commandes réellement exécutées. Une suite globale
réussie ne clôture pas un critère absent de ses scénarios. La validation locale
et la qualification d'un compte fournisseur sont deux preuves distinctes.
