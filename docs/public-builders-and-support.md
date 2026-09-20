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

Les trois formulaires expirent après 15 secondes, annulent leur requête lors
de la navigation et permettent une reprise sans effacer la saisie. Une requête
déjà partie peut néanmoins avoir été traitée par le serveur; les réponses de
récupération restent conditionnelles et ne révèlent pas l'existence d'un dossier.
Le Web vérifie `accepted: true` avant d'afficher la prise en compte d'une demande
de récupération. Les endpoints, leur idempotence et leur réponse uniforme sont
inchangés. Aucune publication ni confirmation de paiement n'est ajoutée.

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
