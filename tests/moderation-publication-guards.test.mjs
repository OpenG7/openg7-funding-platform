import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveModeratedSubject,
  recordAdverseModeration
} from '../dist/apps/funding-api/src/moderation-legacy.js';
import { assertDeliveryModeration } from '../dist/apps/funding-api/src/publication-automation/moderation.js';

const deliveryId = '11111111-1111-4111-8111-111111111111';
const sponsorId = '22222222-2222-4222-8222-222222222222';
const mediaId = '33333333-3333-4333-8333-333333333333';
const draftId = '44444444-4444-4444-8444-444444444444';
const approved = {
  level: 'N0',
  state: 'approved',
  editorial_status: 'approved',
  content_version: 2,
  current_content_version: 2,
  content_fingerprint: 'a'.repeat(64),
  current_fingerprint: 'a'.repeat(64),
  actual_fingerprint: 'a'.repeat(64)
};

test('an existing editorial N0 can authorize a separate legacy business command without writing a second decision', async () => {
  const queries = [];
  await approveModeratedSubject(
    {
      query: async (sql, values) => {
        queries.push({ sql, values });
        return { rows: [approved] };
      }
    },
    { type: 'sponsorship', id: sponsorId },
    'test-reviewer'
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^SELECT /);
  assert.deepEqual(queries[0].values, ['sponsorship', sponsorId]);
});

for (const [name, row, code] of [
  [
    'historical approval without a decision',
    null,
    'MODERATION_DECISION_REQUIRED'
  ],
  [
    'a pending second review',
    { ...approved, state: 'pending_independent_review' },
    'MODERATION_RESTRICTED'
  ],
  [
    'changed content',
    { ...approved, actual_fingerprint: 'b'.repeat(64) },
    'MODERATION_DECISION_OBSOLETE'
  ],
  [
    'content changed back after another version',
    { ...approved, current_content_version: 4 },
    'MODERATION_DECISION_OBSOLETE'
  ]
]) {
  test(`legacy approval refuses ${name}`, async () => {
    await assert.rejects(
      approveModeratedSubject(
        { query: async () => ({ rows: row ? [row] : [] }) },
        { type: 'sponsorship', id: sponsorId },
        'test-reviewer'
      ),
      (error) => error.code === code
    );
  });
}

test('an adverse legacy command cannot mutate without a structured decision or with another scope level', async () => {
  const db = {
    query: async () =>
      assert.fail('No database access is expected for an invalid decision.')
  };
  await assert.rejects(
    recordAdverseModeration(
      db,
      { type: 'media', id: mediaId },
      'reviewer',
      undefined,
      ['N3']
    ),
    (error) =>
      error.code === 'MODERATION_DECISION_REQUIRED' && error.status === 400
  );
  await assert.rejects(
    recordAdverseModeration(
      db,
      { type: 'media', id: mediaId },
      'reviewer',
      { level: 'N4' },
      ['N3']
    ),
    (error) => error.code === 'MODERATION_LEVEL_INVALID' && error.status === 400
  );
});

for (const deniedType of [
  null,
  'publication_delivery',
  'sponsorship',
  'publication_draft',
  'media'
]) {
  test(`the delivery guard verifies all dependencies${deniedType ? ` and refuses restricted ${deniedType}` : ''}`, async () => {
    const subjects = [];
    const db = {
      query: async (sql, values) => {
        if (sql.includes('SELECT DISTINCT contribution_id'))
          return { rows: [{ contribution_id: sponsorId }] };
        if (sql.startsWith('SELECT draft.id'))
          return { rows: [{ id: draftId }] };
        subjects.push(values);
        return {
          rows: [
            {
              ...approved,
              state: values[0] === deniedType ? 'on_hold' : 'approved'
            }
          ]
        };
      }
    };
    const operation = assertDeliveryModeration(db, {
      id: deliveryId,
      batch_id: deliveryId,
      media_id: mediaId
    });
    if (deniedType)
      await assert.rejects(
        operation,
        (error) =>
          error.code === 'MODERATION_RESTRICTED' && error.status === 409
      );
    else {
      await operation;
      assert.deepEqual(subjects, [
        ['publication_delivery', deliveryId],
        ['sponsorship', sponsorId],
        ['publication_draft', draftId],
        ['media', mediaId]
      ]);
    }
  });
}
