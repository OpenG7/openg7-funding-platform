# Échéances et durées des prestations

Les termes `deadlineDays` et `durationDays` de l'offre immuable restent distincts.
Une échéance n'autorise aucune publication, ne dispense aucune obligation et ne
crée aucun remboursement. La durée ne se solde jamais au premier affichage.

## Échéance enregistrée

La migration additive [051](../../apps/funding-api/migrations/051_sponsorship_obligation_timing.sql)
copie les termes enregistrés dans une table de calendrier par obligation. Elle
n'infère aucune date historique et ne change aucun ancien solde ou preuve.

Les nouvelles obligations copient leurs termes sans supposer le point de départ
du délai. Le snapshot actuel enregistre un nombre de jours, sans dire que celui-ci
court depuis le paiement, l'acceptation ou la qualification. L'activation ne doit
donc pas reporter une échéance déjà promise. Le propriétaire précise l'origine
avec la preuve de l'accord, y compris pour une nouvelle qualification historique.
Chaque passage reçoit ensuite l'échéance origine + `deadlineDays` jours de 24 heures
UTC; aucun délai supplémentaire par ordinal n'est inventé. Un rejeu ne décale
jamais ces dates. Les offres Checkout actuelles ne promettent aucun délai fixe.

Pour une obligation avec délai et origine inconnue, le propriétaire peut
enregistrer une fois une origine appuyée par un document privé. La commande exige
UUID, version du calendrier, confirmation de l'obligation, date UTC passée ou
présente à partir de 2000, raison et référence de preuve. Les termes et l'origine
enregistrée sont immuables. Une date erronée demande un examen administratif plutôt
qu'un remplacement silencieux.

L'état « en retard » concerne seulement les obligations encore ouvertes et
apparaît strictement après l'échéance. Les compteurs internes sont indépendants de
la page ou des filtres de la liste de fiabilité. Une origine inconnue est signalée
séparément; aucun retard n'est fabriqué à partir d'une date supposée.

## Durée avec preuve et décision humaine

Seules les prestations du site OpenG7 peuvent être qualifiées avec une durée fixe.
Les réseaux sociaux et OpenG20 restent refusés à la qualification pour ce terme,
car aucun parcours de contrôle de durée n'y est livré.

1. Une décision explicite de visibilité sur le site OpenG7 enregistre une
   observation privée datée, avec la version de la contribution, les décisions N0,
   le texte et les fichiers WebP réellement revalidés. Une commande de reprise de
   l'observation exige elle aussi propriétaire, confirmation, version et raison.
2. Une fois la durée minimum écoulée, le propriétaire examine les preuves privées
   de continuité. Il confirme expressément cette continuité avec une raison et une
   référence documentaire, puis sélectionne l'observation de début.
3. L'API revalide les fichiers hors transaction, verrouille les faits et vérifie
   l'autorisation courante, la présence publique, les exigences promises et
   l'identité exacte des sources et médias. Une observation d'un autre dossier,
   une durée trop courte, une version obsolète ou un fichier absent bloque le solde.
4. Le solde, la seconde observation, l'attestation humaine immuable, l'audit et la
   notification en file sont atomiques. Le rejeu conserve le même résultat sans
   produire de seconde preuve ni notification.

Un masquage suivi d'un nouvel affichage ou une modification des sources,
autorisations ou droits invalide l'ancien point de départ. L'historique reste
conservé; une nouvelle observation et une nouvelle période sont nécessaires.
La lecture affiche alors `restart_required` pour les restrictions ou changements
connus dans les faits locaux. L'ancienne date reste historique; elle n'est pas
une date d'interruption mesurée. Le formulaire propose une nouvelle observation
et retire l'attestation de cette observation invalidée. Cette projection ne lit
aucun fichier, n'effectue aucune requête publique et n'atteste aucune continuité.
Cette règle est conservatrice : une modification administrative qui change la
version de la contribution peut également nécessiter un nouveau départ.

Si l'accord prévoit plusieurs passages, un passage suivant commence seulement
après le solde ou la dispense des précédents. Une ancienne observation qui
précède leur clôture ne peut pas solder une seconde durée. Les périodes restent
distinctes, et le rejeu d'un solde antérieur conserve sa preuve.

Deux observations et une horloge ne prouvent pas une continuité. Le solde repose
sur une attestation humaine motivée et ses pièces privées, avec des bornes
techniques vérifiées. Le serveur ne prétend pas avoir observé chaque requête de la
page publique ni garantir la disponibilité permanente du site.

## Observations HTTP périodiques, désactivées par défaut

La migration additive [054](../../apps/funding-api/migrations/054_sponsorship_public_visibility_observations.sql)
ajoute des échantillons immuables liés à l'obligation et à son observation de début.
Elle ne crée aucune nouvelle période, preuve de réalisation ou attestation. Les
lectures du dossier exposent seulement date UTC, état, motif stable et statut HTTP;
aucune URL, image, justificatif ou corps reçu n'est conservé dans ce DTO.

