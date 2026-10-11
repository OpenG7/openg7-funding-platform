# Blocs de reconnaissance conservés dans le texte final

Statut : retenu pour le premier lot local sur
`feat/sponsorship-publication-foundations`, le 11 octobre 2026.

Le snapshot d'une livraison conserve ses membres et leurs textes sources. Il ne
prouve pas que le message libre les contient encore. Rechercher simplement leur
nom laisserait une mention incidente ou un homonyme satisfaire le mauvais dossier.

La politique pure de `funding-core` associe donc à chaque source un bloc complet :
titre, corps et mention de commandite. L'API fournit le nom public depuis le dossier,
indépendamment du titre modifiable. Un titre standard contenant cette identité
suffit; un titre personnalisé reçoit une ligne `Partenaire : <nom public>`.
Chaque source exige une occurrence distincte, délimitée par des paragraphes.
Les blocs les plus longs sont vérifiés en premier et leurs plages ne se chevauchent
pas : un bloc cité à l'intérieur du corps d'une autre source ne suffit pas.

Les comparaisons normalisent Unicode en NFC et les fins de ligne. Elles permettent
le déplacement de blocs complets et le texte ajouté autour. La limite de 2 900
unités UTF-16 porte sur le message réellement enregistré, y compris séparateurs,
mentions et ajouts. Une transformation éditoriale qui retire un bloc ou dépasse
ce budget est abandonnée au profit de la composition complète. Aucun membre n'est
retiré pour faire tenir le message.

L'approbation, la vérification avant envoi et la finalisation des livraisons
automatiques vérifient cette même politique. Une édition privée peut préparer un texte incomplet; elle révoque
l'approbation et ce texte ne peut être approuvé ni finalisé. Modifier un bloc exige
une correction du brouillon source, une recomposition et une nouvelle approbation.
Les contrôles existants de paiement, consentement, version, revue et média gardent
leur autorité. Les anciens snapshots restent inchangés; aucune migration ne les
réécrit pour les faire réussir.

Le périmètre est celui des `publication_deliveries` de commandite avec `batch_id`.
Les mutations manuelles de statut des lots/créneaux et les jobs sociaux historiques
n'utilisent pas ce contrôle; leur convergence reste un travail distinct. Une
preuve issue de ces chemins ne devient pas une preuve de conformité au nouveau
contrôle.

Une liste structurée de seuls éléments commerciaux obligatoires offrira davantage
de liberté éditoriale lorsque les offres figées et obligations seront disponibles
en SP02/SP19. Dans ce premier lot, protéger le bloc complet évite de deviner ce qui
peut être supprimé. Cela peut bloquer un ancien texte abrégé jusque-là autorisé;
l'opérateur doit le revoir. Cette politique ne livre pas encore le report équitable,
l'isolement des textes trop longs, les obligations durables ou la preuve des photos.

Références : [tâches SP07/SP08](../development/sponsorship-publication-tasks.md#sp07),
[politique](../../packages/funding-core/src/publication-recognition.ts),
[tests](../../tests/publication-recognition.test.mjs) et
[reprise administrative](../operations/publication-automation.md#exceptions-and-recovery).
