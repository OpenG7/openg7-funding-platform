# Paiements, comptabilité et transparence

À lire pour tout changement de paiement, calcul financier, facture, remboursement,
réconciliation ou projection publique, quel que soit le dossier modifié.
Complète les [garde-fous communs](../../AGENTS.md#garde-fous).

## Checkout et webhooks

Stripe fait autorité pour Checkout Session, PaymentIntent, Charge, Balance
Transaction, Refund et Event. PostgreSQL en conserve une représentation normalisée
et auditée avec l'état métier OpenG7. Le Web passe par l'API; celle-ci valide type,
montant, devise et consentements, crée Checkout avec les métadonnées requises et
retourne seulement les données publiques nécessaires à la redirection.
Mock local uniquement; configuration Stripe absente en production = erreur.

Le retour `success_url` informe sans confirmer : aucun ajout de transaction payée,
facture autoritaire, publication ou total confirmé sans lecture serveur.

1. Conserver le corps brut et vérifier la signature avant traitement du webhook.
2. Enregistrer/dédupliquer `event.id` sous contrainte unique; corréler les objets
   par leurs identifiants Stripe, conserver type et références utiles.
3. Rendre atomiques l'événement et ses écritures liées lorsque nécessaire; conserver
   statut de traitement et erreur sûre. Acquitter après traitement durable ou
   acceptation persistante permettant une reprise sûre.
4. Accepter répétition, retard et ordre différent sans doubler transaction,
   courriel, facture ou écriture. Prévoir les retries et leur observabilité.

Le brut vient de l'objet Stripe autoritaire; frais/net de `balance_transaction`
lorsqu'il est disponible. `payment_intent.succeeded` peut confirmer une transaction
avant ses frais; `charge.updated` enrichit alors la même transaction. Conserver
provenance/date et ne jamais remplacer un fait confirmé par une estimation.

Les opérations live suivent la [procédure à risque élevé](../../AGENTS.md#risque-eleve)
et les [règles d'exploitation](../../scripts/AGENTS.md). Vérifier compte et mode
sans afficher de clé, borner dates/volume, dry-run lorsqu'il existe et reprise sûre.

## Montants, journal et documents

- `amount_minor` entier et `currency` ISO 4217 explicite : 2 500 unités mineures CAD
  représentent 25,00 CAD. Aucun flottant comptable, arrondi implicite ou addition
  de devises différentes.
- Journal append-only : ne pas effacer les faits confirmés. Corriger par écriture
  compensatoire, remboursement, avoir ou nouvelle version tracée. Référencer
  l'opération source; brut, frais, net, dépenses et remboursements restent explicables.
- Facture : snapshot à l'émission, numéro et lien paiement stables. Un renvoi de
  courriel ou changement légal/fiscal ne modifie pas rétroactivement le document.
- Avoir : référence à la facture et au remboursement concernés, raison/date,
  montant admissible, remboursement partiel explicite, écritures compensatoires.
  Il ne remplace pas le remboursement Stripe et indique si l'argent a été remboursé.
  Après émission, correction par nouveau document tracé; l'échec du courriel
  n'annule pas le fait comptable.
- Les reçus et textes publics ne doivent pas suggérer un don déductible ou un
  statut de charité sans changement juridique et architectural explicite.

## Remboursement et reprise

Un remboursement réel exige la procédure à risque élevé. Vérifier autorisation,
transaction et état Stripe, montant restant admissible, raison et confirmation.
Créer le remboursement Stripe avec une clé idempotente, conserver sa référence,
mettre à jour les états internes et produire avoir/écritures, audit et courriel
en file. Le fait externe est confirmé par Stripe; ni le clic UI ni un échec
fournisseur ne rendent le remboursement réussi. Prévoir reprise et résultat
partiel entre l'appel externe et les écritures DB.

## Backfill, provenance et réconciliation

Backfill borné par dates, identifiants ou volume, relançable et sans doublon :
séparer test/live, fournir dry-run et rapport, préserver les données plus fiables.
Ne pas fabriquer d'historique webhook ni envoyer les courriels historiques sans
option explicite.

Pour une source externe telle que La Ruche (cadrage, pas import livré), conserver
source, référence et preuves admissibles, sans inventer d'identifiant Stripe.
Importer de manière idempotente, éviter les doubles totaux et inclure cette
provenance dans la réconciliation.

Comparer Stripe, `stripe_events`, Checkout, contributions, transactions,
remboursements, factures, avoirs et courriels pertinents. Classer : absent localement,
absent fournisseur, montant/devise/statut différents, doublon, frais/net manquants
ou ambigu. Persister périmètre, résultats et état des écarts, avec corrélation/audit.
Réparer automatiquement seulement si déterministe, idempotent et audité; les
ambiguïtés restent en revue humaine.

## Courriels

File persistante et idempotente : template, destinataire, contexte minimal, statut,
tentatives, prochaine tentative, erreur sûre et clé de déduplication logique.
Aucun envoi dans une transaction DB ouverte. Un retry ne crée pas de nouveau fait
métier; un échec reste visible dans l'admin. Ne pas journaliser de corps privé.
Séparer test d'envoi et message réel. Corriger une adresse ne modifie pas l'identité
financière originale. SMTP et identifiants fournisseur restent côté serveur.
Voir le [guide SMTP](../email-smtp.md) pour configuration et exploitation.

## Projection publique

Exposer uniquement agrégats et enregistrements approuvés : brut, frais confirmés
ou explicitement estimés, net, remboursements, dépenses/allocations publiées,
catégories, dates/périodes et méthode. Aucune coordonnée privée, note admin, token
de suivi, secret, donnée de paiement brute ou commandite non approuvée.
La reconnaissance exige consentement et revue; le paiement seul ne les fournit pas.

Stripe-direct et PostgreSQL doivent donner une sémantique cohérente, avec source
observable et estimations signalées. Le changement de mode ne double pas les
montants. Un chargement/échec ne signifie pas zéro.
Le `status` d'une allocation contrôle sa visibilité; `progress_status` décrit
l'avancement. Les preuves publiques (URL, source, date) restent distinctes de
l'état financier et exemptes de notes privées ou credentials.
Voir le [contrat de transparence](../funding-transparency.md).

<a id="scenarios"></a>

## Scénarios obligatoires selon le changement

| Domaine      | Cas à couvrir                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout     | Montants prédéfinis/personnalisés valides et invalides, devise, personnel/entreprise, commandite activée/désactivée, clé absente, mock local, redirection sans confirmation, erreur fournisseur |
| Webhooks     | Signatures valide/invalide, répétition, ordre, événement inconnu, erreur transitoire/reprise, `checkout.session.completed`, `payment_intent.succeeded`, `charge.updated`, frais tardifs         |
| Comptabilité | Unités mineures, remboursement partiel/total/multiple, avoir, snapshot/PDF/numérotation/renvoi, historique, dépassement impossible, append-only                                                 |
| Courriels    | Enqueue unique, retry, échec permanent, reprise après redémarrage, templates, destinataire corrigé, absence de double envoi                                                                     |
| Transparence | Zéro réel, agrégats, frais absents, allocations publiées, modes Stripe-direct/DB, PII absente, devise cohérente                                                                                 |

Les commandes et préconditions sont dans la [matrice de validation](validation.md).
