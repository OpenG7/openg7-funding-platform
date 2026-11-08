# Connecteur Funding vers OpenG7 Preflight

Date : 2 novembre 2026. Statut : code initial implémenté, raccordement de
production non qualifié.

## Contexte

Preflight prépare des travaux pour plusieurs applications. Funding possède les
engagements, leurs prestations, les consentements, les approbations et les
autorisations de publication. Les versions de ces objets ne constituent pas une
révision unique utilisable directement par le moteur de missions Preflight.

## Décision

Le connecteur métier réside dans apps/funding-api/src/preflight. Un relais
indépendant utilise la même image backend, sans devenir un dépôt ou un moteur
de workflows supplémentaire. Preflight conserve ses contrats HTTP génériques.
Aucun import de sources d’un dépôt voisin n’est présent dans l’application.

L’activation vérifiée conserve une intention d’envoi dans la même transaction.
Une outbox source, distincte de la file de tâches interne de Preflight, permet
les appels réseau après commit, les reprises et la déduplication. Le snapshot
minimisé possède une empreinte et une révision monotone. Le worker réconcilie
les sources déjà suivies pour détecter leurs changements et invalider les
préparations précédentes; chaque mutation métier n’émet pas encore son événement.

L’authentification serveur utilise OAuth2 client_credentials, JWT de service,
tenant et application autorisés. L’import valide les résultats, contrôles,
provenance et version courante, puis conserve seulement une proposition privée.
La console Funding permet sa consultation; aucune action d’approbation,
publication ou mutation financière n’est ajoutée à ce panneau.

## Alternatives et conséquences

Un dépôt de connecteurs ou un service supplémentaire imposerait un cycle de
publication indépendant avant qu’un besoin de réutilisation soit établi. Un
futur client HTTP commun pourra être extrait quand plusieurs consommateurs
partageront un contrat stabilisé; les règles Funding resteront dans Funding.

Un appel HTTP dans la transaction métier couplerait confirmation et disponibilité
du fournisseur. Un appel sans intention persistée pourrait perdre une mission
après commit. L’outbox ajoute du stockage opérationnel et une supervision, avec
des messages conservés et des échecs en quarantaine plutôt qu’un exactly-once
externe supposé.

La migration 068 est additive et n’active aucun traitement ni backfill historique.
Le relais est désactivé par défaut. Son activation réelle, les identités,
certificats, secrets et contrôles côté VPS restent séparément qualifiés.
Le retour vers les décisions métier et les lots approuvés reste à raccorder
explicitement; la présence d’une proposition ne fournit pas cette autorisation.

Contrat, variables, endpoints et limites : [guide du connecteur](../technical/preflight-connector.md).
