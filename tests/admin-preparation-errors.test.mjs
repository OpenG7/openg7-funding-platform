import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminAutomaticRunError } from '../dist/apps/funding-api/src/admin-automatic-run-error.js';
import { createAdminAutomaticRunsHttpHandler } from '../dist/apps/funding-api/src/admin-automatic-runs.http.js';
import { preparationHttpFailure } from '../dist/apps/funding-api/src/admin-preparation-errors.js';

const id = '11111111-1111-4111-8111-111111111111';
const privateText = 'synthetic-private-connection-and-query';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const databaseFailure = (code) =>
  Object.assign(new Error(privateText), {
    code,
    detail: privateText,
    query: privateText,
    table: privateText,
    connection: privateText
  });

test('preparation failures distinguish schema, database access and transient failures without disclosing SQL', () => {
  for (const [sqlState, code, category] of [
    ['42P01', 'PREPARATION_SCHEMA_INCOMPATIBLE', 'schema'],
    ['42703', 'PREPARATION_SCHEMA_INCOMPATIBLE', 'schema'],
    ['42501', 'PREPARATION_DATABASE_ACCESS_DENIED', 'database_access'],
    ['08006', 'RUN_UNAVAILABLE', 'unavailable'],
    [privateText, 'RUN_UNAVAILABLE', 'unavailable']
  ]) {
    const diagnostics = [];
    const result = preparationHttpFailure(
      databaseFailure(sqlState),
      'carousel_read',
      (diagnostic) => diagnostics.push(diagnostic)
    );
    assert.equal(result.status, 503);
    assert.equal(result.payload.code, code);
    assert.match(result.payload.correlationId, uuid);
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0], {
      event: 'admin_preparation_unavailable',
      operation: 'carousel_read',
      category,
      code,
      correlationId: result.payload.correlationId,
      occurredAt: diagnostics[0].occurredAt,
      ...(['42P01', '42703', '42501'].includes(sqlState) ? { sqlState } : {})
    });
    assert.ok(Number.isFinite(Date.parse(diagnostics[0].occurredAt)));
    assert.doesNotMatch(
      JSON.stringify({ result, diagnostics }),
      new RegExp(privateText)
    );
  }
});

test('preflight errors retain their category and business conflicts do not become infrastructure incidents', () => {
  for (const [code, category] of [
    ['PREPARATION_SCHEMA_INCOMPATIBLE', 'schema'],
    ['PREPARATION_DATABASE_ACCESS_DENIED', 'database_access']
  ]) {
    const diagnostics = [];
    const result = preparationHttpFailure(
      new AdminAutomaticRunError(code, 503),
      'dossier_read',
      (diagnostic) => diagnostics.push(diagnostic)
    );
    assert.equal(result.payload.code, code);
    assert.equal(diagnostics[0].category, category);
    assert.equal(diagnostics[0].sqlState, undefined);
  }
  const result = preparationHttpFailure(
    new AdminAutomaticRunError('PREPARATION_VERSION_CONFLICT', 409),
    'dossier_approve',
    () => assert.fail('a business conflict was logged as a server failure')
  );
  assert.equal(result.status, 409);
  assert.equal(result.payload.code, 'PREPARATION_VERSION_CONFLICT');
  assert.equal(result.payload.correlationId, undefined);
  assert.equal(
    preparationHttpFailure(null, 'carousel_approve', () => {
      throw new Error(privateText);
    }).payload.code,
    'RUN_UNAVAILABLE'
  );
});

function fixture(failure, denied = false) {
  const diagnostics = [];
  let serviceCalls = 0;
  const fail = async () => {
    ++serviceCalls;
    throw failure;
  };
  const handler = createAdminAutomaticRunsHttpHandler({
    publicBaseOrigin: 'https://synthetic-preparation.invalid',
    ensureAdminAccess(_request, response) {
      if (denied) response.status = 403;
      return !denied;
    },
    getAdminAuditActor: () => 'synthetic-operator',
    readBody: async () => JSON.stringify({ contributionId: id }),
    writeJson(_request, response, status, payload) {
      Object.assign(response, { status, payload });
    },
    automaticRuns: {
      state: fail,
      start: fail,
      advance: fail,
      control: fail,
      report: fail,
      preparation: fail,
      approvePreparation: fail
    },
    dossierPreparations: {
      dossierPreparation: fail,
      approveDossierPreparation: fail
    },
    reportPreparationFailure: (diagnostic) => diagnostics.push(diagnostic)
  });
  return {
    diagnostics,
    get serviceCalls() {
      return serviceCalls;
    },
    async request(url, method = 'GET') {
      const response = {
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        }
      };
      await handler(
        { url, method, headers: { 'content-type': 'application/json' } },
        response
      );
      return response;
    }
  };
}

test('both receipt endpoints and their aliases classify failures after authorization, without retrying writes', async () => {
  for (const prefix of ['', '/api'])
    for (const [path, method, operation] of [
      [
        `/admin/automatic-runs/preparation?runId=${id}&position=3`,
        'GET',
        'carousel_read'
      ],
      ['/admin/automatic-runs/preparation/approve', 'POST', 'carousel_approve'],
      [
        `/admin/sponsorships/preparation?sponsorshipId=${id}`,
        'GET',
        'dossier_read'
      ],
      ['/admin/sponsorships/preparation/approve', 'POST', 'dossier_approve']
    ])
      for (const [sqlState, code] of [
        ['42P01', 'PREPARATION_SCHEMA_INCOMPATIBLE'],
        ['42703', 'PREPARATION_SCHEMA_INCOMPATIBLE'],
        ['42501', 'PREPARATION_DATABASE_ACCESS_DENIED']
      ]) {
        const f = fixture(databaseFailure(sqlState));
        const result = await f.request(prefix + path, method);
        assert.equal(result.status, 503);
        assert.equal(result.payload.code, code);
        assert.equal(result.headers['Cache-Control'], 'private, no-store');
        assert.equal(f.serviceCalls, 1);
        assert.equal(f.diagnostics.length, 1);
        assert.equal(f.diagnostics[0].operation, operation);
        assert.equal(
          f.diagnostics[0].correlationId,
          result.payload.correlationId
        );
        assert.doesNotMatch(
          JSON.stringify({ result, logs: f.diagnostics }),
          new RegExp(privateText)
        );

        const denied = fixture(databaseFailure(sqlState), true);
        assert.equal((await denied.request(prefix + path, method)).status, 403);
        assert.equal(denied.serviceCalls, 0);
        assert.deepEqual(denied.diagnostics, []);
      }
});

test('a database failure outside preparation retains its existing automatic-run contract', async () => {
  const f = fixture(databaseFailure('42P01'));
  const response = await f.request('/api/admin/automatic-runs');
  assert.equal(response.status, 503);
  assert.equal(response.payload.code, 'RUN_UNAVAILABLE');
  assert.deepEqual(f.diagnostics, []);
});
