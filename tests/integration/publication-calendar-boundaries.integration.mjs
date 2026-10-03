import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignBatchToPublicationSlot,
  assignDraftToPublicationSlot,
  cancelAdminPublicationSlot,
  createAdminPublicationSlot,
  getPublicSponsorshipBatchAvailability,
  listAdminPublicationSlots,
  publishAdminPublicationSlot,
  updateAdminPublicationSlot
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

test(
  'calendar persistence retains capacity, associations, rollback and replay against disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    let sequence = 0;
    const createSlot = async (options = {}) => {
      const result = await createAdminPublicationSlot(pool, {
        feedTarget: 'openg7',
        channel: 'facebook',
        startsAt: future(10),
        capacity: 2,
        ...options
      });
      assert.equal(result.updated, true);
      return result.slot;
    };
    const createBatch = async (channel = 'facebook') => {
      const result = await pool.query(
        `INSERT INTO sponsor_publication_batches (channel, capacity)
         VALUES ($1, 5) RETURNING id::text AS id`,
        [channel]
      );
      return result.rows[0].id;
    };
    const createDraft = async ({
      batchId = null,
      feedTarget = 'openg7',
      channel = 'facebook'
    } = {}) => {
      sequence += 1;
      const contribution = await pool.query(
        `INSERT INTO fund_contributions (
          contribution_type, amount_cents, currency, status, stripe_session_id
        ) VALUES ('sponsorship_interest', 10000, 'cad', 'paid', $1)
        RETURNING id::text AS id`,
        [`cs_test_calendar_${sequence}`]
      );
      const result = await pool.query(
        `INSERT INTO sponsor_publication_drafts (
          contribution_id, feed_target, channel, title, body, disclosure_text,
          status, batch_id
        ) VALUES ($1::uuid, $2, $3, 'Synthetic calendar draft', 'Synthetic body',
                  'Synthetic disclosure', 'approved', $4::uuid)
        RETURNING id::text AS id`,
        [contribution.rows[0].id, feedTarget, channel, batchId]
      );
      return result.rows[0].id;
    };
    const getSlot = async (id) =>
      (await listAdminPublicationSlots(pool, { id })).slots[0];
    const lifecycleFixture = async () => {
      const slot = await createSlot();
      const batchId = await createBatch();
      const batchDraftId = await createDraft({ batchId });
      const directDraftId = await createDraft();
      assert.equal(
        (await assignBatchToPublicationSlot(pool, { slotId: slot.id, batchId }))
          .updated,
        true
      );
      assert.equal(
        (
          await assignDraftToPublicationSlot(pool, {
            slotId: slot.id,
            draftId: directDraftId
          })
        ).updated,
        true
      );
      return { slotId: slot.id, batchId, batchDraftId, directDraftId };
    };
    const snapshot = async ({
      slotId,
      batchId,
      batchDraftId,
      directDraftId
    }) => {
      const [slot, batch, drafts] = await Promise.all([
        pool.query('SELECT * FROM publication_slots WHERE id=$1::uuid', [
          slotId
        ]),
        pool.query(
          'SELECT * FROM sponsor_publication_batches WHERE id=$1::uuid',
          [batchId]
        ),
        pool.query(
          'SELECT * FROM sponsor_publication_drafts WHERE id=ANY($1::uuid[]) ORDER BY id',
          [[batchDraftId, directDraftId]]
        )
      ]);
      return { slot: slot.rows[0], batch: batch.rows[0], drafts: drafts.rows };
    };

    await t.test(
      'creation retains future-date validation and normalized defaults',
      async () => {
        assert.deepEqual(
          await createAdminPublicationSlot(pool, {
            feedTarget: 'openg7',
            channel: 'facebook',
            startsAt: future(-1),
            capacity: 2
          }),
          { updated: false, slot: null }
        );
        const slot = await createSlot({
          timezone: '  ',
          notes: '  Synthetic note  '
        });
        assert.equal(slot.timezone, 'America/Toronto');
        assert.equal(slot.notes, 'Synthetic note');
        assert.equal(slot.status, 'scheduled');
        assert.equal(slot.capacityAvailable, 2);
        assert.deepEqual(slot.assignedBatchIds, []);
        assert.deepEqual(slot.assignedDraftIds, []);
      }
    );

    await t.test(
      'capacity counts combined associations once and preserves idempotent assignment',
      async () => {
        const fixture = await lifecycleFixture();
        const input = { slotId: fixture.slotId, batchId: fixture.batchId };
        const replay = await assignBatchToPublicationSlot(pool, input);
        assert.equal(replay.updated, true);
        assert.equal(replay.slot.capacityUsed, 2);
        assert.equal(replay.slot.capacityAvailable, 0);
        assert.deepEqual(replay.slot.assignedBatchIds, [fixture.batchId]);
        assert.deepEqual(
          [...replay.slot.assignedDraftIds].sort(),
          [fixture.batchDraftId, fixture.directDraftId].sort()
        );
        assert.equal(
          (
            await assignDraftToPublicationSlot(pool, {
              slotId: fixture.slotId,
              draftId: fixture.directDraftId
            })
          ).updated,
          true,
          'an already assigned draft does not consume additional capacity'
        );
        const extraDraftId = await createDraft();
        const full = await assignDraftToPublicationSlot(pool, {
          slotId: fixture.slotId,
          draftId: extraDraftId
        });
        assert.equal(full.updated, false);
        assert.equal(full.slot.capacityUsed, 2);
        const reduced = await updateAdminPublicationSlot(pool, {
          slotId: fixture.slotId,
          capacity: 1
        });
        assert.equal(reduced.updated, false);
        assert.equal(reduced.slot.capacity, 2);

        const startsAt = future(15);
        const enlarged = await updateAdminPublicationSlot(pool, {
          slotId: fixture.slotId,
          capacity: 3,
          startsAt,
          timezone: '  UTC  ',
          notes: ''
        });
        assert.equal(enlarged.updated, true);
        assert.equal(enlarged.slot.timezone, 'UTC');
        assert.equal(enlarged.slot.notes, null);
        assert.equal(Date.parse(enlarged.slot.startsAt), Date.parse(startsAt));
        const records = await snapshot(fixture);
        assert.equal(records.batch.scheduled_at.toISOString(), startsAt);
        for (const draft of records.drafts) {
          assert.equal(draft.slot_id, fixture.slotId);
          assert.equal(draft.status, 'scheduled');
          assert.equal(draft.scheduled_at.toISOString(), startsAt);
        }
        assert.equal(
          (
            await assignDraftToPublicationSlot(pool, {
              slotId: fixture.slotId,
              draftId: extraDraftId
            })
          ).updated,
          true
        );
        assert.equal((await getSlot(fixture.slotId)).capacityUsed, 3);
        assert.equal(
          (
            await assignDraftToPublicationSlot(pool, {
              slotId: fixture.slotId,
              draftId: fixture.batchDraftId
            })
          ).updated,
          false,
          'batch membership cannot become a separate draft assignment'
        );
        const otherSlot = await createSlot({ capacity: 5 });
        assert.equal(
          (
            await assignBatchToPublicationSlot(pool, {
              slotId: otherSlot.id,
              batchId: fixture.batchId
            })
          ).updated,
          false,
          'an associated batch cannot migrate to another slot'
        );
        assert.equal(
          (
            await assignDraftToPublicationSlot(pool, {
              slotId: otherSlot.id,
              draftId: fixture.directDraftId
            })
          ).updated,
          false,
          'an associated draft cannot migrate to another slot'
        );
      }
    );

    await t.test(
      'assignment rejects channel, feed and collective-capacity mismatches',
      async () => {
        const slot = await createSlot({ capacity: 1 });
        for (const options of [
          { feedTarget: 'openg20' },
          { channel: 'linkedin' }
        ]) {
          const draftId = await createDraft(options);
          assert.equal(
            (
              await assignDraftToPublicationSlot(pool, {
                slotId: slot.id,
                draftId
              })
            ).updated,
            false
          );
        }
        const mismatchBatch = await createBatch();
        await createDraft({ batchId: mismatchBatch, feedTarget: 'openg20' });
        const otherChannelBatch = await createBatch('linkedin');
        const oversizedBatch = await createBatch();
        await createDraft({ batchId: oversizedBatch });
        await createDraft({ batchId: oversizedBatch });
        for (const batchId of [
          mismatchBatch,
          otherChannelBatch,
          oversizedBatch
        ]) {
          const result = await assignBatchToPublicationSlot(pool, {
            slotId: slot.id,
            batchId
          });
          assert.equal(result.updated, false);
          assert.equal(result.slot.capacityUsed, 0);
          assert.deepEqual(result.slot.assignedBatchIds, []);
        }
      }
    );

    // These failure fixtures exist only inside this helper's disposable database.
    await pool.query(`
      CREATE TABLE synthetic_calendar_failures (target_id uuid PRIMARY KEY);
      CREATE FUNCTION synthetic_calendar_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM synthetic_calendar_failures WHERE target_id=NEW.id)
          THEN RAISE EXCEPTION 'Synthetic calendar lifecycle failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER synthetic_calendar_draft_failure
        BEFORE UPDATE ON sponsor_publication_drafts
        FOR EACH ROW EXECUTE FUNCTION synthetic_calendar_failure();
      CREATE TRIGGER synthetic_calendar_batch_failure
        BEFORE UPDATE ON sponsor_publication_batches
        FOR EACH ROW EXECUTE FUNCTION synthetic_calendar_failure();
    `);

    for (const [name, mutate, target] of [
      ['publication', publishAdminPublicationSlot, 'batchDraftId'],
      ['cancellation', cancelAdminPublicationSlot, 'batchId']
    ]) {
      await t.test(
        `${name} rolls back all prior writes and can be retried once`,
        async () => {
          const fixture = await lifecycleFixture();
          const before = await snapshot(fixture);
          await pool.query(
            'INSERT INTO synthetic_calendar_failures (target_id) VALUES ($1::uuid)',
            [fixture[target]]
          );
          try {
            await assert.rejects(
              mutate(pool, { slotId: fixture.slotId }),
              /Synthetic calendar lifecycle failure/
            );
            assert.deepEqual(await snapshot(fixture), before);
          } finally {
            await pool.query('DELETE FROM synthetic_calendar_failures');
          }
          const result = await mutate(pool, { slotId: fixture.slotId });
          assert.equal(result.updated, true);
          const after = await snapshot(fixture);
          if (name === 'publication') {
            assert.equal(after.slot.status, 'published');
            assert.equal(after.batch.status, 'published');
            assert.ok(after.batch.published_at);
            for (const draft of after.drafts) {
              assert.equal(draft.status, 'published');
              assert.ok(draft.published_at);
              assert.equal(draft.slot_id, fixture.slotId);
            }
            assert.equal(result.slot.capacityUsed, 2);
            assert.equal(
              (
                await cancelAdminPublicationSlot(pool, {
                  slotId: fixture.slotId
                })
              ).updated,
              false,
              'publication cannot be undone by cancellation'
            );
          } else {
            assert.equal(after.slot.status, 'cancelled');
            assert.equal(after.batch.status, 'open');
            assert.equal(after.batch.slot_id, null);
            assert.equal(after.batch.scheduled_at, null);
            for (const draft of after.drafts) {
              assert.equal(draft.status, 'approved');
              assert.equal(draft.slot_id, null);
              assert.equal(draft.scheduled_at, null);
            }
            assert.equal(result.slot.capacityUsed, 0);
            assert.deepEqual(result.slot.assignedBatchIds, []);
            assert.deepEqual(result.slot.assignedDraftIds, []);
          }
          assert.equal(
            (await mutate(pool, { slotId: fixture.slotId })).updated,
            false
          );
          assert.deepEqual(await snapshot(fixture), after);
        }
      );
    }

    await t.test(
      'cancellation retains previously published associations and publication dates',
      async () => {
        const fixture = await lifecycleFixture();
        await pool.query(
          "UPDATE sponsor_publication_batches SET status='published', published_at=NOW() WHERE id=$1::uuid",
          [fixture.batchId]
        );
        await pool.query(
          "UPDATE sponsor_publication_drafts SET status='published', published_at=NOW() WHERE id=$1::uuid",
          [fixture.batchDraftId]
        );
        const before = await snapshot(fixture);
        const result = await cancelAdminPublicationSlot(pool, {
          slotId: fixture.slotId
        });
        assert.equal(result.updated, true);
        assert.equal(result.slot.status, 'cancelled');
        assert.equal(result.slot.capacityUsed, 1);
        assert.deepEqual(result.slot.assignedBatchIds, [fixture.batchId]);
        assert.deepEqual(result.slot.assignedDraftIds, [fixture.batchDraftId]);
        const after = await snapshot(fixture);
        assert.deepEqual(after.batch, before.batch);
        assert.deepEqual(
          after.drafts.find(({ id }) => id === fixture.batchDraftId),
          before.drafts.find(({ id }) => id === fixture.batchDraftId)
        );
        const directDraft = after.drafts.find(
          ({ id }) => id === fixture.directDraftId
        );
        assert.equal(directDraft.status, 'approved');
        assert.equal(directDraft.slot_id, null);
        assert.equal(directDraft.scheduled_at, null);
      }
    );
    await t.test(
      'public availability filters past and unpublished slots and reveals only dates and destinations',
      async () => {
        const earliest = await createSlot({ startsAt: future(2) });
        await createSlot({
          startsAt: future(3),
          channel: 'linkedin',
          feedTarget: 'openg20'
        });
        const excluded = await createSlot({ startsAt: future(1) });
        await pool.query(
          "UPDATE publication_slots SET status='cancelled', notes='Synthetic private note' WHERE id=$1::uuid",
          [excluded.id]
        );
        await pool.query(
          `INSERT INTO publication_slots (feed_target, channel, starts_at, capacity, status)
         VALUES ('openg7', 'facebook', $1::timestamptz, 1, 'scheduled')`,
          [future(-1)]
        );
        const result = await getPublicSponsorshipBatchAvailability(pool);
        assert.equal(result.data_source, 'database');
        assert.equal(
          Date.parse(
            result.availability.find(({ channel }) => channel === 'facebook')
              .nextAvailableAt
          ),
          Date.parse(earliest.startsAt)
        );
        assert.ok(result.slots.length > 0 && result.slots.length <= 20);
        for (const slot of result.slots) {
          assert.deepEqual(Object.keys(slot).sort(), [
            'channel',
            'feedTarget',
            'startsAt',
            'timezone'
          ]);
          assert.ok(Date.parse(slot.startsAt) > Date.now());
          assert.notEqual(
            Date.parse(slot.startsAt),
            Date.parse(excluded.startsAt)
          );
        }
        assert.doesNotMatch(
          JSON.stringify(result),
          /Synthetic|capacity|assigned/
        );
      }
    );

    await t.test(
      'missing slots retain empty admin results and legacy public availability',
      async () => {
        await pool.query(
          'ALTER TABLE publication_slots RENAME TO synthetic_hidden_slots'
        );
        try {
          assert.deepEqual((await listAdminPublicationSlots(pool)).slots, []);
          for (const mutate of [
            createAdminPublicationSlot,
            updateAdminPublicationSlot,
            assignBatchToPublicationSlot,
            assignDraftToPublicationSlot,
            publishAdminPublicationSlot,
            cancelAdminPublicationSlot
          ]) {
            assert.deepEqual(await mutate(pool, {}), {
              updated: false,
              slot: null
            });
          }

          const result = await getPublicSponsorshipBatchAvailability(pool);
          assert.equal(result.data_source, 'database');
          assert.equal(result.availability.length, 2);
          assert.deepEqual(result.slots, []);
        } finally {
          await pool.query(
            'ALTER TABLE synthetic_hidden_slots RENAME TO publication_slots'
          );
        }
        await pool.query(
          'ALTER TABLE sponsor_publication_batches RENAME TO synthetic_hidden_batches'
        );
        try {
          assert.deepEqual(await getPublicSponsorshipBatchAvailability(pool), {
            data_source: 'empty',
            availability: [],
            slots: []
          });
        } finally {
          await pool.query(
            'ALTER TABLE synthetic_hidden_batches RENAME TO sponsor_publication_batches'
          );
        }
      }
    );
  }
);
