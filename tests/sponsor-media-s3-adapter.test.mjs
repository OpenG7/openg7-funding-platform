import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import {
  createSponsorLogoStorage,
  createSponsorMediaStorage
} from '../dist/apps/funding-api/src/sponsor-media-storage.js';
import {
  OvhS3SponsorLogoStorage,
  OvhS3SponsorMediaStorage
} from '../dist/apps/funding-api/src/sponsor-media/s3-storage.js';
import {
  isS3NotFoundError,
  responseBodyToBuffer
} from '../dist/apps/funding-api/src/sponsor-media/s3-response.js';

const config = {
  driver: 'ovh-s3',
  localStorageDir: '/unused',
  s3: {
    region: 'test-region',
    endpoint: 'http://127.0.0.1:1',
    privateBucket: 'private-media',
    publicBucket: 'public-media',
    publicBaseUrl: 'https://media.example.test',
    privateBaseUrl: 'https://private.example.test',
    accessKeyId: 'synthetic-access-key',
    secretAccessKey: 'synthetic-secret-key'
  }
};

const missing = {
  name: 'NoSuchKey',
  $metadata: { httpStatusCode: 404 }
};
const denied = {
  name: 'AccessDenied',
  $metadata: { httpStatusCode: 403 }
};

test('S3 response conversion accepts empty, byte, SDK and stream bodies', async () => {
  assert.deepEqual(await responseBodyToBuffer(undefined), Buffer.alloc(0));
  assert.deepEqual(await responseBodyToBuffer(null), Buffer.alloc(0));
  assert.deepEqual(
    await responseBodyToBuffer(new Uint8Array([0, 1, 2, 3]).subarray(1, 3)),
    Buffer.from([1, 2])
  );
  assert.deepEqual(
    await responseBodyToBuffer(Buffer.from('buffer')),
    Buffer.from('buffer')
  );
  assert.deepEqual(
    await responseBodyToBuffer({
      transformToByteArray: async () => new Uint8Array([4, 5])
    }),
    Buffer.from([4, 5])
  );
  assert.deepEqual(
    await responseBodyToBuffer(
      Readable.from([Buffer.from('one'), new Uint8Array([32]), 'two'])
    ),
    Buffer.from('one two')
  );
});

test('S3 response conversion preserves transformation and stream failures', async () => {
  await assert.rejects(
    responseBodyToBuffer({}),
    /Unsupported S3 response body type/
  );
  const transformError = new Error('synthetic SDK body failure');
  await assert.rejects(
    responseBodyToBuffer({
      transformToByteArray: async () => {
        throw transformError;
      }
    }),
    (error) => error === transformError
  );
  const streamError = new Error('synthetic stream failure');
  const stream = Readable.from(
    (async function* () {
      yield Buffer.from('partial');
      throw streamError;
    })()
  );
  await assert.rejects(
    responseBodyToBuffer(stream),
    (error) => error === streamError
  );
});

test('S3 absence recognition does not turn denied or unavailable responses into absence', () => {
  for (const error of [
    missing,
    { name: 'NotFound' },
    { name: 'NoSuchKey' },
    { $metadata: { httpStatusCode: 404 } }
  ]) {
    assert.equal(isS3NotFoundError(error), true);
  }
  for (const error of [
    denied,
    { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } },
    new Error('synthetic network failure')
  ]) {
    assert.equal(isS3NotFoundError(error), false);
  }
});

