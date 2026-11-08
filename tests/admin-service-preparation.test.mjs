import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { registerHooks } from 'node:module';

import { parseServicePreparationDecision } from '../dist/apps/funding-api/src/admin-service-preparation.js';
import {
  loadServicePreparationFacts,
  servicePreparationScope
} from '../dist/apps/funding-api/src/admin-service-preparation-scope.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import { assertServicePreparationReadiness } from '../dist/apps/funding-api/src/admin-service-preparation-readiness.js';

const input = () => ({
  contributionId: randomUUID(),
  obligationId: randomUUID(),
  requestId: randomUUID(),
  expectedVersion: 'a'.repeat(64),
  confirmed: true,
  decision: 'approved'
});

test('exact service decisions require known scope, explicit confirmation, version and justified adverse decisions', () => {
  assert.equal(parseServicePreparationDecision(input()).decision, 'approved');
  for (const change of [
    { confirmed: false },
    { expectedVersion: 'old' },
    { obligationId: 'other' },
    { decision: 'cancelled' },
    { decision: 'rejected' },
    { decision: 'correction_requested', reason: 'short' },
    { decision: 'rejected', reason: null },
    { reason: 'x'.repeat(2001) },
    { published: true }
  ]) {
    assert.throws(
      () => parseServicePreparationDecision({ ...input(), ...change }),
      { code: 'RUN_INVALID_REQUEST', status: 400 }
    );
  }
  assert.equal(
    parseServicePreparationDecision({
      ...input(),
      decision: 'correction_requested',
      reason: '  Revise the selected title.  '
    }).reason,
    'Revise the selected title.'
  );
});

test('server policy allows service reads for readers but requires an operator for confirmed decisions, including API alias', () => {
  for (const prefix of ['', '/api']) {
    const path = prefix + '/admin/sponsorships/preparation/service';
    assert.equal(adminRoleAllows('reader', 'GET', path), true);
    assert.equal(adminRoleAllows('reader', 'POST', path + '/decision'), false);
    assert.equal(adminRoleAllows('operator', 'POST', path + '/decision'), true);
  }
});

test('exact service reviews fail closed on missing uniqueness, immutable history or database rights without leaking diagnostics', async () => {
  const database = (row) => ({
    query: async () => ({ rows: row ? [row] : [] })
  });
  const ready = { compatible: true, can_read: true, can_insert: true };
  await assertServicePreparationReadiness(database(ready), 'decide');
  for (const row of [null, { ...ready, compatible: false }])
    await assert.rejects(assertServicePreparationReadiness(database(row)), {
      code: 'PREPARATION_SCHEMA_INCOMPATIBLE',
      status: 503
    });
  for (const row of [
    { ...ready, can_read: false },
    { ...ready, can_insert: false }
  ])
    await assert.rejects(
      assertServicePreparationReadiness(database(row), 'decide'),
      { code: 'PREPARATION_DATABASE_ACCESS_DENIED', status: 503 }
    );
  await assert.rejects(
    assertServicePreparationReadiness({
      query: async () => {
        throw Object.assign(new Error('private SQL detail'), { code: '42501' });
      }
    }),
    {
      code: 'PREPARATION_DATABASE_ACCESS_DENIED',
      message: 'PREPARATION_DATABASE_ACCESS_DENIED'
    }
  );
});

