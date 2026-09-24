# Bâtisseurs et aide aux contributeurs

`/batisseurs` et `/en/batisseurs` utilisent maintenant
`GET /api/public/builders?page=1&pageSize=12`. La réponse contient `data_source`,
`builders`, `last_updated_at` et `pagination` (`page`, `page_size`, `total_count`).
Sans paramètres, l'API retourne 24 entrées; les pages sont limitées à 50 entrées
et le numéro de page à 100 000. Les paramètres invalides ou répétés donnent 400.

Les pages et leur total utilisent une même requête PostgreSQL et les mêmes
filtres : contribution payée, remboursée ou contestée, nom non vide et consentement
public; une commandite exige aussi une approbation. La politique de visibilité
des remboursements et contestations est conservée. Le montant a son propre
consentement et chaque entrée conserve sa devise. Le total compte des dossiers
de contribution, pas des personnes uniques. L'identifiant public est un hash
avec un préfixe propre à l'annuaire; ce n'est pas un jeton d'accès.

La projection financière conserve `public_builders` comme aperçu de 24 entrées.
Ses calculs ne sont pas modifiés. Le nouvel annuaire ne dépend pas de son
chargement; un lien mène aux données financières. Il n'affiche aucun faux zéro
pendant le chargement, en cas d'erreur ou sans source PostgreSQL. Le prérendu
conserve un état inconnu avec une explication sans JavaScript. L'actualisation
efface les anciennes entrées pour ne pas conserver un consentement retiré après
un échec. Les requêtes expirent à 15 secondes et sont annulées à la navigation.
La pagination restaure le focus et propose la première page après une réduction
du registre. Comme pour les commanditaires, des modifications simultanées peuvent
déplacer des entrées entre deux requêtes de pagination.

`/support` et sa version anglaise présentent d'abord la recherche de contribution,
le suivi de commandite et le contact déjà utilisé par les courriels du projet
(`contact@openg7.org`). La récupération par courriel se déplie directement sous
la recherche, via « Je ne connais pas ma référence ». Les formulaires partagent
la même présentation sombre; le composant de récupération commanditaire conserve
sa présentation habituelle sur les autres pages. Les liens internes conservent
la langue et le focus.

Une FAQ propose les étapes suivantes pour un paiement en attente, un courriel
non reçu, une facture de commandite et une demande de remboursement. Les quatre
actions techniques renvoient au catalogue traduit existant `/ecosystem#platforms`,
à deux formulaires GitHub de signalement/suggestion et au guide `CONTRIBUTING.md`
du dépôt de financement. Elles n'envoient aucun message automatiquement.
Un lien de contact par courriel reste disponible dans cette section pour les
personnes sans compte GitHub ou sans droit de créer une issue.

La [politique d’utilisation et de remboursement](usage-refund-policy.md) décrit
la revue au cas par cas, les démarches, les délais bancaires indicatifs et les
conditions de visibilité. Elle renvoie vers la recherche de référence et le
contact de cette page, dans la langue sélectionnée.

Les trois formulaires expirent après 15 secondes, annulent leur requête lors
de la navigation et permettent une reprise sans effacer la saisie. Une requête
déjà partie peut néanmoins avoir été traitée par le serveur; les réponses de
récupération restent conditionnelles et ne révèlent pas l'existence d'un dossier.
Le Web vérifie `accepted: true` avant d'afficher la prise en compte d'une demande
de récupération. Cette prise en compte ne garantit ni une correspondance ni la
livraison d’un courriel. Aucune publication ni confirmation de paiement n'est ajoutée.

## Références publiques et accès privé

`POST /api/reference-lookup` reçoit `{ "reference": "OG7-2026-ABC123" }` et
retourne uniquement statut, type, dates, devise, montant selon son consentement,
état de revue/soumission et prochaine étape. La référence n’autorise aucune
lecture ou modification du dossier privé. Une commandite renvoie vers la
récupération distincte du lien de suivi.

`POST /api/reference-recovery` reçoit une adresse `email`, normalisée en minuscules
et sans espaces aux extrémités. Les adresses invalides donnent 400. Après une
recherche réussie en base, une adresse connue ou inconnue reçoit toujours
`202 { "accepted": true }`, y compris si la mise en file du message échoue.
L’erreur de courriel est consignée sans adresse ni contenu privé. Une indisponibilité
de la base pendant la recherche reste une erreur de service; la réponse uniforme
ne prétend pas masquer toute différence de délai entre requêtes.

Le courriel contient au maximum les 25 références les plus récentes associées
au courriel du paiement **ou au contact enregistré du dossier**, avec leurs
montants et statuts. Il ne contient pas de jeton privé ni de note du dossier.
La déduplication utilise l’adresse normalisée et l’heure UTC : plusieurs demandes
dans la même tranche horaire partagent un message. Un échec avant l’insertion
permet une nouvelle tentative; un message déjà persisté conserve sa file et ses
reprises habituelles. Les limites IP existantes restent applicables.

