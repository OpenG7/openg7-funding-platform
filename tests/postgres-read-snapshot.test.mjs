import assert from 'node:assert/strict';
import test from 'node:test';

import { readSnapshot } from '../dist/apps/funding-api/src/admin-cockpit/read.js';
import { withPostgresTransaction } from '../dist/apps/funding-api/src/postgres-transaction.js';
import { getSponsorshipProgress } from '../dist/apps/funding-api/src/sponsorship-progress.service.js';

const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const timeout = "SET LOCAL statement_timeout = '5000ms'";
const id = '10000000-0000-4000-8000-000000000401';
const now = new Date('2026-09-01T12:00:00Z');

const fixture = ({ respond = () => [], failures = {} } = {}) => {
  const calls = [];
  let active = false;
  const client = {
    async query(sql, parameters) {
      assert.equal(active, false, 'queries on the snapshot must be sequential');
      active = true;
      calls.push(sql);
      try {
        await Promise.resolve();
        if (Object.hasOwn(failures, sql)) throw failures[sql];
        const rows = respond(sql, parameters);
        return { rows, rowCount: rows.length };
      } finally {
        active = false;
      }
    },
    release() {
      calls.push('release');
      if (Object.hasOwn(failures, 'release')) throw failures.release;
    }
  };
  const pool = {
    async connect() {
      calls.push('connect');
      if (Object.hasOwn(failures, 'connect')) throw failures.connect;
      return client;
    },
    async query() {
      assert.fail('dossier reads must use the connected snapshot');
    }
  };
  return { calls, pool, client };
};

test('the shared transaction helper starts a read-only repeatable snapshot and resolves after cleanup', async () => {
  const { calls, pool, client } = fixture();
  const result = { version: 'snapshot-version' };
  assert.equal(
    await withPostgresTransaction(
      pool,
      async (connected) => {
        assert.equal(connected, client);
        await connected.query('SELECT snapshot_version');
        return result;
      },
      { readOnlySnapshot: true }
    ),
    result
  );
  assert.deepEqual(calls, [
    'connect',
    begin,
    'SELECT snapshot_version',
    'COMMIT',
    'release'
  ]);
});

test('cockpit snapshots keep their timeout and clean up acquisition, setup, read and commit failures', async (t) => {
  for (const [phase, expected] of [
    [
      null,
      [
        'connect',
        begin,
        timeout,
        'SELECT snapshot_version',
        'COMMIT',
        'release'
      ]
    ],
    ['connect', ['connect']],
    [begin, ['connect', begin, 'ROLLBACK', 'release']],
    [timeout, ['connect', begin, timeout, 'ROLLBACK', 'release']],
    [
      'SELECT snapshot_version',
      [
        'connect',
        begin,
        timeout,
        'SELECT snapshot_version',
        'ROLLBACK',
        'release'
      ]
    ],
    [
      'COMMIT',
      [
        'connect',
        begin,
        timeout,
        'SELECT snapshot_version',
        'COMMIT',
        'ROLLBACK',
        'release'
      ]
    ]
  ]) {
    await t.test(phase ?? 'success', async () => {
      const failure = new Error('Synthetic snapshot failure');
      const { calls, pool, client } = fixture({
        failures: phase === null ? {} : { [phase]: failure }
      });
      const result = { version: 'snapshot-version' };
      const completion = readSnapshot(pool, async (connected) => {
        assert.equal(connected, client);
        await connected.query('SELECT snapshot_version');
        return result;
      });
      if (phase === null) assert.equal(await completion, result);
      else await assert.rejects(completion, (error) => error === failure);
      assert.deepEqual(calls, expected);
    });
  }
});

test('cockpit snapshots retain rollback and release error precedence without retrying reads', async (t) => {
  for (const failedRelease of [false, true]) {
    await t.test(
      failedRelease ? 'release failure' : 'rollback failure',
      async () => {
        const original = new Error('Synthetic read failure');
        const rollback = new Error('Synthetic rollback failure');
        const release = new Error('Synthetic release failure');
        const { calls, pool } = fixture({
          failures: {
            'SELECT snapshot_version': original,
            ROLLBACK: rollback,
            ...(failedRelease ? { release } : {})
          }
        });
        await assert.rejects(
          readSnapshot(pool, (client) =>
            client.query('SELECT snapshot_version')
          ),
          (error) => error === (failedRelease ? release : rollback)
        );
        assert.deepEqual(calls, [
          'connect',
          begin,
          timeout,
          'SELECT snapshot_version',
          'ROLLBACK',
          'release'
        ]);
      }
    );
  }
});

