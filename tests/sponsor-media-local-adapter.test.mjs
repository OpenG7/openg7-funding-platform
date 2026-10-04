import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LocalSponsorLogoStorage,
  LocalSponsorMediaStorage
} from '../dist/apps/funding-api/src/sponsor-media/local-storage.js';

const withStorageDirectory = async (run) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'openg7-local-media-adapter-')
  );
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('local logo writes refuse to overwrite the existing bytes', async () => {
  await withStorageDirectory(async (directory) => {
    const storage = new LocalSponsorLogoStorage(directory);
    const input = {
      filename: 'logo.webp',
      data: Buffer.from('first logo'),
      contentType: 'image/webp'
    };
    await storage.writeLogo(input);
    await assert.rejects(
      storage.writeLogo({ ...input, data: Buffer.from('replacement logo') }),
      { code: 'EEXIST' }
    );
    assert.deepEqual(await storage.readLogo(input.filename), input.data);
  });
});

test('local private writes and public copies keep existing media immutable', async () => {
  await withStorageDirectory(async (directory) => {
    const storage = new LocalSponsorMediaStorage(directory);
    const privateKey = 'sponsors/asset-id/processed.webp';
    const publicKey = 'sponsors/asset-id/checksum.webp';
    const image = Buffer.from('approved image');

    await storage.writePrivateObject({
      key: privateKey,
      data: image,
      contentType: 'image/webp'
    });
    await assert.rejects(
      storage.writePrivateObject({
        key: privateKey,
        data: Buffer.from('replacement image'),
        contentType: 'image/webp'
      }),
      { code: 'EEXIST' }
    );
    await storage.publishObject({
      privateKey,
      publicKey,
      contentType: 'image/webp'
    });
    await assert.rejects(
      storage.publishObject({
        privateKey,
        publicKey,
        contentType: 'image/webp'
      }),
      { code: 'EEXIST' }
    );

    assert.deepEqual(await storage.readPrivateObject(privateKey), image);
    assert.deepEqual(await storage.readPublicObject(publicKey), image);
    assert.equal(await storage.deletePublicObject(publicKey), true);
    assert.equal(await storage.deletePublicObject(publicKey), false);
    assert.equal(await storage.readPublicObject(publicKey), null);
    assert.deepEqual(await storage.readPrivateObject(privateKey), image);
    assert.equal(await storage.deletePrivateObject(privateKey), true);
    assert.equal(await storage.deletePrivateObject(privateKey), false);
    assert.equal(await storage.readPrivateObject(privateKey), null);
  });
});

test('local logo reads and deletes reject unsafe filenames before filesystem access', async () => {
  await withStorageDirectory(async (directory) => {
    const storage = new LocalSponsorLogoStorage(directory);
    for (const filename of [
      '',
      '..',
      '../outside.webp',
      'nested/logo.webp',
      'nested\\logo.webp'
    ]) {
      await assert.rejects(
        storage.readLogo(filename),
        /single safe path segment/
      );
      await assert.rejects(
        storage.deleteLogo(filename),
        /single safe path segment/
      );
    }
  });
});

test('local media reads, deletes, and publication reject unsafe object keys', async () => {
  await withStorageDirectory(async (directory) => {
    const storage = new LocalSponsorMediaStorage(directory);
    for (const key of [
      '',
      '../outside.webp',
      './logo.webp',
      '/absolute.webp',
      'nested//logo.webp',
      'nested/',
      'nested\\logo.webp',
      'logo with spaces.webp'
    ]) {
      for (const readOrDelete of [
        () => storage.readPrivateObject(key),
        () => storage.readPublicObject(key),
        () => storage.deletePrivateObject(key),
        () => storage.deletePublicObject(key)
      ]) {
        await assert.rejects(readOrDelete, /safe relative object key/);
      }
      await assert.rejects(
        storage.publishObject({
          privateKey: key,
          publicKey: 'safe.webp',
          contentType: 'image/webp'
        }),
        /safe relative object key/
      );
      await assert.rejects(
        storage.publishObject({
          privateKey: 'safe.webp',
          publicKey: key,
          contentType: 'image/webp'
        }),
        /safe relative object key/
      );
    }
  });
});

test('local adapters propagate filesystem errors other than missing objects', async () => {
  await withStorageDirectory(async (directory) => {
    const logoStorage = new LocalSponsorLogoStorage(directory);
    const mediaStorage = new LocalSponsorMediaStorage(directory);
    await mkdir(path.join(directory, 'blocked.webp'));
    for (const visibility of ['private', 'public']) {
      await mkdir(
        path.join(directory, 'media-assets', visibility, 'blocked.webp'),
        { recursive: true }
      );
    }

    for (const readOrDelete of [
      () => logoStorage.readLogo('blocked.webp'),
      () => logoStorage.deleteLogo('blocked.webp'),
      () => mediaStorage.readPrivateObject('blocked.webp'),
      () => mediaStorage.readPublicObject('blocked.webp'),
      () => mediaStorage.deletePrivateObject('blocked.webp'),
      () => mediaStorage.deletePublicObject('blocked.webp')
    ]) {
      await assert.rejects(readOrDelete, (error) => {
        assert.ok(error.code);
        assert.notEqual(error.code, 'ENOENT');
        return true;
      });
    }
  });
});

test('local media health rejects a root that is a file', async () => {
  await withStorageDirectory(async (directory) => {
    const rootFile = path.join(directory, 'root-file');
    await writeFile(rootFile, 'file content');
    const storage = new LocalSponsorMediaStorage(rootFile);
    await assert.rejects(
      storage.checkReadAccess(new AbortController().signal),
      /Storage directory unavailable/
    );
  });
});
