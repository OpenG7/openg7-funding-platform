# OpenG7 Funding Platform — Guide des agents et règles d’exécution

Ce document est la **spécification opérationnelle vivante** du dépôt `openg7-funding-platform`. Il s’adresse aux agents IA et aux contributeurs humains qui créent, modifient, testent, déploient ou documentent la plateforme de financement OpenG7.

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) décrit les principes durables, les frontières du système et la direction des dépendances.
- `AGENTS.md` transforme ces principes en règles exécutables, procédures de travail, garde-fous financiers et critères d’acceptation.
- Le code, les migrations, `package.json`, `docker-compose.yml` et la configuration d’environnement réellement présents dans le dépôt demeurent les sources de vérité techniques.
- En cas de divergence entre le code et la documentation, ne pas inventer silencieusement une troisième règle : documenter l’écart et corriger les sources concernées dans le même changement.

Ce dépôt est un monorepo Yarn comprenant une application Angular, une API Node.js/TypeScript, des packages réutilisables, PostgreSQL optionnel, Stripe, Docker Compose et Traefik.

---

## 1. Portée des instructions

Le fichier `AGENTS.md` situé à la racine s’applique à l’ensemble du dépôt.

Des fichiers plus précis peuvent être ajoutés plus tard, par exemple :

```text
apps/funding-web/AGENTS.md
apps/funding-api/AGENTS.md
scripts/AGENTS.md
```

Lorsqu’un fichier d’instructions plus proche du code modifié existe, ses règles spécialisées complètent les présentes instructions. Une règle locale ne peut pas assouplir silencieusement un garde-fou financier, de sécurité, de confidentialité ou de production défini ici.

---

## 2. Contexte technique actuel

| Élément | Convention actuelle |
| --- | --- |
| Runtime | Node.js 22 |
| Gestionnaire de paquets | Yarn 4 |
| Front | Angular 21 standalone, SSR, signals, RxJS, NgRx ciblé |
| Styles | Tailwind CSS 4 et styles de composants existants |
| API | Node.js + TypeScript, exécution ESM |
| Paiement | Stripe Checkout, webhooks et API Stripe |
| Base de données | PostgreSQL 16, profil Docker optionnel `database` |
| Reverse proxy | Traefik 3.2 |
| Conteneurs | Docker Compose |
| Tests | `node:test` après compilation TypeScript |
| Répertoire de production | `/opt/openg7-funding-platform` |
| Licence | MIT |

Ne pas modifier une version majeure, un runtime ou une fondation technique sans vérifier les contraintes du dépôt, les images Docker, les workflows CI et la documentation de production.

---

## 3. Règles non négociables

1. **Inspecter avant de modifier.** Lire les fichiers concernés, rechercher les implémentations équivalentes et vérifier `git status --short`.
2. **Préserver les frontières.** Le Web ne parle ni directement à PostgreSQL ni aux API Stripe secrètes.
3. **Stripe confirme le paiement.** Un paramètre d’URL, une redirection de succès ou un état navigateur ne rend jamais une contribution payée.
4. **Les webhooks sont idempotents.** Une livraison répétée, retardée ou désordonnée ne doit jamais doubler une transaction, un courriel, une facture ou une écriture comptable.
5. **Aucun secret dans le dépôt.** Ne jamais écrire de clé Stripe, mot de passe, token admin, secret de session, URL privée ou contenu sensible dans le code, les tests, les logs, les captures ou la documentation.
6. **Séparer strictement test et production.** Ne jamais employer une commande `:live`, une clé Stripe live ou un endpoint de production sans demande explicite.
7. **Les montants sont exacts.** Utiliser des unités mineures entières et une devise explicite. Ne jamais utiliser les nombres flottants pour les écritures financières.
8. **Les migrations sont additives.** Ne pas modifier une migration déjà appliquée; créer une nouvelle migration numérotée.
9. **PostgreSQL reste privé.** Ne jamais exposer le port `5432` publiquement ni router la base par Traefik.
10. **Le paiement ne publie pas un commanditaire.** L’approbation, la visibilité publique et la publication demeurent des décisions administratives distinctes.
11. **L’interface admin n’est pas une frontière de sécurité.** Chaque endpoint administratif valide l’autorisation côté API.
12. **Les actions sensibles sont auditables.** Remboursement, approbation, refus, publication, masquage, retry de courriel, backfill et correction doivent produire une trace sûre.
13. **Aucune opération destructive implicite.** Ne pas déployer, restaurer, migrer la production, rembourser, supprimer des données ou effectuer un rollback sans instruction explicite.
14. **Ne pas pousser automatiquement.** Ne pas créer de commit, pousser une branche ou ouvrir une pull request sans demande explicite.
15. **Rapporter honnêtement les validations.** Ne jamais affirmer qu’une commande a réussi si elle n’a pas été exécutée.

---

## 4. Classification du risque

Avant toute intervention, classer le changement.

### 4.1 Risque faible

Exemples :

- documentation;
- texte et traduction;
- styles sans impact fonctionnel;
- composant UI de présentation;
- test isolé;
- amélioration non destructive d’un script local.

Procédure : inspection, modification ciblée, validations applicables, résumé.

### 4.2 Risque modéré

Exemples :

- endpoint API;
- logique de contribution ou commandite;
- session admin;
- file de courriels;
- génération de facture;
- projection de transparence;
- configuration Docker ou Traefik;
- nouvelle migration locale;
- changement de contrat partagé.

Procédure : analyser les contrats, les états, l’idempotence, la sécurité, les tests et les impacts de compatibilité.

### 4.3 Risque élevé

Exemples :

- Stripe live;
- remboursement réel;
- backfill live;
- migration ou restauration de production;
- changement de secret;
- déploiement VPS;
- rollback;
- suppression ou correction de données financières;
- exposition réseau;
- modification du modèle comptable.

