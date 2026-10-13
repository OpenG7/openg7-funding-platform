# Formats des publications et capacité des connecteurs

Qualification documentaire effectuée le 12 octobre 2026. Le format promis dans
l’offre, les permissions d’utilisation d’une image et la capacité du connecteur
sont trois conditions distinctes. L’autorisation N0 ne les remplace pas.

## Capacité actuelle

| Format                         | Facebook       | LinkedIn                  | Conditions                                                                                                               |
| ------------------------------ | -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Texte collectif                | Pris en charge | Pris en charge            | Message exact, sources et obligations enregistrées, compte autorisé                                                      |
| Une image JPEG                 | Pris en charge | Pris en charge            | Droits confirmés pour la destination et les transformations, crédits rendus, aperçu et empreinte des octets exacts       |
| Collection de plusieurs images | Indisponible   | Pris en charge localement | De 2 à 10 commanditaires, une photo propriétaire chacun, JPEGs séparés et ordre exact approuvé ; compte réel à qualifier |

Ces capacités sont reçues localement ; aucun compte Facebook ou LinkedIn réel
n'a été qualifié dans ce chantier.

L’adapter Facebook envoie une image avec `POST /{page}/photos`; LinkedIn initialise
une image, téléverse ses octets, vérifie `AVAILABLE`, puis utilise `content.media`
dans `POST /posts`. Une collection LinkedIn téléverse chaque JPEG séparément,
puis transmet les URNs ordonnés dans `content.multiImage.images`.
Un montage transmis comme un JPEG unique conserve un format
composite distinct d’une collection. Une sélection de plusieurs images ne peut pas
être convertie silencieusement en une promesse différente. Une collection demandée
sur Facebook doit être signalée indisponible avec sa raison avant approbation.

Le snapshot approuvé et la preuve conservent les sources, leurs droits, le
traitement et l’empreinte des octets remis au provider. Le rendu d’un crédit doit
être vérifié dans le message exact ou dans l’image finale. Une transformation
technique autorisée ne suffit pas à autoriser un recadrage, un portrait ou un
montage collectif.

## Qualification des API officielles

La documentation LinkedIn consultée utilise la vue **`li-lms-2026-06`**,
correspondant à la version `202606` configurée par défaut. Son
[API MultiImage](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api?view=li-lms-2026-06)
décrit des posts organiques contenant de 2 à 20 images, avec un URN pour chaque
image. OpenG7 limite ses collections à 10 participants et crée uniquement un post
organique de reconnaissance, sans appel publicitaire ni promotion payante.

Les permissions d’écriture et de lecture des posts d’organisation sont distinctes,
et exigent un rôle de page compatible. Les appels utilisent les en-têtes de
version LinkedIn et Rest.li. Voir l’[API Posts](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06).
L’[API Images](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-06)
accepte JPG, PNG et GIF sous sa limite de pixels et décrit la vérification de
disponibilité et les droits de lecture des images. Les URLs de téléchargement
peuvent expirer : elles ne constituent pas une preuve durable des octets approuvés.

