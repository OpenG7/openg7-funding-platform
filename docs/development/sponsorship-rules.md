# Commandites, publications et médias

À lire pour les parcours public/admin, services, packages ou tests de commandite,
publication et média. Complète les [garde-fous communs](../../AGENTS.md#garde-fous).

## Reconnaissance, revue et visibilité

Contribution personnelle et intérêt/commandite d'entreprise ont des champs,
consentements et bénéfices distincts. Définir les montants et avantages dans la
configuration partagée, les tester et les montrer avant paiement. Ne pas changer
rétroactivement les engagements existants sans décision explicite. Les valeurs
actives se trouvent dans `DEFAULT_SPONSORSHIP_PRICING_CONFIG` et la configuration
Funding Web; la politique est décrite dans le [guide commanditaires](../public-sponsors.md).

Revue (`pending`, `approved`, `refused`), paiement, consentement, visibilité et
publication sont distincts. Toute approbation conserve acteur, date et note/raison
pertinente; un refus conserve l'historique financier. Les contrats réels de code
font foi sur les noms exacts des états.

Publication (`not_planned`, `planned`, `drafted`, `published`, `hidden`) : contenu
validé, liens externes conservés, cibles `openg7`/`openg20` et canaux
`facebook`/`linkedin` explicites. Paiement sans publication automatique; masquage
sans effacement d'historique. Les actions sensibles sont confirmées et auditées.

## Publication différée autorisée

Lire le [runbook de publication](../operations/publication-automation.md) avant de
modifier préparation, approbation, worker ou reprise. L'envoi exige l'approbation
administrative du contenu exact, de sa version, du média, de la destination, du
mode et de l'horaire. Modifier révoque l'autorisation; préparer n'approuve pas.
Le worker revalide consentement, admissibilité, contenu et média avant envoi.
Résultat externe ambigu : quarantaine, aucune relance aveugle; attestation humaine
d'absence motivée et auditée avant nouvelle autorisation.

La préparation privée (migration 023) accepte paiement confirmé et consentement
même avec revue en attente. « Accepter et programmer » peut réunir approbation du
commanditaire et autorisation de publication : IDs/versions explicites, photo
approuvée, transaction et audit de chaque décision. La fiche nouvellement approuvée
reste masquée jusqu'à une décision de visibilité séparée. Un refus de publication
ne refuse pas le commanditaire et ne doit pas être annulé par le planificateur.
Préserver modifications humaines et autorisations existantes. Migrations 022/023
et activation live contrôlées; feeds initialement en pause, worker désactivé.

## Médias

- Abstraction de stockage; métadonnées et références stables en DB, binaires hors DB.
- Taille maximale configurée, MIME autorisés et contenu réel vérifié lorsque
  possible; dimensions/transformation lorsque requises. Clés générées côté serveur.
- Nom original non fiable : aucune traversée de chemin ni contenu exécutable servi
  depuis une origine applicative de confiance.
- Média privé tant que non approuvé; exposition publique limitée aux médias et
  dossiers admissibles. Respecter aussi le maintien privé après approbation sociale.
- Suppression/remplacement audités, nettoyage sûr des objets orphelins, stratégie
  de sauvegarde et migration du stockage.
- Logo et au moins une image selon les règles produit : valider les exigences
  côté API avant publication, pas uniquement dans le formulaire.

Voir les guides [commanditaires](../public-sponsors.md) et
[stockage OVH](../operations/ovh-object-storage.md) pour leurs contrats et opérations.

## Validation

Couvrir séparation paiement/revue, consentement public, transitions de revue,
logo/image valide ou invalide, publication autorisée, masquage, feed,
remboursement et audit. Pour l'envoi différé : approbation obsolète, modification,
révocation des sources, concurrence, résultat incertain et absence de doublon.
Appliquer la [matrice commune](validation.md); une simulation fournisseur ne prouve
pas un envoi réel.
