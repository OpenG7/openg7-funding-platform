# Statut MVP - Fonds des batisseurs OpenG7

Date: 2026-07-07

Ce document resume l'etat du MVP apres les lots de travail sur le Fonds des
batisseurs. Il sert de point de controle avant PR, revue de production ou
deploiement progressif.

## Resume

Le coeur MVP est en place:

```text
paiement clair -> consentements minimaux -> metadata Stripe enrichies -> webhook fiable -> DB optionnelle -> transparence publique filtree -> page batisseurs simple -> suivi commandite -> page commanditaires et placements feed
```

Le produit reste volontairement prudent:

- aucun paiement n'est confirme depuis le navigateur;
- Stripe webhook reste la source de verite du statut financier;
- la base PostgreSQL est optionnelle et privee;
- le fallback Stripe-direct reste disponible sans `DATABASE_URL`;
- aucune donnee privee n'est exposee dans les endpoints publics;
- aucune visibilite commanditee n'est publiee automatiquement;
- les liens de suivi commandite exigent PostgreSQL et un token non devinable;
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
- Validation serveur des montants via `FUNDING_ALLOWED_AMOUNTS` pour
  `personal_support`. Pour `sponsorship_interest`, tout montant a au plus 2
  decimales et superieur ou egal au minimum de commandite (5 $) est accepte,
  y compris un montant personnalise (ex. 75 $).
- Validation serveur des types de contribution.
- Validation prudente des URLs de retour Checkout.

### Paliers de commandite d'entreprise

