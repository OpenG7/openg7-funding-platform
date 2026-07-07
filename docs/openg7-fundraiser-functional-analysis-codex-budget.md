# Analyse fonctionnelle nettoyée — Fundraiser OpenG7 avec budget Codex

Date: 2026-07-07  
Projet: OpenG7 — Fonds des bâtisseurs / Fundraiser  
Objectif: transformer l'analyse initiale en plan de développement réaliste, découpé pour tenir dans une limite d'utilisation Codex hebdomadaire restante estimée à 76 %.  
Statut: recommandation fonctionnelle et technique, non implémentée.

---

## 1. Résumé exécutif

L'analyse initiale est solide, mais trop large pour être exécutée en une seule passe Codex sans risque de dépassement, de dette technique ou de corrections coûteuses. Le projet vise à faire évoluer le Fonds des bâtisseurs vers une plateforme de contribution, commandite, transparence publique, consentement, visibilité modérée et éventuellement publication dans les feeds OpenG7/OpenG20.

La recommandation mise au propre est de ne pas lancer immédiatement toute la vision. Il faut d'abord construire un socle minimal fiable:

1. contribution personnelle claire;
2. mention fiscale prudente;
3. metadata Stripe enrichies;
4. PostgreSQL privé sur serveur Linux;
5. webhooks Stripe idempotents;
6. consentements de publication;
7. transparence publique alimentée par la base de données;
8. commandite en mode demande de validation, pas en publication automatique.

Pour respecter la limite Codex restante de 76 %, le développement de la semaine doit viser seulement le **MVP contrôlé**, pas le back-office complet, pas les feeds automatisés et pas les factures PDF.

---

## 2. Hypothèses de budget Codex

### 2.1 Hypothèse utilisateur

L'utilisateur indique qu'il reste 76 % de limite hebdomadaire Codex. Comme la limite exacte en crédits/tokens n'est pas fournie dans l'interface de cette conversation, l'analyse utilise une unité relative:

```text
Budget hebdomadaire restant = 76 unités
Budget cible à consommer = 55 à 60 unités maximum
Réserve obligatoire = 16 à 21 unités
```

La réserve est nécessaire pour:

- relancer des tests;
- corriger les erreurs TypeScript;
- ajuster les migrations;
- reprendre un webhook Stripe;
- corriger les routes Angular ou les traductions;
- éviter d'être bloquée avant la fin du lot.

### 2.2 Règle de consommation Codex

Codex doit être utilisé comme un agent de petites passes:

```text
1 tâche Codex = 1 objectif limité + 1 ensemble restreint de fichiers + 1 validation claire
```

À éviter:

- « implémente toute la plateforme fundraiser »;
- « ajoute admin + DB + feeds + sponsors + factures »;
- « refactorise tout le projet »;
- prompts longs avec trop de contexte historique;
- plusieurs objectifs métier non reliés dans la même tâche.

### 2.3 Budget estimé par type de tâche

| Type de tâche Codex | Risque de consommation | Budget relatif estimé | Commentaire |
| --- | ---: | ---: | --- |
| Petite correction UI/i18n | Faible | 2 à 4 unités | Bon usage Codex |
| Ajout route Angular simple | Faible à moyen | 3 à 6 unités | À faire avec tests/build |
| Modification metadata Stripe | Moyen | 5 à 8 unités | API + types partagés + tests |
| Migration PostgreSQL simple | Moyen | 6 à 10 unités | Peut coûter plus si conventions inconnues |
| Webhook Stripe idempotent | Moyen à élevé | 8 à 14 unités | Critique, doit être isolé |
| Page transparence DB | Moyen à élevé | 8 à 14 unités | Front + API + fallback Stripe |
| Formulaire commandite complet | Élevé | 12 à 20 unités | Beaucoup de champs/validations/i18n |
| Back-office admin | Très élevé | 25 à 45 unités | À exclure cette semaine |
| Feeds OpenG7/OpenG20 | Élevé | 15 à 30 unités | À exclure du MVP hebdomadaire |
| PDF/facture | Élevé | 15 à 25 unités | À reporter |

