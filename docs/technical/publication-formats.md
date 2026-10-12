# Formats des publications et capacité des connecteurs

Qualification documentaire effectuée le 11 octobre 2026. Le format promis dans
l’offre, les permissions d’utilisation d’une image et la capacité du connecteur
sont trois conditions distinctes. L’autorisation N0 ne les remplace pas.

## Capacité actuelle

| Format                         | Facebook       | LinkedIn       | Conditions                                                                                                         |
| ------------------------------ | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Texte collectif                | Pris en charge | Pris en charge | Message exact, sources et obligations enregistrées, compte autorisé                                                |
| Une image JPEG                 | Pris en charge | Pris en charge | Droits confirmés pour la destination et les transformations, crédits rendus, aperçu et empreinte des octets exacts |
| Collection de plusieurs images | Indisponible   | Indisponible   | Aucun adapter actuel ne transmet ni ne vérifie une collection                                                      |

L’adapter Facebook envoie une image avec `POST /{page}/photos`; LinkedIn initialise
une image, téléverse ses octets, vérifie `AVAILABLE`, puis utilise `content.media`
dans `POST /posts`. Un montage transmis comme un JPEG unique conserve un format
composite distinct d’une collection. Une sélection de plusieurs images ne peut pas
être convertie silencieusement en une promesse différente. Une collection demandée
doit être signalée indisponible avec sa raison avant approbation.

Le snapshot approuvé et la preuve conservent les sources, leurs droits, le
traitement et l’empreinte des octets remis au provider. Le rendu d’un crédit doit
être vérifié dans le message exact ou dans l’image finale. Une transformation
technique autorisée ne suffit pas à autoriser un recadrage, un portrait ou un
montage collectif.

## Qualification des API officielles

La documentation LinkedIn consultée utilise la vue **`li-lms-2026-04`**. Son
[API MultiImage](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api?view=li-lms-2026-04)
décrit des posts organiques contenant de 2 à 20 images, avec un URN pour chaque
image. Ce support chez LinkedIn ne prouve aucune implémentation dans OpenG7.

Les permissions d’écriture et de lecture des posts d’organisation sont distinctes,
et exigent un rôle de page compatible. Les appels utilisent les en-têtes de
version LinkedIn et Rest.li. Voir l’[API Posts](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04).
L’[API Images](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-04)
accepte JPG, PNG et GIF sous sa limite de pixels et décrit la vérification de
disponibilité et les droits de lecture des images. Les URLs de téléchargement
peuvent expirer : elles ne constituent pas une preuve durable des octets approuvés.

Les pages officielles Meta [Posts](https://developers.facebook.com/docs/pages-api/posts/)
et [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)
n’ont pas pu être lues lors de cette qualification. Aucun plafond multiimage Meta
ni droit de lecture supplémentaire n’est donc annoncé comme validé. Toute
implémentation future devra qualifier ses permissions, formats, limites et
reprises à partir de ces références, puis tester les payloads sur un serveur
synthétique isolé avant toute opération externe autorisée.

## Réconciliation et visibilité

La réconciliation automatique actuelle vérifie le texte, l’auteur et l’état d’un
post sans image. Pour une image simple, un portrait, un montage ou une collection,
elle retourne `MEDIA_RECONCILIATION_REQUIRED` et requiert une investigation. Elle
ne compare pas une nouvelle image à une ancienne preuve, ni une URL temporaire à
l’empreinte d’un fichier source.

Une lecture interdite, un résultat introuvable ou une panne produit une
observation de visibilité `unknown`; aucune absence ni nouvelle publication n’est
déduite de ce résultat. La preuve historique et le fait financier restent
conservés. Voir le [runbook de reprise](../operations/publication-automation.md).
