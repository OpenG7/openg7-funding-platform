# Analyse de mise en œuvre de la modération des commandites

Date : 11 octobre 2026. Source : [politique de modération V1.0](../OpenG7_Politique_Moderation_Commandites_V1.docx).
Référence de code : `818901c07141e7480fb5194563aafbd5f34dd735`, complétée par les
changements locaux de `feat/sponsorship-publication-foundations` examinés à cette date.

La V1.0 demande une décision humaine motivée, liée au contenu exact et à une
politique versionnée, puis un parcours de correction et de réexamen. Sa réalisation
exige des changements de contrats, de persistance, d'autorisation et de parcours,
en plus du remplacement des textes. Le socle de paiement, les états de publication,
les dossiers, les médias et le journal d'audit existants restent leurs sources de vérité.

Statut : **analyse initiale et suivi du chantier local**. Le tableau MOD01 à MOD25
conserve les critères du plan initial. L'implémentation locale ajoute le service
transactionnel N0–N5, les gardes transversales, les parcours administratifs et
privés, les textes FR/EN et l'acceptation versionnée préparée. Les migrations
034–040 sont vérifiées sur PostgreSQL jetable, y compris l'adoption de contenus
déjà publics sans décision fictive. Les contrats actuels et limites figurent dans
le [runbook de modération](../operations/sponsorship-moderation.md).

La charte contractuelle demeure inactive dans l'attente de sa validation.
L'assistance locale textuelle est facultative et limitée; l'OCR, l'exploration
réseau isolée, la qualification d'un corpus, les suppressions sociales réelles
et les durées de purge demandent encore les choix et validations identifiés
ci-dessous. La présence de leurs contrats ou aperçus ne prouve pas leur livraison.
Le chantier ne déploie aucune modification ni n'exécute de migration de production.

La source distingue les orientations éditoriales approuvées de la charte publique,
des clauses contractuelles et des délais encore proposés. Les textes peuvent être
préparés dans l'application; leur activation comme conditions publiques exige la
validation prévue par la V1.0. Les objectifs de cinq et dix jours ouvrables restent
internes tant que la capacité opérationnelle n'est pas confirmée.

## Garanties existantes et écarts

| Domaine                | Comportement actuel                                                                                                                               | Changement nécessaire                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dossier commanditaire  | Revue humaine, note libre obligatoire au refus, version attendue et confirmation dans l'UI; le contrat API de revue ne porte pas de confirmation. | Codes structurés, contenu et politique examinés, décision durable, confirmation serveur et explication externe distincte.     |
| Courriel de refus      | Le message commanditaire et `reviewNote` sont tous deux rendus dans le courriel.                                                                  | Retirer la justification interne de la projection et du DTO de notification; conserver une explication externe autorisée.     |
| Médias                 | Décision approuvé/refusé, version, acteur et contrôle de visibilité.                                                                              | Motif et justification du refus, version du fichier examiné, correction ciblée et liens vers les décisions.                   |
| Brouillons historiques | États de revue et publication; `reviewNote` facultative.                                                                                          | Appliquer les mêmes décisions et gardes, y compris à l'approbation et à la déclaration manuelle de publication.               |
| Livraison sociale      | Approbation humaine, confirmation/version, refus révoquant l'autorisation; audit sans motif éditorial dédié.                                      | Lier l'autorisation à une décision valide sur le rendu exact et imposer un motif aux décisions défavorables.                  |
| Approbation groupée    | L'approbation de livraison peut approuver directement plusieurs dossiers dans une transaction.                                                    | Créer ou référencer une décision valide pour chaque dossier et pour la publication finale, sans contourner le service commun. |
| Worker                 | Réservation, version croissante, bail, sources et médias revalidés; résultats tardifs conservés.                                                  | Vérifier aussi les décisions actives, les restrictions et la version éditoriale avant tout nouvel appel d'envoi.              |
| Texte final            | Le travail local protège les blocs des bénéficiaires et contrôle le budget du message.                                                            | Examiner le rendu final complet; corriger les sources si un bloc protégé contient un contenu refusé.                          |
| Suivi privé            | État de refus générique, contact support, corrections bloquées après refus du dossier.                                                            | Afficher une explication privée, les possibilités de correction et les demandes de réexamen autorisées.                       |
| Politique publique     | Contrôle éditorial présenté comme refus d'un contenu incompatible, trompeur ou risqué.                                                            | Charte FR/EN contextualisée, motifs définis, proportionnalité et recours; acceptation versionnée avant Checkout.              |
| Identité               | Rôles `reader`, `operator`, `owner`, droits API et sessions.                                                                                      | Droits de modération explicites et séparation vérifiée des personnes pour décisions et recours graves.                        |
| Historique             | Notes, états courants, audits et snapshots techniques existants.                                                                                  | Adoption traçable sans inventer d'approbation, de motif, de version de politique ou de date d'acceptation.                    |

Les références principales sont les [décisions de commandite](../../apps/funding-api/src/admin-sponsorship-decisions.http.ts),
le [template de refus](../../apps/funding-api/src/services/email/sponsorship.templates.ts),
les [commandes de livraison](../../apps/funding-api/src/publication-automation/commands.ts),
les [brouillons](../../apps/funding-api/src/fund-publication-drafts.repository.ts) et
les [contrats de livraison](../../packages/funding-core/src/publication-automation.ts).
La note actuelle ne doit pas être renommée en justification confidentielle en
conservant son branchement vers `reviewReason` dans les courriels.

## Motifs à intégrer