---

## 3. Principe directeur

Le Fonds des bâtisseurs doit évoluer en système de confiance, mais la confiance ne vient pas d'abord de l'automatisation. Elle vient de:

- la clarté des termes;
- la transparence financière;
- la protection des données;
- la validation humaine;
- la cohérence juridique et fiscale;
- l'absence de promesses excessives.

La règle structurante devient donc:

> Cette semaine, Codex ne doit construire que ce qui augmente la confiance sans créer d'obligation de visibilité difficile à respecter.

---

## 4. Décisions fonctionnelles recommandées

### D-001 — Commandite: validation avant visibilité

Décision recommandée:

```text
Une entreprise peut manifester son intérêt ou payer une commandite, mais aucune visibilité publique n'est automatique.
```

Formulation produit:

```text
Les contreparties de visibilité sont accordées sous réserve d'approbation éditoriale, de compatibilité avec la mission OpenG7 et du respect des politiques de publication.
```

Effet:

- réduit le risque réputationnel;
- protège contre les commanditaires incompatibles;
- évite la promesse publicitaire automatique;
- réduit le coût Codex du MVP.

### D-002 — Pas de back-office complet cette semaine

Décision recommandée:

```text
Aucun back-office admin complet dans la première passe.
```

À la place:

- tables DB prêtes;
- statuts prêts;
- données lisibles par API interne ou scripts;
- admin complet reporté.

### D-003 — PostgreSQL privé sur serveur Linux

Décision recommandée:

```text
PostgreSQL roule dans Docker sur le serveur Linux, accessible seulement par l'API funding-api.
```

Interdictions:

- pas de port 5432 exposé publiquement;
- pas de pgAdmin public;
- pas de secret dans le frontend;
- pas de mot de passe DB dans GitHub.

### D-004 — Montant individuel masqué par défaut

Décision recommandée:

```text
Le nom peut être affiché avec consentement; le montant individuel reste masqué par défaut.
```

Justification:

- protège la vie privée;
- réduit les erreurs d'affichage;
- simplifie la page publique;
- respecte l'esprit de transparence agrégée.

### D-005 — OpenG7/OpenG20: brouillons seulement

Décision recommandée:

```text
Les feeds OpenG7/OpenG20 ne sont pas développés cette semaine.
```

Cette semaine, on prépare seulement les champs futurs:

- `requires_review`;
- `visibility_tier`;
- `public_display_consent`;
- `consent_publication`.

---

## 5. MVP hebdomadaire compatible avec 76 % restants

### Objectif de la semaine

Créer le socle technique minimal permettant de recevoir des contributions plus propres, de préparer les commandites et de passer vers PostgreSQL sans exploser la consommation Codex.

### Livrables inclus

1. Route canonique `/fonds-des-batisseurs`.
2. Mention fiscale/non-charité visible.
3. Types de contribution:
   - `personal_support`;
   - `sponsorship_interest`;
   - `partner_interest` réservé pour plus tard.
4. Consentements minimaux:
   - afficher le nom;
   - afficher le montant;
   - accepter la mention non-charité.
5. Metadata Stripe enrichies.
6. Migration PostgreSQL minimale.
7. Webhook Stripe enrichi et idempotent.
8. Transparence publique alimentée par DB si disponible, fallback Stripe si DB absente.
9. Page `/batisseurs` très simple ou section prête, sans fiche détaillée.
10. Documentation de déploiement DB + sauvegarde.

### Livrables exclus

- back-office admin complet;
- upload de logos;
- fiches commanditaires détaillées;
- publications commanditées;
- feeds OpenG7/OpenG20;
- API LinkedIn/Facebook;
- génération PDF/facture;
- système de taxes;
- authentification admin avancée.

---

## 6. Nouvelle roadmap resserrée

### Phase 0 — Verrouillage produit avant Codex

Coût Codex estimé: 0 à 2 unités  
Statut: à faire manuellement avant lancement Codex.

Décisions à figer:

- texte non-charité;
- montants autorisés;
- comportement anonymat;
- tiers de commandite;
- politique de refus;
- politique de remboursement minimale;
- choix DB: PostgreSQL Docker privé.

Sortie attendue:

```text
Un court fichier docs/fundraiser-decisions.md validé par Samantha.
```

### Phase 1 — Nettoyage public et metadata Stripe

Coût Codex estimé: 12 à 18 unités  
Priorité: très haute  
Risque: faible à moyen

Objectifs:

- ajouter `/fonds-des-batisseurs` comme route canonique;
- conserver `/` comme accueil ou alias selon structure actuelle;
- mettre à jour SEO/canonical/hreflang/sitemap si applicable;
- distinguer contribution personnelle et intérêt commandite;
- ajouter texte non-charité;
- ajouter consentements minimaux;
- enrichir metadata envoyées à Stripe.

Fichiers probables:

- `apps/funding-web/src/app/app.routes.ts`;
- `apps/funding-web/src/app/app.routes.server.ts`;
- `apps/funding-web/src/app/features/funding/pages/funding-page/...`;
- `apps/funding-web/src/app/features/funding/services/funding.service.ts`;
- `apps/funding-web/src/assets/i18n/fr-CA.json`;
- `apps/funding-web/src/assets/i18n/en.json`;
- `packages/funding-core/src/index.ts`;
- `packages/funding-models/src/index.ts`;
- `apps/funding-api/src/main.ts`.

Critères d'acceptation:

- build Angular passe;
- l'API refuse les montants non autorisés;
- metadata Stripe contiennent `contributionType`, `program`, `project`, `publicDisplayConsent`, `displayAmountConsent`;
- la mention non-charité est visible avant paiement;
- l'utilisateur comprend qu'aucun reçu officiel de don de bienfaisance n'est émis.

### Phase 2 — PostgreSQL minimal et migrations

Coût Codex estimé: 12 à 18 unités  
Priorité: très haute  
Risque: moyen

Objectifs:

- ajouter ou compléter migration DB minimale;
- créer tables:
  - `fund_contributions`;
  - `stripe_checkout_sessions`;
  - `stripe_events`;
  - `fund_expenses` minimal ou réservé;
  - `transparency_snapshots` optionnel.
- ajouter repository DB côté API;
- garder fallback si `DATABASE_URL` absent.

Schéma minimal recommandé:

```sql
CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  contribution_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'cad',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'cad',
  public_name TEXT,
  email_private TEXT,
  public_display_consent BOOLEAN NOT NULL DEFAULT false,
  display_amount_consent BOOLEAN NOT NULL DEFAULT false,
  non_charity_acknowledged BOOLEAN NOT NULL DEFAULT false,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Critères d'acceptation:

- les migrations sont versionnées;
- aucun secret DB dans le frontend;
- l'API démarre avec ou sans DB;
- le serveur Linux peut rouler PostgreSQL via Docker Compose;
- le port PostgreSQL n'est pas exposé publiquement.

### Phase 3 — Webhooks Stripe idempotents

Coût Codex estimé: 10 à 16 unités  
Priorité: très haute  
Risque: moyen à élevé

Objectifs:

- gérer `checkout.session.completed`;
- gérer `checkout.session.expired`;
- confirmer `payment_intent.succeeded`;
- marquer `payment_intent.payment_failed`;
- gérer `charge.refunded`;
- préparer `charge.dispute.created`;
- journaliser chaque événement dans `stripe_events`;
- éviter la double comptabilisation.

Règles:

- ne jamais confirmer un paiement depuis le retour navigateur;
- le statut final vient de Stripe webhook;
- `stripe_event_id` doit être unique;
- une erreur webhook doit être loggée sans exposer de secret.

Critères d'acceptation:

- deux livraisons du même webhook ne créent pas deux contributions payées;
- une session expirée ne compte pas dans les totaux;
- un remboursement réduit les agrégats;
- les logs ne contiennent ni secret Stripe ni données sensibles inutiles.

### Phase 4 — Transparence DB légère

Coût Codex estimé: 8 à 12 unités  
Priorité: haute  
Risque: moyen

Objectifs:

- lire les contributions payées depuis DB;
- calculer total reçu;
- calculer remboursements si disponible;
- afficher solde estimé;
- garder fallback Stripe-direct si DB absente;
- afficher dernière mise à jour;
- ne pas exposer courriels, ids Stripe, contacts.

Critères d'acceptation:

- la page transparence reste fonctionnelle sans DB;
- avec DB, les agrégats proviennent des contributions confirmées;
- les montants individuels ne sont pas affichés sans consentement;
- les données privées ne sont jamais retournées par endpoint public.

### Phase 5 — Page Bâtisseurs simple

Coût Codex estimé: 6 à 10 unités  
Priorité: moyenne  
Risque: faible à moyen

Objectifs:

- créer route `/batisseurs`;
- afficher seulement contributeurs consentis;
- afficher commanditaires seulement quand statut approuvé existe plus tard;
- prévoir message « section en construction » si aucune entrée publique;
- ne pas créer de fiches détaillées pour l'instant.

Critères d'acceptation:

- aucune donnée privée affichée;
- page bilingue;
- SEO minimal;
- navigation simple depuis le Fonds.

---

## 7. Budget hebdomadaire recommandé

### Scénario prudent — recommandé

| Phase | Budget relatif estimé |
| --- | ---: |
| Phase 0 — décisions | 0 à 2 |
| Phase 1 — public + metadata | 12 à 18 |
| Phase 2 — PostgreSQL minimal | 12 à 18 |
| Phase 3 — webhooks idempotents | 10 à 16 |
| Phase 4 — transparence DB légère | 8 à 12 |
| Total prudent | 42 à 66 |
| Réserve restante sur 76 | 10 à 34 |

Conclusion: ce scénario peut rentrer dans 76 % si les prompts Codex restent courts et si chaque phase est validée avant de passer à la suivante.

### Scénario ambitieux — non recommandé cette semaine

| Phase | Budget relatif estimé |
| --- | ---: |
| Phases 0 à 4 | 42 à 66 |
| Page Bâtisseurs | 6 à 10 |
| Formulaire commandite complet | 12 à 20 |
| Brouillons publication | 10 à 18 |
| Total | 70 à 114 |

Conclusion: ce scénario risque de dépasser la limite restante, surtout si Codex doit explorer le repo, corriger les tests ou reprendre les migrations.

### Scénario à éviter

```text
DB + admin + sponsors + logos + feeds + LinkedIn/Facebook + PDF dans la même semaine.
```

Risque estimé:

- dépassement de limite;
- code incomplet;
- corrections difficiles;
- erreurs sécurité;
- flux de paiement fragile;
- dette technique dans l'admin.

---

## 8. Prompts Codex recommandés

### Prompt 1 — Décisions et périmètre

```text
Tu travailles dans le monorepo OpenG7 Fundraiser. Objectif: préparer le MVP Fonds des bâtisseurs sans développer l'admin, les feeds, les PDF ou les uploads.

Lis les fichiers README, apps/funding-web routes, funding-page, funding.service, funding-api main.ts, stripe-webhook.service.ts, funding-core et funding-models.

Crée ou mets à jour docs/fundraiser-mvp-scope.md avec:
- périmètre inclus;
- périmètre exclu;
- décisions non-charité;
- consentements minimaux;
- routes impactées;
- risques.

Ne modifie pas encore le code applicatif. Ouvre une PR documentaire seulement.
```

Coût estimé: 2 à 4 unités.

### Prompt 2 — Route canonique et texte public

```text
Objectif: ajouter la route canonique /fonds-des-batisseurs et clarifier l'interface publique du Fonds des bâtisseurs.

Contraintes:
- ne pas créer de back-office;
- ne pas créer de feeds;
- ne pas créer de PDF;
- conserver les routes existantes;
- garder le bilingue fr-CA/en;
- maintenir le prerender/SSR existant;
- ne pas casser la page transparence.

