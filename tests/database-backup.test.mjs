import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { backupConfig } from '../dist/apps/funding-api/src/database-backup/config.js';
import { dumpEnvironment } from '../dist/apps/funding-api/src/database-backup/capture.js';
import { BackupStorage } from '../dist/apps/funding-api/src/database-backup/storage.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

const settings = {
  FUNDING_BACKUP_ENABLED: 'true',
  FUNDING_BACKUP_DATABASE_URL:
    'postgres://fixture:private%40password@postgres/fixture?sslmode=disable',
  FUNDING_BACKUP_DIRECTORY:
    process.platform === 'win32'
      ? 'C:/synthetic/backups'
      : '/synthetic/backups',
  FUNDING_BACKUP_AGE_RECIPIENT: 'age1' + 'a'.repeat(58),
  FUNDING_BACKUP_NAMESPACE: 'test',
  FUNDING_BACKUP_S3_ENDPOINT: 'https://storage.example.test',
  FUNDING_BACKUP_S3_REGION: 'test-region',
  FUNDING_BACKUP_S3_BUCKET: 'synthetic-backups',
  FUNDING_BACKUP_S3_ACCESS_KEY_ID: 'fixture-key',
  FUNDING_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret'
};

test('uploads are conditional, encrypted, checksum-bound and never repeated after a lost response', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'og7-backup-upload-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const file = join(directory, 'fixture.age');
  const contents = Buffer.from('synthetic ciphertext');
  await writeFile(file, contents);
  const storage = new BackupStorage(backupConfig(settings));
  t.after(() => storage.client.destroy());
  assert.equal(await storage.client.config.maxAttempts(), 1);
  const id = randomUUID();
  const proof = {
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
    retainUntil: '2099-01-01T00:00:00.000Z'
  };
  let uploads = 0;
  storage.client.send = async (command) => {
    assert.equal(command.constructor.name, 'PutObjectCommand');
    uploads++;
    assert.equal(command.input.IfNoneMatch, '*');
    assert.equal(command.input.ObjectLockMode, 'COMPLIANCE');
    assert.equal(
      command.input.ObjectLockRetainUntilDate.toISOString(),
      proof.retainUntil
    );
    assert.equal(
      command.input.ChecksumSHA256,
      Buffer.from(proof.sha256, 'hex').toString('base64')
    );
    assert.equal(command.input.Metadata['request-id'], id);
    const chunks = [];
    for await (const chunk of command.input.Body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), contents);
    throw new Error('lost response');
  };
  await assert.rejects(
    storage.upload(id, file, proof, AbortSignal.timeout(1000))
  );
  assert.equal(uploads, 1);
});

test('backup configuration is disabled by default and fails closed without exposing private values', () => {
  assert.equal(backupConfig({}), null);
  assert.equal(backupConfig({ FUNDING_BACKUP_ENABLED: 'false' }), null);
  assert.throws(() => backupConfig({ FUNDING_BACKUP_ENABLED: 'yes' }));
  assert.ok(backupConfig(settings));
  assert.match(
    backupConfig({
      ...settings,
      FUNDING_BACKUP_DATABASE_URL:
        'postgres://fixture:secret@db.example.test/fixture'
    }).databaseUrl,
    /sslmode=verify-full/
  );
  assert.throws(() =>
    backupConfig({
      ...settings,
      FUNDING_BACKUP_DATABASE_URL:
        'postgres://fixture:secret@db.example.test/fixture?sslmode=disable'
    })
  );
  for (const key of Object.keys(settings).filter(
    (key) => key !== 'FUNDING_BACKUP_ENABLED'
  )) {
    assert.throws(() => backupConfig({ ...settings, [key]: '' }));
  }
  for (const [key, value] of [
    ['S3_ENDPOINT', 'http://example.test'],
    ['S3_ENDPOINT', 'https://private:secret@example.test'],
    ['S3_ENDPOINT', 'https://example.test/private'],
    ['DIRECTORY', '../escape'],
    ['AGE_RECIPIENT', 'AGE-SECRET-KEY-PRIVATE'],
    ['NAMESPACE', '../prod'],
    ['DATABASE_URL', 'private-invalid-url'],
    ['DATABASE_URL', 'postgres://user:secret@host/db?sslmode=no-verify'],
    ['DATABASE_URL', 'postgres://user:secret@host/db?options=private'],
    ['S3_BUCKET', '--invalid']
  ]) {
    assert.throws(
      () => backupConfig({ ...settings, ['FUNDING_BACKUP_' + key]: value }),
      (error) => !error.message.includes(value)
    );
  }
  const env = dumpEnvironment(settings.FUNDING_BACKUP_DATABASE_URL);
  assert.equal(env.PGPASSWORD, 'private@password');
  assert.equal(env.PGSSLMODE, 'disable');
  assert.equal(env.PGHOST, 'postgres');
  assert.equal(env.PGDATABASE, 'fixture');
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(
    dumpEnvironment('postgres://user:secret@db.example.test/db').PGSSLMODE,
    'verify-full'
  );
});

