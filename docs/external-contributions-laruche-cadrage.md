# Cadrage - Contributions externes et La Ruche

Date: 2026-07-14  
Projet: OpenG7 - Fonds des batisseurs / Fundraiser  
Statut: document d'analyse et de conservation, non implemente.  
Contexte: contribution potentielle de plateformes externes de sociofinancement, avec La Ruche comme premier cas d'etude.

---

## 1. Objectif du document

Ce document conserve le travail d'analyse sur l'integration future de contributions externes dans `openg7-funding-platform`.

L'objectif n'est pas d'implementer maintenant. Plusieurs reponses operationnelles, legales et comptables manquent encore, notamment sur le format reel d'export La Ruche, les consentements, les frais et la preuve de paiement.

Ce document sert donc de reference pour une reprise ulterieure.

---

## 2. Decision d'organisation

Pour le MVP, cette fonctionnalite devrait rester dans le repository `openg7-funding-platform`.

Raison: elle touche directement le domaine existant du financement:

- `fund_contributions`;
- back-office admin;
- transparence publique;
- commandites;
- consentements;
- audit;
- rapprochement comptable.

Un nouveau repo ne serait justifie que plus tard, si OpenG7 cree un vrai service autonome de connecteurs externes, avec synchronisation planifiee, secrets specifiques, API provider, webhooks et reutilisation par plusieurs projets.

Structure interne recommandee si le travail reprend:

```text
apps/funding-api/src/external-contributions/
apps/funding-web/src/app/features/funding/pages/admin-imports-page/
packages/funding-core/src/external-contributions.ts
docs/external-contributions-laruche-cadrage.md
```

Les noms doivent rester generiques: `ExternalContributionProvider`, `ImportBatch`, `ImportRow`, `ReconciliationStatus`, `PaymentEvidenceSource`. Eviter de coder tout autour de `laruche`.

---

## 3. Etat actuel observe

Le systeme actuel est centre sur Stripe.

Observations importantes:

- `fund_contributions` existe deja comme table metier principale des contributions, avec `contribution_type`, montant, devise, consentements, statut et references Stripe: `apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql`.
- `stripe_events` et `stripe_checkout_sessions` structurent l'idempotence et le suivi des paiements Stripe.
- Les IDs Stripe sont nullable en base, mais les chemins applicatifs actuels restent largement Stripe-first.
- Les statuts metier existants sont generiques (`pending`, `paid`, `failed`, `refunded`, `disputed`, `expired`), mais leur preuve vient aujourd'hui de Stripe.
- La transparence publique lit `fund_contributions` si PostgreSQL est disponible, sinon elle peut retomber sur Stripe direct.
- Les commandites publiques exigent deja consentement, revue admin et filtrage des donnees privees.
- L'audit admin existe via `admin_audit_log`.

Fichiers de reference:

```text
apps/funding-api/migrations/001_create_fund_transparency_tables.sql
apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql
apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql
apps/funding-api/src/fund-contributions.repository.ts
apps/funding-api/src/fund-transparency.repository.ts
apps/funding-api/src/stripe-webhook.service.ts
apps/funding-api/src/main.ts
packages/funding-core/src/index.ts
apps/funding-web/src/app/features/funding/services/funding-admin.service.ts
apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-page.component.ts
apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.ts
tests/funding-config.test.mjs
tests/funding-admin-backoffice-coverage.test.mjs
tests/funding-sponsorship-e2e-coverage.test.mjs
```

---

## 4. Principe directeur

Ne jamais confondre:

```text
UTM / provenance marketing != preuve de paiement
```

Exemples:

- `utm_source=laruche` peut indiquer que la personne est arrivee depuis La Ruche.
- Cela ne prouve pas que la personne a paye sur La Ruche.
- Un export officiel, un webhook signe, un rapport de reglement ou une preuve bancaire peuvent contribuer a confirmer un paiement.