Les pages officielles Meta [Posts](https://developers.facebook.com/docs/pages-api/posts/)
et [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)
n’ont pas pu être lues lors de cette qualification, y compris après recherche
ciblée le 12 octobre. Aucun plafond multiimage Meta
ni droit de lecture supplémentaire n’est donc annoncé comme validé. Toute
implémentation future devra qualifier ses permissions, formats, limites et
reprises à partir de ces références, puis tester les payloads sur un serveur
synthétique isolé avant toute opération externe autorisée.

Une lecture complémentaire du [SDK officiel Meta 25.0.0](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.0/facebook_business/adobjects/page.py)
confirme les briques de transport : création de photos avec `published` et
`temporary`, puis publication dans le feed avec `attached_media`. Le
[modèle Photo de cette version](https://github.com/facebook/facebook-python-business-sdk/blob/25.0.0/facebook_business/adobjects/photo.py)
expose notamment l'identifiant de photo, son auteur et `page_story_id`.
Ces signatures ne qualifient pas les permissions, le plafond multiimage, la durée
des uploads privés, l'ordre observable ni la réconciliation d'une collection.
Les références Pages restent inaccessibles lors de la lecture du 12 octobre.
La présence de `client_mutation_id` ne démontre aucune déduplication du fournisseur.
La capacité Facebook reste indisponible ; un résultat public ambigu conserve sa
quarantaine, sans renvoi automatique. Les anciennes preuves ne sont pas enrichies
avec des identifiants supposés.

## Sélection, aperçu et reprise d’une collection

Chaque sélection conserve propriétaire, version, autorisation N0, droits de
destination, transformation technique et crédit exact dans le message. La
collection ne recadre ni ne compose les photos. L’ordre est déterministe par
identifiant de commanditaire. Un reliquat d’une personne reste une préparation
privée incomplète ; l’approbation exige au moins deux participants. Aucun changement
de format ne réécrit une offre conservée ni ne remplace une prestation promise.

`GET /api/admin/publication-automation/image-preview?deliveryId=<uuid>&version=<n>&imageIndex=<0..9>`
retourne le JPEG privé exact à cet index, avec son empreinte et la version de
livraison. Sans index, le premier JPEG est retourné ; un index absent de la
collection échoue. L’interface vérifie chaque empreinte et ne permet l’approbation
qu’après chargement réussi de toute la galerie. Fermer ou changer la sélection
révoque les URLs locales et le consentement d’approbation.

Chaque requête d'aperçu revalide toute la collection avant de retourner le JPEG
demandé. Chaque source est lue et convertie une fois ; le JPEG préparé est réutilisé
et les octets sources ne sont pas accumulés pour une collection. Aucun cache entre
requêtes ne remplace la vérification des propriétaires, droits, préférences,
versions et empreintes de toutes les photos.

La [réception locale de dix grandes photos](../development/publication-performance.md#dix-grandes-photos)
mesure l'ingestion réelle, la composition et les dix appels d'aperçu concurrents
côté API, avec conservation des JPEG exacts. Elle ne mesure pas le décodage
navigateur, le stockage distant ou la latence d'un compte fournisseur réel.

Chaque upload acquitté est conservé dans le cache privé `provider_media_id` :
URN simple historique ou tableau JSON ordonné. Une reprise complète seulement les
uploads manquants et attend `AVAILABLE` pour chacun avant l’unique `POST /posts`.
Une réponse PUT perdue avant cette sauvegarde peut laisser un upload orphelin ;
sa reprise peut créer un autre upload, mais aucun post public n’existe encore.
Un résultat incertain du POST conserve le compte en quarantaine et interdit tout
nouvel envoi. Modifier le contenu révoque l’approbation et efface ce cache.

## Réconciliation et visibilité

LinkedIn vérifie l’identifiant du post, le compte, le message exact, l’état public
publié et les URNs des images dans l’ordre approuvé, puis vérifie l’identité,
le propriétaire et l’état `AVAILABLE` de chaque image, par au plus dix lectures.
Un `altText` retourné doit
aussi correspondre à l’aperçu. Cette identité distante vérifie les références
remises au fournisseur ; elle ne prétend pas retrouver l’empreinte des octets
après une transformation du réseau social.

La migration additive
[053](../../apps/funding-api/migrations/053_publication_provider_media_evidence.sql)
conserve ces URNs dans chaque preuve immuable. Les observations ultérieures
comparent cette preuve, même si la livraison ou sa configuration a changé.
Les anciennes preuves sans URN ne sont pas enrichies par inférence. Pour elles,
et pour les photos Facebook sans identité qualifiée, la réponse demeure
`MEDIA_RECONCILIATION_REQUIRED` et exige une investigation.

Une lecture interdite, un résultat introuvable ou une panne produit une
observation de visibilité `unknown`; aucune absence ni nouvelle publication n’est
déduite de ce résultat. La preuve historique et le fait financier restent
conservés. Voir le [runbook de reprise](../operations/publication-automation.md).

La réception locale utilise les adapters réels avec un fournisseur synthétique :
[pipeline PostgreSQL](../../tests/integration/publication-visual-pipeline.integration.mjs)
(huit portraits/huit preuves, composite de huit, collections de deux et huit,
réponse perdue, lectures interdites),
[contrat fournisseur](../../tests/publication-automation.test.mjs) (uploads
partiels, ordre, identité, échecs) et
[galerie navigateur](../../tests/playwright/publication-image-preview.ui.ts)
(FR/EN, mobile/desktop, digest invalide et approbation clavier).
Ces scénarios ne qualifient aucune permission réelle. Avant activation, vérifier
sur le compte explicitement autorisé les rôles, scopes de lecture/écriture,
version, quotas et rendu du post, puis consigner le résultat ; le code ne lance
aucune opération externe pour cette qualification.
