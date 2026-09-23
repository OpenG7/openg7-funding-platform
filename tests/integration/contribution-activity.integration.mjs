import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  ContributionActivityService,
  contributionNotificationConfig
} from '../../dist/apps/funding-api/src/contribution-activity.service.js';
import {
  upsertCheckoutSessionFromWebhook,
  updateContributionStatusByPaymentIntent
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';

test(
  'a slow SMS receiver does not block a later preparation pass',
  { timeout: 60000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    let releaseLookup;
    let markLookup;
    const lookupStarted = new Promise((resolve) => {
      markLookup = resolve;
    });
    const lookupGate = new Promise((resolve) => {
      releaseLookup = resolve;
    });
    const server = createServer(async (req, res) => {
      if (req.method === 'GET') {
        markLookup();
        await lookupGate;
        res.writeHead(404);
        res.end('{}');
      } else {
        for await (const _chunk of req) {
          /* consume the simulated request */
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"id":"slow-mock-receipt"}');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      releaseLookup();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const service = new ContributionActivityService(database.pool, {
      email: null,
      smsUrl: `http://127.0.0.1:${server.address().port}/sms`,
      publicBaseUrl: 'http://localhost',
      workerDefault: true
    });
    await upsertCheckoutSessionFromWebhook(database.pool, {
      stripeSessionId: 'cs_test_slow',
      stripePaymentIntentId: 'pi_test_slow',
      publicReference: 'OG7-2026-SLOW',
      contributionType: 'sponsorship_interest',
      amountCents: 5000,
      currency: 'cad',
      metadata: {},
      publicDisplayConsent: true,
      publicName: null,
      displayAmountConsent: false,
      nonCharityAcknowledged: true,
      sponsorshipFollowupTokenHash: null,
      status: 'paid',
      paidAtIso: null,
      emailPrivate: null,
      notifyAdmin: true
    });
    const first = service.tick();
    await lookupStarted;
    await database.pool.query(
      "UPDATE fund_contributions SET sponsor_company_name='Updated during SMS',sponsor_review_status='pending_review',updated_at=NOW() WHERE stripe_session_id='cs_test_slow'"
    );
    await service.tick();
    const item = (await service.list()).items[0];
    assert.equal(item.preparation.cartouche.title, 'Updated during SMS');
    assert.equal(item.sms, 'sending');
    releaseLookup();
    await first;
    assert.equal((await service.list()).items[0].sms, 'captured');
  }
);

test(
  'migration 027 preserves existing payments without historical notifications',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    t.after(database.stop);
    const directory = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith('.sql') && n < '027')
      .sort())
      await database.pool.query(
        await readFile(new URL(name, directory), 'utf8')
      );
    await database.pool.query(
      "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,stripe_session_id) VALUES('sponsorship_interest',5000,'cad','paid','cs_test_historical'),('sponsorship_interest',5000,'cad','pending','cs_test_pending')"
    );
    await database.pool.query(
      await readFile(
        new URL('027_create_contribution_activity.sql', directory),
        'utf8'
      )
    );
    const rows = (
      await database.pool.query(
        'SELECT status,amount_cents,payment_notification_recorded_at FROM fund_contributions ORDER BY status'
      )
    ).rows;
    assert.equal(rows[0].status, 'paid');
    assert.equal(rows[0].amount_cents, 5000);
    assert.ok(rows[0].payment_notification_recorded_at);
    assert.equal(rows[1].status, 'pending');
    assert.equal(rows[1].payment_notification_recorded_at, null);
    assert.equal(
      (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM contribution_activity'
        )
      ).rows[0].n,
      0
    );
  }
);

