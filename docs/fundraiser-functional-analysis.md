# Analyse fonctionnelle - Evolution du Fundraiser OpenG7

Date: 2026-07-05  
Perimetre: analyse produit, fonctionnelle, technique, UX, conformite et architecture.  
Statut: document d'analyse, aucune fonctionnalite implementee.

## 1. Resume executif

La plateforme actuelle d'OpenG7 est deja une base solide pour un Fonds des batisseurs public: elle combine une application Angular statique, une API Node pour Stripe Checkout, une page de transparence financiere agregee, une integration Stripe-direct possible sans base de donnees et un deploiement Docker Compose avec Traefik et Let's Encrypt.

L'evolution demandee consiste a transformer ce mecanisme de contribution en plateforme structuree de contribution personnelle, commandite d'entreprise, partenariat batisseur, transparence publique, contreparties de visibilite et brouillons de publications pour les feeds OpenG7/OpenG20.

La recommandation principale est de construire cette evolution en phases. Le MVP ne devrait pas tenter de tout automatiser. Il devrait d'abord distinguer clairement les types de contribution, ajouter les consentements, enrichir les metadata Stripe, stocker les paiements confirmes via webhooks, publier une transparence robuste, puis introduire un back-office minimal de validation humaine. La publication commanditee doit rester explicitement moderee: une commandite peut generer automatiquement des brouillons, mais seule une validation humaine peut publier dans les feeds.

Posture legale et fiscale a integrer partout ou une contribution est proposee:

> OpenG7 est un projet independant en developpement. Les contributions ne constituent pas des dons a un organisme de bienfaisance enregistre. Les contributions d'entreprise peuvent etre documentees comme commandites de visibilite ou contributions promotionnelles, selon la situation propre a chaque entreprise. Aucun recu officiel de don de bienfaisance n'est emis. Une facture ou confirmation descriptive peut etre fournie.

## 2. Etat actuel du projet

### Architecture inspectee

Le depot est un monorepo Yarn avec:

| Zone | Etat observe | Fichiers principaux |
| --- | --- | --- |
| Frontend | Angular standalone, routes publiques bilingues, rendu statique/prerender | `apps/funding-web/src/app/app.routes.ts`, `apps/funding-web/src/app/app.routes.server.ts` |
| API | Serveur Node HTTP minimal, Stripe Checkout, webhooks, transparence publique | `apps/funding-api/src/main.ts`, `stripe-webhook.service.ts`, `stripe-transparency.service.ts` |
| Domaine partage | Types de checkout, transparence et modeles funding | `packages/funding-core/src/index.ts`, `packages/funding-models/src/index.ts` |
| Transparence DB future | Migration PostgreSQL optionnelle | `apps/funding-api/migrations/001_create_fund_transparency_tables.sql` |
| Deploiement | Docker Compose, Traefik, Nginx, Let's Encrypt HTTP-01 | `docker-compose.yml`, `traefik/traefik.yml`, `traefik/dynamic.yml` |
| Documentation | Checklist lancement, deploiement, commandes | `README.md`, `docs/docker-deployment.md`, `docs/production-launch-checklist.md` |

### Framework et routes

Le frontend utilise Angular avec composants standalone, `signal()`, `computed()`, `effect()`, `@ngx-translate/core`, prerender Angular SSR et routes bilingues.

Routes publiques existantes:

| Route FR | Route EN | Statut |
| --- | --- | --- |
| `/` | `/en` | Page principale Fonds des batisseurs |
| `/ecosystem` | `/en/ecosystem` | Ecosysteme OpenG7 |
| `/support` | `/en/support` | Support et GitHub |
| `/music` | `/en/music` | Musique/OpenG7 |
| `/boutique` | `/en/boutique` | Boutique NorthDragon |
| `/fonds-des-batisseurs/a-propos` | `/en/fonds-des-batisseurs/a-propos` | A propos |
| `/fonds-des-batisseurs/transparence` | `/en/fonds-des-batisseurs/transparence` | Transparence publique |

Routes developpeur locales existantes:

| Route | Acces | Role actuel |
| --- | --- | --- |
| `/dev/stripe-setup` | localhost seulement | Assistant configuration Stripe |
| `/dev/webhooks` | localhost seulement | Documentation/test webhooks |
| `/dev/api-keys` | localhost seulement | Documentation clefs/API Stripe |

Il n'existe pas encore de vraies routes admin production, de page `/batisseurs`, de fiche commanditaire, de formulaire commandite, de route feed OpenG7/OpenG20 ou de systeme de publication.

### UI, theme et images

Le theme public est coherent avec l'identite OpenG7:

- palette sombre bleu/noir avec accents or;
- typographie serif pour titres et Trebuchet pour UI;
- visuels dragon, coffre, feuille d'erable, cartes Canada/ecosysteme;
- pages success/cancel integrees via query string `?checkout=success` ou `?checkout=cancel`;
- header commun `FundingHeaderComponent`;
- pages responsives avec focus visible et preference `prefers-reduced-motion`.

