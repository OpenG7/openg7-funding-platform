import assert from 'node:assert/strict';
import test from 'node:test';

import { pilotageVersion } from '../dist/apps/funding-api/src/admin-pilotage-version.js';
import { PilotError } from '../dist/apps/funding-api/src/admin-pilotage/errors.js';
import { AdminPilotageExecution } from '../dist/apps/funding-api/src/admin-pilotage/execution.js';

const actor = 'synthetic-operator';
const targetId = '22222222-2222-4222-8222-222222222222';
const command = (action, payload, target = targetId, version = '2') => ({
  requestId: '11111111-1111-4111-8111-111111111111',
  action,
  targetId: target,
  version,
  confirmation: target,
  ...(payload ? { payload } : {})
});
const unavailablePool = {
  async connect() {
    assert.fail('Delegated commands must use their domain service');
  },
  async query() {
    assert.fail('Delegated commands must use their domain service');
  }
};
const recordingPorts = (calls) => {
  const record =
    (method) =>
    async (...args) => {
      calls.push({ method, args });
    };
  return {
    editorial: {
      apply: record('editorial.apply'),
      preferences: record('editorial.preferences'),
      editWithIntent: record('editorial.editWithIntent')
    },
    publications: {
      repair: record('publications.repair'),
      command: record('publications.command'),
      state: record('publications.state')
    }
  };
};

const moves = [
  { id: targetId, version: 2, scheduledAt: '2030-01-02T12:00:00Z' }
];
const preferences = ['concise'];
const approveSponsors = [{ id: targetId, version: 'synthetic-version' }];
const editPayload = {
  message: 'Synthetic exact publication text',
  scheduledAt: '2030-01-02T12:00:00Z',
  mediaId: null
};
const intentCommand = command('publication.edit', {
  ...editPayload,
  editorialIntent: 'concise'
});
const dispatches = [
  {
    command: command('programme.apply', { moves }, 'openg7:facebook'),
    code: 'REVIEW_REQUIRED',
    method: 'editorial.apply',
    args: ['openg7:facebook', '2', moves, actor]
  },
  {
    command: command(
      'editorial.preferences',
      { preferences },
      'openg7:facebook'
    ),
    code: 'SAVED',
    method: 'editorial.preferences',
    args: ['openg7:facebook', '2', preferences, actor]
  },
  {
    command: command('publication.repair'),
    code: 'REVIEW_REQUIRED',
    method: 'publications.repair',
    args: [targetId, '2', actor]
  },
  {
    command: intentCommand,
    code: 'REVIEW_REQUIRED',
    method: 'editorial.editWithIntent',
    args: [intentCommand, actor]
  },
  {
    command: command('publication.edit', editPayload),
    code: 'SAVED',
    method: 'publications.command',
    args: [{ action: 'edit', id: targetId, version: 2, ...editPayload }, actor]
  },
  {
    command: command('publication.approve', { approveSponsors }),
    code: 'SCHEDULED',
    method: 'publications.command',
    args: [
      {
        action: 'approve',
        id: targetId,
        version: 2,
        confirmation: targetId,
        approveSponsors
      },
      actor
    ]
  },
  {
    command: command('publication.reject'),
    code: 'REJECTED',
    method: 'publications.command',
    args: [
      { action: 'reject', id: targetId, version: 2, confirmation: targetId },
      actor
    ]
  }
];

for (const scenario of dispatches) {
  test(`${scenario.command.action} delegates exact inputs and preserves its result`, async () => {
    const calls = [];
    const execution = new AdminPilotageExecution(
      unavailablePool,
      recordingPorts(calls)
    );
    assert.equal(
      await execution.execute(scenario.command, actor),
      scenario.code
    );
    assert.deepEqual(calls, [{ method: scenario.method, args: scenario.args }]);
  });
}

test('delegated failures propagate without a success result', async () => {
  const failure = new Error('Synthetic domain failure');
  const ports = recordingPorts([]);
  ports.publications.repair = async () => {
    throw failure;
  };
  const execution = new AdminPilotageExecution(unavailablePool, ports);
  await assert.rejects(
    execution.execute(command('publication.repair'), actor),
    (error) => error === failure
  );
});

test('publication dispatch rejects invalid numeric versions before invoking its domain', async () => {
  const calls = [];
  const execution = new AdminPilotageExecution(
    unavailablePool,
    recordingPorts(calls)
  );
  for (const version of ['0', '-1', '1.5', '9007199254740992', 'synthetic']) {
    await assert.rejects(
      execution.execute(
        command('publication.reject', undefined, targetId, version),
        actor
      ),
      (error) =>
        error instanceof PilotError &&
        error.code === 'INVALID_COMMAND' &&
        error.status === 400
    );
  }
  assert.deepEqual(calls, []);
});

