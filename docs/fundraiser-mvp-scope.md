# Cadrage MVP - Fonds des batisseurs OpenG7

Date: 2026-07-07  
Projet: OpenG7 - Fonds des batisseurs / Fundraiser  
Statut: cadrage MVP pour la premiere passe de developpement.  
Sources: `docs/fundraiser-functional-analysis.md` et `docs/openg7-fundraiser-functional-analysis-codex-budget.md`.

---

## 1. Objectif

Ce document verrouille le premier perimetre de travail avant modification du code applicatif.

Le but du MVP est de renforcer la confiance autour du Fonds des batisseurs sans lancer toute la plateforme de commandite, d'administration, de publications et de facturation.

Objectif de la premiere semaine:

```text
paiement clair -> consentements minimaux -> metadata Stripe enrichies -> webhook fiable -> DB optionnelle -> transparence publique filtree
```

Le MVP doit rester petit, testable et deployable progressivement.

---

## 2. Principe directeur

Cette semaine, le developpement doit ajouter seulement ce qui augmente la confiance sans creer de promesse de visibilite difficile a respecter.

Les regles structurantes sont:

- aucun paiement n'est confirme depuis le navigateur;
- Stripe webhook reste la source de verite du statut paiement;
- aucune visibilite commanditee n'est publiee automatiquement;
- aucun renseignement prive n'est expose dans les endpoints ou pages publics;
- PostgreSQL est prive et accessible seulement par l'API;
- le montant individuel reste masque par defaut;
- le nom public est affiche seulement avec consentement explicite;
- aucune promesse de recu officiel de don de bienfaisance n'est faite.

---

## 3. Perimetre inclus dans le MVP

### 3.1 Interface publique

Inclus:

- ajouter la route canonique `/fonds-des-batisseurs`;
- conserver les routes existantes et le comportement bilingue;
- conserver `/` comme accueil ou alias selon la structure actuelle;
- ajouter une mention visible de non-charite avant le paiement;
- distinguer visuellement contribution personnelle et commandite d'entreprise en validation;
- conserver la page de transparence existante;
- garder les etats succes/echec existants si geres par query string.

### 3.2 Contribution et consentements

Inclus:

- type `personal_support`;
- type `sponsorship_interest`;
- reserver `partner_interest` pour plus tard si utile dans les types, sans parcours complet;
- consentement d'affichage du nom;
- consentement d'affichage du montant;
- acceptation obligatoire de la mention non-charite;
- validation serveur des montants;
- validation serveur des types et consentements requis.

### 3.3 Stripe

Inclus:

- enrichir les metadata Stripe avec:
  - `program=builders_fund`;
  - `project=openg7`;
  - `contributionType`;
  - `publicDisplayConsent`;
  - `displayAmountConsent`;
  - `nonCharityAcknowledged`;
  - `requiresReview=true` pour `sponsorship_interest`;
- refuser la creation de session si `nonCharityAcknowledged` n'est pas `true`;
- garder les secrets Stripe cote API seulement;
- conserver le mock checkout local si deja present et utile.

### 3.4 PostgreSQL minimal

Inclus:

- ajouter une persistance PostgreSQL optionnelle activee par `DATABASE_URL`;
- garder le comportement actuel si `DATABASE_URL` est absent;
- creer les tables minimales:
  - `stripe_events`;
  - `stripe_checkout_sessions`;
  - `fund_contributions`;
- versionner les migrations;
- documenter le deploiement PostgreSQL Docker prive;
- ne pas exposer le port `5432` publiquement.

### 3.5 Webhooks Stripe

Inclus:

- verifier la signature Stripe;
- journaliser les evenements dans `stripe_events`;
- rendre le traitement idempotent avec `stripe_event_id` unique;
- gerer au minimum:
  - `checkout.session.completed`;
  - `checkout.session.expired`;
  - `payment_intent.succeeded`;
  - `payment_intent.payment_failed`;
  - `charge.refunded`;
- preparer `charge.dispute.created` si simple et peu couteux;
- eviter toute double comptabilisation.

### 3.6 Transparence publique

Inclus:

- lire les agregats depuis PostgreSQL lorsque disponible;
- garder un fallback Stripe-direct si la DB est absente;
- afficher les totaux agreges;
- afficher les remboursements si disponibles;
- afficher le solde estime;
- afficher la derniere mise a jour;
- ne jamais retourner courriel, id Stripe, contact prive ou metadata sensible;
- ne pas afficher de montant individuel sans consentement.

---

## 4. Perimetre exclu cette semaine

Exclu du MVP:

- back-office admin complet;
- authentification admin production;
- upload de logos;
- fiches detaillees `/batisseurs/[slug]`;
- page `/batisseurs` riche;
- publications commanditees;
- generation de brouillons OpenG7/OpenG20;
- feeds OpenG7/OpenG20;
- integration LinkedIn/Facebook;
- PDF de facture et recus officiels de don;
- taxes;
- audit log metier complet;
- roles et permissions avances;
- moderation avancee;
- gestion complete des partenaires.

Ces travaux deviennent pertinents apres stabilisation de:

```text
metadata Stripe + DB minimale + webhooks idempotents + transparence publique filtree
```

---

## 5. Decisions MVP

### D-001 - Mention non-charite

Texte court a afficher avant paiement:

```text
OpenG7 est un projet independant en developpement. Les contributions au Fonds des batisseurs ne constituent pas des dons a un organisme de bienfaisance enregistre. Aucun recu officiel de don de bienfaisance n'est emis. Une confirmation descriptive peut etre fournie lorsque necessaire.
```

Version anglaise recommandee:

```text
OpenG7 is an independent project in development. Contributions to the Builders Fund are not donations to a registered charity. No official charitable donation receipt is issued. A descriptive confirmation may be provided when needed.
```

### D-002 - Commandite en validation

Une entreprise peut manifester son interet ou payer une commandite, mais aucune visibilite publique n'est automatique.

Texte court recommande:

```text
Les commandites de visibilite sont soumises a une validation manuelle. OpenG7 se reserve le droit d'approuver, modifier, refuser ou retirer une visibilite si elle est incompatible avec la mission du projet, presente un risque legal ou nuit a la confiance du public.
```

Version anglaise recommandee:

```text
Visibility sponsorships are subject to manual review. OpenG7 reserves the right to approve, edit, refuse, or remove visibility when it is incompatible with the project mission, creates legal risk, or harms public trust.
```

### D-003 - Montants autorises

Les montants doivent etre controles cote API.

Decision MVP:

- conserver les montants deja supportes par l'application;
- harmoniser UI, API et `.env.example` si une divergence est observee;
- refuser tout montant non autorise cote serveur;
- conserver la devise `CAD` pour le MVP.

### D-004 - Anonymat et affichage public

Decision MVP:

- le nom est masque par defaut;
- le montant individuel est masque par defaut;
- le nom peut etre affiche avec `publicDisplayConsent=true`;
- le montant peut etre affiche seulement avec `displayAmountConsent=true`;
- les courriels, contacts, identifiants Stripe et notes privees ne sont jamais publics.

### D-005 - PostgreSQL prive

Decision MVP:

- PostgreSQL roule dans Docker sur le serveur Linux;
- l'API `funding-api` est le seul service applicatif qui s'y connecte;
- le port `5432` ne doit pas etre expose publiquement;
- aucun secret DB ne doit etre commite;
- l'application doit demarrer sans DB lorsque `DATABASE_URL` est absent.

### D-006 - Source de verite paiement

Decision MVP:

- le retour navigateur affiche seulement un etat utilisateur;
- le statut financier final vient des webhooks Stripe signes;
- `stripe_event_id` doit etre unique;
- un evenement Stripe livre deux fois ne doit jamais creer deux contributions payees.

---

## 6. Routes impactees

Routes a traiter dans le premier lot code:

| Route | Decision MVP |
| --- | --- |
| `/` | Accueil existant conserve. |
| `/fonds-des-batisseurs` | Route canonique a ajouter vers la page Fonds. |
| `/en` | Accueil anglais existant conserve. |
| `/en/fonds-des-batisseurs` | Route canonique anglaise a ajouter. |
| `/fonds-des-batisseurs/a-propos` | Conserver. |
| `/fonds-des-batisseurs/transparence` | Conserver, puis enrichir plus tard. |
| `/batisseurs` | Reporter ou garder une page tres simple apres le coeur paiement/DB. |

SEO a verifier:

- canonical;
- hreflang;
- sitemap;
- prerender Angular SSR;
- titres et descriptions bilingues.

---

## 7. Donnees et metadata MVP

### Contribution

Champs fonctionnels minimaux:

- `contributionType`;
- `amountCents`;
- `currency`;
- `publicName`;
- `emailPrivate`;
- `publicDisplayConsent`;
- `displayAmountConsent`;
- `nonCharityAcknowledged`;
- `stripeSessionId`;
- `stripePaymentIntentId`;
- `status`;
- `paidAt`.

Statuts minimaux:

- `pending`;
- `paid`;
- `failed`;
- `expired`;
- `refunded`;
- `disputed`;
- `hidden`.

### Metadata Stripe

Metadata minimales:

```text
program=builders_fund
project=openg7
contributionType=personal_support | sponsorship_interest
publicDisplayConsent=true | false
displayAmountConsent=true | false
nonCharityAcknowledged=true
requiresReview=true | false
```

Regle:

```text
requiresReview=true uniquement pour sponsorship_interest dans le MVP.
```

---

## 8. Ordre de travail valide

### Lot 1 - Route canonique et texte public

Objectif:

- ajouter `/fonds-des-batisseurs`;
- ajouter `/en/fonds-des-batisseurs`;
- mettre a jour prerender, SEO et sitemap si necessaire;
- afficher la mention non-charite;
- presenter la commandite comme une demande soumise a validation.

Validation:

- build Angular passe;
- les routes FR/EN fonctionnent;
- la mention non-charite est visible avant paiement;
- aucune route existante n'est cassee.

### Lot 2 - Types partages, consentements et metadata Stripe

Objectif:

- ajouter les champs partages;
- valider cote API;
- enrichir metadata Stripe;
- refuser une session sans acceptation non-charite.

Validation:

- tests ou build passent;
- API refuse les payloads incomplets;
- metadata Stripe contiennent les champs MVP;
- aucun statut paiement n'est confirme cote client.

### Lot 3 - PostgreSQL minimal

Objectif:

- ajouter migrations;
- ajouter repository minimal;
- activer DB seulement avec `DATABASE_URL`;
- documenter Docker prive et sauvegarde minimale.

Validation:

- API demarre sans DB;
- API peut se connecter avec DB;
- migrations versionnees;
- aucun secret dans le frontend ni dans Git.

### Lot 4 - Webhooks idempotents

Objectif:

- stocker `stripe_events`;
- traiter les evenements MVP;
- mettre a jour les contributions;
- eviter les doublons.

Validation:

- deux livraisons du meme event ne doublent pas les totaux;
- une session expiree ne compte pas;
- un remboursement reduit les agregats;
- les logs ne contiennent pas de secret.

### Lot 5 - Transparence DB legere

Objectif:

- lire les agregats DB si disponible;
- garder fallback Stripe-direct;
- filtrer strictement les donnees publiques.

Validation:

- page fonctionnelle avec ou sans DB;
- aucune donnee privee exposee;
- montant individuel masque sans consentement.

---

## 9. Risques et mitigations

| Risque | Mitigation MVP |
| --- | --- |
| Confusion avec un don de bienfaisance | Mention non-charite visible avant paiement. |
| Double comptabilisation Stripe | Webhooks signes et `stripe_event_id` unique. |
| Publication de donnees privees | Endpoints publics agreges et champs filtres. |
| Visibilite commanditee promise trop tot | Commandite limitee a `sponsorship_interest` avec validation manuelle. |
| DB exposee publiquement | Docker reseau prive, pas de port `5432` public. |
| MVP trop large | Exclure admin, feeds, PDF, logos et automatisations sociales. |
| Regressions prerender/SEO | Modifier routes, SSR et sitemap dans le meme lot. |

---

## 10. Definition de termine MVP

Le MVP est termine lorsque:

- `/fonds-des-batisseurs` et `/en/fonds-des-batisseurs` existent;
- la mention non-charite est visible avant paiement;
- les consentements minimaux sont transmis et valides;
- les metadata Stripe sont enrichies;
- PostgreSQL peut etre active via `DATABASE_URL`;
- l'API fonctionne encore sans DB;
- les webhooks Stripe sont idempotents;
- aucun paiement n'est comptabilise sans confirmation Stripe;
- la transparence publique ne publie aucune donnee privee;
- la documentation DB/deploiement est a jour;
- le build passe.

---

## 11. Prochaine action

Premier travail code recommande:

```text
Ajouter la route canonique /fonds-des-batisseurs et la mention non-charite visible, sans encore modifier la base de donnees ni creer de back-office.
```

Fichiers probables:

- `apps/funding-web/src/app/app.routes.ts`;
- `apps/funding-web/src/app/app.routes.server.ts`;
- `apps/funding-web/src/app/features/funding/services/funding-i18n.service.ts`;
- `apps/funding-web/src/app/features/funding/services/funding-seo.service.ts`;
- `apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts`;
- `apps/funding-web/src/assets/i18n/fr-CA.json`;
- `apps/funding-web/src/assets/i18n/en.json`;
- `apps/funding-web/src/sitemap.xml`.