Regle de securite produit:

```text
Une contribution externe peut etre connue avant d'etre reconnue financierement.
Une contribution externe peut etre reconnue financierement sans etre publique.
Une contribution externe ne devient publique qu'apres consentement et validation.
```

---

## 5. Architecture recommandee

Approche recommandee:

```text
fund_contributions = table canonique metier
tables d'import externe = staging, validation, audit, rapprochement
tables de settlements = reglements agreges, frais, net, prevention du double comptage
```

Ne pas creer une table totalement separee de contributions La Ruche pour le produit final. Cela dupliquerait trop de logique admin, transparence, commandites, consentements et tests.

Ne pas tout mettre seulement dans `fund_contributions` non plus. Les imports ont besoin de conserver les lignes invalides, doublons, erreurs, preuves, fichiers, lots et decisions admin.

---

## 6. Champs de provenance recommandes

Champs a ajouter plus tard a `fund_contributions`:

```text
payment_provider              stripe | laruche | bank_transfer | manual_external | other_platform
record_origin                 stripe_checkout | stripe_webhook | laruche_csv_import | laruche_api_sync | laruche_webhook | admin_manual_entry
acquisition_source            source marketing, ex: laruche, facebook, linkedin
acquisition_medium            ex: referral, social, email
acquisition_campaign          nom/id campagne marketing
payment_evidence_source       stripe_webhook | platform_export | provider_webhook | bank_statement | receipt | admin_attestation
reconciliation_status         not_required | pending | confirmed | mismatch | duplicate | rejected
external_campaign_id          id campagne chez le fournisseur externe
external_contribution_id      id unique de contribution chez le fournisseur externe
external_reference            reference humaine, recu, commande, transaction
external_paid_at              date de paiement confirmee par source externe
import_batch_id               lien vers le lot d'import
provider_payment_status_raw   statut original du fournisseur
```

Recommandation importante: garder `status='paid'` comme statut metier commun quand le paiement est confirme, puis distinguer Stripe/La Ruche par `payment_provider` et `reconciliation_status`.

Eviter un statut metier du type `externally_confirmed`, car les filtres existants de transparence, admin et commandites s'appuient deja sur `paid`, `refunded` et `disputed`.

---

## 7. Tables futures recommandees

Pseudo-schema de cadrage:

```sql
ALTER TABLE fund_contributions
  ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN record_origin TEXT NOT NULL DEFAULT 'stripe_checkout',
  ADD COLUMN acquisition_source TEXT,
  ADD COLUMN acquisition_medium TEXT,
  ADD COLUMN acquisition_campaign TEXT,
  ADD COLUMN payment_evidence_source TEXT NOT NULL DEFAULT 'stripe_webhook',
  ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN external_campaign_id TEXT,
  ADD COLUMN external_contribution_id TEXT,
  ADD COLUMN external_reference TEXT,
  ADD COLUMN external_paid_at TIMESTAMPTZ,
  ADD COLUMN import_batch_id UUID,
  ADD COLUMN provider_payment_status_raw TEXT;

CREATE UNIQUE INDEX fund_contributions_external_unique
  ON fund_contributions(payment_provider, external_campaign_id, external_contribution_id)
  WHERE external_contribution_id IS NOT NULL;
```

Tables a ajouter quand la fonctionnalite sera implementee:

```text
fund_external_import_batches
  id, provider, campaign_id, original_filename, file_hash, imported_by,
  imported_at, status, row_count, valid_row_count, invalid_row_count,
  duplicate_row_count, created_count, updated_count, metadata_json,
  created_at, updated_at

fund_external_import_rows
  id, batch_id, row_number, row_hash, status, normalized_payload_json,
  validation_errors_json, duplicate_candidates_json, contribution_id,
  ignored_reason, created_at, updated_at

fund_external_settlements
  id, provider, external_settlement_id, campaign_id, period_start,
  period_end, gross_amount_cents, platform_fee_amount_cents,
  payment_processing_fee_amount_cents, tax_amount_cents,
  refunded_amount_cents, net_amount_cents, settlement_amount_cents,
  currency, settled_at, evidence_source, import_batch_id, metadata_json

fund_external_reconciliation_events
  id, contribution_id, batch_id, action, previous_status, new_status,
  actor, reason, evidence_source, metadata_json, created_at

fund_contribution_claim_tokens
  id, contribution_id, token_hash, email_hash, expires_at, used_at,
  created_by, created_at, attempt_count
```

---

## 8. Flux d'import recommande

MVP recommande: CSV seulement.

Flux:

1. Admin ouvre `/admin/fundraiser/imports`.
2. Admin cree un import avec fournisseur `laruche`.
3. Admin attache un export officiel.
4. API cree un `fund_external_import_batch`.
5. API parse le fichier, normalise les lignes, calcule les hash.
6. API affiche un apercu: valides, invalides, doublons exacts, doublons probables.
7. Admin corrige le mapping ou confirme.
8. Commit cree ou met a jour les `fund_contributions`.
9. Les lignes restent auditables.
10. Les contributions non rapprochees restent exclues des totaux publics confirmes.

Etats de ligne proposes:

```text
pending
valid
invalid
duplicate_exact
duplicate_possible
imported
ignored
reconciliation_required
```

---

## 9. Dedupe et rapprochement

Dedupe fort:

```text
payment_provider + external_campaign_id + external_contribution_id
```

Dedupe probable:

```text
campaign_id + email normalise + amount + currency + date proche
```

Dedupe faible:

```text
nom/compagnie + montant + periode
```

Les doublons probables ne doivent pas etre fusionnes automatiquement. Ils doivent etre presentes dans une file admin de rapprochement.

La reconnaissance financiere publique devrait exiger:

```text
status = paid
reconciliation_status = confirmed ou not_required
```

Pour Stripe, `not_required` est acceptable parce que le webhook Stripe signe est deja la source de verite.

Pour La Ruche, `confirmed` devrait venir d'une preuve externe suffisante.

---

## 10. Double comptage et comptabilite

Point critique: une contribution individuelle La Ruche et le versement global La Ruche ne doivent pas etre comptes deux fois.

Exemple:

```text
100 CAD collecte sur La Ruche
5 CAD frais plateforme
2.50 CAD frais paiement
92.50 CAD verse a OpenG7
```

La transparence devrait pouvoir montrer:

```text
brut collecte: 100.00 CAD
frais: 7.50 CAD
net disponible: 92.50 CAD
```

Mais le versement de 92.50 CAD ne doit pas etre une nouvelle contribution. Il doit etre un settlement.

Decision provisoire:

- contributions individuelles = revenus/contributions brutes par personne ou organisation;
- settlements = mouvement de reglement, frais, net, preuve de versement;
- totaux publics = eviter tout double comptage entre ces deux couches.

---

## 11. Commandites externes

Une contribution externe peut devenir une commandite si:

```text
contribution_type = sponsorship_interest
status = paid
reconciliation_status = confirmed
payment_provider = laruche ou autre fournisseur externe
```

Les benefices de commandite peuvent reutiliser la logique existante de seuils dans `packages/funding-core/src/index.ts`.

Mais la visibilite ne doit jamais etre automatique.

Conditions minimales avant affichage public:

- paiement confirme;
- rapprochement confirme;
- consentement OpenG7 explicite;
- informations commanditaire completes;
- revue admin approuvee;
- pas de remboursement/litige actif.

---

## 12. Claim flow futur

Certaines contributions importees peuvent ne pas avoir toutes les infos publiques voulues.

Flux futur:

1. Contribution importee en prive.
2. Admin envoie une invitation de reclamation.
3. API genere un token aleatoire, hash en base, expiration, usage unique.
4. Le contributeur ouvre un formulaire public.
5. Il confirme ou complete nom, compagnie, logo, site, consentements.
6. L'admin valide avant affichage.

Le token ne doit jamais etre stocke en clair. Le formulaire ne doit pas reveler l'existence d'une contribution a des tiers.

---

## 13. Consentements

Consentements a distinguer:

```text
public_display_consent
display_amount_consent
display_company_consent
display_logo_consent
display_website_consent
facebook_publication_consent
linkedin_publication_consent
communications_consent
non_charity_acknowledged
```

Decision provisoire:

- une contribution importee est privee par defaut;
- un consentement La Ruche ne doit pas etre reutilise automatiquement par OpenG7 sans validation;
- aucun post social automatique;
- les publications restent des brouillons/moderation humaine.

---

## 14. PostgreSQL

Cette fonctionnalite devrait exiger PostgreSQL.

Sans `DATABASE_URL`, ne pas offrir l'import externe.

Raison:

- besoin d'audit;
- besoin d'idempotence;
- besoin de dedupe;
- besoin de rapprochement;
- besoin de conservation controlee;
- besoin de statut durable;
- besoin de transparence fiable.

Le fallback Stripe-direct peut rester en place pour Stripe, mais il ne doit pas pretendre couvrir La Ruche.

---

## 15. API future proposee

Endpoints admin:

```text
POST /admin/external-contributions/imports
GET  /admin/external-contributions/imports
GET  /admin/external-contributions/imports/:id
POST /admin/external-contributions/imports/:id/validate
POST /admin/external-contributions/imports/:id/commit
POST /admin/external-contributions/:id/reconcile
POST /admin/external-contributions/:id/ignore
POST /admin/external-contributions/:id/merge
POST /admin/external-contributions/:id/claim-invitation
```

Endpoints publics:

```text
GET  /external-contributions/claim?token=...
POST /external-contributions/claim
```

Endpoint futur seulement si contrat provider reel:

```text
POST /webhooks/external/laruche
```

Ne pas creer de webhook La Ruche sans specification reelle de signature, payload, idempotence et retry.

---

## 16. Securite

Points obligatoires:

- limite de taille CSV;
- parsing CSV robuste, pas split manuel naif;
- detection encodage/separateur;
- neutralisation CSV injection sur exports (`=`, `+`, `-`, `@`);
- validation stricte des montants et devises;
- URLs HTTPS seulement;
- stockage minimal de PII;
- hash du fichier source;
- audit admin pour import, commit, ignore, merge, reconcile;
- rate limit sur claim flow;
- tokens hashes, expiration, usage unique;
- pas de fichier brut public;
- pas d'exposition de courriels ou IDs externes dans les endpoints publics.

---

## 17. Questions ouvertes

Ces questions ne sont pas bloquees par manque de volonte, mais par manque d'information externe. Elles doivent rester ouvertes jusqu'a obtention des reponses.

### 17.1 Format export La Ruche reel

Questions:

- CSV, Excel, PDF ou autre?
- ID unique par contribution?
- ID campagne?
- statut paiement?
- remboursements inclus?
- frais par contribution ou seulement globaux?
- courriel, nom, compagnie, consentements inclus?
- dates: promesse, paiement, confirmation ou reglement?

Decision provisoire: attendre un vrai export anonymise avant d'implementer le mapping.

### 17.2 Existence API/webhook La Ruche

Questions:

- API publique ou partenaire?
- authentification?
- pagination?
- rate limits?
- webhook signe?
- retry provider?
- ID evenement stable?

Decision provisoire: MVP CSV; API/webhook seulement plus tard.

### 17.3 Politique comptable brut/net/frais/taxes

Questions:

- la transparence affiche-t-elle brut, net ou les deux?
- les frais sont-ils depenses, reductions de revenu ou ventilation separee?
- les taxes existent-elles?
- comment traiter les remboursements?
- quel est le total public principal?

