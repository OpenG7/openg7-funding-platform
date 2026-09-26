import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { s3BackupConfig, captureS3 } from '../scripts/lib/s3-backup.mjs';

const valid = {
  SPONSOR_MEDIA_ENDPOINT: 'https://storage.example.test',
  SPONSOR_MEDIA_REGION: 'bhs',
  SPONSOR_MEDIA_PRIVATE_BUCKET: 'private-fixture',
  SPONSOR_MEDIA_PUBLIC_BUCKET: 'public-fixture',
  OVH_S3_ACCESS_KEY_ID: 'fixture',
  OVH_S3_SECRET_ACCESS_KEY: 'synthetic-only'
};
test('S3 backup requires explicit credentials and distinct buckets; HTTPS is mandatory outside loopback tests', () => {
  for (const key of Object.keys(valid)) {
    const env = { ...valid };
    delete env[key];
    assert.throws(() => s3BackupConfig(env));
  }
  for (const override of [
    { SPONSOR_MEDIA_ENDPOINT: 'http://storage.example.test' },
    { SPONSOR_MEDIA_ENDPOINT: 'https://private:secret@storage.example.test' },
    { SPONSOR_MEDIA_ENDPOINT: 'https://storage.example.test?token=private' },
    { SPONSOR_MEDIA_ENDPOINT: 'http://127.0.0.1:9090', NODE_ENV: 'production' },
    { SPONSOR_MEDIA_PUBLIC_BUCKET: valid.SPONSOR_MEDIA_PRIVATE_BUCKET }
  ])
    assert.throws(() => s3BackupConfig({ ...valid, ...override }));
  for (const env of [
    valid,
    {
      ...valid,
      NODE_ENV: 'test',
      SPONSOR_MEDIA_ENDPOINT: 'http://127.0.0.1:9090'
    }
  ])
    s3BackupConfig(env).client.destroy();
});

test('a source inventory changed during capture never gets a completed manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'og7-s3-changing-'));
  let calls = 0;
  const config = {
    buckets: { private: 'private-fixture', public: 'public-fixture' },
    endpoint: 'https://storage.example.test',
    client: {
      async send() {
        calls++;
        return calls <= 2
          ? { Contents: [] }
          : { Contents: [{ Key: 'late-object', ETag: 'changed', Size: 1 }] };
      }
    }
  };
  try {
    await assert.rejects(
      captureS3(config, join(root, 'capture')),
      /inventory changed/
    );
    await assert.rejects(access(join(root, 'capture/manifest.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
