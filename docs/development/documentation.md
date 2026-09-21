# Documentation et budget de contexte

Les consignes se lisent par tâche : socle commun, règles des chemins touchés,
puis domaines et opérations concernés. Déplacer un texte sans supprimer sa
lecture systématique n'économise pas de contexte. Ne pas lire ce guide pour une
tâche ordinaire sans changement documentaire ou d'instructions.

## Responsabilité des documents

<!-- prettier-ignore -->
| Source | Contenu à maintenir ici |
| --- | --- |
| [AGENTS racine](../../AGENTS.md) | Garde-fous universels, autorisations, workflow court et déclencheurs de lecture |
| AGENTS Web/API/packages/scripts | Règles d'implémentation propres au chemin, sans copie du socle |
| [Architecture FR](../ARCHITECTURE.md) / [EN](../ARCHITECTURE.en.md) | Frontières durables et raisons; une langue par lecture, deux versions synchronisées |
| [Validation](validation.md) | Commandes, préconditions et garanties par changement |
| [Finance](financial-rules.md), [commandites](sponsorship-rules.md) | Invariants et scénarios métier transversaux aux chemins |
| [README](../../README.md), [index](../README.md) | Démarrage et orientation vers une référence, sans recopier toutes les procédures |
| [Références API](../technical/admin-api.md) et guides fonctionnels | Contrats détaillés, parcours, états et limites actuelles |
| Runbooks sous `docs/operations/` | Cibles, commandes exactes, préconditions, reprise et preuves opérationnelles |
| ADR sous `docs/decisions/` | Décision structurante, alternatives et conséquences |
| [État de la plateforme](../platform-status.md) | Fonctionnalités actuelles distinctes des preuves datées; archives consultées à la demande |

Mettre à jour le guide propriétaire quand changent commande, variable, endpoint,
statut, migration, flux financier, page, règle de commandite, stockage ou opération.
Les scripts/manifests/code restent la vérité technique. Ne pas dupliquer un tableau
de valeurs volatiles; pointer vers la configuration typée et ses tests.
Vérifier les liens/ancres lors des déplacements, remplacer les renvois à des numéros
de section par des ancres stables. Utiliser des identifiants explicites pour les
garde-fous référencés. Dater les preuves; aucun secret ou preuve inventée.

## Budgets et contrôle

Le socle est plafonné à **8 Kio**; chaque chaîne racine → instructions locales à
**16 Kio**. Les références ne sont pas automatiquement ajoutées à la chaîne :
leurs déclencheurs sont dans le socle. Garder de la marge pour les instructions
globales et les autres sources de contexte.

Les plafonds par document sont déclarés dans
[check-agent-docs.mjs](../../scripts/check-agent-docs.mjs). Pour une nouvelle règle,
choisir d'abord son propriétaire et son déclencheur; modifier un plafond demande
une justification, pas une augmentation pour absorber une duplication.

```sh
node scripts/check-agent-docs.mjs
node scripts/check-agent-docs.mjs --json
```

Le contrôle est en lecture seule, sans dépendance ni réseau. Il vérifie tailles
UTF-8, chaînes d'instructions, cibles/ancres des liens Markdown directs et scripts
Yarn documentés dans les fichiers suivis par le budget. Un nouvel AGENTS sans
budget échoue. Le workflow `agent-docs.yml` exécute ce contrôle sur les PR documentaires.
Les exemples de liens dans les blocs de code et les URL externes ne sont pas vérifiés;
le parseur couvre les titres ATX, ancres HTML et liens directs utilisés ici, pas
toute la syntaxe Markdown. Les autres guides restent à relire lors de leur modification.

Les scénarios `documentation`, `web`, `payment`, `architecture` rendent visibles
les lectures minimales sélectionnées. Ils excluent code, résultats d'outils,
runbooks supplémentaires, historique, cache et instructions globales : ce ne sont
ni des tokens mesurés ni une estimation de facturation. Pour un compte de tokens,
utiliser le même tokenizer avant/après et les mêmes scénarios de lecture.

## Reprise des anciennes consignes

Correspondance des sections de l'AGENTS monolithique du 21 septembre 2026.
Cette table sert à revoir le découpage; les numéros ne sont plus des destinations.

<!-- prettier-ignore -->
| Anciennes sections | Propriétaire après découpage |
| --- | --- |
| 1–5 : portée, contexte, garde-fous, risques, procédure | Socle racine; validation commune pour les contrôles |
| 6–7 : responsabilités et dépendances | Consignes Web/API/packages/scripts et architecture |
| 8–9 : Angular, composition et Done UI | Consignes Web; validation commune |
| 10 : Checkout, webhook, frais, test/live | Finance; socle et scripts pour l'autorisation live |
| 11 : schéma, migrations, transactions | Consignes API et runbook migrations |
| 12 : montants, journal, factures et avoirs | Finance |
| 13 : reconnaissance, revue, visibilité, publication, provenance | Commandites; finance pour les sources externes |
| 14 : sessions, guards, confirmations et audit | API, Web, socle et runbook identité |
| 15 : projection publique et consentement | Finance et commandites |
| 16 : stockage et validation média | Commandites et runbook OVH |
| 17–18 : courriels, remboursement, backfill, réconciliation | Finance et guides SMTP/Stripe |
| 19 : validation, erreurs, idempotence et compatibilité API | Consignes API; packages pour les consommateurs |
| 20–21 : exploitation, commandes et validations | Scripts, aide-mémoire, matrice commune et runbooks |
| 22 : scénarios de test | Finance, commandites et matrice commune |
| 23 : observabilité et logs | Consignes API et architecture |
| 24 : sauvegarde, restauration et médias | Consignes scripts et runbooks |
| 25 : dépendances et environnement | Socle racine |
| 26–27 : documentation et ADR | Ce guide et architecture |
| 28 : frontière IA | Socle, API et architecture |
| 29–30 : checklist PR et compte rendu | Workflow racine et matrice commune, rubriques applicables seulement |
| 31 : maintenance | Ce guide et contrôle de budgets |
| Ajout pilotage administratif | Web/API, architecture FR/EN et runbook pilotage |

Relire les destinations selon les risques : garder les quinze garde-fous dans le
socle, les exceptions d'approbation différée avec leurs conditions, les limites des
migrations et les issues incertaines. La concision ne doit pas supprimer une
précondition ou étendre une autorisation. Ne pas recopier l'ancien monolithe dans
un document que chaque tâche serait ensuite tenue de lire.
