import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import Stripe from 'stripe';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import { runStripeBackfill } from '../../dist/apps/funding-api/src/stripe-backfill.service.js';
import { getPublicTransparencySummary } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import {
  getSponsorshipRefundTarget,
  upsertCheckoutSessionFromWebhook
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { beginSponsorshipRefundOperation } from '../../dist/apps/funding-api/src/sponsorship-refund-operations.js';
import { getCockpitMetrics } from '../../dist/apps/funding-api/src/admin-cockpit/metrics.js';
import { getSponsorshipProgress } from '../../dist/apps/funding-api/src/sponsorship-progress.service.js';

const signer = new Stripe('sk_test_synthetic_integrity', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_synthetic_integrity';
const options = {
  projectId: 'openg7',
  includeUnmatched: false,
  includePayouts: false,
  includeRefunds: true,
  includeDisputes: false,
  dryRun: false,
  assumeNonCharityAcknowledged: false,
  created: null,
  maxRecords: 100
};
function fixture() {
  const suffix = randomUUID().replaceAll('-', '');
  const created = Math.floor(Date.now() / 1000);
  const metadata = {
    projectId: 'openg7',
    contributionType: 'sponsorship_interest',
    nonCharityAcknowledged: 'true'
  };
  const refund = {
    id: 're_' + suffix,
    object: 'refund',
    amount: 2000,
    currency: 'cad',
    status: 'succeeded',
    created,
    payment_intent: 'pi_' + suffix,
    charge: 'ch_' + suffix,
    metadata: {},
    balance_transaction: {
      id: 'txn_refund_' + suffix,
      amount: -2000,
      fee: 0,
      net: -2000,
      currency: 'cad'
    }
  };
  const charge = {
    id: refund.charge,
    object: 'charge',
    amount: 10000,
    amount_refunded: 2000,
    currency: 'cad',
    status: 'succeeded',
    created,
    payment_intent: refund.payment_intent,
    metadata: {},
    balance_transaction: {
      id: 'txn_' + suffix,
      amount: 10000,
      fee: 300,
      net: 9700,
      currency: 'cad'
    },
    refunds: { object: 'list', data: [refund], has_more: false }
  };
  const intent = {
    id: refund.payment_intent,
    object: 'payment_intent',
    amount: 10000,
    amount_received: 10000,
    currency: 'cad',
    status: 'succeeded',
    created,
    latest_charge: charge,
    metadata
  };
  const session = {
    id: 'cs_' + suffix,
    object: 'checkout.session',
    amount_total: 10000,
    currency: 'cad',
    payment_status: 'paid',
    created,
    payment_intent: intent,
    metadata
  };
  const stripe = {
    webhooks: signer.webhooks,
    checkout: {
      sessions: {
        async *list() {
          yield session;
        }
      }
    },
    charges: {
      async retrieve() {
        return charge;
      }
    },
    paymentIntents: {
      async retrieve() {
        return intent;
      }
    },
    refunds: {
      async *list() {
        yield* charge.refunds.data;
      }
    }
  };
  return { stripe, session, intent, charge, refund };
}
async function deliver(pool, f, type, object, id = 'evt_' + randomUUID()) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object }
  });
  const result = await processStripeWebhook(
    payload,
    signer.webhooks.generateTestHeaderString({ payload, secret }),
    {
      stripe: f.stripe,
      webhookSecret: secret,
      pool,
      publicBaseUrl: 'https://example.test',
      projectId: 'openg7'
    }
  );
  return result;
}
async function seed(pool, f) {
  await upsertCheckoutSessionFromWebhook(pool, {
    stripeSessionId: f.session.id,
    stripePaymentIntentId: f.intent.id,
    publicReference: null,
    contributionType: 'sponsorship_interest',
    amountCents: 10000,
    currency: 'cad',
    metadata: f.session.metadata,
    publicDisplayConsent: false,
    publicName: null,
    displayAmountConsent: false,
    nonCharityAcknowledged: true,
    sponsorshipFollowupTokenHash: null,
    status: 'paid',
    paidAtIso: new Date().toISOString(),
    emailPrivate: null
  });
  return (
    await pool.query(
      'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
      [f.session.id]
    )
  ).rows[0].id;
}

