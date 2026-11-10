import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { prepareAdminAssistantDraft } from '../../dist/apps/funding-api/src/admin-assistant/preparation.service.js';
import { loadSponsorshipAssistantDataset } from '../../dist/apps/funding-api/src/admin-assistant/context.repository.js';
import { requestSponsorshipInformation } from '../../dist/apps/funding-api/src/sponsorship-information.service.js';
import { readSponsorshipInformationRequestReceipt } from '../../dist/apps/funding-api/src/sponsorship-information-receipts.repository.js';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'consent requests use confirmed, versioned, audited email delivery without recording consent',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(() => database.stop());
    const { pool } = database;
    const actor = 'admin:synthetic-consent-request';
    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions
    (contribution_type,amount_cents,currency,status,paid_at,sponsor_contact_email,
      sponsor_company_name,stripe_session_id,public_display_consent)
    VALUES ('sponsorship_interest',50000,'cad','paid',NOW(),'synthetic@example.test',
      'Synthetic consent request','cs_test_consent_request',false) RETURNING id`)
    ).rows[0].id;
    const prepare = (language = 'fr-CA') =>
      prepareAdminAssistantDraft(pool, {
        type: 'sponsorship_consent_request',
        reference: contributionId,
        language
      });
    const counts = async () =>
      (
        await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM email_messages) AS messages,
    (SELECT COUNT(*)::int FROM admin_audit_log) AS audits,
    (SELECT COUNT(*)::int FROM sponsorship_information_request_receipts) AS receipts,
    (SELECT COUNT(*)::int FROM admin_sponsorship_consent_records) AS agreements`)
      ).rows[0];
    const french = await prepare();
    const english = await prepare('en');
    for (const proposal of [french, english]) {
      assert.equal(proposal.status, 'ok');
      assert.equal(proposal.delivery.purpose, 'public_consent');
      assert.equal(proposal.delivery.recipient, 'synthetic@example.test');
      assert.equal(proposal.draft.sent, false);
      assert.equal(proposal.draft.persisted, false);
      assert.equal(proposal.draft.published, false);
      assert.doesNotMatch(
        proposal.delivery.body,
        /https?:\/\/|tracking link|lien de suivi/
      );
    }
    assert.match(french.delivery.body, /répondre à ce courriel.*explicitement/);
    assert.match(
      english.delivery.body,
      /reply to this email.*explicit agreement/
    );
    assert.deepEqual(await counts(), {
      messages: 0,
      audits: 0,
      receipts: 0,
      agreements: 0
    });

    // Identical text under the legacy purpose keeps its historical hash/key;
    // an explicit consent request remains a separate logical communication.
    const { purpose, ...legacyPreview } = english.delivery;
    const legacy = {
      ...legacyPreview,
      requestId: randomUUID(),
      confirmed: true
    };
    const old = await requestSponsorshipInformation(pool, legacy, actor);
    const legacyKey =
      'sponsorship-information:' +
      createHash('sha256')
        .update(
          JSON.stringify([
            legacy.contributionId,
            legacy.recipient,
            legacy.subject,
            legacy.body
          ])
        )
        .digest('hex');
    assert.equal(
      (
        await pool.query(
          'SELECT idempotency_key FROM email_messages WHERE id=$1',
          [old.messageId]
        )
      ).rows[0].idempotency_key,
      legacyKey
    );
    const input = {
      ...english.delivery,
      requestId: randomUUID(),
      confirmed: true
    };
    const [first, duplicate] = await Promise.all([
      requestSponsorshipInformation(pool, input, actor),
      requestSponsorshipInformation(pool, input, actor)
    ]);
    assert.equal(first.messageId, duplicate.messageId);
    assert.notEqual(first.messageId, old.messageId);
    assert.deepEqual([first.status, duplicate.status].sort(), [
      'already_queued',
      'queued'
    ]);
    await assert.rejects(
      requestSponsorshipInformation(
        pool,
        { ...input, purpose: undefined },
        actor
      ),
      { code: 'INFORMATION_REQUEST_ID_CONFLICT' }
    );
    await assert.rejects(
      requestSponsorshipInformation(pool, input, 'admin:other-synthetic-actor'),
      { code: 'INFORMATION_REQUEST_ID_CONFLICT' }
    );
    const audit = (
      await pool.query(
        "SELECT metadata FROM admin_audit_log WHERE metadata->>'messageId'=$1",
        [first.messageId]
      )
    ).rows[0].metadata;
    assert.deepEqual(audit, {
      requestId: input.requestId,
      messageId: first.messageId,
      purpose: 'public_consent'
    });
    assert.deepEqual(await counts(), {
      messages: 2,
      audits: 2,
      receipts: 2,
      agreements: 0
    });

    // A complete fiche remains eligible specifically for missing public consent.
    await pool.query(
      'UPDATE fund_contributions SET sponsor_details_submitted_at=NOW() WHERE id=$1',
      [contributionId]
    );
    await pool.query(
      `INSERT INTO sponsor_media_assets
    (contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,
      original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height)
    VALUES ($1,'supporting_image','approved','synthetic.png','image/png',1,'synthetic/original',1,
      'synthetic/processed','synthetic/public','https://example.test/synthetic.webp',$2,1,1)`,
      [contributionId, 'a'.repeat(64)]
    );
    assert.equal(
      (
        await prepareAdminAssistantDraft(pool, {
          type: 'sponsorship_reminder',
          reference: contributionId
        })
      ).status,
      'not_applicable'
    );
    const complete = await prepare();
    assert.equal(complete.status, 'ok');
    const confirmed = {
      ...complete.delivery,
      requestId: randomUUID(),
      confirmed: true
    };
    await assert.rejects(
      requestSponsorshipInformation(
        pool,
        { ...confirmed, contextVersion: english.delivery.contextVersion },
        actor
      ),
      { status: 409 }
    );
    await assert.rejects(
      requestSponsorshipInformation(
        pool,
        { ...confirmed, purpose: undefined },
        actor
      ),
      { status: 409 }
    );
    await assert.rejects(
      requestSponsorshipInformation(
        pool,
        { ...confirmed, recipient: 'changed@example.test' },
        actor
      ),
      { status: 409 }
    );
    const before = (
      await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
        contributionId
      ])
    ).rows[0];
    const result = await requestSponsorshipInformation(pool, confirmed, actor);
    assert.equal(result.status, 'queued');
    assert.equal(result.deliveryStatus, 'queued');
    assert.equal(result.sentAt, null);
    assert.deepEqual(
      (
        await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
          contributionId
        ])
      ).rows[0],
      before
    );
    assert.deepEqual(await counts(), {
      messages: 3,
      audits: 3,
      receipts: 3,
      agreements: 0
    });
    const receipt = await readSponsorshipInformationRequestReceipt(
      pool,
      confirmed,
      actor
    );
    assert.equal(receipt.found, true);
    assert.equal(receipt.messageId, result.messageId);
    assert.equal(
      (
        await readSponsorshipInformationRequestReceipt(
          pool,
          confirmed,
          'admin:other-synthetic-actor'
        )
      ).found,
      false
    );

    // Re-read server eligibility independently of browser affordances and versions.
    for (const update of [
      'public_display_consent=true',
      "public_display_consent=false,status='pending'",
      "status='paid',sponsor_review_status='rejected'",
      "sponsor_review_status='pending_review',sponsorship_refund_status='requested'",
      "sponsorship_refund_status='not_requested',sponsor_contact_email=NULL"
    ]) {
      await pool.query(`UPDATE fund_contributions SET ${update} WHERE id=$1`, [
        contributionId
      ]);
      assert.equal((await prepare()).status, 'not_applicable');
      const source = await loadSponsorshipAssistantDataset(
        pool,
        contributionId
      );
      await assert.rejects(
        requestSponsorshipInformation(
          pool,
          {
            ...confirmed,
            requestId: randomUUID(),
            contextVersion: source.version
          },
          actor
        ),
        { status: 409 }
      );
    }
    assert.equal(
      (await requestSponsorshipInformation(pool, confirmed, actor)).messageId,
      result.messageId,
      'exact receipt replay precedes later eligibility changes without sending again'
    );
    assert.deepEqual(await counts(), {
      messages: 3,
      audits: 3,
      receipts: 3,
      agreements: 0
    });
  }
);