La récupération du **lien privé**, séparée, utilise uniquement l’adresse du paiement
et les critères décrits dans le [guide du suivi](sponsorship-access-and-drafts.md).
Le courriel de références reste actuellement en français; les interfaces Support
et de récupération du lien privé sont disponibles en FR/EN.

## Recette de récupération des références

La recette `tests/playwright/reference-recovery-acceptance.spec.ts` couvre les
scénarios 9 et 10 de l’[inventaire](development/end-to-end-scenarios-inventory.md)
avec une contribution privée de 25 CAD et une commandite de 250 CAD pour la même
adresse, puis une contribution témoin de 10 CAD pour une autre adresse.
Tous les paiements proviennent du formulaire et d’une confirmation Stripe signée
locale. L’entreprise sauvegarde sa fiche, puis ferme l’onglet avant la récupération.

```sh
yarn test:e2e:acceptance reference-recovery-acceptance.spec.ts --project=chromium
```

La recette vérifie la réponse conditionnelle identique lors d’un échec réel de
l’insertion du courriel, puis la reprise avec un seul message capturé dans Mailpit.
Deux rejeux concurrents et une nouvelle demande en anglais ne créent pas de
doublon. Seules les deux références de l’adresse demandée apparaissent dans le
courriel. Support est parcouru en français à 390 px et en anglais à 1280 px :
champs invalides, référence inconnue, montant masqué, statut serveur et raccourci
vers la récupération du suivi privé. La référence seule n’ouvre jamais la fiche.

Un second courriel, obtenu par la récupération privée, restaure le brouillon et
permet sa soumission. La revue reste en attente et la fiche reste privée. Facture,
PDF et totaux restent identiques après les récupérations et les rejeux de paiement.
Le test PostgreSQL `reference-recovery.integration.mjs` vérifie également la
limite de 25 résultats, le tri, l’adressage et les champs publics autorisés.

L’API, PostgreSQL et la file de courriels sont réels dans une pile Docker jetable;
Stripe et SMTP sont simulés. La panne SQL cible uniquement le destinataire et le
template de cette recette, sans modifier de fait financier. Les résultats,
captures et preuves sont sous `test-results/acceptance/`. La CI découvre ce test
automatiquement. Aucun envoi réel, migration ou déploiement n’est requis.

Preuve du 24 septembre 2026 à 21:02 UTC, sur `7dd6050` avec les changements
locaux : **1 parcours Chromium FR/EN réussi en 18,8 secondes**, sans échec, test
ignoré ou instable. L’exécution sur l’ancienne API reproduit 502 au lieu de 202
lors de la panne SQL ciblée. **296 tests Node et 2 intégrations PostgreSQL**
réussissent, ainsi que TypeScript, lint et builds API/Web. Les avertissements
préexistants du lint et du budget Angular subsistent. La pile jetable est supprimée.

## Accessibilité et contrôles UI

Les champs invalides exposent `aria-invalid`; les zones `role="status"` restent
dans le DOM pour annoncer les mises à jour. Les accordéons natifs sont utilisables
au clavier. Les dates et montants de recherche suivent la langue sélectionnée;
les dates utilisent UTC.

Le bandeau utilise des WebP responsives : environ 150 Ko pour les deux variantes
960 px, contre 4,97 Mo pour les PNG précédents (poids des fichiers, hors cache).
Les variantes les plus grandes totalisent environ 441 Ko. Régénérer la carte avec
`yarn images:support`; les variantes du dragon sont produites par
`yarn images:funding-home`. Les PNG restent disponibles pour les autres pages.

Validations : `yarn test`, `node --test tests/integration/public-builders.integration.mjs`
et `yarn test:ui:public-journeys`. Cette dernière couvre Chromium, Firefox,
WebKit et un iPhone émulé, les erreurs/reprises, les homonymes, la navigation FR/EN,
les contrôles axe, la largeur 320 px et l'agrandissement des polices.
`support-page.spec.ts` ajoute les recherches invalides/introuvables, le statut
confirmé uniquement par l'API, les pannes réseau/serveur, les délais dépassés,
les annulations à la navigation, les réponses privées uniformes, la FAQ au clavier,
les liens techniques, les images et les formulaires ouverts en erreur.
WebKit émulé n'atteste pas un test sur un iPhone physique. L'agrandissement CSS
n'atteste pas le zoom natif et axe ne remplace pas un lecteur d'écran humain.

Aucune migration ni backfill. Le Web et l'API doivent être livrés ensemble pour
le nouvel endpoint; un ancien serveur produit un état d'erreur avec reprise.