test(
  'refund and project invariants on disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query(
        'TRUNCATE fund_contributions, stripe_checkout_sessions, stripe_events, fund_transactions, email_messages CASCADE'
      )
    );
    await t.test(
      'partial backfill keeps payment eligibility; only the complete confirmed total marks refunded',
      async () => {
        const f = fixture();
        await runStripeBackfill(f.stripe, pool, options);
        const id = (await pool.query('SELECT id FROM fund_contributions'))
          .rows[0].id;
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).paymentStatus,
          'paid'
        );
        assert.equal(
          (await getPublicTransparencySummary(pool)).total_refunded,
          20
        );
        f.charge.refunds.data.push({
          ...f.refund,
          id: f.refund.id + '_remaining',
          amount: 8000,
          balance_transaction: null,
          created: f.refund.created + 1
        });
        f.charge.amount_refunded = 10000;
        await runStripeBackfill(f.stripe, pool, options);
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).paymentStatus,
          'refunded'
        );
        assert.equal(
          (await getPublicTransparencySummary(pool)).total_refunded,
          100
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM email_messages'))
            .rows[0].n,
          0
        );
      }
    );
    for (const order of ['backfill-first', 'webhook-first']) {
      await t.test(
        order +
          ' counts each refund once across repeats and concurrent event IDs',
        async () => {
          const f = fixture();
          await seed(pool, f);
          const webhook = () => deliver(pool, f, 'charge.refunded', f.charge);
          if (order === 'webhook-first')
            assert.equal((await webhook()).statusCode, 200);
          await runStripeBackfill(f.stripe, pool, options);
          for (const result of await Promise.all([webhook(), webhook()]))
            assert.equal(result.statusCode, 200);
          await runStripeBackfill(f.stripe, pool, options);
          const summary = await getPublicTransparencySummary(pool);
          assert.equal(summary.total_refunded, 20);
          assert.equal(summary.current_available_estimate, 77);
          const id = (await pool.query('SELECT id FROM fund_contributions'))
            .rows[0].id;
          assert.equal(
            (await getCockpitMetrics(pool)).currencies[0].refundedMinor,
            2000
          );
          assert.equal(
            (await getSponsorshipProgress(pool, id)).dossier.refund
              .confirmedAmountMinor,
            2000
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM fund_transactions WHERE type='charge.refunded'"
              )
            ).rows[0].n,
            1
          );
        }
      );
    }
    await t.test(
      'legacy cumulative and duplicate refund rows remain immutable and do not add to normalized facts',
      async () => {
        const f = fixture();
        await seed(pool, f);
        await pool.query(
          `INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
      VALUES ('legacy_snapshot',$1,'charge.refunded',2000,300,9700,'cad','succeeded',NOW(),'refund',$2)`,
          [
            f.charge.id,
            JSON.stringify({
              source: 'stripe_backfill',
              paymentIntentId: f.intent.id
            })
          ]
        );
        for (const eventId of ['legacy_refund_a', 'legacy_refund_b']) {
          await pool.query(
            `INSERT INTO fund_transactions
            (stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
            VALUES ($1,$2,'charge.refunded',2000,0,-2000,'cad','succeeded',NOW(),'refund',$3)`,
            [
              eventId,
              f.charge.id,
              JSON.stringify({
                refundId: f.refund.id,
                paymentIntentId: f.intent.id
              })
            ]
          );
        }
        const before = (
          await pool.query(
            "SELECT * FROM fund_transactions WHERE stripe_event_id LIKE 'legacy_%' ORDER BY id"
          )
        ).rows;
        await runStripeBackfill(f.stripe, pool, options);
        assert.equal(
          (await deliver(pool, f, 'charge.refunded', f.charge)).statusCode,
          200
        );
        assert.equal(
          (await getPublicTransparencySummary(pool)).total_refunded,
          20
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT * FROM fund_transactions WHERE stripe_event_id LIKE 'legacy_%' ORDER BY id"
            )
          ).rows,
          before
        );
      }
    );
    await t.test(
      'pagination reads all refunds, excludes pending/failed and keeps dry-run free of writes',
      async () => {
        const f = fixture();
        f.charge.refunds.has_more = true;
        f.charge.refunds.data.push({
          ...f.refund,
          id: 're_pending',
          amount: 8000,
          status: 'pending'
        });
        f.charge.amount_refunded = 10000;
        const preview = await runStripeBackfill(f.stripe, pool, {
          ...options,
          dryRun: true
        });
        assert.equal(preview.refunds.dryRunWouldInsertTransactions, 1);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          0
        );
        await runStripeBackfill(f.stripe, pool, options);
        assert.equal(
          (await pool.query('SELECT status FROM fund_contributions')).rows[0]
            .status,
          'paid'
        );
        await deliver(pool, f, 'charge.refunded', f.charge);
        assert.equal(
          (await getPublicTransparencySummary(pool)).total_refunded,
          20
        );
        const id = (await pool.query('SELECT id FROM fund_contributions'))
          .rows[0].id;
        assert.equal(
          (await getCockpitMetrics(pool)).currencies[0].refundedMinor,
          2000
        );
        assert.equal(
          (await getSponsorshipProgress(pool, id)).dossier.refund
            .confirmedAmountMinor,
          2000
        );
        await assert.rejects(
          runStripeBackfill(f.stripe, pool, { ...options, maxRecords: 1 }),
          /refund limit/
        );
      }
    );
    await t.test(
      'foreign/conflicting project events never persist or change public totals',
      async () => {
        const f = fixture();
        f.session.metadata = {
          ...f.session.metadata,
          projectId: 'another-project'
        };
        f.intent.metadata = f.session.metadata;
        for (const [type, object] of [
          ['checkout.session.completed', f.session],
          ['payment_intent.succeeded', f.intent],
          ['charge.refunded', f.charge],
          [
            'charge.dispute.created',
            { id: 'dp_foreign', payment_intent: f.intent.id }
          ],
          ['payout.paid', { id: 'po_account_wide', metadata: {} }]
        ])
          assert.equal(
            (await deliver(pool, f, type, object)).payload.ignored,
            true
          );
        f.session.metadata = {
          projectId: 'openg7',
          project: 'another-project'
        };
        assert.equal(
          (await deliver(pool, f, 'checkout.session.completed', f.session))
            .payload.ignored,
          true
        );
        f.session.metadata = { projectId: 'openg7' };
        assert.equal(
          (await deliver(pool, f, 'checkout.session.completed', f.session))
            .payload.ignored,
          true
        );
        const backfill = await runStripeBackfill(f.stripe, pool, options);
        assert.equal(backfill.checkoutSessions.matched, 0);
        for (const table of [
          'fund_contributions',
          'fund_transactions',
          'stripe_events',
          'email_messages'
        ])
          assert.equal(
            (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0]
              .n,
            0
          );
        assert.equal(
          (await getPublicTransparencySummary(pool)).total_received,
          0
        );
      }
    );
    await t.test(
      'legacy local association is accepted, explicit foreign tags override that association',
      async () => {
        const f = fixture();
        f.session.metadata = {};
        f.intent.metadata = {};
        await seed(pool, f);
        assert.equal(
          (await deliver(pool, f, 'payment_intent.succeeded', f.intent)).payload
            .inserted,
          true
        );
        f.intent.metadata = { projectId: 'foreign' };
        assert.equal(
          (await deliver(pool, f, 'payment_intent.succeeded', f.intent)).payload
            .ignored,
          true
        );
      }
    );
    await t.test(
      'concurrent refund claims cannot both pass the version check',
      async () => {
        const f = fixture(),
          id = await seed(pool, f);
        const target = await getSponsorshipRefundTarget(pool, id);
        const input = {
          contributionId: id,
          expectedVersion: target.version,
          paymentIntentId: f.intent.id,
          amountMinor: 2000,
          currency: 'cad',
          reason: 'requested_by_customer',
          note: null,
          actor: 'synthetic-owner'
        };
        const claims = await Promise.allSettled([
          beginSponsorshipRefundOperation(pool, input),
          beginSponsorshipRefundOperation(pool, input)
        ]);
        assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM sponsorship_refund_operations'
            )
          ).rows[0].n,
          1
        );
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).refundWorkflowStatus,
          'processing'
        );
        // A different refund must not release this operation's exclusive claim.
        await deliver(pool, f, 'charge.refunded', f.charge);
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).refundWorkflowStatus,
          'processing'
        );
        f.refund.metadata.openg7RefundOperationId = claims.find(
          (r) => r.status === 'fulfilled'
        ).value;
        await deliver(pool, f, 'charge.refunded', f.charge);
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).refundWorkflowStatus,
          'completed'
        );
        // A late pending snapshot cannot regress the confirmed operation or its workflow.
        f.refund.status = 'pending';
        await deliver(pool, f, 'charge.refunded', f.charge);
        assert.equal(
          (await getSponsorshipRefundTarget(pool, id)).refundWorkflowStatus,
          'completed'
        );
        assert.equal(
          (await pool.query('SELECT status FROM sponsorship_refund_operations'))
            .rows[0].status,
          'succeeded'
        );
      }
    );
  }
);

