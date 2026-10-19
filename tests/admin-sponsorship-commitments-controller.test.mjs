import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@openg7/funding-core'
      ? {
          url: new URL(
            '../dist/packages/funding-core/src/index.js',
            import.meta.url
          ).href,
          shortCircuit: true
        }
      : next(specifier, context);
  }
});
const { AdminSponsorshipCommitmentsController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-commitments-controller.js');
const { AdminDashboardRequestError } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js');
hook.deregister();
const id = '10000000-0000-4000-8000-000000000045',
  obId = '20000000-0000-4000-8000-000000000045';
function fixture() {
  const state = {
    owner: true,
    destroyed: false,
    dossier: {
      contributionId: id,
      amountMinor: 50000,
      currency: 'CAD',
      commitment: null
    },
    failure: null,
    result: null,
    changed: 0,
    reads: 0,
    readResult: null,
    nonces: 0
  };
  let m = {
    id: 'synthetic-commitment',
    contributionId: id,
    offerId: null,
    provenance: 'historical_unverified',
    state: 'needs_confirmation',
    qualificationReason: null,
    version: 1,
    offer: null,
    obligations: []
  };
  const calls = [];
  const send = async (kind, payload) => {
    calls.push({ kind, payload: structuredClone(payload) });
    if (state.failure) throw state.failure;
    if (state.result) return state.result;
    if (kind === 'qualify' || kind === 'assistance')
      m = {
        ...m,
        state: 'active',
        version: 2,
        provenance: 'qualified_historical',
        offer: kind === 'assistance' ? payload.draft.offer : payload.offer,
        obligations: [
          {
            id: obId,
            commitmentId: m.id,
            contributionId: id,
            benefitId: 'facebook_batch',
            channel: 'facebook',
            target: 'openg7',
            format: 'collective_text',
            ordinal: 1,
            state: 'pending',
            version: 1,
            blockedReason: null,
            fulfilmentEvidenceId: null
          }
        ]
      };
    else
      m = {
        ...m,
        version: m.version + 1,
        obligations: m.obligations.map((o) => ({
          ...o,
          version: o.version + 1,
          target: payload.target ?? o.target,
          format: payload.format ?? o.format,
          state: payload.kind === 'waiver' ? 'adjusted' : o.state
        }))
      };
    return { commitment: m };
  };
  const c = new AdminSponsorshipCommitmentsController({
    dossier: () => state.dossier,
    canOwn: () => state.owner,
    isDestroyed: () => state.destroyed,
    newRequestId: () =>
      `30000000-0000-4000-8000-${String(++state.nonces).padStart(12, '0')}`,
    get: async (value) => {
      assert.equal(value, state.dossier.contributionId);
      state.reads++;
      if (state.readResult) return state.readResult;
      return { commitment: m };
    },
    qualify: (p) => send('qualify', p),
    applyAssistance: (p) => send('assistance', p),
    adjust: (p) => send('adjust', p),
    changed: () => state.changed++,
    unauthorized: async () => {}
  });
  c.select();
  c.data.set(m);
  const fill = () => {
    c.addBenefit();
    for (const [key, value] of Object.entries({
      channel: 'facebook',
      target: 'openg20',
      quantity: '2',
      companyName: true
    }))
      c.updateBenefit(0, key, value);
    c.reason.set('Synthetic agreement verification');
    c.evidence.set('synthetic://agreement/45');
    c.confirmation.set(id);
  };
  return { c, state, calls, fill };
}
function assistanceSelection() {
  const item = {
    id: 'clause-1',
    citation: {
      sourceId: 'synthetic-source',
      sourceVersion: 1,
      start: 0,
      end: 8,
      excerpt: 'Facebook'
    },
    channels: ['facebook'],
    attention: 'human_mapping_required'
  };
  return {
    state: {
      contributionId: id,
      reference: 'SYNTHETIC-45',
      revision: 'synthetic-1',
      stale: false,
      source: {
        id: 'synthetic-source',
        version: 1,
        title: 'Private original agreement',
        text: 'Facebook',
        fingerprint: 'synthetic-fingerprint',
        createdAt: '2026-10-17T12:00:00Z'
      },
      commitment: {
        version: 1,
        state: 'needs_confirmation',
        amountMinor: 50000,
        currency: 'CAD'
      },
      capabilities: {
        canManageSource: true,
        canRun: true,
        canReview: true,
        canApply: true
      },
      run: {
        id: 'synthetic-run',
        sourceVersion: 1,
        commitmentVersion: 1,
        adapter: 'local_rules_v1',
        state: 'succeeded',
        phase: 'finished',
        errorCode: null,
        createdAt: '2026-10-17T12:00:00Z',
        finishedAt: '2026-10-17T12:00:00Z',
        review: null,
        application: null,
        suggestion: {
          adapter: 'local_rules_v1',
          proposedOffer: null,
          limitations: [],
          items: [item]
        }
      }
    },
    items: [
      {
        itemId: 'clause-1',
        disposition: 'included',
        benefitId: 'facebook_batch',
        note: 'Verified original clause'
      }
    ]
  };
}

test('assisted qualification applies the edited domain form exactly once without a parallel qualification command', async () => {
  const f = fixture();
  f.fill();
  f.c.chooseAssistance(assistanceSelection());
  assert.equal(f.c.confirmation(), '');
  f.c.confirmation.set(id);
  assert.equal(f.c.assistanceCanApply(), true);
  await f.c.qualify();
  assert.deepEqual(
    f.calls.map((call) => call.kind),
    ['assistance']
  );
  assert.equal(f.calls[0].payload.expectedCommitmentVersion, 1);
  assert.equal(f.calls[0].payload.sourceVersion, 1);
  assert.equal(f.calls[0].payload.expectedReviewVersion, 0);
  assert.equal(f.calls[0].payload.draft.offer.benefits[0].quantity, 2);
  assert.equal(f.state.changed, 1);
  assert.equal(f.c.assistance(), null);
});

test('permission invalidation removes private assistance and uncertain requests before another explicit selection', async () => {
  const f = fixture();
  f.fill();
  f.c.chooseAssistance(assistanceSelection());
  f.c.confirmation.set(id);
  f.state.failure = new AdminDashboardRequestError(
    503,
    'Synthetic transport failure'
  );
  await f.c.qualify();
  assert.ok(f.c.pending()?.assistance);
  assert.match(f.c.evidence(), /Private original agreement/);
  f.c.invalidateAssistance();
  assert.equal(f.c.assistance(), null);
  assert.equal(f.c.pending(), null);
  assert.equal(f.c.evidence(), '');
  assert.equal(f.c.reason(), '');
  assert.deepEqual(f.c.benefits(), []);
  assert.equal(f.c.assistanceCanApply(), false);
  f.state.failure = null;
  await f.c.retry();
  assert.equal(f.calls.length, 1);
});

test('an assisted apply denied by the server removes private source context and cannot be retried in the revoked permission scope', async () => {
  const f = fixture();
  f.fill();
  f.c.chooseAssistance(assistanceSelection());
  f.c.confirmation.set(id);
  f.state.failure = new AdminDashboardRequestError(403);
  await f.c.qualify();
  assert.equal(f.c.assistance(), null);
  assert.equal(f.c.pending(), null);
  assert.equal(f.c.evidence(), '');
  assert.equal(f.c.saving(), false);
  assert.equal(f.c.assistanceCanApply(), false);
  await f.c.retry();
  assert.equal(f.calls.length, 1);
});

test('a late assisted application response cannot restore private context or form state after permission invalidation', async () => {
  const f = fixture();
  f.fill();
  f.c.chooseAssistance(assistanceSelection());
  f.c.confirmation.set(id);
  let finish;
  f.state.result = new Promise((resolve) => (finish = resolve));
  const applying = f.c.qualify();
  assert.equal(f.calls.length, 1);
  f.c.invalidateAssistance();
  finish({ commitment: { ...f.c.data(), state: 'active', version: 2 } });
  await applying;
  assert.equal(f.c.data().version, 1);
  assert.equal(f.c.assistance(), null);
  assert.equal(f.c.saved(), false);
  assert.equal(f.state.changed, 0);
});

test('an earlier read cannot replace a newer commitment already supplied for the same dossier', async () => {
  for (const missing of [false, true]) {
    const f = fixture(),
      earlier = structuredClone(f.c.data());
    let finish;
    f.state.readResult = new Promise((resolve) => (finish = resolve));
    const reading = f.c.load();
    const newer = { ...earlier, version: 2, state: 'active' };
    f.state.dossier = { ...f.state.dossier, commitment: newer };
    f.c.select();
    assert.equal(f.c.data(), newer);
    finish({ commitment: missing ? null : earlier });
    await reading;
    assert.equal(f.c.data(), newer);
    assert.equal(f.c.loading(), false);
    await f.c.qualify();
    assert.equal(f.calls.length, 0);
  }
});
test('qualification starts with no inferred terms and preserves explicit quantities, periods and the original financial fact', async () => {
  const f = fixture();
  assert.deepEqual(f.c.benefits(), []);
  await f.c.qualify();
  assert.equal(f.calls.length, 0);
  f.fill();
  await f.c.qualify();
  const { payload } = f.calls[0];
  assert.equal(payload.expectedVersion, 1);
  assert.equal(payload.confirmation, id);
  assert.equal(payload.offer.version, 'historical-qualification-v1');
  assert.equal(payload.offer.amountMinor, 50000);
  assert.deepEqual(payload.offer.benefits, [
    {
      id: 'facebook_batch',
      channel: 'facebook',
      target: 'openg20',
      quantity: 2,
      requiredElements: ['company_name'],
      deadlineDays: null,
      durationDays: null
    }
  ]);
  assert.equal(f.state.changed, 1);
  assert.equal(f.c.pending(), null);
  assert.equal(f.c.saved(), true);
});
test('a promised exposure duration remains explicit and cannot be qualified without duration evidence support', async () => {
  const f = fixture();
  f.fill();
  f.c.updateBenefit(0, 'durationDays', '30');
  await f.c.qualify();
  assert.equal(f.c.error(), 'durationUnsupported');
  assert.equal(f.c.benefits()[0].durationDays, '30');
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.nonces, 0);
  assert.equal(f.c.data().state, 'needs_confirmation');
  assert.equal(f.c.pending(), null);
});

