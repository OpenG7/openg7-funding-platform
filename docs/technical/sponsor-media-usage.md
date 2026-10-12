# Autorisations et préférences d’image

Les contrats sont définis dans `packages/funding-core/src/sponsor-media-usage.ts`.
La migration additive `044_sponsor_media_usage.sql` conserve les fichiers
historiques en `needs_confirmation` : ni l’ancien paiement, ni une ancienne
approbation, ni une préférence ne crée une autorisation d’usage.
Les anciennes photos gérées par `sponsor_media_assets` cessent d’être visibles
jusqu’à qualification des droits et nouvelle revue du contenu courant. Les
fichiers restent conservés ; cette interruption ne vaut ni suppression ni accord.

Le suivi privé demande explicitement les canaux, destinations, transformations,
crédit et restrictions avant un téléversement. Une qualification administrative
exige la référence privée de l’autorisation obtenue. Les droits initiaux et leurs
modifications sont conservés dans un historique immuable, avec acteur et requête.
Le portail, l’annuaire et les courriels ne reçoivent pas cette référence privée.

`POST /api/sponsorship-followup/media/usage` vérifie le jeton, le propriétaire,
la version du fichier, la confirmation et la clé de requête. Son équivalent admin
vérifie aussi les droits et la confirmation de l’identifiant du fichier. Même clé
et contenu : même reçu ; une autre intention avec cette clé est refusée. Une
réponse incertaine conserve la même demande. Modifier ou retirer les droits remet
le fichier en revue, invalide sa N0 et bloque les prochains envois concernés.
Le retrait ne prétend pas supprimer une publication déjà diffusée ailleurs.

Une restriction libre exige une lecture humaine explicitement confirmée et auditée
avant l’approbation N0 du contenu courant. Le contrôle d’envoi revalide les droits,
le canal, la destination, les transformations, la revue et le crédit exact.

Les demandes de préférence ou de correction utilisent une révision du dossier et
une clé de requête. L’équipe décide avec une explication externe et confirmation.
Une préférence acceptée ne sélectionne pas automatiquement une photo et ne donne
aucun droit supplémentaire. Une photo supprimée ou retirée reste identifiée comme
indisponible ; aucun autre fichier ne la remplace silencieusement.

Les aperçus sociaux utilisent le JPEG final préparé par la même chaîne que l’envoi.
Leur accès admin exige livraison, version et hash ; le client contrôle ces valeurs
et les octets reçus. Un aperçu du fichier source ne permet pas d’approuver l’envoi.
Portrait et montage nécessitent une photo propre à chaque commanditaire, une N0
courante et les transformations explicitement autorisées. Nom et crédit restent
complets ; un dépassement du budget est refusé.

L’annuaire sert des WebP contrôlés. Sa preuve fige le premier fichier de
présentation et le logo qualifié choisis par la projection publique, avec leurs
versions, hashes, usages et crédits. Les crédits exacts accompagnent ces images
dans l’annuaire. Avant une nouvelle transition visible, le service vérifie hors
transaction la présence, le checksum, le format et les dimensions des WebP
privés. Il revalide en transaction la sélection, les versions, les droits et la
revue ; un fichier absent, corrompu ou changé ne crée ni visibilité ni réalisation.
Cette capture conserve `visibility: unknown` : elle ne vérifie aucune réponse
HTTP publique et ne prétend pas que le JPEG social est affiché. Le point d’accès
média refuse aussi les octets dont le checksum diffère du contenu revu.
Les logos legacy hors `sponsor_media_assets` restent des déclarations historiques.
Ils ne servent ni à une nouvelle preuve qualifiée, ni aux nouveaux dérivés, ni à
une nouvelle publication explicite du site sans média propre qualifié. Les
représentations déclaratives de ces logos déjà visibles sont conservées.

Voir les [règles commandites](../development/sponsorship-rules.md) et le
[runbook de publication](../operations/publication-automation.md) pour les
autorisations commerciales, la reprise et les effets externes.
