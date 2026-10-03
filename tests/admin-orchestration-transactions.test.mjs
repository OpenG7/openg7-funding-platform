import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminPilotageService } from '../dist/apps/funding-api/src/admin-pilotage.service.js';
import { EditorialProgrammeService } from '../dist/apps/funding-api/src/editorial-programme.service.js';
import { PublicationAutomationService } from '../dist/apps/funding-api/src/publication-automation/service.js';

const actor = 'synthetic-operator';
const requestId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const reviewedAt = new Date('2030-01-01T12:00:00Z');
const uncertainReceipt = {
  request_id: requestId,
  action: 'publication.approve',
  target_id: targetId,
  status: 'uncertain',
  code: 'RESULT_UNKNOWN',
  reviewed_at: null
};
const acknowledgment = {
  requestId,
  confirmation: requestId,
  reason: 'Synthetic destination checked.'
};

const fixture = (failures = {}) => {
  const calls = [];
  const queries = [];
  let pending = [];
  let committed = [];
  const client = {
    async query(sql, values = []) {
      const phase = ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)
        ? sql
        : sql.startsWith('SELECT * FROM admin_command_receipts')
          ? 'read'
          : sql.startsWith('INSERT INTO admin_audit_log')
            ? 'audit'
            : sql.startsWith('UPDATE publication_editorial_profiles') ||
                sql.startsWith('UPDATE publication_feeds') ||
                sql.startsWith('UPDATE admin_command_receipts SET reviewed_at')
              ? 'write'
              : null;
      assert.ok(phase, `Unexpected fixture query: ${sql}`);
      calls.push(phase);
      queries.push({ phase, values });
      if (Object.hasOwn(failures, phase)) throw failures[phase];
      if (phase === 'BEGIN' || phase === 'ROLLBACK') pending = [];
      if (phase === 'COMMIT') {
        committed.push(...pending);
        pending = [];
      }
      if (phase === 'write' || phase === 'audit')
        pending.push({ phase, values });
      return {
        rowCount: 1,
        rows:
          phase === 'read'
            ? [{ ...uncertainReceipt }]
            : sql.startsWith('UPDATE admin_command_receipts SET reviewed_at')
              ? [{ ...uncertainReceipt, reviewed_at: reviewedAt }]
              : []
      };
    },
    release() {
      calls.push('release');
    }
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
    async query() {
      assert.fail('All operation queries must use the transaction client');
    }
  };
  return {
    pool,
    client,
    calls,
    queries,
    pending: () => pending,
    committed: () => committed
  };
};

const publications = (pool) => new PublicationAutomationService(pool, {}, {});
const scenarios = [
  {
    name: 'Editorial preferences',
    phases: ['write', 'audit'],
    run: (pool) =>
      new EditorialProgrammeService(pool, {}).preferences(
        'openg7:facebook',
        '1',
        ['concise'],
        actor
      ),
    verify(result, queries) {
      assert.equal(result, undefined);
      assert.deepEqual(queries.find((q) => q.phase === 'write').values, [
        'openg7:facebook',
        1,
        JSON.stringify(['concise'])
      ]);
      assert.deepEqual(queries.find((q) => q.phase === 'audit').values, [
        actor,
        'openg7:facebook',
        JSON.stringify({ preferences: ['concise'], version: 1 })
      ]);
    }
  },
  {
    name: 'Publication pause-all',
    phases: ['write', 'audit'],
    run: (pool) => publications(pool).command({ action: 'pause-all' }, actor),
    verify(result, queries) {
      assert.deepEqual(result, {});
      assert.deepEqual(queries.find((q) => q.phase === 'audit').values, [
        actor,
        'publication_automation.pause_all',
        'all',
        '{}',
        'publication_delivery'
      ]);
    }
  },
  {
    name: 'Pilotage incident acknowledgment',
    phases: ['read', 'write', 'audit'],
    run: (pool) =>
      new AdminPilotageService(pool, {}).acknowledgeReceipt(
        acknowledgment,
        actor
      ),
    verify(result, queries) {
      assert.deepEqual(result, {
        requestId,
        action: 'publication.approve',
        targetId,
        status: 'uncertain',
        code: 'RESULT_UNKNOWN',
        reviewedAt: reviewedAt.toISOString()
      });
      assert.deepEqual(queries.find((q) => q.phase === 'read').values, [
        requestId,
        actor
      ]);
      assert.deepEqual(queries.find((q) => q.phase === 'write').values, [
        requestId
      ]);
      assert.deepEqual(queries.find((q) => q.phase === 'audit').values, [
        actor,
        'pilotage.incident_reviewed',
        targetId,
        JSON.stringify({
          requestId,
          command: 'publication.approve',
          reason: acknowledgment.reason
        })
      ]);
    }
  }
];

