import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';

import { prepareAdminAssistantDraft } from '../../dist/apps/funding-api/src/admin-assistant/preparation.service.js';
import { requestSponsorshipInformation } from '../../dist/apps/funding-api/src/sponsorship-information.service.js';
import { readSponsorshipInformationRequestReceipt } from '../../dist/apps/funding-api/src/sponsorship-information-receipts.repository.js';
import { getSponsorshipDraft } from '../../dist/apps/funding-api/src/sponsorship-access.service.js';
import { createSponsorMediaAsset } from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const actor = 'admin:synthetic-media-consent-operator';
const options = { baseUrl: 'https://example.invalid', ttlDays: 30 };

test(
  'one confirmed photo consent request queues one private dossier link without granting consent in disposable PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    const pool = database.pool;
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('External requests are forbidden in this test.');
    });
    const role = 'og7_media_consent_runtime';
    const password = randomBytes(32).toString('hex');
    const databaseName = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    await pool.query(
      buildRuntimeRoleSql(
        { role, database: databaseName, password },
        { create: true }
      )
    );
    runtime = new pg.Pool({ ...pool.options, user: role, password });

    async function dossier(email = 'payer@example.test') {
      return (
        await pool.query(
          `INSERT INTO fund_contributions
          (contribution_type,amount_cents,currency,status,paid_at,
           email_private,sponsor_contact_email,sponsor_company_name,
           public_display_consent,stripe_session_id)
          VALUES ('sponsorship_interest',50000,'cad','paid',NOW(),$1,
            'different-contact@example.test','Synthetic photo consent',true,$2)
          RETURNING id`,
          [email, 'cs_test_media_consent_' + randomUUID()]
        )
      ).rows[0].id;
    }
    async function photo(contributionId, kind = 'supporting_image') {
      const result = await createSponsorMediaAsset(pool, {
        id: randomUUID(),
        requestId: randomUUID(),
        requestFingerprint: randomBytes(32).toString('hex'),
        contributionId,
        kind,
        uploadedBy: 'admin',
        auditActor: actor,
        storageDriver: 'local',
        originalFilename: 'synthetic-photo-' + randomUUID() + '.png',
        originalMimeType: 'image/png',
        originalSizeBytes: 100,
        originalStorageKey: randomUUID() + '/original.png',
        processedSizeBytes: 80,
        processedStorageKey: randomUUID() + '/processed.webp',
        originalChecksumSha256: 'a'.repeat(64),
        checksumSha256: 'b'.repeat(64),
        width: 32,
        height: 32,
        altText: 'Synthetic private scene',
        maxSupportingImages: 10
      });
      assert.equal(result.status, 'created');
      return result.asset;
    }
    async function prepare(contributionId, language = 'fr-CA') {
      return prepareAdminAssistantDraft(runtime, {
        type: 'sponsorship_media_consent_request',
        reference: contributionId,
        language
      });
    }
    async function effects() {
      return (
        await pool.query(`SELECT
          (SELECT count(*)::int FROM email_messages) AS messages,
          (SELECT count(*)::int FROM sponsorship_access_tokens) AS tokens,
          (SELECT count(*)::int FROM sponsorship_information_request_receipts) AS receipts,
          (SELECT count(*)::int FROM admin_audit_log WHERE action='sponsorship.request_information') AS requests,
          (SELECT count(*)::int FROM sponsor_media_terms_acceptances) AS acceptances`)
      ).rows[0];
    }
    const contributionId = await dossier();
    const photos = [await photo(contributionId), await photo(contributionId)];
    await photo(contributionId, 'logo');
    const foreignId = await dossier('foreign@example.test');
    const foreignPhoto = await photo(foreignId);
    const before = await effects();
    const mediaFacts = async () =>
      (await pool.query('SELECT * FROM sponsor_media_assets ORDER BY id')).rows;
    const originalFacts = await mediaFacts();

    const preview = await prepare(contributionId);
    assert.equal(preview.status, 'ok');
    assert.equal(preview.delivery.purpose, 'media_consent');
    assert.equal(preview.delivery.recipient, 'payer@example.test');
    assert.equal(preview.delivery.language, 'fr-CA');
    for (const asset of photos)
      assert.ok(preview.draft.fields[1].value.includes(asset.originalFilename));
    assert.deepEqual(
      preview.delivery.mediaSnapshot,
      photos
        .map(({ id, version }) => ({ id, version }))
        .sort((a, b) => a.id.localeCompare(b.id))
    );
    assert.doesNotMatch(
      preview.delivery.body,
      /\{\{sponsorship_media_consent_link\}\}/
    );
    assert.doesNotMatch(JSON.stringify(preview), /[?&]token=/);
    assert.deepEqual(
      await effects(),
      before,
      'preparing never contacts the sponsor'
    );
    const input = {
      ...preview.delivery,
      subject: preview.delivery.subject + ' (reviewed)',
      body:
        preview.delivery.body +
        '\n\nSynthetic note reviewed by the administrator.',
      requestId: randomUUID(),
      confirmed: true
    };
    const results = await Promise.all([
      requestSponsorshipInformation(runtime, input, actor, options),
      requestSponsorshipInformation(runtime, input, actor, options)
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [
      'already_queued',
      'queued'
    ]);
    assert.equal(results[0].messageId, results[1].messageId);
    assert.equal(results[0].acceptedAt, results[1].acceptedAt);
    assert.deepEqual(await effects(), {
      messages: before.messages + 1,
      tokens: before.tokens + 1,
      receipts: before.receipts + 1,
      requests: before.requests + 1,
      acceptances: before.acceptances
    });
    assert.deepEqual(
      await mediaFacts(),
      originalFacts,
      'requesting does not modify rights or review'
    );
    const message = (
      await pool.query('SELECT * FROM email_messages WHERE id=$1', [
        results[0].messageId
      ])
    ).rows[0];
    assert.equal(message.recipient_email, 'payer@example.test');
    assert.equal(message.template_key, 'sponsorship_information_request');
    assert.equal(message.status, 'queued');
    assert.ok(message.text_body.startsWith(input.body + '\n\n'));
    assert.doesNotMatch(
      message.text_body,
      /\{\{sponsorship_media_consent_link\}\}/
    );
    const urls =
      message.text_body.match(/https:\/\/example\.invalid\/[^\s<>]+/g) ?? [];
    assert.equal(urls.length, 1, 'one link covers every pending photo');
    const link = new URL(urls[0]);
    assert.equal(link.pathname, '/fonds-des-batisseurs/suivi-commandite');
    assert.equal(link.searchParams.get('section'), 'media-consent');
    assert.equal(link.searchParams.has('mediaId'), false);
    const token = link.searchParams.get('token');
    assert.match(token, /^[A-Za-z0-9_-]{32,128}$/);
    const tokenRecord = (
      await pool.query(
        'SELECT * FROM sponsorship_access_tokens WHERE email_message_id=$1',
        [message.id]
      )
    ).rows[0];
    assert.equal(tokenRecord.contribution_id, contributionId);
    assert.equal(
      tokenRecord.token_hash,
      createHash('sha256').update(token).digest('hex')
    );
    assert.equal((await getSponsorshipDraft(runtime, token, 30)).revision, 0);
    const receipt = await readSponsorshipInformationRequestReceipt(
      runtime,
      input,
      actor
    );
    assert.equal(receipt.found, true);
    const audits = (
      await pool.query(
        "SELECT * FROM admin_audit_log WHERE action='sponsorship.request_information'"
      )
    ).rows;
    assert.equal(
      JSON.stringify({ preview, results, receipt, audits }).includes(token),
      false
    );
    assert.deepEqual(
      await readSponsorshipInformationRequestReceipt(
        runtime,
        input,
        'admin:another-operator'
      ),
      { requestId: input.requestId, contributionId, found: false }
    );

    await t.test(
      'a second confirmed UUID reuses the same email and link',
      async () => {
        const prior = await effects();
        const result = await requestSponsorshipInformation(
          runtime,
          { ...input, requestId: randomUUID() },
          actor,
          options
        );
        assert.equal(result.status, 'already_queued');
        assert.equal(result.messageId, message.id);
        assert.deepEqual(await effects(), {
          ...prior,
          receipts: prior.receipts + 1
        });
      }
    );
    await t.test(
      'an expired link renews once for new confirmations while an old UUID retains its receipt',
      async () => {
        await pool.query(
          "UPDATE sponsorship_access_tokens SET created_at=clock_timestamp()-INTERVAL '2 days', expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE email_message_id=$1",
          [message.id]
        );
        const prior = await effects();
        const renewed = await Promise.all([
          requestSponsorshipInformation(
            runtime,
            { ...input, requestId: randomUUID() },
            actor,
            options
          ),
          requestSponsorshipInformation(
            runtime,
            { ...input, requestId: randomUUID() },
            actor,
            options
          )
        ]);
        assert.deepEqual(renewed.map((result) => result.status).sort(), [
          'already_queued',
          'queued'
        ]);
        assert.equal(renewed[0].messageId, renewed[1].messageId);
        assert.notEqual(renewed[0].messageId, message.id);
        assert.deepEqual(await effects(), {
          ...prior,
          messages: prior.messages + 1,
          tokens: prior.tokens + 1,
          receipts: prior.receipts + 2,
          requests: prior.requests + 1
        });
        assert.equal(
          (
            await pool.query(
              'SELECT expires_at>clock_timestamp() AS valid FROM sponsorship_access_tokens WHERE email_message_id=$1',
              [renewed[0].messageId]
            )
          ).rows[0].valid,
          true
        );
        assert.equal(
          (await requestSponsorshipInformation(runtime, input, actor))
            .messageId,
          message.id
        );
        assert.deepEqual(await mediaFacts(), originalFacts);
      }
    );
    await t.test(
      'foreign scope, changed recipients and edited requests fail without writes',
      async () => {
        const prior = await effects();
        for (const patch of [
          { recipient: 'different-contact@example.test' },
          {
            mediaSnapshot: [
              { id: foreignPhoto.id, version: foreignPhoto.version }
            ]
          },
          { mediaSnapshot: [preview.delivery.mediaSnapshot[0]] },
          { contextVersion: '0'.repeat(64) }
        ])
          await assert.rejects(
            requestSponsorshipInformation(
              runtime,
              { ...input, ...patch, requestId: randomUUID() },
              actor,
              options
            ),
            (error) => error.status === 409
          );
        await assert.rejects(
          requestSponsorshipInformation(
            runtime,
            { ...input, subject: 'Changed replay' },
            actor,
            options
          ),
          (error) => error.code === 'INFORMATION_REQUEST_ID_CONFLICT'
        );
        assert.deepEqual(await effects(), prior);
      }
    );
    await t.test(
      'missing link configuration cannot enqueue or mint a token',
      async () => {
        const prior = await effects();
        for (const config of [undefined, { ...options, ttlDays: 0 }])
          await assert.rejects(
            requestSponsorshipInformation(
              runtime,
              {
                ...input,
                body: input.body + '\nSynthetic new request',
                requestId: randomUUID()
              },
              actor,
              config
            ),
            (error) => error.status === 503
          );
        assert.deepEqual(await effects(), prior);
      }
    );
    await t.test(
      'a changed payment address invalidates the prepared scope',
      async () => {
        const prior = await effects();
        await pool.query(
          'UPDATE fund_contributions SET email_private=$2 WHERE id=$1',
          [contributionId, 'new-payer@example.test']
        );
        await assert.rejects(
          requestSponsorshipInformation(
            runtime,
            { ...input, requestId: randomUUID() },
            actor,
            options
          ),
          (error) => error.status === 409
        );
        assert.deepEqual(await effects(), prior);
        // An acknowledged UUID can still be reconciled after its source changes.
        assert.equal(
          (await requestSponsorshipInformation(runtime, input, actor))
            .messageId,
          message.id
        );
      }
    );
    await t.test(
      'missing payment email never falls back to a different contact',
      async () => {
        const id = await dossier(null);
        await photo(id);
        const prior = await effects();
        assert.equal((await prepare(id)).status, 'not_applicable');
        assert.deepEqual(await effects(), prior);
      }
    );
    await t.test(
      'one English link is issued and token insertion failure rolls everything back',
      async () => {
        const id = await dossier('english-payer@example.test');
        await photo(id);
        const prepared = await prepare(id, 'en');
        const request = {
          ...prepared.delivery,
          requestId: randomUUID(),
          confirmed: true
        };
        const prior = await effects();
        await pool.query(`CREATE FUNCTION synthetic_reject_media_token() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic token insertion failure'; END $$;
        CREATE TRIGGER synthetic_reject_media_token BEFORE INSERT ON sponsorship_access_tokens
        FOR EACH ROW EXECUTE FUNCTION synthetic_reject_media_token();`);
        await assert.rejects(
          requestSponsorshipInformation(runtime, request, actor, options)
        );
        assert.deepEqual(await effects(), prior);
        await pool.query(
          'DROP TRIGGER synthetic_reject_media_token ON sponsorship_access_tokens; DROP FUNCTION synthetic_reject_media_token();'
        );
        const result = await requestSponsorshipInformation(
          runtime,
          request,
          actor,
          options
        );
        const queued = (
          await pool.query('SELECT text_body FROM email_messages WHERE id=$1', [
            result.messageId
          ])
        ).rows[0];
        assert.match(
          queued.text_body,
          /https:\/\/example\.invalid\/en\/fonds-des-batisseurs\/suivi-commandite\?/
        );
        assert.equal((await effects()).acceptances, before.acceptances);
      }
    );
  }
);
