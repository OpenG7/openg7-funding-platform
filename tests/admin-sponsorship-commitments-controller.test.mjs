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
    if (kind === 'qualify')
      m = {
        ...m,
        state: 'active',
        version: 2,
        provenance: 'qualified_historical',
        offer: payload.offer,
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
    adjust: (p) => send('adjust', p),
    adoption: async (size, cursor) => {
      calls.push({ kind: 'preview', size, cursor });
      return { items: [], pageSize: size, nextCursor: null };
    },
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
test('definite version conflicts require a read and a new explicitly confirmed command; preview is bounded and read only', async () => {
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
  f.state.owner = false;
  await f.c.loadPreview();
  assert.equal(f.calls.length, 1);
  f.state.owner = true;
  f.c.pageSize.set(50);
  await f.c.loadPreview();
  assert.deepEqual(f.calls.at(-1), {
    kind: 'preview',
    size: 50,
    cursor: undefined
  });
  assert.equal(f.state.changed, 0);
});
