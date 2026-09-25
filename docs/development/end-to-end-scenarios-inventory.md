# Inventaire des scénarios de bout en bout

Inventaire conservé à la demande de l’utilisateur le 22 septembre 2026, à partir
du code de la révision `2e52f6bf8e48985cf8026f1c80f52887957cf6ee` (PR #146).
Les numéros 1 à 71 reprennent la réponse de référence de la conversation et
permettent de désigner les scénarios lors des prochains travaux.

Il complète le parcours **50 $ CAD → notifications → cartouche privée** décrit
dans le [guide des contributions reçues](../operations/contribution-activity.md).
Il s’agit d’un inventaire fonctionnel, pas d’une preuve que chaque scénario a
été testé intégralement. Les envois externes dépendent des fournisseurs configurés ;
les publications exigent une approbation administrative. Cet inventaire daté ne
remplace ni les contrats propriétaires ni le code courant et ne constitue pas une
autorisation d’exécuter des opérations réelles.

Première priorité testée le 22 septembre 2026 : **contribution personnelle →
confirmation → reconnaissance consentie et transparence**, soit les scénarios
1, 2, 3 et 8, puis les totaux et l’export JSON du scénario 59. Les quatre
combinaisons de consentements passent dans une pile jetable avec fournisseurs
simulés. Voir la [recette et ses limites](../payment-trust-validation.md#recette-complète-dune-contribution-personnelle).

Deuxième priorité testée le 23 septembre 2026 : **commandite de 500 CAD → dossier et médias → revue →
Facebook et LinkedIn simulés**. La recette cible les scénarios 6, 11, 18, 20,
35, 36 et 39, ainsi que la pause et la reprise des destinations du scénario 41.
La visibilité de la fiche Web reste une décision distincte des envois sociaux.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--commandite-de-500-cad-et-deux-destinations).

Troisième priorité testée le 23 septembre 2026 : **remboursements partiels puis
intégral → avoirs et courriels → totaux et transparence**. Les variantes 200 puis
300 CAD et 500 CAD en une fois passent avec fournisseurs simulés. La recette
couvre les scénarios 28, 29, 30 et 61, la création et le PDF de facture du scénario
25, ainsi que les totaux et l’export JSON du scénario 59. Elle corrige la collision
des numéros d’avoirs multiples et les libellés erronés des avoirs partiels.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-des-remboursements-et-avoirs).

Quatrième priorité testée le 23 septembre 2026 : **publication programmée →
remboursement ou contestation → blocage avant envoi**, soit les scénarios 31 et 44,
avec remboursement intégral du scénario 29. Trois commandites de 500 CAD donnent
six publications autorisées : les quatre devenues inadmissibles sont bloquées
avant échéance, les deux témoins partent une seule fois en simulation. Les rejeux
ne rétablissent aucune autorisation. L’interface précise le motif et ouvre le dossier.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--paiement-invalidé-après-programmation).

Cinquième priorité testée le 23 septembre 2026 : **réponse sociale perdue →
redémarrage → vérification ou nouvelle approbation sans doublon**, soit le scénario 43. Les publications retrouvées sont confirmées sans renvoi ; les publications
absentes exigent une attestation motivée, un brouillon et une nouvelle approbation.
Les témoins prouvent que le worker redémarré continue à traiter les autres envois.
Les reçus du fournisseur simulé comptent chaque requête et chaque publication.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--résultat-incertain-et-reprise-sans-doublon).

Sixième priorité testée le 23 septembre 2026 : **courriel de récupération en échec →
redémarrage du worker → relance concurrente → reprise du brouillon et soumission**.
La recette couvre les scénarios 12, 15 et 54, ainsi que le regroupement d’un renvoi
administratif récent du scénario 16. Une entreprise paie 500 CAD, ferme son
navigateur et retrouve son brouillon par le lien du courriel capturé dans Mailpit.
Deux refus SMTP puis une relance réussie donnent un seul message accepté ; le
paiement reste confirmé et le dossier attend une revue distincte de la publication.
Voir la [recette et ses limites](../sponsorship-access-and-drafts.md#recette-complete-courriel-en-echec-et-reprise-du-dossier).

Septième priorité testée le 23 septembre 2026 : **paiement abandonné, refusé ou
expiré → retour explicite → nouvelle tentative de 500 CAD → confirmation unique**,
soit le scénario 7 et les événements tardifs/répétés du scénario 61. Aucune facture,
notification de paiement reçu ni recette n'est créée pour la tentative non payée.
La nouvelle tentative confirmée produit un toast, un courriel admin, un SMS capturé
et une facture, sans doublon après rejeu. Le dossier reste privé et en attente de
revue. Les messages de reprise sont vérifiés sur mobile en FR/EN.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-de-reprise-après-paiement-interrompu).

Huitième priorité testée le 23 septembre 2026 : **paiement confirmé → webhook
interrompu → redémarrage → reprise sans doublon**, soit le scénario 62 avec
rediffusion locale signée, sans exécution du CLI d'exploitation. Les deux pannes
ciblent l'écriture de la facture puis la connexion PostgreSQL avant mise en file
de son courriel. Les compteurs admin FR/EN reflètent l'interruption et la reprise ;
la facture, les totaux, le toast et les courriels/SMS restent uniques après rejeu.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-de-reprise-après-interruption-du-webhook).

Neuvième priorité testée le 23 septembre 2026 : **dossier approuvé → modification
privée → nouvelle soumission → blocage des anciens envois → nouvelle autorisation**,
soit les scénarios 22 et 44. Deux commandites de 500 CAD vérifient le dossier encore
en revue et sa réapprobation avant le passage du worker. Le brouillon seul préserve
les autorisations ; la soumission empêche leur réutilisation. Les quatre publications
révisées partent une seule fois vers Facebook et LinkedIn simulés. Paiements,
factures et totaux restent inchangés, avec une explication et un lien au dossier
dans le cockpit FR/EN.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--révision-dun-dossier-approuvé).

