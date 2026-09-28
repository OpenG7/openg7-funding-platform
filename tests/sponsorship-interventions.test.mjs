import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSponsorshipIntervention,
  sponsorshipFollowupState
} from '../dist/apps/funding-api/src/sponsorship-interventions.service.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

const request = {
  contributionId: '10000000-0000-4000-8000-000000000401',
  requestId: '10000000-0000-4000-8000-000000000402',
  kind: 'email',
  note: ' Relance effectuée.\nSans réponse. ',
  nextReviewOn: null
};
test('intervention notes validate private append-only input, dates and size', () => {
  assert.equal(
    parseSponsorshipIntervention(request).note,
    'Relance effectuée.\nSans réponse.'
  );
  assert.equal(
    parseSponsorshipIntervention({
      ...request,
      kind: 'extension',
      nextReviewOn: '2028-02-29'
    }).nextReviewOn,
    '2028-02-29'
  );
  for (const invalid of [
    null,
    [],
    {},
    'text',
    { ...request, note: '' },
    { ...request, note: ' ' },
    { ...request, note: 'x'.repeat(2001) },
    { ...request, note: 'a\0b' },
    { ...request, note: null },
    { ...request, kind: 'refund' },
    { ...request, actor: 'spoof' },
    { ...request, recordedAt: 'fake' },
    { ...request, amount: 1 },
    { ...request, requestId: 'wrong' },
    { ...request, contributionId: 'wrong' },
    { ...request, nextReviewOn: '2028-02-29' },
    { ...request, kind: 'extension' },
    ...['2026-02-29', '2026-13-01', '2026-2-01', 'tomorrow', undefined].map(
      (nextReviewOn) => ({ ...request, kind: 'extension', nextReviewOn })
    )
  ])
    assert.throws(() => parseSponsorshipIntervention(invalid), { status: 400 });
});
const now = new Date('2026-09-27T12:00:00Z');
const record = {
  paymentStatus: 'paid',
  refundStatus: 'not_requested',
  reviewStatus: 'pending_review',
  paidAt: '2026-09-01T12:00:00Z',
  detailsSubmittedAt: null,
  hasCompanyName: true,
  hasContactEmail: true,
  hasSupportingImage: true
};
test('incomplete dossier markers use confirmed payment and explicit extensions, never infer non-reading', () => {
  for (const [age, state] of [
    [0, 'waiting'],
    [6, 'waiting'],
    [7, 'first_reminder'],
    [13, 'first_reminder'],
    [14, 'second_reminder'],
    [29, 'second_reminder'],
    [30, 'decision_required'],
    [300, 'decision_required']
  ]) {
    const paidAt = new Date(now.getTime() - age * 86400000).toISOString();
    assert.deepEqual(
      sponsorshipFollowupState({ ...record, paidAt }, null, now),
      { state, ageDays: age, nextReviewOn: null }
    );
  }
  assert.equal(
    sponsorshipFollowupState(record, '2026-09-28', now).state,
    'extended'
  );
  assert.equal(
    sponsorshipFollowupState(record, '2026-09-27', now).state,
    'decision_required'
  );
  assert.equal(
    sponsorshipFollowupState(record, '2026-09-20', now).state,
    'decision_required'
  );
  assert.equal(
    sponsorshipFollowupState({ ...record, paidAt: null }, null, now).ageDays,
    null
  );
  assert.equal(
    sponsorshipFollowupState(
      { ...record, detailsSubmittedAt: '2026-09-01' },
      '2026-09-28',
      now
    ).state,
    'complete'
  );
  assert.equal(
    sponsorshipFollowupState(
      {
        ...record,
        detailsSubmittedAt: '2026-09-01',
        hasSupportingImage: false
      },
      null,
      now
    ).state,
    'second_reminder'
  );
  for (const changed of [
    { paymentStatus: 'pending' },
    { paymentStatus: 'refunded' },
    { refundStatus: 'requested' },
    { reviewStatus: 'rejected' }
  ])
    assert.equal(
      sponsorshipFollowupState({ ...record, ...changed }, '2026-09-28', now)
        .state,
      'inactive'
    );
});
test('readers can consult interventions, only operators and owners can append them', () => {
  for (const path of [
    '/admin/sponsorships/interventions',
    '/api/admin/sponsorships/interventions'
  ]) {
    for (const role of ['reader', 'operator', 'owner'])
      assert.equal(adminRoleAllows(role, 'GET', path), true);
    assert.equal(adminRoleAllows('reader', 'POST', path), false);
    assert.equal(adminRoleAllows('operator', 'POST', path), true);
    assert.equal(adminRoleAllows('owner', 'POST', path), true);
    assert.equal(adminRoleAllows('operator', 'DELETE', path), false);
  }
});