for (const scenario of scenarios) {
  test(`${scenario.name} commits its mutation and audit before releasing once`, async () => {
    const db = fixture();
    const result = await scenario.run(db.pool);
    scenario.verify(result, db.queries);
    assert.deepEqual(db.calls, [
      'connect',
      'BEGIN',
      ...scenario.phases,
      'COMMIT',
      'release'
    ]);
    assert.deepEqual(
      db.committed().map((q) => q.phase),
      ['write', 'audit']
    );
    assert.deepEqual(db.pending(), []);
  });

  test(`${scenario.name} preserves failure cleanup and error precedence`, async (t) => {
    for (const phase of ['audit', 'COMMIT', 'ROLLBACK']) {
      await t.test(phase, async () => {
        const failure = new Error(`Synthetic ${phase} failure`);
        const db = fixture(
          phase === 'ROLLBACK'
            ? { audit: new Error('Synthetic audit failure'), ROLLBACK: failure }
            : { [phase]: failure }
        );
        await assert.rejects(
          scenario.run(db.pool),
          (error) => error === failure
        );
        assert.deepEqual(db.calls, [
          'connect',
          'BEGIN',
          ...scenario.phases,
          ...(phase === 'COMMIT' ? ['COMMIT'] : []),
          'ROLLBACK',
          'release'
        ]);
        assert.deepEqual(db.committed(), []);
        if (phase !== 'ROLLBACK') assert.deepEqual(db.pending(), []);
      });
    }
  });
}

test('publication commands keep a supplied client under caller transaction ownership', async () => {
  const db = fixture();
  await db.client.query('BEGIN');
  assert.deepEqual(
    await publications(db.pool).command(
      { action: 'pause-all' },
      actor,
      false,
      db.client
    ),
    {}
  );
  assert.deepEqual(db.calls, ['BEGIN', 'write', 'audit']);
  assert.deepEqual(db.committed(), []);
  assert.equal(db.pending().length, 2);
  await db.client.query('COMMIT');
  db.client.release();
  assert.deepEqual(
    db.committed().map((q) => q.phase),
    ['write', 'audit']
  );
  assert.deepEqual(db.calls, ['BEGIN', 'write', 'audit', 'COMMIT', 'release']);
});

test('a publication command failure leaves rollback and release to the supplied client owner', async () => {
  const failure = new Error('Synthetic caller-owned audit failure');
  const db = fixture({ audit: failure });
  await db.client.query('BEGIN');
  await assert.rejects(
    publications(db.pool).command(
      { action: 'pause-all' },
      actor,
      false,
      db.client
    ),
    (error) => error === failure
  );
  assert.deepEqual(db.calls, ['BEGIN', 'write', 'audit']);
  assert.equal(db.pending().length, 1);
  await db.client.query('ROLLBACK');
  db.client.release();
  assert.deepEqual(db.pending(), []);
  assert.deepEqual(db.committed(), []);
  assert.deepEqual(db.calls, [
    'BEGIN',
    'write',
    'audit',
    'ROLLBACK',
    'release'
  ]);
});
