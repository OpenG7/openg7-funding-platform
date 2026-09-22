# Poste de pilotage administratif

Route : `/admin/fundraiser/pilotage`, accessible depuis la navigation admin.
La page reprend la référence visuelle fournie : une décision centrale, la file
« À suivre » et les commandes en bas. Le portail existant reste accessible.

La vue d’ensemble affiche les décisions à examiner dans l’espace sélectionné,
les décisions traitées et les ouvertures de dossiers pendant la visite. Ces deux
derniers compteurs sont locaux et repartent à zéro au rechargement; ils ne sont
pas un historique d’activité. Les espaces disposent de repères colorés et nommés.
Les transitions et animations respectent la préférence de mouvement réduit.

**Ma semaine** ajoute briefing, session de cinq minutes, calendrier proposé,
répétition générale, variantes de texte, préférences éditoriales et solutions
aux incidents. Les contrats, la migration 025 et les limites sont décrits dans
le [runbook éditorial](editorial-programme.md).

## Guides interactifs

Le bouton **Guide pas à pas** du poste de pilotage présente dix repères :
préparation automatique, espaces, dossier, situation/proposition/conséquence,
détails, décisions, file, semaine, calendrier et manette. Dans **Ma semaine**,
un second guide parcourt les six outils en ouvrant leur vue. Ces guides sont
volontaires et consultables aussi en lecture seule. Ils expliquent les contrôles
sans les activer, sans envoyer de commande métier ni confirmer une publication.

Chaque étape met son élément en évidence et propose **Précédent**, **Suivant**
ou **J’ai compris** à la fin. **Quitter le guide** et Échap ferment uniquement
le guide et rendent le focus au bouton de départ. Dans Ma semaine, la vue
initiale et les saisies non enregistrées sont préservées tant que le panneau
reste ouvert. Tab/Entrée et les flèches gauche/droite fonctionnent au clavier.
À la manette, LB/RB changent d'étape, A active le bouton sélectionné, B quitte;
les autres raccourcis métier sont neutralisés pendant le guide. Chaque changement
d'étape exige le retour au neutre habituel.