Le catalogue partagé doit porter les 17 codes de la V1.0, leurs libellés FR/EN,
leur définition, leurs conditions d'usage et les décisions compatibles. Un motif
principal et des motifs secondaires sont possibles. La catégorie décrit le
contenu examiné; elle ne qualifie pas pénalement une personne ni une entreprise.

| Code                        | Objet de la revue                                                                 | Traitement indiqué par la V1.0                       |
| --------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `HATE_TARGETED`             | Attaque haineuse liée à une appartenance réelle ou supposée.                      | Refus.                                               |
| `DEHUMANIZATION`            | Présentation de personnes comme sous-humaines ou indignes de droits fondamentaux. | Refus.                                               |
| `DISCRIMINATION`            | Traitement discriminatoire ou exclusion injustifiée.                              | Correction ou refus.                                 |
| `TARGETED_HARASSMENT`       | Humiliation ciblée, intimidation répétée ou encouragement au harcèlement.         | Correction ou refus.                                 |
| `THREAT`                    | Menace crédible de préjudice ou intimidation violente.                            | Refus et escalade adaptée.                           |
| `VIOLENCE_INCITEMENT`       | Encouragement ou instruction à commettre une violence.                            | Refus et escalade adaptée.                           |
| `VIOLENCE_GLORIFICATION`    | Célébration d'une violence ciblée pour encourager ou légitimer celle-ci.          | Refus.                                               |
| `EXPLOITATION`              | Abus, exploitation ou promotion de tels actes.                                    | Refus.                                               |
| `SEXUAL_CONTENT`            | Contenu explicite incompatible avec l'espace public de commandite.                | Correction ou refus.                                 |
| `PRIVACY_VIOLATION`         | Divulgation abusive de renseignements privés ou exposition malveillante.          | Retrait ou refus.                                    |
| `FRAUD_IMPERSONATION`       | Fraude, usurpation ou présentation délibérément trompeuse.                        | Suspension ou refus.                                 |
| `MISLEADING_CLAIM`          | Affirmation commerciale trompeuse, non étayée ou publicité déguisée.              | Justificatif ou correction.                          |
| `ELECTORAL_ADVERTISING`     | Publicité électorale ou partisane commanditée exclue du programme.                | Refus de publication.                                |
| `ILLEGAL_CONTENT`           | Diffusion susceptible d'être illégale dans la juridiction applicable.             | Suspension, analyse et refus si établi.              |
| `IP_RIGHTS`                 | Utilisation non autorisée de marque, œuvre, photo ou identité.                    | Justificatif ou correction.                          |
| `EXTERNAL_LINK_RISK`        | Destination frauduleuse, dangereuse ou incompatible.                              | Correction ou refus.                                 |
| `EDITORIAL_INCOMPATIBILITY` | Violation d'une règle éditoriale expressément identifiée.                         | Correction ou refus motivé avec disposition précise. |

Le serveur valide les codes, interdit les doublons et impose la disposition précise
pour `EDITORIAL_INCOMPATIBILITY`. Les définitions doivent guider la revue du contexte:
opinion controversée, critique politique ou religieuse, citation, dénonciation,
information, art et satire ne déclenchent pas à eux seuls un refus. Le catalogue
ne constitue pas un filtre de mots. Le périmètre des groupes visés, les exclusions
publicitaires et les modalités d'escalade doivent être explicités avant activation.

## Niveaux de décision et effets

| Niveau | Décision                   | Effet à construire                                                                                                                             |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| N0     | Approuver.                 | Décision valide sur la version examinée; visibilité et autorisation d'envoi restent des actions distinctes.                                    |
| N1     | Demander une correction.   | Instructions externes précises, champs modifiables limités, nouvelle version soumise; aucune autorisation conservée sur le contenu à corriger. |
| N2     | Suspendre l'examen.        | Motif, informations attendues et responsable; envoi bloqué, dossier et obligations conservés.                                                  |
| N3     | Refuser un élément.        | Cibler le média, le brouillon ou la livraison; ne pas refuser automatiquement les autres éléments du dossier.                                  |
| N4     | Refuser le dossier.        | Décision grave motivée, revue indépendante, invalidation des autorisations dépendantes et suivi financier séparé.                              |
| N5     | Retirer un contenu public. | Masquage du site et traitement distinct du contenu externe; revue indépendante pour les retraits graves.                                       |

Ces niveaux ne remplacent pas `paid`, `refunded`, les états de revue, les états de
livraison ou les obligations de reconnaissance. Le cas de modération possède son
état de traitement; les projections existantes sont mises à jour dans la même
transaction lorsque la décision les affecte. Un refus ne solde pas un avantage
comme livré et ne déclenche pas automatiquement un remboursement.

L'identité de la personne ayant décidé doit être conservée. Une décision N4 ou
un retrait grave N5 exige la revue indépendante prévue par la source. Le contrôle
minimum doit conditionner ces décisions dès leur activation, même si le cockpit
complet de seconde revue arrive ensuite. Une suspension de protection doit rester
possible lorsqu'un second examinateur n'est pas disponible. Une demande de
réexamen ne rétablit ni la visibilité ni une autorisation d'envoi.

Un masquage conservatoire urgent doit pouvoir protéger les personnes pendant
l'examen, avec cible, motif, acteur et audit. Cette mesure temporaire et sa
confirmation indépendante restent distinctes d'une décision finale de retrait grave.

## Modèle de données et frontières

