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
la récupération des références, le suivi de commandite et le contact déjà utilisé
par les courriels du projet (`contact@openg7.org`). Les liens internes conservent
la langue et le focus. Les dépôts GitHub restent accessibles ensuite pour les
questions techniques. Les endpoints de récupération et leur réponse uniforme
restent inchangés. Aucune publication ni confirmation de paiement n'est ajoutée.

Validations : `yarn test`, `node --test tests/integration/public-builders.integration.mjs`
et `yarn test:ui:public-journeys`. Cette dernière couvre Chromium, Firefox,
WebKit et un iPhone émulé, les erreurs/reprises, les homonymes, la navigation FR/EN,
les contrôles axe, la largeur 320 px et l'agrandissement des polices.
WebKit émulé n'atteste pas un test sur un iPhone physique. L'agrandissement CSS
n'atteste pas le zoom natif et axe ne remplace pas un lecteur d'écran humain.

Aucune migration ni backfill. Le Web et l'API doivent être livrés ensemble pour
le nouvel endpoint; un ancien serveur produit un état d'erreur avec reprise.