La page principale contient deja:

- hero Fonds des batisseurs;
- contribution par montants predefinis et montant libre;
- appel Stripe via API;
- progression mensuelle;
- panneau transparence financiere;
- liens vers transparence, ecosysteme, support, GitHub, NorthDragon.

La page de transparence contient deja:

- KPIs financiers;
- registre public mensuel;
- frais Stripe;
- montant net disponible;
- allocations publiques si disponibles;
- export CSV et JSON;
- section confidentialite;
- contribution depuis la page.

### Stripe et paiement

Etat observe:

- Checkout Session creee via `POST /api/checkout-sessions`.
- Montants autorises cote serveur via `FUNDING_ALLOWED_AMOUNTS`.
- Retour Stripe `success_url` et `cancel_url` valides cote serveur.
- En production, le mock checkout est desactive.
- Webhook avec verification de signature via `STRIPE_WEBHOOK_SECRET`.
- Evenements actuellement geres: `payment_intent.succeeded`, `charge.refunded`, `payout.paid`, `payout.failed`.
- Idempotence DB possible via `stripe_event_id UNIQUE`.
- Transparence publique possible directement depuis Stripe lorsque `DATABASE_URL` est absent.

Limites actuelles:

- Checkout metadata tres minimale: `projectId` seulement.
- Pas de distinction personal_support / sponsorship / partner.
- Pas de collecte consentement.
- Pas de stockage complet des profils contributeurs/commanditaires.
- Pas de gestion `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.dispute.created`.
- Pas de facture/confirmation descriptive.
- Pas de modele de visibilite commanditee.

### Base de donnees et back-office

Le lancement initial est volontairement sans PostgreSQL. Une migration optionnelle existe pour:

- `fund_transactions`;
- `fund_allocations`.

Ce modele est suffisant pour un journal financier public minimal, mais insuffisant pour les commandites, consentements, profils publics, brouillons de publication, factures, audit log et back-office.

Il n'existe pas encore de back-office production authentifie. Les pages qui ressemblent a un admin sont des pages developpeur locales, non accessibles en production selon `CanMatchFn`.

### Feeds OpenG7/OpenG20 et CMS

Aucun CMS general n'a ete observe. Les contenus sont dans des composants Angular et fichiers i18n JSON.

Aucun feed OpenG7/OpenG20 structure n'a ete observe dans le code applicatif. Il faudra definir s'il s'agit:

- de pages internes publiques;
- de flux JSON internes;
- de listes editoriales;
- ou de connecteurs vers LinkedIn/Facebook.

## 3. Vision produit

Le Fonds des batisseurs doit devenir un systeme de confiance qui relie paiement, transparence, consentement, visibilite et publication responsable.

Vision cible:

- une contribution personnelle simple et rapide;
- une commandite d'entreprise comprehensible et documentable;
- un partenariat batisseur plus durable;
- une transparence publique a 100 %, sans divulgation de donnees privees;
- des contreparties de visibilite claires, approuvees manuellement;
- des brouillons de publication prepares pour OpenG7, OpenG20, LinkedIn et Facebook;
- un back-office qui protege OpenG7 contre les erreurs fiscales, reputations et donnees sensibles.

## 4. Objectifs

Objectifs fonctionnels:

- distinguer contribution personnelle, commandite et partenariat;
- collecter les consentements necessaires;
- enrichir les paiements Stripe avec metadata;
- enregistrer les paiements uniquement apres confirmation Stripe;
- publier les totaux, frais, remboursements, depenses et allocations;
- afficher contributeurs/commanditaires seulement avec consentement;
- permettre la validation humaine avant toute publication;
- generer des confirmations descriptives sans promesse fiscale.

Objectifs produit:

- augmenter la credibilite du Fonds;
- rendre l'usage des fonds clair;
- offrir une valeur de visibilite aux entreprises;
- proteger OpenG7 contre la confusion avec un organisme de bienfaisance;
- garder un MVP realiste.

## 5. Personas

### Particulier contributeur

Veut soutenir rapidement OpenG7. Peut vouloir rester anonyme, afficher son nom ou masquer le montant. Doit comprendre que sa contribution n'est pas un don de bienfaisance enregistre.

Besoins:

- montant simple;
- paiement securise;
- option d'anonymat;
- message de confirmation clair;
- transparence sur l'usage global des fonds.

### Entreprise commanditaire

Veut soutenir OpenG7 et obtenir une visibilite publique. Veut fournir logo, site web, description, contact et consentements.

Besoins:

- niveaux de commandite;
- contreparties explicites;
- facture ou confirmation descriptive;
- statut de validation;
- preuve de visibilite publiee;
- mention fiscale prudente.

### Partenaire batisseur

Veut une relation durable, soutenir un volet precis, obtenir une fiche partenaire et parfois parler a OpenG7 avant paiement.

Besoins:

- formulaire plus detaille;
- option "demander un contact";
- fiche publique;
- plan de visibilite;
- validation humaine.

