# Réception de l'unification UX

Inventaire du **19 octobre 2026**, pour OUX-017 et PR-UX-06 du
[plan fourni](openg7-ux-unification-pack-v1/openg7-ux-backlog-priorise-v1.md).
Les scénarios ci-dessous existent dans les suites actives des lots UX-02 à UX-05.
Leur présence ne constitue pas un résultat de test sur une nouvelle révision.
Les règles de [finance](financial-rules.md), de
[commandite](sponsorship-rules.md) et la [matrice de validation](validation.md)
restent propriétaires des invariants et des préconditions.

Pour OUX-016, voir la [mesure des bundles](ux-bundle-performance.md).

## Traçabilité des lots

État constaté le **19 octobre 2026** : UX-00/01 sont fusionnés sur `main` par
la PR #352. Les lots suivants sont préparés dans des PR ouvertes ; leur présence
dans cette branche ne signifie ni fusion dans `main`, ni déploiement.
Les liens des PR donnent leurs derniers contrôles CI et leurs dépendances.
Le pack fourni reste le cadrage d'origine.

<!-- prettier-ignore -->
| Lot | OUX | Référence | Périmètre et état de réception |
| --- | --- | --- | --- |
| UX-00 | 001–002 | [#352](https://github.com/OpenG7/openg7-funding-platform/pull/352), [audit courant](ux-00-current-platform-audit.md) | Cartographie et écarts sur `main` ; retour Assistant vers onglet/fragment/focus initial non qualifié. |
| UX-01 | 003–006 | [#352](https://github.com/OpenG7/openg7-funding-platform/pull/352), [capacités et incertitude](ux-01-admin-capabilities-and-uncertainty.md) | Capacités financières et blocage des reprises incertaines sur `main` ; contrats de reçu manquants conservés comme limites. |
| UX-02 | 007–008 | [#353](https://github.com/OpenG7/openg7-funding-platform/pull/353) | Modes administratifs, couches et focus implémentés en branche ; PR ouverte. |
| UX-03 | 009–011 | [#354](https://github.com/OpenG7/openg7-funding-platform/pull/354), [guide du dossier](../admin-sponsorship-editing.md) | En-tête, prochaine action et identité/médias implémentés en branche ; PR ouverte. |
| UX-04 | 012–013 | [#355](https://github.com/OpenG7/openg7-funding-platform/pull/355), [Campagnes](../technical/admin-campaigns.md) | Navigation Publication, preuves et états documentaires en branche ; version historique d'accord absente et observation Web déclarative explicites. |
| UX-05 | 014–015 | [#356](https://github.com/OpenG7/openg7-funding-platform/pull/356), [suivi privé](../sponsorship-access-and-drafts.md) | Suivi, récupération, droits média et audio FR/EN implémentés en branche ; PR ouverte. |
| UX-06 | 016–017 | [#357](https://github.com/OpenG7/openg7-funding-platform/pull/357), [mesures](ux-bundle-performance.md) | Bundle et réception qualifiés localement ci-dessous ; CI complète et intégration à confirmer dans la PR. |

Les limites inventoriées dans l'[audit UX-00](ux-00-current-platform-audit.md)
(contrats de reçu de certaines mutations et qualification du retour interroute
de l'Assistant) restent des écarts déclarés. La sélection locale ci-dessous ne
les transforme pas en garanties livrées. Les limites matérielles et externes
figurent en fin de document.

## Niveaux de preuve

| Niveau                | Exécution                                                                                                       | Limite                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| UI simulée            | Web compilé, vrais composants et navigateur ; API synthétiques interceptées                                     | Aucun contrôle d'autorisation serveur, de persistance ou de fournisseur |
| Node / HTTP           | Contrôleurs, règles et routes avec dépendances de test ; portée précisée par fichier                            | Aucun parcours visuel complet ni fournisseur réel                       |
| Intégration contrôlée | API/PostgreSQL jetables ; OIDC signé local ou adaptateurs synthétiques selon la suite ; reçus, audit et reprise | Aucun paiement, courriel ou réseau social de production                 |
| Live                  | Recette distincte, explicitement autorisée et tracée                                                            | Aucun résultat live revendiqué ici                                      |

La [CI Admin acceptance](../../.github/workflows/admin-acceptance.yml) sépare UI,
intégrations PostgreSQL, identité et parcours Docker. `yarn test:e2e:selection`
vérifie leur découverte et les garanties obligatoires. Un succès UI ne remplace
pas une intégration en échec ou en attente.

## Matrice des scénarios actifs

Les liens pointent vers les assertions, y compris les fichiers `*.ui.ts`
enregistrés par une suite propriétaire. Les rôles sont les valeurs API
`reader`, `operator`, `owner`.

<!-- prettier-ignore -->
| Sujet | Preuve UI simulée | Contre-épreuve serveur / intégration contrôlée |
| --- | --- | --- |
| Trois rôles : consultation conservée, mutations réservées | [Capacités financières](../../tests/playwright/admin-financial-capabilities.ui.spec.ts), [dossier V2](../../tests/playwright/admin-dossier-v2.ui.spec.ts) | [OIDC et rôles](../../tests/identity/admin-identity.spec.ts), [révocation](../../tests/identity/financial-access-revocation.spec.ts) : action déjà ouverte refusée sans effet |
| Paiement en attente : saisie conservée, actualisation serveur ; retour navigateur insuffisant | [Suivi privé](../../tests/playwright/sponsorship-followup.spec.ts), `refresh confirms pending payment` ; [simulateur](../../tests/playwright/admin-virtual-controller.spec.ts), `a simulated browser return` | [Activation persistée](../../tests/integration/sponsorship-payment-activation.integration.mjs), [réponse Checkout perdue](../../tests/playwright/checkout-response-recovery-acceptance.spec.ts) |
| Consentements : absence expliquée, revue distincte de visibilité | [Préparation](../../tests/playwright/admin-sponsorship-preparation.spec.ts), `a missing consent` ; [manette](../../tests/playwright/admin-controller-journeys.spec.ts), `consent=false/true` | [Garde-fous](../../tests/integration/moderation-publication-guards.integration.mjs), [publication](../../tests/playwright/sponsorship-publication-acceptance.spec.ts) |
| Identité : préremplissage, confirmation/annulation, conflit et brouillon conservé | [Parcours du dossier](../../tests/playwright/admin-sponsorship-progress.spec.ts), `dossier identity correction` / `a conflicting dossier` | [Routes du dossier](../../tests/admin-sponsorship-records-http.test.mjs), [détails persistés](../../tests/integration/admin-sponsorship-details.integration.mjs) |
| Droits média : qualification explicite, crédit conservé, retrait confirmé, lecteur sans commande | [Droits média](../../tests/playwright/sponsor-media-usage.ui.ts), importés par les suites suivi et dossier | [Règles](../../tests/sponsor-media-usage.test.mjs), [persistance des droits](../../tests/integration/sponsor-media-usage.integration.mjs), [exposition publique](../../tests/integration/sponsor-media-exposure.integration.mjs) |
| Préparation : reçu de version courant, accord sans publication ; accord obsolète invalidé | [Préparation](../../tests/playwright/admin-sponsorship-preparation.spec.ts), `approving a dossier preparation` / `changed preparation` | [Préparation du dossier](../../tests/integration/admin-dossier-preparation.integration.mjs), [éligibilité](../../tests/integration/admin-preparation-readiness.integration.mjs) |
| Modération : sujet exact depuis l'en-tête, retour Publication ; motif et explication distincts | [Dossier V2](../../tests/playwright/admin-dossier-v2.ui.spec.ts), [modération V1](../../tests/playwright/admin-sponsorship-progress.spec.ts) | [Routes de décision](../../tests/admin-sponsorship-decisions-http.test.mjs), [correction et recours OIDC](../../tests/identity/moderation-correction-reconsideration.spec.ts) |
| Visibilité Web : fait serveur, confirmation et masquage distincts | [Parcours du dossier](../../tests/playwright/admin-sponsorship-progress.spec.ts), `website publication` / `website visibility` | [Publication](../../tests/playwright/sponsorship-publication-acceptance.spec.ts), [invalidation après remboursement](../../tests/playwright/publication-payment-ineligibility-acceptance.spec.ts) |
| Publication : offre, préparation, contenu, autorisation, livraison et preuve distincts ; bon dossier | [Passerelle](../../tests/playwright/admin-sponsorship-progress.spec.ts), `publication bridge` ; [Campagnes](../../tests/playwright/admin-campaigns.spec.ts) | [Parcours publication](../../tests/playwright/sponsorship-publication-acceptance.spec.ts) : deux livraisons simulées, audit et confidentialité |
| Preuves : livraison/observation datées séparément ; obligation exacte ; absent distinct d'inconnu | [Campagnes](../../tests/playwright/admin-campaigns.spec.ts), `campaign evidence` ; [engagements](../../tests/playwright/admin-sponsorship-commitments.ui.ts) | [Engagements persistés](../../tests/integration/sponsorship-commitments.integration.mjs), [fiabilité](../../tests/integration/publication-reliability.integration.mjs) |
| Résultat incertain social : aucun succès inventé ni nouvel envoi implicite | [Passerelle](../../tests/playwright/admin-sponsorship-progress.spec.ts), `without inventing success` | [Réponse sociale perdue](../../tests/playwright/publication-uncertain-recovery-acceptance.spec.ts) : redémarrage, reçus synthétiques et absence de doublon |
| Remboursement : texte exact, annulation sans écriture, attente/refus distincts | [Manette](../../tests/playwright/admin-controller-journeys.spec.ts), `Xbox refund` ; [capacités](../../tests/playwright/admin-financial-capabilities.ui.spec.ts) | [Remboursement](../../tests/playwright/refund-journey-acceptance.spec.ts), [reprise de statut](../../tests/playwright/refund-status-recovery-acceptance.spec.ts) : Stripe simulé, webhook, avoirs et totaux |
| Courriel/facture : canal explicite, destinataire capturé, double soumission bloquée ; incertain réconcilié | [Renvoi documentaire](../../tests/playwright/admin-document-resend-ui.spec.ts), [file courriel](../../tests/playwright/admin-email-recovery-ui.spec.ts), [capacités](../../tests/playwright/admin-financial-capabilities.ui.spec.ts) | [Récupération courriel](../../tests/playwright/sponsorship-email-recovery-acceptance.spec.ts), [réconciliation OIDC](../../tests/identity/email-uncertain-reconciliation-journey.spec.ts) : SMTP local |
| Suivi privé : coordonnées avant médias, options sans perte, revue accessible, expiration/conflit sans fuite | [Suivi privé](../../tests/playwright/sponsorship-followup.spec.ts), [droits média](../../tests/playwright/sponsor-media-usage.ui.ts) | [Contrôleur](../../tests/sponsorship-followup-controller.test.mjs), [conflit de brouillon](../../tests/playwright/sponsorship-draft-conflict-acceptance.spec.ts), [information manquante](../../tests/playwright/sponsorship-information-acceptance.spec.ts) |
| FR/EN et audio : mêmes routes silencieuses `/music`, `/boutique` et miroirs ; lecture sur demande | [Pages publiques](../../tests/playwright/public-static-pages.spec.ts), `Shared site music route parity` : `Audio` synthétique avant démarrage | Ce fichier reste découvert par Docker ; aucun test acoustique ou de politique audio d'un appareil |
| Clavier/viewport : Échap d'un seul niveau, focus restauré, actions non masquées, texte/reflow 200 % | [Couches du shell](../../tests/playwright/admin-shell-layers.ui.spec.ts), [dossier V2](../../tests/playwright/admin-dossier-v2.ui.spec.ts), [capacités](../../tests/playwright/admin-financial-capabilities.ui.spec.ts), [accessibilité](../../tests/playwright/platform-accessibility.spec.ts) | Assertions sur contrôles réels ; pas de qualification exhaustive des lecteurs d'écran ou appareils |
| Manette : neutralité après maintien/déconnexion, édition/annulation, confirmation sur nouvelle pression | [Xbox simulée](../../tests/playwright/admin-controller-journeys.spec.ts), [manette virtuelle](../../tests/playwright/admin-virtual-controller.spec.ts), [préparation](../../tests/playwright/admin-sponsorship-preparation.spec.ts) | [Pilotage Docker](../../tests/playwright/admin-pilotage-acceptance.spec.ts), [pilotage OIDC](../../tests/identity/pilotage-moderation-journey.spec.ts) : persistance et réponse perdue ; matériel à qualifier |

## Commandes propriétaires

Utiliser Node 22 et Yarn 4 depuis la racine. Construire le Web avant Playwright ;
chaque configuration possède son serveur local. Sérialiser les suites utilisant
le même port. Les tests Node qui importent les helpers Web compilés doivent
précéder le build Angular, qui remplace leur répertoire de sortie.

```sh
yarn build
node --test tests/sponsorship-followup-controller.test.mjs tests/sponsor-media-usage.test.mjs tests/admin-sponsorship-decisions-http.test.mjs
yarn workspace @openg7/funding-web build --configuration production
yarn exec tsc --noEmit -p tests/tsconfig.admin-ui.json
yarn exec tsc --noEmit -p tests/tsconfig.followup-ui.json
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-shell-layers.ui.spec.ts admin-dossier-v2.ui.spec.ts admin-financial-capabilities.ui.spec.ts
yarn exec playwright test --config tests/playwright-followup-ui.config.mjs
yarn exec playwright test --config tests/playwright-sponsor-media-usage.config.mjs
yarn exec playwright test --config tests/playwright-platform-accessibility.config.mjs
yarn test:e2e:selection
```

Les helpers engagements et passerelle se rejouent via leur fichier
d'enregistrement :

```sh
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-sponsorship-progress.spec.ts --grep "publication bridge|recorded commitments"
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-campaigns.spec.ts admin-sponsorship-preparation.spec.ts admin-document-resend-ui.spec.ts admin-email-recovery-ui.spec.ts
```

Les contre-épreuves exigent Docker et les images selon la [matrice](validation.md).
Les scénarios « Disposable simulation only » nécessitent le lanceur d'acceptation,
qui fixe l'isolation ; Playwright direct les ignore volontairement.

```sh
yarn test:e2e:identity
yarn test:e2e:acceptance sponsorship-publication-acceptance.spec.ts --project=chromium
yarn test:e2e:acceptance publication-uncertain-recovery-acceptance.spec.ts --project=chromium
yarn test:e2e:acceptance refund-journey-acceptance.spec.ts --project=chromium
yarn test:e2e:acceptance sponsorship-email-recovery-acceptance.spec.ts --project=chromium
yarn test:e2e:acceptance public-static-pages.spec.ts --project=chromium
```

## Résultats et limites

Pour chaque exécution, consigner date, SHA exact, commande/configuration,
navigateur, rôle, langue, viewport, succès/échecs/ignorés et lien du rapport.
Les sorties sont dans `test-results/` et les artefacts CI ; conserver les captures
initiales et de confirmation avec leur contexte. Les artefacts de ce workflow
expirent après sept jours : leur nom n'est pas une archive durable.

### Qualification locale UX-06

Sources applicatives et tests du commit
`9328269e0742aef1842a5ff30206d67e0bfc52a8`, compilés le **19 octobre 2026** avec
Node 22.23.3 et Yarn 4.9.4. Les suites navigateur ci-dessous utilisent le même
build production ; leurs API sont interceptées. Cette sélection ne remplace
pas un passage de toute la CI sur le dernier commit poussé.

| Contrôle                                 | Résultat                              | Configuration et preuve locale                                                                                                                |
| ---------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests Node                               | 7 230 réussis, 8 ignorés, aucun échec | `yarn test` ; journal `%TEMP%/og7-ux06-node-qualified.log`                                                                                    |
| Production et SSR                        | 25 routes ; initial 505 334 octets    | `--configuration production --stats-json` ; [mesure reproductible](ux-bundle-performance.md)                                                  |
| En-tête musical mobile                   | 16/16                                 | FR/EN, 320/390 px, Chromium/Firefox/WebKit/WebKit mobile ; `test-results/ux06-header-final`                                                   |
| Impression de la politique               | 8/8                                   | FR/EN, quatre navigateurs ; `test-results/ux06-policy-print-final`                                                                            |
| Premier champ privé                      | 2/2                                   | FR/EN, 390 × 844 px, quatre coins atteignables et Axe ; `test-results/ux06-first-field-final`                                                 |
| Accessibilité, SSR et chargement différé | 80/80                                 | Quatre navigateurs, `tests/playwright-platform-accessibility.config.mjs` ; `test-results/ux06-platform-qualified`                             |
| Modération du suivi privé                | 4/4                                   | `sponsorship-moderation-followup.spec.ts` ; libellés communs N1/N4, FR desktop et EN mobile ; `test-results/ux06-moderation-levels-qualified` |

Les captures initiales du suivi et de l'en-tête à 320/390 px ont été relues.
Les trois rôles, la manette et les contre-épreuves serveur restent documentés
dans la matrice ; ils ne sont pas tous rejoués par cette sélection locale.
Un succès d'une PR antérieure reste associé à son SHA.

Les recettes Docker corrigées de la [PR UX-05](https://github.com/OpenG7/openg7-funding-platform/pull/356)
sont reprises dans cette branche. Leur passage local a validé 26 scénarios avec
API/PostgreSQL jetables et fournisseurs simulés ; le compactage mobile a ensuite
été qualifié par huit scénarios UI développement. La fusion de ces recettes
ne change aucun fichier applicatif par rapport à `9328269e`.

### Réception des corrections CI

Les styles du commit `b6df4f1321276e55acb696a48bba6020f6517641` corrigent
deux écarts détectés dans la première CI UX-06 : largeur défilable WebKit
de 426 px pour un viewport de 390 px et chevauchement du texte de marque
sous Chromium Linux. Le build production du **19 octobre 2026** pré-rend
25 routes ; son graphe initial atteint **505 389 octets**. Les causes et les
mesures avant/après figurent dans le [rapport de performance](ux-bundle-performance.md).

Les contre-épreuves suivantes utilisent ce build figé, avec API interceptées
et `Audio` synthétique, sans diffusion ni effet externe :

| Contrôle                         | Résultat        | Configuration et preuve locale                                                                                                                |
| -------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| En-tête musical mobile           | 16/16           | FR/EN, 320/390 px, quatre navigateurs ; `test-results/ux06-header-cta-final`                                                                  |
| Impression de la politique       | 8/8             | FR/EN, quatre navigateurs ; `test-results/ux06-policy-print-cta-final`                                                                        |
| Premier champ privé              | 2/2             | FR/EN, 390 × 844 px ; `test-results/ux06-first-field-cta-final`                                                                               |
| En-tête sous Linux               | 4/4             | Chromium, FR/EN, 320/390 px ; journal `%TEMP%/og7-pr357-linux-header-cta-final.log` et captures `%TEMP%/og7-pr357-linux-header/results-final` |
| Transparence publique            | 68/68           | Quatre navigateurs ; `tests/playwright-transparency-ui.config.mjs`, `test-results/pr357-transparency-cta-final`                               |
| Cas WebKit initialement en échec | 3/3 répétitions | FR, WebKit mobile, 390 × 844 px, filtre de remboursements puis navigation/clavier ; `test-results/pr357-transparency-cta-final-repeat`        |

Les captures finales ont été relues. À 390 × 844 px sous Chromium Windows,
le champ privé FR se termine à 742,45 px, soit 101,55 px avant le bas du
viewport ; le champ EN se termine à 716,86 px, sans défilement initial.
Sous Chromium Linux, la marque FR et le bouton de langue sont séparés de
13,72 px ; les cibles mesurées font au moins 44 × 44 px. Les sorties Linux
proviennent d'un conteneur jetable sans réseau ni port publié, avec build
monté en lecture seule et sans interception des styles compilés.

Cette révision intègre aussi l'ordre des imports corrigé dans le parent
UX-05 (`2503778f`), sans changer les assertions ni les séquences des recettes.
Le lint complet rejoué après cette intégration réussit, avec le seul
avertissement préexistant de `scripts/smoke-public.mjs` ; journal local
`%TEMP%/og7-pr357-integrated-import-order-lint.log`.
Les 7 230 tests Node ci-dessus restent associés à `9328269e` : ils ne sont pas
présentés comme une nouvelle exécution après ces changements CSS et d'imports.
Le dernier résultat de toute la CI est consultable dans la
[PR UX-06](https://github.com/OpenG7/openg7-funding-platform/pull/357).

Limites connues au 19 octobre 2026 :

- Les suites ciblent les états sans produit cartésien complet
  rôle × langue × viewport × état. Le dossier V2 couvre FR/EN et 390/1536 px ;
  les capacités financières couvrent les trois rôles, avec des cas de
  texte/reflow 200 % dédiés.
- L'OIDC local signé et PostgreSQL jetable ne qualifient pas le fournisseur
  d'identité de production, HTTPS ou son MFA ; voir la
  [recette identité](../operations/admin-identity-and-alerts.md#recette-des-accès-administrateurs).
- Xbox réelle, USB/Bluetooth, système, navigateur, reconnexion et maintien
  pendant confirmation restent une
  [recette matérielle](../operations/admin-pilotage.md#recette-et-limites-de-preuve).
- Une observation Web enregistrée n'est pas une vérification HTTP automatique.
  Une préparation ou preuve de livraison n'invente ni version d'accord
  historique absente ni autorisation administrative.
- SMTP local, Stripe et réseaux sociaux simulés ne qualifient aucun paiement,
  remboursement, courriel ou publication réels. Aucun secret live ni effet de
  production n'est requis par ces commandes.