Le montant de commandite determine les avantages obtenus. Le palier est
toujours recalcule cote serveur a partir du montant reellement paye
(fonction `resolveSponsorshipBenefits`), jamais a partir d'une valeur envoyee
par le navigateur. La logique de calcul et les seuils vivent a la fois dans
`@openg7/funding-core` (utilise par le web) et localement dans
`apps/funding-api` (meme convention que `FUNDING_ALLOWED_AMOUNTS`, car ce
package n'a pas de build local et ne se resout pas cote API):

- Commandite 5 $ a 24,99 $ -> mention de l'entreprise sur OpenG7.org.
- Commandite 25 $ a 49,99 $ -> mention OpenG7.org + inclusion dans un lot
  collectif de reconnaissance Facebook.
- Commandite 50 $ et plus -> mention OpenG7.org + lots collectifs de
  reconnaissance Facebook et LinkedIn.

Precisions:

- Les publications Facebook/LinkedIn sont des publications collectives
  regroupant plusieurs commanditaires, jamais une publication individuelle
  dediee a une seule entreprise.
- La diffusion sociale est planifiee dans un prochain lot disponible apres
  validation manuelle; le paiement ne confirme jamais une publication
  immediate ni une date precise.
- Toute commandite reste soumise a une revue manuelle avant toute visibilite
  publique, quel que soit le montant ou le palier atteint.
- 5 $ a 50 $ constituent la gamme accessible du MVP. Les offres
  professionnelles ou partenariats de plus grande valeur ne font pas partie
  de cette configuration.
- Le systeme de lots qui planifie et publie ces publications collectives est
  decrit dans la section "Lots de publication collective" ci-dessous.

### Suivi commandite apres paiement

- Ecran de succes conditionnel pour `sponsorship_interest`: "Commandite recue,
  visibilite en validation" (pas de visibilite automatique).
- Le retour Stripe n'affiche pas le formulaire complet et ne depend plus d'un
  `session_id` navigateur: il propose un lien de reprise tokenise vers
  `/fonds-des-batisseurs/suivi-commandite?token=...`.
- Formulaire de reprise: nom d'entreprise, contact, courriel, site web
  (optionnel), lien logo fourni par le sponsor (optionnel), message
  (optionnel). L'upload de fichier logo reste reserve au back-office admin.
- Une commandite payee sans `sponsor_details_submitted_at` reste detectable en
  admin comme paiement confirme mais renseignements incomplets.
- Endpoint historique `POST /api/sponsorship-details`: conserve pour
  compatibilite, revalide la session aupres de Stripe (type de contribution +
  `payment_status=paid`) avant d'accepter les details, refuse sinon, et remet la
  commandite en `pending_review` sur modification.
- Details ajoutes aux metadata du PaymentIntent (`sponsor*`) pour revue via le
  dashboard Stripe lorsque le endpoint de compatibilite est utilise.
- Si `DATABASE_URL` est configure, les details sont persistes dans
  `fund_contributions` (upsert idempotent sur resoumission).
- Page de reprise `/fonds-des-batisseurs/suivi-commandite?token=...` pour
  completer le formulaire si le navigateur est ferme, actualise ou repris plus
  tard apres paiement.
- Endpoints `GET /api/sponsorship-followup?token=...` et
  `POST /api/sponsorship-followup/details` pour lire le statut et soumettre
  les details par token.
- Courriel de reprise optionnel via Resend lorsque `RESEND_API_KEY` et
  `FUNDING_EMAIL_FROM` sont configures.
- Aucun upload public de logo par le sponsor, aucune publication automatique:
  la revue reste manuelle.
- En mode Stripe-direct sans PostgreSQL, le paiement et la transparence agregee
  restent disponibles, mais le suivi recuperable, la revue admin complete et la
  publication commanditaire publique exigent PostgreSQL.

### Revue admin commandite

- Route admin initiale `/admin/fundraiser`.
- Dashboard admin: total recu, disponible estime, contributions recentes,
  commandites en attente, etat des publications feed, erreurs Stripe.
- Route admin `/admin/fundraiser/contributions`.
- Route admin `/admin/fundraiser/publications`.
- Route admin `/admin/fundraiser/expenses`.
- Route admin `/admin/fundraiser/transparency`.
- Route admin `/admin/fundraiser/audit`.
- Endpoint `POST /api/admin/session` pour echanger le secret racine admin contre
  une session navigateur signee et expiree.
- Endpoint `GET /api/admin/dashboard` pour les indicateurs prives du fonds.
- Endpoint `GET /api/admin/contributions` pour lister les contributions privees.
- Endpoint `GET /api/admin/contributions.csv` pour exporter les contributions
  cote admin.
- Endpoints `GET /api/admin/expenses`, `POST /api/admin/expenses` et
  `POST /api/admin/expenses/update` pour gerer les depenses/allocations
  publiees ou privees.
- Endpoint `GET /api/admin/transparency` pour comparer la transparence publique
  courante avec les allocations admin.
- Endpoints `GET /api/admin/publication-drafts`,
  `POST /api/admin/publication-drafts` et
  `POST /api/admin/publication-drafts/update` pour generer, editer, approuver,
  refuser, planifier ou marquer publies les brouillons commandites.
- Endpoint `GET /api/admin/audit-log` pour lire le journal prive des actions
  admin sensibles.

### Lots de publication collective

Un "lot" regroupe plusieurs brouillons de sponsors deja approuves dans une
seule publication collective Facebook ou LinkedIn, jusqu'a une capacite
fixee a la creation du lot. C'est le mecanisme reel derriere le vocabulaire
"lot collectif" utilise dans les textes de commandite.

- Table `sponsor_publication_batches` (migration
  `008_add_sponsorship_publication_batches.sql`): canal, capacite, statut
  (`open`, `scheduled`, `published`, `cancelled`), date de prochaine
  disponibilite (`scheduled_at`), date de publication, notes.
- Colonne `batch_id` ajoutee a `sponsor_publication_drafts`: chaque brouillon
  approuve peut etre assigne a un lot ouvert du meme canal.
- L'assignation verifie en une seule requete atomique que le brouillon est
  `approved`, que son canal correspond au lot, que le lot est `open` et que
  sa capacite n'est pas depassee: deux actions admin concurrentes ne peuvent
  pas surbooker le meme lot.
- Planifier un lot (`scheduled`, avec une date de prochaine disponibilite)
  et le publier sont deux actions manuelles distinctes; publier n'est
  possible que depuis un lot deja planifie. Publier un lot marque tous ses
  brouillons assignes comme publies en une seule fois, comme la vraie
  publication collective qui les regroupe.
- Annuler un lot libere ses brouillons assignes (retour a `approved`) pour
  qu'ils puissent rejoindre un autre lot. Retirer un brouillon deja publie
  d'un lot est impossible: l'historique n'est jamais reecrit.
- Aucune de ces actions ne rend une commandite publique automatiquement: la
  visibilite publique (`/commanditaires`) reste gouvernee separement par
  `sponsor_review_status = approved` et le consentement du sponsor.
- Endpoints admin: `GET/POST /api/admin/publication-batches`,
  `POST /api/admin/publication-batches/assign`,
  `POST /api/admin/publication-batches/unassign`,
  `POST /api/admin/publication-batches/schedule`,
  `POST /api/admin/publication-batches/publish`,
  `POST /api/admin/publication-batches/cancel`. Meme authentification,
  limitation de debit et journal d'audit que les autres routes admin.
- UI admin: section "Lots de publication collective" dans
  `/admin/fundraiser/publications`, avec creation de lot, assignation par
  brouillon, planification, publication et annulation. Les lots sont
  regroupes par canal puis tries chronologiquement (lots planifies du plus
  proche au plus lointain, puis lots ouverts, puis historique) pour voir
  plusieurs lots a venir d'un coup d'oeil.
- Notification admin par courriel (Resend, `FUNDING_ADMIN_NOTIFICATION_EMAIL`)
  lorsqu'un lot ouvert atteint sa capacite, pour eviter qu'il reste plein et
  oublie. Purement informatif: n'planifie ni ne publie rien automatiquement.
- Endpoint public `GET /api/public/sponsorship-batches/availability`: expose
  uniquement, par canal, la date du prochain lot deja planifie (aucune donnee
  de sponsor, aucun chiffre de capacite). Affiche sur la page de financement
  comme indication ("prochaine diffusion collective Facebook indicative:
  ..."), sous le recapitulatif d'avantages de commandite, quand une date est
  connue.
- Reste a developper: un vrai calendrier avec plusieurs creneaux futurs
  planifies a l'avance par l'admin (aujourd'hui un seul `scheduled_at` par
  lot) et une vue publique dediee au-dela de la phrase indicative sur la
  page de financement.
- Route cachee `/admin/fundraiser/sponsors`.
- Chaque commandite listee affiche son palier (mention OpenG7.org seule,
  - Facebook, + Facebook et LinkedIn) et le detail des avantages obtenus,
    calcules a partir du montant deja affiche (`resolveSponsorshipBenefits`),
    pour reperer le palier sans recalculer mentalement a partir du montant.
- Endpoint `GET /api/admin/sponsorships` pour lister les commandites payees.
- Endpoints `GET /api/admin/sponsorships/logo`,
  `POST /api/admin/sponsorships/logo` et
  `POST /api/admin/sponsorships/logo/delete` pour previsualiser, remplacer ou
  supprimer un logo commanditaire valide PNG/JPEG/WebP avec stockage controle
  par l'API et nettoyage des anciens fichiers controles.
- Endpoint `POST /api/admin/sponsorships/review` pour remettre en attente,
  accepter ou refuser une commandite.
- Endpoint `POST /api/admin/sponsorships/refund` pour declencher un
  remboursement Stripe complet guide, avec confirmation par reference publique,
  verrou de version et audit admin.
- Endpoint `POST /api/admin/sponsorships/publication` pour preparer le profil
  commanditaire public et les placements de feed.
- `FUNDING_ADMIN_TOKEN` requis en production comme secret racine admin.
- `FUNDING_ADMIN_SESSION_SECRET` recommande en production pour signer les
  sessions navigateur separement du secret racine.
- `FUNDING_ADMIN_SESSION_TTL_MINUTES` configure la duree de session admin.
- `FUNDING_SPONSOR_LOGO_STORAGE_DIR` et `FUNDING_SPONSOR_LOGO_MAX_BYTES`
  configurent le stockage prive et la limite d'upload des logos.
- Les commandites ne peuvent apparaitre dans `/batisseurs` que si elles sont
  approuvees.

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
  - `002_create_fundraiser_mvp_tables.sql`;
  - `003_add_sponsorship_details.sql`.
  - `004_add_sponsorship_review.sql`.
  - `005_add_sponsorship_followup_token.sql`.
  - `006_add_sponsorship_publication_feed.sql`.
  - `007_add_admin_audit_and_publication_drafts.sql`.
- Tables MVP:
  - `stripe_events`;
  - `stripe_checkout_sessions`;
  - `fund_contributions` (colonnes `sponsor_*`, revue privee, hash de token
    de suivi commandite et placements feed).
  - `sponsor_publication_drafts` (brouillons prives de publications commanditees).
  - `admin_audit_log` (journal prive des actions admin).

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

### Page commanditaires et feeds

- Route publique `/commanditaires`.
- Route anglaise `/en/commanditaires`.
- Endpoint public `GET /api/public/sponsorships`.
- Endpoint public `GET /api/public/sponsor-logos/<file>` pour servir seulement
  les logos references par une commandite approuvee et consentie.
- Les commandites publiques exigent paiement confirme, consentement public,
  nom d'entreprise et `sponsor_review_status=approved`.
- L'admin peut preparer un slug, un resume public, une cible `openg7` ou
  `openg20`, les canaux `facebook` et/ou `linkedin`, un statut feed et un lien
  de publication.
- Aucune publication automatique vers Facebook ou LinkedIn n'est effectuee.

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
- prerender des routes publiques FR/EN incluant `/fonds-des-batisseurs`,
  `/batisseurs` et `/commanditaires`.

## Points a valider en preproduction

- `FUNDING_PLATFORM_ENV=production`.
- `FUNDING_PUBLIC_BASE_URL=https://openg7.org`.
- `FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org`.
- `STRIPE_SECRET_KEY` configure cote API seulement.
- `STRIPE_WEBHOOK_SECRET` configure avec le endpoint Stripe final.
- `FUNDING_ALLOWED_AMOUNTS` aligne avec l'UI.
- `FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false` garde les nouvelles
  commandites d'entreprise fermees tant que le flux n'est pas complet.
- `FUNDING_ADMIN_TOKEN` configure en production si la revue admin est active.
- `FUNDING_ADMIN_SESSION_SECRET` configure avec un secret distinct et
  `FUNDING_ADMIN_SESSION_TTL_MINUTES` ajuste selon la politique d'operation.
- `FUNDING_SPONSOR_LOGO_STORAGE_DIR` persistant et
  `FUNDING_SPONSOR_LOGO_MAX_BYTES` alignes avec la limite d'upload attendue.
- `RESEND_API_KEY` et `FUNDING_EMAIL_FROM` configures si les liens de reprise
  doivent etre envoyes automatiquement.
- `FUNDING_ADMIN_NOTIFICATION_EMAIL` configure si la notification de lot
  complet doit etre envoyee (sinon la verification de capacite reste
  disponible dans l'UI admin, sans courriel).
- `DATABASE_URL` absent pour le mode Stripe-direct, ou configure seulement si PostgreSQL prive est deploye.
- Migrations appliquees si PostgreSQL est active.
- Webhook Stripe abonne aux evenements MVP.
- Routes publiques testees apres deploiement:
  - `/`;
  - `/fonds-des-batisseurs`;
  - `/fonds-des-batisseurs/transparence`;
  - `/fonds-des-batisseurs/suivi-commandite?token=...`;
  - `/batisseurs`;
  - `/commanditaires`;
  - `/en`;
  - `/en/fonds-des-batisseurs`;
  - `/en/fonds-des-batisseurs/transparence`;
  - `/en/batisseurs`;
  - `/en/commanditaires`.
- Endpoint public teste:
  - `GET /api/public/fund-transparency`.
  - `GET /api/sponsorship-followup?token=...`.
  - `GET /api/public/sponsorships`.
- Endpoint admin teste avec jeton:
  - `GET /api/admin/dashboard`.
  - `GET /api/admin/contributions`.
  - `GET /api/admin/contributions.csv`.
  - `GET /api/admin/expenses`.
  - `POST /api/admin/expenses`.
  - `POST /api/admin/expenses/update`.
  - `GET /api/admin/transparency`.
  - `GET /api/admin/sponsorships`.
  - `POST /api/admin/sponsorships/publication`.
  - `GET /api/admin/publication-drafts`.
  - `POST /api/admin/publication-drafts`.
  - `POST /api/admin/publication-drafts/update`.
  - `GET /api/admin/audit-log`.
- Checkout teste avec une contribution reelle de faible montant ou en mode test Stripe.
- Rejeu du meme evenement webhook teste pour confirmer l'idempotence.

## Hors MVP

Les elements suivants restent volontairement hors perimetre:

- back-office admin avance;
- authentification admin par fournisseur externe;
- fiches detaillees `/batisseurs/[slug]`;
- bibliotheque avancee d'actifs de marque, variantes de logos et recadrage;
- publication automatique de commanditaires;
- publication automatique vers les feeds OpenG7/OpenG20;
- integration API LinkedIn/Facebook;
- factures PDF et recus officiels de don;
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
- Sans Resend configure, aucun courriel de reprise n'est envoye; le suivi reste
  accessible via l'URL de retour Stripe tant que le sponsor la conserve, et
  l'admin peut detecter les commandites payees mais incompletes.

## Prochaine etape recommandee

Avant d'ouvrir de nouveaux chantiers fonctionnels, faire une revue PR courte:

1. Relire les textes publics non-charite et commandite.
2. Tester un checkout Stripe en mode test.
3. Tester un webhook signe et son rejeu.
4. Verifier le rendu mobile des routes Fonds, Transparence et Batisseurs.
5. Decider le mode de lancement: Stripe-direct sans DB ou PostgreSQL prive.
