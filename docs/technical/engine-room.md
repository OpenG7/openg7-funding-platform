# Salle des moteurs intelligents — supervision en lecture seule

Route admin : `/admin/fundraiser/engine-room`. Cette première version compose
les lectures Funding existantes; elle ne crée ni orchestrateur ni commande moteur.
Elle dépend de la branche de clarification de l’admin (PR #424).

## Capacités et sources

| Capacité                        | Propriétaire                                                     | Observation                                                                                            | Limite                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Publications des commanditaires | Funding                                                          | Réglage du worker, destinations, comptes, connexions, pauses, préparation et livraisons                | Aucune mesure de présence du processus de publication; réglage activé distinct de fonctionnement confirmé                            |
| Préparation Preflight           | Preflight pour les propositions; Funding pour la décision métier | Activation du connecteur ou de la préparation locale, signal du relais Funding, attente et quarantaine | Le service Preflight distant n’est pas contacté par cette consultation; les compteurs concernent le tenant du connecteur globalement |

Facebook et LinkedIn sont des dépendances du moteur de publications. Leur mode
simulation/réel et leur état sont affichés séparément. Une pause ou une connexion
non vérifiée ne devient pas une panne générale. Aucune clé, URL interne ou
configuration de fournisseur IA n’est renvoyée.

Les capacités et modules de diffusion sont représentés par des turbines dessinées
dans une scène industrielle CSS/SVG. L’en-tête et le contexte sont compacts; les
deux grandes machines Funding et Preflight occupent la scène, avec les modules de
diffusion physiquement reliés à Funding. Sélectionner une turbine ne fait que
changer l’inspecteur adjacent (ou vertical sur tablette/mobile). Celui-ci propose
Vue d’ensemble et Diagnostic : mission, état, conséquence, décision humaine,
provenance et liens d’intervention. Compteurs et fraîcheur occupent le bandeau
secondaire. Le dessin est statique : il ne simule pas une
rotation ou un fonctionnement que les observations disponibles ne prouvent pas.

Le mode de présentation `immersive` du cadre Angular admin est optionnel et désactivé
par défaut. Il applique la palette sombre uniquement à cette salle et regroupe les
outils globaux dans un menu sur mobile, sans retirer leurs fonctions. Sur mobile,
un sélecteur montre un moteur principal à la fois avec ses modules; le diagnostic
reste vertical. La scène décorative ne contient aucun contrôle : les turbines sont
de vrais boutons, avec noms, focus et états textuels indépendants de la couleur.

## Contrat HTTP et droits

### Cycle de reconnaissance par commandite

Depuis **Prestations de services**, le détail d’une prestation ou un dossier
déjà ciblé ouvre la salle avec `sponsorshipId`. Le panneau **Cycle de reconnaissance
de la commandite** relie paiement, accord, examen, préparation, autorisation,
exécution, preuves et audit pour cette contribution exacte. Les actions restent
des liens vers leurs espaces propriétaires ; consulter ne prépare et ne publie rien.

`EngineRoomSnapshot.goldenPath`, optionnel pour les anciens clients/serveurs,
contient une observation `available`, `not_found`, `not_sponsorship` ou
`unavailable`. Sans dossier exact, il vaut `null`. Une sélection `deliveryId`,
y compris collective, présente les participants retournés par la lecture native ;
l’administrateur choisit le dossier à observer. Le retour conserve `decisionId`.
La présence d’un participant dans un lot ne prouve aucune livraison individuelle.

Le service `sponsorship-golden-path.service.ts` compose les lectures propriétaires
dans une transaction PostgreSQL `REPEATABLE READ READ ONLY` : bilan de
responsabilités, parcours du paiement, accord, prestations et publications.
Il n’effectue ni commande, ni appel fournisseur, ni mutation d’audit. La date
`observedAt` marque le début de la lecture, pas un contrôle fournisseur récent.
Cette transaction ne rend pas les autres observations de la salle atomiques.

Les preuves exposées et compteurs viennent du bilan qualifié, jamais du simple
rapprochement global `fulfilledWithEvidence`. Les dispenses restent distinctes.
La préparation affichée est celle de Funding et de ses reçus d’examen. Ce panneau
ne relit pas les missions ou propositions du service Preflight distant ; leur
consultation et leur adoption restent dans l’Atelier propriétaire.
Une exécution simulée ou incertaine ne devient pas une preuve. Les passages,
formats, cibles, versions et observations de durée restent ceux des propriétaires.
Les brouillons sans obligation exacte ne sont pas attribués à un passage.

La préparation et le workflow utilisent la première page native, limitée à
100 prestations ; une couverture manquante ou une page suivante donne `partial`.
Les obligations et compteurs du bilan restent complets. Une absence d’observation
de préparation n’est ni une absence d’engagement ni une réussite. Une erreur d’un
propriétaire rend le cycle indisponible, sans masquer les observations indépendantes
des moteurs. Le panneau est retiré pendant un rafraîchissement, un changement de
contexte/session ou un échec, comme les autres données privées de la salle.

Contrat : [sponsorship-golden-path.ts](../../packages/funding-core/src/sponsorship-golden-path.ts).
Tests : [projection et échecs](../../tests/sponsorship-golden-path.test.mjs),
[snapshot PostgreSQL](../../tests/integration/sponsorship-golden-path.integration.mjs),
[qualification des preuves](../../tests/integration/admin-responsibility-balance.integration.mjs)
et [navigation FR/EN](../../tests/playwright/admin-engine-room.spec.ts).

### Lecture de la salle

`GET /api/admin/engine-room` (alias `/admin/engine-room`) accepte uniquement
`sponsorshipId` et `deliveryId`, UUID uniques. Les deux filtres se combinent par
intersection. Les paramètres inconnus, répétés ou invalides sont refusés avant
les lectures. Après autorisation, une autre méthode retourne 405, même pour le propriétaire.

L’authentification utilise `ensureAdminAccess`, y compris pour le rôle lecteur.
La salle conserve les frontières Funding : elle n’accède pas à la base Preflight.
Le connecteur utilise uniquement son tenant configuré côté serveur. Les réponses
sont privées et non mises en cache. Aucun diagnostic brut d’exception n’est exposé.

Le contrat public `EngineRoomSnapshot` dans `packages/funding-core/src/engine-room.ts`
décrit deux observations indépendantes. Une source en échec n’efface pas les
faits retournés par l’autre et ne devient pas un résultat vide réussi. Le champ
`observedAt` date le début de la lecture agrégée; les sources ne forment pas un
snapshot transactionnel commun. Connexion et signal de présence ont leurs dates
propres.

## Contexte, fraîcheur et parcours

- Vue globale : destinations et publications retournées par le service natif.
- Dossier : publications du commanditaire et destinations des sources/préparations
  retournées pour ce dossier. Les lectures natives sont limitées et peuvent être
  partielles; un résultat vide ne prouve pas l’absence d’obligations.
- Publication collective : le bouton de Décisions transmet `deliveryId` lorsque
  plusieurs dossiers sont regroupés, sans choisir arbitrairement un commanditaire.
- Le paramètre de navigation `decisionId` sert au retour exact vers Décisions et
  n’est pas envoyé à l’API de supervision. Aucun retour libre vers une URL externe.

Les publications sont limitées à 200 par le service propriétaire. Le signal
`partial` indique cette limite ou une file de préparation paginée. Les observations
de plus de trois minutes sont signalées comme anciennes. Le relais est récent
si son signal date de 45 secondes au plus; un signal absent ou invalide reste
inconnu. Cela ne prouve pas la santé du service distant ni celle du modèle IA.

Ouvrir et actualiser ne lance aucun test de compte, mission ou publication.
Les liens renvoient aux écrans propriétaires pour consulter ou intervenir avec
leurs droits et confirmations. Le panneau d’état ajouté dans Décisions est
remplacé par la salle pour éviter deux diagnostics concurrents.

Les réponses tardives sont invalidées après changement de périmètre, de session,
de rôle ou destruction de page. Un rafraîchissement en échec retire les anciennes
données privées. La page réutilise le cadre et les thèmes admin; les parcours sont
traduits en français et anglais, avec commandes natives accessibles au clavier.

## Flux et référence de charge humaine — chantier 3

La réponse privée ajoute `flowMeasurement`, facultatif pour compatibilité avec
les anciennes API. Le service lit les engagements, dates, publications et preuves
dans une transaction `REPEATABLE READ READ ONLY`. Les lectures sont groupées;
aucun fournisseur, worker ou écriture d’audit n’est déclenché. Les droits restent
ceux de l’endpoint de la salle. Une source en échec rend les mesures inconnues,
sans effacer les autres observations de la salle.

Définition `sponsorship-obligation-flow/v1` : photographie actuelle des obligations
des accords actifs avec offre qualifiée. Le périmètre est global, un dossier,
une livraison, ou l’intersection des deux. Une livraison collective sélectionne
uniquement ses passages exacts, sans inclure les autres prestations des participants.
Les dossiers sans accord qualifié sont exclus et dénombrés. Aucune somme monétaire.

| Mesure             | Définition et limites                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrées            | Obligations uniques créées dans les sept jours glissants `[t0,t1)`, UTC; création technique, pas date du paiement ni d’une étape de traitement                                                                                           |
| Sorties qualifiées | Obligations avec preuve actuellement qualifiée par le service propriétaire et `delivered_at` dans `[t0,t1)`; simulations, déclarations sans preuve et dispenses exclues                                                                  |
| Population         | Partition actuelle en ouvertes, qualifiées et dispensées; les sorties ne se rajoutent pas à cette population                                                                                                                             |
| Âge                | Depuis `sponsorship_obligations.created_at`, sur les seules ouvertes; médiane (moyenne des valeurs centrales si effectif pair), P95 au rang supérieur le plus proche, maximum et effectif; dates inconnues/futures exclues et dénombrées |
| Cycle              | Création → preuve des seules sorties de la fenêtre avec dates cohérentes; médiane/P95 et effectif, jamais durée d’une session humaine                                                                                                    |
| Échéances          | Ouvertes avec échéance dépassée ou sans échéance; l’heure d’évaluation n’est pas un début d’incident                                                                                                                                     |
| Cohortes           | Canal, cible, format, mode actuellement observé et présence d’échéance; mode inconnu ou multiple explicite, aucun score global                                                                                                           |

Les qualificatifs proviennent de `qualifiedSponsorshipEvidenceIds`, y compris les
exigences de durée. Cette photographie peut être révisée après correction des
preuves ou de l’accord; elle ne reconstruit pas un historique immuable des flux.
Les modes des cohortes décrivent l’état observé actuel, pas le mode au moment de
création. Le nombre de sorties distinctes fournit un effectif sur sept jours,
sans taux d’autonomie. Sans échantillon, les durées restent `null`. La durée
d’attente d’une étape, les épisodes d’incident et la capacité humaine ne sont pas
déduits de l’âge ou de la navigation.

Le panneau propose une mesure humaine volontaire par activité : diagnostic,
revue/autorisation, préparation ou résolution d’incident. Elle exige une case
d’accord et un démarrage explicite, utilise une horloge monotone, se met en pause
à la perte de visibilité/focus et reprend uniquement sur demande. Elle ne garde
ni identité, ni visite, ni contenu de dossier et ne transmet rien. Changer de
périmètre/session, quitter la page ou retirer son accord efface les échantillons.
L’actualisation des observations conserve la mesure locale. Les secondes sont
arrondies à l’entier inférieur par activité. Il s’agit de temps déclaré, pas de
preuve d’attention continue. `humanActiveSeconds` et `autonomyRate` restent
inconnus côté API : les sessions existantes ne deviennent pas un indicateur de
travail. Aucune comparaison avant/après ni promesse de gain sans référence réelle.

Les tests dédiés sont `tests/admin-flow-measurement.test.mjs`,
`tests/integration/admin-flow-measurement.integration.mjs` et
`tests/playwright/admin-flow-measurement.spec.ts`. La recette de bilan de
responsabilité vérifie aussi qu’une vraie preuve Web qualifiée alimente les sorties.

Qualification locale du chantier 3 le 25 novembre 2026 sous Node 22.23.5 :
8 205 tests Node réussis et huit exclusions conditionnelles au passage isolé,
avec quatre fichiers en parallèle; 20 tests ciblés réussis après précision de la
médiane sur effectif pair. Le premier passage concurrent du lint avait deux
délais de démarrage d’API; le passage isolé conserve les mêmes délais et passe.
Neuf tests PostgreSQL jetables et 25 parcours navigateur FR/EN réussis, avec
mobile/ordinateur, accessibilité, accord volontaire, pause et effacement.
Build Angular de production (27 routes prérendues), types UI et contrôles
documentaires réussis. Lint global sans erreur avec l’avertissement préexistant
de `scripts/smoke-public.mjs`; lint des fichiers TypeScript modifiés sans erreur.
Ces recettes ne constituent ni une référence de charge de production ni une
qualification à 10 000 contributions par jour.

## Recette et valeur à mesurer

Le chantier 5 fournit les [profils de charge administratifs contrôlés](../development/publication-performance.md#admin-controlled-load)
sur 100, 1 000 et 10 000 dossiers synthétiques, avec latences, débit des lectures,
pool SQL, réservations et limites explicites. La file reste coûteuse à 10 000;
ces mesures locales ne qualifient ni le VPS ni un débit de contributions/jour.

Le chantier 4 ajoute au portefeuille natif un
[aperçu des préparations manquantes](admin-automatic-runs.md#missing-private-preparations),
avec préremplissage commun au générateur existant et lot limité aux dossiers
sélectionnés. Les brouillons présents, y compris les retouches humaines, restent
conservés. Les sources et décisions sont revérifiées par leurs propriétaires;
aucune approbation ni diffusion n’est ajoutée. Les minutes et corrections évitées
restent à mesurer sur une référence comparable, sans gain inventé.

Le chantier 2 ajoute la priorisation par exception dans un composant partagé
avec l’Assistant. La salle lit `getAdminWorkQueue` avec son périmètre exact et
son aperçu; elle ne crée pas une seconde file de décisions. Les motifs et la
responsabilité humain/plateforme proviennent du workflow natif, relu en lot avec
les preuves qualifiées. Un résultat incertain reste urgent; une attente normale
d’exécution autorisée reste informative. Les règles et limites des compteurs sont
décrites dans le [contrat de file](../admin-assistant-overview.md#extension-compatible-du-contrat-de-file).
Une lecture indisponible affiche une observation inconnue. La consultation ne
déclenche aucun envoi, reprise ou changement d’autorisation.

Les tests `tests/operational-priority.test.mjs` couvrent responsabilités, motifs,
échéances, preuves insuffisantes et corrélation collective conservatrice. La
recette `tests/integration/operational-priority.integration.mjs` compare Assistant
et Salle sur PostgreSQL jetable et vérifie l’absence de tentative d’envoi et de
mutation d’audit. Les parcours navigateur correspondants utilisent des fixtures
FR/EN et vérifient liens exacts, mobile et accessibilité automatisée.

Qualification locale du chantier 2 le 25 novembre 2026 sous Node 22.23.5 :
8 196 tests Node réussis (huit exclusions conditionnelles), puis 17 tests ciblés
réussis après ajout des cas de source indisponible; quatre tests PostgreSQL
ciblés et 31 parcours navigateur réussis. Build Angular de production : 27 routes
prérendues; types UI, format et contrôles documentaires réussis. Le lint conserve
uniquement l’avertissement préexistant de `scripts/smoke-public.mjs`. La recette
navigateur a détecté puis confirmé la correction du contraste des liens du
nouveau panneau en thème sombre. Aucune livraison fournisseur réelle n’est qualifiée.

Qualification locale du cycle de reconnaissance le 25 novembre 2026, sous
Node 22.23.5 : build TypeScript et build Angular de production avec 27 routes
prérendues, types UI, 8 181 tests Node réussis et huit exclusions conditionnelles
de la suite, neuf tests PostgreSQL ciblés réussis et 19 parcours navigateur
réussis lors du passage isolé final. Les parcours incluent FR/EN, mobile/ordinateur,
clavier, accessibilité automatisée, preuves distinctes des simulations et
dispenses, sources partielles/absentes et retour au dossier exact.
Le lint global n’a aucune erreur et conserve un avertissement préexistant dans
`scripts/smoke-public.mjs`. Un passage navigateur concurrent de la suite Node
avait dépassé le délai dans deux cas anglais ; le passage isolé final conserve
les mêmes délais et passe sans omission. Les tests PostgreSQL utilisent une base
jetable, les tests navigateur des API interceptées ; aucune opération de
production, migration applicative nouvelle ou connexion fournisseur réelle.

Les tests `tests/admin-engine-room.test.mjs` vérifient projection, périmètre,
droits, absence de mutation HTTP, échecs partiels et interprétation des observations.
Les tests `tests/playwright/admin-engine-room.spec.ts` utilisent des API simulées
sur le Web compilé : FR/EN, mobile/ordinateur, accessibilité, contexte, échec et
réponse tardive. L’entrée depuis Décisions est couverte par
`tests/playwright/admin-decision-focus.spec.ts`.

La recette `tests/playwright/admin-engine-room-acceptance.spec.ts` est reliée au
registre admin et sélectionnée par le lanceur Docker isolé. Elle compare les
observations et réglages API avant/après consultation; sa découverte ne prouve
pas son exécution.

Cette recette ne qualifie ni les fournisseurs réels ni une connexion de production.
La référence humaine du temps de diagnostic reste à mesurer. Utiliser les mêmes
cas avant/après : compte non vérifié, compte expiré, destination en pause, moteur
désactivé, livraison en échec et attente d’approbation. Relever temps jusqu’au bon
diagnostic, nombre d’écrans visités et erreurs de compréhension; ne pas inventer de
pourcentage de gain.

Les commandes unifiées, la supervision des missions distantes et l’élargissement
aux courriels ne sont pas livrés ici. Leur ordre et leurs critères restent dans
l’[analyse des travaux](../development/salle-des-moteurs-intelligents.md).

Le chantier 6 ajoute une [assurance opérationnelle isolée](../operations/admin-identity-and-alerts.md#isolated-operational-assurance) :
cycles bornés sur PostgreSQL jetable, épisodes synthétiques et reprise des ports
natifs après perte de réponse. Le workflow périodique reste optionnel ; cette
recette locale ne mesure pas la disponibilité de la production et n'ajoute pas
de commande à la Salle.

Références propriétaires : [publications](../operations/admin-pilotage.md),
[connecteur Preflight](preflight-connector.md),
[règles de validation](../development/validation.md).
