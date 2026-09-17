import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { getAdminAssistantContext } from '../../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { prepareAdminAssistantDraft } from '../../dist/apps/funding-api/src/admin-assistant/preparation.service.js';
import { requestSponsorshipInformation } from '../../dist/apps/funding-api/src/sponsorship-information.service.js';
import { runAdminAssistantQuery } from '../../dist/apps/funding-api/src/admin-assistant/orchestrator.js';
import { loadAdminAssistantConfig } from '../../dist/apps/funding-api/src/admin-assistant/config.js';

// Fresh, disposable database only. No .env, email worker, model network or Stripe.
test(
  'exact context, preparation and atomic confirmed email requests against PostgreSQL',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      assert.equal(
        (
          await pool.query(
            "SELECT to_regclass('public.fund_contributions') AS name"
          )
        ).rows[0].name,
        null
      );
      for (const file of (await readdir('apps/funding-api/migrations'))
        .filter((file) => file.endsWith('.sql'))
        .sort())
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      assert.equal((await getAdminAssistantContext(pool)).status, 'empty');
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, stripe_session_id)
      SELECT 'sponsorship_interest', 50000, 'cad', 'paid', NOW(), 'cs_test_context_' || n FROM generate_series(1,2005) n`);
      const id = (
        await pool.query(
          "INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, updated_at, sponsor_contact_email, sponsor_company_name, stripe_session_id) VALUES ('sponsorship_interest', 50000, 'cad', 'paid', NOW(), '2020-01-01', 'demo@example.invalid', 'Private fixture company', 'cs_test_context_target') RETURNING id"
        )
      ).rows[0].id;
      const context = await getAdminAssistantContext(pool, id);
      assert.equal(
        (await getAdminAssistantContext(pool, id.toUpperCase())).context
          .contributionId,
        id
      );
      assert.equal(
        context.context.contributionId,
        id,
        'exact record beyond 2000 newer records'
      );
      assert.equal(context.context.nextStep, 'complete_information');
      assert.doesNotMatch(
        JSON.stringify(context),
        /demo@example|Private fixture/
      );
      assert.equal(
        (
          await getAdminAssistantContext(
            pool,
            '10000000-0000-4000-8000-000000000999'
          )
        ).status,
        'not_found'
      );
      const proposal = await prepareAdminAssistantDraft(pool, {
        type: 'sponsorship_reminder',
        reference: id,
        language: 'en'
      });
      assert.equal(proposal.status, 'ok');
      assert.equal(proposal.delivery.recipient, 'demo@example.invalid');
      assert.equal(proposal.draft.sent, false);
      assert.match(proposal.delivery.subject, /Complete your sponsorship/);
      const config = loadAdminAssistantConfig({
        ADMIN_AI_ASSISTANT_ENABLED: 'true',
        ADMIN_AI_PROVIDER: 'mock'
      });
      const reply = await runAdminAssistantQuery({
        pool,
        message: 'Resume',
        sponsorshipId: id,
        config
      });
      assert.equal(reply.status, 'ok');
      assert.ok(reply.answer.some((block) => block.kind === 'facts'));
      assert.doesNotMatch(
        JSON.stringify(reply),
        /demo@example|Private fixture/
      );
      const finance = await runAdminAssistantQuery({
        pool,
        message: 'Montant brut net',
        sponsorshipId: id,
        config
      });
      assert.equal(
        finance.status,
        'no_results',
        'global financial totals are unavailable in dossier scope'
      );
      const missing = await runAdminAssistantQuery({
        pool,
        message: 'Resume',
        sponsorshipId: '10000000-0000-4000-8000-000000000999',
        config
      });
      assert.equal(missing.status, 'no_results');
      const count = async (table) =>
        (await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`))
          .rows[0].count;
      assert.equal(await count('email_messages'), 0);
      assert.equal(await count('admin_audit_log'), 0);
      const input = {
        ...proposal.delivery,
        body: '<script>demo</script>\nPlease complete your profile.',
        confirmed: true
      };
      await assert.rejects(
        requestSponsorshipInformation(
          pool,
          { ...input, confirmed: false },
          'test'
        ),
        (error) => error.status === 400
      );
      await assert.rejects(
        requestSponsorshipInformation(
          pool,
          { ...input, recipient: 'changed@example.invalid' },
          'test'
        ),
        (error) => error.status === 409
      );
      const results = await Promise.all([
        requestSponsorshipInformation(pool, input, 'test'),
        requestSponsorshipInformation(pool, input, 'test')
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [
        'already_queued',
        'queued'
      ]);
      assert.equal(results[0].messageId, results[1].messageId);
      assert.equal(
        (
          await requestSponsorshipInformation(
            pool,
            { ...input, contributionId: id.toUpperCase() },
            'test'
          )
        ).messageId,
        results[0].messageId
      );
      assert.equal(await count('email_messages'), 1);
      assert.equal(await count('admin_audit_log'), 1);
      const email = (await pool.query('SELECT * FROM email_messages')).rows[0];
      assert.match(email.html_body, /&lt;script&gt;/);
      assert.doesNotMatch(email.html_body, /<script>/);
      assert.equal(email.status, 'queued');
      assert.equal(email.template_key, 'sponsorship_information_request');
      const audit = (await pool.query('SELECT * FROM admin_audit_log')).rows[0];
      assert.equal(audit.action, 'sponsorship.request_information');
      assert.doesNotMatch(
        JSON.stringify(audit),
        /demo@example|<script>|complete your profile/
      );
      await pool.query(
        'UPDATE fund_contributions SET updated_at = NOW() WHERE id = $1',
        [id]
      );
      await assert.rejects(
        requestSponsorshipInformation(
          pool,
          { ...input, subject: 'Changed subject' },
          'test'
        ),
        (error) => error.status === 409
      );
      assert.equal(
        (await requestSponsorshipInformation(pool, input, 'test')).status,
        'already_queued',
        'retry after context changed resolves the original result'
      );
      await pool.query(
        "UPDATE email_messages SET status = 'sent' WHERE id = $1",
        [email.id]
      );
      assert.equal(
        (await requestSponsorshipInformation(pool, input, 'test')).status,
        'already_sent'
      );
      await pool.query(
        "UPDATE email_messages SET status = 'failed' WHERE id = $1",
        [email.id]
      );
      assert.equal(
        (await requestSponsorshipInformation(pool, input, 'test')).status,
        'delivery_failed'
      );
      const fresh = await prepareAdminAssistantDraft(pool, {
        type: 'sponsorship_reminder',
        reference: id
      });
      await pool.query(
        'ALTER TABLE admin_audit_log RENAME TO audit_disabled_for_test'
      );
      try {
        await assert.rejects(
          requestSponsorshipInformation(
            pool,
            { ...fresh.delivery, subject: 'Audit rollback', confirmed: true },
            'test'
          ),
          (error) => error.status === 503
        );
        assert.equal(
          await count('email_messages'),
          1,
          'no unaudited message survives'
        );
      } finally {
        await pool.query(
          'ALTER TABLE audit_disabled_for_test RENAME TO admin_audit_log'
        );
      }
      await pool.query(
        "UPDATE fund_contributions SET status='pending' WHERE id=$1",
        [id]
      );
      assert.equal(
        (await getAdminAssistantContext(pool, id)).context.nextStep,
        'check_payment'
      );
      assert.equal(
        (
          await prepareAdminAssistantDraft(pool, {
            type: 'sponsorship_reminder',
            reference: id
          })
        ).status,
        'not_applicable'
      );
      await pool.query(
        "UPDATE fund_contributions SET status='paid', sponsor_review_status='approved', sponsor_details_submitted_at=NOW(), public_display_consent=true WHERE id=$1",
        [id]
      );
      await pool.query(
        `INSERT INTO sponsor_media_assets (contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height)
      VALUES ($1,'supporting_image','approved','test.png','image/png',1,'test/original',1,'test/processed','test/public','https://example.invalid/test.webp',$2,1,1)`,
        [id, 'a'.repeat(64)]
      );
      await pool.query(
        `INSERT INTO sponsor_publication_drafts (contribution_id,feed_target,channel,title,body,disclosure_text,status,updated_at) VALUES ($1,'openg7','facebook','Test','Test','Test','published','2020-01-01'),($1,'openg7','linkedin','Test','Test','Test','scheduled','2020-01-01')`,
        [id]
      );
      await pool.query(
        `INSERT INTO sponsor_publication_drafts (contribution_id,feed_target,channel,title,body,disclosure_text,status) SELECT id,'openg7','facebook','Test','Test','Test','approved' FROM fund_contributions WHERE id<>$1 LIMIT 110`,
        [id]
      );
      const publications = (await getAdminAssistantContext(pool, id)).context;
      assert.deepEqual(publications.coveredChannels.sort(), [
        'facebook',
        'linkedin'
      ]);
      assert.equal(publications.nextStep, 'monitor_publication');
      await pool.query(
        "UPDATE fund_contributions SET sponsor_review_status='rejected' WHERE id=$1",
        [id]
      );
      assert.equal(
        (await getAdminAssistantContext(pool, id)).context.nextStep,
        'review_rejection'
      );
      assert.equal(await count('email_messages'), 1);
    } finally {
      await stop();
    }
  }
);
