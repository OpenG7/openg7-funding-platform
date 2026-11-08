# Atelier de publication du dossier

L’onglet Publication du dossier de commandite regroupe la préparation commune,
les déclinaisons et les livraisons. Preflight prépare des propositions privées;
Funding conserve les décisions et les moteurs de diffusion existants.

## Cartographie préalable

Funding possède un [connecteur durable](preflight-connector.md), une boîte distante
et une recette synthétique. L’Atelier ajoute la préparation éditoriale par dossier
et son adoption privée. Le connecteur et l’Atelier conservent des registres de
versions distincts pour la même source; leur activation simultanée est refusée
avant le démarrage des traitements.

| Responsabilité                   | Propriétaire et composants réutilisés                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Accord et prestations promises   | Funding : `sponsorship-commitments/*`, versions d’engagement et obligations                       |
| Identité et consentement public  | Funding : dossier, consentement documenté et reçus audités                                        |
| Préparation administrative       | Funding : `admin-preparation.service.ts` et préparation par prestation                            |
| Missions et propositions privées | Preflight : contrats v1, `workflows.ts`, moteur, worker et persistance JSONB                      |
| Transport authentifié            | Funding : `preflight/client.ts`, OAuth et validation du contrat distant                           |
| Revue exacte et édition          | Funding : examen par prestation, sauvegarde de brouillon et contrôle de version                   |
| Autorisation et exécution        | Funding : modération, publication Web et moteur social existants                                  |
| Preuves de livraison             | Funding : preuves qualifiées par obligation; aucune réponse IA ne fait preuve                     |
| Présentation du dossier          | Funding Web : `admin-sponsorship-publication`, contrôleur de programmation et tiroir de livraison |

## Contrats et versions

L’enveloppe mission v1 et les deux workflows existants restent compatibles.
Un contexte éditorial optionnel versionné permet au workflow de commandite de
préparer un contenu commun et des déclinaisons Web/Facebook sans nouveau moteur.
Chaque déclinaison référence sa destination et son obligation exacte.
Pour les accords à passages multiples, la préparation vise le prochain passage
non livré de chaque destination et cible. Toutes les versions des obligations
ouvertes participent à l’empreinte source; les prestations restantes restent
conservées. Une livraison ou un ajustement fait avancer la préparation du passage
suivant, sans gonfler les réponses de transport avec des copies du même texte.

La version de l’accord, la révision monotone du snapshot source, son empreinte,
la proposition Preflight, le contenu commun, les déclinaisons, le brouillon
Funding, l’approbation et la livraison constituent des références distinctes.
Une nouvelle proposition ne remplace pas silencieusement un brouillon modifié.
Les propositions obsolètes restent consultables, sans pouvoir être adoptées
comme courantes.

Les versions du contenu commun et des déclinaisons commencent à 1 dans chaque
proposition. Les adaptations Web/Facebook sont déterministes à partir d’un même
brouillon IA validé. Les médias restent sans sélection : cette évolution ne
qualifie aucun droit d’utilisation par destination.

## Données et autorité

Le snapshot transporte uniquement les faits nécessaires et autorisés. Sans
consentement public, aucun nom public n’est transmis comme matériau publiable.
Les coordonnées privées inutiles sont exclues. Les informations absentes et
les consentements manquants produisent une préparation partielle, consultable
pour examen, sans autorisation implicite.

La préparation et l’adoption d’une proposition ne constituent ni une approbation
éditoriale, ni une autorisation de diffusion. Chaque destination conserve ses
contrôles Funding, sa version approuvée et ses preuves. Les modifications et
conflits sont revérifiés côté serveur. La provenance identifie explicitement
le fournisseur simulé; aucun fournisseur payant n’est activé par cette évolution.

L’adoption confirmée peut remplacer le résumé Web courant par le résumé proposé,
dans le profil natif tenu privé. La confirmation l’indique explicitement. Une
modification source postérieure à la génération bloque cette adoption. Un
brouillon social modifié manuellement bloque le remplacement et annule
l’ensemble de la transaction; aucune proposition ne l’écrase automatiquement.
Le titre et le corps détaillé restent consultables dans la proposition, tandis
que la publication Web conserve les champs et limites de son propriétaire natif.
La provenance distante vérifiée appartient au contrat Atelier et à son adoption
persistée. Le reçu d’examen natif conserve son contrat historique
`origin: funding` et `preflightLink: unverified` pour le contenu Funding courant.

## Réutilisation de l’interface

L’Atelier réunit la préparation éditoriale commune, les prérequis nécessitant
une intervention et les cartes de livraison. L’accord original et les obligations
détaillées restent consultables. Les éditeurs, l’examen, les médias, la modération
et le tiroir de publication conservent leur responsabilité.