const feed = {
  id: 'openg7:facebook',
  paused: false,
  autoPrepare: true,
  timezone: 'America/Toronto',
  weekdays: [1, 3, 5],
  localTime: '09:00',
  capacity: 2,
  horizonDays: 7,
  connection: 'ready',
  checkedAt: '2030-01-01T12:00:00.000Z'
};
const lockedFeed = {
  id: feed.id,
  paused: feed.paused,
  auto_prepare: feed.autoPrepare,
  timezone: feed.timezone,
  weekdays: feed.weekdays,
  local_time: '09:00:00',
  capacity: feed.capacity,
  horizon_days: feed.horizonDays,
  connection: feed.connection,
  checked_at: new Date(feed.checkedAt)
};
const transactionFixture = ({
  auditFailure,
  rowCount = 1,
  row = lockedFeed
} = {}) => {
  const calls = [];
  const queries = [];
  let pending = [];
  let committed = [];
  const client = {
    async query(sql, values = []) {
      const phase = ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)
        ? sql
        : sql.startsWith('SELECT * FROM publication_feeds')
          ? 'lock'
          : sql.startsWith('INSERT INTO admin_audit_log')
            ? 'audit'
            : sql.startsWith('UPDATE publication_feeds') ||
                sql.startsWith('UPDATE email_messages')
              ? 'write'
              : null;
      assert.ok(phase, `Unexpected fixture query: ${sql}`);
      calls.push(phase);
      queries.push({ phase, values });
      if (phase === 'audit' && auditFailure) throw auditFailure;
      if (phase === 'BEGIN' || phase === 'ROLLBACK') pending = [];
      if (phase === 'COMMIT') {
        committed.push(...pending);
        pending = [];
      }
      if (phase === 'write' && rowCount) pending.push({ phase, values });
      if (phase === 'audit') pending.push({ phase, values });
      return { rowCount, rows: phase === 'lock' ? [row] : [] };
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
      assert.fail('Mutation and audit must use the transaction client');
    }
  };
  const ports = recordingPorts([]);
  ports.publications.state = async () => {
    calls.push('state');
    return { feeds: [feed] };
  };
  return {
    execution: new AdminPilotageExecution(pool, ports),
    calls,
    queries,
    pending: () => pending,
    committed: () => committed
  };
};
const mutations = [
  {
    command: command('feed.pause', undefined, feed.id, pilotageVersion(feed)),
    phases: ['state', 'connect', 'BEGIN', 'lock', 'write', 'audit'],
    values: [feed.id, true],
    auditAction: 'pilotage.feed.pause',
    code: 'SAVED'
  },
  {
    command: command('feed.resume', undefined, feed.id, pilotageVersion(feed)),
    phases: ['state', 'connect', 'BEGIN', 'lock', 'write', 'audit'],
    values: [feed.id, false],
    auditAction: 'pilotage.feed.resume',
    code: 'SAVED'
  },
  {
    command: command(
      'email.retry',
      undefined,
      targetId,
      'synthetic-email-version'
    ),
    phases: ['connect', 'BEGIN', 'write', 'audit'],
    values: [targetId, 'synthetic-email-version'],
    auditAction: 'pilotage.email.retry_queued',
    code: 'EMAIL_QUEUED'
  }
];

for (const scenario of mutations) {
  test(`${scenario.command.action} commits mutation and audit together before returning`, async () => {
    const db = transactionFixture();
    assert.equal(
      await db.execution.execute(scenario.command, actor),
      scenario.code
    );
    assert.deepEqual(db.calls, [...scenario.phases, 'COMMIT', 'release']);
    assert.deepEqual(db.committed(), [
      { phase: 'write', values: scenario.values },
      {
        phase: 'audit',
        values: [actor, scenario.auditAction, scenario.command.targetId, '{}']
      }
    ]);
    assert.deepEqual(db.pending(), []);
  });

  test(`${scenario.command.action} rolls back its mutation when audit fails`, async () => {
    const failure = new Error('Synthetic audit failure');
    const db = transactionFixture({ auditFailure: failure });
    await assert.rejects(
      db.execution.execute(scenario.command, actor),
      (error) => error === failure
    );
    assert.deepEqual(db.calls, [...scenario.phases, 'ROLLBACK', 'release']);
    assert.deepEqual(db.pending(), []);
    assert.deepEqual(db.committed(), []);
  });
}

test('feed version conflicts reject before claiming a transaction', async () => {
  const db = transactionFixture();
  await assert.rejects(
    db.execution.execute(
      command('feed.pause', undefined, feed.id, 'stale'),
      actor
    ),
    (error) => error instanceof PilotError && error.code === 'VERSION_CONFLICT'
  );
  assert.deepEqual(db.calls, ['state']);
});

test('feed changed after projection is rejected under its lock before mutation', async () => {
  const db = transactionFixture({ row: { ...lockedFeed, capacity: 3 } });
  await assert.rejects(
    db.execution.execute(
      command('feed.pause', undefined, feed.id, pilotageVersion(feed)),
      actor
    ),
    (error) => error instanceof PilotError && error.code === 'VERSION_CONFLICT'
  );
  assert.deepEqual(db.calls, [
    'state',
    'connect',
    'BEGIN',
    'lock',
    'ROLLBACK',
    'release'
  ]);
  assert.deepEqual(db.committed(), []);
});

test('an email changed before retry is rejected without audit or queue mutation', async () => {
  const db = transactionFixture({ rowCount: 0 });
  await assert.rejects(
    db.execution.execute(command('email.retry'), actor),
    (error) => error instanceof PilotError && error.code === 'VERSION_CONFLICT'
  );
  assert.deepEqual(db.calls, [
    'connect',
    'BEGIN',
    'write',
    'ROLLBACK',
    'release'
  ]);
  assert.deepEqual(db.pending(), []);
  assert.deepEqual(db.committed(), []);
});
