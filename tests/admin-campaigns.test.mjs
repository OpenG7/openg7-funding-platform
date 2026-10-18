import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminCampaignsService,
  loadAdminCampaignsOnClient
} from '../dist/apps/funding-api/src/admin-campaigns.service.js';
import { compareAdminCampaigns } from '../dist/apps/funding-api/src/admin-campaigns-query.js';
import { projectSponsorshipPublicationWorkflow } from '../dist/apps/funding-api/src/sponsorship-progress-workflow.js';

const now = new Date('2026-10-18T12:00:00Z');
const query = { page: 1, pageSize: 25, sort: 'preparation', direction: 'desc' };

test('service uses the actual source query in a read-only consistent snapshot, even when empty', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'release' });
    }
  };
  const result = await new AdminCampaignsService({
    async connect() {
      return db;
    }
  }).list(query, now);
  assert.equal(result.pagination.totalItems, 0);
  assert.deepEqual(result.items, []);
  assert.match(calls[0].sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(calls[1].sql, /c\.paid_at IS NOT NULL/);
  assert.match(calls[1].sql, /sponsorship_obligations/);
  assert.doesNotMatch(calls[1].sql, /c\.status\s*=\s*'paid'/);
  assert.equal(calls[2].sql, 'COMMIT');
  assert.equal(calls[3].sql, 'release');
  assert.deepEqual(calls[1].values, [null, null, null, null, null]);
});

test('exact campaign scopes bind dossier and passage UUIDs in the database read', async () => {
  const sponsorshipId = 'a1000000-0000-4000-8000-000000000001';
  const obligationId = 'b2000000-0000-4000-8000-000000000026';
  const calls = [];
  await loadAdminCampaignsOnClient(
    {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [] };
      }
    },
    { ...query, sponsorshipId, obligationId },
    now
  );
  assert.match(calls[0].sql, /c\.id=\$4::uuid/);
  assert.match(calls[0].sql, /ob\.id=\$5::uuid/);
  assert.doesNotMatch(calls[0].sql, new RegExp(sponsorshipId));
  assert.deepEqual(calls[0].values, [
    null,
    null,
    null,
    sponsorshipId,
    obligationId
  ]);
});

function source(
  index,
  {
    quantity = 1,
    channel = 'website',
    approval = null,
    version = 'current'
  } = {}
) {
  const id = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const benefitId =
    channel === 'website' ? 'website_mention' : channel + '_batch';
  return {
    contribution_id: id,
    reference: 'SYNTHETIC-' + index,
    amount_minor: '50000',
    currency: 'CAD',
    companyName: 'Synthetic company ' + index,
    paidAt: new Date(now.getTime() + index * 1000).toISOString(),
    approval,
    version,
    commitment: {
      id: 'commitment-' + id,
      contributionId: id,
      offerId: 'offer-' + id,
      provenance: 'accepted_offer',
      state: 'active',
      version: 1,
      qualificationReason: null,
      offer: {
        amountMinor: 50000,
        currency: 'CAD',
        version: 'synthetic-v1',
        benefits: [
          {
            id: benefitId,
            channel,
            target: 'openg7',
            quantity,
            requiredElements: ['company_name'],
            deadlineDays: null,
            durationDays: null
          }
        ]
      },
      obligations: Array.from({ length: quantity }, (_, n) => ({
        id: 'obligation-' + id + '-' + (n + 1),
        contributionId: id,
        commitmentId: 'commitment-' + id,
        benefitId,
        channel,
        target: 'openg7',
        ordinal: n + 1,
        state: 'pending',
        blockedReason: null,
        version: 1,
        fulfilmentEvidenceId: null
      }))
    }
  };
}

function fixture(sources) {
  const calls = { preparation: [], progress: [] };
  return {
    calls,
    async list(filters = {}) {
      return loadAdminCampaignsOnClient({}, { ...query, ...filters }, now, {
        async sources() {
          return sources;
        },
        async preparation(_db, item) {
          calls.preparation.push(item.contribution_id);
          return {
            version: item.version,
            status: item.blocked ? 'incomplete' : 'ready',
            blockers: item.blocked ? [{ code: 'sponsor_review_required' }] : [],
            drafts: item.drafts ?? []
          };
        },
        async progress(_db, item) {
          calls.progress.push(item.contribution_id);
          return {
            commitment: item.commitment,
            publications: item.publications ?? [],
            qualifiedFulfilmentEvidenceIds: item.qualified ?? [],
            fulfilmentEvidence: item.evidence ?? [],
            publicationWorkflow: projectSponsorshipPublicationWorkflow(
              item.commitment,
              item.publications ?? [],
              item.blocked ? ['review'] : [],
              now,
              item.qualified ?? []
            )
          };
        }
      });
    }
  };
}