À faire:
1. Ajouter /fonds-des-batisseurs comme route publique canonique ou alias propre vers la page Fonds.
2. Mettre à jour SEO/canonical/hreflang si le service existant le requiert.
3. Ajouter une mention visible: OpenG7 est un projet indépendant; les contributions ne sont pas des dons à un organisme de bienfaisance enregistré; aucune émission de reçu officiel de don.
4. Ajouter distinction visuelle simple entre Contribution personnelle et Commandite d'entreprise en validation.
5. Mettre à jour fr-CA.json et en.json.
6. Exécuter les tests/build pertinents.

Retour attendu:
- liste des fichiers modifiés;
- commandes exécutées;
- risques restants.
```

Coût estimé: 5 à 8 unités.

### Prompt 3 — Types partagés et metadata Stripe

```text
Objectif: enrichir les types de contribution et les metadata Stripe sans changer encore la base de données.

Contraintes:
- validation serveur obligatoire;
- ne jamais faire confiance au client pour le statut de paiement;
- garder les montants autorisés côté serveur;
- ne pas exposer de secret;
- ne pas implémenter l'admin.

À faire:
1. Ajouter les types contributionType: personal_support, sponsorship_interest.
2. Ajouter publicDisplayConsent, displayAmountConsent, nonCharityAcknowledged dans les payloads partagés.
3. Valider ces champs côté API.
4. Enrichir metadata Stripe avec program=builders_fund, project=openg7, contributionType, publicDisplayConsent, displayAmountConsent, requiresReview si sponsorship_interest.
5. Refuser la création de session si nonCharityAcknowledged n'est pas true.
6. Harmoniser montants UI/API/env si incohérence.
7. Mettre à jour les tests ou ajouter tests simples.

Ne pas créer de publication automatique.
```

Coût estimé: 7 à 10 unités.

### Prompt 4 — PostgreSQL minimal

```text
Objectif: ajouter une persistance PostgreSQL minimale pour le Fonds des bâtisseurs, avec fallback si DATABASE_URL est absent.

Contraintes:
- PostgreSQL doit être privé dans Docker;
- aucun port 5432 public;
- aucune donnée privée dans les endpoints publics;
- migrations versionnées;
- ne pas créer d'admin complet.

À faire:
1. Ajouter/compléter migration pour stripe_events, stripe_checkout_sessions, fund_contributions.
2. Ajouter repository minimal côté API.
3. Ajouter connexion DB seulement si DATABASE_URL est configuré.
4. Conserver comportement actuel si DB absente.
5. Documenter variables d'environnement et sauvegarde minimale.
6. Ajouter docker-compose service postgres si cohérent avec l'architecture existante, sans exposer le port.

Retour attendu:
- migration SQL;
- code repository;
- documentation;
- commandes de test/build.
```

Coût estimé: 12 à 18 unités.

### Prompt 5 — Webhooks idempotents

```text
Objectif: rendre les webhooks Stripe idempotents et alimenter la DB minimale.

Contraintes:
- signature Stripe obligatoire;
- stripe_event_id unique;
- aucune double comptabilisation;
- aucun secret dans les logs;
- statut final seulement via Stripe webhook;
- fallback actuel conservé si DB absente.

À faire:
1. Journaliser chaque événement reçu dans stripe_events.
2. Gérer checkout.session.completed.
3. Gérer checkout.session.expired.
4. Gérer payment_intent.succeeded.
5. Gérer payment_intent.payment_failed.
6. Gérer charge.refunded.
7. Préparer charge.dispute.created si simple.
8. Mettre à jour fund_contributions selon les événements.
9. Ajouter tests ou scénarios manuels documentés.

Ne pas implémenter les commanditaires publics ni les feeds.
```

Coût estimé: 10 à 16 unités.

### Prompt 6 — Transparence DB légère

```text
Objectif: faire évoluer la page transparence pour lire les agrégats depuis PostgreSQL lorsque disponible, tout en gardant le fallback Stripe-direct.