Procédure obligatoire :

1. ne pas exécuter l’action par défaut;
2. présenter la commande ou l’opération exacte;
3. préciser la portée, les préconditions, les sauvegardes et le plan de retour;
4. obtenir une instruction explicite;
5. exécuter une étape à la fois;
6. vérifier et consigner le résultat.

---

## 5. Procédure standard des agents

### 5.1 Avant la modification

1. Confirmer la racine du dépôt.
2. Exécuter ou demander :

```bash
git status --short
```

3. Lire les fichiers directement concernés.
4. Rechercher une fonction, un service, un composant, un test ou un script équivalent.
5. Vérifier :
   - `package.json`;
   - le `package.json` du workspace concerné;
   - les migrations pertinentes;
   - les variables décrites dans `.env.example`;
   - les tests existants;
   - `docs/ARCHITECTURE.md`;
   - les instructions plus proches si elles existent.
6. Identifier la classe de risque.
7. Définir le plus petit changement cohérent.

### 5.2 Pendant la modification

- Préserver les contrats existants sauf décision explicite.
- Ne pas effectuer de refactorisation opportuniste sans rapport avec la demande.
- Garder les changements financiers déterministes et testables.
- Ajouter les tests dans le même changement.
- Ajouter une migration lorsqu’un schéma persistant change.
- Mettre à jour la documentation lorsque le comportement, une commande ou un contrat public change.
- Ne pas masquer une erreur par un fallback de succès.
- Ne pas journaliser de données sensibles pour faciliter le débogage.

### 5.3 Après la modification

1. Relire le diff complet.
2. Exécuter :

```bash
git diff --check
git status --short
```

3. Exécuter les validations applicables de la section 21.
4. Vérifier les états d’erreur et les chemins de retry.
5. Résumer :
   - fichiers créés;
   - fichiers modifiés;
   - décisions importantes;
   - validations exécutées;
   - validations non exécutées;
   - risques résiduels;
   - migrations ou opérations manuelles requises.

---

## 6. Carte du dépôt et responsabilités

```text
/ (racine)
├─ apps/
│  ├─ funding-web/                 # Application Angular publique et admin
│  └─ funding-api/                 # API HTTP, Stripe, DB, courriel, PDF
├─ packages/
│  ├─ funding-core/                # Logique de domaine réutilisable
│  ├─ funding-models/              # Modèles immuables et types
│  ├─ funding-ui/                  # Design tokens et UI partageable
│  └─ funding-i18n/                # Clés et métadonnées de traduction
├─ tests/                          # Tests d’intégration et de couverture fonctionnelle
├─ scripts/                        # Docker, DB, Stripe, VPS, sauvegarde et déploiement
├─ docs/                           # Architecture, périmètres et runbooks
├─ traefik/                        # Configuration statique et dynamique
├─ docker-compose.yml
├─ .env.example
├─ package.json
└─ AGENTS.md
```

### 6.1 `apps/funding-web`

Responsable de :

- l’expérience publique du Fonds des Bâtisseurs;
- le choix du type et du montant de contribution;
- l’ouverture de Stripe Checkout par l’API;
- l’expérience après redirection;
- la transparence publique;
- les pages commanditaires et bâtisseurs;
- le suivi de commandite;
- l’administration protégée;
- l’accessibilité, l’i18n et le responsive;
- l’état local de présentation.

Interdictions :

- aucune clé Stripe secrète;
- aucun accès direct à PostgreSQL;
- aucune confirmation de paiement depuis `?checkout=success`;
- aucun calcul financier autoritaire;
- aucune publication automatique après paiement;
- aucune autorisation basée uniquement sur un guard Angular.

### 6.2 `apps/funding-api`

Responsable de :

- créer les sessions Stripe Checkout;
- vérifier les signatures webhook;
- normaliser les événements Stripe;
- persister les contributions et états opérationnels;
- produire les projections de transparence;
- gérer les sessions et endpoints admin;
- gérer les commandites, publications, dépenses et audits;
- gérer la file de courriels;
- produire factures et notes de crédit;
- orchestrer remboursement, backfill et réconciliation;
- exposer les endpoints de santé.

L’API est la seule couche applicative autorisée à combiner les faits Stripe avec l’état métier OpenG7.

### 6.3 `packages/funding-core`

Doit contenir la logique métier réutilisable et indépendante des frameworks lorsque cela est raisonnable :

- règles de configuration;
- calculs déterministes;
- politiques de contribution;
- validation de contrats;
- transitions de domaine;
- fonctions pures.

Ne doit pas dépendre de composants Angular, du serveur HTTP, de PostgreSQL, d’un fichier `.env` ou du SDK Stripe concret.

### 6.4 `packages/funding-models`

Doit contenir :

- types et modèles immuables;
- unions d’états;
- interfaces de contrats;
- valeurs de domaine stables.

Éviter les effets de bord, l’accès réseau et la lecture d’environnement.

### 6.5 `packages/funding-ui`

Doit contenir uniquement ce qui est véritablement partageable :

- design tokens;
- primitives neutres;
- styles et contrats visuels réutilisables.

Ne pas y déplacer un composant uniquement parce qu’une réutilisation future semble possible.

### 6.6 `packages/funding-i18n`

Doit fournir :

- clés de traduction;
- métadonnées de locales;
- conventions partagées.

Ne pas y introduire de logique métier ou de contenu privé.

### 6.7 `scripts`

Les scripts peuvent agir sur Docker, PostgreSQL, Stripe ou le VPS. Ils sont donc considérés sensibles.

Règles :

