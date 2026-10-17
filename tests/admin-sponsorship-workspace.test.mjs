import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dossierTabState,
  isDossierPublicationComplete,
  publicationBlockerSection,
  publicationBlockerTab,
  qualifiedPublicationEvidence,
  workspaceTab
} from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsorship-workspace.js';

const dossier = (overrides = {}) => ({
  milestones: [],
  failedStripeEvents: [],
  failedEmails: [],
  refund: {
    workflow: 'none',
    state: 'not_required',
    confirmedAmountMinor: 0,
    hasError: false,
    creditMissing: false
  },
  ...overrides
});

test('tab indicators stay absent without server facts and for resolved milestones', () => {
  for (const tab of [
    'overview',
    'identity',
    'publication',
    'billing',
    'audit'
  ]) {
    assert.equal(dossierTabState(null, tab), null);
    assert.equal(dossierTabState(dossier(), tab), null);
  }
  for (const state of ['complete', 'not_required', 'cancelled']) {
    assert.equal(
      dossierTabState(
        dossier({ milestones: [{ tab: 'media', state }] }),
        'identity'
      ),
      null
    );
  }
});

test('profile and finance aliases share the most severe unresolved server state', () => {
  const snapshot = dossier({
    milestones: [
      { tab: 'identity', state: 'pending' },
      { tab: 'media', state: 'blocked' },
      { tab: 'billing', state: 'partial' }
    ]
  });
  const before = structuredClone(snapshot);
  assert.equal(workspaceTab('media'), 'identity');
  assert.equal(workspaceTab('refund'), 'billing');
  assert.equal(dossierTabState(snapshot, 'identity'), 'blocked');
  assert.equal(dossierTabState(snapshot, 'media'), 'blocked');
  assert.equal(dossierTabState(snapshot, 'billing'), 'partial');
  assert.equal(dossierTabState(snapshot, 'refund'), 'partial');
  assert.equal(dossierTabState(snapshot, 'overview'), null);
  assert.deepEqual(snapshot, before);
});

test('financial incidents retain their own tab and take priority over pending work', () => {
  assert.equal(
    dossierTabState(
      dossier({ failedStripeEvents: [{ id: 'evt_demo' }] }),
      'overview'
    ),
    'error'
  );
  assert.equal(
    dossierTabState(
      dossier({ failedEmails: [{ id: 'email_demo', status: 'uncertain' }] }),
      'billing'
    ),
    'error'
  );
  const snapshot = dossier();
  assert.equal(
    dossierTabState(
      { ...snapshot, refund: { ...snapshot.refund, creditMissing: true } },
      'billing'
    ),
    'blocked'
  );
  assert.equal(
    dossierTabState(
      {
        ...snapshot,
        refund: { ...snapshot.refund, workflow: 'requested', state: 'pending' }
      },
      'refund'
    ),
    'pending'
  );
  assert.equal(dossierTabState(snapshot, 'audit'), null);
});

test('publication blockers navigate to their owning section', () => {
  for (const [reason, tab, section] of [
    ['media', 'media', 'media'],
    ['identity', 'identity', 'identity'],
    ['hidden', 'publication', 'publication'],
    ['commitment_needs_confirmation', 'publication', 'publication'],
    ['commitment_blocked', 'publication', 'publication'],
    ['refund', 'refund', 'refund'],
    ['review', 'overview', 'review'],
    ['payment', 'overview', 'payment'],
    ['consent', 'overview', 'payment'],
    ['unknown_future_reason', 'overview', 'payment']
  ]) {
    assert.equal(publicationBlockerTab(reason), tab);
    assert.equal(publicationBlockerSection(reason), section);
  }
});

const publicationDossier = () =>
  dossier({
    commitment: {
      state: 'active',
      offer: { benefits: [] },
      obligations: [
        {
          id: 'obligation-demo',
          state: 'fulfilled',
          channel: 'facebook',
          target: 'openg7',
          fulfilmentEvidenceId: 'evidence-demo'
        }
      ]
    },
    qualifiedFulfilmentEvidenceIds: ['evidence-demo'],
    fulfilmentEvidence: [
      {
        id: 'evidence-demo',
        obligationId: 'obligation-demo',
        channel: 'facebook',
        target: 'openg7'
      }
    ]
  });

test('publication completion follows the server workflow when present', () => {
  assert.equal(isDossierPublicationComplete(dossier()), false);
  assert.equal(
    isDossierPublicationComplete(
      dossier({
        publicationWorkflow: { state: 'complete' }
      })
    ),
    true
  );
  for (const state of [
    'waiting',
    'action_required',
    'blocked',
    'error',
    'uncertain'
  ]) {
    assert.equal(
      isDossierPublicationComplete({
        ...publicationDossier(),
        publicationWorkflow: { state }
      }),
      false
    );
  }
});

test('older publication snapshots require active commitments and exact qualified evidence', () => {
  const valid = publicationDossier();
  const before = structuredClone(valid);
  assert.equal(isDossierPublicationComplete(valid), true);
  assert.equal(
    qualifiedPublicationEvidence(valid, 'obligation-demo'),
    valid.fulfilmentEvidence[0]
  );
  assert.equal(
    qualifiedPublicationEvidence(valid, 'another-obligation'),
    undefined
  );
  assert.deepEqual(valid, before);

  const invalidSnapshots = [
    { ...valid, qualifiedFulfilmentEvidenceIds: undefined },
    { ...valid, qualifiedFulfilmentEvidenceIds: [] },
    { ...valid, fulfilmentEvidence: [] },
    { ...valid, commitment: { ...valid.commitment, state: 'pending' } },
    { ...valid, commitment: { ...valid.commitment, offer: null } },
    { ...valid, commitment: { ...valid.commitment, obligations: [] } }
  ];
  for (const evidenceOverride of [
    { id: 'another-evidence' },
    { obligationId: 'another-obligation' },
    { channel: 'linkedin' },
    { target: 'openg20' }
  ])
    invalidSnapshots.push({
      ...valid,
      fulfilmentEvidence: [
        { ...valid.fulfilmentEvidence[0], ...evidenceOverride }
      ]
    });
  for (const state of ['open', 'blocked', 'cancelled'])
    invalidSnapshots.push({
      ...valid,
      commitment: {
        ...valid.commitment,
        obligations: [{ ...valid.commitment.obligations[0], state }]
      }
    });
  for (const snapshot of invalidSnapshots)
    assert.equal(isDossierPublicationComplete(snapshot), false);
});

test('recorded adjustments can complete a qualified older agreement without fabricated delivery', () => {
  const valid = publicationDossier();
  const snapshot = {
    ...valid,
    fulfilmentEvidence: [],
    qualifiedFulfilmentEvidenceIds: [],
    commitment: {
      ...valid.commitment,
      obligations: [{ ...valid.commitment.obligations[0], state: 'adjusted' }]
    }
  };
  assert.equal(isDossierPublicationComplete(snapshot), true);
  assert.equal(
    qualifiedPublicationEvidence(snapshot, 'obligation-demo'),
    undefined
  );
});
