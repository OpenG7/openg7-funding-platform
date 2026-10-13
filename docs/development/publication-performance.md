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
