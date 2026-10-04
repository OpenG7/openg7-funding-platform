import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminPilotageReceipts } from '../dist/apps/funding-api/src/admin-pilotage/receipts.js';
import { PilotError } from '../dist/apps/funding-api/src/admin-pilotage/errors.js';
import { PublicationAutomationError } from '../dist/apps/funding-api/src/publication-automation/policy.js';

const actor = 'synthetic-operator';
const requestId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const command = {
  requestId,
  action: 'publication.approve',
  targetId,
  version: '1',
  confirmation: targetId
};

// Model receipt transactions and their audits; business execution stays behind its port.
const fixture = ({ failures = {}, schema = true, execute } = {}) => {
  const calls = [];
  const executions = [];
  let now = new Date('2030-01-01T12:00:00Z');
  let committed = { receipt: null, audits: [] };
  let transactionNumber = 0;
  const record = (phase, transaction = 0) => {
    calls.push(phase);
    const failure = failures[`${phase}.${transaction}`] ?? failures[phase];
    if (failure) throw failure;
  };
  const query = async (sql, values, state, transaction = 0) => {
    if (sql.includes('to_regclass')) {
      record('schema');
      return { rows: [{ profiles: schema, observations: schema }] };
    }
    if (sql.startsWith('INSERT INTO admin_audit_log')) {
      record(values[1], transaction);
      state.audits.push({
        actor: values[0],
        action: values[1],
        target: values[2],
        metadata: JSON.parse(values[3])
      });
      return { rows: [], rowCount: 1 };
    }
    assert.ok(sql.includes('admin_command_receipts'));
    if (sql.startsWith('INSERT')) {
      record('claim', transaction);
      if (state.receipt) return { rows: [], rowCount: 0 };
      state.receipt = {
        request_id: values[0],
        actor: values[1],
        action: values[2],
        target_id: values[3],
        request_hash: values[4],
        status: 'executing',
        code: null,
        reviewed_at: null,
        created_at: now
      };
      return { rows: [{ ...state.receipt }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT')) {
      record('read', transaction);
      const row = state.receipt;
      return {
        rows:
          row?.request_id === values[0] &&
          (values.length === 1 || row.actor === values[1])
            ? [{ ...row }]
            : []
      };
    }
    assert.ok(sql.startsWith('UPDATE'));
    const row = state.receipt;
    if (sql.includes('SET reviewed_at')) {
      record('review', transaction);
      row.reviewed_at = now;
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (values.length === 3) {
      record('persist', transaction);
      row.status = values[1];
      row.code = values[2];
    } else {
      record('expire');
      if (
        row?.request_id === values[0] &&
        row.actor === values[1] &&
        row.status === 'executing' &&
        row.created_at < new Date(now.getTime() - 120_000)
      ) {
        row.status = 'uncertain';
        row.code = 'RESULT_UNKNOWN';
      }
    }
    return { rows: [], rowCount: 1 };
  };
  const pool = {
    query: (sql, values) => query(sql, values, committed),
    async connect() {
      record('connect');
      const transaction = ++transactionNumber;
      let pending;
      return {
        async query(sql, values = []) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
            record(sql, transaction);
            if (sql === 'BEGIN') pending = structuredClone(committed);
            if (sql === 'COMMIT') committed = pending;
            if (sql === 'ROLLBACK') pending = null;
            return { rows: [] };
          }
          return query(sql, values, pending, transaction);
        },
        release() {
          record('release');
        }
      };
    }
  };
  const receipts = new AdminPilotageReceipts(pool, async (...args) => {
    record('execute');
    executions.push(args);
    return execute ? execute(...args) : 'SCHEDULED';
  });
  return {
    receipts,
    calls,
    executions,
    state: () => committed,
    advance: (milliseconds) => {
      now = new Date(now.getTime() + milliseconds);
    }
  };
};

test('access, parsing and editorial schema checks happen before a receipt claim', async () => {
  const db = fixture({ schema: false });
  await assert.rejects(db.receipts.command(null, actor, false), {
    code: 'READ_ONLY',
    status: 403
  });
  await assert.rejects(db.receipts.command(null, actor), {
    code: 'INVALID_COMMAND',
    status: 400
  });
  await assert.rejects(
    db.receipts.command(
      {
        ...command,
        action: 'project.publish',
        targetId: '1',
        confirmation: '1'
      },
      actor,
      true,
      false
    ),
    { code: 'READ_ONLY', status: 403 }
  );
  assert.deepEqual(db.calls, []);
  await assert.rejects(
    db.receipts.command({ ...command, action: 'publication.repair' }, actor),
    { code: 'PROGRAMME_UNAVAILABLE', status: 503 }
  );
  assert.deepEqual(db.calls, ['schema']);
  assert.equal(db.state().receipt, null);
  assert.deepEqual(db.executions, []);
});

test('the execution port receives only the canonical command and actor after claim commit', async () => {
  const db = fixture();
  const result = await db.receipts.command(command, actor);
  assert.deepEqual(db.executions, [[command, actor]]);
  assert.deepEqual(result, {
    requestId,
    action: command.action,
    targetId,
    status: 'completed',
    code: 'SCHEDULED'
  });
  assert.deepEqual(db.calls, [
    'connect',
    'BEGIN',
    'claim',
    'pilotage.requested',
    'COMMIT',
    'release',
    'execute',
    'connect',
    'BEGIN',
    'persist',
    'pilotage.completed',
    'COMMIT',
    'release'
  ]);
  assert.deepEqual(db.state().audits, [
    {
      actor,
      action: 'pilotage.requested',
      target: targetId,
      metadata: { requestId, command: command.action }
    },
    {
      actor,
      action: 'pilotage.completed',
      target: targetId,
      metadata: { requestId, command: command.action, code: 'SCHEDULED' }
    }
  ]);
  await assert.rejects(
    db.receipts.acknowledgeReceipt(
      {
        requestId,
        confirmation: requestId,
        reason: 'Synthetic record checked.'
      },
      actor
    ),
    { code: 'RECEIPT_NOT_UNCERTAIN' }
  );
  assert.equal(db.state().audits.length, 2);
});

test('a reordered replay returns the receipt while actor or content conflicts never execute', async () => {
  const db = fixture();
  await db.receipts.command(command, actor);
  const replay = await db.receipts.command(
    Object.fromEntries(Object.entries(command).reverse()),
    actor
  );
  assert.equal(replay.status, 'completed');
  assert.equal(replay.code, 'SCHEDULED');
  await assert.rejects(db.receipts.command(command, 'another-operator'), {
    code: 'REQUEST_CONFLICT'
  });
  await assert.rejects(
    db.receipts.command({ ...command, version: '2' }, actor),
    { code: 'REQUEST_CONFLICT' }
  );
  assert.equal(
    await db.receipts.readReceipt(requestId, 'another-operator'),
    null
  );
  assert.equal(db.executions.length, 1);
  assert.equal(db.state().audits.length, 2);
});

test('known execution errors fail; unknown errors remain uncertain without leaking their message', async (t) => {
  for (const [error, status, code] of [
    [new PilotError('VERSION_CONFLICT'), 'failed', 'VERSION_CONFLICT'],
    [
      new PublicationAutomationError('REVIEW_REQUIRED'),
      'failed',
      'REVIEW_REQUIRED'
    ],
    [
      Object.assign(new Error('Synthetic private detail'), {
        code: 'PRIVATE_DETAIL'
      }),
      'uncertain',
      'RESULT_UNKNOWN'
    ]
  ]) {
    await t.test(code, async () => {
      const db = fixture({
        execute: async () => {
          throw error;
        }
      });
      const result = await db.receipts.command(command, actor);
      assert.equal(result.status, status);
      assert.equal(result.code, code);
      assert.equal(db.state().receipt.status, status);
      assert.equal(db.state().audits[1].metadata.code, code);
      assert.equal((await db.receipts.command(command, actor)).status, status);
      assert.equal(db.executions.length, 1);
      assert.equal(
        JSON.stringify(db.state()).includes('Synthetic private detail'),
        false
      );
    });
  }
});

test('claim persistence or audit failure rolls back and never calls execution', async (t) => {
  for (const phase of ['claim', 'pilotage.requested', 'COMMIT.1']) {
    await t.test(phase, async () => {
      const failure = new Error(`Synthetic ${phase} failure`);
      const db = fixture({ failures: { [phase]: failure } });
      await assert.rejects(
        db.receipts.command(command, actor),
        (error) => error === failure
      );
      assert.equal(db.state().receipt, null);
      assert.deepEqual(db.state().audits, []);
      assert.deepEqual(db.executions, []);
      assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
    });
  }
});

test('result persistence or audit failure rejects and recovery never repeats execution', async (t) => {
  for (const phase of ['persist', 'pilotage.completed', 'COMMIT.2']) {
    await t.test(phase, async () => {
      const failure = new Error(`Synthetic ${phase} failure`);
      const db = fixture({ failures: { [phase]: failure } });
      await assert.rejects(
        db.receipts.command(command, actor),
        (error) => error === failure
      );
      assert.equal(db.state().receipt.status, 'executing');
      assert.deepEqual(
        db.state().audits.map((entry) => entry.action),
        ['pilotage.requested']
      );
      assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
      assert.equal(
        (await db.receipts.command(command, actor)).status,
        'executing'
      );
      db.advance(120_001);
      const recovered = await db.receipts.command(command, actor);
      assert.equal(recovered.status, 'uncertain');
      assert.equal(recovered.code, 'RESULT_UNKNOWN');
      assert.equal(db.executions.length, 1);
    });
  }
});

test('reading expires only the author’s receipt strictly older than two minutes', async () => {
  const failure = new Error('Synthetic result persistence failure');
  const db = fixture({ failures: { persist: failure } });
  await assert.rejects(
    db.receipts.command(command, actor),
    (error) => error === failure
  );
  const before = db.calls.length;
  await assert.rejects(db.receipts.readReceipt('invalid', actor), {
    code: 'INVALID_REQUEST',
    status: 400
  });
  assert.equal(db.calls.length, before);
  assert.equal(
    (await db.receipts.readReceipt(requestId, actor)).status,
    'executing'
  );
  db.advance(120_000);
  assert.equal(
    (await db.receipts.readReceipt(requestId, actor)).status,
    'executing'
  );
  db.advance(1);
  assert.equal(
    await db.receipts.readReceipt(requestId, 'another-operator'),
    null
  );
  assert.equal(db.state().receipt.status, 'executing');
  const result = await db.receipts.readReceipt(requestId, actor);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'RESULT_UNKNOWN');
  assert.equal(db.executions.length, 1);
});

