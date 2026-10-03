import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminContributionsHttpHandler } from '../dist/apps/funding-api/src/admin-contributions.http.js';
import {
  ContributionExportError,
  parseContributionExport
} from '../dist/apps/funding-api/src/admin-contributions-export.service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const contributionId = '00000000-0000-4000-8000-00000000000a';
const actor = 'synthetic-owner';
const requestId = '00000000-0000-4000-8000-000000000002';
const selection = {
  confirmation: 'export_private_contributions',
  contributions: [
    { id: contributionId, expectedVersion: '2026-09-24 12:00:00.123456+00' }
  ]
};

const fixture = ({ denied, listError, exportError } = {}) => {
  const calls = [];
  const listed = { contributions: [], data_source: 'database' };
  const csv = 'id,currency\r\nsynthetic,CAD';
  const writeJson = (_request, response, status, payload, headers = {}) => {
    calls.push({ name: 'json', value: status });
    Object.assign(response, { status, payload });
    Object.assign(response.headers, headers);
  };
  const handler = createAdminContributionsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: (request, response) => {
      calls.push({ name: 'access' });
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      calls.push({ name: 'actor' });
      return actor;
    },
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    writeJson,
    writeCsv: (_request, response, status, payload, filename) => {
      calls.push({ name: 'csv', value: { status, filename } });
      Object.assign(response, { status, payload, filename });
    },
    listAdminContributions: async (id) => {
      calls.push({ name: 'list', value: id });
      if (listError) throw listError;
      return listed;
    },
    exportAdminContributions: async (input, authenticatedActor) => {
      calls.push({
        name: 'export',
        value: { input, actor: authenticatedActor }
      });
      // Exercise the real selection contract without querying or exporting data.
      parseContributionExport(input);
      if (exportError) throw exportError;
      return { csv, requestId };
    },
    ContributionExportError,
    reportFailure: (...args) => calls.push({ name: 'report', value: args })
  });
  return {
    calls,
    listed,
    csv,
    names: () => calls.map((call) => call.name),
    values: (name) =>
      calls.filter((call) => call.name === name).map((c) => c.value),
    async run(
      url,
      {
        method = 'GET',
        body = JSON.stringify(selection),
        contentType = 'application/json; charset=utf-8'
      } = {}
    ) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url,
        headers: contentType ? { 'content-type': contentType } : {}
      });
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('contribution reads retain both aliases and optional scoped identifiers', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const id of [
      undefined,
      contributionId,
      contributionId.toUpperCase()
    ]) {
      await t.test(`${prefix}contributions ${id}`, async () => {
        const f = fixture();
        const suffix = id === undefined ? '' : `?contributionId=${id}`;
        const result = await f.run(`${prefix}contributions${suffix}`);
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, f.listed);
        assert.deepEqual(f.values('list'), [id]);
        assert.deepEqual(f.names(), ['access', 'list', 'json']);
      });
    }
  }
});

test('invalid scoped identifiers stop before data access', async (t) => {
  for (const id of ['', 'invalid', `${contributionId}x`]) {
    await t.test(id || 'empty', async () => {
      const f = fixture();
      const result = await f.run(`/admin/contributions?contributionId=${id}`);
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, {
        error: 'Invalid contribution identifier.'
      });
      assert.deepEqual(f.names(), ['access', 'json']);
    });
  }
});

test('absent, expired or forbidden access stops reads and exports before parsing', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      for (const [path, method] of [
        ['contributions?contributionId=invalid', 'GET'],
        ['contributions.csv', 'POST']
      ]) {
        await t.test(`${denied} ${prefix}${path}`, async () => {
          const f = fixture({ denied });
          const result = await f.run(`${prefix}${path}`, {
            method,
            body: '{invalid',
            contentType: 'text/plain'
          });
          assert.equal(result.handled, true);
          assert.equal(result.status, denied);
          assert.deepEqual(f.names(), ['access', 'json']);
          if (path.endsWith('.csv'))
            assert.equal(result.headers['Cache-Control'], 'private, no-store');
        });
      }
    }
  }
});

test('confirmed exports pass the versioned selection and authenticated actor unchanged', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(`${prefix}contributions.csv`, {
        method: 'POST',
        contentType: 'APPLICATION/JSON; charset=utf-8'
      });
      assert.equal(result.handled, true);
      assert.equal(result.status, 200);
      assert.equal(result.payload, f.csv);
      assert.equal(result.filename, 'openg7-admin-contributions.csv');
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.equal(result.headers['X-Request-Id'], requestId);
      assert.deepEqual(f.values('body'), [64 * 1024]);
      assert.deepEqual(f.values('export'), [{ input: selection, actor }]);
      assert.deepEqual(f.names(), ['access', 'body', 'actor', 'export', 'csv']);
    });
  }
});

test('private exports reject every other method before parsing', async (t) => {
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    await t.test(method, async () => {
      const f = fixture();
      const result = await f.run('/admin/contributions.csv', { method });
      assert.equal(result.handled, true);
      assert.equal(result.status, 405);
      assert.equal(result.headers.Allow, 'POST');
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(f.names(), ['access', 'json']);
    });
  }
});

