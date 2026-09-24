# Confirmation des paiements et reprise des webhooks

Ce lot améliore les informations affichées après Checkout et la reprise des
événements Stripe. Il ne modifie pas les consentements ni les décisions de revue
et de publication des commanditaires.

## Comportement visible

- Une redirection Checkout ouvre un état en attente, y compris pour une
  commandite. Seule la lecture serveur d'un paiement `paid` permet d'afficher
  « Paiement reçu ».
- Le retour d'annulation porte la référence créée par le serveur. Il consulte
  le registre : un paiement déjà confirmé affiche sa confirmation, un refus ou
  une expiration affiche le message correspondant. Un simple abandon ne change
  aucun statut financier. « Vérifier à nouveau » relit le serveur ; « Réessayer »
  ferme le message, retire les paramètres de la tentative et place le focus sur
  le formulaire. Le type de contribution est conservé ; les consentements doivent
  être saisis pour la nouvelle tentative. Les libellés existent en FR/EN.
- En attendant la première lecture du registre, ou si cette lecture échoue, les
  montants et pourcentages inconnus ne sont pas affichés comme des zéros.
- Après une lecture réussie, une panne conserve le dernier état connu avec un
  avertissement et sa date de synchronisation. Une collecte vide confirmée par
  l'API affiche toujours zéro.
- Le résumé des contributions et le tableau de bord admin comptent les
  remboursements partiels et complets du même journal que la transparence
  publique. Ils ne cumulent pas ce journal avec les montants des contributions
  marquées entièrement remboursées.
- Le fallback historique sur les contributions entièrement remboursées reste
  disponible lorsqu'aucune écriture de remboursement n'est présente. Les règles
  de frais, de dépenses, de litiges et de calcul du disponible sont conservées.

## États et traitements Stripe

Les écritures de statut vérifient leur état précédent dans PostgreSQL, au moment
de la mutation. Un événement d'échec ou d'expiration tardif ne peut pas annuler
un paiement confirmé. Une réussite tardive ne peut pas annuler un litige ou un
remboursement complet. Un remboursement complet reste prioritaire sur un
événement de litige tardif. Un paiement peut toujours réussir après un échec.
La résolution d'un litige nécessite un traitement autoritaire distinct.

Stripe peut créer Checkout sans `payment_intent`. Lors du premier événement
`payment_intent.payment_failed`, la référence des métadonnées signées permet de
rattacher l'intention à une contribution existante, seulement si son montant et
sa devise correspondent et qu'aucune autre intention n'est déjà liée. Ce
rattachement transactionnel ne crée ni revenu ni notification de paiement reçu.

Avec PostgreSQL, chaque événement webhook possède un verrou advisory de session
sur une connexion dédiée au traitement :

- événement déjà traité : réponse `200`, sans nouvel effet ;
- même événement en cours sur une autre connexion : réponse `503`, permettant
  une nouvelle livraison ;
- événement `failed`, ou `processing` dont le traitement a perdu sa connexion :
  reprise lors de la livraison suivante ;
- échec pendant le traitement : l'erreur reste visible et une reprise est
  possible.

Les écritures du traitement utilisent la connexion qui détient le verrou. Les
courriels de suivi et de facture sont mis en file ; leur envoi appartient au
worker de courriels existant. Le webhook n'attend pas de réponse SMTP.

Aucune migration ni correction automatique des données historiques n'est
nécessaire. Le déploiement du code ne rejoue pas spontanément les anciens
événements : un événement interrompu est repris à sa prochaine livraison.
Une rediffusion ou un backfill live reste une opération explicite et bornée.

## Recette complète d’une contribution personnelle

Les scénarios 1, 2, 3 et 8 ainsi que la consultation des totaux et l’export JSON
du scénario 59 de l’[inventaire](development/end-to-end-scenarios-inventory.md)
disposent d’une recette navigateur contre l’API réelle, PostgreSQL et les workers :

```sh
yarn test:e2e:acceptance personal-contribution-acceptance.spec.ts --project=chromium
```

Le runner exige Node 22, crée une pile Docker jetable, ignore `.env` et conserve
les résultats sous `test-results/acceptance/`. Les fournisseurs Stripe, SMTP et
SMS sont simulés ; les requêtes applicatives ne sont pas interceptées. La recette
crée une contribution personnelle de 25 CAD depuis le formulaire pour chacune
des quatre combinaisons des consentements de nom et de montant.

Le simulateur retarde volontairement le webhook Checkout, indépendamment du
retour du navigateur. Avant sa livraison, le paiement reste en attente, les
totaux et l’annuaire sont inchangés, y compris après rechargement du retour
de succès et rejet d’une signature invalide. Après confirmation signée, le
navigateur affiche le paiement reçu. Un second événement signé apporte les
faits du PaymentIntent et des frais synthétiques de 0,73 CAD, sans représenter
un tarif Stripe réel. Le brut augmente de 25 CAD, les frais de 0,73 CAD et le net
de 24,27 CAD ; les contrôles utilisent des différences en unités mineures.