const progressResponse = (sql, parameters) => {
  if (/AS available/.test(sql)) return [{ available: true }];
  if (/AS exists/.test(sql)) return [{ exists: true }];
  if (/AS has_publication_drafts/.test(sql))
    return [{ has_publication_drafts: true }];
  if (/AS amount_cents/.test(sql)) {
    assert.deepEqual(parameters, [3, 'DEMO-401']);
    return [
      {
        contribution_id: id,
        public_reference: 'DEMO-401',
        amount_cents: '50000',
        currency: 'cad',
        payment_status: 'paid',
        paid_at: now.toISOString(),
        updated_at: now.toISOString(),
        sponsor_details_submitted_at: now.toISOString(),
        has_company_name: true,
        has_contact_email: true,
        has_website: false,
        has_logo: false,
        has_supporting_image: false,
        sponsor_review_status: 'pending_review',
        sponsor_feed_status: 'not_planned',
        sponsor_feed_target: null,
        sponsor_feed_channels: [],
        sponsorship_refund_status: 'not_requested'
      }
    ];
  }
  if (/AS recipient/.test(sql)) {
    assert.deepEqual(parameters, [id]);
    return [{ recipient: 'private@example.invalid', consent: true }];
  }
  if (/AS "websiteVisible"/.test(sql)) {
    assert.deepEqual(parameters, [id]);
    return [
      {
        companyName: 'Demo',
        amountMinor: 50000,
        refundId: null,
        refundAmountMinor: null,
        refundError: false,
        requiresInvoice: true,
        websiteVisible: false,
        websiteHeld: true,
        websiteVersion: 'snapshot-version'
      }
    ];
  }
  if (/FROM contribution_activity/.test(sql)) {
    assert.deepEqual(parameters, [id]);
    return [{ id: 'activity-401' }];
  }
  return [];
};

test('progress reads the public reference and every canonical dossier fact on one sequential snapshot', async () => {
  const { calls, pool } = fixture({ respond: progressResponse });
  const result = await getSponsorshipProgress(pool, 'DEMO-401', now);
  assert.equal(result.status, 'ok');
  assert.equal(result.generatedAt, now.toISOString());
  assert.equal(result.dossier.contributionId, id);
  assert.equal(result.dossier.reference, 'DEMO-401');
  assert.equal(result.dossier.preparationActivityId, 'activity-401');
  assert.equal(result.dossier.website.version, 'snapshot-version');
  assert.equal(result.dossier.amountMinor, 50000);
  assert.equal(result.dossier.currency, 'CAD');
  assert.ok(!JSON.stringify(result).includes('private@example.invalid'));
  assert.deepEqual(calls.slice(0, 2), ['connect', begin]);
  assert.deepEqual(calls.slice(-2), ['COMMIT', 'release']);
  assert.ok(
    calls.slice(2, -2).every((sql) => /^(SELECT|WITH)\b/.test(sql.trim())),
    'opening the dossier issues only reads'
  );
});

test('an absent dossier commits an empty read and releases its connection', async () => {
  const { calls, pool } = fixture({
    respond: (sql) =>
      /AS available/.test(sql)
        ? [{ available: true }]
        : /AS exists/.test(sql)
          ? [{ exists: true }]
          : []
  });
  assert.deepEqual(await getSponsorshipProgress(pool, id, now), {
    generatedAt: now.toISOString(),
    dossier: null,
    status: 'not_found'
  });
  assert.deepEqual(calls.slice(-2), ['COMMIT', 'release']);
  assert.ok(!calls.some((sql) => /FROM contribution_activity/.test(sql)));
  assert.ok(!calls.includes('ROLLBACK'));
});

test('progress rolls back a late dossier failure without returning a partial projection', async () => {
  const failure = new Error('Synthetic activity read failure');
  const { calls, pool } = fixture({
    respond: (sql, parameters) => {
      if (/FROM contribution_activity/.test(sql)) throw failure;
      return progressResponse(sql, parameters);
    }
  });
  await assert.rejects(
    getSponsorshipProgress(pool, 'DEMO-401', now),
    (error) => error === failure
  );
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'release']);
  assert.ok(!calls.includes('COMMIT'));
});
