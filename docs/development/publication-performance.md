# Performance de publication sur un arriéré synthétique

Le test [publication-backlog-performance.integration.mjs](../../tests/integration/publication-backlog-performance.integration.mjs)
mesure les ports applicatifs réels sur PostgreSQL 16 jetable. Il crée uniquement
des faits synthétiques déclarés, sans lire `.env` ou `DATABASE_URL`, appeler un
fournisseur, envoyer un courriel, approuver ou publier une livraison réelle.
Le conteneur appartient au helper, utilise un disque mémoire et un port loopback,
puis est supprimé même après un échec.

## Volume et vérifications

La fixture comporte 3 000 dossiers, 6 000 obligations, 150 lots/créneaux avec
750 sources, 2 000 livraisons et réservations de compte, et 750 réservations
d'obligation. Les échéances synthétiques ont une origine documentaire explicitement
déclarée dans la fixture; aucune origine historique n'est déduite du paiement.
1 980 réservations partagent un compte, espacées de deux minutes; 20 autres
comptes portent une incertitude. Ce regroupement exerce le calcul des paires de
réservations, au lieu de faciliter artificiellement le plan par compte unique.

Le test vérifie les agrégats complets, 6 020 incidents attendus, le détecteur
d'alertes complet et deux pages distinctes de 50 incidents. Il prépare le vrai
feed sur un horizon de deux jours, vérifie les 3 000 rattachements de brouillon,
le scan de candidats de 400, la capacité maximale de dix, puis deux préparations
concurrentes avec une lecture d'incidents. Aucun brouillon supplémentaire ni
dépassement de capacité n'est permis; les réservations et comptes incertains
restent retenus et aucune preuve de réalisation n'est fabriquée. Une lecture complète de l'état reste
limitée à 200 livraisons et 200 sources affichées, avec les compteurs globaux.

Les lectures globales, les pages d'incidents et le détecteur d'alertes doivent
rester un seul statement chacun. La préparation est limitée à moins de 500
requêtes: son travail dépend de l'horizon borné, sans boucle de commande par
dossier. Ces assertions portent sur le coût structurel et les comportements,
pas sur quelques millisecondes propres au matériel du runner.

## Exécution et rapport

Avec Node 22, la compilation runtime et l'image locale `postgres:16-alpine`:

```sh
yarn build
node --test tests/integration/publication-backlog-performance.integration.mjs
```

Le test limite chaque statement à 30 secondes et le scénario complet à 120
secondes. Il conserve JIT et planification PostgreSQL à leurs valeurs effectives;
il ne désactive aucun garde ni index. Les durées mesurées incluent temps mural
du processus Node, CPU Node, nombre/coût des requêtes et durée des transactions
de préparation et lecture. Une durée de transaction d'écriture est une borne
supérieure de la conservation de ses verrous; elle n'isole pas le temps d'attente
de chaque verrou. La concurrence vérifie progrès et absence de doublon, sans
prétendre prouver un débit maximal ou toutes les interleavings.

