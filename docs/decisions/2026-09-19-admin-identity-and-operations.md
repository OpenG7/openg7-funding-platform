# Comptes administrateurs et alertes indépendantes

Statut : implémenté, activation par configuration. Risque modéré pour le code;
l'activation et les migrations en production restent des opérations explicites.

## Décision

Le mode `FUNDING_ADMIN_AUTH_MODE=oidc` utilise OpenID Connect Authorization Code
avec PKCE, state, nonce et vérification de signature via `openid-client`.
La plateforme exige `amr: ["mfa"]` ou une valeur `acr` explicitement reconnue
comme MFA par la politique du fournisseur. Elle ne déduit pas le MFA d'un
simple mot de passe ou de deux valeurs `amr` arbitraires.

L'identité est le couple issuer/subject; le courriel n'accorde aucun accès.
Les comptes et rôles sont locaux à PostgreSQL. Les premiers propriétaires
sont provisionnés à leur première connexion depuis une liste explicite de
subjects côté serveur. Un compte déjà désactivé ou rétrogradé n'est jamais
réactivé par cette liste.

Les sessions durent une heure, sans renouvellement automatique. Le navigateur
ne reçoit qu'un cookie opaque HttpOnly, SameSite=Lax, Secure en HTTPS. La base
ne conserve que son empreinte SHA-256. Aucun token OIDC n'est persisté.
Les challenges de connexion expirent après cinq minutes et sont consommés
une seule fois. Chaque requête relit le rôle et l'état de révocation.
Les mutations exigent l'origine publique exacte pour prévenir le CSRF.

| Rôle         | Capacités                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Lecteur      | Consultation; aucun changement ni export CSV privé                                                        |
| Opérateur    | Consultation et opérations explicitement autorisées : revue, médias, publications et reprise de courriels |
| Propriétaire | Opérations, remboursements, backfill, export privé, configuration et gestion des accès                    |

Les nouvelles mutations sont refusées par défaut aux opérateurs. Les
confirmations métier existantes demeurent nécessaires. Toute modification de
compte révoque ses sessions. Les modifications sont transactionnelles avec
audit et protection contre la désactivation du dernier propriétaire.

Le mode `token` existant est conservé par défaut pour compatibilité. Il n'offre
pas les garanties nominatives/MFA du mode OIDC. En mode OIDC, le jeton racine
et les anciennes sessions signées ne donnent aucun accès.

## Exploitation

Un processus séparé interroge PostgreSQL et envoie les incidents urgents vers
un webhook HTTPS signé, sans dépendre du serveur HTTP ni du SMTP. Une table
persistante conserve épisodes, tentatives, leases et livraisons. Le récepteur
doit dédupliquer l'identifiant d'événement : HTTP ne permet pas une garantie
de livraison exactement une fois après une interruption ambiguë.

L'indisponibilité de PostgreSQL produit une alerte distincte dédupliquée en
mémoire jusqu'au rétablissement; un redémarrage peut la répéter. Une panne du
VPS ou du processus de surveillance lui-même doit être détectée depuis un
autre hôte. Ce processus n'est pas une garantie contre sa propre panne.

## Conséquences et validation

Deux migrations additives, `020` et `021`, sont requises. Le Web et l'API
OIDC doivent partager une origine. Les journaux des proxys doivent exclure
les paramètres du callback et les cookies; la configuration fournie retire
les chemins des logs Traefik et désactive les accès API détaillés dans Nginx.

Les tests utilisent un fournisseur OIDC local signant réellement ses ID
tokens, PostgreSQL jetable, un récepteur webhook local et les navigateurs.
La recette du fournisseur d'identité de l'organisation reste nécessaire
avant activation : MFA, subjects, logout/révocation et politique ACR.

Référence : [flux officiel openid-client](https://github.com/panva/openid-client/blob/main/examples/oidc.ts).