- mode non destructif ou `dry-run` lorsqu’il est possible;
- messages d’erreur explicites;
- validation des variables requises;
- aucune impression de secret;
- confirmation renforcée pour le mode live;
- comportement compatible Linux;
- normalisation des fins de ligne avant chargement de `.env`;
- chemins absolus ou racine vérifiée pour les opérations de production;
- sortie non nulle en cas d’échec.

---

## 7. Direction des dépendances

### 7.1 Front

```text
pages
  ↓
orchestration de feature
  ↓
composants métier
  ↓
composants partagés
  ↓
packages UI, modèles et i18n
```

Une primitive UI ne dépend pas :

- du routeur;
- d’un client HTTP;
- de Stripe;
- de PostgreSQL;
- d’une session admin;
- d’un store global.

### 7.2 API

```text
transport HTTP
  ↓
services applicatifs
  ↓
logique de domaine
  ↓
ports / interfaces
  ↓
adaptateurs Stripe, PostgreSQL, courriel, stockage, PDF
```

Les règles de domaine ne doivent pas être enfermées dans le routeur HTTP ou dans les requêtes SQL.

### 7.3 Entre workspaces

- `funding-web` peut consommer les packages publics du monorepo.
- `funding-api` peut consommer `funding-core` et les contrats neutres pertinents.
- Les packages ne doivent pas importer des fichiers privés sous `apps/**`.
- Un package partagé n’accède pas directement à `.env`.
- Les dépendances circulaires sont interdites.

---

## 8. Front Angular et composition UI

Tous les nouveaux composants Angular sont :

- standalone;
- `ChangeDetectionStrategy.OnPush`;
- signal-first pour l’état local;
- typés strictement;
- accessibles;
- compatibles SSR;
- compatibles avec l’i18n du projet;
- testables sans dépendre d’une classe CSS comme contrat.

### 8.1 Atomic Design adapté à Funding

Atomic Design sert de taxonomie de responsabilité, pas d’arborescence globale imposée.

| Niveau | Définition Funding | Logique permise | Emplacement habituel |
| --- | --- | --- | --- |
| Atome | Primitive visuelle indivisible | aucune logique métier | `packages/funding-ui` ou UI locale neutre |
| Molécule | Petit assemblage ciblé | état de présentation minimal | `components/` |
| Organisme | Surface fonctionnelle complète | orchestration de présentation | `features/funding/components/` |
| Template | Squelette responsive de page | aucun chargement financier | composant de layout ou feature |
| Page | Point d’entrée routé | route, chargement, permissions, orchestration | `features/funding/pages/` |

### 8.2 Domaine d’abord

Le vocabulaire Funding reste dans la feature Funding :

- contribution;
- commandite;
- publication;
- dépense;
- facture;
- remboursement;
- transparence;
- audit.

Un composant ayant une responsabilité métier ne devient pas « partagé » uniquement parce qu’il est visuellement réutilisable.

### 8.3 Procédure avant création d’un composant

1. Rechercher un composant équivalent.
2. Décrire sa responsabilité en une phrase.
3. Déterminer son niveau Atomic Design.
4. Déterminer sa portée : neutre, publique, admin ou domaine Funding.
5. Définir des inputs et outputs typés.
6. Prévoir les états :
   - chargement;
   - vide;
   - erreur;
   - désactivé;
   - non autorisé;
   - succès non confirmé lorsque le serveur n’a pas encore confirmé.
7. Ajouter clavier, focus, labels et ARIA.
8. Vérifier le rendu SSR.
9. Ajouter les tests adaptés.

### 8.4 Conventions de sélecteurs

- Les composants Angular utilisent le préfixe `openg7-`.
- Les sélecteurs sont en kebab-case.
- Les classes CSS et Tailwind sont des détails d’implémentation.
- Pour les nouveaux hooks E2E stables, utiliser :
  - `data-og7="..."`;
  - `data-og7-id="..."`.
- Ne pas lancer une migration massive des composants existants uniquement pour ajouter ces hooks.
- Lorsqu’un hook stable est renommé, mettre à jour les tests et la documentation dans le même changement.

### 8.5 Signals et NgRx

Utiliser `signal`, `computed` et `effect` pour :

- choix du montant;
- ouverture de panneau;
- filtres locaux;
- état de formulaire;
- chargement local;
- animation et présentation.

Réserver NgRx à un état réellement partagé et durable, par exemple :

- total confirmé;
- configuration de campagne partagée;
- allocations;
- état de synchronisation backend;
- données consommées par plusieurs routes.

Ne pas créer un store global pour un simple état visuel.

### 8.6 SSR

Interdictions au chargement du module :

- `window`;
- `document`;
- `localStorage`;
- `sessionStorage`;
- mesures de viewport;
- API audio;
- canvas;
- bibliothèque navigateur non protégée.

Utiliser une vérification de plateforme ou un import dynamique. Éviter les divergences d’hydratation liées au temps, à l’aléatoire ou à une valeur navigateur non disponible au serveur.

### 8.7 Accessibilité et i18n

Chaque surface interactive doit inclure :

- utilisation complète au clavier;
- focus visible;
- nom accessible;
- erreurs de formulaire associées aux champs;
- statut dynamique annoncé lorsque nécessaire;
- ordre de lecture logique;
- focus restauré après fermeture de modale ou drawer;
- contraste suffisant;
- texte visible traduit selon les conventions du projet.

Ne pas coder en dur une nouvelle chaîne de production lorsqu’une clé de traduction est appropriée.

---

## 9. Definition of Done — UI

- [ ] Responsabilité et niveau UI identifiés.
- [ ] Emplacement justifié.
- [ ] Composant standalone et OnPush.
- [ ] Inputs et outputs typés.
- [ ] Aucun accès direct à Stripe secret, DB ou API d’infrastructure.
- [ ] États loading, empty, error, disabled et non autorisé couverts lorsqu’ils s’appliquent.
- [ ] Redirection Stripe distinguée d’une confirmation serveur.
- [ ] Clavier, focus et noms accessibles vérifiés.
- [ ] i18n respectée.
- [ ] SSR vérifié.
- [ ] Tests ajoutés.
- [ ] Aucun test fondé sur une classe de style fragile.

