# Pilotage administratif par commandes explicites

Statut : retenu pour la réalisation sur `feat/admin-controller-pilotage`.

Le poste de pilotage présente une décision à la fois, ses faits, la proposition
et sa conséquence. La référence visuelle fournie par l’utilisateur guide sa
composition : carte centrale, file à droite, commandes Xbox en bas.

Les entrées physiques sont normalisées dans une fonction pure. Un adaptateur
navigateur gère connexion, visibilité et focus ; la page traduit les intentions
en commandes métier. Clavier et boutons visibles partagent cette orchestration.
Une confirmation est liée à la cible et à sa version. Les boutons doivent être
relâchés après un changement de contexte ; les mutations ne se répètent pas.

Une projection réutilise les publications, la file d’attention et les réalisations.
Les commandes serveur forment un catalogue fermé. Le registre de l’assistant IA
reste en lecture seule. Les règles financières, les autorisations API et les
workers existants demeurent les autorités de leur domaine.

Des reçus persistants empêchent la réexécution d’une requête perdue. Le reçu et
les services qui ouvrent déjà leur propre transaction ne constituent pas une
transaction unique : une interruption entre mutation et reçu produit un état
incertain, jamais une relance aveugle. Les versions métier empêchent aussi de
réexécuter la même décision avec une nouvelle clé. Les reçus ne contiennent pas
le texte de publication, les coordonnées des contributeurs ou les entrées brutes.

Le pilotage est une route additionnelle. Le profil de manette reste local à l’appareil; la position
de lecture et la reprise du reçu restent locales à la session du navigateur. Aucun nouveau store global,
aucun privilège de l’assistant et aucun déploiement automatique ne sont introduits.
Une qualification physique reste distincte des tests avec entrées simulées.