test('S3 logo and media reads use separate clients and buckets and propagate 403', async (t) => {
  const calls = [];
  let result = { Body: Readable.from([Buffer.from('private bytes')]) };
  let failure;
  t.mock.method(S3Client.prototype, 'send', async function (command) {
    calls.push({ client: this, command });
    assert.ok(command instanceof GetObjectCommand);
    if (failure) throw failure;
    return result;
  });

  const logo = createSponsorLogoStorage(config);
  const media = createSponsorMediaStorage(config);
  assert.ok(logo instanceof OvhS3SponsorLogoStorage);
  assert.ok(media instanceof OvhS3SponsorMediaStorage);
  assert.equal(logo.driver, 'ovh-s3');
  assert.equal(media.driver, 'ovh-s3');
  assert.deepEqual(
    await logo.readLogo('logo.webp'),
    Buffer.from('private bytes')
  );
  assert.deepEqual(calls.at(-1).command.input, {
    Bucket: 'private-media',
    Key: 'sponsor-logos/logo.webp'
  });

  result = { Body: new Uint8Array([1, 2]) };
  const key = 'sponsors/contribution/asset/processed.webp';
  assert.deepEqual(await media.readPrivateObject(key), Buffer.from([1, 2]));
  assert.notEqual(calls[0].client, calls[1].client);
  assert.deepEqual(calls.at(-1).command.input, {
    Bucket: 'private-media',
    Key: key
  });
  await media.readPublicObject(key);
  assert.deepEqual(calls.at(-1).command.input, {
    Bucket: 'public-media',
    Key: key
  });

  for (failure of [
    missing,
    { name: 'NotFound' },
    { $metadata: { httpStatusCode: 404 } }
  ]) {
    assert.equal(await logo.readLogo('logo.webp'), null);
    assert.equal(await media.readPrivateObject(key), null);
    assert.equal(await media.readPublicObject(key), null);
  }
  failure = denied;
  await assert.rejects(logo.readLogo('logo.webp'), (error) => error === denied);
  await assert.rejects(
    media.readPrivateObject(key),
    (error) => error === denied
  );
  await assert.rejects(
    media.readPublicObject(key),
    (error) => error === denied
  );
});

test('S3 writes check existence before preserving private ACL and cache policy', async (t) => {
  const commands = [];
  let headFailure = missing;
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    commands.push(command);
    if (command instanceof HeadObjectCommand && headFailure) throw headFailure;
    return {};
  });
  const logo = createSponsorLogoStorage(config);
  const media = createSponsorMediaStorage(config);
  const data = Buffer.from('synthetic image');
  const logoInput = { filename: 'logo.webp', data, contentType: 'image/webp' };
  const mediaInput = {
    key: 'sponsors/contribution/asset/processed.webp',
    data,
    contentType: 'image/webp'
  };

  await logo.writeLogo(logoInput);
  await media.writePrivateObject(mediaInput);
  for (const [index, key] of [
    [0, 'sponsor-logos/logo.webp'],
    [2, mediaInput.key]
  ]) {
    assert.ok(commands[index] instanceof HeadObjectCommand);
    assert.deepEqual(commands[index].input, {
      Bucket: 'private-media',
      Key: key
    });
    assert.ok(commands[index + 1] instanceof PutObjectCommand);
    assert.deepEqual(commands[index + 1].input, {
      ACL: 'private',
      Body: data,
      Bucket: 'private-media',
      CacheControl: 'private, no-store',
      ContentType: 'image/webp',
      Key: key
    });
  }

  headFailure = undefined;
  await assert.rejects(
    logo.writeLogo(logoInput),
    /Sponsor logo object already exists/
  );
  await assert.rejects(
    media.writePrivateObject(mediaInput),
    /Sponsor media object already exists/
  );
  headFailure = denied;
  await assert.rejects(logo.writeLogo(logoInput), (error) => error === denied);
  await assert.rejects(
    media.writePrivateObject(mediaInput),
    (error) => error === denied
  );
  assert.equal(
    commands.filter((command) => command instanceof PutObjectCommand).length,
    2
  );
});

test('S3 publication copies the supplied private key to an immutable public object', async (t) => {
  const commands = [];
  let headFailure = missing;
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    commands.push(command);
    if (command instanceof HeadObjectCommand && headFailure) throw headFailure;
    return {};
  });
  const media = createSponsorMediaStorage(config);
  const input = {
    privateKey: 'sponsors/contribution-id/asset.v2/processed_image.webp',
    publicKey: 'sponsors/contribution-id/asset.v2/checksum.webp',
    contentType: 'image/webp'
  };
  await media.publishObject(input);
  assert.ok(commands[0] instanceof HeadObjectCommand);
  assert.deepEqual(commands[0].input, {
    Bucket: 'public-media',
    Key: input.publicKey
  });
  assert.ok(commands[1] instanceof CopyObjectCommand);
  assert.deepEqual(commands[1].input, {
    ACL: 'public-read',
    Bucket: 'public-media',
    CacheControl: 'public, max-age=31536000, immutable',
    ContentType: 'image/webp',
    CopySource:
      'private-media/sponsors/contribution-id/asset.v2/processed_image.webp',
    Key: input.publicKey,
    MetadataDirective: 'REPLACE'
  });
  assert.equal(
    media.publicUrl(input.publicKey),
    'https://media.example.test/sponsors/contribution-id/asset.v2/checksum.webp'
  );

  headFailure = undefined;
  await assert.rejects(
    media.publishObject(input),
    /Published sponsor media object already exists/
  );
  headFailure = denied;
  await assert.rejects(media.publishObject(input), (error) => error === denied);
  assert.equal(
    commands.filter((command) => command instanceof CopyObjectCommand).length,
    1
  );
});

