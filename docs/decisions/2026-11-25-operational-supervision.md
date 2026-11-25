# Supervision et scalabilité opérationnelle

Date : 25 novembre 2026. Statut : principes retenus pour guider les évolutions.
La première tranche locale est décrite dans la [référence de supervision](../technical/engine-room.md) ;
les tranches suivantes restent proposées, sans activation ni migration.

## Contexte

La croissance des contributions peut accroître les prestations promises et la
charge administrative. Funding possède déjà engagements versionnés, preuves,
files, réservations, sessions reprenables et projections de responsabilité.
L’[analyse du dépôt](../development/operational-scalability-analysis.md) relie ces
mécanismes aux dix parcours administratifs et précise leurs limites.

## Décisions

1. Concevoir pour une supervision progressive : évaluer chaque évolution selon
   la charge humaine, la capacité productive, les garanties, l’observabilité et
   la reprise. Les volumes 1/100/1 000/10 000 contributions par jour sont des
   hypothèses de dimensionnement, pas des prévisions ou capacités certifiées.
2. Conserver les dix Happy Paths comme références fonctionnelles. Décrire mission,
   déclencheur, objets, étapes, droits, invariants, preuves, blocages et reprise.
   Une navigation, un test et une réussite métier sont des résultats distincts.
3. Prendre le cycle de reconnaissance d’une commandite comme premier Golden Path :
   paiement confirmé, accord, examen, préparation, autorisation, exécution, preuve
   et suivi. Relier la même contribution et ses obligations exactes, y compris
   collectifs et passages multiples. Ne pas créer d’étape humaine obligatoire
   pour observer ou faire avancer une opération déjà autorisée.
4. Dériver l’observation des objets propriétaires. Séparer définition, instance,
   progression personnelle, état opérationnel et preuve. Réutiliser missions
   Preflight, obligations, livraisons et reçus ; aucun moteur de workflow ou
   registre concurrent sans besoin démontré.
5. Définir les moteurs par capacité métier. Preflight prépare des propositions
   selon son contrat ; les contrôles ultimes Funding restent déterministes.
   L’Atelier prépare et accueille l’examen ; l’Assistant explique les interventions
   et oriente ; la Salle compose les observations ; l’Audit conserve le contexte.
   Aucun de ces outils n’acquiert l’autorité d’un autre par simple agrégation.
6. Définir l’autonomie par capacité : manuel, observation, assistance, exécution
   explicitement autorisée, puis autonomie encadrée par une politique explicite.
   Cette direction ne modifie pas les confirmations et autorisations actuelles.
7. Préserver Stripe comme autorité financière et les validations serveur pour
   droits, consentements, médias et publications. L’IA peut proposer ; elle ne
   fabrique ni paiement, ni autorisation, ni preuve. Préparation, autorisation,
   tentative et livraison qualifiée restent séparées.
8. Conserver idempotence, versions, reçus, limites et audit pour tout effet.
   Réconcilier l’incertitude avant reprise ; ne pas confondre absence de réponse
   et absence d’effet. Les arrêts et reprises restent dans les services natifs.
9. Dériver la dette opérationnelle des engagements restants, sans double compter
   leurs alertes et leurs envois. Livraisons, dispenses et engagements non qualifiés
   restent séparés. Ne pas transformer ce suivi en dette monétaire.
10. Donner à tout indicateur une définition, une provenance, une date, une portée,
    une unité et une complétude. État activé, présence de processus et résultat
    métier sont distincts. Ne pas inventer de capacité libre, taux ou coût réalisé.
11. Distinguer tests logiciels, missions synthétiques contrôlées et observation
    des opérations réelles. Une synthétique ne provoque aucun paiement,
    remboursement ou envoi social réel ; aucune réparation sensible implicite.
12. Mesurer avant de distribuer davantage l’architecture ou de matérialiser des
    projections. Préférer des lectures cohérentes et des optimisations ciblées
    qui conservent les gardes, plutôt que déplacer ou dupliquer le métier.

## Conséquences et premier chantier

Le premier chantier recommandé est une observation GP1 en lecture seule par
commandite, composée depuis les services actuels. Mesurer séparément la valeur
humaine — temps de diagnostic et navigation — et la fiabilité — corrélation,
droits, preuve exacte et absence d’effets. Les critères et étapes proposés sont
dans l’analyse ; ils ne constituent pas une livraison logicielle.

Le coût assumé est une composition explicite de domaines possédant des versions
et dates différentes. Rendre cette limite visible est préférable à un statut
global rassurant sans preuve. Une projection matérialisée future devrait rester
reconstruisible et ne jamais devenir une seconde autorité financière ou éditoriale.