test('service controls identify exact prepared content without treating missing or ambiguous drafts as success', () => {
  const service = {
    id: 'obligation',
    channel: 'website',
    target: 'openg7',
    ordinal: 1,
    obligationState: 'pending',
    content: { title: 'Real title', body: 'Real description' }
  };
  const draft = {
    id: 'draft',
    kind: 'website',
    version: '2',
    title: 'Real title',
    body: 'Real description',
    channel: 'website',
    target: 'openg7',
    status: 'private'
  };
  const dossier = {
    version: 'a'.repeat(64),
    payment: {
      amountMinor: 50000,
      currency: 'CAD',
      status: 'paid',
      confirmedAt: '2026-11-01T12:00:00Z'
    },
    acceptedOffer: {
      amountMinor: 50000,
      currency: 'CAD',
      benefits: [{ id: 'website_mention', requiredElements: ['company_name'] }]
    },
    balance: {
      obligations: [
        { id: 'obligation', benefitId: 'website_mention', version: 1 }
      ]
    },
    drafts: [draft],
    checks: [
      { code: 'content_prepared', state: 'missing' },
      { code: 'accepted_offer', state: 'complete' }
    ],
    authorizations: [],
    blockers: [{ code: 'publication_draft_missing' }]
  };
  const reviewFacts = {
    source: {
      commitment_state: 'active',
      offer_id: 'offer',
      public_display_consent: true,
      sponsor_review_status: 'approved',
      moderation_approved: true,
      sponsorship_refund_status: 'not_requested',
      sponsor_feed_status: 'not_planned',
      sponsor_company_name: 'Real title',
      sponsor_public_summary: 'Real description'
    },
    media: [],
    authorities: []
  };
  const reviewScope = (dossier, service) =>
    servicePreparationScope(dossier, service, reviewFacts);
  const scope = reviewScope(dossier, service);
  assert.equal(scope.draft.id, 'draft');
  assert.deepEqual(scope.blockers, []);
  const contributionId = '10000000-0000-4000-8000-000000000001';
  const base = `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}`;
  const withOwner = (adminUrl) =>
    servicePreparationScope(
      { ...dossier, drafts: [{ ...draft, adminUrl }] },
      { ...service, contributionId },
      reviewFacts
    );
  const previousOwner = withOwner(base + '&tab=publication');
  const currentOwner = withOwner(base + '&tab=media#dossier-website-settings');
  assert.equal(currentOwner.contentVersion, previousOwner.contentVersion);
  assert.equal(
    currentOwner.draft.adminUrl,
    base + '&tab=media#dossier-website-settings'
  );
  assert.deepEqual(
    scope.checks.map((x) => x.code),
    [
      'payment_confirmed',
      'accepted_offer',
      'public_consent',
      'sponsor_review',
      'moderation_review',
      'draft_moderation_review',
      'service_draft_identified'
    ]
  );
  assert.equal(
    scope.contentVersion,
    reviewScope(dossier, service).contentVersion
  );
  assert.equal(
    scope.contentVersion,
    reviewScope({ ...dossier, version: 'b'.repeat(64) }, service).contentVersion
  );
  for (const drafts of [[], [draft, { ...draft, id: 'ambiguous' }]]) {
    const unavailable = reviewScope({ ...dossier, drafts }, service);
    assert.equal(unavailable.draft, null);
    assert.equal(unavailable.checks.at(-1).state, 'missing');
    assert.match(
      unavailable.blockers.at(-1),
      /service_draft_(missing|ambiguous)/
    );
  }
  assert.ok(
    reviewScope(dossier, {
      ...service,
      obligationState: 'fulfilled'
    }).blockers.includes('service_closed')
  );
  for (const status of [
    'approved',
    'scheduled',
    'published',
    'cancelled',
    'rejected'
  ]) {
    assert.equal(
      reviewScope({ ...dossier, drafts: [{ ...draft, status }] }, service)
        .active,
      false
    );
  }
  for (const change of [
    { public_display_consent: false },
    { sponsor_review_status: 'pending_review' },
    { sponsorship_refund_status: 'requested' },
    { sponsor_company_name: 'Changed common identity' }
  ]) {
    const changed = servicePreparationScope(dossier, service, {
      ...reviewFacts,
      source: { ...reviewFacts.source, ...change }
    });
    assert.notEqual(changed.contentVersion, scope.contentVersion);
    assert.ok(changed.blockers.length > 0);
  }
  const otherBlocked = reviewScope(
    {
      ...dossier,
      blockers: [
        { code: 'obligation_blocked' },
        { code: 'required_media_missing' }
      ],
      balance: {
        obligations: [
          ...dossier.balance.obligations,
          {
            id: 'other',
            benefitId: 'linkedin_batch',
            state: 'blocked',
            version: 9
          }
        ]
      }
    },
    service
  );
  assert.deepEqual(otherBlocked.blockers, []);
  assert.equal(otherBlocked.contentVersion, scope.contentVersion);
  for (const changedDossier of [
    { ...dossier, payment: { ...dossier.payment, status: 'refunded' } },
    {
      ...dossier,
      acceptedOffer: { ...dossier.acceptedOffer, version: 'new-agreement' }
    }
  ]) {
    assert.notEqual(
      reviewScope(changedDossier, service).contentVersion,
      scope.contentVersion
    );
  }
});