---

## 10. Paiements Stripe

### 10.1 Autorité

Stripe est l’autorité des faits externes de paiement :

- Checkout Session;
- PaymentIntent;
- Charge;
- Balance Transaction;
- Refund;
- Event.

PostgreSQL contient une représentation normalisée et auditée de ces faits ainsi que l’état métier OpenG7.

### 10.2 Création de Checkout

- Le navigateur appelle l’API.
- L’API valide le type, le montant, la devise et les consentements.
- L’API crée Stripe Checkout avec les métadonnées nécessaires.
- L’API retourne uniquement les données publiques nécessaires à la redirection.
- Le mode mock est local uniquement.
- En production, une configuration Stripe manquante produit une erreur, jamais un faux succès.

### 10.3 Retour navigateur

Le retour `success_url` indique seulement que Stripe a redirigé le navigateur.

Il peut afficher :

- « paiement en cours de confirmation »;
- « merci »;
- une action pour rafraîchir le statut.

Il ne peut pas :

- insérer directement une transaction payée;
- rendre une commandite publique;
- produire une facture autoritaire;
- augmenter un total confirmé sans lecture serveur.

### 10.4 Webhooks

Règles obligatoires :

1. conserver le corps brut nécessaire à la vérification;
2. vérifier la signature avant tout traitement;
3. enregistrer ou dédupliquer l’identifiant `event.id`;
4. traiter dans une transaction lorsque plusieurs écritures doivent rester cohérentes;
5. accepter les livraisons répétées;
6. tolérer un ordre d’événements différent;
7. marquer clairement l’état de traitement et l’erreur;
8. permettre un retry sûr;
9. corréler les objets par leurs identifiants Stripe;
10. ne jamais envoyer deux fois un effet externe pour le même événement logique.

### 10.5 Frais et montant net

- Le montant brut vient de l’objet Stripe autoritaire.
- Les frais et le net proviennent de `balance_transaction` lorsqu’ils sont disponibles.
- `charge.updated` peut compléter une transaction existante lorsque le `balance_transaction` arrive plus tard.
- Ne pas remplacer une valeur confirmée par une estimation moins fiable.
- Conserver la provenance et le moment de la mise à jour.

### 10.6 Mode test et mode live

Les commandes comportant `:live` sont à risque élevé :

```text
stripe:events:resend:live
stripe:backfill:live
stripe:backfill:docker:live
```

Ne pas les exécuter sans instruction explicite. Avant toute opération live :

- confirmer la clé et le compte Stripe visé sans imprimer le secret;
- préciser la plage temporelle;
- commencer par un dry-run lorsqu’il existe;
- limiter le volume;
- vérifier le résultat;
- conserver la possibilité de reprendre.

---

## 11. PostgreSQL et migrations

### 11.1 Activation

PostgreSQL est optionnel pour certains parcours de lancement rapide, mais devient nécessaire pour les fonctions opérationnelles persistantes.

En production :

- le service est sur le réseau interne `data`;
- aucun port public `5432`;
- l’API seule accède à `DATABASE_URL`;
- les sauvegardes et restaurations sont des opérations contrôlées.

### 11.2 Règles de schéma

- Clés primaires stables.
- Contraintes uniques pour les identifiants Stripe et clés d’idempotence pertinentes.
- Dates stockées avec une sémantique UTC explicite.
- Montants en unités mineures entières.
- Devise enregistrée.
- États modélisés explicitement.
- Données publiques séparables des données privées.
- Métadonnées sensibles minimisées.
- Index ajoutés selon les requêtes réelles.
- Suppression logique ou archive lorsqu’une piste d’audit est requise.

### 11.3 Migrations

- Une migration appliquée est immuable.
- Ajouter le prochain fichier numéroté sous `apps/funding-api/migrations/`.
- Rendre la migration déterministe.
- Prévoir les valeurs existantes.
- Éviter les opérations longues ou bloquantes sans plan.
- Ajouter un test ou une vérification de migration.
- Documenter toute étape manuelle.
- Une migration de production exige une sauvegarde récente et vérifiée.

### 11.4 Transactions

Utiliser une transaction DB lorsque l’opération doit être atomique, notamment :

- enregistrement de webhook + normalisation financière;
- remboursement + état interne;
- création de note de crédit + écriture comptable;
- publication + audit;
- réparation de réconciliation.

Les effets externes, comme l’envoi de courriel, doivent être découplés par une file ou un état persistant afin de ne pas rendre la transaction non déterministe.

---

## 12. Modèle financier et comptable

### 12.1 Unités monétaires

Toujours utiliser :

```text
amount_minor: integer
currency: ISO 4217
```

Exemple :

```text
2500 CAD = 25,00 $
```

Interdictions :

- `25.00` comme valeur comptable flottante;
- arrondi implicite;
- devise supposée sans champ;
- addition de montants de devises différentes.

### 12.2 Append-only

Les faits financiers confirmés ne sont pas réécrits pour « faire disparaître » une erreur.

Utiliser :

- écriture compensatoire;
- remboursement;
- note de crédit;
- nouvelle version ou correction tracée.

### 12.3 Factures de commandite

- La facture est un snapshot des informations au moment de l’émission.
- Le numéro et le lien au paiement restent stables.
- La réémission d’un courriel ne modifie pas silencieusement la facture.
- Les changements légaux ou fiscaux n’altèrent pas rétroactivement les snapshots déjà émis.
- Un backfill historique ne doit pas envoyer automatiquement des courriels sans option explicite.

### 12.4 Notes de crédit