Contraintes:
- endpoint public sans données privées;
- montant individuel masqué par défaut;
- courriel, ids Stripe, contacts jamais exposés;
- page existante non cassée;
- bilingue conservé.

À faire:
1. Ajouter endpoint public d'agrégats DB.
2. Calculer total reçu, total remboursé, total net estimé, nombre de contributions payées.
3. Garder les champs existants de la page autant que possible.
4. Ajouter indicateur source: DB ou Stripe-direct si déjà présent dans le modèle.
5. Ne pas afficher de liste nominative sauf consentement explicite.
6. Exécuter tests/build.
```

Coût estimé: 8 à 12 unités.

---

## 9. Architecture cible MVP

```text
Navigateur
  |
  | HTTPS
  v
Traefik
  |
  +--> Angular statique / prerender
  |
  +--> funding-api Node
          |
          +--> Stripe API
          |
          +--> PostgreSQL privé Docker
```

Règles:

- Angular ne parle jamais directement à PostgreSQL;
- Stripe confirme via webhooks signés;
- l'API écrit en DB;
- les pages publiques lisent seulement des agrégats filtrés;
- les données privées restent côté API/DB.

---

## 10. Modèle de données MVP nettoyé

### 10.1 fund_contributions

Rôle: représenter une contribution ou une intention de commandite.

Champs essentiels:

- `id`;
- `contribution_type`;
- `amount_cents`;
- `currency`;
- `public_name`;
- `email_private`;
- `public_display_consent`;
- `display_amount_consent`;
- `non_charity_acknowledged`;
- `stripe_session_id`;
- `stripe_payment_intent_id`;
- `status`;
- `paid_at`;
- `created_at`;
- `updated_at`.

Statuts:

- `pending`;
- `paid`;
- `failed`;
- `expired`;
- `refunded`;
- `disputed`;
- `hidden`.

### 10.2 stripe_checkout_sessions

Rôle: garder la trace de ce qui a été envoyé à Stripe.

Champs essentiels:

- `stripe_session_id`;
- `stripe_payment_intent_id`;
- `contribution_type`;
- `amount_cents`;
- `currency`;
- `metadata`;
- `status`;
- `created_at`;
- `updated_at`.

### 10.3 stripe_events

Rôle: idempotence et audit technique minimal.

Champs essentiels:

- `stripe_event_id` unique;
- `event_type`;
- `payload`;
- `processed_at`.

### 10.4 fund_expenses — réservé

Rôle: préparer les dépenses sans forcément livrer l'UI cette semaine.

Champs futurs:

- `amount_cents`;
- `category`;
- `vendor_private`;
- `description_public`;
- `public_visibility`;
- `status`.

Recommandation:

```text
Créer la table seulement si elle ne complexifie pas la passe Codex. Sinon reporter.
```

---

## 11. Sécurité et confidentialité

### Obligatoire dès le MVP

- signature Stripe obligatoire;
- idempotence des webhooks;
- validation serveur des montants;
- validation serveur des types;
- aucun secret dans frontend;
- aucun courriel public;
- aucun id Stripe dans les endpoints publics;
- PostgreSQL non exposé;
- logs sans secrets;
- consentement explicite avant tout affichage nominatif.

### À reporter

- authentification admin complète;
- audit log métier complet;
- upload logo;
- scan fichier;
- gestion fine des rôles;
- modération avancée.

---

## 12. Textes publics recommandés

### Mention courte avant paiement

```text
OpenG7 est un projet indépendant en développement. Les contributions au Fonds des bâtisseurs ne constituent pas des dons à un organisme de bienfaisance enregistré. Aucun reçu officiel de don de bienfaisance n'est émis. Une confirmation descriptive peut être fournie lorsque nécessaire.
```

### Mention commandite

```text
Les commandites de visibilité sont soumises à une validation manuelle. OpenG7 se réserve le droit d'approuver, modifier, refuser ou retirer une visibilité si elle est incompatible avec la mission du projet, présente un risque légal ou nuit à la confiance du public.
```

### Mention transparence

```text
La transparence publique présente les montants agrégés, les frais, les remboursements, les dépenses publiables et les soldes estimés. Les informations personnelles, courriels, identifiants Stripe et montants individuels non consentis ne sont jamais publiés.
```

---

## 13. Recommandations finales mises au propre

1. Réduire le MVP de la semaine au socle de confiance.
2. Utiliser PostgreSQL sur le serveur Linux, mais uniquement en réseau Docker privé.
3. Ne pas exposer PostgreSQL à Internet.
4. Faire une migration DB minimale avant les commandites publiques.
5. Enrichir les metadata Stripe avant d'élargir les pages publiques.
6. Ne jamais confirmer un paiement depuis le navigateur.
7. Utiliser les webhooks Stripe signés comme source de vérité.
8. Garder le montant individuel masqué par défaut.
9. Afficher les noms seulement avec consentement.
10. Ne pas publier automatiquement les commanditaires.
11. Reporter les feeds OpenG7/OpenG20 après validation admin.
12. Reporter les PDF/factures après stabilisation DB.
13. Reporter LinkedIn/Facebook API; garder le copier-coller manuel plus tard.
14. Garder une réserve Codex de 16 à 21 unités sur les 76 restantes.
15. Faire une PR par phase, jamais une méga-PR.

---

## 14. Ordre exact de travail recommandé cette semaine

```text
Jour 1:
- Valider décisions produit.
- Créer docs/fundraiser-mvp-scope.md.
- Ajouter /fonds-des-batisseurs + texte non-charité.

