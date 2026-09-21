# Consignes Funding API

Complète le [socle du dépôt](../../AGENTS.md). Les règles de domaine indiquées
dans sa table de lecture s'appliquent aussi aux adaptateurs et aux tests.

## Responsabilité et contrats

L'API Node/TypeScript ESM est seule autorisée à combiner les faits Stripe avec
l'état OpenG7 : Checkout, webhooks, persistance, administration, transparence,
courriels, médias, factures, remboursements, publications et réconciliation.
Dépendances : transport HTTP/jobs → services applicatifs → domaine → ports →
adaptateurs Stripe/PostgreSQL/courriel/stockage/PDF. Ne pas enfermer les règles
métier dans le routeur ou SQL; normaliser les objets fournisseur dans l'adaptateur.

- Valider méthode, content type, taille, schéma, types, enums, montant, devise,
  autorisation, corrélation et origine lorsque pertinente. Aucun calcul navigateur
  n'est autoritaire. Refuser par défaut.
- Erreurs : statut HTTP adapté, code stable, message exploitable par le Web et
  corrélable aux logs; distinguer validation, conflit, autorisation, indisponibilité
  fournisseur et erreur interne, sans secret ni trace interne dans la réponse.
- Checkout, webhooks, remboursements, factures/avoirs, publication, retry, import et
  backfill doivent être idempotents. Même clé et payload : même résultat logique;
  payload incompatible : conflit explicite.
- Changement de contrat : mettre à jour producteur, consommateurs, modèles, tests
  et documentation ensemble; documenter la transition et la compatibilité requise.

## Persistance

Clés primaires stables, contraintes uniques sur identifiants Stripe et clés
d'idempotence, dates UTC, montants entiers/devise explicite, états explicites,
public/privé séparables, métadonnées minimales et index motivés par les requêtes.
Archiver ou supprimer logiquement lorsque la piste d'audit doit être conservée.

Créer la prochaine migration numérotée, déterministe et additive; prévoir les
données existantes, les verrous/durées, la vérification et les étapes manuelles.
Lire la [procédure de migrations](../../docs/operations/database-migrations.md)
avant toute modification du schéma ou exécution, y compris sur base existante.

Les écritures liées sont atomiques : événement/normalisation, état de remboursement,
avoir/journal, publication/audit, réparation de réconciliation. Découpler les
effets externes par un état persistant ou une file : aucun envoi dans une transaction
DB ouverte. Ne pas prétendre rendre atomiques un fournisseur externe et PostgreSQL;
prévoir reprise et état incertain pour les résultats partiels.

## Administration et audit

Lire le [runbook identité](../../docs/operations/admin-identity-and-alerts.md) pour
authentification, rôles ou sessions. OIDC : MFA vérifié chez le fournisseur, cookie
HttpOnly, sessions révocables en DB (migration 020), droits et origine vérifiés
côté API; aucun contournement par secret racine ni assertion MFA navigateur.
En mode `token`, échanger le secret racine contre une session signée et limitée;
vérifier l'expiration côté API et invalider proprement la session. Ne jamais
exposer le secret dans setup, bundle ou URL, ni attribuer à ce mode les garanties OIDC.

Les confirmations UI requises pour les actions sensibles sont aussi validées
côté serveur. Auditer acteur/type, action, cible, date, résultat, corrélation,
métadonnées minimales et raison lorsque requise. Corréler requêtes, événements
Stripe, Checkout, PaymentIntent, contributions, audits et réconciliations.
Logs : type, statut, durée, code sûr, identifiant non secret/tronqué et compteurs.
Exclure secrets, signatures, corps privés/webhooks bruts, carte, tokens de suivi
et coordonnées privées inutiles, URL de base et chemins de sauvegarde privés.

Le [pilotage](../../docs/operations/admin-pilotage.md) réutilise les services de
domaine. Toute commande exige identifiant de requête, cible/version, confirmation,
rôle API et reçu audité; les dépenses restent réservées au propriétaire. Aucun
rejeu automatique d'un reçu incertain ni mutation depuis le registre de l'assistant
IA. Vérifier les préconditions de la migration 024 avant activation.

## Validation

Appliquer la [matrice commune](../../docs/development/validation.md), notamment
les scénarios de signature, répétition, ordre, reprise et autorisation du domaine
touché. Préserver `/health` et ne pas masquer une erreur par un faux succès.