- Une note de crédit référence la facture et le remboursement concernés.
- Le montant ne dépasse pas le montant admissible.
- Les remboursements partiels sont représentés explicitement.
- La note est immuable après émission, sauf correction tracée par un nouveau document.
- Un échec d’envoi de courriel ne doit pas annuler le fait comptable.

---

## 13. Contributions et commandites

### 13.1 Types

La plateforme distingue au minimum :

- contribution personnelle;
- intérêt ou commandite d’entreprise.

Le type influence les champs, consentements, suivis et bénéfices, mais ne permet jamais au front de confirmer le paiement.

### 13.2 Reconnaissance

La mention sur OpenG7.org peut être incluse selon la configuration et le consentement. Les bénéfices supplémentaires de commandite peuvent dépendre du montant ou de la politique active.

Toute modification de grille doit :

- être définie dans la configuration partagée;
- être testée;
- être affichée clairement avant paiement;
- ne pas modifier rétroactivement les engagements existants sans décision explicite.

### 13.3 Revue des commanditaires

États recommandés :

```text
pending
approved
refused
```

La revue est indépendante :

- du paiement;
- du consentement public;
- de la visibilité;
- du statut de publication.

Une approbation doit enregistrer l’acteur, la date et une note ou raison lorsque pertinente. Un refus ne supprime pas l’historique financier.

### 13.4 Visibilité et publication

États de publication :

```text
not_planned
planned
drafted
published
hidden
```

Règles :

- aucun passage automatique à `published` après paiement;
- le contenu public est validé;
- les liens externes sont enregistrés;
- les cibles `openg7` et `openg20` sont explicites;
- les canaux `facebook` et `linkedin` sont explicites;
- masquer une fiche ne supprime pas l’historique;
- toute action sensible est auditée.

### 13.5 Provenance externe

Pour une contribution provenant d’une plateforme comme La Ruche :

- conserver la source et une référence externe;
- distinguer clairement la provenance de Stripe direct;
- ne pas inventer un identifiant Stripe;
- conserver les preuves ou métadonnées admissibles;
- rendre l’import idempotent;
- éviter les doubles totaux;
- inclure ces données dans la réconciliation avec une provenance explicite.

---

## 14. Administration et sécurité

### 14.1 Sessions admin

Le navigateur échange le secret racine par l’endpoint de session prévu. Ensuite, il utilise un token de session signé et limité dans le temps.

Règles :

- ne jamais stocker le token racine dans le bundle;
- ne jamais afficher les secrets dans la page setup;
- valider l’expiration côté API;
- refuser l’accès par défaut;
- limiter les données retournées;
- invalider proprement une session expirée;
- éviter les secrets dans l’URL.

### 14.2 Guards Angular

Le guard `canMatch` améliore l’expérience de navigation. Il ne remplace pas l’autorisation API.

Chaque endpoint admin doit vérifier l’authentification même si la page correspondante est protégée.

### 14.3 Actions à risque

Exigent confirmation explicite dans l’UI et validation serveur :

- remboursement;
- suppression de logo;
- publication;
- refus;
- masquage;
- retry massif;
- backfill;
- correction d’une destination de courriel;
- export privé.

### 14.4 Audit

Un événement d’audit doit inclure, sans secret :

- acteur ou type d’acteur;
- action;
- cible;
- horodatage;
- résultat;
- identifiant de corrélation;
- métadonnées minimales;
- raison lorsque requise.

Ne pas enregistrer :

- token complet;
- secret;
- corps de webhook brut;
- numéro de carte;
- contenu privé inutile.

---

## 15. Transparence et confidentialité

### 15.1 Projection publique

La transparence publique peut exposer :

- totaux agrégés;
- montant brut;
- frais confirmés ou clairement estimés;
- montant net;
- allocations publiées;
- catégories de dépense;
- dates ou périodes pertinentes;
- méthode de calcul.

Elle ne doit pas exposer :

- courriel;
- téléphone;
- adresse privée;
- notes admin;
- token de suivi;
- identifiants secrets;
- données de paiement;
- contenu de commandite non approuvé.

### 15.2 Mode Stripe-direct et mode PostgreSQL

Les deux modes doivent produire une sémantique publique cohérente.

- Stripe-direct sert de fallback ou de lancement rapide.
- PostgreSQL permet une projection enrichie et persistante.
- Le passage d’un mode à l’autre ne doit pas doubler les montants.
- La source de la projection doit être observable.
- Toute estimation doit être identifiée comme telle.

### 15.3 Consentement

L’affichage public d’un nom ou d’une organisation exige le consentement correspondant et le respect du statut de revue. Un paiement ne vaut pas consentement de publication.

---

## 16. Médias des commanditaires

Les logos et images passent par une abstraction de stockage.

Règles obligatoires :

- taille maximale configurée;
- liste de types MIME autorisés;
- vérification du contenu réel lorsque possible;
- clé de stockage générée côté serveur;
- nom original traité comme métadonnée non fiable;
- aucune traversée de chemin;
- aucune exécution du contenu;
- image privée tant que la commandite n’est pas approuvée;
- suppression et remplacement audités;
- métadonnées en base, binaire hors de la base;
- stratégie de sauvegarde et migration du stockage.

Lorsque le produit exige au moins une image de commanditaire, cette contrainte doit être validée côté API avant publication, pas uniquement dans le formulaire.

---

## 17. Courriels

La file de courriels doit être persistante et idempotente.

Chaque message doit avoir :

- un type de template;
- un destinataire;
- un contexte minimal;
- un statut;
- un nombre de tentatives;
- une date de prochaine tentative;
- une erreur sûre;
- une clé empêchant les doublons logiques.

Règles :