Dixième priorité testée le 23 septembre 2026 : **média approuvé → retrait confirmé
ou remplacement → blocage des anciens envois → nouvelle autorisation**, soit les
scénarios 19, 39 et 44. Deux commandites de 500 CAD qualifient le remplacement du
logo sélectionné et la suppression d'une photo sélectionnée. Les accès publics
et privés au fichier retiré échouent ; le nouveau logo reste privé avant revue.
Les quatre anciennes autorisations sont bloquées avant échéance, puis les quatre
envois révisés partent une seule fois, avec le nouveau logo ou sans image selon
la décision explicite. Empreintes des images, audits, factures et totaux sont
vérifiés avec fournisseurs simulés.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--retrait-et-remplacement-de-médias-approuvés).

Onzième priorité testée pendant la nuit du 23 au 24 septembre 2026 : **deux onglets
sur un dossier → conflit conservant la saisie → rechargement explicite → abandon
du brouillon → soumission valide**, soit les scénarios 13 et 14. Une sauvegarde,
un abandon ou une soumission obsolètes ne peuvent écraser la nouvelle révision.
Le dossier soumis, son paiement et les totaux sont préservés jusqu'à la nouvelle
soumission volontaire. Voir la [recette et ses limites](../sponsorship-access-and-drafts.md#recette-de-conflits-entre-deux-onglets).

Douzième priorité testée pendant cette même nuit : **facture et avoir → destinataire
corrigé et confirmé → réponse perdue → rechargement → panne SMTP → relance unique**,
soit les scénarios 27 et 54. Une demande répétée conserve son message et son audit ;
une autre adresse avec le même identifiant est refusée. Un lien ouvre le courriel
exact dans la file. Les documents, leurs PDF et les montants restent identiques.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-de-renvoi-des-factures-et-avoirs).

