import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimAdminEmailQueueRetry,
  getAdminEmailQueueMessageById,
  getEmailQueueStatus,
  listAdminEmailQueue
} from '../dist/apps/funding-api/src/email-queue.repository.js';
import * as reads from '../dist/apps/funding-api/src/email-queue-read.repository.js';

const messageId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-09-01T12:00:00Z';
const message = (overrides = {}) => ({
  id: messageId,
  template_key: 'sponsorship_confirmation',
  recipient_email: 'recipient@example.test',
  from_email: 'notifications@example.test',
  reply_to_email: null,
  subject: 'Synthetic confirmation',
  status: 'failed',
  attempts: 5,
  max_attempts: 5,
  next_attempt_at: timestamp,
  sent_at: null,
  last_error: 'Synthetic delivery failure',
  metadata: { contributionId: 'synthetic-contribution' },
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides
});
const emptySummary = {
  queued_count: 0,
  sending_count: 0,
  sent_count: 0,
  failed_count: 0,
  retryable_count: 0,
  last_failed_at: null,
  last_error: null
};
const emptyStatus = {
  queuedCount: 0,
  sendingCount: 0,
  sentCount: 0,
  failedCount: 0,
  lastFailedAt: null,
  lastError: null
};

// Scripted results exercise public projections and query bindings. Real SQL and
// recovery leases remain covered by integration/email-recovery.integration.mjs.
const scriptedPool = (steps) => ({
  async query(sql, params) {
    const step = steps.shift();
    assert.ok(step, 'Unexpected email queue read');
    assert.match(sql, step.sql);
    step.inspect?.(params, sql);
    if (step.error) throw step.error;
    return { rows: step.rows ?? [] };
  }
});
const presence = (rows = [{ has_email_messages: true }]) => ({
  sql: /to_regclass\('public.email_messages'\)/,
  rows
});

test('historical email exports delegate to the read owner', () => {
  assert.equal(
    getAdminEmailQueueMessageById,
    reads.getAdminEmailQueueMessageById
  );
  assert.equal(listAdminEmailQueue, reads.listAdminEmailQueue);
  assert.equal(getEmailQueueStatus, reads.getEmailQueueStatus);
});

test('email reads retain their no-database defaults and table-absence behavior', async () => {
  assert.equal(await getAdminEmailQueueMessageById(null, messageId), null);
  assert.deepEqual(await getEmailQueueStatus(null), emptyStatus);
  const unavailable = await listAdminEmailQueue(null);
  assert.equal(unavailable.data_source, 'database');
  assert.deepEqual(unavailable.messages, []);
  assert.deepEqual(unavailable.summary, emptySummary);
  assert.ok(Number.isFinite(Date.parse(unavailable.last_updated_at)));

  for (const rows of [[{ has_email_messages: false }], []]) {
    const steps = [presence(rows), presence(rows), presence(rows)];
    const pool = scriptedPool(steps);
    assert.equal(await getAdminEmailQueueMessageById(pool, messageId), null);
    const result = await listAdminEmailQueue(pool, {
      all: true,
      id: messageId
    });
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.summary, emptySummary);
    assert.ok(Number.isFinite(Date.parse(result.last_updated_at)));
    assert.deepEqual(await claimAdminEmailQueueRetry(pool, messageId), []);
    assert.equal(steps.length, 0);
  }
});

test('queue status retains the missing-table error instead of masking an outage as zero', async () => {
  const error = Object.assign(new Error('Synthetic missing email table'), {
    code: '42P01'
  });
  const steps = [{ sql: /WITH counts AS/, error }];
  await assert.rejects(
    getEmailQueueStatus(scriptedPool(steps)),
    (failure) => failure === error
  );
  assert.equal(steps.length, 0);
});

test('message lookup keeps UUID binding, queue fields and metadata normalization without delivery bodies', async () => {
  for (const metadata of [{ source: 'synthetic' }, null, 'invalid', 3]) {
    const row = message({
      metadata,
      text_body: 'Private synthetic body',
      html_body: '<p>Private synthetic body</p>'
    });
    const steps = [
      presence(),
      {
        sql: /WHERE id = \$1::uuid\s+LIMIT 1/,
        rows: [row],
        inspect: (params) => assert.deepEqual(params, [messageId])
      }
    ];
    const result = await getAdminEmailQueueMessageById(
      scriptedPool(steps),
      messageId
    );
    assert.deepEqual(result, {
      ...message(),
      metadata:
        typeof metadata === 'object' && metadata !== null ? metadata : {}
    });
    assert.equal(steps.length, 0);
  }
  const steps = [presence(), { sql: /WHERE id = \$1::uuid/, rows: [] }];
  assert.equal(
    await getAdminEmailQueueMessageById(scriptedPool(steps), messageId),
    null
  );
  assert.equal(steps.length, 0);
});

