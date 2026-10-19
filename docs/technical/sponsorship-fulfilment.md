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

La lecture de preuve expose aussi `obligationVersion` et `deliveryVersion`, issus
des colonnes immuables de la preuve. La première désigne la version de la prestation
capturée avant son solde ; le solde incrémente ensuite l'obligation courante sans
modifier ce fait historique. La seconde désigne la version de la livraison sociale
capturée, et vaut `null` pour une preuve Web sans livraison sociale. Ces valeurs ne
sont jamais calculées depuis les versions courantes de l'obligation, de la livraison
ou de l'accord. Elles ne décrivent pas la version historique globale de l'accord,
qui n'est pas enregistrée dans cette preuve.

Les deux propriétés sont additives et optionnelles dans le contrat partagé pour
accepter une ancienne réponse API. Leur absence est affichée comme non renseignée,
sans substituer une version courante ni `0`. La projection est commune au dossier,
à Campagnes et au suivi privé ; elle n'expose aucun snapshot interne, acteur,
identifiant de compte fournisseur ni contenu privé supplémentaire. Aucune migration
ni écriture de preuve ne change.

Le site OpenG7 utilise `website_verified` après une transition de visibilité
explicitement autorisée pour une prestation sans durée fixe, ou après
l'attestation humaine distincte d'une durée promise. Dans les deux cas, le
consentement, le paiement admissible, la présentation approuvée et la N0 actuelle
sont revalidés. Une approbation de dossier seule ne constitue pas une preuve.
Une obligation pour le site OpenG20 ne peut pas
être soldée par la visibilité du site OpenG7. Rejouer une décision inchangée ne
solde pas un second passage.

Les éléments exigés par l'accord sont vérifiés dans la sélection exacte attestée.
Un logo approuvé pour Facebook seul, absent de l'annuaire, ne satisfait pas
`approved_logo`. L'absence d'un élément requis renvoie `REQUIRED_ELEMENTS_MISSING`
(409) et annule atomiquement la transition, l'audit et le solde. Le logo reste
facultatif dans les offres qui ne l'exigent pas.

Une durée fixe est qualifiable uniquement pour le site OpenG7. L'affichage initial
enregistre une observation datée avec les sources exactes, sans solder la durée.
Après le minimum écoulé, le propriétaire doit confirmer une continuité documentée
avec raison, justificatif privé, version et confirmation de l'obligation. L'API
revalide alors les fichiers, sources et autorisations exacts. Un masquage, une
modification ou des périodes qui se chevauchent imposent un nouveau point de
départ. La seconde observation, l'attestation humaine immuable, la preuve, le
solde, l'audit et la notification sont atomiques et idempotents.
Une horloge ou deux observations seules ne constituent jamais une preuve de
continuité; aucun contrôle continu de disponibilité n'est livré. Les autres
destinations gardent `duration_unsupported`. Voir les
[échéances et durées](sponsorship-obligation-timing.md).

Les preuves historiques déjà créées restent immuables. L'
[audit historique](sponsorship-historical-audit.md) compare leurs faits enregistrés
aux termes de l'accord et permet un examen propriétaire séparé; une conclusion
n'efface ni une lacune détectée ni l'ancien solde commercial.

La visibilité et le solde commercial gardent leurs propres gardes. Un remboursement
partiel confirmé n'empêche pas la transition d'un dossier qui reste admissible à
l'annuaire, y compris sans accord qualifié. Les obligations bloquées par ce
remboursement ne reçoivent ni preuve de réalisation ni notification de solde.
Un remboursement demandé, en cours ou total continue de bloquer la transition.

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

Le panneau de [fiabilité](publication-reliability.md) conserve les compteurs
globaux et propose une lecture paginée au-delà des 50 corrélations de l'extrait.
Les liens ouvrent le dossier ou l'objet concerné avec l'action attendue; ils ne
réconcilient aucun résultat et n'autorisent aucune reprise automatiquement.

## Projections privées et notifications

Le suivi authentifié et la progression administrative exposent seulement les
preuves du dossier sélectionné : identifiant, obligation, livraison, canal,
destination, provenance, date, lien public et dernière observation de visibilité.
Les clés privées des objets, contacts d'autres dossiers et notes internes ne sont
pas transférés. En l'absence d'observation, la visibilité est `unknown` ; chaque
observation reste datée.

Dans le portail privé, un passage réalisé mène à sa preuve seulement si les
identifiants de preuve et d'obligation, le canal et la destination correspondent
exactement. Une ancre locale place le focus clavier sur la preuve sans
réintroduire le jeton privé retiré de l'URL après accès. Un passage restant ou
une référence incohérente ne reçoit pas de
lien de réalisation. Les dates d'observation et de fin minimum d'une durée
restent distinctes d'une preuve de réalisation ou d'une attestation de continuité.

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
[éléments requis affichés](../../tests/integration/sponsorship-website-required-elements.integration.mjs),
[durées et remboursements partiels](../../tests/integration/sponsorship-website-terms.integration.mjs),
[calendrier, attestations et migration existante](../../tests/integration/sponsorship-obligation-timing.integration.mjs),
[examens des preuves historiques](../../tests/integration/sponsorship-historical-audit.integration.mjs),
[réconciliation et visibilité](../../tests/integration/publication-reconciliation-visibility.integration.mjs)
et les tests de notifications des engagements. Elles utilisent des dossiers
synthétiques et PostgreSQL jetable. Le
[plan de réception](../development/sponsorship-publication-tasks.md) indique les
résultats exécutés et les critères qui restent ouverts ; la présence de cette
référence ne vaut pas réception complète ni activation réelle.
