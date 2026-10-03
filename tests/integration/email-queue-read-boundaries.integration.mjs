import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminEmailQueueMessageById,
  getEmailQueueStatus,
  listAdminEmailQueue
} from '../../dist/apps/funding-api/src/email-queue.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const missingId = '00000000-0000-4000-8000-000000000000';
const emptySummary = {
  queued_count: 0,
  sending_count: 0,
  sent_count: 0,
  failed_count: 0,
  retryable_count: 0,
  last_failed_at: null,
  last_error: null
};
const assertEmptyQueue = (result) => {
  assert.equal(result.data_source, 'database');
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.summary, emptySummary);
  assert.ok(Number.isFinite(Date.parse(result.last_updated_at)));
};

test(
  'email read boundaries preserve real PostgreSQL limits, filters and global observations',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);

    await t.test('an empty queue returns zero observations', async () => {
      assertEmptyQueue(await listAdminEmailQueue(db.pool));
      assert.equal(
        await getAdminEmailQueueMessageById(db.pool, missingId),
        null
      );
      assert.deepEqual(await getEmailQueueStatus(db.pool), {
        queuedCount: 0,
        sendingCount: 0,
        sentCount: 0,
        failedCount: 0,
        lastFailedAt: null,
        lastError: null
      });
    });

    const seeded = (
      await db.pool.query(`
        INSERT INTO email_messages (
          template_key, recipient_email, from_email, subject, text_body,
          html_body, metadata, status, attempts, max_attempts, next_attempt_at,
          sent_at, last_error, created_at, updated_at
        )
        SELECT
          'synthetic_boundary', 'recipient@example.test', 'sender@example.test',
          'Synthetic observation ' || sequence,
          'Private synthetic delivery body', '<p>Private synthetic delivery body</p>',
          jsonb_build_object('sequence', sequence, 'source', 'synthetic'),
          CASE sequence % 4
            WHEN 1 THEN 'queued' WHEN 2 THEN 'sending'
            WHEN 3 THEN 'sent' ELSE 'failed'
          END,
          CASE sequence % 4 WHEN 1 THEN 0 WHEN 0 THEN 5 ELSE 1 END,
          5,
          '2026-09-01T12:00:00Z'::timestamptz + INTERVAL '1 day',
          CASE WHEN sequence % 4 = 3 THEN
            '2026-09-01T12:00:00Z'::timestamptz + sequence * INTERVAL '1 minute'
          ELSE NULL END,
          CASE WHEN sequence % 4 = 0 THEN 'Synthetic failure ' || sequence ELSE NULL END,
          '2026-09-01T12:00:00Z'::timestamptz + sequence * INTERVAL '1 second',
          '2026-09-01T12:00:00Z'::timestamptz + sequence * INTERVAL '1 minute'
        FROM generate_series(1, 156) AS sequence
        RETURNING id, metadata
      `)
    ).rows;
    const bySequence = new Map(
      seeded.map((row) => [row.metadata.sequence, row.id])
    );
    const observationTime = Date.parse('2026-09-01T14:36:00Z');
    const assertGlobalSummary = (result) => {
      assert.deepEqual(
        {
          queued: result.summary.queued_count,
          sending: result.summary.sending_count,
          sent: result.summary.sent_count,
          failed: result.summary.failed_count,
          retryable: result.summary.retryable_count
        },
        { queued: 39, sending: 39, sent: 39, failed: 39, retryable: 117 }
      );
      assert.equal(result.summary.last_error, 'Synthetic failure 156');
      assert.equal(Date.parse(result.summary.last_failed_at), observationTime);
      assert.equal(Date.parse(result.last_updated_at), observationTime);
      assert.doesNotMatch(
        JSON.stringify(result),
        /Private synthetic delivery body/
      );
    };

    await t.test(
      'default listing caps 150 rows and all retains the full order',
      async () => {
        const limited = await listAdminEmailQueue(db.pool);
        assert.equal(limited.messages.length, 150);
        assert.deepEqual(
          limited.messages.map((row) => row.id),
          Array.from({ length: 150 }, (_, index) => bySequence.get(156 - index))
        );
        assertGlobalSummary(limited);
        const all = await listAdminEmailQueue(db.pool, { all: true });
        assert.equal(all.messages.length, 156);
        assert.deepEqual(
          all.messages.map((row) => row.id),
          Array.from({ length: 156 }, (_, index) => bySequence.get(156 - index))
        );
        assertGlobalSummary(all);
      }
    );

    await t.test(
      'ID filters precede the limit and preserve global counts and latest failure',
      async () => {
        // The oldest message falls outside the default 150-row page.
        const oldestId = bySequence.get(1);
        for (const all of [false, true]) {
          const scoped = await listAdminEmailQueue(db.pool, {
            id: oldestId,
            all
          });
          assert.deepEqual(
            scoped.messages.map((row) => row.id),
            [oldestId]
          );
          assertGlobalSummary(scoped);
        }
        for (const id of [missingId, '']) {
          const empty = await listAdminEmailQueue(db.pool, { id });
          assert.deepEqual(empty.messages, []);
          assertGlobalSummary(empty);
        }
      }
    );

    await t.test(
      'lookup projects queue metadata and exhausted failures without delivery bodies',
      async () => {
        const id = bySequence.get(156);
        const result = await getAdminEmailQueueMessageById(db.pool, id);
        assert.equal(result.id, id);
        assert.equal(result.status, 'failed');
        assert.equal(result.attempts, 5);
        assert.equal(result.max_attempts, 5);
        assert.equal(result.recipient_email, 'recipient@example.test');
        assert.equal(result.reply_to_email, null);
        assert.deepEqual(result.metadata, {
          sequence: 156,
          source: 'synthetic'
        });
        assert.equal(result.last_error, 'Synthetic failure 156');
        assert.equal(Date.parse(result.updated_at), observationTime);
        assert.doesNotMatch(
          JSON.stringify(result),
          /Private synthetic delivery body/
        );
        assert.equal(Object.hasOwn(result, 'text_body'), false);
        assert.equal(Object.hasOwn(result, 'html_body'), false);
        assert.equal(
          await getAdminEmailQueueMessageById(db.pool, missingId),
          null
        );
        const status = await getEmailQueueStatus(db.pool);
        assert.deepEqual(status, {
          queuedCount: 39,
          sendingCount: 39,
          sentCount: 39,
          failedCount: 39,
          lastFailedAt: result.updated_at,
          lastError: result.last_error
        });
      }
    );

    await t.test(
      'database and email-table absence keep their distinct historical results',
      async (t) => {
        assertEmptyQueue(await listAdminEmailQueue(null));
        assert.equal(
          await getAdminEmailQueueMessageById(null, missingId),
          null
        );
        assert.deepEqual(await getEmailQueueStatus(null), {
          queuedCount: 0,
          sendingCount: 0,
          sentCount: 0,
          failedCount: 0,
          lastFailedAt: null,
          lastError: null
        });
        const emptyDb = await startDisposablePostgres({ migrate: false });
        t.after(emptyDb.stop);
        assertEmptyQueue(await listAdminEmailQueue(emptyDb.pool));
        assert.equal(
          await getAdminEmailQueueMessageById(emptyDb.pool, missingId),
          null
        );
        await assert.rejects(
          getEmailQueueStatus(emptyDb.pool),
          (error) => error.code === '42P01'
        );
      }
    );
  }
);
