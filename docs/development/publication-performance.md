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

L'état complet reste lent sur ce volume : ses pages de file répètent encore
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