test('listing preserves the default limit, optional ID filter and all override while aggregates stay global', async () => {
  const summaryRow = {
    queued_count: 41,
    sending_count: 2,
    sent_count: 100,
    failed_count: 9,
    retryable_count: 52,
    last_failed_at: timestamp,
    last_error: 'Synthetic latest error',
    last_updated_at: timestamp
  };
  for (const [options, params, rows] of [
    [undefined, [null, 150], [message()]],
    [{ all: false }, [null, 150], []],
    [{ id: messageId }, [messageId, 150], [message()]],
    [{ all: true }, [null, null], [message()]],
    [{ all: true, id: messageId }, [messageId, null], [message()]],
    [{ id: '' }, ['', 150], []]
  ]) {
    const steps = [
      presence(),
      {
        sql: /WHERE \(\$1::text IS NULL OR id::text = \$1\)/,
        rows,
        inspect: (actual, sql) => {
          assert.deepEqual(actual, params);
          assert.match(
            sql,
            /ORDER BY updated_at DESC, created_at DESC\s+LIMIT \$2/
          );
        }
      },
      {
        sql: /WITH counts AS/,
        rows: [summaryRow],
        inspect: (actual, sql) => {
          assert.equal(
            actual,
            undefined,
            'aggregates must not inherit the ID filter'
          );
          assert.doesNotMatch(sql, /\$1|\$2/);
          assert.match(sql, /WHERE status IN \('queued', 'failed'\)/);
          assert.doesNotMatch(sql, /attempts < max_attempts/);
        }
      }
    ];
    const result = await listAdminEmailQueue(scriptedPool(steps), options);
    assert.equal(result.data_source, 'database');
    assert.deepEqual(result.messages, rows);
    const { last_updated_at, ...summary } = summaryRow;
    assert.deepEqual(result.summary, summary);
    assert.equal(result.last_updated_at, last_updated_at);
    assert.equal(steps.length, 0);
  }
});

test('empty summaries preserve zero counts and a valid observation timestamp', async () => {
  for (const rows of [[], [{ last_updated_at: null }]]) {
    const steps = [
      presence(),
      { sql: /FROM email_messages/, rows: [] },
      { sql: /WITH counts AS/, rows }
    ];
    const result = await listAdminEmailQueue(scriptedPool(steps));
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.summary, emptySummary);
    assert.ok(Number.isFinite(Date.parse(result.last_updated_at)));
    assert.equal(steps.length, 0);
  }
});

test('queue status maps all aggregates and latest failure without the listing limit', async () => {
  const row = {
    queued_count: 160,
    sending_count: 2,
    sent_count: 11,
    failed_count: 3,
    last_failed_at: timestamp,
    last_error: 'Synthetic status failure'
  };
  const steps = [
    {
      sql: /WITH counts AS/,
      rows: [row],
      inspect: (params, sql) => {
        assert.equal(params, undefined);
        assert.match(
          sql,
          /WHERE status IN \('failed', 'uncertain'\)\s+ORDER BY updated_at DESC\s+LIMIT 1/
        );
      }
    },
    { sql: /WITH counts AS/, rows: [] }
  ];
  const pool = scriptedPool(steps);
  assert.deepEqual(await getEmailQueueStatus(pool), {
    queuedCount: 160,
    sendingCount: 2,
    sentCount: 11,
    failedCount: 3,
    lastFailedAt: timestamp,
    lastError: 'Synthetic status failure'
  });
  assert.deepEqual(await getEmailQueueStatus(pool), emptyStatus);
  assert.equal(steps.length, 0);
});

test('presence and data-query failures propagate from email reads', async () => {
  const failure = new Error('Synthetic database outage');
  for (const operation of [
    (pool) => getAdminEmailQueueMessageById(pool, messageId),
    (pool) => listAdminEmailQueue(pool)
  ]) {
    await assert.rejects(
      operation(scriptedPool([{ ...presence(), error: failure }])),
      (error) => error === failure
    );
  }
  await assert.rejects(
    getAdminEmailQueueMessageById(
      scriptedPool([
        presence(),
        { sql: /WHERE id = \$1::uuid/, error: failure }
      ]),
      messageId
    ),
    (error) => error === failure
  );
  for (const failedQuery of ['messages', 'summary']) {
    const steps = [
      presence(),
      {
        sql: /FROM email_messages/,
        error: failedQuery === 'messages' ? failure : undefined
      },
      {
        sql: /WITH counts AS/,
        error: failedQuery === 'summary' ? failure : undefined
      }
    ];
    await assert.rejects(
      listAdminEmailQueue(scriptedPool(steps)),
      (error) => error === failure
    );
    assert.equal(steps.length, 0);
  }
});
