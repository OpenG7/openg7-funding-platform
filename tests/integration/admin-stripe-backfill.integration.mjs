import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { AdminStripeBackfillService } from '../../dist/apps/funding-api/src/admin-stripe-backfill.service.js';
import { runStripeBackfill } from '../../dist/apps/funding-api/src/stripe-backfill.service.js';
import { upsertCheckoutSessionFromWebhook } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'admin Stripe recovery previews, audits, deduplicates and reports interruption on disposable PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const today = new Date().toISOString().slice(0, 10);
    const scope = { from: today, to: today, limit: 10 };
    const config = {
      apiKey: 'sk_test_synthetic_admin_backfill',
      projectId: 'openg7',
      environment: 'development'
    };
    const actor = 'synthetic-owner';
    const metadata = {
      projectId: 'openg7',
      publicReference: 'OG7-2026-TEST500',
      contributionType: 'personal_support',
      nonCharityAcknowledged: 'true'
    };
    const balance = {
      id: 'txn_admin_backfill',
      amount: 500,
      fee: 45,
      net: 455,
      currency: 'cad'
    };
    const charge = {
      id: 'ch_admin_backfill',
      amount: 500,
      amount_refunded: 0,
      currency: 'cad',
      status: 'succeeded',
      balance_transaction: balance
    };
    const intent = {
      id: 'pi_admin_backfill',
      object: 'payment_intent',
      amount: 500,
      amount_received: 500,
      currency: 'cad',
      status: 'succeeded',
      created: Math.floor(Date.now() / 1000),
      latest_charge: charge,
      metadata
    };
    const session = {
      id: 'cs_admin_backfill',
      object: 'checkout.session',
      payment_status: 'paid',
      amount_total: 500,
      currency: 'cad',
      created: intent.created,
      payment_intent: intent,
      metadata
    };
    let accountId = 'acct_synthetic_admin';
    let shouldFail = false;
    let gate = null;
    let reached = null;
    const queries = [];
    const stripe = {
      accounts: {
        async retrieve() {
          return { id: accountId };
        }
      },
      checkout: {
        sessions: {
          async *list(params) {
            queries.push(params);
            if (gate) {
              reached?.();
              await gate;
            }
            if (shouldFail) throw new Error('secret-provider-error');
            yield session;
          }
        }
      },
      charges: {
        async retrieve() {
          return charge;
        }
      },
      disputes: { async *list() {} }
    };
    const service = new AdminStripeBackfillService(db.pool, stripe, config);
    const confirm = (run) => `${run.mode}:${run.id}`;
    const count = async (table) =>
      (await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    await upsertCheckoutSessionFromWebhook(db.pool, {
      stripeSessionId: session.id,
      stripePaymentIntentId: intent.id,
      publicReference: metadata.publicReference,
      contributionType: 'personal_support',
      amountCents: 500,
      currency: 'cad',
      metadata,
      publicDisplayConsent: false,
      publicName: null,
      displayAmountConsent: false,
      nonCharityAcknowledged: true,
      sponsorshipFollowupTokenHash: null,
      status: 'pending',
      paidAtIso: null,
      emailPrivate: 'synthetic@example.test'
    });

    await t.test(
      'migration adds receipts to an existing database without changing a contribution',
      async () => {
        const before = (await db.pool.query('SELECT * FROM fund_contributions'))
          .rows;
        await db.pool.query('DROP TABLE admin_stripe_backfills');
        await db.pool.query(
          await readFile(
            new URL(
              '../../apps/funding-api/migrations/028_create_admin_stripe_backfills.sql',
              import.meta.url
            ),
            'utf8'
          )
        );
        assert.deepEqual(
          (await db.pool.query('SELECT * FROM fund_contributions')).rows,
          before
        );
      }
    );
    await t.test(
      'an expired execution deadline stops before financial writes',
      async () => {
        await assert.rejects(
          runStripeBackfill(stripe, db.pool, {
            projectId: 'openg7',
            includeUnmatched: false,
            includePayouts: false,
            includeRefunds: true,
            includeDisputes: true,
            dryRun: false,
            assumeNonCharityAcknowledged: false,
            created: null,
            maxRecords: 10,
            deadlineAt: Date.now() - 1
          }),
          /time limit/
        );
        assert.equal(await count('fund_transactions'), 0);
      }
    );
    let run;
    await t.test(
      'preview leaves payment pending and only persists its scope and audit',
      async () => {
        run = await service.preview(scope, actor);
        assert.equal(run.status, 'preview');
        assert.equal(run.counts.payments, 1);
        assert.equal(run.accountId, accountId);
        assert.equal(
          (await db.pool.query('SELECT status FROM fund_contributions')).rows[0]
            .status,
          'pending'
        );
        assert.equal(await count('fund_transactions'), 0);
        assert.equal(await count('email_messages'), 0);
        assert.equal(await count('admin_audit_log'), 1);
        assert.equal(queries.at(-1).created.gte, Date.parse(today) / 1000);
        assert.ok(queries.at(-1).created.lte <= Math.floor(Date.now() / 1000));
        assert.doesNotMatch(
          JSON.stringify(run),
          /sk_test|synthetic@example|credential/
        );
      }
    );
    await t.test(
      'actor, exact confirmation, credentials, account and expiry are verified server-side',
      async () => {
        await assert.rejects(service.execute(run.id, confirm(run), 'other'), {
          status: 404
        });
        await assert.rejects(service.execute(run.id, '', actor), {
          code: 'CONFIRMATION_REQUIRED'
        });
        await assert.rejects(service.execute(run.id, 'live:' + run.id, actor), {
          code: 'CONFIRMATION_REQUIRED'
        });
        accountId = 'acct_other';
        await assert.rejects(service.execute(run.id, confirm(run), actor), {
          code: 'PREVIEW_CHANGED'
        });
        accountId = run.accountId;
        const changed = new AdminStripeBackfillService(db.pool, stripe, {
          ...config,
          apiKey: 'sk_test_changed'
        });
        await assert.rejects(changed.execute(run.id, confirm(run), actor), {
          code: 'PREVIEW_CHANGED'
        });
        await db.pool.query(
          "UPDATE admin_stripe_backfills SET expires_at=now()-interval '1 minute' WHERE id=$1",
          [run.id]
        );
        await assert.rejects(service.execute(run.id, confirm(run), actor), {
          code: 'PREVIEW_EXPIRED'
        });
        run = await service.preview(scope, actor);
        assert.equal(await count('fund_transactions'), 0);
      }
    );
    await t.test(
      'failed start audit prevents every financial write',
      async () => {
        await db.pool
          .query(`CREATE FUNCTION reject_backfill_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='stripe_backfill.started' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_backfill_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_backfill_audit()`);
        await assert.rejects(service.execute(run.id, confirm(run), actor));
        assert.equal(await count('fund_transactions'), 0);
        assert.equal((await service.read(run.id, actor)).status, 'preview');
        await db.pool.query(
          'DROP TRIGGER reject_backfill_audit ON admin_audit_log; DROP FUNCTION reject_backfill_audit()'
        );
      }
    );
    await t.test(
      'concurrent confirmation and replay never duplicate a payment or audit',
      async () => {
        let release;
        gate = new Promise((resolve) => {
          release = resolve;
        });
        const started = new Promise((resolve) => {
          reached = resolve;
        });
        const executing = service.execute(run.id, confirm(run), actor);
        await started;
        assert.equal((await service.read(run.id, actor)).status, 'running');
        const reconfigured = new AdminStripeBackfillService(db.pool, stripe, {
          ...config,
          projectId: 'another-project'
        });
        assert.equal(
          (await reconfigured.read(run.id, actor)).status,
          'running'
        );
        assert.equal(
          (await service.execute(run.id, confirm(run), actor)).status,
          'running'
        );
        await assert.rejects(service.preview(scope, actor), {
          code: 'BACKFILL_BUSY'
        });
        release();
        gate = null;
        const result = await executing;
        assert.equal(result.status, 'completed');
        assert.equal(result.counts.payments, 1);
        assert.equal(
          (await db.pool.query('SELECT status FROM fund_contributions')).rows[0]
            .status,
          'paid'
        );
        const ledger = (await db.pool.query('SELECT * FROM fund_transactions'))
          .rows;
        assert.equal(ledger.length, 1);
        assert.equal(ledger[0].amount, '500');
        const auditCount = await count('admin_audit_log');
        const nextProcess = new AdminStripeBackfillService(
          db.pool,
          stripe,
          config
        );
        assert.deepEqual(
          await nextProcess.execute(run.id, confirm(run), actor),
          result
        );
        assert.equal(await count('admin_audit_log'), auditCount);
        assert.deepEqual(
          (await db.pool.query('SELECT * FROM fund_transactions')).rows,
          ledger
        );
        const repeat = await service.preview(scope, actor);
        assert.equal(repeat.counts.payments, 0);
        assert.equal(
          (await service.execute(repeat.id, confirm(repeat), actor)).counts
            .payments,
          0
        );
        assert.equal(await count('email_messages'), 0);
        assert.equal(await count('contribution_activity'), 0);
      }
    );
    await t.test(
      'provider failure and orphaned execution have durable non-success receipts',
      async () => {
        const failed = await service.preview(scope, actor);
        shouldFail = true;
        assert.equal(
          (await service.execute(failed.id, confirm(failed), actor)).status,
          'failed'
        );
        shouldFail = false;
        const before = queries.length;
        assert.equal(
          (await service.execute(failed.id, confirm(failed), actor)).status,
          'failed'
        );
        assert.equal(queries.length, before);
        const interrupted = await service.preview(scope, actor);
        await db.pool.query(
          "UPDATE admin_stripe_backfills SET status='running' WHERE id=$1",
          [interrupted.id]
        );
        assert.equal(
          (await service.read(interrupted.id, actor)).status,
          'interrupted'
        );
        assert.equal(
          (await service.execute(interrupted.id, confirm(interrupted), actor))
            .status,
          'interrupted'
        );
        const audit = (await db.pool.query('SELECT * FROM admin_audit_log'))
          .rows;
        assert.ok(
          audit.some((row) => row.action === 'stripe_backfill.interrupted')
        );
        assert.doesNotMatch(
          JSON.stringify(audit),
          /secret-provider|sk_test|synthetic@example/
        );
        await assert.rejects(service.read(randomUUID(), actor), {
          code: 'BACKFILL_NOT_FOUND'
        });
      }
    );
    await t.test(
      'real HTTP route requires authentication, origin, JSON and explicit confirmation',
      async (t) => {
        const provider = createServer((request, response) => {
          const path = new URL(request.url, 'http://localhost').pathname;
          response.setHeader('Content-Type', 'application/json');
          if (path === '/v1/account')
            response.end(JSON.stringify({ id: accountId, object: 'account' }));
          else if (path === '/v1/checkout/sessions')
            response.end(
              JSON.stringify({
                object: 'list',
                data: [session],
                has_more: false
              })
            );
          else if (path === '/v1/disputes')
            response.end(
              JSON.stringify({ object: 'list', data: [], has_more: false })
            );
          else {
            response.statusCode = 404;
            response.end('{}');
          }
        });
        provider.listen(0, '127.0.0.1');
        await once(provider, 'listening');
        const token = randomUUID();
        const options = db.pool.options;
        const databaseUrl = `postgresql://${options.user}:${options.password}@127.0.0.1:${options.port}/${options.database}`;
        const child = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
      import http from 'node:http';
      const listen = http.Server.prototype.listen;
      http.Server.prototype.listen = function(_port, callback) {
        return listen.call(this, 0, '127.0.0.1', () => { console.log('TEST_PORT=' + this.address().port); callback?.(); });
      };
      await import('./dist/apps/funding-api/src/main.js');
    `
          ],
          {
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
              DATABASE_URL: databaseUrl,
              STRIPE_SECRET_KEY: config.apiKey,
              STRIPE_API_HOST: '127.0.0.1',
              STRIPE_API_PORT: String(provider.address().port),
              STRIPE_API_PROTOCOL: 'http',
              FUNDING_PUBLIC_BASE_URL: 'http://localhost',
              FUNDING_ALLOWED_ORIGINS: 'http://localhost'
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
          }
        );
        t.after(async () => {
          const closed = once(child, 'exit');
          child.kill();
          await closed;
          provider.closeAllConnections();
          await new Promise((resolve) => provider.close(resolve));
        });
        child.stderr.resume();
        const port = await new Promise((resolve, reject) => {
          let output = '';
          const timer = setTimeout(
            () => reject(new Error('Synthetic API startup timed out')),
            10000
          );
          child.once('error', reject);
          child.once('exit', () => {
            clearTimeout(timer);
            reject(new Error('Synthetic API startup failed'));
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
        const url = `http://127.0.0.1:${port}/api/admin/stripe-backfill`;
        const headers = {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          origin: 'http://localhost'
        };
        assert.equal((await fetch(url)).status, 401);
        assert.equal(
          (
            await fetch(url, {
              headers: { authorization: 'Bearer expired-session' }
            })
          ).status,
          401
        );
        const post = (body, patch = {}) =>
          fetch(url, {
            method: 'POST',
            headers: { ...headers, ...patch },
            body: typeof body === 'string' ? body : JSON.stringify(body)
          });
        assert.equal(
          (
            await post(
              { action: 'preview', scope },
              { origin: 'https://untrusted.example' }
            )
          ).status,
          403
        );
        assert.equal(
          (await post('{}', { 'content-type': 'text/plain' })).status,
          415
        );
        for (const input of [
          '{',
          'null',
          '[]',
          {},
          { action: 'preview', scope: { ...scope, limit: 101 } },
          { action: 'preview', scope, apiKey: 'forbidden' }
        ])
          assert.equal((await post(input)).status, 400);
        const preview = await post({ action: 'preview', scope });
        assert.equal(preview.status, 200);
        assert.match(preview.headers.get('cache-control'), /no-store/);
        const previewRun = (await preview.json()).run;
        assert.equal(
          (
            await post({
              action: 'execute',
              id: previewRun.id,
              confirmation: ''
            })
          ).status,
          400
        );
        const executed = await post({
          action: 'execute',
          id: previewRun.id,
          confirmation: confirm(previewRun)
        });
        assert.equal(executed.status, 200);
        assert.equal((await executed.json()).run.status, 'completed');
        const read = await fetch(url + '?id=' + previewRun.id, { headers });
        assert.equal((await read.json()).run.status, 'completed');
        assert.equal(
          (await fetch(url + '?id=invalid', { headers })).status,
          400
        );
        assert.equal(
          (await fetch(url, { method: 'DELETE', headers })).status,
          405
        );
      }
    );
  }
);
