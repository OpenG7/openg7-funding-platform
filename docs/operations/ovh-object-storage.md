# OVH Object Storage pour les medias commanditaires

Cette page decrit les scripts Bash utilises pour provisionner, diagnostiquer et
operer manuellement les deux buckets OVH Object Storage S3 dedies aux medias des
commanditaires. Les scripts ne remplacent pas le flux applicatif normal de
`funding-api`.

## Architecture

```text
Navigateur
  -> funding-api
      -> bucket prive
      -> traitement et validation
      -> bucket public apres approbation
      -> PostgreSQL pour les metadonnees
```

## Buckets

Le bucket prive contient les originaux, les fichiers en attente de validation,
les medias refuses et les versions administratives. Il ne doit jamais recevoir
d'ACL `public-read`. Les objets prives sont consultes par authentification S3 ou
par URL pre-signee.

Le bucket public contient uniquement les versions approuvees et optimisees. Le
bucket lui-meme reste prive pour empecher l'enumeration publique. Seuls les
objets explicitement publies recoivent l'ACL `public-read`.

Configuration OVH attendue:

```env
SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3
SPONSOR_MEDIA_REGION=bhs
SPONSOR_MEDIA_ENDPOINT=https://s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PUBLIC_BUCKET=openg7-funding-sponsor-media-public-prod
SPONSOR_MEDIA_PUBLIC_BASE_URL=https://openg7-funding-sponsor-media-public-prod.s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PRIVATE_BUCKET=openg7-funding-sponsor-media-private-prod
SPONSOR_MEDIA_PRIVATE_BASE_URL=https://openg7-funding-sponsor-media-private-prod.s3.bhs.io.cloud.ovh.net
OVH_S3_ACCESS_KEY_ID=
OVH_S3_SECRET_ACCESS_KEY=
```

`SPONSOR_MEDIA_ENDPOINT` est l'endpoint regional utilise par AWS CLI et les SDK
S3. Les deux variables `*_BASE_URL` sont les Virtual Hosts par bucket. La base
publique sert a construire les URL permanentes. La base privee identifie le
bucket prive, mais ne doit pas etre presentee comme une URL publique.

Ne pas ajouter de slash final aux URL. Cela evite les doubles barres lors de la
construction des liens objets.

## Prerequis

Installer AWS CLI v2 et `curl` sur le VPS. Les scripts utilisent aussi Bash,
`grep`, `sed`, `tr`, `cmp`, `mktemp` et les outils POSIX standards disponibles
sur Ubuntu 24.04 LTS.

Les credentials OVH Object Storage doivent etre places dans `.env` seulement:

```env
OVH_S3_ACCESS_KEY_ID=...
OVH_S3_SECRET_ACCESS_KEY=...
```

Ne jamais les committer, les inclure dans une image Docker, les passer en
arguments de processus ou les copier dans une sortie de diagnostic. `.gitignore`
et `.dockerignore` ignorent les fichiers `.env` reels; `.env.example` reste le
seul modele versionne.

## Commandes npm

```bash
npm run storage:check
npm run storage:test
npm run storage:provision -- --dry-run
npm run storage:provision -- --yes
npm run storage:publish -- --source-key "uploads/sponsors/123/original.webp" --target-key "public/sponsors/123/profile-<checksum>.webp" --content-type "image/webp"
npm run storage:unpublish -- --key "public/sponsors/123/profile-<checksum>.webp"
```

Les memes scripts peuvent etre lances directement avec `bash scripts/storage/...`.
Ils fonctionnent depuis n'importe quel repertoire de travail du repo, chargent
`.env` avec `scripts/load-env.sh` et desactivent la recherche de credentials AWS
dans les metadonnees EC2 avec `AWS_EC2_METADATA_DISABLED=true`.

## Roles des scripts

`check-ovh-storage.sh` lit la configuration et verifie les buckets sans modifier
les donnees. Il controle la region `bhs`, l'endpoint regional, les URL sans
slash final, l'acces authentifie, le versioning, l'absence d'ACL publique sur le
bucket prive et l'absence de liste publique sur le bucket public.

`test-ovh-storage.sh` cree des objets temporaires sous `system-tests/`, confirme
que le bucket prive refuse une lecture HTTP anonyme avec `403`, publie un seul
objet public avec `public-read`, verifie le HTTP `200` et nettoie les objets avec
un `trap`. `--keep-test-objects` garde les objets pour diagnostic manuel.

