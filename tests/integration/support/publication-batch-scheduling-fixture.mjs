import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  assignBatchToPublicationSlot,
  assignDraftToPublicationBatch,
  createAdminPublicationBatch,
  createAdminPublicationDraft,
  createAdminPublicationSlot,
  updateAdminPublicationDraft,
  updateAdminPublicationSlot
} from '../../../dist/apps/funding-api/src/fund-admin.repository.js';

export const future = (days) =>
  new Date(Date.now() + days * 86400000).toISOString();

export function createSchedulingFixture(pool) {
  async function fixture({ shared = true, unbound = false } = {}) {
    const originalDate = future(5);
    const changedDate = future(10);
    const slot = (
      await createAdminPublicationSlot(pool, {
        feedTarget: 'openg7',
        channel: 'facebook',
        startsAt: originalDate,
        capacity: 5
      })
    ).slot;
    const members = [];
    for (let index = 0; index < (shared ? 2 : 1); index++) {
      const contributionId = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary)
         VALUES($1,'sponsorship_interest',25000,'paid',TRUE,'approved','Synthetic schedule sponsor','Approved synthetic summary')`,
        [contributionId]
      );
      const draft = (
        await createAdminPublicationDraft(pool, {
          contributionId,
          feedTarget: 'openg7',
          channel: 'facebook'
        })
      ).draft;
      assert.ok(draft);
      assert.equal(
        (
          await updateAdminPublicationDraft(pool, {
            draftId: draft.id,
            status: 'approved'
          })
        ).updated,
        true
      );
      const batch = (
        await createAdminPublicationBatch(pool, {
          channel: 'facebook',
          capacity: 2
        })
      ).batch;
      assert.ok(batch);
      assert.equal(
        (
          await assignDraftToPublicationBatch(pool, {
            draftId: draft.id,
            batchId: batch.id
          })
        ).updated,
        true
      );
      if (!unbound || index > 0)
        assert.equal(
          (
            await assignBatchToPublicationSlot(pool, {
              batchId: batch.id,
              slotId: slot.id
            })
          ).updated,
          true
        );
      members.push({ batchId: batch.id, draftId: draft.id });
    }
    return { slotId: slot.id, originalDate, changedDate, members };
  }

  async function snapshot(f) {
    const results = await Promise.all([
      pool.query('SELECT * FROM publication_slots WHERE id=$1', [f.slotId]),
      pool.query(
        'SELECT * FROM sponsor_publication_batches WHERE id=ANY($1::uuid[]) ORDER BY id',
        [f.members.map((member) => member.batchId)]
      ),
      pool.query(
        'SELECT * FROM sponsor_publication_drafts WHERE id=ANY($1::uuid[]) ORDER BY id',
        [f.members.map((member) => member.draftId)]
      )
    ]);
    return {
      slot: results[0].rows[0],
      batches: results[1].rows,
      drafts: results[2].rows
    };
  }

  return { fixture, snapshot };
}

/** Wrap only the transaction client; PostgreSQL still executes every query. */
export function observeSchedulingTransaction(
  pool,
  { beforeQuery, afterQuery }
) {
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values) {
          await beforeQuery?.(sql);
          const result = await client.query(sql, values);
          await afterQuery?.(sql, result);
          return result;
        },
        release: () => client.release()
      };
    }
  };
}

/** Hold the calendar locks through its cascade on a disposable client. */
export async function updateSlotInTransaction(pool, input, afterSlotWrite) {
  const client = await pool.connect();
  const calendarPool = {
    async query(sql, values) {
      const result = await client.query(sql, values);
      if (sql.includes('UPDATE publication_slots slot')) await afterSlotWrite();
      return result;
    }
  };
  try {
    await client.query('BEGIN');
    const result = await updateAdminPublicationSlot(calendarPool, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