`test-results/publication-backlog-performance.json`, ignoré par Git, contient
les volumes, limites, réglages runtime, mesures par phase et résumés des plans
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` des lectures principales et du scan
des candidats, ainsi que des deux statements les plus coûteux de l'état complet.
Les plans conservent types de nœuds, relations/index, lignes,
boucles et buffers; SQL, valeurs liées, expressions, messages, coordonnées,
comptes et clés d'objet sont exclus. Un prochain passage remplace ce rapport;
archiver le JSON avec la révision testée pour conserver une preuve datée.

Les plans sont mesurés après les opérations applicatives: leurs latences ne
représentent donc pas un cache disque froid. La première mesure applicative suit
le chargement et `ANALYZE`, elle aussi sur une base récemment écrite. Consigner
séparément l'effet cache, JIT, concurrence et matériel lors d'une comparaison.

## Portée et adoption

La réception locale du 12 octobre 2026 utilise Node 22 et PostgreSQL 16, avec
JIT actif. Le diagnostic initial mesurait 1,87 s pour les agrégats, 1,59–1,91 s
pour les pages d'incidents et 25,88 s pour l'état complet. Les passages de
diagnostic ont aussi mesuré 18,83–28,56 s pour cet état, montrant la variabilité
locale. Les plans révélaient des millions de lignes examinées par les sous-plans.

La comparaison finale conserve la même fixture et les mêmes gardes. Le calcul
des sources retenues par un envoi incertain utilise un ensemble partagé non
corrélé. Les conflits de compte utilisent les bornes temporelles strictes, avec
les index existants. Aucun index ou changement de migration supplémentaire
n'est nécessaire pour ces deux corrections.

| Port mesuré                                   | Dernier passage                                      |
| --------------------------------------------- | ---------------------------------------------------- |
| Agrégats globaux                              | 0,48 s; une requête                                  |
| Première page et continuation                 | 0,34 s et 0,32 s; une requête par page               |
| Détecteur complet d'alertes                   | 0,26 s; une requête                                  |
| Préparation initiale                          | 0,91 s; 85 requêtes; transaction principale 0,87 s   |
| État administratif complet                    | 11,79 s; 20 requêtes; transaction de lecture 11,79 s |
| Deux préparations et une lecture concurrentes | 0,40 s; aucun doublon ni capacité dépassée           |

Le scénario complet passe en 27,32 s, sans omission. Le test protège également
contre la répétition d'un scan complet des sources incertaines pour chaque
dossier. Les limites strictes à 59 999, 60 000 et 60 001 ms, dans les deux sens,
sont vérifiées séparément avec une réservation incertaine conservée.

Avant le complément de calendrier et visibilité, l'état complet reste lent sur ce volume : ses pages de file répètent encore
des jointures coûteuses. Cette mesure ne constitue pas une qualification de
performance du VPS. Une future optimisation de ces lectures doit conserver les
totaux, règles d'admissibilité et réservations incertaines; les abaisser ou les
ignorer pour accélérer la réponse modifierait le contrat.

Les résultats exécutés figurent dans la
[réception datée](sponsorship-publication-tasks.md). Une mesure locale ne garantit
ni performances sur le VPS, ni quotas sociaux, disponibilité HTTP permanente,
temps SMTP ou délai commercial. Le coût des conflits d'un même compte peut croître
avec le nombre de paires; examiner nombre de lignes éliminées, boucles et buffers
sur une copie représentative avant une forte croissance de ce périmètre.

Une optimisation ou un nouvel index doit être motivé par les mesures, préserver
la portée complète, les mêmes réservations incertaines et les résultats fonctionnels.
Une migration supplémentaire reste additive; un résultat plus rapide obtenu en
ignorant l'historique, une réserve, la modération ou un sous-ensemble d'incidents
ne constitue pas un gain acceptable. Voir aussi le
[guide d'adoption](../operations/sponsorship-delivery-adoption.md).

## Parcours unique de la file

Le complément du 12 octobre remplace les scans SQL répétés par un curseur
PostgreSQL `NO SCROLL`, interne à la transaction de lecture. Le périmètre,
l'ordre `created_at,id`, les filtres et toutes les règles sont évalués une fois.
Le client récupère toujours au plus 200 lignes à la fois et ne garde que la page
demandée ; les totaux sont calculés sur toutes les lignes. Aucun résultat n'est
mis en cache entre requêtes. Le curseur est fermé avant la fin de lecture et un
rollback le ferme automatiquement en cas d'échec.

Le curseur est lu jusqu'au bout pour calculer les compteurs. La transaction
utilise donc `SET LOCAL cursor_tuple_fraction=1` : PostgreSQL planifie une lecture
complète, au lieu de privilégier le démarrage rapide d'un curseur partiellement
consommé. La [documentation PostgreSQL 16](https://www.postgresql.org/docs/16/runtime-config-query.html#GUC-CURSOR-TUPLE-FRACTION)
décrit ce réglage. Il expire à la fin de la transaction ; JIT, permissions,
filtres et limites de volume sont conservés.

La comparaison intermédiaire, avant raccord des nouvelles possibilités de
calendrier, conserve la fixture de 3 000 dossiers, 6 000 obligations, 2 000
livraisons et 20 réservations incertaines. Avec Node 22.23.3, PostgreSQL 16 et JIT
actif, l'état complet passe de **10,01 s à 1,77 s**. Le nombre de requêtes passe
de 20 à 22, car le protocole ajoute déclaration et fermeture du curseur ; les
jointures du périmètre ne sont exécutées qu'une fois. Les 2 250 sources éligibles
et leurs compteurs sont conservés. Le test vérifie ce parcours unique et le plan
de sa vraie requête, plutôt qu'un seuil temporel dépendant du runner.

Après intégration du calendrier, un passage de diagnostic a mesuré 12,83 s,
avec une variation importante également sur les lectures inchangées. Le reçu
final compare donc les deux implémentations sur **la même base jetable**, sans
nouveau chargement entre passages, dans l'ordre actuel, base, actuel, base.
La base est `3d3d5a41`. Les deux variantes utilisent les mêmes règles d'admissibilité,
les mêmes réglages PostgreSQL 16.14 avec JIT actif et les mêmes données ; le
calendrier actuel est conservé dans la variante optimisée.

| Lecture de l'état complet | Premier passage | Passage répété | Requêtes |
| ------------------------- | --------------- | -------------- | -------- |
| Base `3d3d5a41`           | 11,00 s         | 11,64 s        | 20       |
| Complément intégré        | 1,27 s          | 1,18 s         | 28       |

La réduction observée est de 88 à 90 %. Les deux variantes retrouvent les mêmes
2 250 sources, les mêmes statuts et causes, 6 020 incidents, les pages de 200
et les 20 réservations incertaines ; aucune preuve n'est créée. Les requêtes
supplémentaires préparent les possibilités de calendrier et gèrent le curseur,
sans répéter les jointures de la file. La valeur effective hors transaction
reste `cursor_tuple_fraction=0.1`.

Les rapports locaux ignorés `calendar-media-performance-baseline.json`,
`calendar-media-performance-ab.json` et `publication-backlog-performance.json`
conservent les étapes et le profil applicatif final. La comparaison A/B est
un diagnostic local daté, et non un seuil de CI ou une qualification du VPS.
Le test d'intégration versionné protège le parcours unique, les compteurs et
les réservations ; ses assertions restent indépendantes de ces millisecondes.

<a id="dix-grandes-photos"></a>

## Ingestion et aperçu de dix grandes photos

La [recette visuelle](../../tests/integration/publication-visual-load.integration.mjs)
utilise dix originaux JPEG distincts, texturés et déterministes de 6 000 × 4 000
pixels. Chaque original pèse 6,45–6,54 Mio, sous les plafonds applicatifs de 8 Mio
et 40 millions de pixels. Le vrai service d'ingestion produit les WebP de
2 000 × 1 333 pixels, de 0,70–0,71 Mio, ensuite lus par le vrai stockage privé
local. Le rendu utilise ces images normalisées, comme le parcours applicatif.

Les phases sont isolées dans des processus Node frais : ingestion, composition,
résolution complète, aperçu du premier index et dix aperçus concurrents par
`Promise.all`. Deux préparations privées utilisent les mêmes dix photos, pour
une collection LinkedIn et un composite. La base PostgreSQL est jetable ; aucun
envoi HTTP, approbation de livraison, réservation d'envoi ou preuve d'exécution
n'est créé. Les vingt obligations restent à réaliser.

La réception du 12 octobre 2026 compare la base `123966b1` et le correctif local
sur `feat/sponsorship-visual-load-reception`, avec Node 22.23.3. Les empreintes
des dix originaux, des WebP et des JPEG finaux sont identiques entre passages ;
le composite conserve aussi ses octets exacts. Les propriétaires, versions et
hashes sources sont comparés à la fixture indépendante, avec dix JPEG distincts
dans la galerie.

Le tableau reprend le premier passage comparatif archivé. Après la correction
du nettoyage IPC, le contrôle final retrouve les mêmes empreintes et compteurs ;
les dix aperçus prennent 4,05 s, avec 19,69 s de CPU et 318,8 Mio de pic RSS.
L'écart entre les deux passages confirme que les durées restent informatives.

| Phase API                    | Durée avant → après | CPU avant → après | Lectures / JPEG avant → après | Pic RSS avant → après |
| ---------------------------- | ------------------- | ----------------- | ----------------------------- | --------------------- |
| Composition de la collection | 2,05 → 1,16 s       | 2,74 → 1,66 s     | 20 / 20 → 10 / 10             | 145,2 → 131,2 Mio     |
| Résolution de la collection  | 2,01 → 1,07 s       | 3,41 → 1,44 s     | 20 / 20 → 10 / 10             | 145,8 → 128,0 Mio     |
| Aperçu du premier JPEG       | 2,01 → 1,09 s       | 3,03 → 1,33 s     | 20 / 20 → 10 / 10             | 147,0 → 127,3 Mio     |
| Dix aperçus concurrents      | 6,54 → 3,31 s       | 31,86 → 16,66 s   | 200 / 200 → 100 / 100         | 346,6 → 330,7 Mio     |
| Résolution du composite      | 1,65 → 1,67 s       | 2,34 → 2,38 s     | 20 / 11 → 10 / 11             | 142,9 → 133,2 Mio     |

Le correctif supprime la seconde lecture privée et réutilise le JPEG déjà
préparé pour une image source ou une collection. La collection conserve les
JPEG nécessaires, sans retenir toutes les sources brutes. Un composite exige
toujours les sources pour son montage et son JPEG final ; sa durée n'a pas
diminué dans cette mesure. Les dix aperçus revalident chacun leurs dix
dépendances, d'où les cent lectures restantes. Aucun cache entre requêtes,
allègement des droits ou rendu du seul index demandé n'est introduit.

Les compteurs structurels sont protégés en CI : une lecture par source,
dix JPEG par collection, cent pour dix aperçus, onze pour un composite et zéro
requête externe. Les durées et la mémoire sont informatives, sans seuil lié
au matériel. Le RSS est échantillonné toutes les 10 ms ; le rapport conserve
aussi le maximum du processus complet. L'ingestion globale inclut la génération
synthétique et les IO ; chaque durée individuelle de normalisation est mesurée
séparément. Le cache du système de fichiers n'est pas forcé à froid.

Les rapports ignorés `test-results/publication-visual-load-baseline.json` et
`test-results/publication-visual-load-current-comparison.json` conservent le
passage comparatif du tableau. `test-results/publication-visual-load-current.json`
conserve le dernier contrôle. Le contrôle final avant défragmentation est archivé
dans `test-results/publication-visual-load-before-defrag.json`. Ces rapports contiennent réglages runtime,
volumes, empreintes et mesures agrégées. Pour reproduire après compilation :
`node --test --test-concurrency=1 tests/integration/publication-visual-load.integration.mjs`.
Le label de test `FUNDING_VISUAL_LOAD_REPORT=baseline` conserve une mesure de
référence sans exiger les compteurs optimisés ; la réception courante utilise
le label par défaut et exige ces compteurs.

Cette recette mesure les services API et le stockage local, sans transport HTTP,
décodage ou mémoire navigateur, stockage S3 ni upload fournisseur réel. Elle
ne qualifie pas un SLA de production. Les albums Facebook restent soumis à la
[qualification du connecteur](../technical/publication-formats.md#qualification-des-api-officielles).

Un [contrôle navigateur distinct](../../tests/playwright/publication-collection-preview.ui.ts)
utilise les mêmes originaux texturés et la même normalisation : dix vrais JPEG
de 2 000 × 1 333 pixels, avec API interceptée, sur ordinateur en français et
mobile en anglais. Une dernière réponse bloquée interdit l'approbation malgré
la confirmation cochée. Après réception des dix Blobs vérifiés, le test contrôle
leurs digests dans l'ordre, leur décodage, leurs dimensions et leur affichage,
puis une unique approbation N0. Le produit attend les Blobs vérifiés ; le test
observe le décodage avant le clic, sans ajouter une nouvelle condition au bouton.
Ce contrôle fonctionnel ne chronomètre pas le navigateur ni sa mémoire.

Le [générateur d'images partagé](../../tests/integration/support/publication-visual-load-images.mjs)
ne dépend que de Sharp et des primitives Node. Les recettes Node et
navigateur l'utilisent directement ; le navigateur ne charge plus la fixture
SQL ou ses helpers de modération. Le registre de tests existant délègue les
deux parcours à dix photos au module dédié, avec le même contexte et les mêmes
assertions. Cette séparation ne modifie pas la normalisation, les octets JPEG
ni les compteurs de la recette.