test('owner, evidence, explicit prerequisites and UUID confirmation are checked before mutation', async () => {
  for (const change of [
    (f) => (f.state.owner = false),
    (f) => f.c.evidence.set(''),
    (f) => f.c.reason.set(''),
    (f) => f.c.confirmation.set(obId),
    (f) => f.c.updateBenefit(0, 'companyName', false),
    (f) => f.c.updateBenefit(0, 'quantity', '1.5'),
    (f) => f.c.updateBenefit(0, 'format', 'image_collection')
  ]) {
    const f = fixture();
    f.fill();
    change(f);
    await f.c.qualify();
    assert.equal(f.calls.length, 0);
  }
});
test('uncertain qualification retains the original UUID, version and payload despite edited fields, reads or dossier changes', async () => {
  const f = fixture();
  f.fill();
  f.state.failure = new Error('Synthetic lost response');
  await f.c.qualify();
  assert.equal(f.c.error(), 'uncertain');
  const original = f.calls[0].payload;
  f.c.reason.set('A different draft must not replace the request');
  f.c.updateBenefit(0, 'quantity', '99');
  await f.c.load();
  await f.c.qualify();
  assert.equal(f.calls.length, 1);
  f.state.dossier = { ...f.state.dossier, contributionId: obId };
  f.c.select();
  assert.equal(f.c.pending(), null);
  f.state.dossier = { ...f.state.dossier, contributionId: id };
  f.c.select();
  assert.deepEqual(f.c.pending().payload, original);
  f.state.failure = null;
  await f.c.retry();
  assert.deepEqual(f.calls[1].payload, original);
  assert.equal(f.state.nonces, 1);
  assert.equal(f.c.saved(), true);
});
test('unconfirmed successful HTTP responses keep the command pending instead of displaying success', async () => {
  const f = fixture();
  f.fill();
  f.state.result = { commitment: null };
  await f.c.qualify();
  assert.equal(f.c.saved(), false);
  assert.ok(f.c.pending());
  assert.equal(f.state.changed, 0);
});
test('explicit destination, format and waiver adjustments use obligation versions and never rewrite the offer', async () => {
  const f = fixture();
  f.fill();
  await f.c.qualify();
  const offer = structuredClone(f.c.data().offer);
  for (const [kind, field, value] of [
    ['destination', 'target', 'openg20'],
    ['format', 'format', 'individual_portrait'],
    ['waiver', 'waiverAcknowledged', true]
  ]) {
    const version = f.c.data().obligations[0].version;
    f.c.chooseObligation(obId);
    f.c.adjustment.set(kind);
    f.c[field].set(value);
    f.c.reason.set('Synthetic amendment');
    f.c.confirmation.set(obId);
    await f.c.adjust();
    const input = f.calls.at(-1).payload;
    assert.equal(input.expectedVersion, version);
    assert.equal(input.obligationId, obId);
    assert.deepEqual(f.c.data().offer, offer);
  }
  f.c.chooseObligation(obId);
  f.c.adjustment.set('destination');
  f.c.target.set('openg7');
  f.c.reason.set('Synthetic terminal mutation');
  f.c.confirmation.set(obId);
  const count = f.calls.length;
  await f.c.adjust();
  assert.equal(f.calls.length, count);
});
test('definite version conflicts require a read and a new explicitly confirmed command', async () => {
  const f = fixture();
  f.fill();
  f.state.failure = new AdminDashboardRequestError(
    409,
    'Synthetic version conflict',
    'COMMITMENT_VERSION_CONFLICT'
  );
  await f.c.qualify();
  assert.equal(f.c.error(), 'conflict');
  assert.equal(f.c.pending(), null);
  await f.c.load();
  assert.equal(f.state.reads, 1);
  f.state.failure = null;
  f.c.confirmation.set(id);
  await f.c.qualify();
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].payload.requestId, f.calls[1].payload.requestId);
  assert.equal(f.state.changed, 1);
});