### Administratrice OpenG7

Veut voir les paiements, approuver les commanditaires, gerer logos, brouillons, feeds, depenses, transparence, exports et corrections.

Besoins:

- dashboard admin;
- filtres et statuts;
- moderation;
- audit log;
- export CSV;
- protection juridique et reputationnelle.

### Visiteur public

Veut comprendre le Fonds, voir ce qui est finance, qui soutient OpenG7 et pourquoi l'initiative est credible.

Besoins:

- page claire;
- transparence financiere;
- liens GitHub;
- distinction open source MIT;
- commanditaires approuves.

## 6. Parcours utilisateurs

### Parcours A - Contribution personnelle

1. L'utilisateur arrive sur `/fonds-des-batisseurs` ou `/`.
2. Il choisit "Contribution personnelle".
3. Il choisit un montant predefini ou libre.
4. Il choisit affichage public oui/non.
5. Il choisit affichage du montant oui/non.
6. Il accepte la mention transparence et non-charite.
7. Il passe au paiement Stripe.
8. Stripe redirige vers succes ou echec.
9. Le webhook Stripe confirme le paiement.
10. La contribution passe a `paid`.
11. Les totaux publics sont mis a jour.
12. Le contributeur apparait seulement selon consentement.

### Parcours B - Commandite d'entreprise

1. L'entreprise choisit "Commandite d'entreprise".
2. Elle choisit un niveau.
3. Elle fournit nom, site, logo, courriel, contact, description, secteur, region et consentements.
4. Elle accepte la mention fiscale.
5. Elle paie avec Stripe.
6. Le webhook confirme.
7. La commandite passe a `paid_pending_review`.
8. Les contreparties de visibilite sont creees en `planned`.
9. Des brouillons de publication sont generes.
10. L'administratrice approuve, modifie ou refuse.
11. Le commanditaire approuve est publie.
12. Les publications internes/sociales sont diffusees seulement apres validation.

### Parcours C - Partenariat batisseur

1. L'organisation choisit "Partenariat batisseur".
2. Elle remplit un formulaire detaille.
3. Elle precise le type de partenariat et le volet soutenu.
4. Elle paie ou demande un contact.
5. L'administratrice valide.
6. Une fiche partenaire est creee.
7. Les contreparties sont planifiees.
8. Les publications restent en brouillon jusqu'a approbation.

### Parcours D - Paiement reussi

1. Stripe redirige vers la page ou l'etat succes.
2. Le message confirme le paiement.
3. Pour une commandite, la page precise que la visibilite doit etre validee.
4. Le visuel peut utiliser coffre ouvert, lumiere doree et dragon present.
5. Un lien mene vers la transparence et, pour les entreprises, vers les prochaines etapes.

### Parcours E - Paiement echoue ou annule

1. Stripe redirige vers l'etat echec/annule.
2. Aucun montant n'est ajoute au Fonds.
3. L'utilisateur peut reessayer.
4. Le visuel peut utiliser coffre ferme, ambiance sombre et bouton "Reessayer".

## 7. Exigences fonctionnelles

| ID | Priorite | Description | Utilisateur | Criteres d'acceptation | Dependances |
| --- | --- | --- | --- | --- | --- |
| F-001 | MVP | Contribution personnelle | Particulier | Montant valide, paiement Stripe, retour succes/echec | Stripe Checkout |
| F-002 | MVP | Commandite entreprise | Entreprise | Niveau choisi, formulaire, paiement, statut review | DB, Stripe metadata |
| F-003 | Phase 3 | Partenariat batisseur | Organisation | Demande contact ou paiement, statut review | Back-office |
| F-004 | MVP | Paiement Stripe | Tous | Session creee cote serveur, montant controle | API |
| F-005 | MVP | Webhook Stripe | Systeme | Signature verifiee, idempotence, statut final Stripe | STRIPE_WEBHOOK_SECRET |
| F-006 | MVP | Page succes | Tous | Message clair et prochaines etapes | Frontend |
| F-007 | MVP | Page echec | Tous | Aucun montant ajoute, reessai possible | Frontend |
| F-008 | MVP | Page transparence | Public | Totaux, frais, solde, MAJ visibles | Stripe/DB |
| F-009 | Phase 2 | Page Batisseurs | Public | Contributeurs/commanditaires publics consentis | DB consentements |
| F-010 | MVP | Consentements affichage | Tous | Nom, montant, logo, publication separes | Formulaires |
| F-011 | Phase 3 | Back-office admin | Admin | Login, listes, approbations | Auth |
| F-012 | Phase 2 | Gestion depenses | Admin | Ajouter, publier, corriger depenses | DB |
| F-013 | Phase 3 | Contreparties visibilite | Admin | Benefits generes selon niveau | Sponsorship |
| F-014 | Phase 3 | Brouillons publications | Admin | Brouillons OpenG7/OpenG20 generes | Templates |
| F-015 | Phase 3 | Validation publication | Admin | Approver/refuser/programmer | Auth, audit |
| F-016 | Phase 3 | Feed OpenG7 | Public/Admin | Items internes publies apres validation | Feed model |
| F-017 | Phase 4 | Feed OpenG20 | Public/Admin | Criteres de pertinence plus stricts | Feed model |
| F-018 | Phase 2 | Export CSV | Admin/Public | Exports transparence et admin | DB |
| F-019 | Phase 4 | Facture/confirmation descriptive | Entreprise | PDF ou email sans promesse fiscale | Donnees legales |
| F-020 | Phase 3 | Audit log | Admin | Actions critiques tracees | DB/auth |

