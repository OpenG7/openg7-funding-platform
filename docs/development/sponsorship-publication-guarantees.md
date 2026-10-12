# Garanties de diffusion des commandites à traiter

Date de cadrage : 11 octobre 2026.

Objectif : conserver chaque avantage promis, répartir les commandites sans oubli,
éviter les conflits de calendrier et prouver la diffusion de chaque bénéficiaire.
Le périmètre couvre les publications sociales collectives et individuelles,
leur préparation, leur approbation, leur envoi et leur suivi administratif.

Statut : travaux à qualifier et à compléter. Certaines protections existent déjà,
mais les cases restent ouvertes jusqu'à vérification du critère dans tous les
parcours concernés. Ce cadrage ne constitue ni une livraison, ni une activation
des envois, ni une modification des engagements existants.

La reprise locale sur `main` est reçue séparément dans le
[compteur des six priorités](sponsorship-publication-tasks.md#progression-des-six-chantiers-autorisés).
Ses preuves techniques ne clôturent pas automatiquement les dix-neuf garanties
dans tous les formats, toutes les cibles historiques ou sur un compte externe.

Les [règles de commandite](sponsorship-rules.md) et le
[runbook de publication](../operations/publication-automation.md) restent les
références du fonctionnement actuel. Les garanties portent sur une reconnaissance
conforme et prouvée. Un nombre de vues, d'impressions ou de réactions nécessite
un engagement et des mesures distincts.

L'[analyse détaillée de la reconnaissance et de la diffusion](sponsorship-visibility-analysis.md)
développe le diagnostic du code, les options photo, les écarts par garantie,
le modèle cible, les étapes de réalisation et les critères de réception.

Le [plan de tâches de réalisation](sponsorship-publication-tasks.md) consigne
le feu vert pour les travaux locaux, leur découpage, les dépendances et les
conditions de clôture. Les cases ci-dessous restent ouvertes jusqu'aux preuves.

## Complément de calendrier et visibilité

Le [complément de sept travaux](sponsorship-publication-tasks.md#calendar-visibility-reception)
part de la PR #309 fusionnée. Les preuves de ce complément sont consignées
séparément des réceptions antérieures : une suite présente dans le dépôt ne
prouve pas son exécution sur la nouvelle révision.

- G04/G05/G16/G17 : la [réception des huit commandites](../../tests/integration/eight-sponsorship-reception.integration.mjs)
  suit 5+3 et 3+3+2 jusqu'aux huit preuves individuelles, avec pause, rejeu et
  réponse perdue puis vérification distante. Les horloges de recette et le
  fournisseur sont synthétiques ; aucune exposition réelle n'est attestée.
- G08/G09/G11 : les nouveaux critères portent sur les propositions des comptes
  partagés, une possibilité hors horizon ou une action explicite, et la progression
  des anciens dossiers sous arrivées répétées. Une possibilité privée ne réserve
  aucun créneau et ne promet pas un délai commercial.
- G03/G14/G16/G17 : une collection LinkedIn conserve chaque JPEG et son URN dans
  l'ordre approuvé. La réconciliation qualifie les références distantes, sans
  prétendre recalculer le hash des octets transformés par le réseau. Facebook et
  les preuves anciennes sans identité média gardent leurs limites dans les
  [contrats de formats](../technical/publication-formats.md).
- G10/G17/G18 : les observations HTTP datées assistent la revue des durées du
  site OpenG7. Elles ne remplacent pas une attestation humaine de continuité et ne
  soldent aucune prestation par le seul écoulement du temps. Les droits et la
  configuration d'une observation restent distincts d'une publication.
- G19 : les [mesures d'arriéré](publication-performance.md) gardent les volumes,
  compteurs et réservations incertaines. Les résultats finaux, échecs et limites
  sont datés dans le plan de tâches.

Les accords historiques non démontrés, les délais des nouvelles offres et la
qualification des comptes réels restent des décisions opérationnelles à
documenter selon le [guide d'adoption](../operations/sponsorship-delivery-adoption.md).
Ce complément ne clôture pas les 19 garanties au-delà des scénarios reçus.

## Registre de réception du complément

Le complément autorisé le 12 octobre 2026 porte sur cinq travaux : report des
correctifs financiers et Checkout, changements de créneau, durées d'exposition,
liens vers les preuves individuelles et réception des garanties. Sa base est
`a7d9ea0`, avec les changements locaux préservés. Les résultats de cette révision
figurent dans le [plan de réception](sponsorship-publication-tasks.md#réception-locale-du-complément).
Les anciennes recettes ne sont pas réattribuées à ce complément.

La table indique les suites propriétaires et ce qui reste à qualifier. Les
commandes effectivement exécutées et leurs résultats figurent dans le reçu
daté du plan; une référence à une suite ne prétend pas qu'elle a été exécutée
dans ce complément. Une
case globale reste ouverte si son critère dépasse la portée reçue. Les formats
pris en charge dans cette réception antérieure étaient texte collectif, portrait
individuel et montage JPEG ; la collection de plusieurs images y restait
indisponible. Le complément de sept travaux reçoit depuis la collection LinkedIn
localement. Les fournisseurs sont simulés dans ces réceptions. Une activation ou
une qualification réelle est distincte.

<!-- prettier-ignore -->
| Garantie | Preuve locale propriétaire | Condition restante avant clôture globale |
| --- | --- | --- |
| G01 | [Offres et engagements](../../tests/integration/sponsorship-commitments.integration.mjs), [activation financière](../../tests/integration/sponsorship-payment-activation.integration.mjs) : montant/devise confirmés, rejeu, changement d'offre et historique inconnu. | Qualifier chaque accord historique ; aucun avantage dérivé du barème actuel. |
| G02 | [Passages successifs](../../tests/integration/publication-draft-passages.integration.mjs) et [calendrier](../../tests/integration/publication-calendar-boundaries.integration.mjs) : obligation conservée, déplacement et refus humain. | Recevoir chaque chemin de report et d'annulation avec les nouveaux raccords. |
| G03 | [Reconnaissance finale](../../tests/publication-recognition.test.mjs), [éléments Web requis](../../tests/integration/sponsorship-website-required-elements.integration.mjs) et [pipeline visuel](../../tests/integration/publication-visual-pipeline.integration.mjs). | Qualifier le contenu effectivement reçu par chaque adaptateur réel. |
| G04 | [File rendue](../../tests/integration/publication-rendered-queue.integration.mjs) : surplus conservé et aucune troncature des bénéficiaires. | Recette transversale des huit dossiers sur chaque format pris en charge. |
| G05 | [Composition](../../tests/publication-composite.test.mjs), [reconnaissance](../../tests/publication-recognition.test.mjs) et [file rendue](../../tests/integration/publication-rendered-queue.integration.mjs) : texte complet et caractères multioctets. | Qualifier la limite du compte réel ; 2 900 caractères reste une limite applicative du parcours. |
| G06 | [Concurrence de capacité](../../tests/integration/publication-capacity-concurrency.integration.mjs) et [composition des membres](../../tests/integration/publication-membership-rendering.integration.mjs). | Recevoir toute mutation de membres, lot et créneau sous concurrence. |
| G07 | [File rendue](../../tests/integration/publication-rendered-queue.integration.mjs) : première source trop longue, autres sources admises, correction et nouvelle revue. | Vérifier le maintien de l'ancienneté dans une file représentative. |
| G08 | [Préparation](../../tests/publication-automation-planning.test.mjs) et [file rendue](../../tests/integration/publication-rendered-queue.integration.mjs). | L'ordre local et le scan de 400 ne prouvent pas une absence de famine sous concurrence ; mesurer et recevoir ce critère. |
| G09 | [Fiabilité globale](../../tests/integration/publication-reliability.integration.mjs) et [calendrier](../../tests/integration/publication-calendar-boundaries.integration.mjs). | Recevoir une date proposée ou une cause exploitable au-delà de l'horizon, pour chaque dossier admissible. |
| G10 | [Fiabilité](../../tests/publication-reliability.test.mjs), [détecteurs](../../tests/admin-attention-publication-detectors.test.mjs) : âge, saturation, incidents et alertes. | Fixer et recevoir le délai commercial, son départ et les périodes suspendues ; aucun délai n'est inventé. |
| G11 | [Réservations du compte](../../tests/integration/publication-account-reservations.integration.mjs) et [calendrier](../../tests/integration/publication-calendar-boundaries.integration.mjs). | Qualifier les comptes effectifs et leurs limites ; l'espacement technique ne vaut pas quota fournisseur. |
| G12 | [Baux du worker](../../tests/integration/publication-worker-claims.integration.mjs) et [réservations](../../tests/integration/publication-account-reservations.integration.mjs) : pause, reprise et compte partagé. | Mesurer l'espacement sur une cible qualifiée, sans transformer une reprise en nouvelle autorisation. |
| G13 | [Dates et fuseaux](../../tests/publication-date-time.test.mjs), [worker](../../tests/publication-automation-delivery-worker.test.mjs) et [baux](../../tests/integration/publication-worker-claims.integration.mjs). | Recevoir le franchissement d'échéance pendant la préparation et la marge commerciale choisie. |
| G14 | [Calendrier](../../tests/integration/publication-calendar-boundaries.integration.mjs) et [gardes de modération](../../tests/integration/moderation-publication-guards.integration.mjs) : ancienne approbation révoquée, nouvelle date à approuver. | Aucun résultat en vol ou incertain ne peut être déplacé ou libéré. |
| G15 | [Gardes de modération](../../tests/integration/moderation-publication-guards.integration.mjs), [droits média](../../tests/integration/sponsor-media-usage.integration.mjs) et [termes Web](../../tests/integration/sponsorship-website-terms.integration.mjs). | Recevoir consentement, paiement, remboursement partiel, média et refus sur chaque chemin d'envoi. |
| G16 | [Baux](../../tests/integration/publication-worker-claims.integration.mjs), [réconciliation](../../tests/integration/publication-reconciliation-visibility.integration.mjs) et [Checkout](../../tests/checkout-attempts.test.mjs). | Qualifier la lecture distante et l'identité exacte des images ; l'inconnu conserve son hold. |
| G17 | [Preuves](../../tests/integration/sponsorship-fulfilment.integration.mjs), [durées](../../tests/integration/sponsorship-obligation-timing.integration.mjs), [preuves Web](../../tests/integration/sponsorship-website-required-elements.integration.mjs) et [suivi privé](../../tests/playwright/sponsorship-offer.ui.ts). | Durées limitées au site OpenG7 avec clôture justifiée ; aucune observation ponctuelle ne prouve seule une continuité. |
| G18 | [Progression](../../tests/integration/sponsorship-progress.integration.mjs), [fiabilité globale](../../tests/integration/publication-reliability.integration.mjs) et [suivi privé](../../tests/playwright/sponsorship-offer.ui.ts). | Recevoir lisibilité FR/EN, navigation clavier/mobile et coût des lectures sur une file représentative. |
| G19 | [Matrice de validation](validation.md) et [réception datée](sponsorship-publication-tasks.md). | Consigner les commandes réellement exécutées, résultats, omissions et qualification externe séparée. |

Pour clôturer un périmètre local, enregistrer la révision exacte ou l'empreinte
du patch, la commande, la date, le nombre de réussites/échecs/omissions et le
scénario du critère. Un résultat de compilation, un compteur de tests global ou
la présence d'un test ne suffit pas à solder les lignes de ce registre.

## Garanties et critères de traitement

- [ ] **G01 Conservation des avantages promis.** Conserver par dossier les
      contreparties convenues : canal, destination, formule collective ou individuelle
      et nombre de passages, lorsqu'ils font partie de l'engagement.
      **Critère :** modifier les paramètres ou les offres ne réduit pas les avantages
      d'une commandite existante sans décision explicite et tracée.

- [ ] **G02 Report sans perte de droit.** Une commandite écartée d'un lot conserve
      son avantage à fournir tant qu'elle reste admissible. Report, annulation de lot
      et refus de brouillon restent distincts d'une diffusion réalisée.
      **Critère :** déplacer ou annuler un lot laisse chaque avantage non livré
      identifiable, avec sa prochaine étape; un refus humain n'est pas contourné
      par une nouvelle préparation automatique.

- [ ] **G03 Présence réelle dans le contenu final.** Chaque bénéficiaire doit
      apparaître dans la publication approuvée, avec son nom et les éléments
      explicitement promis. Une simple appartenance au lot ne suffit pas.
      **Critère :** retirer un commanditaire du texte ne permet pas de solder son
      avantage; une mention manquante bloque l'approbation ou impose de revoir
      les bénéficiaires et leur affectation.

- [ ] **G04 Aucune suppression silencieuse pour raccourcir.** Ne pas tronquer
      une publication collective au risque d'effacer ses derniers participants.
      Réduire le groupe ou proposer une rédaction plus courte à valider.
      **Critère :** un dépassement conserve les participants exclus dans la file
      et signale la nouvelle répartition avant approbation.

- [ ] **G05 Calcul sur le texte définitif.** Compter noms, titres, résumés, liens,
      séparateurs et mentions de commandite après toutes les transformations.
      Appliquer la limite effective du parcours et du canal à chaque modification
      et avant approbation.
      **Critère :** couvrir la limite exacte, son dépassement et les caractères
      représentés par plusieurs unités UTF-16; aucun ajout final ne dépasse la limite.

- [ ] **G06 Respect simultané des deux capacités.** Respecter le nombre maximal
      de commandites et la longueur maximale du texte, avec des réservations atomiques.
      **Critère :** deux opérations concurrentes ne prennent pas la même dernière
      place; les créations et les modifications ne produisent aucun lot hors limites.

- [ ] **G07 Un texte trop long ne bloque pas les autres.** Isoler pour correction
      une commandite qui dépasse la limite même seule, puis continuer la préparation
      des autres. Conserver son ancienneté et son avantage en attente.
      **Critère :** un premier brouillon trop long déclenche un blocage visible pour
      ce dossier; les dossiers suivants admissibles sont néanmoins planifiés.

- [ ] **G08 File équitable et sans oubli.** Définir un ordre stable d'attribution.
      Conserver l'ancienneté après report; tracer les priorités exceptionnelles.
      **Critère :** des nouvelles arrivées répétées ne repoussent pas indéfiniment
      les anciens dossiers; une correction de contenu ne remet pas son dossier
      arbitrairement en fin de file.

- [ ] **G09 Nouvelle date ou absence de place explicite.** Affecter le surplus
      aux prochains créneaux admissibles. Suivre aussi les dossiers situés au-delà
      de l'horizon du calendrier.
      **Critère :** chaque dossier en attente expose un prochain créneau proposé
      ou une absence de place motivée; aucun dossier non affecté ne disparaît du suivi.

- [ ] **G10 Délai cible et alerte de retard.** Définir un délai cible configurable
      et son point de départ. Montrer la cause du retard et alerter lorsqu'il est dépassé.
      **Critère :** distinguer capacité insuffisante, approbation manquante, contenu
      bloqué et incident; une saturation durable exige une décision administrative.
      La capacité disponible et les validations nécessaires conditionnent tout délai
      de diffusion promis.

- [ ] **G11 Prévention globale des chevauchements.** Utiliser une réservation
      commune pour les créations automatiques, manuelles, éditoriales, déplacements
      et reprises. Calculer les conflits par compte fournisseur effectif et canal,
      même lorsque plusieurs destinations internes utilisent le même compte.
      **Critère :** des demandes simultanées sur le même compte ne peuvent réserver
      des heures incompatibles avec l'intervalle minimal; des comptes distincts
      restent indépendants.

- [ ] **G12 Espacement entre les publications effectives.** Appliquer l'intervalle
      minimal aussi à l'envoi, y compris après pause, panne ou redémarrage.
      **Critère :** plusieurs publications échues ne partent pas ensemble sur le
      même compte; le retard supplémentaire et les étapes de reprogrammation
      sont visibles, sans modifier silencieusement une autorisation.

- [ ] **G13 Horaires fiables.** Comparer les instants dans un référentiel commun
      et les afficher dans le fuseau choisi. Traiter explicitement changements d'heure
      et créneaux échus. Définir une marge de préparation avant échéance.
      **Critère :** couvrir l'instant exact du créneau, les heures inexistantes ou
      ambiguës et les changements de fuseau; une proposition trop tardive reçoit
      une date exploitable sans prétendre être autorisée.

- [ ] **G14 Approbation préservée lors des reports.** L'autorisation porte sur
      le contenu exact, les participants, le média, la destination, le mode et l'horaire.
      Toute modification pertinente exige une nouvelle approbation.
      **Critère :** aucun changement de lot ou de date ne réutilise une autorisation
      obsolète; le planificateur conserve les modifications et les refus humains.

- [ ] **G15 Exceptions métier explicites.** Un consentement retiré, un paiement
      devenu inadmissible, un dossier refusé ou un média invalide bloque l'envoi avec
      une raison visible. Refus de publication et refus de commandite restent distincts.
      **Critère :** revalider les faits avant l'envoi; une exception ne déplace pas
      automatiquement l'avantage vers un autre canal ou une autre destination.

- [ ] **G16 Reprise sans doublon ni disparition.** Relier les tentatives à une
      même livraison logique. Réconcilier un résultat fournisseur incertain avant
      tout renvoi; conserver les obligations des participants retirés ou déplacés.
      **Critère :** une réponse perdue après création externe, un worker concurrent
      ou un redémarrage ne crée pas une seconde publication pour la même livraison;
      la réparation reste autorisée, limitée et auditée.

- [ ] **G17 Avantage livré sur preuve vérifiable.** Solder un avantage uniquement
      après une diffusion réelle confirmée, sur la bonne destination, pour les
      bénéficiaires présents dans le contenu. Conserver contenu approuvé, date,
      identifiant fournisseur et lien disponible.
      **Critère :** préparation, programmation et simulation ne soldent aucun avantage;
      distinguer la preuve historique d'une publication et sa visibilité actuelle.

- [ ] **G18 Suivi individuel, alertes et audit.** Afficher avantages dus et livrés,
      prochaine date, blocages et reports pour chaque dossier. Conserver acteur,
      raison et historique des décisions. Détecter les écarts internes.
      **Critère :** retrouver tout dossier admissible sans place, tout retard et
      tout incident; les compteurs et listes concordent avec les preuves de livraison,
      même au-delà des limites d'une page de résultats.

- [ ] **G19 Validation des cas difficiles.** Vérifier les comportements et leurs
      échecs pertinents avec des données synthétiques et des fournisseurs simulés,
      puis qualifier séparément les capacités réelles de l'environnement cible.
      **Critère :** couvrir les cas de recette ci-dessous avec les changements
      fonctionnels; chaque garantie clôturée référence sa modification et ses preuves.

## Recette de référence

Exemple synthétique : huit commandites admissibles attendent sur le même canal
et la même destination, sans dossier antérieur. La capacité autorise huit membres,
mais le texte complet n'en accepte que trois par publication. Avec trois créneaux
futurs libres, la préparation propose des lots de trois, trois et deux membres.
Les huit avantages restent à fournir jusqu'aux diffusions réelles correspondantes.
Chaque lot reçoit son approbation; l'espacement convenu reste applicable.

| Cas                                                                   | Résultat attendu                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Texte à la limite puis ajout d'un participant                         | Le texte valide est conservé; le participant en surplus reste suivi.           |
| Premier brouillon trop long même seul                                 | Une correction est demandée pour ce dossier; les suivants avancent.            |
| Suppression d'un nom après constitution du lot                        | Aucun avantage du participant absent n'est considéré comme livré.              |
| Calendrier saturé ou horizon sans date future                         | Absence de place visible, ancienneté conservée et alerte selon le délai cible. |
| Deux réservations concurrentes de la dernière place                   | Aucun dépassement de capacité ni doublon d'affectation.                        |
| Publication manuelle et récurrente au même horaire                    | Le conflit est détecté et refusé par la même règle serveur.                    |
| Deux destinations internes utilisant le même compte                   | La règle d'espacement s'applique au compte commun.                             |
| Plusieurs publications échues après une pause                         | L'envoi respecte l'espacement effectif et expose le retard.                    |
| Changement de participants, texte, photo ou horaire après approbation | L'autorisation précédente ne permet plus l'envoi.                              |
| Créneau exactement maintenant ou changement d'heure                   | Aucun instant invalide ou ambigu n'est accepté comme nouvelle date autorisée.  |
| Retrait du consentement avant envoi                                   | Blocage explicite sans diffusion ni avantage fictivement livré.                |
| Réponse perdue après création du message externe                      | Réconciliation avant toute nouvelle tentative; aucune relance aveugle.         |
| Simulation réussie ou redémarrage pendant une tentative               | Aucun avantage livré fictivement, aucune publication logique supplémentaire.   |

## Décisions à fixer avant implémentation

- Intervalle minimal entre publications sur un même compte, et éventuel plafond
  de publications par période. Les trente minutes du programme actuel constituent
  un point de départ à qualifier, pas une règle universelle déjà appliquée.
- Délai cible, point de départ, marge avant échéance et traitement des périodes
  de blocage ou de pause.
- Éléments de reconnaissance obligatoires selon l'offre, et procédure de correction
  lorsqu'un texte ou un média ne permet pas de les respecter.
- Traitement d'une publication ultérieurement supprimée ou modifiée, selon
  la durée de visibilité éventuellement convenue.

## Photos des commanditaires

Le parcours texte accepte une image approuvée commune au lot. Les formats
portrait et montage JPEG utilisent désormais une photo qualifiée propre à
chaque dossier concerné, avec droits de transformation et crédit exacts.
L'aperçu est le fichier final de l'envoi ; aucune photo absente n'est remplacée
silencieusement. Une collection LinkedIn peut conserver de deux à dix photos,
une par commanditaire, dans l'ordre exact approuvé. Les collections Facebook
restent indisponibles. Le [contrat des formats](../technical/publication-formats.md)
décrit les capacités, les reprises et les qualifications externes restantes.

Une offre avec photo propre à chaque commanditaire doit préciser sa formule :
publication individuelle avec sa photo, ou évolution vers un format collectif
qui restitue les éléments promis à chacun. Définir la sélection, le consentement,
les droits d'utilisation et l'équité visuelle avant d'en faire un engagement.
L'approbation d'une photo dans un dossier ne vaut pas autorisation de diffusion.

## Ordre de traitement proposé

| Étape          | Garanties | But                                                                                               |
| -------------- | --------- | ------------------------------------------------------------------------------------------------- |
| 1              | G01 à G09 | Conserver les obligations, garantir la présence des bénéficiaires et gérer le surplus sans oubli. |
| 2              | G10 à G14 | Réserver les horaires communs, maîtriser les retards et préserver l'approbation exacte.           |
| 3              | G15 à G18 | Traiter les exceptions, réconcilier les incidents et produire un suivi fiable.                    |
| À chaque étape | G19       | Vérifier les comportements réellement modifiés avant de clôturer les garanties.                   |

Pour chaque case clôturée, consigner la date, la référence de modification,
les contrôles exécutés, leur portée et les limites restantes. L'implémentation
met à jour les contrats et guides propriétaires concernés dans le même changement.
