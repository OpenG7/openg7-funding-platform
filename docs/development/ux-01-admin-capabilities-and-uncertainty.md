# PR-UX-01 — capacités financières et issues incertaines

Travail local du **18 octobre 2026**, branche
`fix/ux-01-admin-permissions-and-uncertainty`, préparée depuis
`9bd24edb1c2d86d942907023e7fa53aa12fd41fd` (branche de PR 350).
L'[audit PR-UX-00](ux-00-current-platform-audit.md) a été écrit avant les
changements applicatifs. Ce document consigne leur portée et leurs validations;
il ne constitue ni une fusion ni une preuve de déploiement.

## Résultat visible

Factures distingue la génération owner des renvois operator/owner. Les trois
rôles conservent consultation, aperçu et PDF. Une session absente, expirée ou
cookie sans identité ne donne pas de capacité de mutation. Le mode local
historique utilise le jeton validé par la session existante; la vérification
cryptographique et tous les droits restent dans l'API.

Dépenses présente les champs en lecture seule aux autres rôles et retire leurs
commandes de création, édition, publication, masquage et archivage. Les preuves
restent consultables. Les confirmations et versions existantes sont conservées;
les capacités sont revérifiées après confirmation. Le dernier snapshot est
explicitement ancien après erreur de relecture, et les mutations attendent une
lecture valide. Les refus 401/403 continuent de purger les données privées.

Le statut SMTP `uncertain` est affiché comme tel. Une réponse perdue ne permet
plus de modifier le destinataire et de créer une autre demande documentaire.
L'UUID initial et un verrou opaque par document sont conservés en session;
le chargement restaure le blocage. Un POST acquitté reste confirmé même si la
lecture suivante échoue, avec son messageId reçu et son lien exact vers la file.
Sans messageId connu, le lien de vérification ouvre la file générique.

Après une création Dépenses ou une demande d'information non acquittée, un marqueur
opaque posé avant POST empêche une nouvelle demande dans la même session de
navigateur, y compris après navigation/rechargement lorsque son stockage est
disponible. Aucun corps, destinataire ni secret n'est persisté. L'Assistant
conserve son payload confirmé en mémoire, bloque préparation/édition/envoi et
indique que relire le dossier ne confirme pas la livraison. Un refus définitif
reste distinct d'une issue inconnue, y compris depuis le contexte implicite du
Cockpit. HTTP 408 est traité comme une réponse incertaine.

Le remboursement ferme le formulaire et relit l'état après une erreur de
transport/408/5xx, en bloquant la version soumise. Une réponse acquittée suivie
d'une lecture échouée ne devient pas un échec financier. Les claims, versions et
clés Stripe côté serveur restent inchangés. Une observation de visibilité garde
son UUID tant que son résultat n'est pas établi, puis le libère après confirmation
POST/GET, même si le tiroir est réouvert par le callback de succès.

## Limites et reçus consultables