## 8. Exigences non fonctionnelles

| Domaine | Exigence |
| --- | --- |
| Securite | Validation serveur, webhooks signes, admin protege, secrets non exposes |
| Confidentialite | Aucun courriel public, aucune donnee Stripe personnelle, consentements granulaires |
| Performance | Pages publiques prerender autant que possible, API simple, caches prudents |
| Accessibilite | Contrastes, focus visible, clavier, erreurs explicites, hierarchie titres |
| Maintenabilite | Types partages, entites claires, migration DB versionnee |
| Scalabilite | Passer de Stripe-direct a PostgreSQL sans casser les pages |
| Resilience | Idempotence webhook, reprise apres erreurs Stripe, statuts explicites |
| Auditabilite | Historique paiements, corrections, publications, refus |
| SEO | Titres, descriptions, canonical, hreflang, sitemap |
| Conformite prudente | Aucune promesse de recu fiscal, divulgation commandite visible |
| Logs | Erreurs Stripe et actions admin journalisees sans secrets |

## 9. Routes proposees

| Route | Statut actuel | MVP | Recommandation |
| --- | --- | --- | --- |
| `/fonds-des-batisseurs` | Non existante; `/` joue ce role | Oui | Ajouter alias ou route canonique dediee |
| `/fonds-des-batisseurs/contribuer` | Non existante | Optionnel | Peut etre section ancree en MVP |
| `/fonds-des-batisseurs/succes` | Non existante; query string actuelle | Phase 2 | Garder query string MVP, route dediee future |
| `/fonds-des-batisseurs/echec` | Non existante; query string actuelle | Phase 2 | Garder query string MVP |
| `/fonds-des-batisseurs/transparence` | Existante | Oui | A etendre |
| `/batisseurs` | Non existante | Phase 2 | Page publique contributeurs/commanditaires |
| `/batisseurs/[slug]` | Non existante | Phase 3 | Fiche sponsor/partenaire |
| `/admin/fundraiser` | Non existante | Phase 3 | Dashboard admin |
| `/admin/fundraiser/contributions` | Non existante | Phase 3 | Liste et corrections |
| `/admin/fundraiser/sponsors` | Non existante | Phase 3 | Validation sponsor |
| `/admin/fundraiser/visibility` | Non existante | Phase 3 | Contreparties |
| `/admin/fundraiser/publications` | Non existante | Phase 3 | Brouillons |
| `/admin/fundraiser/expenses` | Non existante | Phase 2/3 | Depenses |
| `/admin/fundraiser/transparency` | Non existante | Phase 3 | Snapshots |
| `/feeds/openg7` | Non existante | Phase 3 | Feed interne public ou JSON |
| `/feeds/openg20` | Non existante | Phase 4 | Feed plus selectif |

Impact navigation:

- Ajouter un choix clair "Contribuer", "Commanditer", "Transparence", "Batisseurs".
- Garder les routes developpeur sous `/dev/*` hors production.
- Eviter de surcharger le header public avec des routes admin.

## 10. Modele de donnees conceptuel

### Contribution

Champs: id, type, amount, currency, email, publicName, message, publicDisplayConsent, displayAmountConsent, stripeSessionId, stripePaymentIntentId, status, createdAt, source.

Relations: StripeCheckoutSession, Sponsor optionnel, PublicProfile optionnel.

Statuts: `pending`, `paid`, `failed`, `refunded`, `disputed`, `hidden`, `published`.

Public: montant agrege; nom/montant individuel seulement avec consentement.

Prive: email, ids Stripe, message non approuve.

Risques: double comptabilisation, consentement ambigu, confusion don.

### Sponsor

Champs: id, businessName, legalName, website, contactEmail, contactName, logoAssetId, shortDescription, sector, country, province, status.

Relations: Sponsorship, PublicProfile, VisibilityBenefit, PublicationDraft.

Public: nom, logo, site, description, niveau seulement apres approbation.

Prive: contact, courriel, notes admin.

Risques: logo non autorise, entreprise incompatible, lien externe problematique.

### Partner

Champs: id, organizationName, contact, website, description, proposal, intendedAmount, paymentMode, status.

Relations: PublicProfile, ProjectAllocation, Sponsorship optionnelle.

Statuts: `inquiry`, `pending_review`, `accepted`, `rejected`, `active`, `archived`.

### Sponsorship