test(
  'lost refund response remains blocked across API restart until authoritative reconciliation',
  { timeout: 60000 },
  async (t) => {
    const db = await startDisposablePostgres();
    const f = fixture();
    const id = await seed(db.pool, f);
    const refunds = new Map();
    let calls = 0;
    const provider = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      if (request.method !== 'POST' || request.url !== '/v1/refunds') {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      calls++;
      const key = request.headers['idempotency-key'];
      const data = new URLSearchParams(body);
      if (!refunds.has(key))
        refunds.set(key, {
          ...f.refund,
          amount: Number(data.get('amount')),
          metadata: {
            openg7RefundOperationId: data.get(
              'metadata[openg7RefundOperationId]'
            )
          }
        });
      // Provider has performed the financial effect but loses every HTTP response.
      request.socket.destroy();
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    let child;
    const token = randomUUID();
    const stopApi = async () => {
      if (child?.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    };
    t.after(async () => {
      await stopApi();
      provider.closeAllConnections();
      await new Promise((resolve) => provider.close(resolve));
      await db.stop();
    });
    async function startApi() {
      const p = db.pool.options;
      child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import http from 'node:http';
      const listen=http.Server.prototype.listen;
      http.Server.prototype.listen=function(_port,callback){return listen.call(this,0,'127.0.0.1',()=>{console.log('TEST_PORT='+this.address().port);callback?.();});};
      await import('./dist/apps/funding-api/src/main.js');
    `
        ],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            FUNDING_API_PORT: '0',
            FUNDING_PLATFORM_ENV: 'development',
            FUNDING_ADMIN_TOKEN: token,
            FUNDING_ADMIN_SESSION_SECRET: randomUUID(),
            FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
            FUNDING_EMAIL_WORKER_ENABLED: 'false',
            SMTP_ENABLED: 'false',
            SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
            DATABASE_URL: `postgresql://${p.user}:${p.password}@127.0.0.1:${p.port}/${p.database}`,
            STRIPE_SECRET_KEY: 'sk_test_synthetic_refund',
            STRIPE_API_HOST: '127.0.0.1',
            STRIPE_API_PORT: String(provider.address().port),
            STRIPE_API_PROTOCOL: 'http',
            FUNDING_PUBLIC_BASE_URL: 'http://localhost',
            FUNDING_ALLOWED_ORIGINS: 'http://localhost'
          }
        }
      );
      child.stderr.resume();
      return new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error('Synthetic API startup timeout')),
          10000
        );
        child.once('error', reject);
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Synthetic API exited'));
        });
        child.stdout.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/TEST_PORT=(\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
      });
    }
    let port = await startApi();
    const post = async (version) =>
      fetch(`http://127.0.0.1:${port}/api/admin/sponsorships/refund`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          origin: 'http://localhost',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          contributionId: id,
          expectedVersion: version,
          confirmationText: id,
          amount: 20
        }),
        signal: AbortSignal.timeout(20000)
      });
    const before = await getSponsorshipRefundTarget(db.pool, id);
    const first = await post(before.version);
    assert.equal(first.status, 502);
    assert.equal((await first.json()).code, 'SPONSORSHIP_REFUND_UNCERTAIN');
    assert.equal(refunds.size, 1);
    assert.equal(
      (await getSponsorshipRefundTarget(db.pool, id)).refundWorkflowStatus,
      'processing'
    );
    assert.equal(
      (await db.pool.query('SELECT status FROM sponsorship_refund_operations'))
        .rows[0].status,
      'uncertain'
    );
    const callsBeforeRestart = calls;
    await stopApi();
    port = await startApi();
    const retry = await post(
      (await getSponsorshipRefundTarget(db.pool, id)).version
    );
    assert.equal(retry.status, 409);
    await retry.arrayBuffer();
    assert.equal(calls, callsBeforeRestart);
    assert.equal(refunds.size, 1);
    f.charge.refunds.data = [...refunds.values()];
    assert.equal(
      (await deliver(db.pool, f, 'charge.refunded', f.charge)).statusCode,
      200
    );
    assert.equal(
      (await getSponsorshipRefundTarget(db.pool, id)).refundWorkflowStatus,
      'completed'
    );
    assert.equal(
      (await db.pool.query('SELECT status FROM sponsorship_refund_operations'))
        .rows[0].status,
      'succeeded'
    );
    assert.equal(
      (await getPublicTransparencySummary(db.pool)).total_refunded,
      20
    );
  }
);