test('exact dossier scopes retain multiple passages and resolve a passage beyond the first page', async () => {
  const dossier = source(1, { quantity: 30, channel: 'facebook' });
  const other = source(2, {
    approval: { version: 'current', approvedAt: now.toISOString() }
  });
  const target = dossier.commitment.obligations[25];
  const unscoped = await fixture([dossier, other]).list();
  assert.equal(
    unscoped.items.some((item) => item.id === target.id),
    false
  );

  const scope = { sponsorshipId: dossier.contribution_id };
  const first = await fixture([dossier, other]).list(scope);
  const second = await fixture([dossier, other]).list({ ...scope, page: 2 });
  assert.equal(first.pagination.totalItems, 30);
  assert.equal(first.pagination.totalPages, 2);
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 5);
  assert.ok(
    [...first.items, ...second.items].every(
      (item) => item.contributionId === dossier.contribution_id
    )
  );

  const exact = fixture([dossier, other]);
  const response = await exact.list({ ...scope, obligationId: target.id });
  assert.equal(response.pagination.totalItems, 1);
  assert.equal(response.pagination.totalPages, 1);
  assert.equal(response.items[0].id, target.id);
  assert.equal(response.items[0].ordinal, 26);
  assert.deepEqual(exact.calls.preparation, [dossier.contribution_id]);
  assert.deepEqual(exact.calls.progress, [dossier.contribution_id]);
});

test('missing or mismatched campaign scopes remain empty without projecting another dossier', async () => {
  const dossier = source(1, { quantity: 3 });
  const other = source(2, {
    approval: { version: 'current', approvedAt: now.toISOString() }
  });
  for (const scope of [
    { sponsorshipId: '99999999-0000-4000-8000-000000000001' },
    {
      sponsorshipId: dossier.contribution_id,
      obligationId: other.commitment.obligations[0].id
    },
    {
      sponsorshipId: dossier.contribution_id,
      obligationId: '99999999-0000-4000-8000-000000000002'
    }
  ]) {
    const f = fixture([dossier, other]);
    const response = await f.list(scope);
    assert.equal(response.pagination.totalItems, 0);
    assert.deepEqual(response.items, []);
    assert.deepEqual(f.calls, { preparation: [], progress: [] });
  }
  await assert.rejects(
    fixture([dossier]).list({
      obligationId: dossier.commitment.obligations[0].id
    }),
    (error) =>
      error.code === 'CAMPAIGNS_INVALID_REQUEST' && error.status === 400
  );
});

test('global current preparation priority precedes pagination, without dropping unapproved promised work', async () => {
  const sources = Array.from({ length: 60 }, (_, n) => source(n + 1));
  sources[0].approval = {
    version: 'current',
    approvedAt: '2026-10-17T12:00:00Z'
  };
  sources[1].approval = {
    version: 'obsolete',
    approvedAt: '2026-10-17T13:00:00Z'
  };
  const f = fixture(sources);
  const first = await f.list();
  assert.equal(first.pagination.totalItems, 60);
  assert.equal(first.pagination.totalPages, 3);
  assert.equal(first.items[0].contributionId, sources[0].contribution_id);
  assert.equal(first.items[0].preparation.status, 'approved');
  assert.equal(first.items[1].contributionId, sources[59].contribution_id);
  assert.equal(first.items[1].preparation.status, 'ready');
  assert.equal(first.items[0].workflow.state, 'action_required');
  assert.equal(f.calls.preparation.length, 26); // 2 historical plus 24 other page dossiers.
  assert.equal(new Set(f.calls.preparation).size, 26);
  assert.equal(f.calls.progress.length, 25);
  const last = await fixture(sources).list({ page: 3 });
  const stale = last.items.find(
    (item) => item.contributionId === sources[1].contribution_id
  );
  assert.equal(stale.preparation.status, 'review_required');
  assert.equal(stale.preparation.approvedAt, null);
  assert.equal(last.pagination.hasNextPage, false);
});