Champs: id, sponsorId, tier, amount, currency, paymentStatus, reviewStatus, consentLogo, consentAmount, consentPublication, invoiceRecordId.

Statuts: `pending_payment`, `paid_pending_review`, `approved`, `published`, `rejected`, `archived`.

### VisibilityBenefit

Champs: id, sponsorshipId, channel, feedTarget, description, status, plannedAt, fulfilledAt, publicUrl.

Statuts: `planned`, `draft_created`, `pending_review`, `approved`, `scheduled`, `published`, `rejected`, `cancelled`.

### PublicationDraft

Champs: id, sponsorshipId, sponsorId, channel, feedTarget, title, text, image, hashtags, disclosureText, status, approvedBy, rejectedReason, publicUrl.

Regle: toujours inclure une divulgation claire de commandite.

### FeedItem

Champs: id, feed, title, body, image, sourceDraftId, status, publishedAt, publicUrl.

Feeds: OpenG7, OpenG20.

### FundExpense

Champs: id, amount, currency, category, vendor, description, date, internalReceipt, publicVisibility, linkedProject, explanatoryNote, status.

Statuts: `draft`, `published`, `private`, `corrected`.

### TransparencySnapshot

Champs: id, period, totalReceived, totalFees, totalNet, totalRefunded, totalSpent, availableBalance, generatedAt, publishedAt.

Usage: figer un etat public et eviter les variations non expliquees.

### StripeCheckoutSession

Champs: id, stripeSessionId, stripePaymentIntentId, contributionType, amount, currency, metadata, status, expiresAt, createdAt.

Regle: source de paiement non definitive avant webhook.

### PublicProfile

Champs: id, subjectType, subjectId, slug, displayName, logo, website, description, country, province, tier, visibilitySummary, publishedAt.

### InvoiceRecord

Champs: id, contributionId, sponsorshipId, invoiceNumber, legalName, amount, taxes, issuedAt, status, fileUrl.

Regle: confirmation descriptive, pas recu de don de bienfaisance.

### ProjectAllocation

Champs: id, projectName, publicDescription, amountAllocated, category, status, publishedAt.

### AuditLog

Champs: id, actorId, action, entityType, entityId, beforeJson, afterJson, ipHash, createdAt.

Regle: obligatoire pour publication, refus, correction financiere, emission facture.

## 11. Integration Stripe

### Recommandation MVP

Utiliser Checkout Session via API personnalisee, pas seulement Payment Links, parce que la plateforme doit controler:

- metadata;
- consentements;
- success_url/cancel_url;
- montant;
- type de contribution;
- creation des dossiers commandite;
- idempotence webhook.

### Metadata recommandees

Contribution personnelle:

```text
contributionType=personal_support
program=builders_fund
project=openg7
publicDisplayConsent=true/false
displayAmountConsent=true/false
```

Commandite:

```text
contributionType=sponsorship
program=builders_fund
project=openg7
visibilityTier=builder/sponsor/grand_builder/founding_partner
businessName=...
publicDisplayConsent=true/false
displayAmountConsent=true/false
requiresReview=true
```

Partenariat:

```text
contributionType=partner
program=builders_fund
project=openg7
requiresReview=true
```

### Evenements Stripe a gerer

| Evenement | Usage |
| --- | --- |
| `checkout.session.completed` | Lier session, contribution, metadata, email client |
| `checkout.session.expired` | Marquer pending comme expire |
| `payment_intent.succeeded` | Confirmer paiement |
| `payment_intent.payment_failed` | Marquer echec |
| `charge.refunded` | Reduire net, journaliser remboursement |
| `charge.dispute.created` | Marquer litige |
| `payout.paid` | Transparence des sorties vers compte |
| `payout.failed` | Alerte admin |

Regle essentielle: ne jamais faire confiance au client pour confirmer le paiement. Le statut final doit venir de Stripe ou d'un webhook verifie.

## 12. Transparence financiere

La transparence a 100 % signifie publier tout ce qui est publiable sans exposer les personnes.

Publier:

- total recu;
- total frais Stripe;
- total net;
- remboursements/litiges;
- depenses publiees;
- solde estime;
- objectifs;
- derniere mise a jour;
- contributeurs publics consentis;
- commanditaires approuves;
- partenaires batisseurs;
- contreparties de visibilite accordees;
- projets soutenus.

Ne pas publier:

- courriels;
- donnees Stripe personnelles;
- coordonnees;
- montant individuel sans consentement;
- logo ou entreprise avant validation;
- notes admin.

La page actuelle est une bonne V1 pour les agregats. Elle doit evoluer vers un registre plus riche, avec snapshots et explication des corrections.

## 13. Commandite et visibilite

### Niveaux proposes

Structure MVP:

| Niveau | Montant indicatif | Contreparties MVP |
| --- | --- | --- |
| Batisseur | 50 $ a 249 $ | Mention publique simple, nom dans page Batisseurs |
| Commanditaire | 250 $ a 999 $ | Logo, lien, mention, brouillon OpenG7 |
| Grand batisseur | 1 000 $ a 4 999 $ | Fiche partenaire, publication dediee, presence transparence |
| Partenaire fondateur | 5 000 $ et plus | Fiche complete, visibilite prioritaire, soutien volet precis |