test(
  'confirmed contributions: atomic events, ordering, notifications and private preparation',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const { pool } = database;
    const receipts = new Map();
    let sends = 0;
    let loseReply = true;
    const server = createServer(async (req, res) => {
      if (req.method === 'GET') {
        const id = decodeURIComponent(req.url.slice('/sms/'.length));
        res.writeHead(receipts.has(id) ? 200 : 404, {
          'content-type': 'application/json'
        });
        res.end(JSON.stringify(receipts.get(id) ?? {}));
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      sends++;
      const receipt = { id: 'mock-receipt-' + receipts.size };
      receipts.set(message.idempotencyKey, receipt);
      if (loseReply) {
        loseReply = false;
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(receipt));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const config = contributionNotificationConfig({
      FUNDING_PLATFORM_ENV: 'development',
      FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'true',
      FUNDING_ADMIN_NOTIFICATION_EMAIL: 'admin@simulation.example.test',
      FUNDING_CONTRIBUTION_SMS_MODE: 'mock',
      FUNDING_CONTRIBUTION_SMS_MOCK_URL: `http://127.0.0.1:${server.address().port}/sms`
    });
    const worker = new ContributionActivityService(pool, config);
    const session = {
      stripeSessionId: 'cs_test_activity',
      stripePaymentIntentId: 'pi_test_activity',
      publicReference: 'OG7-2026-DEMO0050',
      contributionType: 'sponsorship_interest',
      amountCents: 5000,
      currency: 'cad',
      metadata: {},
      publicDisplayConsent: true,
      publicName: null,
      displayAmountConsent: false,
      nonCharityAcknowledged: true,
      sponsorshipFollowupTokenHash: null,
      status: 'pending',
      paidAtIso: null,
      emailPrivate: 'company@simulation.example.test',
      notifyAdmin: true
    };
    await upsertCheckoutSessionFromWebhook(pool, session);
    assert.equal((await worker.list()).items.length, 0);
    await Promise.all([
      upsertCheckoutSessionFromWebhook(pool, {
        ...session,
        status: 'paid',
        paidAtIso: new Date().toISOString()
      }),
      updateContributionStatusByPaymentIntent(pool, {
        stripePaymentIntentId: session.stripePaymentIntentId,
        status: 'paid',
        notifyAdmin: true
      })
    ]);
    await upsertCheckoutSessionFromWebhook(pool, session); // late pending cannot undo confirmation
    await worker.tick();
    let item = (await worker.list()).items[0];
    assert.equal((await worker.list()).items.length, 1);
    assert.equal(item.amountMinor, 5000);
    assert.equal(item.preparation.state, 'waiting_identity');
    assert.equal(item.sms, 'uncertain');
    assert.equal(item.email, 'queued');
    assert.equal(sends, 1);
    await pool.query(
      'UPDATE contribution_sms_deliveries SET next_attempt_at=NOW()'
    );
    await new ContributionActivityService(pool, config).tick();
    item = (await worker.list()).items[0];
    assert.equal(item.sms, 'captured');
    assert.equal(
      sends,
      1,
      'receipt reconciliation never resends a captured SMS'
    );
    assert.equal(
      item.revision,
      1,
      'unchanged snapshots do not create duplicate history'
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM email_messages WHERE template_key='admin_contribution_received'"
        )
      ).rows[0].n,
      1
    );
    const claims = await Promise.all([
      worker.claimPresentation([item.id], 'admin:a'),
      worker.claimPresentation([item.id], 'admin:a')
    ]);
    assert.equal(claims.flatMap((r) => r.ids).length, 1);
    assert.deepEqual(
      (await worker.claimPresentation([item.id], 'admin:b')).ids,
      [item.id]
    );
    await pool.query(
      "UPDATE fund_contributions SET sponsor_company_name='Atelier Démo',sponsor_review_status='pending_review',updated_at=NOW() WHERE id=$1",
      [item.contributionId]
    );
    await worker.tick();
    assert.equal(
      (await worker.list()).items[0].preparation.state,
      'worker_stopped'
    );
    await pool.query('UPDATE publication_worker_settings SET enabled=TRUE');
    await worker.tick();
    item = (await worker.list()).items[0];
    assert.equal(item.preparation.state, 'prepared');
    assert.equal(item.preparation.cartouche.title, 'Atelier Démo');
    assert.ok(item.preparation.reasons.includes('facebook_below_threshold'));
    assert.ok(item.preparation.reasons.includes('review_required'));
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM sponsor_publication_drafts'
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      (
        await pool.query(
          'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1',
          [item.contributionId]
        )
      ).rows[0].sponsor_review_status,
      'pending_review'
    );
    await pool.query(
      'UPDATE fund_contributions SET public_display_consent=FALSE,updated_at=NOW() WHERE id=$1',
      [item.contributionId]
    );
    assert.equal(
      (await worker.list()).items[0].preparation,
      null,
      'stale prepared content is withheld before the next worker pass'
    );
    await worker.tick();
    assert.equal(
      (await worker.list()).items[0].preparation.state,
      'waiting_consent'
    );
    assert.equal((await worker.list()).items[0].preparation.cartouche, null);
    assert.equal((await worker.list()).items[0].history.length, 4);

    // PaymentIntent first, Checkout unpaid later: retained proof confirms the same contribution.
    await updateContributionStatusByPaymentIntent(pool, {
      stripePaymentIntentId: 'pi_test_early',
      status: 'paid',
      notifyAdmin: true
    });
    await upsertCheckoutSessionFromWebhook(pool, {
      ...session,
      stripeSessionId: 'cs_test_early',
      stripePaymentIntentId: 'pi_test_early',
      publicReference: 'OG7-2026-DEMOEARLY'
    });
    assert.equal((await worker.list()).items.length, 2);
    // Historical importer explicitly defaults to silent, including a later webhook replay.
    const historical = {
      ...session,
      stripeSessionId: 'cs_test_old',
      stripePaymentIntentId: 'pi_test_old',
      publicReference: 'OG7-2026-DEMOOLD',
      status: 'paid',
      notifyAdmin: false
    };
    await upsertCheckoutSessionFromWebhook(pool, historical);
    await upsertCheckoutSessionFromWebhook(pool, {
      ...historical,
      notifyAdmin: true
    });
    assert.equal((await worker.list()).items.length, 2);
    await assert.rejects(worker.list({ after: '-1' }), RangeError);
    await assert.rejects(
      worker.claimPresentation(['1 OR 1=1'], 'admin:a'),
      RangeError
    );
    // Event insertion failure rolls the payment mutation back as well.
    await pool.query(`CREATE FUNCTION reject_activity_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$;
    CREATE TRIGGER reject_activity_fixture BEFORE INSERT ON contribution_activity FOR EACH ROW EXECUTE FUNCTION reject_activity_fixture()`);
    await assert.rejects(
      upsertCheckoutSessionFromWebhook(pool, {
        ...session,
        stripeSessionId: 'cs_test_rollback',
        stripePaymentIntentId: 'pi_test_rollback',
        publicReference: 'OG7-2026-ROLLBACK',
        status: 'paid'
      })
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM fund_contributions WHERE stripe_session_id='cs_test_rollback'"
        )
      ).rows[0].n,
      0
    );
  }
);