test('media review scope excludes logos authorized only for another destination or not selected for the website', async () => {
  const rights = {
    state: 'confirmed',
    channels: ['website'],
    targets: ['openg7'],
    transformations: ['technical'],
    credit: null,
    restrictions: null
  };
  const logo = {
    id: 'website-logo',
    kind: 'logo',
    website_selected: true,
    usage_rights: rights
  };
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: sql.includes('sponsor_media_preparation_assignments')
          ? [{ revision: '0:' }]
          : calls.length === 1
            ? [{}]
            : calls.length === 2
              ? [
                  logo,
                  {
                    ...logo,
                    id: 'linkedin-logo',
                    usage_rights: { ...rights, channels: ['linkedin'] }
                  },
                  {
                    ...logo,
                    id: 'other-target',
                    usage_rights: { ...rights, targets: ['openg20'] }
                  },
                  { ...logo, id: 'not-selected', website_selected: false }
                ]
              : []
      };
    }
  };
  const result = await loadServicePreparationFacts(
    db,
    'contribution',
    { channel: 'website', target: 'openg7' },
    null,
    async () => ({ preparationObligations: [], preparationAssignments: [] })
  );
  assert.deepEqual(
    result.media.map((asset) => asset.id),
    ['website-logo']
  );
  assert.deepEqual(calls.at(-1).values, [
    'contribution',
    null,
    ['website-logo']
  ]);
});

test('private service assignments participate in exact review, preserve public selection and fence stale media and removed generations', () => {
  const service = {
    id: 'service',
    channel: 'website',
    target: 'openg7',
    ordinal: 1,
    obligationState: 'pending',
    content: { title: 'Synthetic company', body: 'Synthetic description' }
  };
  const draft = {
    id: 'draft',
    kind: 'website',
    version: '1',
    title: 'Synthetic company',
    body: 'Synthetic description',
    channel: 'website',
    target: 'openg7',
    status: 'private'
  };
  const dossier = {
    payment: {
      status: 'paid',
      confirmedAt: '2026-11-05T12:00:00Z',
      amountMinor: 50000,
      currency: 'CAD'
    },
    acceptedOffer: {
      amountMinor: 50000,
      currency: 'CAD',
      benefits: [{ id: 'web', requiredElements: ['approved_presentation'] }]
    },
    balance: { obligations: [{ id: 'service', benefitId: 'web' }] },
    drafts: [draft]
  };
  const media = {
    id: 'photo',
    version: 'photo-v1',
    kind: 'supporting_image',
    website_selected: false,
    review_status: 'approved',
    moderation_approved: true,
    usage_restrictions_reviewed: true,
    usage_rights: {
      state: 'confirmed',
      channels: ['website'],
      targets: ['openg7'],
      transformations: ['technical']
    }
  };
  const assignment = {
    id: 'assignment',
    obligationId: 'service',
    obligationVersion: 1,
    assetId: 'photo',
    assetVersion: 'photo-v1',
    stale: false
  };
  const facts = {
    source: {
      commitment_state: 'active',
      offer_id: 'offer',
      public_display_consent: true,
      sponsor_review_status: 'approved',
      moderation_approved: true,
      sponsorship_refund_status: 'not_requested',
      sponsor_company_name: 'Synthetic company',
      sponsor_public_summary: 'Synthetic description'
    },
    media: [media],
    authorities: [],
    preparationAssignments: [assignment],
    preparationRevision: '1:first'
  };
  const assigned = servicePreparationScope(dossier, service, facts);
  assert.deepEqual(assigned.blockers, []);
  assert.equal(media.website_selected, false);
  const stale = servicePreparationScope(dossier, service, {
    ...facts,
    preparationAssignments: [{ ...assignment, stale: true }]
  });
  assert.ok(stale.blockers.includes('prepared_media_stale'));
  assert.notEqual(stale.contentVersion, assigned.contentVersion);
  const mismatched = servicePreparationScope(dossier, service, {
    ...facts,
    media: [{ ...media, version: 'photo-v2' }]
  });
  assert.ok(mismatched.blockers.includes('prepared_media_unavailable'));
  const lostRights = servicePreparationScope(dossier, service, {
    ...facts,
    media: [
      { ...media, usage_rights: { ...media.usage_rights, state: 'withdrawn' } }
    ]
  });
  assert.ok(lostRights.blockers.includes('prepared_media_unavailable'));
  const initial = servicePreparationScope(dossier, service, {
    ...facts,
    preparationAssignments: [],
    preparationRevision: '0:'
  });
  const removed = servicePreparationScope(dossier, service, {
    ...facts,
    preparationAssignments: [],
    preparationRevision: '1:removed'
  });
  assert.notEqual(removed.contentVersion, initial.contentVersion);
  const unrelated = servicePreparationScope(dossier, service, {
    ...facts,
    preparationAssignments: [
      assignment,
      { ...assignment, id: 'other', obligationId: 'other-service' }
    ]
  });
  assert.equal(unrelated.contentVersion, assigned.contentVersion);
});