Contribution personnelle MVP: 5 $, 10 $, 25 $, 50 $, montant libre. Le projet actuel propose 5, 10, 25, 50 dans la configuration et accepte aussi 100 cote `.env.example`; il faut harmoniser UI/API.

### Regle d'or

Une commandite peut generer automatiquement des brouillons, mais seule une validation humaine peut publier dans les feeds.

### Droit de refus

OpenG7 doit se reserver le droit d'approuver, modifier, refuser ou retirer une visibilite pour:

- incompatibilite avec la mission;
- contenu haineux;
- desinformation;
- produits/services problematiques;
- pression politique abusive;
- conflit avec l'image OpenG7;
- risque legal;
- risque reputationnel;
- information trompeuse.

## 14. Publications commanditees

Chaque commandite approuvee peut generer des `PublicationDraft`.

Champs recommandes:

- id;
- sponsorshipId;
- sponsorId;
- channel;
- feedTarget;
- title;
- text;
- image;
- hashtags;
- disclosureText;
- status;
- createdAt;
- approvedAt;
- publishedAt;
- publicUrl;
- approvedBy;
- rejectedReason.

Mentions obligatoires possibles:

- "Commandite de visibilite - Fonds des batisseurs";
- "Publication commanditee";
- "Cette publication fait partie d'une contrepartie de visibilite associee au Fonds des batisseurs OpenG7."

Exemple OpenG7:

```text
Commandite de visibilite - Fonds des batisseurs

OpenG7 remercie [Nom de l'entreprise] pour son soutien au developpement du projet.

Cette contribution aide a financer l'infrastructure, les outils de creation, les prototypes, la documentation et l'evolution de l'ecosysteme open source OpenG7.

[Nom de l'entreprise] est maintenant reconnue comme Commanditaire batisseur.

Transparence : cette publication fait partie d'une contrepartie de visibilite associee au Fonds des batisseurs.

#OpenG7 #FondsDesBatisseurs #Commandite #OpenSource #Innovation
```

Exemple OpenG20:

```text
Commandite de visibilite - Ecosysteme OpenG20

OpenG20 souligne le soutien de [Nom de l'entreprise] au developpement d'initiatives ouvertes liees a la collaboration, a l'innovation et a la resilience economique.

Cette visibilite est accordee dans le cadre du Fonds des batisseurs OpenG7/OpenG20.

#OpenG20 #Innovation #Collaboration #Commandite #Transparence
```

## 15. Feeds OpenG7/OpenG20

Feed OpenG7:

- innovation;
- numerique;
- open source;
- Canada/provinces;
- entrepreneuriat;
- resilience;
- ecosysteme OpenG7;
- developpement local/national.

Feed OpenG20:

- portee internationale;
- economie;
- industrie;
- logistique;
- collaboration interregionale;
- resilience mondiale;
- initiatives humanitaires;
- projets transfrontaliers;
- ecosysteme OpenG20.

Options de visibilite:

- OpenG7 seulement;
- OpenG20 seulement;
- OpenG7 + OpenG20;
- aucun feed, seulement page Batisseurs;
- LinkedIn/Facebook manuel.

MVP publication:

- generer brouillons internes;
- publier dans feeds internes;
- copier-coller LinkedIn/Facebook;
- bouton "Copier la publication LinkedIn";
- bouton "Copier la publication Facebook";
- bouton "Marquer comme publie".

Futur:

- Meta Pages API;
- LinkedIn API;
- planification;
- metriques;
- URLs publiques;
- automatisation partielle.

## 16. Back-office admin

### MVP admin recommande

Dashboard:

- total recu;
- total depense;
- solde;
- commandites en attente;
- publications a approuver;
- depenses a publier;
- erreurs Stripe.

Contributions:

- liste;
- filtres statut/type;
- affichage public oui/non;
- export CSV.

Commanditaires:

- validation;
- logo;
- description;
- niveau;
- site web;
- statut.

Publications:

- brouillons;
- canal;
- feed cible;
- approbation;
- publication;
- marquer comme publie.

Depenses:

- ajouter depense;
- categorie;
- fournisseur;
- montant;
- visibilite publique;
- publier/masquer.

Transparence:

- generer snapshot;
- publier resume;
- corriger donnees;
- date de mise a jour.

### Authentification

Le projet n'a pas encore d'auth admin production. Avant tout back-office, il faut choisir:

- auth simple protegee par reverse proxy;
- session admin avec fournisseur externe;
- ou integration identite future.

Les pages `/dev/*` existantes ne doivent pas devenir un admin production sans refonte securite.

## 17. Securite

Exigences:

- validation serveur des montants, types, niveaux;
- ne jamais faire confiance au client pour le statut paiement;
- signature Stripe obligatoire;
- idempotence par evenement Stripe;
- routes admin authentifiees;
- validation stricte des URLs;
- validation uploads logo: type, taille, dimensions, scan;
- filtrage HTML/scripts;
- pas de secrets dans le frontend;
- rate limiting formulaires publics;
- audit log actions admin;
- HTTPS obligatoire;
- CSP ajustee si uploads/images externes;
- separation donnees publiques/privees.

Risques techniques actuels:

- API HTTP minimale sans framework: simple, mais validation/schema et middlewares admin a ajouter prudemment.
- Pas de stockage persistant en lancement rapide: pratique, mais insuffisant pour commandites et consentements.
- CORS base sur origines: bon depart, mais doit rester strict.
- Pages dev locales: verifier continuellement qu'elles restent inaccessibles en production.

## 18. Confidentialite et consentement

Consentements a collecter:

- afficher nom;
- afficher montant;
- afficher logo;
- afficher lien;
- publier une mention commanditee;
- utiliser description fournie;
- recevoir une confirmation/facture;
- accepter la mention non-charite.

Regles:

- courriel jamais public;
- coordonnees jamais publiques;
- ids Stripe jamais publics;
- montant individuel masque par defaut recommande;
- logo et nom d'entreprise non publies avant validation;
- possibilite de retirer une visibilite sur demande raisonnable.

## 19. Accessibilite

Le projet contient deja:

- focus visible global;
- structure de sections;
- textes alternatifs pour plusieurs images;
- responsive mobile;
- reduction de mouvement.

A renforcer:

- erreurs formulaire associees aux champs;
- annonces aria-live pour paiement;
- labels explicites pour consentements;
- contrastes a verifier sur fonds visuels;
- parcours clavier des modales/admin;
- ne pas transmettre une information seulement par couleur;
- eviter autoplay audio/video.

## 20. SEO

Metadonnees recommandees:

| Page | Title | Description |
| --- | --- | --- |
| Fonds | Fonds des batisseurs \| OpenG7 | Soutenez le developpement independant et open source d'OpenG7 grace au Fonds des batisseurs, avec une approche transparente et des options de commandite de visibilite. |
| Transparence | Transparence du Fonds des batisseurs \| OpenG7 | Consultez les contributions, depenses, frais et objectifs du Fonds des batisseurs OpenG7. |
| Batisseurs | Batisseurs OpenG7 | Decouvrez les contributeurs, commanditaires et partenaires qui soutiennent le developpement d'OpenG7. |
| Commandite | Commandite OpenG7 | Devenez commanditaire de visibilite et soutenez le developpement open source d'OpenG7. |

Le service SEO actuel gere title, description, OG, Twitter card, canonical et hreflang. Il faut ajouter les nouvelles routes dans `FundingCanonicalPath`, `supportedCanonicalPaths`, routes Angular, routes prerender et sitemap.

## 21. MVP recommande

### Phase 1 - Fondation publique

- route canonique `/fonds-des-batisseurs`;
- distinction contribution personnelle / commandite;
- mention projet independant;
- mention aucune charite;
- boutons Stripe;
- pages/etats succes et echec;
- metadata Stripe enrichies;
- page Transparence simple;
- page Batisseurs simple.

### Phase 2 - Donnees et webhooks

- stockage contributions;
- webhooks `checkout.session.completed`, `payment_intent.succeeded`, remboursements, litiges;
- consentements;
- total recu;
- frais;
- depenses manuelles;
- solde;
- transparence alimentee par DB.

### Phase 3 - Commandites et visibilite

- formulaire entreprise;
- niveaux;
- logo;
- fiche commanditaire;
- contreparties;
- brouillons publications;
- validation admin;
- feed OpenG7/OpenG20 interne.

### Phase 4 - Back-office avance

- depenses;
- export CSV;
- confirmations/factures;
- audit log;
- profils partenaires;
- page transparence avancee.

### Phase 5 - Automatisation future

- API LinkedIn;
- API Meta;
- planification;
- metriques;
- API open data;
- allocation par projet GitHub;
- dashboard public.

## 22. Roadmap

| Phase | Objectif | Livrables |
| --- | --- | --- |
| 0 | Validation produit/legal | Texte fiscal, niveaux, politique refus, politique remboursement |
| 1 | Formulaire et metadata | Types contribution, consentements, metadata Stripe |
| 2 | Persistance | DB, webhooks, idempotence, transparence DB |
| 3 | Pages publiques | `/batisseurs`, fiches, transparence enrichie |
| 4 | Admin MVP | Contributions, sponsors, depenses, publications |
| 5 | Feeds | OpenG7/OpenG20 internes, brouillons, publication manuelle |
| 6 | Automatisation | APIs sociales, PDF, notifications, metriques |

## 23. Risques