Treizième priorité testée pendant cette même nuit : **lot collectif autorisé →
refus d'une entreprise → blocage → recomposition examinée → nouvelle approbation**,
soit les scénarios 33 et 44, avec refus motivé du scénario 21. Le lot de deux
entreprises revient à un brouillon contenant uniquement l'entreprise admissible.
Une proposition périmée est refusée, une annulation ne change rien, et le rejeu de
la réparation ne la répète pas. Un seul envoi Facebook simulé suit la nouvelle
autorisation ; le refus n'effectue aucun remboursement.
Voir la [recette et ses limites](../operations/editorial-programme.md#recette).

Preuve commune sur `b5c9451` avec les changements locaux : **3 parcours Chromium
réussis en 1,3 minute**, sans échec, test ignoré ou instable dans l'exécution finale
du 24 septembre 2026 à 03:59 UTC. API, base et workers réels ; Stripe, SMTP et réseaux
sociaux simulés. Dossiers de test dédiés ; pile jetable supprimée. Contrôles
complémentaires : **295 tests Node, 13 tests PostgreSQL et 31 tests UI** réussis,
TypeScript, lint, builds API/Web et contrôles documentaires. Restent les
avertissements préexistants du lint et du budget initial Angular (818,31 ko pour
800 ko). Les renvois exigent une mise à jour coordonnée du contrat API/Web,
sans migration ni opération de production.

Quatorzième priorité testée le 24 septembre 2026 : **propriétaire → comptes
opérateur/lecteur → revue → retrait des droits pendant une action → refus et
reconnexion**, soit le scénario 56. Deux sessions de l'opérateur sont révoquées
par le changement de rôle; une révocation individuelle du lecteur préserve son
autre session. Expiration serveur, désactivation/réactivation, déconnexion,
dernier propriétaire et absence de MFA sont également exercés. Une signature
invalide, un membre inconnu et une panne OIDC ne permettent aucun repli au jeton
racine. Voir la [recette et ses limites](../operations/admin-identity-and-alerts.md#recette-des-accès-administrateurs).

Preuve sur `fc2a9f6` avec les changements locaux : **2 parcours Chromium réussis
en 25,5 secondes**, sans échec, test ignoré ou instable, le 24 septembre 2026 à
13:14 UTC. API et PostgreSQL réels, Web compilé et fournisseur OIDC signé local.
Le dossier payé et les métadonnées de médias sont préchargés; aucune opération
financière ni publication. Les **15 tests PostgreSQL** ciblés couvrent aussi
le rollback en cas d'échec de l'audit, le cloisonnement par issuer et deux
rétrogradations concurrentes de propriétaires. **295 tests Node et 4 tests UI
FR/EN à 390/1280 px** réussis. Les 4 contrôles d'accessibilité de connexion/accès
passent sur Chromium, Firefox, WebKit et WebKit mobile; le premier démarrage
WebKit bureau a dépassé 30 secondes, puis le contrôle isolé a réussi en 7 secondes.
La recette est intégrée à la CI; API/Web doivent
être mis à jour ensemble pour la confirmation serveur des changements d'accès.

Quinzième priorité testée le 24 septembre 2026 : **commandites de 100 et 250 CAD →
notifications → dossier et médias → revue → avantages du palier**, soit les
scénarios 4 et 5. Quatre parcours couvrent les deux montants avec et sans
consentement public. La commandite de 100 CAD consentie apparaît sur le site;
celle de 250 CAD permet aussi un envoi Facebook simulé, explicitement autorisé
et exécuté une seule fois par le worker après fermeture de la page admin.
Les canaux exclus sont refusés côté API sans ajout explicite par l’admin.
Sans consentement, même les dossiers et médias approuvés restent privés.
Factures, notifications, totaux et livraisons restent uniques après rejeu.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--paliers-de-100-et-250-cad).

Preuve sur `919f634` avec les changements locaux : **4 parcours Chromium réussis
en 3,1 minutes**, sans échec, test ignoré ou instable. Les **30 tests PostgreSQL**
du moteur passent, avec les seuils 249,99/250 et 499,99/500 CAD, les consentements,
la devise et les canaux supplémentaires explicitement choisis par l’admin.
Les **295 tests Node**, TypeScript, lint et builds API/Web passent également;
les avertissements préexistants du lint et du budget Angular subsistent.
Les règles applicatives sont conservées : ce lot ajoute des preuves de parcours,
sans migration ni opération réelle. La pile jetable est supprimée après la recette.

Seizième priorité testée le 24 septembre 2026 : **dossier incomplet → contact
corrigé → demande d’informations → soumission → rappel de revue → approbation**,
soit les scénarios 17, 23 et 24. Un aperçu devenu obsolète après correction du
contact est refusé; le message confirmé arrive une seule fois à l’adresse courante.
L’entreprise reprend son lien initial et soumet sa fiche et sa photo. Le rappel
exclut les dossiers incomplets, récents ou déjà approuvés et ne se répète pas le
même jour UTC. Son courriel contient désormais un lien absolu vers la liste
administrative protégée. Paiement, facture, PDF et totaux restent identiques.
Voir la [recette et ses limites](../sponsorship-access-and-drafts.md#recette-de-demande-dinformations-et-de-revue).

Preuve sur `1462452` avec les changements locaux : **1 parcours Chromium réussi
en 19,2 secondes**, sans échec, test ignoré ou instable, le 24 septembre 2026 à
20:39 UTC. **296 tests Node et 2 tests PostgreSQL** ciblés passent, ainsi que
TypeScript, lint et builds API/Web. Les avertissements préexistants du lint et
du budget initial Angular (818,98 ko pour 800 ko) subsistent. Le rappel utilise
une horloge injectée dans son service compilé; la cadence horaire réelle n’est
pas qualifiée. Fournisseurs simulés et pile jetable supprimée; aucune migration
ni opération de production.

Dix-septième priorité testée le 24 septembre 2026 : **référence oubliée → courriel de récupération → recherche
publique → récupération distincte du lien privé → reprise et soumission**, soit
les scénarios 9 et 10. La recette relie deux contributions de la même adresse,
exclut celle d’un autre payeur et vérifie Support en FR/EN sur mobile et bureau.
La référence seule ne donne aucun accès au dossier; le montant public respecte
son consentement. Les rejeux partagent leur courriel dans la même heure UTC.
Une panne d’insertion du message révélait une différence de réponse entre adresse
connue et inconnue; le correctif conserve la réponse conditionnelle uniforme.
Voir la [recette et ses limites](../public-builders-and-support.md#recette-de-récupération-des-références).

Preuve sur `7dd6050` avec les changements locaux : **1 parcours Chromium FR/EN
réussi en 18,8 secondes**, sans échec, test ignoré ou instable, le 24 septembre
2026 à 21:02 UTC. Le test échouait avec 502 au lieu de 202 sur l’ancienne API lors
de la panne ciblée. **296 tests Node et 2 tests PostgreSQL** passent, ainsi que
TypeScript, lint, builds API/Web et contrôles documentaires. Les avertissements
préexistants du lint et du budget Angular (818,98 ko pour 800 ko) subsistent.
Fournisseurs simulés, pile jetable supprimée, aucune migration ni opération de
production. La réponse uniforme ne garantit pas des délais identiques; le
courriel de références reste en français.

Dix-huitième priorité testée le 24 septembre 2026 : **commandite confirmée → frais
Stripe tardifs puis corrigés → versement bancaire → transparence administrative
et publique**, soit les scénarios 64, 60, 61 et les exports du scénario 59. Une
commandite simulée de 250 CAD reçoit 8,05 CAD de frais confirmés; les transferts
bancaires ne réduisent pas à nouveau son net de 241,95 CAD. La recette couvre
succès répétés/concurrents, échec après succès, ancien succès reçu après échec,
remplacement distinct et versement dans un mois sans nouvelle contribution.

Deux défauts reproduits avant correction sont résolus : des événements distincts
pour le même versement pouvaient créer plusieurs écritures, et un versement
finalement échoué restait dans les totaux. Webhooks et backfill partagent la
protection par versement. Les anciens doublons sont neutralisés dans la projection,
sans réécrire le registre. Facture/PDF, contribution et activité de paiement restent
uniques; le snapshot admin et les exports JSON/CSV FR/EN concordent, sans données
privées. Voir le [contrat des versements](../funding-transparency.md#versements-stripe-et-échecs-tardifs)
et la [recette navigateur](../../tests/playwright/payout-transparency-acceptance.spec.ts).

Preuve sur `427e735` avec les changements locaux : **1 parcours Chromium FR/EN
réussi en 8,1 secondes**, sans échec, test ignoré ou instable dans l'exécution
finale, le 24 septembre 2026 à 21:32 UTC. **296 tests Node et 19 tests PostgreSQL**
passent, ainsi que TypeScript, lint, builds API/Web et contrôles documentaires.
Les intégrations couvrent aussi concurrence avec le backfill, simulation sans
écriture, faits contradictoires, reprise après échec d'insertion, registre
historique et concordance Stripe direct. Les avertissements préexistants du lint
et du budget Angular (818,98 ko pour 800 ko) subsistent. Pile jetable supprimée,
fournisseurs simulés, aucune migration nouvelle ni opération de production;
aucune réception bancaire réelle n'est qualifiée.

Dix-neuvième priorité testée le 24 septembre 2026 : **paiement Stripe historique absent → aperçu borné →
reprise silencieuse → webhooks tardifs → facture manquante confirmée → PDF et
transparence**, soit les scénarios 63 et 26, avec rejeux du scénario 61. Une
commandite de 250 CAD, avec 7,55 CAD de frais et 242,45 CAD de net, est importée
par la vraie CLI dans une pile jetable. Les limites de projet, date et volume
sont vérifiées; l'aperçu n'écrit rien. L'administrateur ouvre « À traiter »,
annule puis confirme la génération ciblée et télécharge son PDF. Les rejeux
conservent le même numéro et le même document, sans courriel ni activité de
paiement; les exports publics FR/EN respectent les montants et la confidentialité.

Les défauts reproduits puis corrigés concernent le double comptage des frais,
les messages/factures déclenchés par un ancien Checkout et l'écrasement des
consentements ou du nom public par les métadonnées historiques. Les anciens
doublons sont neutralisés dans les agrégats sans réécrire le registre. La
génération de facture exige désormais une confirmation du périmètre côté API;
les confirmations absentes ou incorrectes sont refusées avant toute écriture.
Voir la [recette et ses limites](../technical/stripe.md#historical-payment-recovery-recipe).

Preuve sur `e8466d8` avec les changements locaux : **1 parcours Chromium FR/EN
réussi en 21,2 secondes**, sans échec, test ignoré ou instable dans l'exécution
finale, le 24 septembre 2026 à 22:16 UTC. Les quatre tests voisins de versements
et de reprise Stripe passent également. **296 tests Node, 41 tests PostgreSQL
et 10 tests UI** passent, ainsi que TypeScript, lint et builds API/Web. Les
intégrations couvrent concurrence, reprise après panne d'insertion, doublons
historiques, consentements locaux et maintien des notifications des nouveaux
paiements. Les avertissements préexistants du lint et du budget Angular
(819,00 ko pour 800 ko) subsistent. Fournisseurs simulés et pile jetable supprimée;
aucune migration nouvelle ni opération de production. API et Web doivent être
livrés ensemble pour le nouveau contrat de confirmation.

Vingtième priorité testée le 24 septembre 2026 : **allocation en brouillon → publication confirmée → preuve
de livraison → conflit entre deux onglets → masquage, republication et archivage**,
soit le scénario 58, avec les lectures publiques du scénario 59. Une allocation
de 42,50 CAD devient publique après confirmation, puis passe à 65,25 CAD avec
une preuve de livraison. Deux onglets tentent ensuite de modifier la même version;
le perdant conserve sa saisie et doit recharger avant une nouvelle décision.
Les montants des paiements, remboursements, versements et le net restent identiques.

Les tests PostgreSQL ont reproduit l'absence de confirmation serveur, l'arrondi
silencieux des sous-centimes et une publication sans date. Les correctifs exigent
la confirmation sur la version verrouillée, conservent des cents exacts et
initialisent la date publique. Les dates inchangées gardent aussi leur précision
et leur fuseau lors de l'édition. Une panne d'audit annule toute mutation; les
preuves HTTPS contenant des identifiants ne sont pas exposées au public.
Voir le [contrat et la recette](../funding-transparency.md#allocations-publiées-et-réalisations).

Preuve sur `8ee0d33` avec les changements locaux : **1 parcours Chromium réussi
en 9,1 secondes**, sans échec, test ignoré ou instable dans l'exécution finale,
le 24 septembre 2026 à 22:59 UTC. Les trois tests navigateur existants de la page
Dépenses passent également. **296 tests Node et 37 tests PostgreSQL** passent,
ainsi que TypeScript, lint, builds API/Web, pré-rendu des 24 routes statiques et
contrôles documentaires. Le navigateur utilise le fuseau de Toronto; la recette
vérifie FR/EN à 1280/390 px, confirmation au clavier, requêtes invalides et saisie
conservée après conflit. Les avertissements connus du lint et du budget initial
Angular (819,69 ko pour 800 ko) subsistent. Pile jetable supprimée, aucune nouvelle
migration ni opération de production; API/Web doivent être livrés ensemble.

Vingt et unième priorité testée le 24 septembre 2026 : **incident courriel ou
Stripe → alerte signée → récepteur indisponible → réponse perdue → reprise après
redémarrage → dossier admin protégé → résolution et récidive**, soit le scénario 65.
Trois incidents synthétiques traversent le vrai script de surveillance et un
récepteur local. Les reprises conservent les mêmes IDs et le même contenu; une
récidive après résolution ouvre un nouvel épisode. Douze requêtes produisent
six notifications logiques, grâce à la déduplication du récepteur simulé.

La synchronisation relit désormais les incidents après acquisition du verrou,
pour empêcher un surveillant en attente de réutiliser un état périmé. Les URL
du webhook et du lien admin sont validées sans exposer leur valeur en cas
d'erreur. Les tests couvrent aussi les baux expirés, le délai maximal d'une heure,
les redirections refusées, la résolution avant reprise et une connexion DB
refusée, avec alerte signée et sortie non nulle du vrai script `--once`.
Voir le [contrat et la recette](../operations/admin-identity-and-alerts.md#recette-isolée-des-alertes).

Preuve sur `52a0b48` avec les changements locaux : **1 parcours Chromium réussi
en 4,3 secondes**, sans échec, test ignoré ou instable, le 24 septembre 2026 à
23:23 UTC. **297 tests Node et 4 tests PostgreSQL ciblés** passent, ainsi que
TypeScript, lint, builds API/Web et pré-rendu des 24 routes statiques. Le parcours
vérifie la connexion depuis le lien reçu, l'inspecteur Stripe sans payload privé,
le dossier du courriel en échec et l'affichage FR/EN sur ordinateur et à 390 px.
Les avertissements connus du lint et du budget initial Angular subsistent.
Pile jetable supprimée; aucune nouvelle migration ni opération de production.
La recette qualifie un récepteur simulé : l'adaptateur externe doit assurer la
persistance des IDs. Pendant une panne DB, l'ID de secours reste seulement en
mémoire du surveillant et peut changer après son redémarrage.

Vingt-deuxième priorité testée le 24 septembre 2026 : **filtrage des contributions →
confirmation d'un export privé → téléchargement du CSV → audit**, soit le
scénario 53. Le fichier contient les résultats affichés, avec une limite de
250 dossiers récents annoncée dans l'interface. Le propriétaire confirme une
sélection versionnée; les lecteurs et opérateurs sont refusés par l'API.

Le précédent GET sans confirmation est remplacé par un POST validé. Une
modification concurrente, même d'une microseconde, impose une actualisation;
une panne d'audit empêche le téléchargement. Les noms multiligne, guillemets,
devises et données privées admissibles sont conservés; les préfixes textuels de
formule sont neutralisés dans le CSV. Notes administratives et jetons restent
exclus. L'audit conserve acteur, nombre de dossiers, empreinte de sélection et
corrélation, sans recopier les coordonnées privées. Voir le
[contrat et la recette](../operations/private-contributions-export.md).

Preuve sur `f3910a6` avec les changements locaux : **3 parcours Chromium OIDC
réussis en 28 secondes**, dont le nouvel export en **7,4 secondes**, sans échec,
test ignoré ou instable dans l'exécution finale, le 24 septembre 2026 à 23:53 UTC.
La recette utilise PostgreSQL jetable, l'API réelle, le Web compilé et un
fournisseur d'identité signé local. Elle couvre annulation et confirmation au
clavier, refus d'origine et de rôle, expiration de session pendant la décision,
audit indisponible et affichage FR/EN à 1280/390 px. **299 tests Node, 2 tests
PostgreSQL ciblés et 1 test UI de confirmation** passent, ainsi que TypeScript,
lint et builds API/Web avec 24 routes pré-rendues. Les avertissements connus
du lint et du budget Angular subsistent (821,38 ko pour 800 ko).
Aucune nouvelle migration ni opération de production; API/Web doivent être
livrés ensemble pour le nouveau contrat d'export. Les octets CSV sont vérifiés,
sans qualification de toutes les versions de tableurs après réenregistrement.

Vingt-troisième priorité testée le 24 septembre 2026 (25 septembre à 00:16 UTC) :
**recherche privée → ancien dossier exact → contribution, facture ou publication**,
soit le scénario 52. Deux commandites de 2020, précédées de 260 contributions
récentes, sont retrouvées par courriel puis ouvertes sur chaque surface, y compris
quand la cible change sur la même route. Les trois rôles administratifs peuvent
rechercher; les accès anonymes, origines étrangères et entrées hors limites sont
refusés. La saisie reste hors des URL et du stockage navigateur.

La recette couvre pagination, montants avec devise, caractères SQL littéraux,
clavier, fermeture effaçant la recherche, panne SQL et reprise explicite,
factures temporairement indisponibles et session expirée. La connexion explique
désormais l’expiration et conserve la page à reprendre; les refus d’autorisation
portent aussi l’en-tête interdisant le cache privé. Documents, courriels,
brouillons, audit métier et montants restent inchangés pendant la recherche.
Voir le [contrat et la recette](../admin-ux-lot-6.md#recette-du-parcours-complet).

Preuve sur `9539480` avec les changements locaux : **1 parcours Chromium OIDC
réussi en 21,8 secondes** (23,1 secondes avec démarrage du runner), sans échec,
test ignoré ou instable dans l’exécution finale du 25 septembre à 00:16 UTC.
Web compilé, API et PostgreSQL jetable réels; fournisseur d’identité signé local
et dossiers synthétiques. **299 tests Node, 1 test PostgreSQL sur 2 008 dossiers
et 13 tests UI** réussis. TypeScript, lint et builds API/Web passent avec 24 routes
pré-rendues. Les avertissements existants du lint et du budget initial Angular
subsistent (821,38 ko pour 800 ko). Les recettes vérifient FR/EN et 320/390/1280 px;
la recette réelle est incluse dans la suite OIDC de CI. Aucune nouvelle migration,
dépendance ou opération de production; nginx, HTTPS et OIDC externe restent hors
de cette qualification locale.

Vingt-quatrième priorité testée le 24 septembre 2026 (25 septembre à 00:51 UTC) :
**composer la semaine → répétition générale → déplacement confirmé → nouvelle
approbation**, soit les scénarios 46 et 47. Une actualité approuvée reste fixe par
défaut; son inclusion explicite permet de comparer les dates et parcourir les
textes avec une seconde actualité. Un troisième contenu sur une autre destination
sert de témoin. Annuler ou écarter le plan ne crée ni déplacement ni audit.

Une modification concurrente invalide tout le plan sans écriture partielle.
Après actualisation et confirmation, une réponse perdue est récupérée au
rechargement sans seconde commande. Les deux contenus déplacés reviennent en
brouillon; leurs anciennes autorisations sont retirées. Une nouvelle approbation
explicite est vérifiée, puis une session expirée bloque un déplacement supplémentaire.
Le lecteur consulte sans préparer ni appliquer. Origine étrangère et confirmation
absente sont aussi refusées côté API.

La recette a révélé et corrigé une confirmation restant active après abandon du
plan, une sélection vide après récupération d'un reçu et un message d'échec
effacé par l'actualisation. Les propositions remplacées et les données d'un
chargement échoué ne restent plus confirmables. Voir le
[contrat et la recette](../operations/editorial-programme.md#calendrier-et-répétition-générale-avec-api-réelle).

Preuve sur `a851167` avec les changements locaux : **1 parcours Chromium OIDC
réussi en 15 secondes** (16,5 secondes avec démarrage du runner), sans échec, test
ignoré ou instable dans l'exécution finale du 25 septembre à 00:51 UTC. API et
PostgreSQL jetable réels, Web compilé et fournisseur OIDC signé local. **299 tests
Node, 7 tests PostgreSQL et les 29 tests UI du pilotage** passent; les deux tests
UI de reçus sont rejoués avec succès après le dernier ajustement du message
d'échec. Clavier, manette simulée, accessibilité et FR/EN à 390/1280/1512 px sont
couverts selon les recettes. TypeScript, lint et build Web/SSR passent avec
24 routes pré-rendues; les avertissements existants du lint et du budget initial
Angular subsistent (821,38 ko pour 800 ko).

Les feeds restent suspendus, le worker désactivé et les contenus synthétiques en
mode `mock`; aucun envoi social ou courriel n'est déclenché. Aucune migration ni
dépendance ajoutée. Cette preuve porte sur calendrier, autorisations et reprise;
elle ne qualifie ni un média stocké, ni une manette physique, ni un fournisseur
social ou OIDC externe. La recette est découverte par la suite OIDC de CI.

Vingt-cinquième priorité testée le 24 septembre 2026 (25 septembre à 01:14 UTC) :
**variante examinée → correction enregistrée → suggestion → préférence confirmée →
préparation suivante**, soit les scénarios 48 et 49. Les quatre transformations
conservent noms, chiffres, liens et mentions. Une intention inconnue, un texte
falsifié ou une version obsolète échoue sans correction enregistrée. Une variante
acceptée retire l'ancienne approbation en conservant destination, date et média.

Seules trois publications distinctes corrigées font apparaître la suggestion;
aperçus, annulations, rejeux et corrections répétées du même contenu ne gonflent
pas ce compteur. La préférence reste inactive jusqu'à sa confirmation. La recette
couvre le conflit entre deux administrateurs, la réponse perdue récupérée sans
seconde commande, puis la désactivation explicite. Les préparations suivantes
adaptent les contenus automatiques intacts et nouveaux, tout en préservant les
textes humains, l'actualité réapprouvée et la publication refusée. Les profils des
autres destinations restent inchangés.

Un défaut reproduit puis corrigé laissait l'ancienne comparaison et sa confirmation
actives après modification de l'intention saisie. Elles sont maintenant retirées;
il faut préparer et examiner une nouvelle variante. Lecteur, session expirée,
origine étrangère et confirmation absente restent refusés côté API. Voir le
[contrat et la recette](../operations/editorial-programme.md#variantes-et-préférences-avec-api-réelle).

Preuve sur `e5ae715` avec les changements locaux : **1 parcours Chromium OIDC
réussi en 21,1 secondes** (23,2 secondes avec démarrage du runner), sans échec,
test ignoré ou instable. Web compilé, API et PostgreSQL 16 jetable réels,
fournisseur OIDC signé local. **299 tests Node, 7 tests PostgreSQL et 30 tests UI
du pilotage** passent. TypeScript, lint et build Web/SSR avec 24 routes pré-rendues
passent; les avertissements préexistants ESLint et budget Angular (821,38 ko pour
800 ko) subsistent. Clavier, préférences anglaises à 390 px et Axe ciblé sont
vérifiés, avec capture mobile et audit attachés à la recette.

Les commandites sont des fixtures déjà payées dans la seule base jetable;
Stripe n'est pas exercé par ce parcours. La préparation explicite réutilise le
service du worker, qui reste désactivé; feeds suspendus, mode `mock`, aucun
courriel, job social ni envoi créé. Aucune migration ou dépendance ajoutée.
Les fournisseurs externes, la dictée, la génération libre et les manettes
physiques restent hors qualification. La suite OIDC de CI découvre cette recette.

## Contributions et accès au suivi

|  Nº | Scénario                             | Parcours de bout en bout                                                                                                           |
| --: | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Contribution personnelle             | Choisir un montant → consentements → Checkout → confirmation serveur → contribution enregistrée et totaux actualisés.              |
|   2 | Reconnaissance personnelle           | Contribuer avec consentement public → apparition dans les Bâtisseurs ; affichage du montant selon un consentement distinct.        |
|   3 | Contribution privée                  | Payer sans consentement public → contribution comptabilisée sans inscription nominative dans l’annuaire.                           |
|   4 | Commandite de 100 $                  | Paiement → suivi privé → fiche et médias → revue administrative → reconnaissance sur le site.                                      |
|   5 | Commandite de 250 $                  | Paiement → dossier → admissibilité à la mention Web et à Facebook → préparation → approbation → envoi configuré.                   |
|   6 | Commandite de 500 $                  | Même parcours, avec admissibilité supplémentaire à LinkedIn.                                                                       |
|   7 | Paiement abandonné, refusé ou expiré | Tentative de paiement → état non confirmé → aucun montant présenté comme encaissé → nouvelle tentative possible.                   |
|   8 | Confirmation retardée                | Retour du paiement encore en attente → actualisation → confirmation reçue du serveur → progression du dossier.                     |
|   9 | Recherche d’une contribution         | Saisir sa référence dans Support → consulter le statut autorisé → accéder à l’étape suivante.                                      |
|  10 | Référence oubliée                    | Demander une récupération par courriel → réponse publique uniforme → recevoir les références admissibles si un dossier correspond. |

## Dossiers commanditaires

Le suivi fonctionne sans compte utilisateur.
[Contrat du suivi](../sponsorship-access-and-drafts.md).

|  Nº | Scénario                               | Parcours de bout en bout                                                                                                         |
| --: | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
|  11 | Première soumission                    | Ouvrir le lien privé → remplir les informations → joindre les médias → soumettre à l’équipe → dossier à examiner.                |
|  12 | Formulaire interrompu                  | Commencer une fiche → sauvegarde automatique serveur → revenir, éventuellement sur un autre appareil → reprendre et soumettre.   |
|  13 | Abandon des modifications              | Restaurer un brouillon → abandonner explicitement → conserver la fiche déjà soumise.                                             |
|  14 | Modifications concurrentes             | Modifier depuis deux onglets → détecter le conflit → conserver la saisie locale → choisir explicitement la version à reprendre.  |
|  15 | Lien perdu ou expiré                   | Demander un nouveau lien avec le courriel du paiement → recevoir l’accès → reprendre le dossier.                                 |
|  16 | Renvoi administratif du suivi          | Ouvrir le dossier → vérifier le destinataire → confirmer le renvoi → message en file et action auditée.                          |
|  17 | Informations manquantes                | Admin détecte un dossier incomplet → prépare et confirme une demande → entreprise reçoit le courriel → complète et soumet.       |
|  18 | Validation des médias                  | Téléverser logo/photos → stockage privé → revue administrative → utilisation des médias approuvés dans les surfaces admissibles. |
|  19 | Remplacement ou suppression d’un média | Sélectionner le fichier → confirmer l’action requise → mettre à jour le dossier et sa disponibilité publique.                    |
|  20 | Acceptation d’une commandite           | Examiner fiche, consentement et médias → approuver → fiche admissible à l’annuaire selon les conditions de visibilité.           |
|  21 | Refus d’une commandite                 | Refuser avec motif → notifier éventuellement l’entreprise → enregistrer séparément le traitement prévu du remboursement.         |
|  22 | Modification après approbation         | Entreprise ouvre explicitement l’édition → modifie et soumet → nouvelle revue des informations.                                  |
|  23 | Correction administrative              | Corriger identité, contact ou site → confirmer avec motif → enregistrer la correction et son audit.                              |
|  24 | Revue oubliée                          | Dossier complet payé laissé en attente → rappel administratif configuré → admin reprend la revue.                                |

## Facturation et remboursements

|  Nº | Scénario                           | Parcours de bout en bout                                                                                                                              |
| --: | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
|  25 | Facture de commandite              | Paiement confirmé → création de la facture → courriel en file → consultation et téléchargement du PDF.                                                |
|  26 | Facture historique manquante       | Repérer une commandite admissible → générer la facture manquante → la rendre consultable sans envoi automatique.                                      |
|  27 | Renvoi de facture ou d’avoir       | Choisir le document → vérifier ou corriger le destinataire → confirmer → suivre la livraison du courriel.                                             |
|  28 | Remboursement partiel              | Saisir montant et motif → confirmer la référence → demande Stripe → suivi du remboursement → avoir si facture correspondante.                         |
|  29 | Remboursement intégral             | Confirmer le remboursement → réponse Stripe ou webhook ultérieur → statut remboursé → avoir et notification selon configuration.                      |
|  30 | Remboursement échoué ou concurrent | Échec fournisseur ou dossier modifié par un autre admin → résultat explicite → investigation sans faux succès ni dépassement du montant remboursable. |
|  31 | Contestation du paiement           | Événement Stripe de contestation → mise à jour du dossier → prise en compte dans les règles de traitement.                                            |

## Publications

Les destinations prévues sont Facebook et LinkedIn, pour OpenG7 et OpenG20.
[Contrat du moteur](../operations/publication-automation.md).

|  Nº | Scénario                         | Parcours de bout en bout                                                                                                                                 |
| --: | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  32 | Préparation manuelle             | Sélectionner une commandite admissible → créer un brouillon → modifier le texte → soumettre à la validation.                                             |
|  33 | Publication collective           | Créer un lot → y affecter plusieurs brouillons → contrôler sa capacité → préparer le contenu collectif.                                                  |
|  34 | Planification au calendrier      | Créer un créneau → affecter un brouillon ou un lot → choisir la date → enregistrer ou déplacer la planification.                                         |
|  35 | Préparation récurrente           | Configurer jours, heure, fuseau et capacité → activer le moteur → génération de créneaux et propositions privées.                                        |
|  36 | Envoi social autorisé            | Examiner texte exact, image, compte et date → approuver → destination active → worker envoie à échéance, navigateur fermé compris.                       |
|  37 | Publication éditoriale           | Rédiger une actualité, réalisation ou nouvelle de campagne → choisir destination et date → approuver → envoi.                                            |
|  38 | Publication faite extérieurement | Publier manuellement sur le réseau → enregistrer le lien et le statut dans l’application après confirmation.                                             |
|  39 | Modification après approbation   | Changer texte, média ou date → retrait de l’autorisation précédente → nouvelle approbation nécessaire.                                                   |
|  40 | Refus ou annulation              | Refuser une proposition ou annuler un envoi programmé → conserver l’historique → empêcher cet envoi.                                                     |
|  41 | Pause et reprise                 | Suspendre une destination ou arrêter le moteur → conserver les traitements persistés → reprendre explicitement.                                          |
|  42 | Compte social indisponible       | Connexion absente, expirée ou invalide → publication bloquée → correction de configuration → contrôle et reprise autorisée.                              |
|  43 | Résultat d’envoi incertain       | Réponse fournisseur perdue → investigation du compte réel → rapprochement avec la publication existante, ou absence attestée avant nouvelle préparation. |
|  44 | Source devenue inadmissible      | Paiement, revue, consentement ou destination incompatible → blocage → proposition de recomposition → nouvelle validation.                                |

## Parcours éditoriaux supervisés

[Ma semaine](../operations/editorial-programme.md).

|  Nº | Scénario                | Parcours de bout en bout                                                                                                                            |
| --: | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
|  45 | Session de traitement   | Lire le briefing → ouvrir les décisions prioritaires → examiner et traiter les dossiers → consulter les résultats.                                  |
|  46 | Composer une semaine    | Choisir une cadence → obtenir une proposition → examiner collisions et répétitions → appliquer les changements → réapprouver les éléments modifiés. |
|  47 | Répétition générale     | Parcourir chronologiquement textes, images, destinations et dates → repérer les blocages avant tout envoi.                                          |
|  48 | Variante éditoriale     | Demander une transformation reconnue du texte → comparer avant/après → enregistrer la variante choisie.                                             |
|  49 | Préférences éditoriales | Accumuler des corrections reconnues → recevoir une suggestion → activer une préférence pour les futures préparations admissibles.                   |
|  50 | Pilotage guidé          | Suivre le guide interactif → naviguer au clavier ou à la manette → ouvrir les dossiers → confirmer les actions permises par son rôle.               |

## Opérations administratives quotidiennes

|  Nº | Scénario                           | Parcours de bout en bout                                                                                                                             |
| --: | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
|  51 | Traitement d’une anomalie          | Ouvrir « À traiter » ou l’Assistant → lire les faits → accéder au dossier exact → corriger → actualiser la file.                                     |
|  52 | Recherche transversale             | Rechercher une référence, entreprise ou document → ouvrir le résultat → consulter facture, contribution, publication ou dossier associé.             |
|  53 | Export privé des contributions     | Filtrer les contributions → confirmer l’export privé → obtenir le CSV administratif.                                                                 |
|  54 | Courriel échoué                    | Consulter le message et son état → corriger la cause → relancer un message admissible → suivre le nouveau résultat.                                  |
|  55 | Vérification de configuration      | Ouvrir Configuration → consulter l’état des services → lancer un courriel de test → vérifier sa livraison.                                           |
|  56 | Gestion des accès                  | Se connecter → accéder aux fonctions du rôle ; en OIDC, gérer les comptes, modifier les rôles ou révoquer les sessions.                              |
|  57 | Investigation et audit             | Partir d’un incident → inspecter les faits Stripe, documents et actions administratives → retrouver acteur, date et résultat.                        |
|  58 | Allocation ou réalisation publique | Créer un brouillon avec montant, description, avancement et preuves → publier → rendre visible dans la transparence → modifier, masquer ou archiver. |

## Transparence et reprise technique

|  Nº | Scénario                              | Parcours de bout en bout                                                                                                                               |
| --: | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
|  59 | Consultation financière publique      | Ouvrir Transparence → choisir une période → consulter contributions, frais, remboursements et versements → exporter JSON/CSV ou partager la vue.       |
|  60 | Frais Stripe reçus tardivement        | Paiement enregistré avec frais incomplets → réception de `charge.updated` → enrichissement des frais et du net sans doubler la transaction.            |
|  61 | Webhook répété ou désordonné          | Recevoir plusieurs livraisons → dédupliquer et appliquer les transitions autorisées → conserver un état financier cohérent.                            |
|  62 | Reprise d’un webhook échoué           | Corriger la cause → rejouer l’événement via l’outil d’exploitation → reprendre le traitement sans recréer les effets déjà confirmés.                   |
|  63 | Paiement historique absent de la base | Scanner Stripe sur un périmètre choisi → rapprocher les paiements du projet → compléter les données sans renvoyer les notifications historiques.       |
|  64 | Versement Stripe                      | Recevoir un versement réussi ou échoué → enregistrer le mouvement → le retrouver dans la projection financière.                                        |
|  65 | Alerte opérationnelle                 | Détecter un courriel ou événement Stripe en échec, ou une indisponibilité DB → envoyer une alerte signée au récepteur configuré → suivre les reprises. |
|  66 | Sauvegarde et restauration            | Sauvegarder PostgreSQL → restaurer sur une cible dédiée → vérifier la récupération ; parcours d’exploitation par scripts.                              |

## Parcours publics de découverte et d’aide

|  Nº | Scénario                           | Parcours de bout en bout                                                                                                                       |
| --: | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
|  67 | Consultation des annuaires         | Parcourir Bâtisseurs ou Commanditaires → consulter les fiches admissibles et publications disponibles → accéder à la contribution ou au suivi. |
|  68 | Découverte du projet               | Accueil, À propos ou Écosystème → comprendre le fonds et les plateformes → rejoindre le formulaire de contribution.                            |
|  69 | Demande d’aide ou de remboursement | Consulter la FAQ et la politique → retrouver sa référence → contacter l’équipe → traitement humain du dossier.                                 |
|  70 | Boutique et musique                | Consulter les contenus → suivre les liens proposés vers les services externes ; ces pages ne constituent pas un commerce intégré.              |
|  71 | Participation technique            | Support → guide de contribution ou formulaire GitHub de signalement/suggestion → poursuite sur le service externe.                             |

## Variantes et limites

Les variantes **FR/EN, mobile, navigation clavier, session expirée et erreur réseau
avec reprise** traversent plusieurs de ces scénarios.

Les SMS restent simulés ; l’assistant conversationnel n’a pas de fournisseur IA
réel raccordé ; une allocation publiée ne déclenche pas un paiement fournisseur ;
un remboursement ne retire pas automatiquement toute reconnaissance publique
selon la politique actuelle.

Les recettes futures pourront référencer ces numéros en précisant le périmètre,
la révision testée, les préconditions, les fournisseurs simulés ou réels et les
résultats observés. Une présence dans cet inventaire ne vaut pas preuve de test.