Le domaine de modération s'ajoute aux domaines existants. Les contrats publics
et règles pures appartiennent à `packages/funding-core` selon les conventions
actuelles; les cas d'usage, transactions et adaptateurs appartiennent à l'API.
Le Web consomme les projections autorisées. Aucun package partagé n'importe l'API
et aucune nouvelle file d'envoi sociale concurrente n'est créée.

| Entité proposée                | Données et contraintes                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version de politique           | Identifiant, version, empreinte, règles FR/EN, date d'effet et statut. Distinguer l'approbation éditoriale de la disponibilité de la charte publique et de ses clauses.                                              |
| Version de contenu             | Sujet typé, dossier propriétaire, révision éditoriale, empreinte et snapshot minimal du contenu examiné. Références/versions des médias et sources, rendu final pour publication.                                    |
| Cas de revue                   | Sujet, version examinée, état de traitement, affectation, priorités et décision courante. L'état courant est une projection du suivi, pas une réécriture de l'historique.                                            |
| Décision                       | Identifiant, niveau/résultat, motif principal/secondaires, disposition éventuelle, justification interne, explication externe, acteur authentifié, date serveur, politique et contenu examinés, décision précédente. |
| Réexamen                       | Décision contestée, demandeur autorisé, texte borné, révision attendue, état, examinateur indépendant lorsque requis et décision résultante.                                                                         |
| Acceptation de charte          | Version/empreinte montrée et acceptée, date serveur, langue, opération Checkout et dossier lorsqu'il est créé. Ne pas inventer une identité nominative pour un visiteur anonyme.                                     |
| Observation de retrait externe | Publication distante concernée, décision, compte/canal, tentative, résultat et preuve; séparation de l'état de visibilité locale.                                                                                    |

Les noms SQL restent à fixer lors de MOD03. Le sujet doit distinguer au minimum
dossier, média, brouillon historique et livraison finale: un UUID seul et le scope
`PUBLICATION` ne suffisent pas à distinguer les deux tables de publication.
La présentation publique d'un dossier inclut le résumé écrit par l'admin, le nom,
les slogans et les liens effectivement affichés. Le message privé du commanditaire
ne doit pas être exposé pour constituer une preuve publique.

La révision éditoriale est distincte de la version de verrouillage. Le
[claim worker](../../apps/funding-api/src/publication-automation/claims.ts) augmente
`publication_deliveries.version` sans changer le contenu; `fund_contributions.updated_at`
peut aussi changer pour une opération financière ou de visibilité. Une décision
ne doit donc pas devenir obsolète simplement parce qu'un worker réserve la livraison.
Inversement, remplacer les octets d'une image, une source, le rendu public ou la
destination doit produire l'invalidation correspondante. Le contenu examiné et
l'autorisation technique d'envoi sont deux références explicites.

Les décisions sont conservées sans réécriture. Décision, projections affectées,
audit et réservation de notification sont atomiques; l'envoi du courriel intervient
ensuite par la file existante. Même identifiant de requête et même contenu donnent
le même résultat logique; un contenu différent avec la même clé donne un conflit.
Les détails sensibles restent dans un stockage privé protégé. L'audit général
porte des identifiants, codes, résultat et corrélation, sans copie inutile de
contenu problématique, notes privées, secret ou destinataire.

Les droits de lecture doivent être explicites, en plus des droits de mutation.
La politique administrative actuelle autorise généralement les lectures GET aux
comptes admin hors exceptions; une nouvelle route de preuve sensible ne doit pas
hériter de ce comportement sans examen. L'identité vient de la session API et la
seconde revue compare des personnes stables, pas deux identifiants de session.
Les durées de conservation des preuves, du portail, des courriels et des sauvegardes
peuvent différer. Une purge ne réécrit pas l'audit financier et respecte un maintien
exceptionnel documenté.

Le schéma inventorié finit à `033`. Une migration `034` est envisageable seulement
si ce numéro reste libre au moment de la création. Prévoir des migrations additives
numérotées pour noyau/décisions, acceptations, recours et retraits, selon les lots.
Ne modifier aucune migration historique. Vérifier les droits du rôle applicatif,
les contraintes de sujet, les index des cas ouverts et des décisions par sujet,
ainsi que les contraintes d'unicité pour requêtes et notifications.

## API et chemins de mutation