- Le complément OUX-006 permet de vérifier manuellement un renvoi de facture ou
  d'avoir par [reçu GET lié à l'acteur](../technical/admin-api.md#document-resend-receipts),
  UUID et document exacts. Le reçu distingue commande enregistrée et livraison.
  `sending`/`uncertain` conservent le marqueur et sa vérification après rechargement ;
  un reçu `queued`/`sent`/`failed` permet de lever le verrou de cette requête.
  Absence, indisponibilité ou refus ne déclenchent ni déverrouillage ni nouvel envoi.
  La projection Factures ne donne toujours pas le dernier messageId ; seul le reçu
  de la demande exacte fournit le lien vers son message.
- Demande d'information Assistant et création Dépenses n'offrent toujours pas de
  reçu consultable. Leur relecture générique ne déverrouille pas une opération
  inconnue ; leur résolution reste un travail de contrat serveur séparé.
- La file courriel conserve son workflow versionné de réconciliation avec preuve.
  Le lien générique n'affirme pas identifier un message dont l'ID n'a pas été reçu.
- Si le stockage de session est refusé, les verrous de création/information/renvoi
  protègent l'instance ouverte seulement. Ils ne constituent pas une garantie
  serveur entre onglets, navigateurs ou appareils. Une réponse documentaire
  arrivée après destruction conserve par prudence son verrou, sans rétablir l'UI.
- L'UUID d'observation de visibilité est conservé pendant la vie du contrôleur;
  cette commande observe le fournisseur et ne publie pas de contenu social.
- Les modes Assistant disabled/mock, Sharp technique local, vision/OCR
  not_configured et livraison mock étaient déjà honnêtes dans le code audité.
  Ils sont préservés, sans nouvelle IA ni preuve de livraison extérieure.
- La composition du shell, les quatre espaces de travail, le placement du bouton
  de modération, les cinq onglets et alias media/refund restent hors du changement. Aucun
  organisme de modération concurrent, changement d'autorisation API, migration,
  secret ou opération de production.

## Fichiers et justification

<!-- prettier-ignore -->
| Groupe | Fichiers concernés | Raison |
| --- | --- | --- |
| Capacités de présentation | `services/admin-financial-capabilities.ts`, page Factures, page Dépenses | Capacité exacte et rôle/session courants; aucun assouplissement API |
| Dépenses | card/create/form-fields, contrats locaux, mutation-workflow et style lecture seule | Champs/commandes cohérents, confirmations conservées, stale et création incertaine |
| Livraison documentaire | delivery-controller, modèles locaux, delivery.component, email-status.component | Destinataire figé, UUID/verrou conservés, statut explicite et vérification dans la file |
| Assistant | context-controller et façade/template | Demande inconnue bloquée après navigation, refus définitif distinct |
| Remboursement | refund-workflow | Relire avant nouvelle opération; fait acquitté distinct d'une lecture indisponible |
| Observation de visibilité | delivery-controller, command-workflow, ports et deux consommateurs page/scheduling | Résultat local confirmé explicite pour libérer le bon UUID après succès |
| Traductions | catalogues `admin-financial-safety` FR/EN, registre de traductions et initialisation dans AdminLayout | Messages chargés uniquement avec l'administration; composition du shell inchangée |
| Vérification | contrôleurs Node, spécifications UI financières/Assistant/documents/allocations, sélection et typecheck UI | Rôles, refus, pertes de réponses, absence de nouvelle mutation, responsive/focus |
| Références propriétaires | `funding-transparency.md`, `payment-trust-validation.md`, audit et présent rapport | Décrire le comportement courant et ses limites séparément des propositions |

Les chemins Web du tableau sont relatifs au dossier Funding de l'application Web.
Le pack utilisateur est conservé sans modification; ses cinq empreintes SHA-256
restent identiques. Liste exhaustive des fichiers de cette étape, hors pack :

<details>
<summary>Fichiers du diff local PR-UX-01 et rapports</summary>

```text
apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-context-controller.ts
apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-context.component.html
apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-context.component.ts
apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.ts
apps/funding-web/src/app/features/funding/components/admin-publications/admin-publication-automation-command-workflow.ts
apps/funding-web/src/app/features/funding/components/admin-publications/publication-automation.ports.ts
apps/funding-web/src/app/features/funding/components/admin-publications/publication-delivery-controller.ts
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expense-card.component.ts
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expense-create.component.ts
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expense-form-fields.component.html
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expense-form-fields.component.ts
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-mutation-workflow.ts
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-page.component.css
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-page.component.ts
apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses.contracts.ts
apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-document-delivery.component.ts
apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-document-email-status.component.ts
apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoice.models.ts
apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoices-page.component.ts
apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-page.component.ts
apps/funding-web/src/app/features/funding/services/admin-document-delivery-controller.ts
apps/funding-web/src/app/features/funding/services/admin-financial-capabilities.ts
apps/funding-web/src/app/features/funding/services/admin-financial-translations.ts
apps/funding-web/src/app/features/funding/services/admin-sponsor-refund-workflow.ts
apps/funding-web/src/app/features/funding/services/admin-sponsor-scheduling-controller.ts
apps/funding-web/src/assets/i18n/admin-financial-safety.en.json
apps/funding-web/src/assets/i18n/admin-financial-safety.fr-CA.json
docs/development/ux-00-current-platform-audit.md
docs/development/ux-01-admin-capabilities-and-uncertainty.md
docs/funding-transparency.md
docs/payment-trust-validation.md
tests/admin-assistant-context-controller.test.mjs
tests/admin-document-delivery-controller.test.mjs
tests/admin-expenses-mutation-workflow.test.mjs
tests/admin-financial-capabilities.test.mjs
tests/admin-publication-automation-command-workflow.test.mjs
tests/admin-publication-delivery-controller.test.mjs
tests/admin-sponsor-refund-workflow.test.mjs
tests/playwright-admin-ui.config.mjs
tests/playwright/admin-allocation-create-ui.spec.ts
tests/playwright/admin-allocation-edit-ui.spec.ts
tests/playwright/admin-assistant-context.spec.ts
tests/playwright/admin-document-resend-ui.spec.ts
tests/playwright/admin-financial-capabilities.ui.spec.ts
tests/playwright/document-resend-acceptance.spec.ts
tests/tsconfig.admin-ui.json
```

</details>

## Vérifications exécutées

Node **22.23.3**, Yarn **4.9.4**, données synthétiques et API interceptées pour
les tests UI. Le build TypeScript racine précède la suite Node; le build Angular
est exécuté ensuite pour éviter que leurs sorties `dist/` se remplacent.

<!-- prettier-ignore -->
| Commande / périmètre | Résultat du passage final | Niveau de preuve |
| --- | --- | --- |
| `yarn build`, puis `node --test "tests/**/*.test.mjs"` | 7 229 réussis, 8 ignorés, 0 échec; 7 237 cas, 53,3 s | TypeScript, tests Node; aucun fournisseur réel |
| `yarn lint` | 0 erreur, 1 avertissement préexistant dans `scripts/smoke-public.mjs` | Analyse statique |
| `yarn exec tsc -p tests/tsconfig.admin-ui.json` | Réussi | Contrats TypeScript UI |
| Build Angular production | Réussi, 25 routes pré-rendues; initial 899,82 ko, avertissement 800 ko, plafond 900 ko respecté | Compilation et rendu initial configuré |
| Playwright financier, nouveau spec | 13 réussis, 0 échec, 17,2 s | Trois rôles, 403, PDF sans POST, focus, 1536×864/390, texte 200 % et reflow 768×432 |
| Playwright Assistant/allocations/renvois documentaires | 111 réussis, 0 échec, 3,8 min; total navigateur 124 réussis | Navigateur sur Web compilé, API interceptées |
| Standards, budgets/liens, sélection E2E | Réussis; 22 routes admin, 18 garanties, 151 fichiers E2E sélectionnés | Découverte, aucune exécution E2E implicite |
| Prettier ciblé, revue du diff, `git diff --check` | Réussis | Changements de cette branche |

Commandes navigateur exécutées, après le build Angular final :

```powershell
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-financial-capabilities.ui.spec.ts --max-failures=3 --output=test-results/ux01-financial
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-document-resend-ui.spec.ts admin-assistant-context.spec.ts admin-allocation-create-ui.spec.ts admin-allocation-edit-ui.spec.ts --max-failures=4 --output=test-results/ux01-workflows
```

Le premier passage Node ciblé comptait 201 réussites et un échec d'assertion de
message après relecture d'un remboursement; l'assertion a été corrigée et la suite
complète ci-dessus passe. La revue a aussi corrigé les cas de génération du
tiroir de visibilité et de cible Assistant implicite, avec tests de régression.
Le premier build Angular atteignait 901,88 ko et échouait au plafond de 900 ko.
Les messages financiers ont ensuite été isolés dans des catalogues admin différés,
sans augmenter les budgets. Le build final ci-dessus passe. Les anciens chiffres
du blueprint ne sont pas réutilisés comme preuves nouvelles.

Les recettes Docker/SMTP/Stripe/OIDC, les comptes externes, la manette physique et
la production ne sont pas qualifiés par ces tests. Le test d'agrandissement de
texte à 200 % et le reflow à 768×432 CSS (équivalent à la moitié de 1536×864)
restent distincts d'un zoom natif du navigateur sur un écran réel à 125 %.

Les premiers passages UI ont été arrêtés sur quatre variantes d'un scénario qui
tentait une sauvegarde pendant un chargement, puis sur trois cas de focus perdu
après annulation. Le scénario vérifie maintenant le blocage puis une lecture
réussie; les boutons ouvrants restent disponibles pendant le dialogue et le
verrou interne empêche toujours les doubles mutations. Les résultats du tableau
correspondent aux passages finaux.

## Captures locales

Les artefacts sont locaux et ignorés par Git. Ils montrent des données fictives :

- [Factures, owner, 1536×864](../../test-results/ux01-financial/admin-financial-capabiliti-4a32e--actions-in-fr-CA-at-1536px/invoices-owner-1536.png)
- [Dépenses, operator, 390 px](../../test-results/ux01-financial/admin-financial-capabiliti-59049-wner-actions-in-en-at-390px/expenses-operator-390.png)
- [Justificatif et reflow 768×432](../../test-results/ux01-financial/admin-financial-capabiliti-513c5-rt-equivalent-to-200-reflow/expenses-reflow-equivalent-200-percent.png)

Les captures et mesures du spec financier ont été inspectées. Les captures de
réponse perdue de l'Assistant sont sous `test-results/ux01-workflows/`.

## États documentaires

<!-- prettier-ignore -->
| État | Référence |
| --- | --- |
| Inventorié | Blueprint du code b00 fourni par PR 350 |
| Proposé | Pack V1/V2 utilisateur, conservé sans modification |
| Audité | PR-UX-00 sur HEAD 9bd, avant modification applicative |
| Implémenté | Diff local PR-UX-01 sur la branche indiquée |
| Vérifié | Seulement les commandes et périmètres réussis du tableau ci-dessus |
| Déployé | Non vérifié; aucune publication ni opération de production effectuée |