- ne pas envoyer dans une transaction DB ouverte;
- un retry ne crée pas un nouveau fait métier;
- ne pas journaliser le corps privé complet;
- un courriel échoué reste visible dans l’admin;
- un test d’envoi est distingué d’un message réel;
- corriger l’adresse d’envoi ne modifie pas silencieusement l’identité financière originale;
- les paramètres Resend demeurent côté serveur.

---

## 18. Remboursements, backfill et réconciliation

### 18.1 Remboursements

Un remboursement réel est une opération à risque élevé.

Flux :

1. vérifier l’autorisation;
2. charger la transaction et l’état Stripe;
3. valider le montant restant remboursable;
4. demander une raison;
5. créer le remboursement Stripe avec une clé idempotente;
6. enregistrer la référence externe;
7. mettre à jour les états internes;
8. créer la note de crédit ou les écritures nécessaires;
9. créer l’audit;
10. mettre en file le courriel;
11. permettre la reprise en cas de résultat partiel.

Ne jamais simuler un remboursement réussi lorsque Stripe a échoué.

### 18.2 Backfill

Un backfill doit :

- être borné par date, identifiants ou volume;
- être relançable;
- ne pas dupliquer;
- distinguer test/live;
- produire un rapport;
- permettre un dry-run;
- ne pas envoyer automatiquement de courriels historiques;
- ne pas écraser une valeur plus fiable.

### 18.3 Réconciliation

Comparer :

- Stripe;
- `stripe_events`;
- sessions Checkout;
- contributions;
- transactions;
- remboursements;
- factures;
- notes de crédit;
- courriels lorsque pertinent.

Classer les écarts :

- absent localement;
- absent chez le fournisseur;
- montant différent;
- devise différente;
- statut différent;
- doublon;
- frais/net manquants;
- ambigu.

La réparation automatique est permise seulement si elle est déterministe, idempotente et auditée. Les cas ambigus restent en revue humaine.

---

## 19. API et contrats

### 19.1 Validation

Chaque endpoint valide :

- méthode;
- content type;
- taille du corps;
- schéma;
- types;
- enum;
- montant;
- devise;
- autorisation;
- corrélation;
- origine lorsque pertinente.

Ne jamais faire confiance aux valeurs calculées par le navigateur.

### 19.2 Réponses d’erreur

Les erreurs doivent :

- utiliser un statut HTTP approprié;
- fournir un code stable;
- éviter les secrets et traces internes;
- être exploitables par le front;
- être corrélables aux logs;
- distinguer validation, conflit, autorisation, fournisseur indisponible et erreur interne.

### 19.3 Idempotence

Utiliser une clé d’idempotence pour les opérations susceptibles d’être répétées :

- création de Checkout;
- webhook;
- remboursement;
- facture;
- note de crédit;
- publication;
- retry;
- import;
- backfill.

La même clé et le même payload retournent le même résultat logique. Une même clé avec un payload incompatible produit un conflit explicite.

### 19.4 Compatibilité

Lorsqu’un contrat change :

- mettre à jour le producteur;
- mettre à jour les consommateurs;
- mettre à jour les modèles partagés;
- ajouter les tests;
- documenter la transition;
- maintenir une compatibilité lorsque nécessaire.

---

## 20. Docker, Traefik et exploitation

### 20.1 Topologie

- `traefik` expose 80/443.
- `web` est routé par le réseau `edge`.
- `api` rejoint `edge` et `data`.
- `postgres` rejoint uniquement `data`.
- le réseau `data` est interne.
- les dashboards techniques restent liés à `127.0.0.1` par défaut.
- les volumes persistants ne sont jamais supprimés sans instruction explicite.

### 20.2 Healthchecks

Toute modification de service doit préserver :

- healthcheck API `/health`;
- healthcheck Web `/health`;
- healthcheck Traefik;
- `pg_isready` pour PostgreSQL;
- délais de démarrage réalistes;
- dépendances `service_healthy` lorsque nécessaires.

### 20.3 Production

Toujours travailler depuis :

```bash
cd /opt/openg7-funding-platform
```

Avant une opération :

```bash
git status --short
docker compose ps
```

Ne pas lancer `docker compose down -v` en production.

### 20.4 Déploiement

`yarn prod:deploy` ou `yarn vps:deploy` sont des opérations à risque élevé.

Avant déploiement :

- état Git connu;
- validations réussies;
- images identifiées;
- `.env` présent et protégé;
- sauvegarde DB lorsque le changement l’exige;
- espace disque suffisant;
- healthchecks connus;
- stratégie de rollback.

Après déploiement :

- `docker compose ps`;
- santé Web et API;
- logs récents;
- route HTTPS;
- endpoint public de transparence;
- parcours de Checkout en mode approprié;
- admin sans exposition de secret.

### 20.5 Rollback

Le rollback doit viser des images ou révisions connues. Il ne doit pas restaurer automatiquement une base incompatible sans plan séparé.

Documenter :

- version avant;
- version après;
- migration appliquée;
- compatibilité DB;
- raison;
- vérifications.

---

## 21. Commandes et validations

Les scripts réellement présents dans `package.json` sont la source de vérité. Les commandes ci-dessous représentent le socle actuel.

### 21.1 Installation

```bash
corepack enable
yarn install
```

Ne pas changer le lockfile sans nécessité.

### 21.2 Développement local

```bash
yarn dev
yarn dev:funding-web
yarn dev:api
```

### 21.3 Qualité générale

```bash
yarn format:check
yarn lint
yarn build
yarn test
git diff --check
```

`yarn test` compile le projet avant d’exécuter les tests Node.

### 21.4 Couverture E2E ciblée

```bash
yarn test:e2e
```

### 21.5 Docker local

```bash
yarn docker:local
docker compose ps
docker compose config
```

La commande `docker:local` peut démarrer PostgreSQL avec le profil `database`.

### 21.6 Base de données

