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
