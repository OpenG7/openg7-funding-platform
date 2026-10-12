import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import {
  approveFixtureSubject,
  fixtureModerationDecision,
  fixtureModerationActor
} from './support/moderation-fixture.mjs';
import {
  createAdminPublicationSlot,
  updateAdminPublicationSlot
} from '../../dist/apps/funding-api/src/fund-publication-calendar.repository.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { claimNextDelivery } from '../../dist/apps/funding-api/src/publication-automation/claims.js';
import { executeDelivery } from '../../dist/apps/funding-api/src/publication-automation/delivery-execution.js';

test(
  'calendar date changes revoke exact authority atomically and real dispatch enforces its current window',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const service = new PublicationAutomationService(
      pool,
      {},
      { SOCIAL_PUBLICATION_MODE: 'mock' }
    );
    const future = () => new Date(Date.now() + 3600000).toISOString();
    async function reset() {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        'UPDATE publication_worker_settings SET enabled=TRUE; UPDATE publication_feeds SET paused=FALSE,auto_prepare=FALSE'
      );
    }
    async function approve(id, db) {
      const row = (
        await pool.query(
          'SELECT version FROM publication_deliveries WHERE id=$1',
          [id]
        )
      ).rows[0];
      const moderationDecision = await fixtureModerationDecision(pool, {
        type: 'publication_delivery',
        id
      });
      return service.command(
        {
          action: 'approve',
          id,
          confirmation: id,
          version: row.version,
          moderationDecision
        },
        fixtureModerationActor,
        false,
        db
      );
    }
    async function setup({ approved = true, withDelivery = true } = {}) {
      await reset();
      const contributionId = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_status)
      VALUES('sponsorship_interest',50000,'CAD','paid',TRUE,'approved','Synthetic calendar sponsor','Complete calendar source body','not_planned') RETURNING id`)
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, contributionId, {
        channel: 'facebook'
      });
      const obligation = (
        await pool.query(
          'SELECT * FROM sponsorship_obligations WHERE contribution_id=$1',
          [contributionId]
        )
      ).rows[0];
      const slot = (
        await createAdminPublicationSlot(pool, {
          feedTarget: 'openg7',
          channel: 'facebook',
          startsAt: future(),
          capacity: 1
        })
      ).slot;
      const batchId = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity,slot_id,scheduled_at,status) VALUES('facebook',1,$1,$2,'open') RETURNING id",
          [slot.id, slot.startsAt]
        )
      ).rows[0].id;
      const draftId = (
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,batch_id,slot_id,scheduled_at,obligation_id)
      VALUES($1,'openg7','facebook','Merci à Synthetic calendar sponsor','Complete calendar source body','Commandite rémunérée.','draft',$2,$3,$4,$5) RETURNING id`,
          [contributionId, batchId, slot.id, slot.startsAt, obligation.id]
        )
      ).rows[0].id;
      await approveFixtureSubject(pool, {
        type: 'sponsorship',
        id: contributionId
      });
      await approveFixtureSubject(pool, {
        type: 'publication_draft',
        id: draftId
      });
      await service.command(
        { action: 'check', feedId: 'openg7:facebook' },
        fixtureModerationActor
      );
      let id = null;
      if (withDelivery)
        ({ id } = await service.command(
          {
            action: 'compose',
            feedId: 'openg7:facebook',
            kind: 'sponsorship',
            batchId
          },
          fixtureModerationActor
        ));
      if (approved && id) await approve(id);
      return {
        id,
        slotId: slot.id,
        batchId,
        draftId,
        obligationId: obligation.id
      };
    }
    async function snapshot(ids) {
      const row = async (table, id) =>
        (await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0];
      return {
        slot: await row('publication_slots', ids.slotId),
        batch: await row('sponsor_publication_batches', ids.batchId),
        draft: await row('sponsor_publication_drafts', ids.draftId),
        delivery: await row('publication_deliveries', ids.id),
        obligation: await row('sponsorship_obligations', ids.obligationId),
        reservation: (
          await pool.query(
            'SELECT * FROM publication_account_reservations WHERE delivery_id=$1',
            [ids.id]
          )
        ).rows[0],
        obligations: (
          await pool.query(
            'SELECT * FROM sponsorship_obligation_reservations WHERE delivery_id=$1 ORDER BY obligation_id',
            [ids.id]
          )
        ).rows
      };
    }
    const nextDate = () => new Date(Date.now() + 7200000).toISOString();

    await t.test(
      'moving an approved slot retains content and benefits, releases old reservations, and requires fresh approval',
      async () => {
        const ids = await setup();
        const before = await snapshot(ids);
        const date = nextDate();
        const actor = 'synthetic-calendar-operator';
        assert.equal(
          (
            await updateAdminPublicationSlot(
              pool,
              { slotId: ids.slotId, startsAt: date },
              actor
            )
          ).updated,
          true
        );
        const after = await snapshot(ids);
        for (const item of [
          after.slot.starts_at,
          after.batch.scheduled_at,
          after.draft.scheduled_at,
          after.delivery.scheduled_at
        ])
          assert.equal(item.toISOString(), date);
        assert.equal(after.delivery.status, 'draft');
        assert.equal(after.delivery.auto_managed, false);
        assert.equal(after.delivery.approved_at, null);
        assert.equal(after.delivery.approved_by, null);
        assert.equal(after.delivery.version, before.delivery.version + 1);
        for (const key of [
          'message',
          'source_snapshot',
          'media_id',
          'media_snapshot',
          'photo_selections',
          'publication_format',
          'account_id',
          'mode',
          'obligation_snapshot'
        ])
          assert.deepEqual(after.delivery[key], before.delivery[key], key);
        assert.deepEqual(after.obligation, before.obligation);
        assert.equal(after.draft.batch_id, before.draft.batch_id);
        assert.equal(after.draft.slot_id, before.draft.slot_id);
        assert.equal(after.draft.obligation_id, before.draft.obligation_id);
        assert.equal(after.reservation.status, 'released');
        assert.ok(after.obligations.every((row) => row.released_at));
        const audits = (
          await pool.query(
            "SELECT actor,metadata FROM admin_audit_log WHERE action='publication_automation.reschedule_calendar' AND entity_id=$1",
            [ids.id]
          )
        ).rows;
        assert.equal(audits.length, 1);
        assert.equal(audits[0].actor, actor);
        assert.equal(
          audits[0].metadata.previousScheduledAt,
          before.delivery.scheduled_at.toISOString()
        );
        assert.equal(audits[0].metadata.scheduledAt, date);
        await updateAdminPublicationSlot(
          pool,
          { slotId: ids.slotId, startsAt: date },
          actor
        );
        assert.equal(
          (await snapshot(ids)).delivery.version,
          after.delivery.version,
          'same-date replay does not revoke twice'
        );
        await approveFixtureSubject(pool, {
          type: 'publication_draft',
          id: ids.draftId
        });
        await approve(ids.id);
        const renewed = await snapshot(ids);
        assert.equal(renewed.delivery.status, 'approved');
        assert.equal(renewed.reservation.status, 'reserved');
        assert.equal(renewed.reservation.scheduled_at.toISOString(), date);
        assert.equal(renewed.obligation.state, 'pending');
      }
    );

    for (const state of [
      'publishing',
      'uncertain',
      'blocked_with_account',
      'rejected'
    ]) {
      await t.test(
        `a date change cannot alter ${state} authority or a human refusal`,
        async () => {
          const ids = await setup();
          if (state === 'rejected') {
            const current = (await snapshot(ids)).delivery;
            await service.command(
              {
                action: 'reject',
                id: ids.id,
                confirmation: ids.id,
                version: current.version,
                moderationDecision: await fixtureModerationDecision(
                  pool,
                  { type: 'publication_delivery', id: ids.id },
                  'N3'
                )
              },
              fixtureModerationActor
            );
          } else {
            const context = {
              pool,
              workerSettings: async () => ({ enabled: true, version: 1 })
            };
            const claim = await claimNextDelivery(
              context,
              new Date(Date.now() + 3601000)
            );
            assert.equal(claim.id, ids.id);
            if (state !== 'publishing') {
              await pool.query(
                'UPDATE publication_deliveries SET status=$2 WHERE id=$1',
                [ids.id, state === 'uncertain' ? 'uncertain' : 'blocked']
              );
              await pool.query(
                'UPDATE publication_account_leases SET uncertain=TRUE WHERE delivery_id=$1',
                [ids.id]
              );
            }
          }
          const before = await snapshot(ids);
          assert.equal(
            (
              await updateAdminPublicationSlot(
                pool,
                { slotId: ids.slotId, startsAt: nextDate() },
                'synthetic-operator'
              )
            ).updated,
            false
          );
          assert.deepEqual(await snapshot(ids), before);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='publication_automation.reschedule_calendar'"
              )
            ).rows[0].count,
            0
          );
        }
      );
    }

    await t.test(
      'an approval completing while the calendar waits is revoked without an inverted lock order',
      async () => {
        const ids = await setup({ approved: false });
        const row = (await snapshot(ids)).delivery;
        const moderationDecision = await fixtureModerationDecision(pool, {
          type: 'publication_delivery',
          id: ids.id
        });
        const blocker = await pool.connect();
        let moving;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT id FROM publication_deliveries WHERE id=$1 FOR UPDATE',
            [ids.id]
          );
          const date = nextDate();
          moving = updateAdminPublicationSlot(
            pool,
            { slotId: ids.slotId, startsAt: date },
            'synthetic-calendar-operator'
          );
          const deadline = Date.now() + 5000;
          let waiting = false;
          while (Date.now() < deadline) {
            waiting = (
              await pool.query(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT delivery.%FOR UPDATE OF delivery%') AS waiting"
              )
            ).rows[0].waiting;
            if (waiting) break;
            await delay(20);
          }
          assert.equal(
            waiting,
            true,
            'the other PostgreSQL connection waits on the delivery before the slot'
          );
          await service.command(
            {
              action: 'approve',
              id: ids.id,
              confirmation: ids.id,
              version: row.version,
              moderationDecision
            },
            fixtureModerationActor,
            false,
            blocker
          );
          await blocker.query('COMMIT');
          assert.equal((await moving).updated, true);
          const after = await snapshot(ids);
          assert.equal(after.delivery.status, 'draft');
          assert.equal(after.delivery.approved_at, null);
          assert.equal(after.reservation.status, 'released');
          assert.equal(after.delivery.scheduled_at.toISOString(), date);
          assert.equal(after.delivery.version, row.version + 2);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await moving;
        }
      }
    );

    await t.test(
      'a first composition committing during the batch lock makes the calendar decline until a safe retry',
      async () => {
        const ids = await setup({ approved: false, withDelivery: false });
        const before = await snapshot(ids);
        const composing = await pool.connect();
        let moving;
        let created;
        const date = nextDate();
        try {
          await composing.query('BEGIN');
          const composerPid = (
            await composing.query('SELECT pg_backend_pid() AS pid')
          ).rows[0].pid;
          const result = await service.command(
            {
              action: 'compose',
              feedId: 'openg7:facebook',
              kind: 'sponsorship',
              batchId: ids.batchId
            },
            fixtureModerationActor,
            false,
            composing
          );
          created = { ...ids, id: result.id };
          moving = updateAdminPublicationSlot(
            pool,
            { slotId: ids.slotId, startsAt: date },
            'synthetic-calendar-operator'
          );
          void moving.catch(() => {});
          const deadline = Date.now() + 5000;
          let waiting = false;
          while (Date.now() < deadline) {
            waiting = (
              await pool.query(
                `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                 WHERE datname=current_database() AND wait_event_type='Lock'
                   AND query LIKE 'SELECT id FROM sponsor_publication_batches%WHERE slot_id=%FOR UPDATE%'
                   AND $1::int=ANY(pg_blocking_pids(pid))) AS waiting`,
                [composerPid]
              )
            ).rows[0].waiting;
            if (waiting) break;
            await delay(20);
          }
          assert.equal(
            waiting,
            true,
            'calendar has read no delivery and waits on the first composer batch lock'
          );
          await composing.query('COMMIT');
          assert.equal((await moving).updated, false);
          const after = await snapshot(created);
          for (const key of ['slot', 'batch', 'draft', 'obligation'])
            assert.deepEqual(after[key], before[key], key);
          assert.equal(after.delivery.status, 'draft');
          assert.equal(after.delivery.approved_at, null);
          assert.equal(after.delivery.version, 1);
          assert.equal(
            after.delivery.scheduled_at.toISOString(),
            before.slot.starts_at.toISOString()
          );
          assert.equal(after.reservation, undefined);
          assert.deepEqual(after.obligations, []);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='publication_automation.reschedule_calendar'"
              )
            ).rows[0].count,
            0
          );
        } finally {
          await composing.query('ROLLBACK');
          composing.release();
          if (moving) await moving;
        }
        assert.equal(
          (
            await updateAdminPublicationSlot(
              pool,
              { slotId: ids.slotId, startsAt: date },
              'synthetic-calendar-operator'
            )
          ).updated,
          true
        );
        const retried = await snapshot(created);
        for (const item of [
          retried.slot.starts_at,
          retried.batch.scheduled_at,
          retried.draft.scheduled_at,
          retried.delivery.scheduled_at
        ])
          assert.equal(item.toISOString(), date);
        assert.equal(retried.delivery.status, 'draft');
        assert.equal(retried.delivery.approved_at, null);
        assert.deepEqual(retried.obligation, before.obligation);
      }
    );

    await t.test(
      'a revocation audit failure rolls back the date and all reservations',
      async () => {
        const ids = await setup();
        const before = await snapshot(ids);
        await pool.query(`CREATE FUNCTION fail_calendar_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='publication_automation.reschedule_calendar' THEN RAISE EXCEPTION 'Synthetic calendar audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_calendar_revocation BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_calendar_revocation()`);
        try {
          await assert.rejects(
            updateAdminPublicationSlot(
              pool,
              { slotId: ids.slotId, startsAt: nextDate() },
              'synthetic-operator'
            ),
            /Synthetic calendar audit failure/
          );
          assert.deepEqual(await snapshot(ids), before);
        } finally {
          await pool.query(
            'DROP TRIGGER fail_calendar_revocation ON admin_audit_log; DROP FUNCTION fail_calendar_revocation()'
          );
        }
      }
    );

    await t.test(
      'a delay in private preparation crossing the real 24-hour deadline performs no dispatch',
      async (t) => {
        await reset();
        await service.command(
          { action: 'check', feedId: 'openg7:facebook' },
          fixtureModerationActor
        );
        const id = (
          await pool.query(
            `INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,source_snapshot,account_id,mode,status,approved_at,approved_by)
      VALUES('openg7:facebook','news','Exact synthetic historical authorization',clock_timestamp()-INTERVAL '24 hours'+INTERVAL '3 seconds','[]','mock-openg7:facebook','mock','approved',NOW(),$1) RETURNING id`,
            [fixtureModerationActor]
          )
        ).rows[0].id;
        await approveFixtureSubject(pool, { type: 'publication_delivery', id });
        const recipeNow = new Date();
        const context = {
          pool,
          storage: {},
          env: { SOCIAL_PUBLICATION_MODE: 'mock' },
          workerSettings: async () => ({ enabled: true, version: 1 }),
          feeds: async (db) => {
            if (db) {
              const before = (
                await db.query(
                  "SELECT clock_timestamp()<=scheduled_at+INTERVAL '24 hours' AS within_window FROM publication_deliveries WHERE id=$1",
                  [id]
                )
              ).rows[0].within_window;
              assert.equal(
                before,
                true,
                'preparation starts inside the authorized window'
              );
              await delay(3100);
            }
            return service.feeds(db);
          }
        };
        const claimed = await claimNextDelivery(context, recipeNow);
        assert.equal(claimed.id, id);
        t.mock.method(globalThis, 'fetch', async () =>
          assert.fail('No HTTP after expiry.')
        );
        await executeDelivery(context, claimed, recipeNow);
        const current = (
          await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
            id
          ])
        ).rows[0];
        assert.equal(current.status, 'blocked');
        assert.equal(current.error_code, 'SCHEDULE_EXPIRED');
        assert.equal(current.approved_at, null);
        assert.equal(current.approved_by, null);
        assert.equal(current.external_post_id, null);
        assert.equal(current.next_attempt_at, null);
        const account = (
          await pool.query(
            'SELECT * FROM publication_account_leases WHERE account_id=$1',
            ['mock-openg7:facebook']
          )
        ).rows[0];
        assert.equal(account.delivery_id, null);
        assert.equal(account.dispatched_at, null);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='publication_automation.provider_result_observed'"
            )
          ).rows[0].count,
          0
        );
      }
    );
  }
);