La progression (identifiant d'étape et fin du guide) est conservée dans
`localStorage`, par guide, version du parcours et compte OIDC. Le mode token
partage une progression locale entre ses utilisateurs. Aucun contenu de dossier
ou secret n'est enregistré. Le bouton devient **Reprendre le guide**, puis
**Revoir le guide** une fois terminé. La reprise est volontaire, jamais ouverte
automatiquement. Elle reste limitée à ce navigateur; pas de synchronisation
entre appareils. Un stockage indisponible est signalé et garde seulement la
progression en mémoire. Un élément absent est expliqué sans bloquer le parcours.

La recette `admin-pilotage.spec.ts` couvre reprise après rechargement, fin et
relecture, isolation des comptes, absence de commande métier, priorité manette,
focus, panneaux imbriqués, stockage indisponible, état vide, FR/EN,
accessibilité et redimensionnement. La qualification physique reste distincte.

## Parcours disponibles

| Espace                    | Dans le pilotage                                                                                                                        | Dossier complet                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Publications              | Aperçu privé, texte exact, destination, date, acceptation groupée des commanditaires, refus, édition du texte et de la date, calendrier | Composition avancée, remplacement de média, réconciliation d’un envoi incertain, historique |
| Commanditaires            | Photo, revue privée, acceptation ou refus motivé                                                                                        | Correction de fiche et revue détaillée des médias                                           |
| Courriels                 | Aperçu du destinataire et du texte au moment de la décision, nouvelle tentative ciblée                                                  | Correction d’adresse et investigation de livraison                                          |
| Factures et contributions | Anomalies, inspection protégée des factures disponibles et événements Stripe                                                            | Émission manquante, remboursement, backfill et corrections financières                      |
| Projets                   | Contenu public d’une réalisation en brouillon, publication par le propriétaire                                                          | Modification du budget, des preuves et du contenu détaillé                                  |
| Opérations                | État des destinations, pause/reprise explicite d’un feed                                                                                | Configuration et diagnostics avancés                                                        |

Le compteur porte sur les décisions de la projection, pas sur l’ensemble des
objets du portail. La lecture se fait par pages de 30 décisions. Les publications
réutilisent la fenêtre du moteur (200 derniers dossiers, exceptions prioritaires).
Une couverture incomplète est signalée. Une actualisation ne remplace pas le
dossier lu : sa nouvelle version doit être relue avant décision.

## Commandes et contextes

- Profil initial : A accepter/sélectionner, B refuser/revenir, X modifier, Y détails.
- LB/RB : décision précédente/suivante. LT + LB/RB : espace précédent/suivant.
- LT + Y : calendrier. Menu : commandes et pauses. View : aide.
- Croix/stick gauche : navigation dans les contrôles. Stick droit : défilement.
- Clavier : Tab/Entrée, A/B/X/Y, crochets précédent/suivant, C, M et `?`.
  Les champs de saisie gardent leurs touches normales.
- Les champs numériques et listes des panneaux se règlent à gauche/droite.
  L’édition propose des décalages de date et un clavier visuel pour le texte court.

Une action sensible ouvre un panneau indiquant la cible et la conséquence.
Relâcher la manette avant la seconde étape. Le maintien ne répète jamais une
mutation. Un changement de contexte, de périphérique ou de focus impose un
retour au neutre. Les combinaisons n’activent pas en même temps leur bouton seul.
Le panneau ouvert a priorité sur la carte et sur la file.

Les réglages proposent sensibilité, délai, réaffectation distincte des quatre
boutons, retour au profil initial et vibration facultative. Le diagnostic expose
les indices bruts. Pour une disposition non standard, une correspondance complète
de 16 boutons et 4 axes, vérifiée explicitement, est liée à l’identifiant de modèle
fourni par le navigateur. Si les entrées requises manquent, la capture reste inactive.
Le profil est local à l’appareil, sans contenu métier. Aucun périphérique n’est
déclaré compatible sur la seule base d’une simulation.

## Autorité, droits et reçus

`GET /api/admin/pilotage` projette les sources existantes. `POST
/api/admin/pilotage/command` accepte un catalogue fermé, une cible, une version,
une confirmation identique à la cible et un UUID de requête. Les alias `/admin`
partagent les mêmes contrôles. Les réponses sont privées et `no-store`.

Le lecteur consulte. L’opérateur traite publications, revues, courriels et pauses.
La publication/masquage des réalisations reste réservée au propriétaire, comme
les mutations du domaine dépenses dans le portail. Le mode token conserve les
garanties de son mode historique, sans devenir une identité nominative OIDC.

La migration **024** ajoute `admin_command_receipts`. Une même requête ne peut
pas être exécutée une seconde fois, ni réutilisée avec un autre contenu/acteur.
Les reçus ne contiennent ni le corps privé d’un courriel ni le texte de publication.
Ils sont lisibles uniquement par leur auteur via `GET /api/admin/pilotage/receipt`.
Les commandes et leurs résultats sont audités. Les règles existantes de paiement,
consentement, média et version s’exécutent côté API.

Le reçu et certaines mutations métier utilisent des transactions distinctes.
Après une interruption, un reçu `executing` ancien devient `uncertain`. Le client
vérifie le reçu au lieu de rejouer la commande; il conserve son identifiant en
session pour reprendre après rechargement. Une incertitude persistante demande
une investigation du dossier et de l’audit. Le panneau « Examiner cet incident »
permet ensuite à son auteur de consigner un constat audité et de libérer le
pilotage. Le reçu conserve son statut incertain; cette déclaration ne simule
aucun succès et ne réexécute aucune commande. Ne pas effacer le reçu pour relancer.
Un reçu `completed` confirme la commande, pas un envoi externe déjà terminé.

## Activation et retour au portail

1. Livrer les builds Web/API compatibles. La route est additionnelle et ne change
   pas la page d’entrée des administrateurs.
2. Appliquer uniquement les migrations manquantes, dont 024, selon le
   [runbook des migrations](database-migrations.md). Les runners actuels ne doivent
   pas rejouer aveuglément les anciennes migrations sur une base existante.
3. Vérifier les rôles, le calendrier et les destinations en simulation avant
   toute activation réelle des fournisseurs.

Sans 024, la projection annonce une couverture partielle et désactive les commandes.
Le changement n’active aucun worker et ne modifie aucune variable d’environnement.
Suspendre la capture manette arrête les entrées physiques uniquement. Suspendre
un feed bloque ses prochains envois, avec possibilité de terminer un envoi déjà
en cours. Le worker est un troisième contrôle, distinct de ces deux pauses.
Revenir au portail ne révoque pas les autorisations d’envoi déjà enregistrées.

## Recette et limites de preuve

Les tests couvrent les transitions de boutons, la calibration, la répétition et
les contextes; PostgreSQL jetable vérifie la migration depuis 023, la concurrence,
les versions, les revues, la file de courriels et les véritables routes HTTP OIDC.
Playwright exerce 20 décisions à la manette simulée, édition, refus, calendrier,
réponse perdue, rechargement, focus, version périmée, accessibilité et vue étroite.
Les mesures de session (décisions, détails, sorties portail) restent en mémoire.

Commandes de recette :

```sh
yarn workspace @openg7/funding-web build --configuration production
yarn build
node --test tests/admin-controller.test.mjs tests/integration/admin-pilotage.integration.mjs
yarn tsc -p tests/tsconfig.admin-ui.json
yarn playwright test --config tests/playwright-admin-ui.config.mjs admin-pilotage.spec.ts
```

Le build Angular efface la sortie TypeScript des helpers Web; relancer `yarn build`
avant les tests Node qui importent ces helpers. Les tests PostgreSQL créent leur
conteneur jetable et ne lisent pas `.env`.

**Qualification matérielle encore à réaliser :** Xbox One réelle, USB puis
Bluetooth, modèle exact, version du système et navigateur, reconnexion, perte de
focus et manette tenue pendant l’ouverture d’une confirmation. Aucune publication
réelle ni activation en production n’a été effectuée dans cette recette.

Voir [la décision d’architecture](../decisions/2026-09-21-admin-controller.md)
et [le plan approuvé](../admin-controller-plan-de-travail.md).