test('prepared drafts link to their current editor owner without changing the historical approval version', async () => {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier === './admin-responsibility-balance.service.js' &&
        context.parentURL?.includes(
          'admin-preparation.projection.js?owner-links'
        )
      )
        return {
          url: 'data:text/javascript,export const loadResponsibilityBalanceOnClient = async (db) => db.preparationBalance;',
          shortCircuit: true
        };
      return nextResolve(specifier, context);
    }
  });
  let projectPreparation, preparationDigest;
  try {
    ({ projectPreparation, preparationDigest } =
      await import('../dist/apps/funding-api/src/admin-preparation.projection.js?owner-links'));
  } finally {
    hook.deregister();
  }
  const contributionId = '10000000-0000-4000-8000-000000000001';
  const base = `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}`;
  const source = {
    amount_minor: 25000,
    currency: 'CAD',
    status: 'paid',
    paid_at: new Date('2026-11-08T12:00:00Z'),
    contribution_type: 'sponsorship_interest',
    sponsor_company_name: 'Synthetic company',
    sponsor_public_summary: 'Synthetic public summary',
    public_display_consent: true,
    sponsor_review_status: 'approved',
    sponsor_feed_status: 'not_planned',
    sponsorship_refund_status: 'not_requested',
    moderation_approved: true,
    content_version: 'content-v1',
    media_version: 'media-v1'
  };
  const offer = { benefits: [{ requiredElements: ['company_name'] }] };
  const social = {
    id: 'social-draft',
    obligation_id: 'social-passage',
    channel: 'facebook',
    feed_target: 'openg7',
    title: 'Synthetic social title',
    body: 'Synthetic social body',
    disclosure_text: 'Synthetic sponsorship disclosure',
    status: 'draft'
  };
  const balance = {
    unknown: 0,
    reasons: [],
    version: 'balance-v1',
    obligations: [
      {
        id: 'web-passage',
        channel: 'website',
        target: 'openg7',
        ordinal: 1,
        state: 'pending'
      },
      {
        id: 'social-passage',
        channel: 'facebook',
        target: 'openg7',
        ordinal: 1,
        state: 'pending'
      }
    ]
  };
  const db = {
    preparationBalance: balance,
    async query(sql) {
      assert.match(sql.trim(), /^SELECT/);
      if (sql.includes('SELECT c.amount_cents AS amount_minor'))
        return { rows: [source] };
      if (sql.includes('SELECT o.snapshot FROM sponsorship_commitments'))
        return { rows: [{ snapshot: offer }] };
      if (
        sql.includes('FROM sponsor_media_assets') &&
        sql.includes('SELECT a.id,a.kind')
      )
        return { rows: [] };
      if (sql.includes('FROM sponsor_publication_drafts'))
        return { rows: [social] };
      if (sql.includes('FROM contribution_activity'))
        return {
          rows: [
            {
              id: 'website-draft',
              revision: 2,
              snapshot: {
                state: 'prepared',
                cartouche: {
                  title: 'Synthetic company',
                  body: 'Synthetic public summary'
                }
              },
              source_version: 'content-v1|media-v1|prepared'
            }
          ]
        };
      if (
        sql.includes('FROM moderation_cases') ||
        sql.includes('FROM moderation_appeals')
      )
        return { rows: [] };
      throw new Error('Unexpected synthetic query');
    }
  };
  const receipt = await projectPreparation(db, {
    contribution_id: contributionId,
    reference: 'OG7-SYNTHETIC',
    amount_minor: '25000',
    currency: 'CAD'
  });
  assert.deepEqual(receipt.blockers, []);
  assert.equal(
    receipt.drafts[0].adminUrl,
    base + '&tab=media#dossier-website-settings'
  );
  assert.equal(receipt.drafts[0].status, 'private');
  assert.equal(
    receipt.drafts[1].adminUrl,
    `/admin/fundraiser/publications/drafts?sponsorshipId=${contributionId}&draftId=social-draft`
  );
  // Persisted approvals used this exact pre-refactor scope, including its old navigation URL.
  const historicalVersion = preparationDigest({
    contributionId,
    payment: receipt.payment,
    source,
    acceptedOffer: offer,
    balanceVersion: balance.version,
    checks: [
      { code: 'dossier_examined', state: 'complete' },
      ...receipt.checks
    ],
    authorizations: receipt.authorizations,
    drafts: receipt.drafts.map((draft) =>
      draft.kind === 'website'
        ? { ...draft, adminUrl: base + '&tab=publication' }
        : draft
    ),
    blockers: [],
    media: [],
    moderationAuthority: [],
    moderationAppeals: []
  });
  assert.equal(receipt.version, historicalVersion);
});
