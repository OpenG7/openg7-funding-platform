import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sponsorshipDeadlineAt,
  sponsorshipDeadlineOverdue
} from '../dist/packages/funding-core/src/sponsorship-obligation-timing.js';
import { sponsorshipObligationTimingProjectionSql } from '../dist/apps/funding-api/src/sponsorship-obligation-timing.read.js';
import { completeWebsiteExposureDuration } from '../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { executeSponsorshipTimingCommand } from '../dist/apps/funding-api/src/sponsorship-obligation-timing.js';

test('the lower-level duration port requires the owner continuity statement before any write', async () => {
  for (const continuityConfirmed of [undefined, false])
    await assert.rejects(
      completeWebsiteExposureDuration(
        {
          query: async () => {
            throw new Error('Database must not be touched.');
          }
        },
        {
          evidenceReference: 'synthetic://owner-proof',
          continuityConfirmed
        }
      ),
      { code: 'DURATION_ATTESTATION_REQUIRED', status: 400 }
    );
});
test('origin commands reject normalized invalid calendar dates and future dates before any database access', async () => {
  const obligationId = '10000000-0000-4000-8000-000000000001';
  for (const originAt of [
    '2001-02-30T00:00:00.000Z',
    '2001-02-29T00:00:00.000Z',
    '1999-12-31T23:59:59.000Z',
    new Date(Date.now() + 86400000).toISOString()
  ])
    await assert.rejects(
      executeSponsorshipTimingCommand(
        {
          query: async () => {
            throw new Error('Database must not be touched.');
          }
        },
        {
          requestId: '20000000-0000-4000-8000-000000000001',
          obligationId,
          expectedVersion: 1,
          confirmation: obligationId,
          reason: 'Synthetic origin review',
          kind: 'origin',
          originAt,
          evidenceReference: 'synthetic://contract-anchor'
        },
        'synthetic-owner'
      ),
      { code: 'TIMING_INVALID', status: 400 }
    );
});

test('timing commands reject array and object kinds before any database access', async () => {
  const obligationId = '10000000-0000-4000-8000-000000000001';
  for (const kind of [['origin'], ['observe'], {}, 123, null])
    await assert.rejects(
      executeSponsorshipTimingCommand(
        {
          query: async () => {
            throw new Error('Database must not be touched.');
          }
        },
        {
          requestId: '20000000-0000-4000-8000-000000000001',
          obligationId,
          expectedVersion: 1,
          confirmation: obligationId,
          reason: 'Synthetic malformed timing command',
          kind
        },
        'synthetic-owner'
      ),
      { code: 'TIMING_INVALID', status: 400 }
    );
});

test('each legitimate timing command passes its own field contract before dossier lookup', async () => {
  const obligationId = '10000000-0000-4000-8000-000000000001';
  for (const fields of [
    {
      kind: 'origin',
      originAt: '2001-01-01T00:00:00.000Z',
      evidenceReference: 'synthetic://contract-anchor'
    },
    { kind: 'observe' },
    {
      kind: 'duration',
      startObservationId: '30000000-0000-4000-8000-000000000001',
      continuityConfirmed: true,
      evidenceReference: 'synthetic://duration-proof'
    }
  ]) {
    let reads = 0;
    await assert.rejects(
      executeSponsorshipTimingCommand(
        {
          query: async (sql, values) => {
            reads++;
            assert.match(sql, /SELECT ob\.contribution_id/);
            assert.deepEqual(values, [obligationId]);
            return { rows: [] };
          }
        },
        {
          requestId: '20000000-0000-4000-8000-000000000001',
          obligationId,
          expectedVersion: 1,
          confirmation: obligationId,
          reason: 'Synthetic documented timing command',
          ...fields
        },
        'synthetic-owner'
      ),
      { code: 'COMMITMENT_NOT_FOUND', status: 404 }
    );
    assert.equal(reads, 1);
  }
});

test('timing commands reject foreign administrative or commercial fields before database access', async () => {
  const obligationId = '10000000-0000-4000-8000-000000000001';
  for (const foreign of [
    { payment: 'refunded' },
    { target: 'openg20' },
    { format: 'individual_portrait' }
  ])
    await assert.rejects(
      executeSponsorshipTimingCommand(
        { query: () => assert.fail('Database must not be touched.') },
        {
          requestId: '20000000-0000-4000-8000-000000000001',
          obligationId,
          expectedVersion: 1,
          confirmation: obligationId,
          reason: 'Synthetic timing review',
          kind: 'observe',
          ...foreign
        },
        'synthetic-owner'
      ),
      { code: 'TIMING_INVALID', status: 400 }
    );
});

test('contract deadlines use UTC 24-hour days across daylight saving and leap days', () => {
  assert.equal(
    sponsorshipDeadlineAt('2026-03-08T04:00:00.000Z', 1),
    '2026-03-09T04:00:00.000Z'
  );
  assert.equal(
    sponsorshipDeadlineAt('2028-02-28T00:00:00.000Z', 2),
    '2028-03-01T00:00:00.000Z'
  );
  for (const days of [0, -1, 1.5, 3651, NaN])
    assert.throws(() => sponsorshipDeadlineAt('2026-01-01T00:00:00Z', days));
  assert.throws(() => sponsorshipDeadlineAt('unknown', 1));
});
test('only unfinished promises become overdue, strictly after the recorded deadline', () => {
  const deadline = '2026-10-12T12:00:00.000Z';
  assert.equal(
    sponsorshipDeadlineOverdue(deadline, 'pending', deadline),
    false
  );
  assert.equal(
    sponsorshipDeadlineOverdue(deadline, 'blocked', '2026-10-12T12:00:00.001Z'),
    true
  );
  assert.equal(
    sponsorshipDeadlineOverdue(
      deadline,
      'fulfilled',
      '2026-12-12T12:00:00.000Z'
    ),
    false
  );
  assert.equal(
    sponsorshipDeadlineOverdue(
      deadline,
      'adjusted',
      '2026-12-12T12:00:00.000Z'
    ),
    false
  );
  assert.equal(sponsorshipDeadlineOverdue(null, 'pending', 'unknown'), false);
  assert.throws(() =>
    sponsorshipDeadlineOverdue(deadline, 'pending', 'unknown')
  );
});
test('timing projections accept only API-owned SQL aliases', () => {
  assert.match(
    sponsorshipObligationTimingProjectionSql('ob'),
    /sponsorship_obligation_timing/
  );
  for (const alias of ['ob.id', 'ob;select', '"ob"', 'Ob', ''])
    assert.throws(() => sponsorshipObligationTimingProjectionSql(alias));
});
