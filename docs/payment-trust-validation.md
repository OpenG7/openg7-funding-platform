# Confirmation des paiements et reprise des webhooks

Ce lot améliore les informations affichées après Checkout et la reprise des
événements Stripe. Il ne modifie pas les consentements ni les décisions de revue
et de publication des commanditaires.

## Comportement visible

- Une redirection Checkout ouvre un état en attente, y compris pour une
  commandite. Seule la lecture serveur d'un paiement `paid` permet d'afficher
  « Paiement reçu ».
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
