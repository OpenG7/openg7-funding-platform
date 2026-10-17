import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AdminAutomaticRunError } from '../dist/apps/funding-api/src/admin-automatic-run-error.js';
import { assertPreparationReadiness } from '../dist/apps/funding-api/src/admin-preparation-readiness.js';
import { AdminPreparationService } from '../dist/apps/funding-api/src/admin-preparation.service.js';

const ready = { schema_compatible: true, can_read: true, can_approve: true };
const database = (checks = ready) => ({
  query: async () => ({ rows: checks ? [checks] : [] })
});

test('Preparation readiness refuses incomplete schema and checks effective rights for each operation', async () => {
  await assertPreparationReadiness(database());
  await assertPreparationReadiness(database(), 'approve');
  for (const checks of [null, {}, { ...ready, schema_compatible: false }])
    await assert.rejects(assertPreparationReadiness(database(checks)), {
      code: 'PREPARATION_SCHEMA_INCOMPATIBLE',
      status: 503
    });

  for (const operation of ['read', 'approve'])
    await assert.rejects(
      assertPreparationReadiness(
        database({ ...ready, can_read: false }),
        operation
      ),
      { code: 'PREPARATION_DATABASE_ACCESS_DENIED', status: 503 }
    );
  await assertPreparationReadiness(database({ ...ready, can_approve: false }));
  await assert.rejects(
    assertPreparationReadiness(
      database({ ...ready, can_approve: false }),
      'approve'
    ),
    { code: 'PREPARATION_DATABASE_ACCESS_DENIED', status: 503 }
  );
});

test('Preparation inspection never exposes PostgreSQL diagnostics or connection data', async () => {
  for (const [postgresCode, safeCode] of [
    ['42501', 'PREPARATION_DATABASE_ACCESS_DENIED'],
    ['08006', 'RUN_UNAVAILABLE'],
    [undefined, 'RUN_UNAVAILABLE']
  ]) {
    await assert.rejects(
      assertPreparationReadiness({
        query: async () => {
          throw Object.assign(new Error('synthetic-private-connection-value'), {
            code: postgresCode,
            detail: 'synthetic-private-sql-detail'
          });
        }
      }),
      (error) => {
        assert.ok(error instanceof AdminAutomaticRunError);
        assert.equal(error.code, safeCode);
        assert.equal(error.status, 503);
        assert.equal(error.message, safeCode);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
        return true;
      }
    );
  }
});

test('Every preparation read and approval rejects incompatible schema before a transaction can start', async () => {
  const calls = [];
  const service = new AdminPreparationService({
    query: async () => {
      calls.push('inspect');
      return { rows: [{ ...ready, schema_compatible: false }] };
    },
    connect: async () => {
      calls.push('connect');
      throw new Error('No transaction may start');
    }
  });
  const contributionId = randomUUID();
  const runId = randomUUID();
  const command = {
    contributionId,
    expectedVersion: 'a'.repeat(64),
    requestId: randomUUID(),
    confirmed: true
  };
  for (const operation of [
    () => service.dossierPreparation(contributionId),
    () => service.preparation('synthetic-operator', runId, 1),
    () => service.approveDossierPreparation(command, 'synthetic-operator'),
    () =>
      service.approvePreparation({ ...command, runId }, 'synthetic-operator')
  ])
    await assert.rejects(operation(), {
      code: 'PREPARATION_SCHEMA_INCOMPATIBLE',
      status: 503
    });
  assert.deepEqual(calls, ['inspect', 'inspect', 'inspect', 'inspect']);
});

test('Preparation checks are refreshed after runtime schema or privilege drift', async () => {
  const rows = [ready, { ...ready, can_read: false }, ready];
  const pool = { query: async () => ({ rows: [rows.shift()] }) };
  await assertPreparationReadiness(pool);
  await assert.rejects(assertPreparationReadiness(pool), {
    code: 'PREPARATION_DATABASE_ACCESS_DENIED'
  });
  await assertPreparationReadiness(pool);
  assert.equal(rows.length, 0);
});

test('Invalid preparation input is rejected without inspecting the database', async () => {
  const service = new AdminPreparationService({
    query: async () => {
      throw new Error('Must not inspect invalid input');
    },
    connect: async () => {
      throw new Error('Must not connect for invalid input');
    }
  });
  for (const operation of [
    () => service.dossierPreparation('invalid'),
    () => service.preparation('synthetic-operator', randomUUID(), 0),
    () => service.approveDossierPreparation({}, 'synthetic-operator'),
    () => service.approvePreparation({}, 'synthetic-operator')
  ])
    await assert.rejects(operation(), {
      code: 'RUN_INVALID_REQUEST',
      status: 400
    });
});