| Surface actuelle                                             | Mise à niveau                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/admin/sponsorships/review`                             | Payload structuré, décision versionnée, notes séparées, audit/outbox atomiques, rôle et confirmation.                                |
| `/api/admin/sponsorships/media/review`                       | Décision par média, empreinte du fichier, motif, invalidation ciblée des dépendances et explication externe.                         |
| `/api/admin/publication-drafts/update`                       | Motif obligatoire pour refus; revue/version du brouillon; garde sur approbation et déclaration de publication.                       |
| Publication manuelle de lots/créneaux                        | Même décision éditoriale; validation des membres et de la preuve, sans contourner le contrôle par absence de `publication_delivery`. |
| Commandes de livraison `approve`, `reject`, `edit`, `cancel` | Référence de décision et de contenu; qualifier l'annulation technique distinctement d'un refus éditorial.                            |
| Approbation groupée de commanditaires                        | Même service de revue et décisions par dossier, suivi de la publication collective et conditions photo existantes.                   |
| Fiche publique et publication sur le site                    | Revue du résumé réellement exposé, consentement et garde de modération pour visibilité et médias publics.                            |
| Pilotage et commandes clavier/Gamepad                        | Contrat et validation identiques, formulaire de motif lorsque nécessaire; aucun raccourci de rejet sans décision.                    |
| Suivi privé et uploads                                       | Lecture de l'explication externe; droits de correction limités au cas/version et au dossier autorisés.                               |
| Checkout                                                     | Acceptation versionnée vérifiée côté API pour les nouveaux dossiers concernés et incluse dans l'empreinte idempotente.               |

Créer les lectures et commandes de modération dans une frontière API propriétaire,
avec les deux conventions de route existantes `/api/admin/` et `/admin/` si les
alias sont conservés. Les chemins exacts des cas, décisions et réexamens sont à
fixer avec les contrats, plutôt que laisser chaque écran inventer son endpoint.
Les lectures privées commanditaires utilisent le mécanisme d'accès existant;
elles n'acceptent jamais un identifiant de décision comme autorisation autonome.

Tout échec de motif, version, politique, confirmation, droit ou audit interdit la
mutation et ses effets. Prévoir des codes stables pour motif manquant/invalide,
contenu modifié, politique indisponible, décision obsolète, réexamen indisponible
et seconde revue requise. Distinguer une restriction éditoriale, une panne de
stockage et un refus technique du fournisseur social.

Les principaux fichiers sont les [contrats de revue](../../packages/funding-core/src/sponsorship-contracts.ts),
les [décisions persistées](../../apps/funding-api/src/sponsorship-decisions.repository.ts),
la [revue média](../../apps/funding-api/src/admin-sponsorship-media.http.ts),
les [mutations média](../../apps/funding-api/src/sponsor-media/persistence-write.ts),
les [routes de brouillons](../../apps/funding-api/src/admin-publication-drafts.http.ts),
les [lots](../../apps/funding-api/src/fund-publication-batches.repository.ts),
les [créneaux](../../apps/funding-api/src/fund-publication-calendar.repository.ts) et
l'[exécution du pilotage](../../apps/funding-api/src/admin-pilotage/execution.ts).

## Protection de la publication et de la reconnaissance

L'approbation d'envoi doit référencer le texte exact, le média/son dérivé, les
sources, les bénéficiaires, la décision éditoriale, la destination, le mode et
l'horaire. Les changements éditoriaux invalident la revue concernée; les changements
techniques invalident l'autorisation d'envoi conformément aux règles existantes.
Une approbation de dossier ne vaut pas approbation automatique d'un nouveau texte
final généré ou modifié par l'équipe.

Le [preflight](../../apps/funding-api/src/publication-automation/preflight.ts),
les [claims](../../apps/funding-api/src/publication-automation/claims.ts) et les
[appels fournisseur](../../apps/funding-api/src/publication-automation/provider.ts)
doivent réutiliser la garde de modération, sans conserver une transaction DB ouverte
pendant l'appel réseau. Préserver l'ordre de verrous existant et ajouter les cas de
refus concurrent pendant lecture/transformation de média, puis avant dispatch.
Une décision défavorable confirmée avant le contrôle final interdit un nouvel appel
d'envoi. Une requête déjà soumise ne peut être rappelée: conserver son résultat,
signaler le besoin éventuel de retrait et empêcher une relance aveugle.

Un média refusé ne rend pas automatiquement tout le dossier inadmissible. Il
invalide seulement les rendus et autorisations qui l'utilisent; les prérequis de
photo du dossier restent vérifiés. Une publication collective doit garder les
décisions par participant et sur l'assemblage final. Si la correction impose de
retirer un membre, préserver son obligation de reconnaissance avec sa restriction
et sa prochaine action, sans l'enregistrer comme livré ni réattribuer en silence
son avantage à un autre dossier.

Les blocs de reconnaissance protégés ajoutés dans le travail local empêchent de
supprimer arbitrairement une partie du contenu source. Une correction éditoriale
doit donc réviser le brouillon/source, recomposer le rendu, puis obtenir les nouvelles
décisions nécessaires. Contourner ce contrôle pour supprimer un passage problématique
dans le seul éditeur final créerait une divergence avec la preuve de reconnaissance.

## Écrans et textes à mettre à niveau

Les valeurs françaises et anglaises évoluent ensemble. Supprimer les formulations
de production remplacées et leurs usages, puis vérifier les consommateurs avant
de supprimer les clés. Les contrats financiers et les documents déjà émis restent
intacts. Les textes de brouillons sauvegardés ne sont pas réécrits automatiquement.

| Surface                        | Texte ou parcours actuel                                                                                              | Remplacement attendu                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Politique publique             | `funding.policyPage.sections.sponsorship` et `.visibility`: refus général et contact support.                         | Charte contextualisée, catégories, proportionnalité, correction/réexamen, distinction paiement/publication et gestion financière séparée.                 |
| Contribution entreprise        | `funding.home.contribution.sponsorship.reviewNote`, `afterPaymentNote` et `manualReviewNote`; revue humaine annoncée. | Résumé avant paiement, accès à la charte complète, acceptation explicite de la version affichée, erreur si version retirée.                               |
| Suivi du dossier refusé        | `funding.followup.review.rejected.copy` et `steps.publicationUnknown`; support et formulaire non modifiable.          | Explication externe, éléments concernés, corrections permises, demande de réexamen, blocage maintenu et état de traitement.                               |
| Revue dossier                  | `admin.legacy.raison_interne_du_refus`, `message_au_commanditaire` et `envoyer_le_courriel_de_refus`.                 | Motif principal/secondaires, niveau, disposition, justification interne et explication externe obligatoires selon la décision; aperçu de confidentialité. |
| Revue média                    | Confirmation approuver/refuser, statut du fichier.                                                                    | Motif, version/aperçu exact, portée du refus et remplacement demandé; ne pas utiliser le texte alternatif comme motif.                                    |
| Éditeur de publication finale  | `admin.publicationAutomation.rejectConfirm`, bouton Refuser et confirmation.                                          | Formulaire de décision, contenu/version/destination visibles, motif et conséquences sur les participants.                                                 |
| Brouillons, lots et calendrier | États opérationnels et notes facultatives.                                                                            | État éditorial séparé, restrictions et prochaine action; aucun succès annoncé avant réponse serveur.                                                      |
| Pilotage et À traiter          | `admin.pilotage.reason`, `admin.dossier.guide.*` et `admin.dossier.independent`; actions et raisons opérationnelles.  | Cas de modération, dossiers en correction/suspension, secondes revues, recours et incidents de retrait, avec navigation vers le détail.                   |
| Historique et audit            | Notes, revue, états financiers et publications.                                                                       | Décisions successives, version de politique/contenu, acteurs et réexamen; notes privées réservées au rôle autorisé.                                       |
| Courriels                      | Template de refus français et motif de revue transmis.                                                                | Templates FR/EN par événement, explication externe seule, lien privé contrôlé, prochaine action et statut de notification.                                |
| Support et guides              | Invitation générique à contacter l'équipe.                                                                            | Informations cohérentes avec correction/réexamen réellement disponibles; aucun délai public inventé.                                                      |

Réutiliser les [panneaux de décision dossier](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-rejection-panel.component.html),
le [workflow de revue](../../apps/funding-web/src/app/features/funding/services/admin-sponsor-review-workflow.ts),
le [workflow média](../../apps/funding-web/src/app/features/funding/services/admin-sponsor-media-workflow.ts),
le [contrôleur de livraison](../../apps/funding-web/src/app/features/funding/components/admin-publications/publication-delivery-controller.ts),
le [suivi privé](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-followup-form.component.ts)
et la [page de politique](../../apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.ts).
Le formulaire partagé de décision doit rester un composant métier Funding;
la même validation côté API s'applique aux clients anciens et aux raccourcis.

Préparer les formulations suivantes avec les comportements correspondants. Elles
ne doivent être exposées comme fonctions disponibles qu'après livraison et,
pour la charte publique, après validation de la version applicable.

| Usage                      | Français proposé                                                                      | Anglais proposé                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Principe de contexte       | Un désaccord ou une controverse ne suffit pas à justifier un refus.                   | Disagreement or controversy alone does not justify rejection.                   |
| Acceptation avant paiement | J'ai lu la charte {{version}}. Le paiement ne garantit aucune approbation éditoriale. | I have read Charter {{version}}. Payment does not guarantee editorial approval. |
| Justification privée       | Justification interne — réservée à l'équipe habilitée.                                | Internal rationale — authorized staff only.                                     |
| Explication communicable   | Explication destinée au commanditaire.                                                | Sponsor-facing explanation.                                                     |
| Refus ciblé                | Refuser cette publication uniquement.                                                 | Reject this publication only.                                                   |
| Correction                 | Fournir une correction.                                                               | Submit a correction.                                                            |
| Réexamen                   | Demander un réexamen.                                                                 | Request reconsideration.                                                        |
| Retrait local              | Présentation retirée du site.                                                         | Presentation removed from the website.                                          |
| Assistance                 | Une personne doit examiner le contexte et décider.                                    | A person must review the context and decide.                                    |

La date fixe de révision de la page de politique, ses libellés FR/EN, son contenu
imprimable et ses liens doivent suivre la version publiée. N0–N5 sont des types
d'intervention, pas une progression obligatoire où chaque dossier passe par tous
les niveaux. Le catalogue et les libellés ne doivent pas transformer un incident
de livraison en faute du commanditaire.

Le portail ne révèle jamais notes internes, identité complète des examinateurs,
contenu d'autres membres d'un lot ou coordonnées privées. Pour une publication
collective, l'explication d'un dossier reste ciblée. Préserver focus, confirmation,
clavier, accessibilité, états de chargement/erreur et routes FR/EN, y compris SSR.

## Corrections notifications et réexamens

Une correction autorisée indique le sujet, la version de décision, les éléments
modifiables et les instructions externes. La soumission conserve l'ancienne preuve,
crée une nouvelle version, clôt ou met à jour la demande et retourne en revue.
Elle ne restaure pas une autorisation d'envoi, une visibilité ou un statut financier.
Une nouvelle pièce reste privée jusqu'à son examen. Les conflits d'onglets et les
soumissions répétées sont contrôlés côté serveur.

Une demande de réexamen cible une décision précise, conserve le motif du demandeur
et n'est pas une mutation directe du dossier refusé. Prévoir limitation de taille,
de fréquence, unicité des demandes actives et gestion des doublons. Un examinateur
autorisé statue par nouvelle décision; une décision grave contestée exige une
personne distincte de l'auteur initial. Le système doit expliquer un manque de
capacité de revue indépendante plutôt que considérer un changement de session
comme un nouvel examinateur.

L'explication externe est persistée et consultable dans le suivi privé dès la
décision défavorable. La politique de notification par courriel reste à fixer;
l'absence ou l'échec du mail ne doit pas supprimer cette explication. La file
existante peut porter une clé logique par décision/événement/langue, sans créer
un nouveau courriel lors de chaque retry. Adapter contexte, destinataire, aperçu,
renvoi, statut `uncertain`, réconciliation et événements d'audit. Une correction
de destinataire reste une action sensible distincte.

L'acceptation de charte fait partie de la nouvelle opération Checkout et de son
empreinte. Une reprise idempotente d'une opération déjà créée conserve ses termes
initiaux. Une nouvelle tentative avec un payload ou une version différente exige
un traitement explicite, sans double paiement. Le serveur détermine la version
publique active et conserve la preuve; cocher une case côté Web ne suffit pas.

## Plan de réalisation P0 à P3

Chaque tâche livre les contrats publics, producteurs, consommateurs, erreurs,
tests et documentation propriétaire ensemble. Le nombre de tâches ne constitue
pas une estimation de durée. Les dépendances sont celles du domaine et des
chantiers de publication existants.

| Tâche    | Livrable et critère d'acceptation                                                                                                                                               | Dépendances                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| MOD01 P0 | Catalogue des 17 motifs et versions de politique. Codes inconnus refusés, dispositions éditoriales obligatoires, statuts internes/publics distincts.                            | Cadrage V1.0.                               |
| MOD02 P0 | Versions de contenu et sujets typés. Modification réelle invalide la revue; simple claim worker ne l'invalide pas.                                                              | MOD01.                                      |
| MOD03 P0 | Migrations et service transactionnel de décision. Historique, projection, audit et notification atomiques; répétition sans doublon.                                             | MOD01–02.                                   |
| MOD04 P0 | Décisions dossier/média/brouillon/finale. Motif et confirmation serveur requis; notes internes jamais sérialisées vers portail ou courriel.                                     | MOD03.                                      |
| MOD05 P0 | Gardes d'approbation et de visibilité communes. Publication manuelle, groupée et pilotage appliquent la même décision. Contrôle minimum de revue indépendante pour N4/N5 grave. | MOD04.                                      |
| MOD06 P0 | Invalidation et restrictions ciblées. Refus/correction/suspension bloquent les dépendances sans effacer les obligations ni refuser des éléments étrangers.                      | MOD05; SP05 et SP17.                        |
| MOD07 P0 | Garde de modération worker et dispatch. Refus concurrent empêche le nouvel envoi; résultat déjà soumis conservé et incident traité.                                             | MOD06; protections de claim et SP20.        |
| MOD08 P0 | Recette des chemins et de la confidentialité. API directe, clients anciens, pilotage et workers ne contournent ni motif ni décision.                                            | MOD04–07.                                   |
| MOD09 P1 | Charte FR/EN et remplacement des textes publics. Versions prêtes et validation d'activation explicite; critères contextuels et financiers cohérents.                            | MOD01; validation des textes publics.       |
| MOD10 P1 | Acceptation serveur avant Checkout. Preuve de version affichée/acceptée, conservation au retry, personnel/entreprise traités selon le périmètre applicable.                     | MOD09; opération Checkout durable.          |
| MOD11 P1 | Panneau de décision commun et cockpit. Motifs, niveaux, versions et conséquences visibles; confirmation et erreurs accessibles.                                                 | MOD04–05.                                   |
| MOD12 P1 | Projection et explication privées. Éléments concernés et prochaine action visibles, aucune note interne ni donnée d'un autre dossier.                                           | MOD03–04 et MOD11.                          |
| MOD13 P1 | Correction ciblée de texte/média. Ancienne version conservée, nouvelle revue requise, droits et conflits d'onglets vérifiés.                                                    | MOD02, MOD06 et MOD12; SP24/SP28.           |
| MOD14 P1 | Dépôt et suivi d'une demande de réexamen. Demande liée à la décision, doublons bornés, autorisations toujours retirées.                                                         | MOD03 et MOD12; garde d'indépendance MOD05. |
| MOD15 P1 | Notifications FR/EN persistantes. Explication externe seule, outbox atomique et déduplication; échec/ambiguïté visibles.                                                        | MOD03 et MOD12; file courriel/SP30.         |
| MOD16 P2 | Orchestration complète de seconde revue et recours. Affectation, rôles et auteur distinct; aucune approbation de convenance faute de personnel.                                 | MOD05, MOD11 et MOD14.                      |
| MOD17 P2 | Retrait local et suivi distant. Masquage confirmé distinct de suppression sociale demandée/confirmée/incertaine/indisponible.                                                   | MOD06, MOD16 et preuves de livraison.       |
| MOD18 P2 | Adoption historique avec aperçu. États anciens classés et preuves conservées; aucune approbation ou acceptation fictive.                                                        | MOD02–07; SP40.                             |
| MOD19 P2 | Conservation et accès aux preuves. Données minimales, droits et protection privée, gel de conservation et purge contrôlée selon règles validées.                                | MOD03, MOD16 et MOD18.                      |
| MOD20 P2 | Indicateurs opérationnels. Cas ouverts, délais constatés, corrections, recours, renversements et retraits; pas de détails personnels dans les métriques.                        | MOD12 et MOD16–19.                          |
| MOD21 P2 | Recette d'adoption et procédure de reprise. Base neuve/existante, rôles, désactivation de l'envoi et compatibilité vérifiés; livraison datée avec preuves.                      | MOD08–20; SP43/SP44.                        |
| MOD22 P3 | Suggestions textuelles FR/EN. Codes et indices de risque expliqués, abstention possible, aucune décision humaine remplacée.                                                     | MOD01, MOD02 et MOD08.                      |
| MOD23 P3 | OCR et analyse des visuels. Résultat lié aux octets/version, confidentialité et cas de texte intégré testés.                                                                    | MOD22 et contrat média.                     |
| MOD24 P3 | Analyse prudente des liens. Réseau isolé, limites, redirections et destinations contrôlées; données collectées minimales.                                                       | MOD22 et choix de sécurité réseau.          |
| MOD25 P3 | Corpus et mesure des erreurs. Cas contextualisés FR/EN, précision par motif, faux positifs/négatifs, dérive et version du modèle suivis.                                        | MOD22–24; validation humaine du corpus.     |

La fermeture des chemins et la séparation des notes relèvent de P0. La charte et
le parcours commanditaire ne doivent pas attendre un fournisseur IA. La revue
indépendante conditionne les décisions graves dès qu'elles sont proposées;
MOD16 ajoute leur organisation complète. P3 apporte une assistance facultative.
Une indisponibilité d'analyse automatique ne crée aucune approbation ni aucun refus.

P3 exige un adaptateur distinct pour les téléchargements externes. La validation
HTTPS actuelle n'autorise aucun accès réseau au site du commanditaire. Contrôler
résolution, adresses privées/locales, redirections, délais, taille, MIME et contenu;
revalider chaque destination et isoler l'exécution. Les résultats OCR, pages et
réponses d'IA sont des données non fiables; leurs instructions ne commandent
jamais l'API. Toute analyse conserve sa version et son incertitude et peut s'abstenir.
Le choix d'un fournisseur externe et des données transmissibles reste distinct
de la construction du contrat d'assistance.

## Articulation avec le chantier de publication

Le [plan de reconnaissance et diffusion](sponsorship-publication-tasks.md) et ses
44 tâches couvrent les engagements, le contenu, la capacité, les preuves et les
nouveaux formats. Les tâches de modération partagent ces contrats plutôt que
créer un calendrier, une obligation ou une file sociale supplémentaires.

| Travail de publication | Intégration de la modération                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SP05 et SP17           | Référencer les restrictions/décisions sur obligations et autorisations; nouvelle approbation sur contenu corrigé.  |
| SP07 et SP08           | Examiner le rendu complet et ses bénéficiaires; conserver les contrôles de blocs protégés lors d'une correction.   |
| SP20 et SP21           | Conserver les résultats fournisseur et réconcilier une publication déjà envoyée malgré une restriction ultérieure. |
| SP23 à SP25 et SP28    | Versionner photo, dérivé et aperçu; correction et explication privées liées au dossier.                            |
| SP29 et SP30           | Réutiliser cockpit, décisions, file de notifications et déduplication.                                             |
| SP40, SP43 et SP44     | Adoption historique, mise en service séparée et recette transversale avec dossiers synthétiques.                   |

Les modifications locales de composition et de capacité doivent être stabilisées
avec leurs propres validations avant une intégration de production. L'analyse de
modération n'attribue pas de statut terminé aux tâches de ce chantier.

## Historique retrait et retour arrière

Classer les dossiers historiques selon leurs preuves: note libre sans catégorie,
approbation sans version de politique, autorisation technique existante, publication
confirmée, publication déclarée manuellement ou résultat incertain. Conserver les
dates, acteurs et textes connus; une valeur absente reste absente. Une classification
de migration n'est pas une nouvelle décision éditoriale.

L'adoption des envois en attente doit préciser lesquels nécessitent une nouvelle
revue et comment préserver les engagements commerciaux existants. Une ancienne
publication visible n'est pas supprimée en masse par changement de politique.
Les décisions de retrait restent ciblées, motivées et soumises aux contrôles graves
applicables. Les nouvelles versions de charte ne modifient pas silencieusement les
conditions acceptées auparavant.

Dès activation de la garde P0, une livraison en attente sans décision versionnée
applicable reste bloquée jusqu'à revue explicite. Son ancienne autorisation
technique ne constitue pas une exception de modération. MOD18 organise le
rapprochement détaillé et le traitement des données historiques; il ne reporte
pas cette protection minimale en P2.

N5 comporte deux résultats différents. Le site peut masquer sa fiche et cesser de
servir les médias admissibles. Facebook et LinkedIn possèdent leurs copies; un
masquage local n'en prouve pas la suppression. Prévoir capacité par fournisseur,
autorisation explicite, idempotence, audit, résultat incertain et vérification du
résultat distant. Une capacité de suppression non qualifiée doit être présentée
comme indisponible, avec traitement manuel suivi si nécessaire.

Les migrations sont additives et leur application de production reste une
opération distincte. Le retour des images applicatives ne restaure pas la base.
Le plan de reprise doit arrêter les envois concernés, conserver les décisions et
les résultats distants, puis vérifier la compatibilité du binaire. Un ancien worker
qui ignore les restrictions de modération ne constitue pas un rollback sûr.
La suppression de données, la restauration, le backfill et les lots de notifications
historiques restent des opérations ciblées et séparément autorisées.

## Validation de comportement

Le corpus initial de la V1.0 devient une matrice d'acceptation. En P0, les scénarios
de haine ou de violence vérifient la décision humaine structurée et ses effets;
ils ne prouvent pas une détection automatique du texte. Cette dernière relève de
MOD25 et doit inclure des contre-exemples contextualisés.

| Cas de la V1.0                          | Preuve attendue                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Appel explicite à la violence           | Motif humain approprié, décision/trace et escalade; aucune publication autorisée.                              |
| Citation haineuse dénoncée              | Examen du contexte et possibilité d'approbation; aucun refus sur un simple mot.                                |
| Critique d'une politique publique       | Pas de catégorie présumée sans violation précisément justifiée.                                                |
| Logo refusé et dossier admissible       | Refus limité au logo, nouvelle pièce privée possible selon correction et autorisations dépendantes invalidées. |
| Modification après approbation          | Ancienne décision/autorisation inutilisable sur le contenu modifié.                                            |
| Publication refusée avant worker        | Aucun nouvel appel fournisseur; refus non annulé par la préparation.                                           |
| Erreur fournisseur social               | Incident technique distinct, sans motif éditorial inventé.                                                     |
| Réexamen déposé                         | Blocage maintenu; seule une nouvelle décision autorisée peut ouvrir la suite.                                  |
| Deux demandes concurrentes              | Une décision et un événement logique; conflit explicite pour versions/payloads incompatibles.                  |
| Refus sans motif                        | Validation serveur en échec, aucun changement de statut, audit de succès ou courriel.                          |
| Consultation commanditaire              | Explication externe visible; notes internes absentes du JSON, du DOM, des mails et des logs.                   |
| Contenu ancien sans décision versionnée | Classification historique explicite; aucune approbation fabriquée.                                             |

Ajouter les scénarios suivants: 17 codes valides et code inconnu; disposition
manquante; différences de scope; actor falsifié; lecteur/opérateur/propriétaire;
origine étrangère/session expirée; auteur identique lors d'une seconde revue;
politique retirée et langue/version périmées avant Checkout; replay de Checkout
existant; correction par un autre dossier; média supprimé/remplacé; résumé public
modifié; bénéficiaire omis; API legacy et commandes groupées; claim sans changement
éditorial; refusal pendant préflight; succès distant tardif; panne audit/outbox;
mail incertain et renvoi; petite population dans métriques; retrait local réussi
mais distant inconnu; répétition d'adoption et rollback incompatible.

Les tests propriétaires à étendre incluent les [décisions HTTP](../../tests/admin-sponsorship-decisions-http.test.mjs),
les [médias HTTP](../../tests/admin-sponsorship-media-http.test.mjs),
les [commandes publication](../../tests/publication-automation-commands.test.mjs),
le [worker concurrent](../../tests/integration/publication-worker-claims.integration.mjs),
le [suivi refusé](../../tests/playwright/sponsor-rejected-state.spec.ts),
les [notifications](../../tests/email-notification-rendering.test.mjs),
la [politique FR/EN](../../tests/playwright/refund-policy.spec.ts) et les
[garanties Checkout](../../tests/integration/checkout-idempotency.integration.mjs).
Créer les tests purs des contrats et les intégrations PostgreSQL du nouveau domaine.
Les suites UI doivent vérifier refus/correction/recours, FR ordinateur et EN mobile,
clavier/focus, SSR, états vides/erreurs et confidentialité.

Appliquer la [matrice de validation](validation.md): format ciblé, lint, compilation,
tests Node, migrations sur PostgreSQL jetable neuf et existant, recettes des
mutations/worker/courriels, build Angular et parcours navigateur concernés.
Terminer par standards documentaires et `git diff --check`. Une fixture fournisseur
ne prouve ni une publication réelle ni une suppression distante réelle.

## Références et décisions à préparer

Mettre à jour les références propriétaires dans chaque lot: [règles commandites](sponsorship-rules.md),
[architecture FR](../ARCHITECTURE.md) et [EN](../ARCHITECTURE.en.md),
[API admin](../technical/admin-api.md) et [publique](../technical/public-api.md),
[politique publique](../usage-refund-policy.md), [suivi privé](../sponsorship-access-and-drafts.md),
[annuaire](../public-sponsors.md), [file de publication](../admin-publication-queue.md),
[worker](../operations/publication-automation.md), [identité](../operations/admin-identity-and-alerts.md),
[pilotage](../operations/admin-pilotage.md), [SMTP](../email-smtp.md),
[migrations](../operations/database-migrations.md) et [index](../README.md).
Les bilans datés restent historiques; les contrats actuels et textes de production
doivent remplacer les règles devenues obsolètes.

Les décisions suivantes conditionnent l'activation des fonctions correspondantes,
sans empêcher la construction locale de leurs contrats et tests:

1. Valider la charte publique FR/EN, les clauses et la date d'effet; préciser les
   règles applicables aux dossiers antérieurs et l'acceptation des nouveaux dossiers.
2. Définir les groupes/conduites couverts, les exclusions électorales/partisanes,
   les dispositions éditoriales et l'escalade grave; aucune qualification pénale
   automatique issue d'un code.
3. Fixer qui peut examiner, suspendre, refuser, retirer et réexaminer; définir le
   traitement lorsqu'une seconde personne habilitée n'est pas disponible.
4. Déterminer les motifs internes accessibles par rôle, l'explication externe
   minimale et les limites de communication pour protéger personnes et preuves.
5. Définir les canaux et événements de notification obligatoires, les délais
   internes et les engagements publics effectivement soutenables.
6. Valider les durées de conservation, les gels, la purge, les données d'analyse
   et les juridictions concernées avec les responsables compétents.
7. Qualifier les capacités de retrait social et toute assistance OCR/IA/liens,
   ses fournisseurs éventuels et les données autorisées à sortir de l'application.

L'ordre technique de démarrage est MOD01 à MOD04, puis fermeture des voies de
publication MOD05 à MOD08. Les nouvelles projections et textes P1 utilisent ces
garanties. La gouvernance P2 et l'assistance P3 complètent ce socle sans modifier
les faits financiers ni attribuer un droit automatique à la publication.
