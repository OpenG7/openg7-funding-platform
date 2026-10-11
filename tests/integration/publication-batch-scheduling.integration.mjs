import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  assignBatchToPublicationSlot,
  cancelAdminPublicationBatch,
  publishAdminPublicationBatch,
  scheduleAdminPublicationBatch,
  updateAdminPublicationSlot
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  createSchedulingFixture,
  future,
  observeSchedulingTransaction
} from './support/publication-batch-scheduling-fixture.mjs';

const barrier = () => {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

test(
  'batch scheduling preserves slot scope and atomicity with disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);

    const { fixture, snapshot } = createSchedulingFixture(pool);

    await t.test(
      'different dates are refused for both shared and exclusive slots without any row change',
      async () => {
        for (const shared of [true, false]) {
          const f = await fixture({ shared });
          const before = await snapshot(f);
          const result = await scheduleAdminPublicationBatch(pool, {
            batchId: f.members[0].batchId,
            scheduledAt: f.changedDate
          });
          assert.equal(result.updated, false);
          assert.equal(result.code, 'PUBLICATION_SLOT_SCHEDULE_REQUIRED');
          assert.deepEqual(await snapshot(f), before);
        }
      }
    );

    await t.test(
      'published, cancelled, missing and past-date batches leave every slot and peer unchanged',
      async () => {
        for (const action of ['published', 'cancelled', 'missing', 'past']) {
          const f = await fixture();
          const batchId = f.members[0].batchId;
          if (action === 'published')
            assert.equal(
              (
                await publishAdminPublicationBatch(pool, {
                  batchId,
                  confirmation: batchId
                })
              ).updated,
              true
            );
          if (action === 'cancelled')
            assert.equal(
              (await cancelAdminPublicationBatch(pool, { batchId })).updated,
              true
            );
          const before = await snapshot(f);
          const result = await scheduleAdminPublicationBatch(pool, {
            batchId: action === 'missing' ? randomUUID() : batchId,
            scheduledAt: action === 'past' ? future(-1) : f.changedDate
          });
          assert.equal(result.updated, false);
          assert.equal(result.code, undefined);
          assert.deepEqual(await snapshot(f), before);
        }
      }
    );

    await t.test(
      'same-date scheduling changes only the selected batch and its drafts',
      async () => {
        const f = await fixture();
        const before = await snapshot(f);
        const selected = f.members[0];
        const peer = f.members[1];
        const result = await scheduleAdminPublicationBatch(pool, {
          batchId: selected.batchId,
          scheduledAt: f.originalDate.replace('Z', '+00:00')
        });
        assert.equal(result.updated, true);
        const after = await snapshot(f);
        assert.deepEqual(after.slot, before.slot);
        assert.deepEqual(
          after.batches.find((row) => row.id === peer.batchId),
          before.batches.find((row) => row.id === peer.batchId)
        );
        assert.deepEqual(
          after.drafts.find((row) => row.id === peer.draftId),
          before.drafts.find((row) => row.id === peer.draftId)
        );
        assert.equal(
          after.batches
            .find((row) => row.id === selected.batchId)
            .scheduled_at.toISOString(),
          f.originalDate
        );
        assert.equal(
          after.drafts
            .find((row) => row.id === selected.draftId)
            .scheduled_at.toISOString(),
          f.originalDate
        );
      }
    );

    await t.test(
      'unbound batches remain reprogrammable without moving an unrelated slot or its members',
      async () => {
        const f = await fixture({ unbound: true });
        const before = await snapshot(f);
        const selected = f.members[0];
        assert.equal(
          (
            await scheduleAdminPublicationBatch(pool, {
              batchId: selected.batchId,
              scheduledAt: f.changedDate
            })
          ).updated,
          true
        );
        const after = await snapshot(f);
        assert.deepEqual(after.slot, before.slot);
        const peer = f.members[1];
        assert.deepEqual(
          after.batches.find((row) => row.id === peer.batchId),
          before.batches.find((row) => row.id === peer.batchId)
        );
        assert.deepEqual(
          after.drafts.find((row) => row.id === peer.draftId),
          before.drafts.find((row) => row.id === peer.draftId)
        );
        assert.equal(
          after.batches.find((row) => row.id === selected.batchId).slot_id,
          null
        );
        assert.equal(
          after.batches
            .find((row) => row.id === selected.batchId)
            .scheduled_at.toISOString(),
          f.changedDate
        );
        assert.equal(
          after.drafts
            .find((row) => row.id === selected.draftId)
            .scheduled_at.toISOString(),
          f.changedDate
        );
      }
    );

    await t.test(
      'the dedicated slot command still synchronizes its eligible batches and drafts',
      async () => {
        const f = await fixture();
        assert.equal(
          (
            await updateAdminPublicationSlot(pool, {
              slotId: f.slotId,
              startsAt: f.changedDate
            })
          ).updated,
          true
        );
        const after = await snapshot(f);
        assert.equal(after.slot.starts_at.toISOString(), f.changedDate);
        assert.ok(
          after.batches.every(
            (row) => row.scheduled_at.toISOString() === f.changedDate
          )
        );
        assert.ok(
          after.drafts.every(
            (row) => row.scheduled_at.toISOString() === f.changedDate
          )
        );
        const result = await scheduleAdminPublicationBatch(pool, {
          batchId: f.members[0].batchId,
          scheduledAt: f.originalDate
        });
        assert.equal(result.code, 'PUBLICATION_SLOT_SCHEDULE_REQUIRED');
        assert.deepEqual(await snapshot(f), after);
      }
    );

    await t.test(
      'a real draft cascade failure rolls back the selected batch update',
      async () => {
        const f = await fixture();
        const before = await snapshot(f);
        await pool.query(`CREATE FUNCTION fail_batch_schedule_draft() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.batch_id::text = TG_ARGV[0] THEN RAISE EXCEPTION 'Synthetic schedule cascade failure'; END IF;
          RETURN NEW;
        END $$`);
        await pool.query(
          `CREATE TRIGGER fail_batch_schedule_draft BEFORE UPDATE ON sponsor_publication_drafts FOR EACH ROW EXECUTE FUNCTION fail_batch_schedule_draft('${f.members[0].batchId}')`
        );
        try {
          await assert.rejects(
            scheduleAdminPublicationBatch(pool, {
              batchId: f.members[0].batchId,
              scheduledAt: f.originalDate
            }),
            { code: 'P0001' }
          );
          assert.deepEqual(await snapshot(f), before);
        } finally {
          await pool.query(
            'DROP TRIGGER fail_batch_schedule_draft ON sponsor_publication_drafts; DROP FUNCTION fail_batch_schedule_draft()'
          );
        }
      }
    );

    await t.test(
      'concurrent accepted and refused batch commands preserve the shared slot and peer rows',
      async () => {
        const f = await fixture();
        const before = await snapshot(f);
        const [accepted, refused] = await Promise.all([
          scheduleAdminPublicationBatch(pool, {
            batchId: f.members[0].batchId,
            scheduledAt: f.originalDate
          }),
          scheduleAdminPublicationBatch(pool, {
            batchId: f.members[1].batchId,
            scheduledAt: f.changedDate
          })
        ]);
        assert.equal(accepted.updated, true);
        assert.equal(refused.updated, false);
        assert.equal(refused.code, 'PUBLICATION_SLOT_SCHEDULE_REQUIRED');
        const after = await snapshot(f);
        assert.deepEqual(after.slot, before.slot);
        const peer = f.members[1];
        assert.deepEqual(
          after.batches.find((row) => row.id === peer.batchId),
          before.batches.find((row) => row.id === peer.batchId)
        );
        assert.deepEqual(
          after.drafts.find((row) => row.id === peer.draftId),
          before.drafts.find((row) => row.id === peer.draftId)
        );
      }
    );

    await t.test(
      'a batch attached after the first read is refused without overwriting its new slot date',
      async () => {
        const f = await fixture({ unbound: true });
        const membershipRead = barrier();
        const resumeSchedule = barrier();
        const schedulingPool = observeSchedulingTransaction(pool, {
          async afterQuery(sql) {
            if (
              sql.includes('SELECT status,slot_id') &&
              !sql.includes('FOR UPDATE')
            ) {
              membershipRead.open();
              await resumeSchedule.promise;
            }
          }
        });
        const scheduling = scheduleAdminPublicationBatch(schedulingPool, {
          batchId: f.members[0].batchId,
          scheduledAt: f.changedDate
        });
        try {
          await membershipRead.promise;
          assert.equal(
            (
              await assignBatchToPublicationSlot(pool, {
                batchId: f.members[0].batchId,
                slotId: f.slotId
              })
            ).updated,
            true
          );
          const attached = await snapshot(f);
          resumeSchedule.open();
          assert.equal((await scheduling).updated, false);
          assert.deepEqual(await snapshot(f), attached);
        } finally {
          resumeSchedule.open();
          await scheduling;
        }
      }
    );

    await t.test(
      'slot-first batch locking permits a concurrent transactional slot update to finish',
      async () => {
        const f = await fixture();
        const slotLocked = barrier();
        const slotLockRequested = barrier();
        const resumeSlotCascade = barrier();
        const schedulingPool = observeSchedulingTransaction(pool, {
          beforeQuery(sql) {
            if (
              sql.includes('FROM publication_slots') &&
              sql.includes('FOR SHARE')
            )
              slotLockRequested.open();
          }
        });
        // Hold the real calendar transaction after its slot lock and before
        // its batch locks. Batch-first scheduling would deadlock this boundary.
        const calendarPool = observeSchedulingTransaction(pool, {
          async afterQuery(sql) {
            if (
              sql.includes('FROM publication_slots') &&
              sql.includes('FOR UPDATE')
            ) {
              slotLocked.open();
              await resumeSlotCascade.promise;
            }
          }
        });
        const calendarUpdate = updateAdminPublicationSlot(calendarPool, {
          slotId: f.slotId,
          startsAt: f.changedDate
        });
        let scheduling;
        try {
          await slotLocked.promise;
          scheduling = scheduleAdminPublicationBatch(schedulingPool, {
            batchId: f.members[0].batchId,
            scheduledAt: f.originalDate
          });
          await slotLockRequested.promise;
          resumeSlotCascade.open();
          const [calendarResult, batchResult] = await Promise.all([
            calendarUpdate,
            scheduling
          ]);
          assert.equal(calendarResult.updated, true);
          assert.equal(batchResult.updated, false);
          assert.equal(batchResult.code, 'PUBLICATION_SLOT_SCHEDULE_REQUIRED');
          const after = await snapshot(f);
          assert.equal(after.slot.starts_at.toISOString(), f.changedDate);
          assert.ok(
            after.batches.every(
              (row) => row.scheduled_at.toISOString() === f.changedDate
            )
          );
          assert.ok(
            after.drafts.every(
              (row) => row.scheduled_at.toISOString() === f.changedDate
            )
          );
        } finally {
          resumeSlotCascade.open();
          await Promise.allSettled([calendarUpdate, scheduling]);
        }
      }
    );
  }
);