```bash
yarn db:up
yarn db:migrate
yarn db:logs
yarn db:psql
yarn db:backup
```

`db:restore` est destructif et exige une instruction explicite ainsi qu’une cible clairement identifiée.

### 21.7 Stripe local

```bash
yarn stripe:cli:version
yarn stripe:webhook:listen
```

Les scripts de resend et backfill doivent être utilisés avec une portée explicite.

### 21.8 Production et VPS

Commandes à risque élevé :

```bash
yarn prod:check
yarn prod:deploy
yarn prod:backup
yarn prod:rollback

yarn vps:check
yarn vps:deploy
yarn vps:rollback
yarn vps:backup
yarn vps:db:migrate
```

Ne pas exécuter ces commandes automatiquement pendant une tâche de code ou une pull request.

### 21.9 Matrice minimale

| Changement | Validations minimales |
| --- | --- |
| Documentation | `git diff --check`, liens et chemins relus |
| UI/style | `format:check`, `lint`, `build`, tests pertinents |
| Configuration Funding | `build`, tests de configuration |
| API | `lint`, `build`, `test` |
| Stripe/webhook | tests de signature, idempotence, répétition et ordre |
| Migration | migration sur DB locale propre et existante, tests API |
| Docker/Traefik | `docker compose config`, healthchecks ciblés |
| Courriel | file, retry, déduplication, logs sûrs |
| Facture/note de crédit | snapshot, PDF, numérotation, resend, remboursement |
| Transparence | agrégats, PII absente, modes Stripe-direct et DB |
| Scripts VPS | analyse statique, shell syntax, aucune exécution prod implicite |

Si une commande ne peut pas être exécutée, expliquer précisément pourquoi.

---

## 22. Tests attendus par domaine

### 22.1 Paiement

Couvrir :

- montant autorisé;
- montant personnalisé valide et invalide;
- devise;
- contribution personnelle;
- commandite activée/désactivée;
- absence de clé Stripe;
- mode mock local seulement;
- redirection sans confirmation;
- erreur fournisseur.

### 22.2 Webhooks

Couvrir :

- signature valide;
- signature invalide;
- événement répété;
- événement hors ordre;
- erreur transitoire;
- reprise;
- `checkout.session.completed`;
- `payment_intent.succeeded`;
- `charge.updated`;
- frais/net disponibles tardivement;
- événement inconnu ignoré de façon sûre.

### 22.3 Commandites

Couvrir :

- paiement séparé de la revue;
- consentement public;
- pending/approved/refused;
- logo valide/invalide;
- publication manuelle;
- masquage;
- statut de feed;
- remboursement;
- audit.

### 22.4 Admin

Couvrir :

- session valide;
- session expirée;
- token absent;
- endpoint protégé;
- confirmation d’action sensible;
- aucune valeur secrète retournée;
- audit;
- CSV privé.

### 22.5 Courriels

Couvrir :

- enqueue unique;
- retry;
- échec permanent;
- reprise après redémarrage;
- rendu des templates;
- destinataire corrigé;
- absence de double envoi.

### 22.6 Comptabilité

Couvrir :

- unités mineures;
- remboursement partiel;
- remboursement total;
- note de crédit;
- plusieurs remboursements;
- backfill historique;
- impossibilité de dépasser le montant;
- append-only.

### 22.7 Transparence

Couvrir :

- zéro transaction;
- agrégats;
- frais manquants;
- allocations publiées seulement;
- mode Stripe-direct;
- mode PostgreSQL;
- absence de PII;
- cohérence de devise.

---

## 23. Observabilité et logs

Chaque requête sensible doit pouvoir être corrélée sans exposer de secret.

Utiliser lorsque possible :

- `request_id`;
- `correlation_id`;
- `stripe_event_id`;
- `checkout_session_id`;
- `payment_intent_id`;
- `contribution_id`;
- `audit_event_id`;
- `reconciliation_run_id`.

Les logs peuvent inclure :

- type d’événement;
- statut;
- durée;
- code d’erreur sûr;
- identifiant tronqué ou non secret;
- nombre d’éléments.

Ils ne doivent pas inclure :

- clés API;
- token admin;
- secret de session;
- signature webhook;
- corps privé complet;
- données de carte;
- token de suivi;
- adresse ou courriel sans nécessité.

---

## 24. Sauvegarde, restauration et reprise

### 24.1 Sauvegarde

Une sauvegarde doit préciser :

- date;
- environnement;
- base;
- format;
- taille;
- checksum lorsque disponible;
- rétention;
- emplacement protégé.

### 24.2 Restauration

Avant toute restauration :

1. confirmer la cible;
2. créer une sauvegarde de l’état actuel;
3. arrêter les écritures ou définir le mode maintenance;
4. vérifier la compatibilité de version;
5. tester sur une cible isolée lorsque possible;
6. présenter la commande exacte;
7. obtenir une instruction explicite.

Après restauration :

- exécuter les migrations nécessaires;
- vérifier les contraintes;
- vérifier les totaux;
- exécuter la réconciliation Stripe;
- vérifier l’admin;
- consigner l’opération.

### 24.3 Médias

Les logos et images doivent être sauvegardés avec leurs métadonnées. Une restauration DB sans les objets médias correspondants est incomplète.

---

## 25. Sécurité des dépendances et configuration

- Ne pas ajouter une dépendance pour une fonction triviale déjà disponible.
- Vérifier licence, maintenance, taille et surface d’attaque.
- Éviter les packages exécutant du code au postinstall sans nécessité.
- Garder les dépendances de production dans le workspace qui les utilise.
- Ne pas déplacer une dépendance au niveau racine pour masquer une mauvaise frontière.
- Ne pas désactiver TLS, CORS, CSRF ou la vérification de signature pour « faire fonctionner » la production.
- Les origines autorisées sont explicites.
- Les fichiers `.env` sont exclus du contrôle de version.
- `.env.example` contient des noms et exemples non secrets.
- Une nouvelle variable d’environnement doit être :
  - documentée;
  - validée au démarrage;
  - classée publique ou secrète;
  - ajoutée aux environnements concernés;
  - testée en absence et présence.

