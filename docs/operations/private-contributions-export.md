# Export privé des contributions

Depuis `/admin/fundraiser/contributions`, filtrer la liste, vérifier le nombre
de résultats, puis choisir **Export CSV** et confirmer. Le fichier contient
exactement les dossiers affichés après filtrage. La liste est limitée aux
250 contributions les plus récentes; cet export n'est pas une extraction
exhaustive de l'historique. Un lien direct `?contributionId=<uuid>` permet aussi
d'ouvrir et d'exporter un dossier plus ancien.

Le rôle propriétaire est requis côté API. Lecteurs et opérateurs peuvent
consulter la liste mais ne peuvent pas exporter, même en appelant directement
l'endpoint. Une session absente ou expirée est refusée. En mode jeton, les
droits restent ceux du mode administratif historique; voir le
[contrat d'identité](admin-identity-and-alerts.md).

## Contrat et concurrence

`POST /api/admin/contributions.csv` (alias `/admin/contributions.csv`) accepte
un JSON avec `confirmation: "export_private_contributions"` et `contributions`,
une liste de 1 à 250 objets `{ id, expectedVersion }`. `expectedVersion` reprend
sans transformation le champ `updated_at` renvoyé par la liste. Les doublons,
champs inconnus, UUID invalides et sélections vides ou trop grandes sont refusés.
Le corps est borné à 64 Kio.

La sélection est figée lors de l'ouverture de la confirmation. Le serveur relit
les dossiers sous verrou partagé, vérifie leurs versions exactes, génère le CSV
et inscrit l'audit dans la même transaction. Un dossier absent ou modifié renvoie
`409 export_selection_changed` : actualiser, vérifier puis confirmer à nouveau.
Une panne d'audit empêche la réponse CSV. Aucun fichier partiel n'est présenté
comme un succès et aucun téléchargement automatique n'est relancé après échec.

La réponse réussie porte `Cache-Control: private, no-store`, un nom de fichier
constant et un `X-Request-Id` corrélable à l'audit. Les erreurs utilisent 400
(requête invalide), 401 (session absente/expirée), 403 (rôle/origine refusés),
405 (méthode), 415 (content type), 409 (sélection modifiée) ou 503 (indisponibilité).
Le précédent GET sans confirmation ne fournit plus de données. API et Web
doivent être livrés ensemble; les clients automatisés doivent fournir le POST
confirmé et les versions lues. Aucune nouvelle migration n'est requise.

## Contenu et traçabilité

Les colonnes privées existantes sont conservées : identifiants, référence,
type/statut, montant/devise, dates, noms, courriels, consentements, états de revue
et de publication, références Stripe. Les notes administratives, jetons de suivi
et payloads Stripe ne sont pas inclus. Le montant et la devise restent par ligne;
aucune addition entre devises n'est effectuée.

Les champs sont entourés de guillemets; les guillemets internes sont doublés,
les virgules et retours à la ligne sont conservés. Les textes commençant par un
préfixe de formule ou un contrôle sont précédés d'une apostrophe, y compris les
variantes pleine largeur. Cette transformation du CSV ne modifie pas les valeurs
en base. Comme le décrit [OWASP](https://owasp.org/www-community/attacks/CSV_Injection),
l'interprétation après réenregistrement dépend du tableur; la recette vérifie
les octets exportés, pas toutes les versions d'Excel ou de LibreOffice.

L'action `contributions.export` inscrit l'acteur, la date, `requestId`, le résultat
`generated`, le nombre de dossiers, le périmètre `displayed_selection` et une
empreinte de la sélection versionnée. Elle ne recopie ni noms, ni courriels, ni
texte de recherche. `generated` atteste la génération autorisée avant réponse,
pas l'enregistrement du fichier sur l'ordinateur. Une nouvelle demande confirmée
produit une nouvelle entrée d'audit; elle ne change aucun fait financier.

## Recette locale

```sh
yarn test
node --test tests/integration/private-contributions-export.integration.mjs
yarn workspace @openg7/funding-web build --configuration production
node node_modules/@playwright/test/cli.js test --config tests/playwright-identity.config.mjs private-contributions-export.spec.ts
```

PostgreSQL est jetable, le fournisseur OIDC signé est local et les données sont
synthétiques. Le parcours vérifie le filtrage, l'annulation, la confirmation au
clavier, une modification concurrente d'une microseconde, une panne d'audit,
le fichier téléchargé, les refus lecteur/opérateur et l'expiration de session
pendant la confirmation. Il couvre FR/EN et un écran de 390 px. Les intégrations
vérifient aussi une sélection ancienne au-delà de la fenêtre des 250 dossiers.
Les résultats sont conservés dans `test-results/identity/`.
