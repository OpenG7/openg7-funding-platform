import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { startDisposableProvider } from './support/disposable-provider.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { sendTransactionalEmail } from '../../dist/apps/funding-api/src/services/email/email.service.js';
import { createSponsorMediaStorage } from '../../dist/apps/funding-api/src/sponsor-media-storage.js';

const eventually = async (fn) => {
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await setTimeout(500);
    }
  }
};
test(
  'local SMTP receives a real MIME message and a backup restores PostgreSQL, configuration and S3 media into separate targets',
  { timeout: 180000 },
  async (t) => {
    const mail = await startDisposableProvider('mail');
    t.after(mail.stop);
    const mailUrl = `http://127.0.0.1:${mail.ports[8025]}`;
    await eventually(async () =>
      assert.equal((await fetch(`${mailUrl}/api/v1/messages`)).status, 200)
    );
    const sent = await sendTransactionalEmail(
      {
        to: 'recipient@example.test',
        subject: 'OpenG7 local rehearsal',
        text: 'Synthetic contribution receipt',
        html: '<p>Synthetic contribution receipt</p>'
      },
      {
        env: {
          SMTP_ENABLED: 'true',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: String(mail.ports[1025]),
          SMTP_SECURE: 'false',
          SMTP_USER: 'fixture@example.test',
          SMTP_PASSWORD: 'synthetic-fixture',
          MAIL_FROM_ADDRESS: 'sender@example.test',
          MAIL_REPLY_TO_ADDRESS: 'reply@example.test'
        },
        logger: { info() {}, error() {} }
      }
    );
    assert.deepEqual(sent.accepted, ['recipient@example.test']);
    const messages = await eventually(async () => {
      const result = await (await fetch(`${mailUrl}/api/v1/messages`)).json();
      assert.equal(result.messages.length, 1);
      return result.messages;
    });
    const received = await (
      await fetch(`${mailUrl}/api/v1/message/${messages[0].ID}`)
    ).json();
    assert.match(received.Text, /Synthetic contribution receipt/);
    assert.match(received.HTML, /Synthetic contribution receipt/);

    const makeStorage = async () => {
      const server = await startDisposableProvider('s3');
      t.after(server.stop);
      const endpoint = `http://127.0.0.1:${server.ports[9090]}`;
      const credentials = {
        accessKeyId: 'fixture',
        secretAccessKey: 'fixture-secret'
      };
      const client = new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials
      });
      t.after(() => client.destroy());
      await eventually(() =>
        client.send(new CreateBucketCommand({ Bucket: 'private-fixture' }))
      );
      await client.send(new CreateBucketCommand({ Bucket: 'public-fixture' }));
      return createSponsorMediaStorage({
        driver: 'ovh-s3',
        localStorageDir: '',
        s3: {
          region: 'us-east-1',
          endpoint,
          privateBucket: 'private-fixture',
          publicBucket: 'public-fixture',
          privateBaseUrl: `${endpoint}/private-fixture`,
          publicBaseUrl: `${endpoint}/public-fixture`,
          ...credentials
        }
      });
    };
    const source = await makeStorage(),
      target = await makeStorage();
    const privateKey = 'media/fixture/private.webp',
      publicKey = 'media/fixture/public.webp';
    const media = Buffer.from('Synthetic media bytes for restoration');
    await source.writePrivateObject({
      key: privateKey,
      data: media,
      contentType: 'image/webp'
    });
    assert.equal(await source.readPublicObject(publicKey), null);
    await source.publishObject({
      privateKey,
      publicKey,
      contentType: 'image/webp'
    });
    assert.deepEqual(await source.readPublicObject(publicKey), media);
    await assert.rejects(
      source.writePrivateObject({
        key: privateKey,
        data: media,
        contentType: 'image/webp'
      }),
      /already exists/
    );
    const sourceDb = await startDisposablePostgres();
    t.after(sourceDb.stop);
    const targetDb = await startDisposablePostgres({ migrate: false });
    t.after(targetDb.stop);
    await sourceDb.pool
      .query(`INSERT INTO fund_contributions (contribution_type,amount_cents,currency,status,public_display_consent)
    VALUES ('personal_support',12345,'cad','paid',false)`);
    const directory = await mkdtemp(join(tmpdir(), 'og7-provider-backup-'));
    t.after(async () => {
      const path = resolve(directory),
        temp = resolve(tmpdir());
      if (
        !path.startsWith(temp + sep) ||
        !path.split(sep).pop().startsWith('og7-provider-backup-')
      )
        throw new Error('Unsafe fixture cleanup path');
      await rm(path, { recursive: true, force: true });
    });
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const snapshot = {
      version: 1,
      configuration: { project: 'fixture-only', currency: 'CAD' },
      media: {
        privateKey,
        publicKey,
        contentType: 'image/webp',
        data: (await source.readPrivateObject(privateKey)).toString('base64'),
        sha256: digest(media)
      }
    };
    await writeFile(join(directory, 'snapshot.json'), JSON.stringify(snapshot));
    await writeFile(
      join(directory, 'database.sql'),
      await sourceDb.dumpDatabase()
    );
    const restored = JSON.parse(
      await readFile(join(directory, 'snapshot.json'), 'utf8')
    );
    const bytes = Buffer.from(restored.media.data, 'base64');
    assert.equal(digest(bytes), restored.media.sha256);
    await targetDb.restoreDatabase(
      await readFile(join(directory, 'database.sql'), 'utf8')
    );
    await target.writePrivateObject({
      key: restored.media.privateKey,
      data: bytes,
      contentType: restored.media.contentType
    });
    await target.publishObject(restored.media);
    assert.deepEqual(await target.readPrivateObject(privateKey), media);
    assert.deepEqual(await target.readPublicObject(publicKey), media);
    assert.deepEqual(restored.configuration, snapshot.configuration);
    assert.deepEqual(
      (
        await targetDb.pool.query(
          'SELECT amount_cents,currency,public_display_consent FROM fund_contributions'
        )
      ).rows,
      [{ amount_cents: 12345, currency: 'cad', public_display_consent: false }]
    );
    await target.deletePublicObject(publicKey);
    assert.equal(await target.readPublicObject(publicKey), null);
    assert.deepEqual(await source.readPublicObject(publicKey), media);
  }
);