---

## 26. Documentation

Mettre à jour la documentation lorsque le changement touche :

- une commande;
- une variable;
- un endpoint;
- un statut;
- une migration;
- un flux financier;
- une page admin;
- une règle de commandite;
- un stockage;
- un déploiement;
- un rollback;
- une sauvegarde;
- une décision d’architecture.

Règles :

- `ARCHITECTURE.md` explique pourquoi et où;
- `AGENTS.md` explique comment exécuter;
- les runbooks décrivent les opérations;
- le README présente l’usage et le démarrage;
- ne pas maintenir plusieurs descriptions contradictoires;
- dater les décisions importantes;
- utiliser un ADR pour une modification structurante.

---

## 27. Critères exigeant une décision d’architecture

Créer ou mettre à jour une décision lorsque le changement :

- remplace Stripe;
- change l’autorité financière;
- rend PostgreSQL obligatoire ou introduit une autre base;
- extrait un package comptable;
- introduit une file externe;
- change le fournisseur de courriel;
- change le stockage média;
- ajoute un service déployable;
- modifie les frontières Web/API;
- introduit un nouvel état global;
- modifie le modèle de souveraineté ou de rétention;
- automatise des remboursements ou publications;
- introduit un agent IA ayant accès aux actions admin.

---

## 28. Frontière d’un agent IA

Un agent IA peut :

- analyser;
- proposer;
- générer un brouillon;
- classifier;
- préparer un diff;
- préparer une publication;
- préparer une réconciliation;
- expliquer une anomalie;
- exécuter des tests locaux autorisés.

Un agent IA ne peut pas, sans instruction explicite et garde-fous :

- déployer;
- rembourser;
- publier;
- supprimer;
- restaurer;
- modifier un secret;
- exécuter un backfill live;
- envoyer un lot réel de courriels;
- approuver une commandite;
- corriger automatiquement un écart ambigu.

Toute future intégration d’agent doit appliquer :

- moindre privilège;
- scopes;
- expiration;
- journal d’audit;
- confirmation humaine;
- idempotence;
- limitation de volume;
- possibilité d’annulation lorsque possible.

---

## 29. Checklist de pull request

### Portée

- [ ] Le problème et la solution sont décrits.
- [ ] Aucun changement hors portée non justifié.
- [ ] Les risques sont classés.
- [ ] Les impacts public/admin/Stripe/DB sont identifiés.

### Code

- [ ] Frontières de dépendances respectées.
- [ ] Aucun secret.
- [ ] Aucun montant flottant.
- [ ] Idempotence vérifiée.
- [ ] États d’erreur traités.
- [ ] Aucune confirmation financière côté navigateur.
- [ ] Migration ajoutée si nécessaire.

### UI

- [ ] Standalone, OnPush et signal-first.
- [ ] Accessibilité.
- [ ] i18n.
- [ ] SSR.
- [ ] Responsive.
- [ ] États complets.

### Données et sécurité

- [ ] Autorisation API.
- [ ] Audit des actions sensibles.
- [ ] Données publiques minimisées.
- [ ] PII absente des logs.
- [ ] DB non exposée.
- [ ] Validation de fichiers.

### Tests

- [ ] Tests unitaires ou d’intégration ajoutés.
- [ ] Répétition et ordre webhook testés si pertinent.
- [ ] `git diff --check`.
- [ ] `yarn format:check`.
- [ ] `yarn lint`.
- [ ] `yarn build`.
- [ ] `yarn test`.
- [ ] Toute validation omise est expliquée.

### Opérations

- [ ] Variables documentées.
- [ ] Plan de migration.
- [ ] Sauvegarde requise identifiée.
- [ ] Plan de rollback.
- [ ] Aucun déploiement ou mode live déclenché par la PR.

---

## 30. Format du rapport final d’un agent

À la fin d’une tâche, fournir :

```text
Résumé
- Ce qui a changé et pourquoi.

Fichiers
- Créés :
- Modifiés :
- Supprimés :

Décisions
- Choix architecturaux ou métier importants.

Validation
- Commandes exécutées et résultats.
- Commandes non exécutées et raison.

Données / migrations
- Migration ajoutée :
- Backfill requis :
- Impact de compatibilité :

Risques
- Risques résiduels.
- Décisions humaines requises.

Prochaine action
- Une seule recommandation concrète, si nécessaire.
```

Ne pas prétendre avoir déployé, envoyé, remboursé, restauré ou validé un environnement auquel l’agent n’a pas réellement accédé.

---

## 31. Maintenance de ce document

- Mettre les principes durables dans `docs/ARCHITECTURE.md`.
- Maintenir ici les règles exécutables, commandes, garde-fous et checklists.
- Vérifier les chemins et scripts contre le dépôt réel.
- Supprimer les références à un ancien projet lorsqu’elles ne s’appliquent plus.
- Éviter les registres gigantesques qui deviennent obsolètes; préférer des conventions et des validations automatisées.
- Toute nouvelle action envoyant des données, de l’argent, un courriel ou une publication doit déclarer :
  - son input;
  - son output;
  - son autorisation;
  - son idempotence;
  - son audit;
  - son mode d’échec;
  - son mécanisme de reprise.
- Mettre à jour `AGENTS.md` et `ARCHITECTURE.md` dans la même pull request lorsque la règle et le principe évoluent ensemble.

---

_Dernière adaptation pour `openg7-funding-platform` : 2026-07-18_