La recette rejoue les événements pour vérifier l’unicité, contrôle les
notifications capturées et l’absence de cartouche d’entreprise pour ce paiement
personnel. Elle compare les consentements entre recherche de référence, annuaire
public et page Bâtisseurs, puis vérifie les totaux affichés et l’export JSON
de Transparence. L’export financier ne contient ni nom ni référence individuelle.
Les captures et le rapport JSON de chaque variante servent de preuves locales.

Le contrôle `/__test__/checkout-delivery` appartient uniquement au simulateur
isolé. Il ne crée aucun endpoint de test dans l’API applicative et ne modifie
pas son mécanisme de signature. Cette recette ne qualifie aucun paiement réel.

Exécution du 22 septembre 2026 (America/Toronto), sur `ee0b827` avec les
changements locaux de cette recette : **4 variantes personnelles réussies** sous
Chromium, ainsi que **2 tests de non-régression** de
`contribution-journey-acceptance.spec.ts`. Une seconde exécution confirme les
4 variantes avec captures complètes et les **3 tests de navigation** de
`personal-donation-navigation.spec.ts`, dont un utilise une réponse API
interceptée. Aucun test ignoré ni instable dans ces deux exécutions.
Les choix de période, l’export CSV, le partage et les versements du scénario 59
restent hors du périmètre de cette recette. Les fournisseurs réels et les autres
navigateurs ne sont pas qualifiés par cette exécution.

## Recette des remboursements et avoirs

```sh
yarn test:e2e:acceptance refund-journey-acceptance.spec.ts admin-refund-integrity.spec.ts funding-accounting-integrity.spec.ts --project=chromium
```

La recette `refund-journey-acceptance.spec.ts` utilise le même runner jetable,
l’API et PostgreSQL réels, les webhooks signés et les workers, sans interception
des requêtes applicatives. Stripe et SMTP sont simulés. Deux commandites de
500 CAD sont payées depuis le formulaire et Checkout : l’une est remboursée
en deux opérations de 200 puis 300 CAD, l’autre en une seule de 500 CAD.
Les frais synthétiques de 10 CAD restent acquis au fournisseur simulé : après
remboursement intégral, la variation du disponible est donc de −10 CAD. Ce
montant ne représente pas un tarif Stripe réel.

Le navigateur saisit les montants, confirme la référence et demande les courriels.
La recette compare le journal exposé par Transparence avec les résumés
administratifs après chaque confirmation Stripe. Elle vérifie la conservation
de la facture originale, les montants et libellés des avoirs, leurs téléchargements
PDF authentifiés et leur livraison unique capturée dans Mailpit. Elle contrôle
aussi l’audit, l’export JSON public sans référence privée, et les refus suivants :
absence d’authentification, mauvaise confirmation, fraction de cent, version
périmée et tentative après remboursement intégral. Après 200 CAD, une demande
de 400 CAD échoue chez le fournisseur simulé sans avoir supplémentaire ; le
remboursement valide des 300 CAD restants permet ensuite de reprendre le parcours.

Les confirmations de paiement et de remboursement sont rejouées avec les mêmes
identifiants d’événement, sans doubler les montants ni les documents. Le simulateur
fournit une écriture de solde propre à chaque remboursement et présente les
remboursements du plus récent au plus ancien.

La première exécution a révélé une collision de numéros : le second remboursement
réussissait chez Stripe mais son avoir reprenait le numéro du premier. Les nouveaux
numéros incluent désormais un suffixe déterministe propre au remboursement.
Les tests PostgreSQL de `sponsorship-credit-notes.integration.mjs` vérifient les
avoirs multiples, les rejeux simultanés de leur création, les préfixes de facture
standards ou personnalisés et la conservation d’un avoir historique. Les documents
existants ne sont ni renumérotés ni réécrits. Les nouveaux avoirs partiels indiquent
le montant crédité, au lieu de prétendre annuler toute la facture ; une surcharge
de `FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE` garde toutefois son texte configuré.

Cette recette cible les scénarios 28, 29, 30 et 61 de
l’[inventaire](development/end-to-end-scenarios-inventory.md), la création et le
PDF de facture du scénario 25, ainsi que les totaux et l’export JSON du scénario 59.
La version périmée est testée par soumissions successives, pas par une course
parallèle. Les remboursements Stripe en attente, les pertes de réponse réseau,
les événements distincts décrivant le même remboursement et les fournisseurs
réels restent hors de cette preuve. Le formulaire propose encore le montant
initial, sans calcul du solde restant ; le fournisseur refuse le dépassement.
Après plusieurs remboursements partiels, le statut intégral dépend du webhook
cumulatif. Aucun retrait de reconnaissance publique n’est qualifié ici.

