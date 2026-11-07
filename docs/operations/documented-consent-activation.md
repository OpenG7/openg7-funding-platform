# Activation locale du consentement documenté

Mise à jour effectuée le **7 novembre 2026, vers 18 h 51 America/Toronto**
(23 h 51 UTC), dans `C:\GitHub\openg7-funding-platform`, sur `https://localhost`.
La migration **067** est appliquée et l’API est saine sous Node **22.23.3**.
Le Web de développement et OIDC répondent en HTTPS avec la CA locale existante.

Cette opération complète l’[activation de la galerie](intelligent-media-gallery-activation.md).
Elle installe le [consentement documenté](../technical/sponsorship-public-consent.md)
et son parcours dans l’[atelier d’examen](../technical/preflight-examination.md).
Le nouveau registre contient **zéro accord** après activation; aucun consentement
ni aucune approbation de dossier réel n’a été enregistré.

## Sauvegarde et contrôles préalables

Après une suspension de l’hôte pendant la recette, les vérifications ont été
refaites : **7 669 tests Node réussis, 8 ignorés, aucun échec**, **63/63 parcours
UI**, **9 tests PostgreSQL nouveaux et 13 de régression**, compilation
TypeScript/UI et Angular production avec 25 routes. Lint ciblé, format et
documentation complètent ces validations.

Une sauvegarde fraîche a été restaurée et comparée table par table à son
snapshot source : **95 tables, 22 256 lignes**, schéma **66**. Le dump PostgreSQL
custom est resté en mémoire; seule son archive chiffrée **Windows DPAPI
CurrentUser** a été conservée hors Git sous ACL privée. La restauration utilise
PostgreSQL 16 jetable, sans réseau, ports, API ou worker. Seul ce conteneur de
vérification a été supprimé.

- Archive chiffrée : **1 186 166 octets**.
- SHA-256 : `58a2f57d5d0f2df1cf9faf69505b2694cb029d413fce28d3d1b78c9ffd311a74`.
- Portée : **DB seule**, sans copie des objets OVH ni de la configuration.
- Déchiffrement vérifié; la reprise exige le même profil Windows.

Les artefacts et manifestes privés sont conservés hors Git. Leurs chemins ne
sont pas publiés dans ce document.

## Migration et remplacement de l’API

Les six couches Compose précédentes ont été conservées dans leur ordre.
Le plan privé a comparé environnement, commande, utilisateur, montages,
réseaux, TLS, labels et paramètres d’exécution : aucun réglage métier modifié.
Le secret technique Preflight existant a été réutilisé sans afficher son
contenu. Le hash Compose et l’image PostgreSQL restent identiques.

Après arrêt de la seule API, le runner canonique
[`scripts/db-migrate.mjs`](../../scripts/db-migrate.mjs) a vérifié l’historique,
appliqué uniquement `067_documented_sponsorship_consent.sql`, puis confirmé
l’absence de migration en attente. PostgreSQL et les autres conteneurs ont
conservé leurs identifiants et dates de démarrage. Aucun seed ou provisionnement
d’identité n’a été lancé.

L’image API a été construite depuis le checkout actif pour préserver ses
fonctionnalités existantes. La recréation cible uniquement `api` avec
`--no-deps --no-build`. Son identifiant est
`sha256:7a6107d20cf1696fb9246d7daf91a85ea5fa9b7244ac6ee071b6a71a722285df`.
L’alias `openg7-funding-api:local` désigne cette image; la précédente reste sous
`openg7-funding-api:before-documented-consent-ae0b86bb`.

## Résultat et reprise

Après activation : API `healthy`, schéma **67**, garde d’accès du registre
valide, quota photos **20** et zéro accord enregistré. HTTPS renvoie **200**
pour OIDC et le client Vite; la route privée de consentement refuse une lecture
sans session avec **401**.

Avant/après : **45 courriels**, zéro courriel éligible ou en cours, zéro
nettoyage, zéro publication en cours, un courriel incertain et cinq échecs
épuisés conservés. Aucun envoi ni nettoyage déclenché pour cette activation.
Les quatre flux sociaux restent en pause, fournisseur `disabled`, worker
persistant actif en version 2. La préparation privée automatique reste
configurée; quatre flux sont dus au relevé suivant le redémarrage. Le rappel
du jour UTC possède déjà son reçu.

Le développement utilise toujours le compte propriétaire de migrations;
aucun rôle runtime dédié n’a été configuré. Une opération de production
exige une instruction distincte.

Pour toute reprise, relire le plan et le registre avant de relancer le runner.
La migration appliquée est immuable. Revenir à l’image précédente ne retire
pas le schéma 067 et ne restaure pas la base. Suivre le
[runbook PostgreSQL](database-migrations.md) et préserver les résultats incertains;
aucune restauration ou relance d’un effet externe n’est automatique.