Une action principale indique la prochaine étape d’une destination. L’assistant
contextuel explique les blocages et les interventions attendues à partir des
faits disponibles. Il ne prend aucune décision à la place de l’administration.

## Déclenchement et API privée

Les triggers de la migration 069 enregistrent durablement les changements de
dossier, d’engagement, d’obligation, de média, d’affectation, de consentement et
de brouillon. Le relais backend les réconcilie toutes les deux secondes lorsque
son activation est explicite. Une même empreinte automatique réutilise sa mission.
Une régénération explicite crée une nouvelle révision après un résultat terminal.
Le contenu de mission est immuable; les appels réseau ont lieu après commit.

Avant une nouvelle mission, le relais notifie `source.updated`. Une réception
incertaine est réconciliée avec le même identifiant de mission avant renvoi.
Funding consulte ensuite les résultats, vérifie le tenant, la source, les
obligations, les contrôles et la provenance, puis conserve la proposition privée.
La version courante est revalidée à la lecture et à l’adoption.

| Méthode | Route sous `/api/admin/sponsorships/publication-workshop` | Effet                                                                                   |
| ------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET     | `?contributionId=<uuid>`                                  | Lecture seule du suivi, de la proposition courante et des 30 dernières propositions     |
| POST    | `/prepare`                                                | Préparation ou régénération avec `contributionId`, `expectedSourceVersion`, `requestId` |
| POST    | `/adopt`                                                  | Adoption dans les brouillons natifs avec les mêmes champs et `proposalId`               |

Les lecteurs administratifs consultent les données; seuls les opérateurs et
propriétaires commandent la préparation ou l’adoption. Les POST exigent l’origine
Funding exacte, du JSON borné et un identifiant de requête scellé à l’acteur et au
contenu. Les paramètres de portée fournis par le client sont refusés. Les réponses
restent `private, no-store`; les versions concurrentes produisent un conflit.
L’approbation et la publication ne font pas partie de ces routes.

## Qualification

Le raccordement exige la migration additive
[069](../../apps/funding-api/migrations/069_publication_workshop.sql), après la
migration 068 du connecteur, et les grants API correspondants.
`PREFLIGHT_WORKSHOP_ENABLED=false` reste la valeur initiale. Le connecteur conserve
son flag `PREFLIGHT_ENABLED`; l’API et son worker refusent les deux flags à `true`
avant tout traitement. La boîte
distante et la recette synthétique possèdent leurs propres flags et n’activent
pas ce relais.

L’overlay [workshop](../../docker-compose.preflight-workshop.yml) se place après
l’overlay [inbox](../../docker-compose.preflight-inbox.yml) et les overlays TLS et
identité déjà utilisés. Il configure le flag Atelier et désactive le producteur
du connecteur. Il réutilise le secret serveur monté en lecture seule et
sa copie privée en mémoire; aucun secret ne passe au navigateur. Les endpoints
HTTPS, le tenant et le client limités à `funding-platform` restent configurés
côté serveur. `PREFLIGHT_MAX_COST_USD` borne le budget demandé par mission sans
activer un fournisseur IA payant.

Activer le relais autorise la préparation des dossiers Funding concernés et leur
réconciliation; cette décision opérationnelle est distincte de l’installation du
code. Conserver les overlays et la configuration privée lors des recréations.
Aucun service, compte, consentement ou dossier réel n’a été modifié par la recette
sur données synthétiques.

Les tests unitaires, PostgreSQL jetable et navigateur sur fixtures prouvent des
périmètres distincts. Une recette avec IA simulée ne qualifie ni un fournisseur
IA réel, ni les identités, les médias ou la diffusion de production. Les commandes
applicables sont décrites dans la [matrice de validation](../development/validation.md).

Validation locale du 8 novembre 2026 : builds TypeScript et Angular/SSR, contrôle
des types des tests UI, suite Funding de 7 699 réussites et 8 tests ignorés,
3 intégrations Atelier et 33 régressions PostgreSQL réussies. Les 25 scénarios
navigateur distincts couvrent notamment FR/EN, Nuit, clavier, Axe, mobile,
historique, conflit, droits et reprise. La recette inter-dépôts valide 5 tests
avec l’API et le worker Preflight réels et l’IA simulée. Preflight valide aussi
61 unités et 13 tests PostgreSQL. Le lint ne présente aucune erreur; son
avertissement préexistant dans `scripts/smoke-public.mjs` reste hors périmètre.
Un complément de 35 tests API/client/worker passe également sous Node 22.23.3
dans un conteneur jetable sans réseau externe, avec sources et dépendances de
test montées en lecture seule.