test('an incident acknowledgment stays uncertain, is actor-bound and never executes again', async () => {
  const db = fixture({
    execute: async () => {
      throw new Error('Synthetic interruption');
    }
  });
  await db.receipts.command(command, actor);
  const input = {
    requestId,
    confirmation: requestId,
    reason: '  Synthetic record and audit checked.  '
  };
  const before = db.calls.length;
  for (const invalid of [
    { ...input, confirmation: targetId },
    { ...input, reason: 'Short' },
    { ...input, unexpected: true }
  ])
    await assert.rejects(db.receipts.acknowledgeReceipt(invalid, actor), {
      code: 'INVALID_COMMAND',
      status: 400
    });
  assert.equal(db.calls.length, before);
  await assert.rejects(
    db.receipts.acknowledgeReceipt(input, 'another-operator'),
    {
      code: 'RECEIPT_NOT_UNCERTAIN'
    }
  );
  const result = await db.receipts.acknowledgeReceipt(input, actor);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'RESULT_UNKNOWN');
  assert.equal(result.reviewedAt, '2030-01-01T12:00:00.000Z');
  assert.deepEqual(await db.receipts.acknowledgeReceipt(input, actor), result);
  assert.equal((await db.receipts.command(command, actor)).status, 'uncertain');
  assert.equal(db.executions.length, 1);
  const reviews = db
    .state()
    .audits.filter((entry) => entry.action === 'pilotage.incident_reviewed');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].metadata.reason, input.reason.trim());
});