Le [worker](../../apps/funding-api/src/sponsorship-timing/visibility-worker.ts) est
activé uniquement par `FUNDING_SPONSORSHIP_VISIBILITY_ENABLED=true`, avec une origine
serveur `FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN` HTTPS explicite. Ces paramètres sont
propagés au conteneur API par Compose. L'origine appartient à l'application;
aucune adresse de commanditaire ni URL fournie par le navigateur n'est consultée.
Les seuls chemins lus sont l'annuaire `/api/public/sponsorships` et les médias
`/api/public/sponsor-media/<UUID>` attendus. Il ne vérifie pas le rendu du navigateur,
les pages HTML, les réseaux sociaux, OpenG20 ou la disponibilité de chaque instant.

Intervalle : 900 secondes par défaut, configurable de 60 à 86 400 secondes.
Lot : cinq obligations par défaut, configurable de une à vingt. Chaque passage
partage des plafonds HTTP de 45 secondes, 48 requêtes et 16 Mio reçus. Chaque requête
dispose d'au plus trois secondes, résolution DNS comprise; une page JSON est
limitée à 256 Kio et une image à 8 Mio. Un contrôle recherche au plus deux pages.
Le curseur de page du dossier est conservé pour le prochain contrôle. Le curseur
durable des obligations avance juste avant le contrôle de chaque candidat,
même si l'enregistrement échoue. Un budget épuisé arrête le passage; les dossiers
non commencés ne reçoivent aucune observation ni date de contrôle et passent
devant ceux déjà essayés au prochain passage. Le bail advisory PostgreSQL empêche deux
processus de contrôler simultanément le même ensemble. Aucune transaction n'est
maintenue pendant HTTP; le résultat est enregistré après revalidation des versions,
du début et des autorisations courantes. Les observations et leur audit sont
atomiques; un échec d'enregistrement ne devient pas un contrôle réussi. Chaque
statement de cette connexion est borné à cinq secondes; sa configuration initiale
est restaurée avant de rendre la connexion au pool.

Un verrou de session par obligation couvre la requête et l'enregistrement. Une
attestation de durée concurrente est refusée sans attendre avec
`DURATION_OBSERVATION_IN_PROGRESS`; relire le résultat avant une nouvelle décision.
Une modification de l'origine contractuelle seule n'efface pas un résultat HTTP
du même début. Une nouvelle observation de début, version éditoriale ou source
différente rend le résultat ancien `unknown`. Les échecs de transport consomment
leur plafond réservé d'octets; ils ne réinitialisent pas le budget du passage.

Le DNS est résolu puis épinglé pour chaque connexion TLS. Toutes les adresses
doivent être publiques; loopback, réseaux privés, adresses de documentation et
transitions IPv6 sont refusés. Redirections, corps compressés, taille excessive et
formats inattendus ne sont pas acceptés. Ni cookie ni secret d'administration
n'est envoyé. Les tests injectent un transport et des surfaces synthétiques;
l'activation réelle exige une cible et une instruction distinctes.

`visible` signifie identité, texte, crédits et octets attendus observés à cet
instant. Un contenu/octet différent produit `changed`; un média contrôlé répondant
404 produit `not_visible`, sans prétendre connaître sa suppression ou sa cause.
Ils imposent `restart_required` pour le début affecté et bloquent une attestation
de cette période, même si un échantillon ultérieur est sain. Les périodes déjà
invalidées ne sont plus échantillonnées avant une nouvelle observation humaine.
Une recherche de dossier incomplète, un problème réseau, une réponse inaccessible
ou un changement concurrent restent `unknown`. Des pages lues à des instants
différents ne prouvent jamais l'absence globale d'un dossier. Ces incidents sont
datés dans le panneau temporel et l'audit, sans compensation ou republication.
L'inconnu demande un examen des pièces de continuité; il n'est pas une preuve
d'interruption ni de disponibilité. Aucun temps écoulé ni succession d'échantillons
ne solde une obligation; l'attestation humaine motivée reste obligatoire.

## Contrats et validation

Les commandes `origin`, `observe` et `duration` partagent la version du calendrier,
distincte de la version éditoriale de l'obligation. Enregistrer une origine ou une
observation n'invalide donc aucune autorisation sociale. Les justificatifs et les
snapshots restent privés; le DTO de calendrier ne contient que dates, états et
identifiant d'observation.

Le port public [sponsorship-obligation-timing.ts](../../apps/funding-api/src/sponsorship-obligation-timing.ts)
expose les commandes. Le [port de lecture](../../apps/funding-api/src/sponsorship-obligation-timing.read.ts)
reste indépendant des mutations et fournit une projection SQL commune pour les
fiches et listes.

La recette PostgreSQL utilise uniquement une base jetable, des fichiers
synthétiques et des points de départ datés explicitement dans la fixture pour
exercer les frontières temporelles. Elle ne démontre pas une exposition réelle de
plusieurs jours ni une disponibilité de production. Aucun courriel réel, paiement,
remboursement ou envoi social n'est exécuté.