test('export requires JSON content type before body parsing', async (t) => {
  for (const contentType of [
    null,
    'text/plain',
    'application/json-patch+json'
  ]) {
    await t.test(String(contentType), async () => {
      const f = fixture();
      const result = await f.run('/admin/contributions.csv', {
        method: 'POST',
        contentType
      });
      assert.equal(result.status, 415);
      assert.deepEqual(f.names(), ['access', 'json']);
    });
  }
});

test('malformed and oversized bodies fail before the export service', async (t) => {
  for (const [name, body] of [
    ['empty', ''],
    ['invalid JSON', '{'],
    ['over byte limit', 'é'.repeat(32 * 1024 + 1)]
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await f.run('/admin/contributions.csv', {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, {
        error: 'Invalid export request.',
        code: 'invalid_export_selection'
      });
      assert.deepEqual(f.values('body'), [64 * 1024]);
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
  const f = fixture();
  const body = JSON.stringify(selection).padEnd(64 * 1024, ' ');
  assert.equal(Buffer.byteLength(body), 64 * 1024);
  assert.equal(
    (await f.run('/admin/contributions.csv', { method: 'POST', body })).status,
    200
  );
});

test('export selection failures remain validated by the service and produce no CSV', async (t) => {
  for (const [name, input] of [
    ['null', null],
    ['array', []],
    ['missing confirmation', { ...selection, confirmation: undefined }],
    ['empty selection', { ...selection, contributions: [] }],
    [
      'missing version',
      { ...selection, contributions: [{ id: contributionId }] }
    ],
    [
      'invalid identifier and version',
      {
        ...selection,
        contributions: [{ id: 'invalid', expectedVersion: 'bad' }]
      }
    ],
    [
      'duplicate selection',
      {
        ...selection,
        contributions: [selection.contributions[0], selection.contributions[0]]
      }
    ],
    [
      'unknown field',
      { ...selection, search: 'synthetic-private@example.test' }
    ],
    [
      'selection above 250 records',
      {
        ...selection,
        contributions: Array.from(
          { length: 251 },
          () => selection.contributions[0]
        )
      }
    ]
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await f.run('/admin/contributions.csv', {
        method: 'POST',
        body: JSON.stringify(input)
      });
      assert.equal(result.status, 400);
      assert.equal(result.payload.code, 'invalid_export_selection');
      assert.equal(result.headers['X-Request-Id'], undefined);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'actor',
        'export',
        'json'
      ]);
    });
  }
});

test('selection conflicts and audit failures preserve service status without another export', async (t) => {
  for (const [status, code] of [
    [409, 'export_selection_changed'],
    [503, 'export_audit_unavailable']
  ]) {
    await t.test(code, async () => {
      const f = fixture({
        exportError: new ContributionExportError(status, code)
      });
      const result = await f.run('/api/admin/contributions.csv', {
        method: 'POST'
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, {
        error: 'Admin contributions export could not be generated.',
        code
      });
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.equal(result.headers['X-Request-Id'], undefined);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'actor',
        'export',
        'json'
      ]);
    });
  }
});

test('unexpected export errors expose and log no private error details', async () => {
  const privateDetail = 'synthetic-private@example.test';
  const f = fixture({ exportError: new Error(privateDetail) });
  const result = await f.run('/admin/contributions.csv', { method: 'POST' });
  assert.equal(result.status, 503);
  assert.deepEqual(result.payload, {
    error: 'Admin contributions export could not be generated.',
    code: 'export_unavailable'
  });
  assert.deepEqual(f.values('report'), [
    ['Private contribution export unavailable.']
  ]);
  assert.ok(!JSON.stringify(result).includes(privateDetail));
  assert.equal(f.values('export').length, 1);
  assert.deepEqual(f.values('csv'), []);
});

test('read failures preserve their existing status and server diagnostics', async () => {
  const failure = new Error('synthetic database failure');
  const f = fixture({ listError: failure });
  const result = await f.run('/api/admin/contributions');
  assert.equal(result.status, 502);
  assert.deepEqual(result.payload, {
    error: 'Admin contributions could not be loaded.'
  });
  assert.deepEqual(f.values('report'), [
    ['Failed to load admin contributions.', failure]
  ]);
  assert.ok(!JSON.stringify(result).includes(failure.message));
});

test('unowned routes and contribution read methods fall through without side effects', async (t) => {
  for (const [url, method] of [
    ['/admin/contributions', 'POST'],
    ['/api/admin/contributions', 'HEAD'],
    ['/admin/contributions.csv/extra', 'POST'],
    ['/admin/contributions.csv/', 'POST'],
    ['/admin/contributions/extra', 'GET'],
    ['/admin/expenses', 'GET'],
    [undefined, 'GET']
  ]) {
    await t.test(`${method} ${url}`, async () => {
      const f = fixture();
      const result = await f.run(url, { method });
      assert.equal(result.handled, false);
      assert.equal(result.status, undefined);
      assert.deepEqual(result.headers, {});
      assert.deepEqual(f.calls, []);
    });
  }
});
