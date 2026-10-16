import assert from 'node:assert/strict';
import test from 'node:test';

import { withPostgresTransaction } from '../dist/apps/funding-api/src/postgres-transaction.js';
import { observePostgresTransactions } from './integration/support/disposable-postgres.mjs';

const fixture = (failures = {}) => {
  const calls = [];
  const result = { status: 'unchanged' };
  const client = {
    async query(command) {
      calls.push(command);
      if (Object.hasOwn(failures, command)) throw failures[command];
      return { rows: [], rowCount: 0 };
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
    }
  };
  const operation = async (connected) => {
    assert.equal(connected, client);
    calls.push('operation');
    if (Object.hasOwn(failures, 'operation')) throw failures.operation;
    return result;
  };
  return { calls, client, pool, operation, result };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

test('the transaction observer attributes only its caller clients and forwards queries unchanged', async () => {
  const f = fixture();
  const queryResult = { rows: [{ source: 'synthetic unrelated activity' }] };
  f.pool.query = async (...args) => {
    f.calls.push(args);
    return queryResult;
  };
  const observed = observePostgresTransactions(f.pool);
  const parameters = ['synthetic'];
  assert.equal(
    await observed.pool.query('SELECT $1::text', parameters),
    queryResult
  );
  assert.deepEqual(f.calls.at(-1), ['SELECT $1::text', parameters]);

  // Background work and fixture setup never use the service's wrapped clients.
  await f.client.query('BEGIN');
  assert.equal(observed.openTransactions, 0);
  await f.client.query('ROLLBACK');
  const client = await observed.pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(observed.openTransactions, 1);
  await client.query('ROLLBACK');
  assert.equal(observed.openTransactions, 0);
  client.release();
  assert.equal(f.calls.at(-1), 'release');
});

test('the transaction observer retains an open transaction until commit or rollback is acknowledged', async (t) => {
  for (const command of ['COMMIT', 'ROLLBACK']) {
    await t.test(command, async () => {
      const f = fixture();
      const observed = observePostgresTransactions(f.pool);
      const started = deferred();
      const acknowledged = deferred();
      const query = f.client.query.bind(f.client);
      f.client.query = async (sql) => {
        const result = await query(sql);
        if (sql === command) {
          started.resolve();
          await acknowledged.promise;
        }
        return result;
      };
      const completion = withPostgresTransaction(
        observed.pool,
        async () => {
          assert.equal(observed.openTransactions, 1);
        },
        { shouldCommit: () => command === 'COMMIT' }
      );
      await started.promise;
      assert.equal(observed.openTransactions, 1);
      acknowledged.resolve();
      await completion;
      assert.equal(observed.openTransactions, 0);
    });
  }
});

test('a failed transaction close and client release never clear the observer prematurely', async (t) => {
  for (const command of ['COMMIT', 'ROLLBACK']) {
    await t.test(command, async () => {
      const f = fixture({
        [command]: new Error('Synthetic unacknowledged close')
      });
      const observed = observePostgresTransactions(f.pool);
      const client = await observed.pool.connect();
      await client.query('BEGIN');
      await assert.rejects(client.query(command));
      assert.equal(observed.openTransactions, 1);
      client.release();
      assert.equal(observed.openTransactions, 1);
    });
  }
});

test('a successful transaction returns the unchanged result after committing and releasing once', async () => {
  const { calls, pool, operation, result } = fixture();
  assert.equal(await withPostgresTransaction(pool, operation), result);
  assert.deepEqual(calls, [
    'connect',
    'BEGIN',
    'operation',
    'COMMIT',
    'release'
  ]);
});

test('a writable repeatable snapshot rolls back a serialization conflict without replaying the operation', async () => {
  const conflict = Object.assign(new Error('Synthetic concurrent change'), {
    code: '40001'
  });
  const f = fixture({ operation: conflict });
  await assert.rejects(
    withPostgresTransaction(f.pool, f.operation, { repeatableRead: true }),
    conflict
  );
  assert.deepEqual(f.calls, [
    'connect',
    'BEGIN ISOLATION LEVEL REPEATABLE READ',
    'operation',
    'ROLLBACK',
    'release'
  ]);
});

test('rollback confirmation is reported only after acknowledgement, never after connection loss or commit success', async (t) => {
  for (const scenario of [
    { failures: {}, confirmed: false },
    {
      failures: { connect: new Error('Synthetic connection failure') },
      confirmed: false
    },
    {
      failures: { operation: new Error('Synthetic operation failure') },
      confirmed: true
    },
    {
      failures: { COMMIT: new Error('Synthetic commit failure') },
      confirmed: true
    },
    {
      failures: {
        COMMIT: new Error('Synthetic commit failure'),
        ROLLBACK: new Error('Synthetic lost connection')
      },
      confirmed: false
    }
  ]) {
    await t.test(JSON.stringify(Object.keys(scenario.failures)), async () => {
      const f = fixture(scenario.failures);
      let confirmed = false;
      const completion = withPostgresTransaction(f.pool, f.operation, {
        preserveOriginalError: true,
        onRollbackConfirmed: () => {
          assert.equal(f.calls.at(-1), 'ROLLBACK');
          confirmed = true;
        }
      });
      if (Object.keys(scenario.failures).length)
        await assert.rejects(completion);
      else await completion;
      assert.equal(confirmed, scenario.confirmed);
    });
  }
});

test('connection, begin, callback and commit failures preserve error identity and cleanup order', async (t) => {
  for (const [phase, expectedCalls] of [
    ['connect', ['connect']],
    ['BEGIN', ['connect', 'BEGIN', 'ROLLBACK', 'release']],
    ['operation', ['connect', 'BEGIN', 'operation', 'ROLLBACK', 'release']],
    [
      'COMMIT',
      ['connect', 'BEGIN', 'operation', 'COMMIT', 'ROLLBACK', 'release']
    ]
  ]) {
    await t.test(phase, async () => {
      const failure = new Error(`Synthetic ${phase} failure`);
      const { calls, pool, operation } = fixture({ [phase]: failure });
      await assert.rejects(
        withPostgresTransaction(pool, operation),
        (error) => error === failure
      );
      assert.deepEqual(calls, expectedCalls);
    });
  }
});

test('a synchronously thrown callback error is rolled back without retry or wrapping', async () => {
  const failure = new Error('Synthetic callback failure');
  const { calls, pool } = fixture();
  await assert.rejects(
    withPostgresTransaction(pool, () => {
      calls.push('operation');
      throw failure;
    }),
    (error) => error === failure
  );
  assert.deepEqual(calls, [
    'connect',
    'BEGIN',
    'operation',
    'ROLLBACK',
    'release'
  ]);
});

test('a declined result rolls back earlier writes and stays pending until cleanup finishes', async () => {
  const { calls, client, pool, result } = fixture();
  const rollbackStarted = deferred();
  const rollbackPermit = deferred();
  let persisted = 'original';
  let staged = persisted;
  const query = client.query.bind(client);
  client.query = async (command) => {
    const response = await query(command);
    if (command === 'WRITE') staged = 'changed';
    if (command === 'COMMIT') persisted = staged;
    if (command === 'ROLLBACK') {
      rollbackStarted.resolve();
      await rollbackPermit.promise;
      staged = persisted;
    }
    return response;
  };
  let settled = false;
  const completion = withPostgresTransaction(
    pool,
    async (connected) => {
      await connected.query('WRITE');
      return result;
    },
    { shouldCommit: () => false }
  ).then((value) => {
    settled = true;
    calls.push('resolved');
    return value;
  });

  await rollbackStarted.promise;
  assert.equal(settled, false);
  assert.equal(staged, 'changed');
  assert.equal(persisted, 'original');
  assert.deepEqual(calls, ['connect', 'BEGIN', 'WRITE', 'ROLLBACK']);

  rollbackPermit.resolve();
  assert.equal(await completion, result);
  assert.equal(staged, 'original');
  assert.equal(persisted, 'original');
  assert.deepEqual(calls, [
    'connect',
    'BEGIN',
    'WRITE',
    'ROLLBACK',
    'release',
    'resolved'
  ]);
});

test('a failed result rollback rejects without returning the declined result or retrying rollback', async () => {
  const failure = new Error('Synthetic rollback failure');
  const { calls, pool, operation } = fixture({ ROLLBACK: failure });
  await assert.rejects(
    withPostgresTransaction(pool, operation, {
      shouldCommit: () => false,
      preserveOriginalError: true
    }),
    (error) => error === failure
  );
  assert.deepEqual(calls, [
    'connect',
    'BEGIN',
    'operation',
    'ROLLBACK',
    'release'
  ]);
});

test('an opt-in transaction preserves its original failure when rollback also fails', async (t) => {
  for (const phase of ['BEGIN', 'operation', 'COMMIT']) {
    await t.test(phase, async () => {
      const original = new Error(`Synthetic ${phase} failure`);
      const { calls, pool, operation } = fixture({
        [phase]: original,
        ROLLBACK: new Error('Synthetic rollback failure')
      });
      await assert.rejects(
        withPostgresTransaction(pool, operation, {
          preserveOriginalError: true
        }),
        (error) => error === original
      );
      assert.equal(calls.filter((call) => call === 'ROLLBACK').length, 1);
      assert.equal(calls.at(-1), 'release');
    });
  }
});

test('a failed rollback retains the existing error precedence and still releases the client', async (t) => {
  for (const phase of ['BEGIN', 'operation', 'COMMIT']) {
    await t.test(phase, async () => {
      const original = new Error(`Synthetic ${phase} failure`);
      const rollback = new Error('Synthetic rollback failure');
      const { calls, pool, operation } = fixture({
        [phase]: original,
        ROLLBACK: rollback
      });
      await assert.rejects(
        withPostgresTransaction(pool, operation),
        (error) => error === rollback
      );
      const expected = ['connect', 'BEGIN'];
      if (phase !== 'BEGIN') expected.push('operation');
      if (phase === 'COMMIT') expected.push('COMMIT');
      expected.push('ROLLBACK', 'release');
      assert.deepEqual(calls, expected);
    });
  }
});

test('a failed release rejects even after commit and keeps its existing precedence over rollback failures', async (t) => {
  for (const phase of [null, 'operation', 'ROLLBACK']) {
    await t.test(phase ?? 'success', async () => {
      const release = new Error('Synthetic release failure');
      const failures = { release };
      if (phase !== null)
        failures.operation = new Error('Synthetic callback failure');
      if (phase === 'ROLLBACK')
        failures.ROLLBACK = new Error('Synthetic rollback failure');
      const { calls, pool, operation } = fixture(failures);
      await assert.rejects(
        withPostgresTransaction(pool, operation),
        (error) => error === release
      );
      assert.deepEqual(calls, [
        'connect',
        'BEGIN',
        'operation',
        phase === null ? 'COMMIT' : 'ROLLBACK',
        'release'
      ]);
    });
  }
});

test('the result stays pending while the callback or commit is unfinished', async () => {
  const { calls, client, pool, result } = fixture();
  const operationStarted = deferred();
  const operationPermit = deferred();
  const commitStarted = deferred();
  const commitPermit = deferred();
  const query = client.query.bind(client);
  client.query = async (command) => {
    const response = await query(command);
    if (command === 'COMMIT') {
      commitStarted.resolve();
      await commitPermit.promise;
    }
    return response;
  };
  let settled = false;
  const completion = withPostgresTransaction(pool, async (connected) => {
    assert.equal(connected, client);
    calls.push('operation');
    operationStarted.resolve();
    await operationPermit.promise;
    return result;
  }).then((value) => {
    settled = true;
    calls.push('resolved');
    return value;
  });

  await operationStarted.promise;
  assert.equal(settled, false);
  assert.deepEqual(calls, ['connect', 'BEGIN', 'operation']);

  operationPermit.resolve();
  await commitStarted.promise;
  assert.equal(settled, false);
  assert.deepEqual(calls, ['connect', 'BEGIN', 'operation', 'COMMIT']);

  commitPermit.resolve();
  assert.equal(await completion, result);
  assert.equal(settled, true);
  assert.deepEqual(calls, [
    'connect',
    'BEGIN',
    'operation',
    'COMMIT',
    'release',
    'resolved'
  ]);
});