Exécution du 23 septembre 2026 (America/Toronto), sur `7eb9157` avec les changements
locaux de cette recette : **7 tests Chromium réussis**, dont les deux variantes
ci-dessus, les deux tests d’intégrité des remboursements et les trois tests
d’intégrité comptable. Aucun échec, test ignoré ou instable dans l’exécution finale.
Les captures, les cinq PDF téléchargés et les deux rapports JSON du parcours sont
conservés sous `test-results/acceptance/`. La pile jetable est supprimée après la
recette. Les contrôles complémentaires passent : **290 tests Node**, **31 tests
d’intégration PostgreSQL** des suites `sponsorship-credit-notes`,
`funding-payment-trust`, `stripe-event-recovery` et `funding-transparency`,
compilation TypeScript, lint, format ciblé et contrôles documentaires. Le lint
conserve un avertissement préexistant dans `scripts/smoke-public.mjs` ; le build
Angular conserve son avertissement de budget initial de 813,77 ko pour 800 ko.

## Recette de reprise après paiement interrompu

Le scénario 7 de l'[inventaire](development/end-to-end-scenarios-inventory.md)
est exercé par [payment-recovery-acceptance.spec.ts](../tests/playwright/payment-recovery-acceptance.spec.ts).
La pile jetable utilise le navigateur, l'API et PostgreSQL réels, un simulateur
Stripe local avec webhooks signés et les récepteurs locaux Mailpit/SMS.

Trois variantes démarrent une commandite de 500 CAD : abandon sans paiement,
refus simulé, puis expiration simulée. Chacune revient par le lien Checkout,
vérifie le statut non confirmé et l'absence de facture, courriels, SMS, événement
d'activité, visibilité publique et revenu. Une URL de succès fabriquée ne crée
pas de confirmation. La reprise démarre une nouvelle session avec sa propre
référence, pour la même entreprise et le même montant.

Après confirmation signée de la nouvelle tentative, la recette attend un seul
événement d'activité avec toast admin, un courriel admin, un SMS capturé, une
facture et les deux courriels destinés à l'entreprise (suivi et facture). Le total
augmente de 500 CAD et d'une contribution. La fiche reste à compléter, en attente
de revue et privée. Les rejeux de confirmation et d'échec, ainsi que des événements
distincts d'échec et d'expiration arrivés après le paiement, préservent ces résultats.
L'ancienne tentative reste non payée. Revisiter le retour d'annulation de la
tentative payée affiche une confirmation.

La recette navigue sur mobile, dont la variante expirée en anglais. Les fixtures
[payment-recovery-ui.spec.ts](../tests/playwright/payment-recovery-ui.spec.ts)
couvrent les quatre états serveur en FR/EN, l'absence de débordement horizontal
et la vérification au clavier sans démarrer un nouveau paiement. La suite
PostgreSQL `funding-payment-trust` vérifie le rattachement tardif et les références,
montants, devises ou intentions incompatibles.

```sh
node scripts/admin-acceptance.mjs payment-recovery-acceptance.spec.ts --project=chromium
yarn test:ui:funding-home
```

Exécution du 23 septembre 2026 (America/Toronto), sur `9e1e6c5` avec les changements
locaux de cette recette : **3 parcours Chromium réussis en 43,4 secondes**, sans
échec, test ignoré ou instable dans l'exécution finale. Les captures, le manifeste
de pile et les preuves JSON sans jeton de suivi sont sous `test-results/acceptance/`.
La pile est supprimée après l'essai. Les quatre variantes de contribution personnelle
ont également réussi lors de la première exécution de contrôle.

Contrôles complémentaires réussis : **294 tests Node**, **10 tests PostgreSQL**
de la suite `funding-payment-trust`, **27 tests d'interface** (dont 8 nouveaux cas
FR/EN), TypeScript, lint, build Angular de production et contrôles documentaires.
Le lint garde son avertissement préexistant dans `scripts/smoke-public.mjs` ;
le bundle initial Angular mesure 816,73 ko pour un budget de 800 ko.

Limites : aucun paiement, refus bancaire, expiration chronométrée ou message réel.
L'abandon laisse une session ouverte chez le fournisseur ; ce retour ne l'annule
pas. Deux sessions différentes réellement payées constituent deux paiements et
nécessitent une réconciliation distincte. La reprise sur la même page Checkout,
les moyens de paiement asynchrones, les frais et la publication après revue ne
sont pas qualifiés par ces trois variantes.

