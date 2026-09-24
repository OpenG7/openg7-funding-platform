# Contributions reçues : notifications et préparation privée

Le bouton **Contributions reçues** est disponible dans le layout administratif
partagé. Une confirmation de paiement déclenche un toast lorsque la session admin
est active. Le détail conserve les motifs du traitement, les états du courriel et
du SMS, l’historique récent et la cartouche privée destinée au site. Le dossier
commanditaire propose également **Voir la préparation**.

## Confirmation et reprise

Appliquer la migration additive
[027](../../apps/funding-api/migrations/027_create_contribution_activity.sql)
après les migrations précédentes, selon la
[procédure de migrations](database-migrations.md). Elle ne crée aucune alerte pour
les paiements historiques déjà confirmés et n’active aucun envoi.

La première confirmation et son événement d’activité sont enregistrés dans la
même transaction. Le PaymentIntent confirmé peut arriver avant Checkout : sa
preuve minimale est conservée et rapprochée lorsque la session arrive. Le retour
du navigateur ne confirme jamais le paiement. Les imports historiques restent
silencieux ; leurs appels aux repositories ne demandent pas de notification.

Ce silence persiste lors des webhooks tardifs : le marqueur de confirmation
historique n'a pas d'activité associée, donc Checkout ne remet ni suivi ni facture
en file de courriel. La facture manquante se génère par une action administrative
confirmée, sans envoi automatique. Une nouvelle confirmation en direct conserve
ses notifications. Voir la [recette historique](../technical/stripe.md#historical-payment-recovery-recipe).

Le worker d’activité passe toutes les deux secondes. Il distribue au plus 100
événements ou mises à jour par passage, enregistre les courriels dans la file
existante et traite au plus dix tentatives SMS. Un redémarrage reprend les états
persistés. Aucun fournisseur n’est appelé dans une transaction PostgreSQL ouverte.

## Courriel et SMS

Variables privées de l’API, documentées dans [.env.example](../../.env.example) :

| Variable                             | Valeur par défaut       | Effet                                                                                        |
| ------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `FUNDING_CONTRIBUTION_EMAIL_ENABLED` | `false`                 | Active le modèle `admin_contribution_received` dans la file de courriels.                    |
| `FUNDING_ADMIN_NOTIFICATION_EMAIL`   | Configuration existante | Destinataire admin ; requis et validé lorsque le courriel est activé.                        |
| `FUNDING_CONTRIBUTION_SMS_MODE`      | `disabled`              | Accepte uniquement `disabled` ou `mock`. Aucun adaptateur SMS réel.                          |
| `FUNDING_CONTRIBUTION_SMS_MOCK_URL`  | Exemple local           | URL HTTP du récepteur de simulation ; boucle locale ou nom `stripe-stub`, sans identifiants. |

La simulation SMS exige un environnement explicitement `development` ou `test`.
Elle est refusée en production. Les courriels nécessitent aussi la configuration
[SMTP](../email-smtp.md) ; le modèle admin ne remplace ni la facture ni le suivi
du contributeur.

Le SMS utilise un destinataire synthétique fixe, sans numéro de téléphone réel.
Le récepteur conserve une clé idempotente par contribution. Avant chaque tentative,
l’adaptateur recherche un reçu : une réponse perdue est réconciliée sans renvoi
si le message a été capturé. Seule une absence explicite du reçu permet l’envoi.
Après cinq tentatives non confirmées, l’état reste **réception à vérifier**, sans
nouvelle relance automatique. Le simulateur et son contrôle ne sont jamais montés
dans l’API applicative de production.

Le courriel conserve les reprises et contrôles de la file existante. Son état
« accepté par le serveur de courriel » n’atteste pas une lecture par le destinataire.
Le SMS « capturé par le simulateur » n’atteste aucun envoi réel. L’absence de
configuration est affichée explicitement et ne bloque pas les autres canaux.

## Cartouche et moteur

Les seuils proviennent de la configuration partagée. Pour une contribution
d’entreprise de 50 CAD, le worker prépare une mention Web privée. Les publications
sociales continuent d’utiliser leurs destinations, seuils et validations existants.

La préparation exige paiement actif, consentement public et nom d’entreprise.
Elle attend lorsque le moteur est arrêté. Elle signale séparément la revue et
l’image de soutien encore nécessaires à la mise en visibilité. Aucun montant ni
coordonnée privée n’entre dans le texte de reconnaissance généré.

Le bouton On / Off existant contrôle aussi cette préparation. Les notifications
de paiement continuent de fonctionner lorsque la préparation est arrêtée.
Les changements de fiche, consentement, média ou moteur sont réexaminés au passage
suivant. Une cartouche dont la source a changé n’est plus retournée comme prête
en attendant cette nouvelle analyse. La cartouche est un aperçu dérivé de la
fiche ; elle n’écrase aucun brouillon social ni modification éditoriale humaine.

Le worker ne valide pas le commanditaire et ne modifie pas sa visibilité.
L’approbation, les médias et la mise en visibilité conservent leurs conditions
et confirmations administratives. Les décisions de préparation sont versionnées,
historisées et auditées sans coordonnées privées.

## Contrat administratif

- `GET /api/admin/contribution-activity` : jusqu’à 50 activités, récentes par
  défaut. `before` charge les précédentes ; `after` rattrape les nouvelles dans
  l’ordre ; `id` charge une activité précise. Les curseurs sont des entiers positifs.
- `POST /api/admin/contribution-activity/present` : corps `{ "ids": ["1"] }`,
  au plus 50 identifiants. Réserve la présentation d’un toast pour l’acteur
  authentifié et retourne les identifiants nouvellement réservés.
- Le dossier de progression expose `preparationActivityId` lorsqu’une activité
  existe. Les paiements historiques peuvent ne pas en avoir.

Ces endpoints vérifient la session et les droits côté API. La réservation d’un
toast est permise aux lecteurs pour leur propre identité uniquement ; le client
ne fournit pas l’acteur. Les onglets du même administrateur ne réservent pas deux
fois le même toast. Le mode token partagé conserve une identité commune, sans
garantie d’attribution individuelle. Fermer le toast n’efface pas l’activité.

Le navigateur lit les nouveautés toutes les 2,5 secondes, suspend les lectures en
arrière-plan et augmente le délai après une erreur. Il conserve le contexte lors
d’un changement de page, efface les données à la déconnexion et refuse une réponse
revenue après un changement de session. Trois toasts au maximum sont présentés ;
les autres contributions restent accessibles dans l’activité paginée.

## Recette isolée

```sh
yarn test:e2e:acceptance contribution-journey-acceptance.spec.ts --project=chromium
```

Le runner crée un projet Docker unique, ignore `.env`, applique les migrations sur
une base jetable et retire uniquement ses conteneurs et réseaux. La pile comprend
le Checkout Stripe simulé, un Mailpit privé et le récepteur SMS local. Les interfaces
de contrôle du simulateur sont accessibles uniquement par son port de boucle locale.

`STRIPE_SIMULATED_CHECKOUT_ENABLED=true` active ce Checkout navigable dans la pile
de recette. Ce réglage privé est désactivé par défaut et exige un environnement
de développement/test, un hôte Stripe local autorisé et une clé de test. Il est
refusé en production ; les autres piles locales conservent leur comportement.

Le navigateur entreprise passe par le formulaire réel et le Checkout simulé.
Le navigateur administrateur observe le paiement puis le moteur OFF/ON et la
préparation. La recette vérifie les captures SMTP/SMS, le rejet d’une signature
invalide, l’unicité après rejeu, la séparation revue/publication, le clavier,
l’accessibilité du détail et l’affichage mobile. Les traces et captures restent
sous `test-results/acceptance/`, hors Git. Les intégrations de paiement complètent
la recette avec concurrence, ordre inversé, panne transactionnelle et reçu SMS perdu.

Cette recette qualifie des fournisseurs simulés. Elle ne nécessite ni clé Stripe
live, ni fournisseur SMS réel, ni publication, migration ou déploiement de production.

## Vérification du 22 septembre 2026

Sur l’arbre de travail issu de `feed17ed0861a166118a63763195a63cc6933b6d`,
avec Node 22, les deux parcours Chromium ci-dessus passent contre l’API réelle
et une base PostgreSQL jetable : admin connecté pendant le paiement et admin
absent puis reconnecté. Le second onglet ne répète pas le toast ; l’expiration
de session efface son contenu. Aucun appel applicatif n’est intercepté dans ces
deux tests. Les fournisseurs de paiement, courriel et SMS restent simulés.

Les 290 tests Node et les 99 tests de la suite d’intégration financière ont passé.
Après les derniers ajouts, les trois tests ciblés d’activité ont aussi passé :
base existante, reprises transactionnelles et SMS lent/réponse perdue. Le build
Angular avec SSR, le lint et les contrôles documentaires passent. Le build garde
un avertissement de budget initial dépassé (813,77 ko pour 800 ko ; dépassement
déjà présent avant ce changement) ; le lint garde un avertissement préexistant
dans `scripts/smoke-public.mjs`.