| Risque | Impact | Mitigation |
| --- | --- | --- |
| Confusion avec don de bienfaisance | Legal/fiscal | Mention claire partout, aucune promesse fiscale |
| Promesse fiscale inadequate | Legal | Facture descriptive seulement, recommander comptable |
| Publication commanditee non divulguee | Reputation/conformite | Mention visible obligatoire |
| Entreprise incompatible | Reputation | Review admin et droit de refus |
| Donnees personnelles publiees | Confidentialite | Consentements separes et champs publics/prives |
| Webhook mal securise | Financier | Signature, idempotence, logs |
| Double comptabilisation | Transparence | `stripe_event_id` unique, snapshots |
| Fonds affiches incorrectement | Confiance | Reconciliation Stripe, corrections auditees |
| Faux sentiment de transparence | Reputation | Expliquer methode et limites |
| MVP trop lourd | Delai | Phases strictes |
| APIs sociales complexes | Maintenance | MVP copier-coller manuel |
| Tokens sociaux expires | Publication | Future seulement |
| Contenu commanditaire problematique | Reputation | Moderation et refus |
| Visibilite non respectee | Relation client | Benefits traces avec statuts |

## 24. Questions ouvertes

- Quelle est la structure juridique exacte d'OpenG7 aujourd'hui?
- Quel nom legal doit apparaitre sur les confirmations ou factures?
- OpenG7 possede-t-il un numero d'entreprise?
- Des taxes doivent-elles etre appliquees sur certaines commandites?
- Quelle politique de remboursement adopter?
- Quelle politique de refus/visibilite publier?
- Quelle limite de contribution sans contact prealable?
- Le montant individuel doit-il etre masque par defaut?
- Quel fournisseur de base de donnees utiliser en production?
- Quelle authentification admin choisir?
- Les feeds OpenG7/OpenG20 sont-ils internes, publics, sociaux ou hybrides?
- Les commanditaires peuvent-ils choisir le feed?
- OpenG20 doit-il avoir des criteres d'admissibilite plus stricts?
- Les logos doivent-ils etre valides manuellement avant paiement ou apres paiement?
- Faut-il emettre une confirmation PDF des la phase MVP?
- Quels secteurs/organisations doivent etre exclus?

## 25. Recommandations finales

1. Garder la posture fiscale prudente comme exigence bloquante.
2. Ne pas publier automatiquement les commanditaires ni les publications.
3. Ajouter d'abord les types de contribution et les consentements.
4. Enrichir Stripe metadata avant d'elargir les pages publiques.
5. Passer a PostgreSQL avant les commandites publiques.
6. Construire `/batisseurs` avant les fiches detaillees.
7. Creer un back-office minimal avant toute visibilite commanditee.
8. Garder LinkedIn/Facebook manuel en MVP.
9. Definir les criteres OpenG7/OpenG20 avant de promettre un canal.
10. Harmoniser les montants autorises entre UI, API et documentation.

## Fichiers consultes les plus importants

- `README.md`
- `package.json`
- `angular.json`
- `apps/funding-web/src/app/app.routes.ts`
- `apps/funding-web/src/app/app.routes.server.ts`
- `apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts`
- `apps/funding-web/src/app/features/funding/pages/funding-transparency-page/funding-transparency-page.component.ts`
- `apps/funding-web/src/app/features/funding/services/funding.service.ts`
- `apps/funding-web/src/app/features/funding/services/fund-transparency.service.ts`
- `apps/funding-web/src/app/features/funding/services/funding-seo.service.ts`
- `apps/funding-web/src/app/features/funding/services/funding-i18n.service.ts`
- `apps/funding-web/src/assets/i18n/fr-CA.json`
- `apps/funding-web/src/assets/i18n/en.json`
- `apps/funding-api/src/main.ts`
- `apps/funding-api/src/stripe-webhook.service.ts`
- `apps/funding-api/src/stripe-transparency.service.ts`
- `apps/funding-api/src/fund-transparency.repository.ts`
- `apps/funding-api/migrations/001_create_fund_transparency_tables.sql`
- `packages/funding-core/src/index.ts`
- `packages/funding-models/src/index.ts`
- `docker-compose.yml`
- `traefik/traefik.yml`
- `traefik/dynamic.yml`
- `.env.example`
- `docs/docker-deployment.md`
- `docs/production-launch-checklist.md`

## Decisions a faire valider avant developpement

- Statut juridique et texte final de mention fiscale.
- Niveaux de commandite et montants.
- Politique de refus, remboursement et retrait de visibilite.
- Consentements par defaut, surtout affichage du montant.
- Choix base de donnees et auth admin.
- Definition exacte des feeds OpenG7/OpenG20.
- Niveau d'automatisation sociale accepte en MVP.
- Format facture/confirmation descriptive.

## Prochaines etapes recommandees

1. Valider ce document avec les responsables produit/legal/comptabilite.
2. Rediger les textes publics definitifs: non-charite, transparence, commandite.
3. Decider MVP Phase 1 et schema DB minimal.
4. Concevoir les formulaires contribution/commandite avec consentements.
5. Modifier Stripe metadata et webhooks.
6. Ajouter `/batisseurs` et enrichir la page transparence.
7. Construire ensuite le back-office admin et la moderation des publications.
