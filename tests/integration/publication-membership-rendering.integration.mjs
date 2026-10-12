import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  assignDraftToPublicationBatch,
  assignDraftToPublicationSlot,
  assignBatchToPublicationSlot
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test('manual assignments preserve complete recognition and count shared members once', async (t) => {
  const database = await startDisposablePostgres();
  t.after(() => database.stop());
  const { pool } = database;
  const draft = async (body, { batchId = null, slotId = null } = {}) => {
    const contributionId = randomUUID();
    const name = `Synthetic recognition ${contributionId.slice(0, 8)}`;
    await pool.query(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,
        public_display_consent,sponsor_review_status,sponsor_company_name)
       VALUES($1,'sponsorship_interest',25000,'cad','paid',TRUE,'approved',$2)`,
      [contributionId, name]
    );
    return (
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,
        body,disclosure_text,status,batch_id,slot_id)
       VALUES($1,'openg7','facebook',$2,$3,'Synthetic sponsored recognition','approved',$4,$5)
       RETURNING id`,
        [contributionId, name, body, batchId, slotId]
      )
    ).rows[0].id;
  };
  const batch = async (capacity) =>
    (
      await pool.query(
        `INSERT INTO sponsor_publication_batches(channel,capacity,status)
     VALUES('facebook',$1,'open') RETURNING id`,
        [capacity]
      )
    ).rows[0].id;
  const slot = async (capacity) =>
    (
      await pool.query(
        `INSERT INTO publication_slots(feed_target,channel,starts_at,timezone,capacity,status)
     VALUES('openg7','facebook',clock_timestamp()+INTERVAL '2 days','America/Toronto',$1,'open') RETURNING id`,
        [capacity]
      )
    ).rows[0].id;

  await t.test(
    'a free numerical place cannot truncate the final batch',
    async () => {
      const batchId = await batch(3);
      await draft('A'.repeat(1800), { batchId });
      const candidate = await draft('B'.repeat(1500));
      const rejected = await assignDraftToPublicationBatch(pool, {
        draftId: candidate,
        batchId
      });
      assert.equal(rejected.updated, false);
      assert.equal(
        (
          await pool.query(
            'SELECT batch_id FROM sponsor_publication_drafts WHERE id=$1',
            [candidate]
          )
        ).rows[0].batch_id,
        null
      );
      const shortened = await pool.query(
        'SELECT body FROM sponsor_publication_drafts WHERE id=$1',
        [candidate]
      );
      assert.equal(shortened.rows[0].body, 'B'.repeat(1500));
      const fitting = await draft('Complete short recognition');
      assert.equal(
        (
          await assignDraftToPublicationBatch(pool, {
            draftId: fitting,
            batchId
          })
        ).updated,
        true
      );
    }
  );

  await t.test(
    'direct slots reject the complete text overflow without changing their members',
    async () => {
      const slotId = await slot(3);
      await draft('A'.repeat(1800), { slotId });
      const candidate = await draft('B'.repeat(1500));
      assert.equal(
        (
          await assignDraftToPublicationSlot(pool, {
            draftId: candidate,
            slotId
          })
        ).updated,
        false
      );
      assert.equal(
        (
          await pool.query(
            'SELECT slot_id FROM sponsor_publication_drafts WHERE id=$1',
            [candidate]
          )
        ).rows[0].slot_id,
        null
      );
    }
  );

  await t.test(
    'batch and slot associations do not consume the same place twice',
    async () => {
      const slotId = await slot(2);
      const batchId = await batch(2);
      await pool.query(
        'UPDATE sponsor_publication_batches SET slot_id=$2 WHERE id=$1',
        [batchId, slotId]
      );
      await draft('First full block', { batchId, slotId });
      const candidate = await draft('Second full block');
      assert.equal(
        (
          await assignDraftToPublicationBatch(pool, {
            draftId: candidate,
            batchId
          })
        ).updated,
        true
      );
      assert.equal(
        (await assignBatchToPublicationSlot(pool, { batchId, slotId })).updated,
        true
      );
      assert.equal(
        (
          await pool.query(
            'SELECT COUNT(*)::integer AS count FROM sponsor_publication_drafts WHERE batch_id=$1',
            [batchId]
          )
        ).rows[0].count,
        2
      );
    }
  );
});
