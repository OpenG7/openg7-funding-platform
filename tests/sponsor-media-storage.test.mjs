import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createSponsorLogoStorage,
  createSponsorMediaStorage
} from '../dist/apps/funding-api/src/sponsor-media-storage.js';

const emptyS3Config = {
  region: undefined,
  endpoint: undefined,
  privateBucket: undefined,
  publicBucket: undefined,
  publicBaseUrl: undefined,
  privateBaseUrl: undefined,
  accessKeyId: undefined,
  secretAccessKey: undefined
};

test('storage factories preserve default, normalized and filesystem drivers', () => {
  for (const createStorage of [
    createSponsorLogoStorage,
    createSponsorMediaStorage
  ]) {
    for (const driver of [
      undefined,
      'local',
      ' LOCAL ',
      'filesystem',
      ' FileSystem '
    ]) {
      assert.equal(
        createStorage({
          driver,
          localStorageDir: os.tmpdir(),
          s3: emptyS3Config
        }).driver,
        'local'
      );
    }
    for (const driver of ['', 's3', 'unsupported']) {
      assert.throws(
        () =>
          createStorage({
            driver,
            localStorageDir: os.tmpdir(),
            s3: emptyS3Config
          }),
        {
          message:
            'SPONSOR_MEDIA_STORAGE_DRIVER must be either local or ovh-s3.'
        }
      );
    }
  }
});

test('both storage factories preserve required S3 fields and trailing slash errors', () => {
  const validS3Config = {
    region: 'us-east-1',
    endpoint: 'https://s3.example.test',
    privateBucket: 'private-fixture',
    publicBucket: 'public-fixture',
    publicBaseUrl: 'https://media.example.test',
    privateBaseUrl: 'https://private.example.test',
    accessKeyId: 'fixture',
    secretAccessKey: 'synthetic-fixture'
  };
  const fields = {
    region: 'SPONSOR_MEDIA_REGION',
    endpoint: 'SPONSOR_MEDIA_ENDPOINT',
    privateBucket: 'SPONSOR_MEDIA_PRIVATE_BUCKET',
    publicBucket: 'SPONSOR_MEDIA_PUBLIC_BUCKET',
    publicBaseUrl: 'SPONSOR_MEDIA_PUBLIC_BASE_URL',
    privateBaseUrl: 'SPONSOR_MEDIA_PRIVATE_BASE_URL',
    accessKeyId: 'OVH_S3_ACCESS_KEY_ID',
    secretAccessKey: 'OVH_S3_SECRET_ACCESS_KEY'
  };
  for (const createStorage of [
    createSponsorLogoStorage,
    createSponsorMediaStorage
  ]) {
    const config = {
      driver: ' OVH-S3 ',
      localStorageDir: '',
      s3: validS3Config
    };
    assert.equal(createStorage(config).driver, 'ovh-s3');
    for (const [field, name] of Object.entries(fields)) {
      for (const value of [undefined, '   ']) {
        assert.throws(
          () =>
            createStorage({
              ...config,
              s3: { ...validS3Config, [field]: value }
            }),
          {
            message: `${name} is required when SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3.`
          }
        );
      }
    }
    for (const field of ['endpoint', 'publicBaseUrl', 'privateBaseUrl']) {
      assert.throws(
        () =>
          createStorage({
            ...config,
            s3: { ...validS3Config, [field]: `${validS3Config[field]}/` }
          }),
        { message: `${fields[field]} must not end with a slash.` }
      );
    }
  }
});

test('local sponsor logo storage writes, reads, and deletes one object', async () => {
  const storageDir = await mkdtemp(
    path.join(os.tmpdir(), 'openg7-sponsor-logos-')
  );

  try {
    const storage = createSponsorLogoStorage({
      driver: 'local',
      localStorageDir: storageDir,
      s3: emptyS3Config
    });

    assert.equal(storage.driver, 'local');
    assert.equal(await storage.readLogo('missing.webp'), null);

    await storage.writeLogo({
      filename: 'logo.webp',
      data: Buffer.from('webp bytes'),
      contentType: 'image/webp'
    });

    assert.deepEqual(
      await storage.readLogo('logo.webp'),
      Buffer.from('webp bytes')
    );
    assert.equal(await storage.deleteLogo('logo.webp'), true);
    assert.equal(await storage.deleteLogo('logo.webp'), false);
  } finally {
    await rm(storageDir, { recursive: true, force: true });
  }
});

test('local sponsor logo storage rejects path traversal', async () => {
  const storageDir = await mkdtemp(
    path.join(os.tmpdir(), 'openg7-sponsor-logos-')
  );

  try {
    const storage = createSponsorLogoStorage({
      driver: 'local',
      localStorageDir: storageDir,
      s3: emptyS3Config
    });

    await assert.rejects(
      () =>
        storage.writeLogo({
          filename: '../secret.webp',
          data: Buffer.from('x'),
          contentType: 'image/webp'
        }),
      /single safe path segment/
    );
  } finally {
    await rm(storageDir, { recursive: true, force: true });
  }
});

test('local sponsor media storage keeps private and public objects separate', async () => {
  const storageDir = await mkdtemp(
    path.join(os.tmpdir(), 'openg7-sponsor-media-')
  );

  try {
    const storage = createSponsorMediaStorage({
      driver: 'local',
      localStorageDir: storageDir,
      s3: emptyS3Config
    });
    const privateKey = 'sponsors/contribution-id/asset-id/processed.webp';
    const publicKey = 'sponsors/contribution-id/asset-id/checksum.webp';
    const image = Buffer.from('processed webp bytes');

    await storage.writePrivateObject({
      key: privateKey,
      data: image,
      contentType: 'image/webp'
    });

    assert.deepEqual(await storage.readPrivateObject(privateKey), image);
    assert.equal(await storage.readPublicObject(publicKey), null);

    await storage.publishObject({
      privateKey,
      publicKey,
      contentType: 'image/webp'
    });

    assert.deepEqual(await storage.readPublicObject(publicKey), image);
    assert.equal(storage.publicUrl(publicKey), null);
    assert.equal(await storage.deletePublicObject(publicKey), true);
    assert.deepEqual(await storage.readPrivateObject(privateKey), image);
    assert.equal(await storage.deletePrivateObject(privateKey), true);
  } finally {
    await rm(storageDir, { recursive: true, force: true });
  }
});

test('local sponsor media storage rejects path traversal', async () => {
  const storageDir = await mkdtemp(
    path.join(os.tmpdir(), 'openg7-sponsor-media-')
  );

  try {
    const storage = createSponsorMediaStorage({
      driver: 'local',
      localStorageDir: storageDir,
      s3: emptyS3Config
    });

    await assert.rejects(
      () =>
        storage.writePrivateObject({
          key: '../secret.webp',
          data: Buffer.from('x'),
          contentType: 'image/webp'
        }),
      /safe relative object key/
    );
  } finally {
    await rm(storageDir, { recursive: true, force: true });
  }
});

test('ovh-s3 sponsor logo storage requires explicit S3 configuration', () => {
  assert.throws(
    () =>
      createSponsorLogoStorage({
        driver: 'ovh-s3',
        localStorageDir: '/tmp/sponsor-logos',
        s3: emptyS3Config
      }),
    /SPONSOR_MEDIA_REGION is required/
  );
});

test('ovh-s3 sponsor media storage requires explicit S3 configuration', () => {
  assert.throws(
    () =>
      createSponsorMediaStorage({
        driver: 'ovh-s3',
        localStorageDir: '/tmp/sponsor-media',
        s3: emptyS3Config
      }),
    /SPONSOR_MEDIA_REGION is required/
  );
});
