import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminBackupsHttpHandler } from '../dist/apps/funding-api/src/admin-backups.http.js';
import {
  BackupError,
  isBackupId
} from '../dist/apps/funding-api/src/database-backup/service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const origin = 'https://funding.example.test';
const id = '00000000-0000-4000-8000-000000000001';
const actor = 'synthetic-owner';
const selection = { requestId: id, confirmation: 'BACKUP_DATABASE' };
const fixture = ({
  denied,
  databaseAvailable = true,
  source = 'session',
  failure
} = {}) => {
  const calls = [];
  const job = { requestId: id, source: 'manual', status: 'queued' };
  const statusResult = { scope: 'database', jobs: [job], workerState: 'ready' };
  const writeJson = (_request, response, status, payload) => {
    calls.push(['json', status]);
    Object.assign(response, { status, payload });
  };
  const handler = createAdminBackupsHttpHandler({
    publicBaseOrigin: origin,
    allowedOrigins: ['https://admin.example.test'],
    databaseAvailable: () => {
      calls.push(['database']);
      return databaseAvailable;
    },
    ensureAdminAccess: (request, response) => {
      calls.push(['access']);
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    resolveAdminAuthorization: () => {
      calls.push(['authorization']);
      return source ? { source } : null;
    },
    getAdminAuditActor: () => {
      calls.push(['actor']);
      return actor;
    },
    readBody: (request, limit) => {
      calls.push(['body', limit]);
      return readBody(request, limit);
    },
    writeJson,
    isBackupId,
    BackupError,
    backupStatus: async (requestId) => {
      calls.push(['status', requestId]);
      if (failure) throw failure;
      return statusResult;
    },
    requestBackup: async (requestId, auditActor) => {
      calls.push(['request', requestId, auditActor]);
      if (failure) throw failure;
      return job;
    }
  });
  return {
    calls,
    job,
    statusResult,
    async request(
      url = '/admin/backups',
      {
        method = 'POST',
        input = selection,
        body = JSON.stringify(input),
        contentType = 'application/json',
        requestOrigin
      } = {}
    ) {
      const request = Object.assign(Readable.from([body]), {
        method,
        url,
        headers: {
          ...(contentType ? { 'content-type': contentType } : {}),
          ...(requestOrigin ? { origin: requestOrigin } : {})
        }
      });
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('backup aliases preserve status selection and repeat queued request receipts', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    const f = fixture();
    const selected = await f.request(`${prefix}backups?requestId=${id}`, {
      method: 'GET'
    });
    assert.deepEqual(selected.payload, f.statusResult);
    assert.deepEqual(
      f.calls.find(([name]) => name === 'status'),
      ['status', id]
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await f.request(`${prefix}backups`, {
        contentType: 'APPLICATION/JSON; charset=utf-8',
        requestOrigin: origin
      });
      assert.equal(result.status, 202);
      assert.deepEqual(result.payload, f.job);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
    }
    assert.deepEqual(
      f.calls.filter(([name]) => name === 'request'),
      Array(2).fill(['request', id, actor])
    );
    assert.deepEqual(
      f.calls.filter(([name]) => name === 'body'),
      [
        ['body', 2048],
        ['body', 2048]
      ]
    );
  }
});

test('backup access, session source and origin checks refuse before reading', async () => {
  for (const [options, request, status, code] of [
    [{ denied: 401 }, {}, 401, undefined],
    [{ denied: 403 }, {}, 403, undefined],
    [{ denied: 503 }, {}, 503, undefined],
    [{ source: 'static-token' }, {}, 401, 'ADMIN_SESSION_REQUIRED'],
    [{ source: 'local-dev' }, {}, 401, 'ADMIN_SESSION_REQUIRED'],
    [{ source: null }, {}, 401, 'ADMIN_SESSION_REQUIRED'],
    [
      {},
      { requestOrigin: 'https://other.example.test' },
      403,
      'ORIGIN_FORBIDDEN'
    ],
    [{}, { contentType: null }, 415, 'INVALID_BACKUP_REQUEST']
  ]) {
    const f = fixture(options);
    const result = await f.request(undefined, { ...request, body: '{invalid' });
    assert.equal(result.status, status);
    assert.equal(result.payload.code, code);
    assert.equal(
      f.calls.some(([name]) => name === 'body'),
      false
    );
  }
  assert.equal((await fixture({ source: 'oidc' }).request()).status, 202);
});

test('backup database null preserves the original consumed route without synthesizing a response', async () => {
  const f = fixture({ databaseAvailable: false });
  const result = await f.request();
  assert.equal(result.handled, true);
  assert.equal(result.status, undefined);
  assert.deepEqual(f.calls, [['access'], ['database']]);
});

test('backup validates request envelope, confirmation, identifier and byte limit before acceptance', async () => {
  for (const [body, code] of [
    ['{', 'INVALID_BACKUP_REQUEST'],
    ['null', 'INVALID_BACKUP_REQUEST'],
    ['[]', 'INVALID_BACKUP_REQUEST'],
    [
      JSON.stringify({ ...selection, requestId: 'bad' }),
      'INVALID_BACKUP_REQUEST'
    ],
    [JSON.stringify({ ...selection, extra: true }), 'INVALID_BACKUP_REQUEST'],
    [JSON.stringify({ requestId: id }), 'CONFIRMATION_REQUIRED'],
    [
      JSON.stringify({ ...selection, confirmation: true }),
      'CONFIRMATION_REQUIRED'
    ],
    [' '.repeat(2049), 'INVALID_BACKUP_REQUEST']
  ]) {
    const f = fixture();
    const result = await f.request(undefined, { body });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, { code });
    assert.equal(
      f.calls.some(([name]) => name === 'request'),
      false
    );
  }
  const f = fixture();
  assert.deepEqual(
    (await f.request('/admin/backups?requestId=', { method: 'GET' })).payload,
    { code: 'INVALID_BACKUP_REQUEST' }
  );
  assert.equal(
    f.calls.some(([name]) => name === 'status'),
    false
  );
});

test('backup preserves conflicts, rate limits and unexpected failures for safe status recovery', async () => {
  for (const [failure, status, code] of [
    [
      new BackupError('BACKUP_REQUEST_CONFLICT', 409),
      409,
      'BACKUP_REQUEST_CONFLICT'
    ],
    [new BackupError('BACKUP_ACTIVE', 409), 409, 'BACKUP_ACTIVE'],
    [new BackupError('BACKUP_RATE_LIMIT', 429), 429, 'BACKUP_RATE_LIMIT'],
    [new Error('private detail'), 503, 'BACKUP_UNAVAILABLE']
  ]) {
    const result = await fixture({ failure }).request();
    assert.equal(result.status, status);
    assert.deepEqual(result.payload, { code });
  }
  const f = fixture();
  const recovered = await f.request(`/admin/backups?requestId=${id}`, {
    method: 'GET'
  });
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.payload, f.statusResult);
});

test('backup method ownership retains Allow while unknown routes fall through', async () => {
  const f = fixture();
  assert.equal((await f.request('/admin/backups/extra')).handled, false);
  assert.deepEqual(f.calls, []);
  const result = await f.request(undefined, { method: 'DELETE' });
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, 'GET, POST');
  assert.equal(
    f.calls.some(([name]) => name === 'body'),
    false
  );
});