Decision provisoire: stocker brut, frais, net; afficher sans double compter.

### 17.4 Reutilisabilite des consentements La Ruche

Questions:

- un consentement La Ruche couvre-t-il OpenG7?
- couvre-t-il nom, compagnie, montant, logo, site web?
- couvre-t-il Facebook/LinkedIn?
- couvre-t-il la prise de contact?

Decision provisoire: prive par defaut; consentement OpenG7 explicite avant affichage.

### 17.5 Conservation PII

Questions:

- garder le fichier brut?
- combien de temps?
- qui peut le voir?
- faut-il chiffrer certains champs?
- quels champs peuvent etre anonymises?
- quelle procedure de suppression?

Decision provisoire: garder le minimum normalise, hash du fichier, audit; eviter la retention longue du brut.

### 17.6 Regles FX

Questions:

- La Ruche fournit-elle uniquement CAD?
- faut-il supporter USD ou autre devise?
- source du taux FX?
- date du taux?
- arrondis?

Decision provisoire: MVP CAD seulement, sauf preuve contraire.

### 17.7 Preuve de paiement suffisante

Questions:

- export officiel suffit-il?
- faut-il attendre un reglement bancaire?
- les rapports La Ruche ont-ils un statut final?
- comment traiter promesses non payees?
- qui peut confirmer manuellement?

Decision provisoire: UTM jamais suffisant; export officiel ou reglement rapproche requis.

---

## 18. Tests a prevoir

Tests backend:

- migrations de provenance;
- import CSV valide;
- import CSV invalide;
- dedupe exact;
- dedupe probable;
- commit idempotent;
- contribution externe non rapprochee exclue des totaux confirmes;
- contribution externe rapprochee incluse;
- settlement non double compte;
- audit admin;
- claim token expiration/usage unique;
- consentements publics.

Tests frontend:

- route admin imports;
- mapping CSV;
- preview erreurs/doublons;
- badges source provider;
- filtres provider/reconciliation;
- commandites externes;
- aucun champ prive public.

Tests securite:

- CSV injection;
- fichier trop gros;
- type fichier invalide;
- token claim invalide;
- tentative enumeration;
- absence PostgreSQL.

---

## 19. Lots de reprise recommandes

Lot 1 - Provenance minimale:

- types partages;
- colonnes de provenance;
- migration;
- affichage provider/reconciliation dans admin;
- tests de non-regression Stripe.

Lot 2 - Import CSV MVP:

- batch/rows;
- parser;
- mapping;
- validation;
- preview;
- commit;
- audit.

Lot 3 - Dedupe et reconciliation:

- detection exact/probable;
- file admin;
- decisions merge/ignore/confirm;
- historique.

Lot 4 - Settlements et transparence:

- table settlements;
- regles brut/net/frais;
- prevention double comptage;
- indicateurs publics.

Lot 5 - Commandites externes et claim flow:

- invitation;
- formulaire;
- consentements;
- revue admin;
- affichage public controle.

Lot 6 - API/webhook provider:

- seulement si La Ruche fournit un contrat technique officiel.

---

## 20. MVP recommande quand les reponses seront disponibles

MVP cible:

- PostgreSQL obligatoire;
- CSV La Ruche officiel;
- import preview + commit;
- provenance persistante;
- dedupe exact/probable;
- rapprochement admin;
- contributions externes visibles dans le back-office;
- contributions externes exclues du public tant que non rapprochees;
- commandites externes privees par defaut;
- consentement OpenG7 explicite avant affichage;
- aucun automatisme social;
- aucun paiement confirme par UTM;
- pas de webhook/API La Ruche sans specification reelle.

Phrase de cadrage a conserver:

```text
On peut connaitre une contribution externe tot, mais on ne doit la reconnaitre financierement ou publiquement qu'apres preuve, rapprochement et consentement clair.
```