`provision-ovh-storage.sh` cree uniquement les buckets absents, ne supprime rien,
ne rend jamais un bucket public, active le versioning quand l'API S3 le permet et
tente de configurer SSE-OMK avec la configuration AWS CLI standard. Utiliser
`--dry-run` avant toute execution reelle. Sans `--yes`, chaque creation ou
activation demande une confirmation explicite.

`publish-sponsor-media.sh` copie un objet du bucket prive vers le bucket public,
fixe `Content-Type`, `Cache-Control`, applique `public-read` seulement a l'objet
cible et affiche l'URL publique finale. Par defaut:

```text
Cache-Control: public, max-age=31536000, immutable
```

Pour eviter les problemes de cache, utiliser des noms versionnes ou bases sur un
checksum, par exemple:

```text
public/sponsors/123/profile-<checksum>.webp
```

`unpublish-sponsor-media.sh` supprime uniquement un objet public sous
`public/sponsors/`. Il refuse la racine du bucket, les prefixes complets, les
chemins absolus et les cles contenant `..`. L'original prive n'est jamais
supprime.

## Role futur de funding-api

`funding-api` restera responsable du flux normal: recevoir les uploads, valider
types et tailles, stocker les originaux dans le bucket prive, generer des URL
pre-signees, copier les medias approuves vers le bucket public, enregistrer les
metadonnees dans PostgreSQL, gerer les remplacements, retraits et audits.

Les scripts Bash sont des outils d'administration, de reprise et de verification
apres deploiement.

## Resultats attendus

`npm run storage:check` doit finir par:

```text
Result: OK
```

ou `OK with warnings` si une information non critique comme le chiffrement ne
peut pas etre lue par l'API. Un bucket prive avec une ACL `AllUsers`, un bucket
public qui autorise `AllUsers` a lister, un endpoint incoherent ou un bucket
inaccessible doivent produire un code de sortie non nul.

`npm run storage:test` doit confirmer:

```text
Private object rejects anonymous HTTP access with 403
Public object is anonymously readable only after public-read ACL
Result: OK
```

## Erreurs frequentes

`Missing required environment variable` indique que `.env` n'a pas toutes les
variables ou contient encore une valeur placeholder.

`Required command is not installed: aws` indique qu'AWS CLI doit etre installe
sur le VPS.

`expected 403` sur le test prive indique que l'acces anonyme ne se comporte pas
comme attendu. Un `200` est une erreur critique de confidentialite.

`public listing` indique que le bucket public permet l'enumeration. Retirer les
grants `AllUsers READ` ou `FULL_CONTROL` du bucket.

`SSE-OMK could not be configured with AWS CLI` indique que le chiffrement doit
etre verifie ou configure dans OVH Manager pour ce bucket.

## Rotation et revocation des cles

Creer une nouvelle paire de cles Object Storage dans OVHcloud, mettre a jour le
`.env` du VPS, lancer `npm run storage:check`, puis revoquer l'ancienne paire.
Ne pas garder d'ancienne cle dans un shell history, un ticket, un log ou un
fichier temporaire.

Si un utilisateur Object Storage doit etre revoque, retirer ou desactiver ses
cles dans OVHcloud, puis verifier qu'aucun deploiement ne depend encore de cette
paire.

## Verification manuelle HTTP

Pour confirmer qu'un objet prive refuse l'acces anonyme:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://openg7-funding-sponsor-media-private-prod.s3.bhs.io.cloud.ovh.net/system-tests/example/private-test.txt"
```

Le resultat attendu pour un objet prive existant est `403`. Pour le bucket public,
une URL d'objet publie explicitement doit retourner `200`, mais
`https://openg7-funding-sponsor-media-public-prod.s3.bhs.io.cloud.ovh.net/?list-type=2`
ne doit jamais retourner `200`.

## References OVHcloud

- [Endpoints and Object Storage geoavailability](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-location)
- [Object Storage - Getting started](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-getting-started-with-object-storage)
- [Object Storage - Bucket ACL](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-bucket-acl)
- [Object Storage - Encrypt your server-side objects with SSE-C or SSE-OMK](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-encrypt-your-objects-with-sse-c)
