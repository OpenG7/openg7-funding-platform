# Annuaire public des commandites

Les routes `/commanditaires` et `/en/commanditaires` présentent les fiches publiques de commandite. La page Angular orchestre la lecture et la pagination; l’API décide quelles fiches sont admissibles. La liste précède les explications sur mobile. Le template et les styles restent locaux à cette page.

## Chiffres et pagination

`GET /api/public/sponsorships?page=1&pageSize=12` accepte une page entière de 1 à 100 000 et une taille de 1 à 50. Sans paramètres, le comportement historique est conservé : première page de 50 fiches. Les paramètres invalides ou répétés retournent HTTP 400. La page Web demande 12 fiches à la fois.

Le champ optionnel `pagination` contient `page`, `page_size`, `total_count` et `published_count`. Les totaux portent sur toutes les fiches admissibles, et non sur la page reçue. Le total et la sélection utilisent les mêmes filtres dans une seule requête SQL. L’ordre combine la date de visibilité/revue/paiement existante et un identifiant comme départage stable. Une page hors limites conserve les totaux et retourne une liste vide; l’interface permet de revenir à la première page.

Les indicateurs représentent des **fiches de commandite**, pas des entreprises distinctes. Une entreprise peut avoir plusieurs dossiers. `published_count` compte les fiches au statut `published` disposant d’un lien HTTPS de publication; plusieurs fiches peuvent référencer une publication collective. Il ne compte ni les messages distincts ni les réseaux sociaux et ne vérifie pas la disponibilité du site externe.

Le champ optionnel `public_id` est une clé stable dérivée de l’identifiant du dossier. Il évite les collisions entre entreprises homonymes, sans exposer une référence de paiement ou un moyen d’accès au suivi. Ce champ n’est jamais une autorisation. Les anciens serveurs restent lisibles sur leur première page : le nombre de fiches reçues est affiché, les totaux restent inconnus et aucune pagination fictive n’est proposée.

## Visibilité et confidentialité

Une fiche exige le consentement public, l’approbation administrative, un nom d’entreprise et une image de présentation approuvée non supprimée. Les montants individuels restent absents sans consentement d’affichage du montant. Les contacts, notes administratives et références Stripe ne font pas partie de la projection.

Le message du suivi commanditaire (`sponsor_message`) reste privé. Seul le
résumé public saisi par l’admin (`public_summary`) décrit l’entreprise dans
l’annuaire. Le champ historique `message` reste présent avec la valeur `null`
pour compatibilité ; le Web ne l’affiche pas, même face à un ancien serveur.
Une fiche sans résumé public n’affiche aucun texte de remplacement issu du suivi.

La règle existante sur les paiements est conservée : `paid`, `refunded` et `disputed` peuvent être admissibles. Un remboursement ou une contestation ne retire donc pas automatiquement la reconnaissance publique si les autres critères restent satisfaits. L’annuaire ne présente pas ces fiches comme un solde actuel ni comme une preuve d’absence de remboursement. Le retrait du consentement ou de l’approbation retire la fiche des résultats suivants. Une modification de cette politique exige une décision métier distincte.

La page met en avant la présentation de l’entreprise et les publications disponibles. Les états internes « planifié », « brouillon » et « non planifié » ne sont plus affichés. Le suivi détaillé reste dans le parcours privé de commandite. L’API ne retourne le lien de publication qu’au statut `published`; les autres champs historiques de planification restent présents pour compatibilité. Les liens externes rendus utilisent HTTPS, sans identifiants intégrés dans l’URL, avec un nom accessible et l’annonce d’un nouvel onglet.

## États et parcours

Chargement, erreur réseau et source `empty` affichent des compteurs inconnus (`—`). Seule une lecture valide de la base permet d’affirmer qu’il n’existe aucune fiche publique. Le pré-rendu ne charge pas l’API et ne conclut jamais que l’annuaire est vide; un message informe les visiteurs sans JavaScript.

Une requête expire après 15 secondes et peut être réessayée. La navigation annule la requête. L’actualisation est manuelle et retire les anciennes fiches pendant la lecture : après un échec, une fiche dont le consentement aurait été retiré ne reste pas présentée comme actuelle. Le focus revient au titre de l’annuaire après un changement de page. Les erreurs et les résultats sont annoncés aux technologies d’assistance.

« Devenir commanditaire » mène à `/fonds-des-batisseurs?intent=sponsorship#support`, dans la langue courante. Cet intent présélectionne le type entreprise uniquement après confirmation de son activation par la configuration serveur. Un choix personnel explicite du visiteur est conservé si cette configuration arrive tard. L’intent n’accorde aucun consentement, ne lance pas Checkout et ne confirme jamais un paiement.

« Retrouver ma commandite » mène au suivi existant, qui propose la récupération d’accès sans exposer de token dans le lien public. Une arrivée sans token ni accès mémorisé présente directement la récupération, sans annoncer un lien invalide; les liens explicitement invalides conservent leur état d’erreur. Les liens vers les bâtisseurs, la transparence, les conditions et le contact conservent la langue.

## Médias et validation

`yarn images:sponsors` génère deux variantes WebP (960 et 1920 pixels) à partir du PNG du bandeau. Le navigateur choisit la variante par `srcset`. Les logos et photos des fiches sont différés; une erreur de logo affiche les initiales et une photo indisponible est retirée.

```sh
yarn test
yarn lint
yarn exec tsc --noEmit -p tsconfig.json
node --test tests/integration/public-sponsors.integration.mjs
yarn test:ui:sponsors
```

La suite navigateur sert le build pré-rendu local et intercepte les API; elle couvre FR/EN sur ordinateur et mobile, pagination, erreurs/reprise/expiration, liens, clavier, images cassées, anciens contrats, présélection du formulaire et SSR sans JavaScript. Les tests PostgreSQL utilisent une base jetable locale, sans `.env` ni données de production, pour vérifier les filtres, la confidentialité, les totaux, les 57 fiches, les homonymes et les remboursements/contestations. La CI d’acceptation inclut la suite UI et découvre la nouvelle suite d’intégration.

Aucune migration, nouvelle dépendance, variable d’environnement ou opération de production n’est nécessaire. La pagination par décalage n’est pas un instantané entre plusieurs requêtes : des publications ou retraits simultanés peuvent déplacer les fiches d’une page à l’autre. Les anciennes fiches déjà reçues par un navigateur ne peuvent pas être révoquées à distance.
