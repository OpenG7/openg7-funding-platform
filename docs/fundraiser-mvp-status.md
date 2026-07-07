# Statut MVP - Fonds des batisseurs OpenG7

Date: 2026-07-07

Ce document resume l'etat du MVP apres les lots de travail sur le Fonds des
batisseurs. Il sert de point de controle avant PR, revue de production ou
deploiement progressif.

## Resume

Le coeur MVP est en place:

```text
paiement clair -> consentements minimaux -> metadata Stripe enrichies -> webhook fiable -> DB optionnelle -> transparence publique filtree -> page batisseurs simple
```

Le produit reste volontairement prudent:

- aucun paiement n'est confirme depuis le navigateur;
- Stripe webhook reste la source de verite du statut financier;
- la base PostgreSQL est optionnelle et privee;
- le fallback Stripe-direct reste disponible sans `DATABASE_URL`;
- aucune donnee privee n'est exposee dans les endpoints publics;
- aucune visibilite commanditee n'est publiee automatiquement;
- aucune promesse de recu officiel de don de bienfaisance n'est faite.

## Livre dans le MVP

### Interface publique

- Route canonique `/fonds-des-batisseurs`.
- Route anglaise `/en/fonds-des-batisseurs`.
- Page `/batisseurs` et `/en/batisseurs` pour les profils publics consentis.
- Navigation publique mise a jour.
- SEO, canonical, hreflang, sitemap et prerender mis a jour.
- Mention non-charite visible avant paiement.
- Distinction entre contribution personnelle et interet de commandite.
- Mention de validation manuelle pour les commandites.

### Checkout et consentements

- Types supportes:
  - `personal_support`;
  - `sponsorship_interest`.
- Consentements transmis cote client et valides cote API:
  - `publicDisplayConsent`;
  - `displayAmountConsent`;
  - `nonCharityAcknowledged`.
- Refus serveur si la mention non-charite n'est pas acceptee.
- Validation serveur des montants via `FUNDING_ALLOWED_AMOUNTS`.
- Validation serveur des types de contribution.
- Validation prudente des URLs de retour Checkout.

### Stripe

- Metadata Stripe enrichies:
  - `project=openg7`;
  - `program=builders_fund`;
  - `contributionType`;
  - `publicDisplayConsent`;
  - `displayAmountConsent`;
  - `nonCharityAcknowledged`;
  - `requiresReview`.
- `requiresReview=true` pour `sponsorship_interest`.
- Secrets Stripe conserves cote API.
- Mock checkout conserve uniquement hors production.

### PostgreSQL optionnel

- Activation uniquement avec `DATABASE_URL`.
- Demarrage possible sans base de donnees.
- Compose PostgreSQL profile-gated et reseau interne.
- Port `5432` non publie publiquement.
- Migrations versionnees:
  - `001_create_fund_transparency_tables.sql`;
  - `002_create_fundraiser_mvp_tables.sql`.
- Tables MVP:
  - `stripe_events`;
  - `stripe_checkout_sessions`;
  - `fund_contributions`.

### Webhooks Stripe

- Verification de signature Stripe.
- Journalisation des evenements dans `stripe_events`.
- Traitement idempotent par evenement Stripe.
- Statuts de traitement `processing_status`.
- Evenements couverts:
  - `checkout.session.completed`;
  - `checkout.session.expired`;
  - `payment_intent.succeeded`;
  - `payment_intent.payment_failed`;
  - `charge.refunded`;
  - `charge.dispute.created`;
  - `payout.paid`;
  - `payout.failed`.

### Transparence publique

- Agregats lus depuis PostgreSQL lorsque disponible.
- Fallback Stripe-direct lorsque la DB est absente.
- Champ `data_source` expose pour indiquer la source publique.
- Totaux publics:
  - total recu;
  - frais;
  - net;
  - remboursements;
  - payouts;
  - solde estime;
  - nombre de contributions;
  - resume mensuel.
- Filtrage strict des donnees publiques.
- Aucun courriel, contact prive, id Stripe ou metadata sensible expose.

### Page batisseurs simple

- Route publique `/batisseurs`.
- Route anglaise `/en/batisseurs`.
- Liste limitee aux profils ayant `public_display_consent=true`.
- Nom public requis.
- Montant individuel affiche seulement avec `display_amount_consent=true`.
- Etat vide clair si aucun profil public consentant n'est disponible.

## Validation locale

Derniere validation connue:

```bash
yarn build
yarn test
yarn workspace @openg7/funding-web build
```

Resultat attendu:

- build TypeScript OK;
- tests Node OK;
- build Angular production OK;
- prerender des routes publiques FR/EN incluant `/fonds-des-batisseurs` et `/batisseurs`.

## Points a valider en preproduction

- `FUNDING_PLATFORM_ENV=production`.
- `FUNDING_PUBLIC_BASE_URL=https://openg7.org`.
- `FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org`.
- `STRIPE_SECRET_KEY` configure cote API seulement.
- `STRIPE_WEBHOOK_SECRET` configure avec le endpoint Stripe final.
- `FUNDING_ALLOWED_AMOUNTS` aligne avec l'UI.
- `DATABASE_URL` absent pour le mode Stripe-direct, ou configure seulement si PostgreSQL prive est deploye.
- Migrations appliquees si PostgreSQL est active.
- Webhook Stripe abonne aux evenements MVP.
- Routes publiques testees apres deploiement:
  - `/`;
  - `/fonds-des-batisseurs`;
  - `/fonds-des-batisseurs/transparence`;
  - `/batisseurs`;
  - `/en`;
  - `/en/fonds-des-batisseurs`;
  - `/en/fonds-des-batisseurs/transparence`;
  - `/en/batisseurs`.
- Endpoint public teste:
  - `GET /api/public/fund-transparency`.
- Checkout teste avec une contribution reelle de faible montant ou en mode test Stripe.
- Rejeu du meme evenement webhook teste pour confirmer l'idempotence.

## Hors MVP

Les elements suivants restent volontairement hors perimetre:

- back-office admin production;
- authentification admin;
- fiches detaillees `/batisseurs/[slug]`;
- upload et moderation de logos;
- publication automatique de commanditaires;
- feeds OpenG7/OpenG20;
- brouillons sociaux LinkedIn/Facebook;
- factures, recus ou confirmations PDF;
- taxes;
- audit log metier complet;
- gestion avancee des partenaires;
- snapshots publics de transparence.

## Risques restants

- Le texte fiscal final doit etre valide selon la structure juridique reelle d'OpenG7.
- Les commandites payees restent des interets soumis a validation manuelle, pas une visibilite automatique.
- Les depenses publiques et allocations restent limitees au modele existant.
- La page `/batisseurs` depend des noms publics consentis; elle peut etre vide au lancement.
- En mode Stripe-direct, la transparence publique reste agregee et ne peut pas afficher de profils publics consentis.

## Prochaine etape recommandee

Avant d'ouvrir de nouveaux chantiers fonctionnels, faire une revue PR courte:

1. Relire les textes publics non-charite et commandite.
2. Tester un checkout Stripe en mode test.
3. Tester un webhook signe et son rejeu.
4. Verifier le rendu mobile des routes Fonds, Transparence et Batisseurs.
5. Decider le mode de lancement: Stripe-direct sans DB ou PostgreSQL prive.