Jour 2:
- Ajouter types contribution + consentements.
- Enrichir metadata Stripe.
- Harmoniser montants UI/API/env.

Jour 3:
- Ajouter PostgreSQL minimal.
- Ajouter migrations.
- Ajouter documentation serveur Linux + sauvegardes.

Jour 4:
- Brancher webhooks idempotents.
- Tester doublons, paiement réussi, échec, remboursement.

Jour 5:
- Transparence DB légère.
- Nettoyage i18n.
- Build final.
- Liste des travaux reportés.
```

Si la limite Codex descend sous 25 % restant avant la fin:

```text
Arrêter après webhooks idempotents.
Reporter la transparence DB légère.
Ne pas commencer /batisseurs.
```

---

## 15. Définition de terminé

Le MVP hebdomadaire est terminé quand:

- la route `/fonds-des-batisseurs` existe;
- la mention non-charité est visible;
- les metadata Stripe sont enrichies;
- les consentements minimaux sont transmis et validés;
- PostgreSQL peut être activé via `DATABASE_URL`;
- les webhooks sont idempotents;
- aucun paiement n'est comptabilisé sans confirmation Stripe;
- la transparence ne publie aucune donnée privée;
- le build passe;
- la documentation de déploiement DB existe;
- les fonctionnalités reportées sont clairement listées.

---

## 16. Travaux reportés officiellement

À ne pas demander à Codex cette semaine:

- dashboard admin;
- authentification admin;
- upload logo;
- fiches `/batisseurs/[slug]`;
- génération de brouillons OpenG7/OpenG20;
- publication dans feeds;
- intégration LinkedIn/Facebook;
- confirmation PDF;
- gestion taxes;
- audit log métier complet;
- système de rôles.

Ces travaux deviennent réalistes après stabilisation:

```text
DB stable + webhooks stables + transparence stable + premières contributions réelles.
```

---

## 17. Conclusion

La bonne stratégie n'est pas de construire toute la plateforme fundraiser en une semaine. La bonne stratégie est de sécuriser le cœur:

```text
paiement -> webhook -> DB -> transparence -> consentement -> validation humaine future
```

Avec 76 % de limite Codex restante, il est réaliste de livrer le socle technique et public si les tâches sont strictement découpées. Il n'est pas réaliste d'ajouter en même temps l'admin complet, les feeds, les logos, les PDF et l'automatisation sociale.

La recommandation finale est donc:

> Construire cette semaine le MVP de confiance. Préparer la commandite, mais ne pas encore promettre ni automatiser la visibilité.
