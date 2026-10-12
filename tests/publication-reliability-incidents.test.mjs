import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationReliabilityIncidentPage,
  validateReliabilityIncidentFilter
} from '../dist/apps/funding-api/src/publication-reliability.repository.js';
import { PublicationAutomationService } from '../dist/apps/funding-api/src/publication-automation/service.js';

const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const incident = (n) => ({
  code: 'ACCOUNT_RESULT_UNCERTAIN',
  subjectType: 'delivery',
  subjectId: id(n),
  deliveryId: id(n)
});
const row = (overrides = {}) => ({
  evaluated_at: new Date('2030-06-01T12:00:00Z'),
  global_total: '151',
  filtered_total: '101',
  snapshot: 'a'.repeat(32),
  incidents: Array.from({ length: 51 }, (_, i) => incident(i)),
  ...overrides
});

test('reliability paging uses bounded keyset results and keeps the complete count independent of filters', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [row()] };
    }
  };
  const filter = { code: 'ACCOUNT_RESULT_UNCERTAIN', subjectType: 'delivery' };
  const first = await publicationReliabilityIncidentPage(db, filter);
  assert.equal(first.globalTotal, 151);
  assert.equal(first.filteredTotal, 101);
  assert.equal(first.incidents.length, 50);
  assert.equal(first.limit, 50);
  assert.equal(first.incidents[49].deliveryId, id(49));
  const decoded = validateReliabilityIncidentFilter({
    ...filter,
    cursor: first.nextCursor
  });
  assert.deepEqual(decoded.after, [
    'ACCOUNT_RESULT_UNCERTAIN',
    'delivery',
    id(49)
  ]);
  assert.equal(decoded.snapshot, 'a'.repeat(32));
  assert.match(calls[0].sql, /LIMIT 51/);
  assert.match(
    calls[0].sql,
    /\(code,subject_type,subject_id\) > \(\$3::text,\$4::text,\$5::uuid\)/
  );
  assert.deepEqual(calls[0].params, [
    'ACCOUNT_RESULT_UNCERTAIN',
    'delivery',
    null,
    null,
    null
  ]);
  const next = await publicationReliabilityIncidentPage(
    {
      query: async (_sql, params) => {
        assert.deepEqual(params, [
          'ACCOUNT_RESULT_UNCERTAIN',
          'delivery',
          'ACCOUNT_RESULT_UNCERTAIN',
          'delivery',
          id(49)
        ]);
        return { rows: [row({ incidents: [incident(50)] })] };
      }
    },
    { ...filter, cursor: first.nextCursor }
  );
  assert.equal(next.nextCursor, null);
  assert.equal(next.incidents[0].subjectId, id(50));
});

test('changed incident sets reject a continuation instead of mixing two snapshots', async () => {
  const filter = { code: 'ACCOUNT_RESULT_UNCERTAIN' };
  const first = await publicationReliabilityIncidentPage(
    { query: async () => ({ rows: [row()] }) },
    filter
  );
  await assert.rejects(
    publicationReliabilityIncidentPage(
      { query: async () => ({ rows: [row({ snapshot: 'b'.repeat(32) })] }) },
      { ...filter, cursor: first.nextCursor }
    ),
    { code: 'RELIABILITY_SNAPSHOT_CHANGED', status: 409 }
  );
  await assert.rejects(
    publicationReliabilityIncidentPage(
      {
        query: async () => {
          assert.fail('invalid filter must not query');
        }
      },
      { code: 'ACCOUNT_LEASE_MISMATCH', cursor: first.nextCursor }
    ),
    { code: 'INVALID_FILTER', status: 400 }
  );
});

test('invalid reliability cursors and enums fail before touching persistence', async () => {
  for (const filter of [
    { code: '' },
    { code: 'unsafe' },
    { subjectType: 'unknown' },
    { cursor: '' },
    { cursor: 'x'.repeat(1025) },
    { cursor: '%2Fsecret' },
    { cursor: Buffer.from('null').toString('base64url') },
    { cursor: Buffer.from('{}').toString('base64url') },
    {
      cursor: Buffer.from(
        JSON.stringify({
          version: 1,
          snapshot: 'a'.repeat(32),
          code: null,
          subjectType: null,
          after: ['ACCOUNT_RESULT_UNCERTAIN', 'delivery', 'not-a-uuid']
        })
      ).toString('base64url')
    }
  ])
    await assert.rejects(
      publicationReliabilityIncidentPage(
        {
          query: async () => {
            assert.fail('invalid filter queried');
          }
        },
        filter
      ),
      { code: 'INVALID_FILTER', status: 400 }
    );
});

test('service incident reads own a read-only repeatable transaction and release it after the result', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql.startsWith('WITH') ? 'projection' : sql);
      return { rows: sql.startsWith('WITH') ? [row({ incidents: [] })] : [] };
    },
    release: () => calls.push('release')
  };
  const service = new PublicationAutomationService(
    { connect: async () => client },
    {},
    {}
  );
  await service.reliabilityIncidents();
  assert.deepEqual(calls, [
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'projection',
    'COMMIT',
    'release'
  ]);
});

test('invalid database counts fail closed rather than showing a false healthy total', async () => {
  for (const global_total of ['-1', 'broken', '9007199254740992'])
    await assert.rejects(
      publicationReliabilityIncidentPage({
        query: async () => ({ rows: [row({ global_total })] })
      }),
      { code: 'RELIABILITY_UNAVAILABLE', status: 503 }
    );
});
