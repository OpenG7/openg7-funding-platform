# Preuves de reconnaissance des commandites

Le paiement, l'accord commercial, la revue, la visibilité et la publication
restent distincts. Les [engagements](sponsorship-commitments.md) identifient chaque
passage par obligation, canal, destination, ordinal et version. Un ancien statut
`published`, une préparation ou une simulation ne constitue pas sa preuve.

## Autorisation et solde

L'approbation administrative capture `publication_deliveries.obligation_snapshot`
et réserve une obligation ouverte pour chaque participant. Deux approbations ne
peuvent pas réserver le même passage. Les gardes relisent les conditions et la
version avant chaque appel fournisseur et avant la finalisation. Une correction
de destination ou une dispense révoque l'ancienne autorisation ; elle ne change
ni le paiement ni la N0 et ne provoque aucun nouvel envoi.

La migration 043 crée les réservations et `sponsorship_fulfilment_evidence`.
La migration 046 permet de libérer une réservation par `UPDATE`, avec
`released_at`, sans étendre les droits `DELETE` du rôle API. Les migrations
antérieures ne sont pas réécrites. Les preuves sont immuables ; leur clé étrangère
vérifie qu'elles appartiennent à l'obligation et au dossier concernés.

La migration 049 lie les nouveaux brouillons à une obligation propre et conserve
chaque brouillon publié dans son lot historique. Un passage suivant reçoit un
nouvel identifiant ; la déclaration historique `published` ne solde aucun
engagement et ne bloque pas sa préparation. Le premier passage conserve son
ordre d'admissibilité, les suivants entrent dans la file à leur préparation.

Un succès réel contient le compte effectif, le mode, le texte intégral, les
snapshots des sources et du média, leur empreinte, la version de livraison,
la référence distante, la date et la provenance. `provider_acknowledged` décrit
un acquittement après envoi ; `provider_verified` décrit une lecture de
réconciliation qualifiée. La contrainte interdit qu'une même publication distante
solde deux passages du même dossier, canal et destination. Chaque ordinal est
soldé séparément, dans la même transaction que sa preuve et son audit.

Le site OpenG7 utilise `website_verified` uniquement après une transition de
visibilité explicitement autorisée, avec consentement, paiement admissible,
présentation approuvée et N0 actuelle. Une approbation de dossier seule ne
constitue pas cette transition. Une obligation pour le site OpenG20 ne peut pas
être soldée par la visibilité du site OpenG7. Rejouer une décision inchangée ne
solde pas un second passage.

Avant cette transition, l'API lit les fichiers privés réellement sélectionnés
pour l'annuaire, hors transaction PostgreSQL. Elle vérifie leur présence,
l'empreinte SHA-256, le format WebP et les dimensions déclarées. La transaction
relit ensuite la sélection exacte, ses versions, ses droits et sa N0 avant la
visibilité et avant la preuve. Un stockage indisponible, un fichier absent ou
une version modifiée bloque la transition et le solde. L'absence du port de
stockage ne permet aucun contournement. Ce contrôle de fichier ne prétend pas
avoir observé la page publique par HTTP : sa visibilité distante reste inconnue
tant qu'elle n'a pas été vérifiée séparément.

## Incertitude et visibilité

L'acquittement fournisseur est conservé indépendamment de la finalisation.
Un échec ultérieur garde un résultat incertain ; la réserve du compte et celle
de l'obligation empêchent une nouvelle diffusion aveugle. Aucune atomicité entre
le fournisseur et PostgreSQL n'est annoncée : une interruption avant persistance
ou une base durablement inaccessible exige une investigation.

La réconciliation lit un snapshot, termine sa transaction, vérifie le fournisseur,
puis verrouille à nouveau la version actuelle. Aucun HTTP ne garde une transaction
ouverte. Un changement concurrent de décision ne peut pas être remplacé par la
lecture ancienne. Une image dont l'identité exacte n'est pas vérifiable reste dans
l'investigation appropriée ; un refus d'accès ou une lecture impossible ne prouve
pas l'absence d'une publication.

La commande `check-visibility` exige une preuve qualifiée. Elle ajoute une
observation datée `visible`, `changed`, `missing` ou `unknown` dans
`sponsorship_fulfilment_visibility`, sans réécrire le fait livré. Les adaptateurs
actuels classent accès refusé, réponse 404 et timeout en `unknown`, faute de preuve
de suppression certaine. Une observation ne déclenche ni remboursement, ni
renvoi, ni nouvelle autorisation. Voir
[le runbook de publication](../operations/publication-automation.md).

## Projections privées et notifications

Le suivi authentifié et la progression administrative exposent seulement les
preuves du dossier sélectionné : identifiant, obligation, livraison, canal,
destination, provenance, date, lien public et dernière observation de visibilité.
Les clés privées des objets, contacts d'autres dossiers et notes internes ne sont
pas transférés. En l'absence d'observation, la visibilité est `unknown` ; chaque
observation reste datée.

Les événements d'ajustement, de date approuvée et de solde utilisent la file de
courriels persistante existante. Le destinataire vient du paiement confirmé.
Une date approuvée en mode `mock` n'enfile aucune notification `date_approved` ;
la notification de date sociale exige une autorisation actuelle en mode `live`.
L'événement doit correspondre à une mutation, une autorisation ou une preuve réelle
et à sa version exacte. La clé de dédoublage contient événement, obligation et
version ; le worker d'envoi n'intervient qu'après commit. Les essais locaux ne
contactent aucun destinataire réel. Voir [SMTP](../email-smtp.md).

## Vérification

Le port public `sponsorship-fulfilment.repository.ts` conserve ses exports.
L'[écriture des preuves](../../apps/funding-api/src/sponsorship-fulfilment/evidence-write.ts)
regroupe persistance immuable, solde, audit et notification dans la transaction
du demandeur. Le [contrôle d'annuaire](../../apps/funding-api/src/sponsorship-fulfilment/website-evidence.ts)
reste distinct de la preuve sociale et de la projection privée dans `evidence.ts`.
Cette extraction structurelle ne change ni les conditions de solde ni les
observations de visibilité.

Les suites propriétaires sont
[solde exact et rôle API](../../tests/integration/sponsorship-fulfilment.integration.mjs),
[fichiers et versions de l'annuaire](../../tests/integration/sponsorship-website-storage.integration.mjs),
[réconciliation et visibilité](../../tests/integration/publication-reconciliation-visibility.integration.mjs)
et les tests de notifications des engagements. Elles utilisent des dossiers
synthétiques et PostgreSQL jetable. Le
[plan de réception](../development/sponsorship-publication-tasks.md) indique les
résultats exécutés et les critères qui restent ouverts ; la présence de cette
référence ne vaut pas réception complète ni activation réelle.
