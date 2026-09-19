import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getSponsorshipDraft,
  saveSponsorshipDraft,
  submitSponsorshipDraft,
  issueSponsorshipAccess,
  recoverSponsorshipAccess,
  getSponsorshipAccessRecipient
} from '../../dist/apps/funding-api/src/sponsorship-access.service.js';
import { getSponsorshipFollowupByTokenHash } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = 'fixture-followup-access-local-only-0000000000';
const options = {
  baseUrl: 'https://example.invalid',
  ttlDays: 30,
  locale: 'fr-CA'
};
const values = {
  companyName: 'Draft company',
  contactName: '',
  contactEmail: 'unfinished@',
  websiteUrl: '',
  logoUrl: '',
  message: 'Private unfinished draft'
};

test(
  'access recovery and private drafts preserve payment/review, serialize changes and roll back failed email enqueue',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      const migrations = (await readdir('apps/funding-api/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of migrations.filter((f) => !f.startsWith('019_')))
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions
      (contribution_type, amount_cents, currency, status, email_private, sponsor_contact_email, sponsor_company_name,
       sponsor_review_status, sponsor_feed_status, sponsorship_followup_token_hash, sponsorship_followup_token_created_at)
      VALUES ('sponsorship_interest', 50000, 'cad', 'paid', 'payer@example.invalid', 'unverified@example.invalid',
      'Published company', 'approved', 'published', $1, NOW()) RETURNING id`,
          [hash(token)]
        )
      ).rows[0].id;
      await pool.query(
        await readFile(
          'apps/funding-api/migrations/019_create_sponsorship_access_and_drafts.sql',
          'utf8'
        )
      );
      const facts = () =>
        pool
          .query(
            'SELECT status, sponsor_review_status, sponsor_feed_status, sponsor_company_name, updated_at FROM fund_contributions WHERE id=$1',
            [id]
          )
          .then((r) => r.rows[0]);
      const before = await facts();
      assert.equal((await getSponsorshipDraft(pool, token, 30)).revision, 0);
      const [a, b] = await Promise.all([
        saveSponsorshipDraft(pool, token, 30, 0, values),
        saveSponsorshipDraft(pool, token, 30, 0, values)
      ]);
      assert.equal(a.revision, 1);
      assert.equal(b.revision, 1);
      assert.deepEqual(
        await facts(),
        before,
        'autosave must not touch the published profile or review'
      );
      await assert.rejects(
        saveSponsorshipDraft(pool, token, 30, 0, {
          ...values,
          message: 'stale tab'
        }),
        (e) => e.code === 'draft_conflict'
      );
      assert.equal(
        (await getSponsorshipDraft(pool, token, 30)).data.contactEmail,
        'unfinished@'
      );
      await assert.rejects(
        getSponsorshipDraft(
          pool,
          'unknown-token-for-local-fixture-00000000',
          30
        ),
        (e) => e.status === 404
      );
      const submitted = {
        ...values,
        contactName: 'Sponsor',
        contactEmail: 'sponsor@example.invalid'
      };
      await submitSponsorshipDraft(pool, token, 30, 1, submitted);
      assert.equal((await facts()).sponsor_review_status, 'pending_review');
      assert.equal((await facts()).status, 'paid');
      assert.equal((await getSponsorshipDraft(pool, token, 30)).data, null);
      const afterSubmit = await getSponsorshipDraft(pool, token, 30);
      await assert.rejects(
        saveSponsorshipDraft(pool, token, 30, 1, values),
        (e) => e.code === 'draft_conflict'
      );
      await saveSponsorshipDraft(pool, token, 30, afterSubmit.revision, values);
      const latest = await getSponsorshipDraft(pool, token, 30);
      await submitSponsorshipDraft(pool, token, 30, 1, submitted);
      assert.deepEqual(
        await getSponsorshipDraft(pool, token, 30),
        latest,
        'repeated submission cannot delete a newer draft'
      );
      const discarded = await saveSponsorshipDraft(
        pool,
        token,
        30,
        latest.revision,
        null
      );
      assert.equal(discarded.data, null);
      await assert.rejects(
        saveSponsorshipDraft(pool, token, 30, latest.revision, values),
        (e) => e.code === 'draft_conflict'
      );
      await saveSponsorshipDraft(pool, token, 30, discarded.revision, values);

      assert.equal(
        await getSponsorshipAccessRecipient(pool, id),
        'payer@example.invalid'
      );
      await recoverSponsorshipAccess(
        pool,
        'unverified@example.invalid',
        options
      );
      assert.equal(
        (await pool.query('SELECT count(*)::int AS n FROM email_messages'))
          .rows[0].n,
        0
      );
      const admin = { actor: 'fixture-admin', requestId: randomUUID() };
      const results = await Promise.all([
        issueSponsorshipAccess(
          pool,
          id,
          'payer@example.invalid',
          options,
          admin
        ),
        issueSponsorshipAccess(
          pool,
          id,
          'payer@example.invalid',
          options,
          admin
        )
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [
        'already_queued',
        'queued'
      ]);
      const messages = await pool.query('SELECT * FROM email_messages');
      assert.equal(messages.rows.length, 1);
      const message = messages.rows[0];
      assert.equal(message.status, 'queued');
      assert.equal(message.attempts, 0);
      assert.equal(message.recipient_email, 'payer@example.invalid');
      const url = new URL(
        message.text_body
          .split('\n')
          .find((line) => line.startsWith('https://'))
      );
      const newToken = url.searchParams.get('token');
      assert.ok(newToken);
      assert.equal(JSON.stringify(message.metadata).includes(newToken), false);
      assert.equal(
        (await getSponsorshipDraft(pool, newToken, 30)).data.message,
        values.message
      );
      await pool.query(
        "UPDATE fund_contributions SET sponsorship_followup_token_created_at=NOW()-INTERVAL '31 days' WHERE id=$1",
        [id]
      );
      await assert.rejects(
        getSponsorshipDraft(pool, token, 30),
        (e) => e.status === 404
      );
      assert.ok(
        await getSponsorshipFollowupByTokenHash(
          pool,
          hash(newToken),
          new Date(Date.now() - 30 * 86400000).toISOString()
        )
      );
      assert.equal(
        (await getSponsorshipDraft(pool, newToken, 30)).data.message,
        values.message
      );
      await recoverSponsorshipAccess(pool, 'payer@example.invalid', options);
      assert.equal(
        (await pool.query('SELECT count(*)::int AS n FROM email_messages'))
          .rows[0].n,
        1
      );
      const audit = await pool.query(
        "SELECT metadata FROM admin_audit_log WHERE action='sponsorship.access_link_requested'"
      );
      assert.equal(audit.rows.length, 1);
      assert.equal(JSON.stringify(audit.rows).includes(newToken), false);
      await pool.query(
        "UPDATE sponsorship_access_tokens SET created_at=NOW()-INTERVAL '2 minutes' WHERE contribution_id=$1",
        [id]
      );
      await pool.query(`CREATE FUNCTION reject_access_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture enqueue failure'; END $$;
      CREATE TRIGGER reject_access_email BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION reject_access_email()`);
      await assert.rejects(
        issueSponsorshipAccess(pool, id, 'payer@example.invalid', options, {
          actor: 'fixture-admin',
          requestId: randomUUID()
        })
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM sponsorship_access_tokens'
          )
        ).rows[0].n,
        1
      );
      assert.equal(
        (await getSponsorshipDraft(pool, newToken, 30)).data.message,
        values.message
      );
      await pool.query(
        "UPDATE email_messages SET status='sent', sent_at=NOW() WHERE id=$1",
        [message.id]
      );
      await pool.query('DROP TRIGGER reject_access_email ON email_messages');
      assert.equal(
        (
          await issueSponsorshipAccess(
            pool,
            id,
            'payer@example.invalid',
            { ...options, locale: 'en' },
            {
              actor: 'fixture-admin',
              requestId: randomUUID()
            }
          )
        ).status,
        'queued',
        'an already sent email can be replaced by a new private link'
      );
      const resent = (
        await pool.query('SELECT * FROM email_messages WHERE id <> $1', [
          message.id
        ])
      ).rows;
      assert.equal(resent.length, 1);
      const resentUrl = new URL(
        resent[0].text_body
          .split('\n')
          .find((line) => line.startsWith('https://'))
      );
      assert.equal(
        resentUrl.pathname,
        '/en/fonds-des-batisseurs/suivi-commandite'
      );
      const resentToken = resentUrl.searchParams.get('token');
      assert.notEqual(resentToken, newToken);
      assert.deepEqual(
        await getSponsorshipDraft(pool, resentToken, 30),
        await getSponsorshipDraft(pool, newToken, 30)
      );
      assert.equal(
        (
          await issueSponsorshipAccess(
            pool,
            id,
            'payer@example.invalid',
            options,
            admin
          )
        ).status,
        'already_sent'
      );
      await pool.query(
        "UPDATE email_messages SET status='failed' WHERE id=$1",
        [resent[0].id]
      );
      assert.equal(
        (
          await issueSponsorshipAccess(
            pool,
            id,
            'payer@example.invalid',
            options,
            {
              actor: 'fixture-admin',
              requestId: randomUUID()
            }
          )
        ).status,
        'delivery_failed'
      );
      await pool.query(
        "UPDATE fund_contributions SET sponsor_review_status='rejected' WHERE id=$1",
        [id]
      );
      await assert.rejects(
        saveSponsorshipDraft(
          pool,
          resentToken,
          30,
          (await getSponsorshipDraft(pool, resentToken, 30)).revision,
          values
        ),
        (e) => e.code === 'not_editable'
      );
      await pool.query(
        "UPDATE sponsorship_access_tokens SET created_at=NOW()-INTERVAL '2 days', expires_at=NOW()-INTERVAL '1 day'"
      );
      await assert.rejects(
        getSponsorshipDraft(pool, newToken, 30),
        (e) => e.status === 404
      );
      assert.equal(
        await getSponsorshipFollowupByTokenHash(
          pool,
          hash(newToken),
          new Date(Date.now() - 30 * 86400000).toISOString()
        ),
        null
      );
      await recoverSponsorshipAccess(pool, 'payer@example.invalid', options);
      await recoverSponsorshipAccess(pool, 'payer@example.invalid', options);
      const publicMessage = (
        await pool.query(
          "SELECT * FROM email_messages WHERE idempotency_key LIKE 'sponsorship-access:public:%'"
        )
      ).rows;
      assert.equal(
        publicMessage.length,
        1,
        'public recovery creates one fresh link after cooldown'
      );
      const publicUrl = new URL(
        publicMessage[0].text_body
          .split('\n')
          .find((line) => line.startsWith('https://'))
      );
      assert.equal(
        (
          await getSponsorshipDraft(
            pool,
            publicUrl.searchParams.get('token'),
            30
          )
        ).data.message,
        values.message
      );
    } finally {
      await stop();
    }
  }
);