## Recette de reprise après interruption du webhook

Le scénario 62 de l'[inventaire](development/end-to-end-scenarios-inventory.md)
est exercé par [webhook-recovery-acceptance.spec.ts](../tests/playwright/webhook-recovery-acceptance.spec.ts).
Chaque variante confirme une commandite de 500 CAD depuis le formulaire mobile
et Checkout simulé, puis interrompt le traitement SQL du webhook signé :

- une erreur d'écriture empêche la création de la facture et laisse l'événement
  en état `failed` ;
- une coupure de la connexion PostgreSQL après création de la facture, avant
  l'insertion de son courriel, laisse l'événement orphelin en état `processing`.

Les déclencheurs de panne sont limités à la session de paiement de la recette,
dans sa base jetable. Le paiement, l'activité admin et le courriel de suivi ont
déjà été enregistrés. Le retour navigateur reste accessible même lorsque le
webhook échoue ; cette indépendance est reproduite par le simulateur Stripe.
La recette vérifie le toast, le courriel admin et le SMS capturés, ainsi que les
compteurs d'événements en erreur ou en traitement dans le tableau de bord FR/EN.

Une nouvelle livraison pendant la panne échoue encore sans doubler les effets
acquis. L'API redémarre, les états persistent, puis la panne est retirée et le
même événement signé est livré à nouveau. Le traitement termine la facture et
son courriel, conserve le numéro et la date de la facture déjà créée, et ramène
les compteurs admin à leur valeur initiale. Deux rejeux simultanés après la
réussite préservent une contribution, une facture, deux courriels entreprise
(suivi et facture), un événement d'activité, un courriel admin et un SMS.
Ces deux rejeux utilisent directement l'endpoint signé : un éventuel `503` dû
au verrou doit réussir lors de la relance après la réponse du premier traitement.
La recette contrôle le PDF authentifié, les totaux, l'accès au suivi privé et
l'absence du nom de l'entreprise dans l'annuaire public.

```sh
node scripts/admin-acceptance.mjs webhook-recovery-acceptance.spec.ts --project=chromium
node --test tests/integration/stripe-event-recovery.integration.mjs
```

La seconde commande nécessite les fichiers compilés par `yarn test`. Les tests
PostgreSQL complémentaires vérifient notamment la signature, le verrou pendant
un traitement actif, la perte de connexion et la reprise après erreur.

Exécution du 23 septembre 2026 (America/Toronto), sur `1a43140` avec les changements
locaux de cette recette : **5 parcours Chromium réussis**, dont les deux variantes
de panne et les trois cas de `payment-recovery-acceptance.spec.ts`, sans échec,
test ignoré ou instable dans l'exécution finale. Les captures des compteurs avant
et après reprise, le manifeste et les preuves JSON sans jeton de suivi sont sous
`test-results/acceptance/`. La pile a été supprimée après l'essai.

Contrôles complémentaires réussis : **294 tests Node**, **8 tests PostgreSQL**
de `stripe-event-recovery`, TypeScript, lint et build Angular de production dans
la pile. Les avertissements préexistants du lint (`scripts/smoke-public.mjs`) et
du budget Angular (816,73 ko pour 800 ko) restent présents.

Limites : les rediffusions viennent du fournisseur local signé ; le CLI Stripe
et l'outil d'exploitation `stripe-resend-events.mjs` ne sont pas exercés. L'arrêt
brutal du processus API, les pannes SMTP et les fournisseurs réels sont hors du
périmètre de ces deux variantes. Les requêtes applicatives ne sont pas interceptées.
Les objets SQL de panne disparaissent avec la pile ; aucune migration applicative
ni modification du moteur de reprise n'est nécessaire pour cette recette.

## Vérifications locales isolées

```sh
yarn test
yarn test:integration:payments
yarn playwright test --config tests/playwright/home-trust.config.ts
yarn workspace @openg7/funding-web build --configuration production
```

Les tests PostgreSQL créent leurs propres conteneurs `postgres:16-alpine`, avec
stockage jetable en mémoire et ports liés à `127.0.0.1`. Ils appliquent les
migrations du dépôt, puis suppriment uniquement les conteneurs créés par le
test. Docker doit être disponible localement. Aucun `.env` applicatif, volume
de développement, secret Stripe ou fournisseur de courriel n'est utilisé.

La configuration navigateur dédiée lance Angular localement et intercepte les
appels API. Elle ne lance ni seed ni nettoyage de la base de développement.
Elle vérifie les confirmations personnelles et commanditaires, les états du
registre et les libellés français et anglais.

Ces validations ne remplacent pas un exercice de production ou les tests
d'intégration avec les fournisseurs réels. La suite Docker générale conserve
sa commande existante et son périmètre distinct.
