import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { adjustSponsorshipObligation } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';

const actor = 'synthetic-automatic-operator';
const command = (run) => ({
  runId: run.id,
  expectedVersion: run.version,
  requestId: randomUUID()
});
const control = (service, run, action) =>
  service.control({ ...command(run), action }, actor);

test(
  'durable automatic reconciliation preserves private preparation, receipts and human decisions',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);

    async function reset() {
      await pool.query(
        'TRUNCATE admin_automatic_run_entries,admin_automatic_run_commands,admin_automatic_run_dossiers,admin_automatic_runs,fund_contributions,admin_audit_log CASCADE'
      );
    }
    async function sponsor({
      reviewed = true,
      consent = true,
      amount = 50000
    } = {}) {
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
       sponsor_company_name,sponsor_public_summary,sponsor_contact_email,sponsor_review_status,
       sponsor_details_submitted_at,public_display_consent,sponsor_site_visibility_held)
       VALUES('sponsorship_interest',$1,'CAD','paid',NOW(),'Synthetic responsible company',
         'Recorded synthetic recognition','synthetic@example.invalid',$2,NOW(),$3,TRUE) RETURNING id`,
          [amount, reviewed ? 'approved' : 'pending_review', consent]
        )
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        benefits: [
          {
            channel: 'facebook',
            target: 'openg7',
            quantity: 1,
            format: 'collective_text'
          }
        ]
      });
      if (reviewed)
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    }
    const count = async (table, where = '', params = []) =>
      Number(
        (
          await pool.query(
            `SELECT count(*) AS n FROM ${table} ${where}`,
            params
          )
        ).rows[0].n
      );

    await t.test(
      'a confirmed zero amount or malformed currency refuses the complete run explicitly',
      async () => {
        for (const [amount, currency] of [
          [0, 'CAD'],
          [1, 'invalid']
        ]) {
          await reset();
          await pool.query(
            "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',$1,$2,'paid',NOW())",
            [amount, currency]
          );
          await assert.rejects(
            new AdminAutomaticRunsService(pool).start(
              { requestId: randomUUID() },
              actor
            ),
            { code: 'RUN_INVALID_PAYMENT_FACTS', status: 503 }
          );
          assert.equal(await count('admin_automatic_runs'), 0);
          assert.equal(await count('admin_automatic_run_commands'), 0);
          assert.equal(await count('fund_contributions'), 1);
        }
      }
    );

    await t.test(
      'a confirmed negative amount is never silently excluded or financially rewritten',
      async () => {
        await reset();
        await pool.query(
          "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',-1,'CAD','paid',NOW())"
        );
        await assert.rejects(
          new AdminAutomaticRunsService(pool).start(
            { requestId: randomUUID() },
            actor
          ),
          { code: 'RUN_INVALID_PAYMENT_FACTS', status: 503 }
        );
        assert.equal(await count('admin_automatic_runs'), 0);
        assert.equal(
          (await pool.query('SELECT amount_cents FROM fund_contributions'))
            .rows[0].amount_cents,
          -1
        );
      }
    );

    await t.test(
      'an invalid payment arriving after the frozen manifest remains new work and prevents a global balance claim',
      async () => {
        await reset();
        const service = new AdminAutomaticRunsService(pool);
        const started = await service.start({ requestId: randomUUID() }, actor);
        assert.equal(started.run.globalBalanced, true);
        await pool.query(
          "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',0,'CAD','paid',NOW())"
        );
        const current = await service.state(actor, started.run.id);
        assert.equal(current.run.dossierCount, 0);
        assert.equal(current.run.newPaymentCount, 1);
        assert.equal(current.run.globalBalanced, false);
        assert.deepEqual(current.run.currencyTotals, []);
        assert.equal(await count('admin_automatic_run_entries'), 0);
      }
    );

    await t.test(
      'lost commit acknowledgement is reconciled by its existing receipt without repeating preparation',
      async () => {
        await reset();
        const id = await sponsor();
        let loseAcknowledgement = true;
        const observedPool = {
          query: pool.query.bind(pool),
          async connect() {
            const client = await pool.connect();
            let wroteReport = false;
            return {
              async query(sql, ...args) {
                const result = await client.query(sql, ...args);
                if (
                  typeof sql === 'string' &&
                  /INSERT INTO admin_automatic_run_entries/.test(sql)
                )
                  wroteReport = true;
                if (sql === 'COMMIT' && wroteReport && loseAcknowledgement) {
                  loseAcknowledgement = false;
                  throw new Error('Synthetic lost database acknowledgement');
                }
                return result;
              },
              release: () => client.release()
            };
          }
        };
        const service = new AdminAutomaticRunsService(observedPool);
        const started = await service.start({ requestId: randomUUID() }, actor);
        const input = command(started.run);
        const completed = await service.advance(input, actor);
        assert.equal(completed.run.status, 'completed');
        assert.equal(completed.run.processedCount, 1);
        assert.equal(
          completed.run.globalBalanced,
          false,
          'private preparation never fulfils a promised passage'
        );
        assert.equal(completed.run.latestEntry.contributionId, id);
        assert.equal(completed.run.latestEntry.actions.length, 1);
        assert.equal(completed.run.latestEntry.actions[0].created, true);
        assert.ok(completed.run.latestEntry.actions[0].auditReference);
        assert.equal(completed.run.latestEntry.beforeBalance.fulfilled, 0);
        assert.equal(completed.run.latestEntry.balance.fulfilled, 0);
        assert.equal(await count('sponsorship_fulfilment_evidence'), 0);
        assert.equal(await count('publication_deliveries'), 0);
        assert.equal(await count('sponsor_publication_drafts'), 1);
        assert.equal(await count('admin_automatic_run_entries'), 1);
        assert.deepEqual(await service.advance(input, actor), completed);
        assert.equal(await count('sponsor_publication_drafts'), 1);
        assert.equal(await count('admin_automatic_run_entries'), 1);
        assert.deepEqual(
          (
            await new AdminAutomaticRunsService(pool).report(
              actor,
              started.run.id
            )
          ).entries,
          [completed.run.latestEntry]
        );
        const pass2 = await control(service, completed.run, 'recheck');
        const again = await service.advance(command(pass2.run), actor);
        assert.equal(again.run.pass, 2);
        assert.equal(again.run.latestEntry.actions[0].created, false);
        assert.equal(await count('sponsor_publication_drafts'), 1);
        assert.equal(
          await count(
            'admin_audit_log',
            "WHERE action='publication_draft.create'"
          ),
          1
        );
      }
    );

    await t.test(
      'an audit failure rolls back the draft and report; uncertainty requires explicit no-effect reconciliation',
      async () => {
        await reset();
        await sponsor();
        await pool.query(`CREATE FUNCTION synthetic_reject_private_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='publication_draft.create' THEN RAISE EXCEPTION 'Synthetic audit rejection'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER synthetic_private_audit_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_reject_private_audit()`);
        const service = new AdminAutomaticRunsService(pool);
        const started = await service.start({ requestId: randomUUID() }, actor);
        const input = command(started.run);
        await assert.rejects(service.advance(input, actor), {
          code: 'RUN_UNCERTAIN'
        });
        assert.equal(await count('sponsor_publication_drafts'), 0);
        assert.equal(await count('admin_automatic_run_entries'), 0);
        let current = await service.state(actor, started.run.id);
        assert.equal(current.run.status, 'uncertain');
        await pool.query(
          'DROP TRIGGER synthetic_private_audit_failure ON admin_audit_log; DROP FUNCTION synthetic_reject_private_audit()'
        );
        await assert.rejects(service.advance(input, actor), {
          code: 'RUN_UNCERTAIN'
        });
        assert.equal(
          await count('sponsor_publication_drafts'),
          0,
          'uncertain UUID never executes again'
        );
        current = await control(service, current.run, 'reconcile');
        assert.equal(current.run.status, 'paused');
        assert.equal(current.run.processedCount, 0);
        assert.equal(
          await count(
            'admin_audit_log',
            "WHERE action='automatic_run.reconciled_no_effect'"
          ),
          1
        );
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM admin_automatic_run_commands WHERE request_id=$1',
              [input.requestId]
            )
          ).rows[0].status,
          'failed'
        );
        assert.equal(await count('sponsor_publication_drafts'), 0);
        current = await control(service, current.run, 'resume');
        current = await service.advance(command(current.run), actor);
        assert.equal(current.run.status, 'completed');
        assert.equal(await count('sponsor_publication_drafts'), 1);
        assert.equal(await count('admin_automatic_run_entries'), 1);
      }
    );

    await t.test(
      'a cross-tab pause committed before preparation fences the pending advance',
      async () => {
        await reset();
        await sponsor();
        let announceClaim;
        const claimed = new Promise((resolve) => {
          announceClaim = resolve;
        });
        let releaseClaim;
        const resumeClaim = new Promise((resolve) => {
          releaseClaim = resolve;
        });
        let blockOnce = true;
        const gatedPool = {
          query: pool.query.bind(pool),
          async connect() {
            const client = await pool.connect();
            let claim = false;
            return {
              async query(sql, ...args) {
                const result = await client.query(sql, ...args);
                if (
                  typeof sql === 'string' &&
                  /INSERT INTO admin_automatic_run_commands/.test(sql) &&
                  /'executing'/.test(sql)
                )
                  claim = true;
                if (sql === 'COMMIT' && claim && blockOnce) {
                  blockOnce = false;
                  announceClaim();
                  await resumeClaim;
                }
                return result;
              },
              release: () => client.release()
            };
          }
        };
        const service = new AdminAutomaticRunsService(gatedPool);
        const started = await service.start({ requestId: randomUUID() }, actor);
        const pending = service.advance(command(started.run), actor);
        await claimed;
        const anotherTab = new AdminAutomaticRunsService(pool);
        const live = await anotherTab.state(actor, started.run.id);
        await control(anotherTab, live.run, 'pause');
        releaseClaim();
        const paused = await pending;
        assert.equal(paused.run.status, 'paused');
        assert.equal(paused.run.processedCount, 0);
        assert.equal(await count('sponsor_publication_drafts'), 0);
        assert.equal(await count('admin_automatic_run_entries'), 0);
      }
    );

    await t.test(
      'a human source refusal and absent consent remain open without a competing draft',
      async () => {
        await reset();
        const rejected = await sponsor();
        const refusedObligation = (
          await pool.query(
            "SELECT id FROM sponsorship_obligations WHERE contribution_id=$1 AND channel='facebook'",
            [rejected]
          )
        ).rows[0].id;
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,obligation_id)
      VALUES($1,'openg7','facebook','Synthetic refusal','Synthetic human-refused source','Paid sponsorship.','rejected',$2)`,
          [rejected, refusedObligation]
        );
        await sponsor({ consent: false });
        const service = new AdminAutomaticRunsService(pool);
        let state = await service.start({ requestId: randomUUID() }, actor);
        while (state.run.status === 'running')
          state = await service.advance(command(state.run), actor);
        assert.equal(state.run.processedCount, 2);
        assert.equal(state.run.globalBalanced, false);
        assert.equal(await count('sponsor_publication_drafts'), 1);
        assert.equal(
          await count('sponsor_publication_drafts', "WHERE status<>'rejected'"),
          0
        );
        assert.equal(
          (await service.report(actor, state.run.id)).entries.every(
            (row) => row.actions.length === 0
          ),
          true
        );
        await assert.rejects(
          service.state('another-synthetic-operator', state.run.id),
          { code: 'RUN_NOT_FOUND' }
        );
        await assert.rejects(
          service.report('another-synthetic-operator', state.run.id),
          { code: 'RUN_NOT_FOUND' }
        );
      }
    );

    await t.test(
      'declined preparation preserves an obsolete source and its existing delivery for explicit review',
      async () => {
        await reset();
        const id = await sponsor();
        const obligation = (
          await pool.query(
            'SELECT id,version FROM sponsorship_obligations WHERE contribution_id=$1',
            [id]
          )
        ).rows[0];
        await withPostgresTransaction(pool, (db) =>
          adjustSponsorshipObligation(
            db,
            {
              requestId: randomUUID(),
              obligationId: obligation.id,
              expectedVersion: obligation.version,
              confirmation: obligation.id,
              reason: 'Synthetic documented destination amendment',
              kind: 'destination',
              target: 'openg20'
            },
            'synthetic-owner'
          )
        );
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
        // Reproduce a pre-correction obsolete binding. It is evidence to repair,
        // never permission for this runner to rewrite an existing delivery.
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',1,'draft') RETURNING id"
          )
        ).rows[0].id;
        const oldDraft = (
          await pool.query(
            `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,obligation_id,batch_id)
        VALUES($1,'openg7','facebook','Synthetic retained text','Synthetic retained human body','Paid sponsorship.','draft',$2,$3) RETURNING *`,
            [id, obligation.id, batch]
          )
        ).rows[0];
        const oldDelivery = (
          await pool.query(
            `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,source_snapshot,account_id,mode,status)
        VALUES('openg7:facebook','sponsorship',$1,'Synthetic existing human proposal',NOW()+INTERVAL '1 day','[]'::jsonb,'synthetic-account','mock','draft') RETURNING *`,
            [batch]
          )
        ).rows[0];
        const service = new AdminAutomaticRunsService(pool);
        let state = await service.start({ requestId: randomUUID() }, actor);
        state = await service.advance(command(state.run), actor);
        assert.equal(state.run.status, 'completed');
        assert.equal(state.run.globalBalanced, false);
        assert.deepEqual(state.run.latestEntry.actions, []);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM sponsor_publication_drafts WHERE id=$1',
              [oldDraft.id]
            )
          ).rows[0],
          oldDraft
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM publication_deliveries WHERE id=$1',
              [oldDelivery.id]
            )
          ).rows[0],
          oldDelivery
        );
        assert.equal(await count('sponsor_publication_drafts'), 1);
        assert.equal(
          await count(
            'admin_audit_log',
            "WHERE action='publication_draft.create'"
          ),
          0
        );
      }
    );
  }
);