test('both backup reads and writes are owner-only, including API aliases', () => {
  for (const method of ['GET', 'POST'])
    for (const path of ['/admin/backups', '/api/admin/backups']) {
      assert.equal(adminRoleAllows('owner', method, path), true);
      for (const role of ['reader', 'operator'])
        assert.equal(adminRoleAllows(role, method, path), false);
    }
});

test('backup storage preflight refuses absent immutability, suspended versioning, public ACL and unreviewed policies', async (t) => {
  const storage = new BackupStorage(backupConfig(settings));
  t.after(() => storage.client.destroy());
  const good = {
    GetObjectLockConfigurationCommand: {
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' }
    },
    GetBucketVersioningCommand: { Status: 'Enabled' },
    GetBucketAclCommand: {
      Owner: { ID: 'fixture' },
      Grants: [{ Grantee: { Type: 'CanonicalUser', ID: 'fixture' } }]
    }
  };
  const missingPolicy = () => {
    throw Object.assign(new Error(), { name: 'NoSuchBucketPolicy' });
  };
  storage.client.send = async (command) =>
    good[command.constructor.name] ?? missingPolicy();
  await storage.check(AbortSignal.timeout(1000));
  for (const [command, value] of [
    ['GetObjectLockConfigurationCommand', {}],
    ['GetBucketVersioningCommand', { Status: 'Suspended' }],
    ['GetBucketAclCommand', { Owner: { ID: 'fixture' } }],
    [
      'GetBucketAclCommand',
      {
        Owner: { ID: 'fixture' },
        Grants: [{ Grantee: { Type: 'Group', URI: 'all-users' } }]
      }
    ],
    ['GetBucketPolicyCommand', { Policy: '{}' }]
  ]) {
    storage.client.send = async (request) =>
      request.constructor.name === command
        ? value
        : (good[request.constructor.name] ?? missingPolicy());
    await assert.rejects(storage.check(AbortSignal.timeout(1000)));
  }
});

test('successful metadata cannot substitute for reading and hashing the locked object version', async (t) => {
  const storage = new BackupStorage(backupConfig(settings));
  t.after(() => storage.client.destroy());
  const requestId = randomUUID();
  const contents = Buffer.from('synthetic encrypted bytes');
  const proof = {
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
    retainUntil: '2099-01-01T00:00:00.000Z'
  };
  const head = {
    VersionId: 'fixture-v1',
    ContentLength: proof.bytes,
    Metadata: { sha256: proof.sha256, 'request-id': requestId },
    ObjectLockMode: 'COMPLIANCE',
    ObjectLockRetainUntilDate: new Date(proof.retainUntil)
  };
  let body = contents;
  storage.client.send = async (command) => {
    if (command.constructor.name === 'HeadObjectCommand') return head;
    assert.equal(command.constructor.name, 'GetObjectCommand');
    assert.equal(command.input.VersionId, 'fixture-v1');
    return { Body: Readable.from([body]) };
  };
  await storage.verify(requestId, proof, AbortSignal.timeout(1000));
  body = Buffer.from('corrupted');
  await assert.rejects(
    storage.verify(requestId, proof, AbortSignal.timeout(1000))
  );
  body = contents;
  head.ObjectLockMode = 'GOVERNANCE';
  await assert.rejects(
    storage.verify(requestId, proof, AbortSignal.timeout(1000))
  );
});
