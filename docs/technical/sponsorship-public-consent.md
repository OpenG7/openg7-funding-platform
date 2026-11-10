# Enregistrer un consentement public documenté

Funding permet à un opérateur ou propriétaire d’enregistrer un accord déjà reçu
pour le nom et la présentation du profil public d’un commanditaire. Cette
commande complète le consentement recueilli à Checkout sans réécrire son
historique. Une validation administrative ne remplace pas le consentement.

## Parcours administratif

Dans la zone **Consentement public** de l’atelier, **Demander le consentement**
ouvre un courriel privé préparé en français ou en anglais. L’opérateur ou le
propriétaire vérifie le destinataire enregistré, adapte l’objet et le message,
puis confirme l’envoi. La demande sollicite une réponse explicite pour le nom
et la présentation de l’organisation; ni le paiement ni le silence ne valent
accord. Elle est disponible pour une commandite payée, sans remboursement en
cours, non refusée, sans consentement et avec une adresse de contact valide.
Un dossier déjà complet peut aussi nécessiter cette demande.

La commande réutilise la [file et les reçus de demande de renseignements](assistant-information-receipts.md)
avec la finalité `public_consent`. Le serveur revalide état, adresse et version;
mise en file, déduplication, audit et reçu restent transactionnels. Une réponse
incertaine exige une recherche explicite du reçu, sans nouvel envoi automatique.
Le statut en file ou envoyé ne change aucun consentement, prérequis ou droit de
publication. Après une réponse favorable réellement reçue, l’équipe consigne
l’accord et sa preuve par l’action suivante.

Dans l’[atelier d’examen](preflight-examination.md), **Compléter les prérequis**
affiche les contrôles du serveur et leurs actions. Le contrôle du consentement
ouvre un formulaire limité au dossier sélectionné. Il demande :

- la référence privée d’une preuve de l’accord reçu, de 1 à 1 000 caractères;
- la date réelle de l’accord, au format civil `YYYY-MM-DD`;
- l’attestation que l’accord couvre le **nom et la présentation du profil public**;
- la confirmation explicite du récapitulatif avant enregistrement.

La date ne peut pas être future dans le fuseau `America/Toronto`. Le serveur
détermine l’acteur et l’instant d’enregistrement. Une référence peut désigner un
document ou un échange conservé par l’équipe; Funding ne télécharge pas son
contenu. Le formulaire ne constitue ni un dépôt de preuve, ni une collecte de
signature. Il n’atteste pas de droits d’image ou de publication sur un réseau
social et n’enregistre pas un retrait de consentement.

## Contrat et droits

Le contrat public réside dans
[`admin-sponsorship-consent.ts`](../../packages/funding-core/src/admin-sponsorship-consent.ts).
Les routes `/api/admin/…` et leurs alias `/admin/…` exigent la session
administrative existante, avec les protections d’origine des mutations.

| Route                                                                               | Effet et accès                                                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/sponsorships/consent?sponsorshipId=<uuid>`                          | Résumé versionné pour le lecteur; historique privé et capacité d’enregistrement pour l’opérateur ou propriétaire. |
| `POST /api/admin/sponsorships/consent/record`                                       | Enregistrement confirmé, réservé à l’opérateur ou propriétaire.                                                   |
| `GET /api/admin/sponsorships/consent/receipt?sponsorshipId=<uuid>&requestId=<uuid>` | Réconciliation sans écriture, réservée à l’acteur de la commande encore autorisé.                                 |

Le résumé expose `effectiveConsent`, `source` (`checkout`,
`documented_agreement` ou `none`), `version`, `scope`, `canRecord` et
`recordBlockers`. Un lecteur ne reçoit ni référence de preuve ni identité des
acteurs privés. L’historique privilégié est limité aux 50 derniers accords.

La commande transmet `contributionId`, `expectedVersion`, `requestId` UUID,
`agreementReceived: true`, `scope: "public_profile_name_and_presentation"`,
`agreedOn`, `evidenceReference` et `confirmed: true`. Le serveur valide les
champs, les droits, la version, l’état du dossier et les effets en cours avant
toute mutation. Un consentement déjà accordé n’appelle pas un nouvel accord.

## Version, audit et reprise

L’accord, son audit et son reçu sont enregistrés dans une seule transaction.
La preuve et l’acteur restent dans le registre privé; aucune référence de
preuve n’entre dans les contenus publics. Le reçu immuable identifie la
commande, le dossier, l’accord, la nouvelle version et l’acteur. Il confirme
`effectiveConsent: true` et `publicVisibilityHeld: true`.

Un rejeu reconnu avec le même acteur et la même charge restitue le reçu, même
si la version a avancé. Réutiliser l’identifiant avec un autre acteur ou contenu
est refusé. Une version devenue obsolète entraîne une relecture explicite et
une nouvelle décision humaine.

Après une réponse incertaine, l’interface conserve seulement les identifiants
nécessaires à la réconciliation, jamais la preuve ni les champs du formulaire.
Elle propose de rechercher le reçu; elle ne rejoue pas automatiquement le
POST. Un changement de dossier, d’acteur ou de droits purge le contexte privé.
Un reçu `not_found` n’est pas présenté comme un accord enregistré.

## Séparation des autorisations

L’enregistrement place la visibilité du profil en attente. Il ne publie pas de
contenu, n’envoie pas de message et n’approuve ni le dossier, ni son texte, ni
la préparation examinée. L’atelier relit la version exacte et laisse chaque
autre prérequis à compléter par son parcours propriétaire.

Les empreintes dépendantes incluent l’identité du nouvel accord, sans sa preuve.
Les autorisations de livraison devenues obsolètes sont invalidées, y compris
pour les livraisons qui référencent directement un média ou une photo du dossier.
Les opérations en cours ou de résultat incertain bloquent l’enregistrement
avant mutation et doivent être réconciliées par leur propriétaire. Les
livraisons déjà publiées conservent leur historique.

## Schéma et validation

La migration
[`067_documented_sponsorship_consent.sql`](../../apps/funding-api/migrations/067_documented_sponsorship_consent.sql)
ajoute le registre append-only et son raccordement aux empreintes de modération.
Les grants du rôle API autorisent lecture et insertion, sans modification ni
suppression. Suivre le [runbook des migrations](../operations/database-migrations.md).
Elle ne déduit aucun accord ancien et ne change aucune contribution à son
application. Les empreintes des dossiers dépourvus de nouvel accord restent
identiques.

L’[activation locale de 067](../operations/documented-consent-activation.md)
consigne la sauvegarde restaurée, les contrôles de configuration et la santé API.

Les suites dédiées couvrent les contrôles HTTP et de politique, puis les effets
transactionnels PostgreSQL sur une base de test isolée : concurrence, rejeu,
audit atomique, registre immuable, maintien privé et invalidations. Les parcours
navigateur utilisent des données synthétiques et vérifient aussi l’absence de
POST avant confirmation, les droits et la réconciliation après erreur réseau.
