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