test('S3 deletion distinguishes absent objects from denied access for every bucket', async (t) => {
  const commands = [];
  let headFailure;
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    commands.push(command);
    if (command instanceof HeadObjectCommand && headFailure) throw headFailure;
    return {};
  });
  const logo = createSponsorLogoStorage(config);
  const media = createSponsorMediaStorage(config);
  const key = 'sponsors/contribution/asset/processed.webp';
  const operations = [
    [
      () => logo.deleteLogo('logo.webp'),
      'private-media',
      'sponsor-logos/logo.webp'
    ],
    [() => media.deletePrivateObject(key), 'private-media', key],
    [() => media.deletePublicObject(key), 'public-media', key]
  ];
  for (const [operation, bucket, objectKey] of operations) {
    assert.equal(await operation(), true);
    assert.ok(commands.at(-2) instanceof HeadObjectCommand);
    assert.ok(commands.at(-1) instanceof DeleteObjectCommand);
    assert.deepEqual(commands.at(-1).input, { Bucket: bucket, Key: objectKey });
  }
  headFailure = missing;
  for (const [operation] of operations) assert.equal(await operation(), false);
  headFailure = denied;
  for (const [operation] of operations) {
    await assert.rejects(operation(), (error) => error === denied);
  }
  assert.equal(
    commands.filter((command) => command instanceof DeleteObjectCommand).length,
    3
  );
});

test('S3 health checks send the same AbortSignal to both bucket requests', async (t) => {
  const controller = new AbortController();
  const calls = [];
  const abortError = new Error('synthetic cancellation');
  t.mock.method(S3Client.prototype, 'send', async (command, options) => {
    calls.push({ command, options });
    return new Promise((resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(abortError), {
        once: true
      });
    });
  });
  const media = createSponsorMediaStorage(config);
  const pending = media.checkReadAccess(controller.signal);
  const rejection = assert.rejects(pending, (error) => error === abortError);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ command }) => command.input),
    [{ Bucket: 'private-media' }, { Bucket: 'public-media' }]
  );
  for (const { command, options } of calls) {
    assert.ok(command instanceof HeadBucketCommand);
    assert.equal(options.abortSignal, controller.signal);
  }
  controller.abort();
  await rejection;
});

test('S3 adapters reject unsafe paths before sending provider commands', async (t) => {
  const send = t.mock.method(S3Client.prototype, 'send', async () => ({}));
  const logo = createSponsorLogoStorage(config);
  const media = createSponsorMediaStorage(config);
  await assert.rejects(
    logo.readLogo('../logo.webp'),
    /single safe path segment/
  );
  await assert.rejects(
    logo.deleteLogo('nested/logo.webp'),
    /single safe path segment/
  );
  await assert.rejects(
    logo.writeLogo({
      filename: '..',
      data: Buffer.from('x'),
      contentType: 'image/webp'
    }),
    /single safe path segment/
  );
  for (const key of [
    '../secret.webp',
    '/root.webp',
    'a//b.webp',
    'a/./b.webp',
    'a\\b.webp',
    'a b.webp'
  ]) {
    await assert.rejects(
      media.readPrivateObject(key),
      /safe relative object key/
    );
    await assert.rejects(
      media.readPublicObject(key),
      /safe relative object key/
    );
    await assert.rejects(
      media.writePrivateObject({
        key,
        data: Buffer.from('x'),
        contentType: 'image/webp'
      }),
      /safe relative object key/
    );
    await assert.rejects(
      media.deletePrivateObject(key),
      /safe relative object key/
    );
    await assert.rejects(
      media.deletePublicObject(key),
      /safe relative object key/
    );
    await assert.rejects(
      media.publishObject({
        privateKey: key,
        publicKey: 'safe.webp',
        contentType: 'image/webp'
      }),
      /safe relative object key/
    );
    await assert.rejects(
      media.publishObject({
        privateKey: 'safe.webp',
        publicKey: key,
        contentType: 'image/webp'
      }),
      /safe relative object key/
    );
    assert.throws(() => media.publicUrl(key), /safe relative object key/);
  }
  assert.equal(send.mock.callCount(), 0);
});
