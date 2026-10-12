import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationReliability,
  detectPublicationReliabilityIncidents
} from '../dist/apps/funding-api/src/publication-reliability.repository.js';

const zeroRow = () =>
  Object.fromEntries(
    [
      'open',
      'undated',
      'fulfilled',
      'waived',
      'unqualified',
      'saturated_batches',
      'saturated_slots',
      'account_conflicts',
      'publishing',
      'uncertain',
      'uncertain_accounts',
      'overdue',
      'proof_mismatches',
      'orphan_proofs',
      'obligation_mismatches',
      'account_mismatches',
      'lease_mismatches',
      'batch_mismatches',
      'slot_mismatches',
      'incident_total'
    ]
      .map((key) => [key, '0'])
      .concat([
        ['evaluated_at', new Date('2026-10-12T12:00:00Z')],
        ['oldest_open', null],
        ['oldest_undated', null],
        ['oldest_uncertain', null],
        ['correlations', []]
      ])
  );

test('reliability projects complete aggregate counts and excludes unrelated private query fields', async () => {
  const row = {
    ...zeroRow(),
    open: '653',
    undated: '600',
    fulfilled: '3',
    incident_total: '72',
    oldest_open: '2026-10-01 00:00:00+00',
    correlations: [
      {
        code: 'ACCOUNT_RESULT_UNCERTAIN',
        subjectType: 'delivery',
        subjectId: '10000000-0000-4000-8000-000000000041'
      }
    ],
    account_id: 'private-account-value',
    email_private: 'private@example.invalid',
    source_snapshot: { secret: 'private-object-key' }
  };
  const result = await publicationReliability({
    query: async () => ({ rows: [row] })
  });
  assert.equal(result.scope, 'global');
  assert.equal(result.obligations.open, 653);
  assert.equal(result.obligations.undatedSocial, 600);
  assert.equal(result.obligations.fulfilledWithEvidence, 3);
  assert.equal(result.obligations.oldestOpenAt, '2026-10-01T00:00:00.000Z');
  assert.equal(result.incidentTotal, 72);
  assert.equal(result.correlationLimit, 50);
  assert.equal(result.incidents.length, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-account|private@|private-object|source_snapshot/
  );
});
test('invalid or unrepresentable counts fail instead of reporting a false zero', async () => {
  for (const count of ['-1', 'broken', '9007199254740992'])
    await assert.rejects(
      publicationReliability({
        query: async () => ({ rows: [{ ...zeroRow(), open: count }] })
      }),
      { code: 'RELIABILITY_UNAVAILABLE', status: 503 }
    );
});
test('operations detection preserves every incident and uses only internal UUID correlation', async () => {
  const rows = Array.from({ length: 81 }, (_, i) => ({
    code: 'ACCOUNT_RESULT_UNCERTAIN',
    subject_type: 'delivery',
    subject_id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  }));
  const incidents = await detectPublicationReliabilityIncidents({
    query: async () => ({ rows })
  });
  assert.equal(incidents.length, 81);
  assert.deepEqual(incidents[80], {
    key: `publication:ACCOUNT_RESULT_UNCERTAIN:${rows[80].subject_id}`,
    type: 'publication_account_result_uncertain'
  });
});
