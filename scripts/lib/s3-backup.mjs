import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand
} from '@aws-sdk/client-s3';

const send = (client, command) =>
  client.send(command, { abortSignal: AbortSignal.timeout(60000) });
const required = (env, key) => {
  if (!env[key]) throw new Error('Missing S3 configuration.');
  return env[key];
};
export function s3BackupConfig(env) {
  const endpoint = new URL(required(env, 'SPONSOR_MEDIA_ENDPOINT'));
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !(
      endpoint.protocol === 'https:' ||
      (env.NODE_ENV === 'test' &&
        endpoint.protocol === 'http:' &&
        endpoint.hostname === '127.0.0.1')
    )
  )
    throw new Error('S3 backup requires HTTPS without embedded credentials.');
  const buckets = {
    private: required(env, 'SPONSOR_MEDIA_PRIVATE_BUCKET'),
    public: required(env, 'SPONSOR_MEDIA_PUBLIC_BUCKET')
  };
  if (
    buckets.private === buckets.public ||
    Object.values(buckets).some(
      (b) => !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(b)
    )
  )
    throw new Error('Distinct valid S3 buckets are required.');
  const client = new S3Client({
    endpoint: endpoint.href,
    region: required(env, 'SPONSOR_MEDIA_REGION'),
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: required(env, 'OVH_S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'OVH_S3_SECRET_ACCESS_KEY')
    }
  });
  return { client, buckets, endpoint: endpoint.href };
}
async function list(client, Bucket) {
  const objects = [];
  let token;
  do {
    const page = await send(
      client,
      new ListObjectsV2Command({
        Bucket,
        ContinuationToken: token,
        MaxKeys: 1000
      })
    );
    objects.push(
      ...(page.Contents || []).map(({ Key, ETag, Size }) => ({
        key: Key,
        etag: ETag,
        bytes: Size
      }))
    );
    if (objects.length > 100000)
      throw new Error('S3 capture exceeds the 100000 object limit.');
    if (
      page.IsTruncated &&
      (!page.NextContinuationToken || page.NextContinuationToken === token)
    )
      throw new Error('Invalid S3 pagination.');
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}
async function fingerprint(file) {
  const entry = await lstat(file);
  if (!entry.isFile()) throw new Error('Invalid S3 backup object file.');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}
export async function captureS3(config, directory) {
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'objects'), { mode: 0o700 });
  const inventory = {};
  for (const [role, bucket] of Object.entries(config.buckets))
    inventory[role] = await list(config.client, bucket);
  if (
    Object.values(inventory).reduce(
      (total, entries) => total + entries.length,
      0
    ) > 100000
  )
    throw new Error('S3 capture exceeds the 100000 object limit.');
  const manifest = {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    endpoint: config.endpoint,
    buckets: config.buckets,
    objects: []
  };
  for (const [role, objects] of Object.entries(inventory)) {
    for (const object of objects) {
      const response = await send(
        config.client,
        new GetObjectCommand({
          Bucket: config.buckets[role],
          Key: object.key,
          IfMatch: object.etag
        })
      );
      const file = `objects/${manifest.objects.length}.bin`;
      let bytes = 0;
      const hash = createHash('sha256');
      await pipeline(
        response.Body,
        new Transform({
          transform(chunk, _, next) {
            bytes += chunk.length;
            hash.update(chunk);
            next(null, chunk);
          }
        }),
        createWriteStream(join(directory, file), { mode: 0o600, flags: 'wx' }),
        { signal: AbortSignal.timeout(60000) }
      );
      if (bytes !== object.bytes || response.ETag !== object.etag)
        throw new Error('S3 object changed during capture.');
      manifest.objects.push({
        ...object,
        role,
        file,
        sha256: hash.digest('hex'),
        versionId: response.VersionId || null,
        contentType: response.ContentType || 'application/octet-stream',
        cacheControl: response.CacheControl || null,
        metadata: response.Metadata || {}
      });
    }
  }
  for (const [role, bucket] of Object.entries(config.buckets)) {
    if (
      JSON.stringify(await list(config.client, bucket)) !==
      JSON.stringify(inventory[role])
    )
      throw new Error(
        'S3 inventory changed during capture; freeze writers and retry.'
      );
  }
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' }
  );
  return manifest;
}
export async function verifyS3(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8')
  );
  if (
    manifest.version !== 1 ||
    !manifest.buckets?.private ||
    !manifest.buckets?.public ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length > 100000
  )
    throw new Error('Invalid S3 backup manifest.');
  const keys = new Set();
  for (const [index, object] of manifest.objects.entries()) {
    if (
      !['private', 'public'].includes(object.role) ||
      typeof object.key !== 'string' ||
      !object.key ||
      object.file !== `objects/${index}.bin` ||
      keys.has(object.role + ':' + object.key)
    )
      throw new Error('Invalid or duplicate S3 backup object.');
    keys.add(object.role + ':' + object.key);
    const actual = await fingerprint(join(directory, object.file));
    if (actual.bytes !== object.bytes || actual.sha256 !== object.sha256)
      throw new Error('S3 backup object checksum mismatch.');
  }
  return manifest;
}
export async function restoreS3(config, directory, confirmation) {
  const manifest = await verifyS3(directory);
  if (confirmation !== `${config.buckets.private},${config.buckets.public}`)
    throw new Error('Confirm the exact two target buckets.');
  if (
    Object.values(config.buckets).some((bucket) =>
      Object.values(manifest.buckets).includes(bucket)
    )
  )
    throw new Error('Source buckets are forbidden restore targets.');
  // Both must be empty before any write. Conditional claims prevent concurrent restores.
  for (const bucket of Object.values(config.buckets)) {
    if ((await list(config.client, bucket)).length)
      throw new Error(
        'Restore buckets must be empty; reconcile any partial restore before using another target.'
      );
    const acl = await send(
      config.client,
      new GetBucketAclCommand({ Bucket: bucket })
    );
    if (
      !acl.Owner?.ID ||
      !Array.isArray(acl.Grants) ||
      !acl.Grants.length ||
      acl.Grants.some((grant) => grant.Grantee?.Type !== 'CanonicalUser')
    )
      throw new Error(
        'Restore bucket must have a verified owner and no group/public ACL.'
      );
    try {
      await send(config.client, new GetBucketPolicyCommand({ Bucket: bucket }));
    } catch (error) {
      if (error.name === 'NoSuchBucketPolicy') continue;
      throw error;
    }
    throw new Error(
      'Restore requires dedicated buckets without a bucket policy.'
    );
  }
  const receipt = {
    version: 1,
    captureId: manifest.id,
    startedAt: new Date().toISOString(),
    objects: 0,
    state: 'started',
    acl: 'private',
    archivedRecoveryRecords: 0
  };
  const claim = 'system-recovery/restore-claim.json';
  const recoveryKeys = new Set([
    claim,
    'system-recovery/restore-complete.json'
  ]);
  if (
    manifest.objects.some(
      (o) => o.key.startsWith('system-recovery/') && !recoveryKeys.has(o.key)
    )
  )
    throw new Error('Reserved recovery key in source capture.');
  for (const Bucket of Object.values(config.buckets))
    await send(
      config.client,
      new PutObjectCommand({
        Bucket,
        Key: claim,
        Body: JSON.stringify(receipt),
        ContentType: 'application/json',
        ACL: 'private',
        IfNoneMatch: '*'
      })
    );
  for (const object of manifest.objects) {
    // Prior recovery receipts stay in the verified capture. This recovery writes
    // its own receipts, so a recovered installation can itself be recovered later.
    if (recoveryKeys.has(object.key)) {
      receipt.archivedRecoveryRecords++;
      continue;
    }
    // No public-read ACL is replayed. Restored objects remain quarantined for reconciliation.
    await send(
      config.client,
      new PutObjectCommand({
        Bucket: config.buckets[object.role],
        Key: object.key,
        Body: object.bytes
          ? createReadStream(join(directory, object.file))
          : Buffer.alloc(0),
        ContentLength: object.bytes,
        ContentType: object.contentType,
        CacheControl: object.cacheControl || undefined,
        Metadata: object.metadata,
        ACL: 'private',
        IfNoneMatch: '*'
      })
    );
    const response = await send(
      config.client,
      new GetObjectCommand({
        Bucket: config.buckets[object.role],
        Key: object.key
      })
    );
    const hash = createHash('sha256');
    let bytes = 0;
    await pipeline(
      response.Body,
      new Writable({
        write(chunk, _, next) {
          hash.update(chunk);
          bytes += chunk.length;
          next();
        }
      }),
      { signal: AbortSignal.timeout(60000) }
    );
    if (
      bytes !== object.bytes ||
      hash.digest('hex') !== object.sha256 ||
      response.ContentType !== object.contentType ||
      (response.CacheControl || null) !== object.cacheControl ||
      !isDeepStrictEqual(response.Metadata || {}, object.metadata)
    )
      throw new Error('Restored S3 object verification failed.');
    receipt.objects++;
  }
  receipt.state = 'verified-private';
  receipt.completedAt = new Date().toISOString();
  // Append-only completion evidence; the claim remains even after failure.
  for (const Bucket of Object.values(config.buckets))
    await send(
      config.client,
      new PutObjectCommand({
        Bucket,
        Key: 'system-recovery/restore-complete.json',
        Body: JSON.stringify(receipt),
        ContentType: 'application/json',
        ACL: 'private',
        IfNoneMatch: '*'
      })
    );
  return receipt;
}