test('repeated passages share dossier work, preserve ordinals and do not borrow another passage content', async () => {
  const item = source(1, { quantity: 3, channel: 'facebook' });
  item.drafts = [
    {
      id: 'draft-1',
      channel: 'facebook',
      target: 'openg7',
      kind: 'publication',
      title: 'Synthetic exact draft',
      body: 'Private prepared body'
    }
  ];
  item.publications = [
    {
      id: 'draft-1',
      obligationId: item.commitment.obligations[0].id,
      channel: 'facebook',
      target: 'openg7',
      status: 'draft'
    }
  ];
  const f = fixture([item]);
  const result = await f.list();
  assert.equal(result.items.length, 3);
  assert.deepEqual(
    result.items.map((row) => [row.ordinal, row.quantity]),
    [
      [1, 3],
      [2, 3],
      [3, 3]
    ]
  );
  assert.deepEqual(result.items[0].content, {
    title: 'Synthetic exact draft',
    body: 'Private prepared body'
  });
  assert.equal(result.items[1].content, null);
  assert.equal(result.items[1].workflow.state, 'waiting');
  assert.equal(f.calls.preparation.length, 1);
  assert.equal(f.calls.progress.length, 1);
});

test('qualified evidence, simulation, preparation and delivery remain separate', async () => {
  const delivered = source(1, { channel: 'facebook', quantity: 2 });
  const unqualified = delivered.commitment.obligations[1];
  const qualified = delivered.commitment.obligations[0];
  Object.assign(qualified, {
    state: 'fulfilled',
    fulfilmentEvidenceId: 'qualified-proof',
    version: 2
  });
  Object.assign(unqualified, {
    state: 'fulfilled',
    fulfilmentEvidenceId: 'legacy-proof',
    version: 2
  });
  delivered.qualified = ['qualified-proof'];
  delivered.evidence = [qualified, unqualified].map((obligation) => ({
    id: obligation.fulfilmentEvidenceId,
    obligationId: obligation.id,
    deliveryId: 'delivery',
    channel: 'facebook',
    target: 'openg7',
    provenance: 'provider_acknowledged',
    deliveredAt: '2026-10-17T12:00:00Z',
    externalPostUrl: 'https://social.example.invalid/post',
    visibility: 'unknown',
    visibilityObservedAt: null
  }));
  const simulated = source(2, {
    channel: 'facebook',
    approval: { version: 'current', approvedAt: now.toISOString() }
  });
  simulated.publications = [
    {
      id: 'mock-draft',
      obligationId: simulated.commitment.obligations[0].id,
      channel: 'facebook',
      target: 'openg7',
      status: 'published',
      deliveryMode: 'mock',
      deliveryStatus: 'published'
    }
  ];
  const result = await fixture([delivered, simulated]).list();
  const rows = Object.fromEntries(result.items.map((row) => [row.id, row]));
  assert.equal(rows[qualified.id].workflow.state, 'complete');
  assert.equal(rows[qualified.id].proof.id, 'qualified-proof');
  assert.equal(rows[unqualified.id].workflow.reason, 'fulfilment_unverified');
  assert.equal(rows[unqualified.id].proof, null);
  assert.equal(result.items[0].preparation.status, 'approved');
  assert.equal(result.items[0].workflow.reason, 'publication_simulation');
  assert.equal(result.items[0].proof, null);
  delivered.qualified = [];
  assert.equal(
    (await fixture([delivered]).list({ state: 'complete' })).pagination
      .totalItems,
    0
  );
});

test('workflow filters apply to all dossiers before counts and pages; blocking retains obligations', async () => {
  const sources = Array.from({ length: 80 }, (_, n) => source(n + 1));
  for (const item of sources.slice(0, 30)) {
    item.blocked = true;
    Object.assign(item.commitment.obligations[0], {
      state: 'blocked',
      blockedReason: 'payment_refunded'
    });
  }
  const result = await fixture(sources).list({ state: 'blocked', page: 2 });
  assert.equal(result.pagination.totalItems, 30);
  assert.equal(result.items.length, 5);
  assert.ok(
    result.items.every(
      (row) => row.workflow.state === 'blocked' && row.proof === null
    )
  );
  const empty = await fixture(sources).list({ page: 10 });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.pagination.totalItems, 80);
});

test('contractual dates keep null last in both directions and stable passage order on ties', () => {
  const base = {
    contributionId: 'a',
    channel: 'website',
    target: 'openg7',
    paidAt: now.toISOString(),
    approved: false
  };
  const rows = [
    { ...base, id: 'second', ordinal: 2, dueAt: now.toISOString() },
    { ...base, id: 'null', ordinal: 3, dueAt: null },
    { ...base, id: 'first', ordinal: 1, dueAt: now.toISOString() }
  ];
  for (const direction of ['asc', 'desc'])
    assert.deepEqual(
      [...rows]
        .sort((a, b) =>
          compareAdminCampaigns(a, b, { sort: 'due_at', direction })
        )
        .map((row) => row.id),
      ['first', 'second', 'null']
    );
});
