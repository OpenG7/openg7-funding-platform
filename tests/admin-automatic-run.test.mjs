import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminAutomaticRun,
  automaticAdminUrl,
  automaticPagePlan,
  automaticPaymentPlan
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-run.js';
import { ADMIN_GUIDANCE_PAGES } from '../dist/apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-pages.js';

const payment = '10000000-0000-4000-8000-000000000811';
const otherPayment = '10000000-0000-4000-8000-000000000812';

function plan(pageId = 'sponsors', changes = {}) {
  return {
    ...automaticPagePlan(pageId),
    key: 'step:' + pageId,
    reason: 'review:' + pageId,
    contributionId: payment,
    ...changes
  };
}

const completedPlan = () =>
  plan('contributions', {
    key: 'complete',
    reason: 'complete',
    state: 'complete'
  });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function fixture(initial = plan()) {
  const state = {
    plan: initial,
    current: true,
    canLeave: true,
    navigateResult: true,
    presentResult: 'prepared',
    readGate: null,
    explainGate: null,
    presentGate: null,
    readError: null,
    calls: [],
    snapshots: []
  };
  const ports = {
    async read() {
      state.calls.push({ port: 'read' });
      const result = structuredClone(state.plan);
      const gate = state.readGate;
      const error = state.readError;
      if (gate) await gate.promise;
      if (error) throw error;
      return result;
    },
    current: () => state.current,
    canLeavePage: () => state.canLeave,
    async explain() {
      state.calls.push({ port: 'explain' });
      const gate = state.explainGate;
      if (gate) await gate.promise;
    },
    async navigate(next) {
      state.calls.push({ port: 'navigate', plan: next });
      return state.navigateResult;
    },
    async present(next, preparationId) {
      state.calls.push({ port: 'present', plan: next, preparationId });
      const gate = state.presentGate;
      const result = state.presentResult;
      if (gate) await gate.promise;
      return result;
    },
    changed: (snapshot) => state.snapshots.push(snapshot)
  };
  const run = new AdminAutomaticRun(ports);
  return {
    state,
    ports,
    run,
    snapshot: () => state.snapshots.at(-1),
    calls: (port) => state.calls.filter((call) => call.port === port)
  };
}

async function reached(f, port) {
  for (let turn = 0; turn < 20; turn++) {
    if (f.calls(port).length) return;
    await Promise.resolve();
  }
  assert.fail('Expected pending ' + port + ' operation.');
}

test('successive server recommendations visit their own workspaces and finish only after server completion', async () => {
  const f = fixture();
  await f.run.start();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  f.state.plan = plan('invoices');
  await f.run.verify();
  f.state.plan = plan('publications');
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  f.state.plan = completedPlan();
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'complete');
  assert.equal(f.run.active, false);
  assert.deepEqual(
    f.calls('navigate').map((call) => call.plan.pageId),
    ['sponsors', 'invoices', 'publications']
  );
  assert.equal(f.calls('present').length, 3);
  assert.ok(
    f.calls('present').every((call) => call.preparationId === undefined)
  );
  assert.ok(
    f.state.calls.every((call) =>
      ['read', 'explain', 'navigate', 'present'].includes(call.port)
    ),
    'The runner has no business execution, submission or confirmation port.'
  );
  assert.ok(f.snapshot().events.length <= 12);
});

test('choosing a preparation rereads the server and explains before opening the exact reviewed preparation', async () => {
  const f = fixture();
  await f.run.start();
  f.state.calls.length = 0;
  await f.run.prepare('sponsor.media.preview:synthetic-asset');
  assert.deepEqual(
    f.state.calls.map((call) => call.port),
    ['read', 'explain', 'present']
  );
  assert.equal(
    f.calls('present')[0].preparationId,
    'sponsor.media.preview:synthetic-asset'
  );
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
});

test('each visit exposes its explanation, navigation and preparation as separate observable phases', async () => {
  const f = fixture();
  await f.run.start();
  assert.deepEqual(
    f.state.snapshots.map((snapshot) => snapshot.phase),
    [
      'reading',
      'explaining',
      'navigating',
      'preparing',
      'awaiting_confirmation'
    ]
  );
  assert.ok(
    f.state.snapshots
      .slice(1)
      .every((snapshot) => snapshot.events.at(-1).reason === 'review:sponsors')
  );
});

test('a changed recommendation discards a choice made for the previous dossier step', async () => {
  const f = fixture();
  await f.run.start();
  f.state.calls.length = 0;
  f.state.plan = plan('invoices');
  await f.run.prepare('sponsor.media.preview:previous-asset');
  assert.deepEqual(
    f.state.calls.map((call) => call.port),
    ['read', 'explain', 'navigate', 'present']
  );
  assert.equal(f.calls('present')[0].preparationId, undefined);
  assert.equal(f.calls('present')[0].plan.pageId, 'invoices');
});

test('server completion during a preparation read opens no outdated form', async () => {
  const f = fixture();
  await f.run.start();
  f.state.calls.length = 0;
  f.state.plan = completedPlan();
  await f.run.prepare('obsolete-preview');
  assert.deepEqual(f.state.calls, [{ port: 'read' }]);
  assert.equal(f.snapshot().phase, 'complete');
});

test('a successful action signal with unchanged facts never advances or marks an obligation fulfilled', async () => {
  const f = fixture();
  await f.run.start();
  f.state.calls.length = 0;
  await f.run.verify();
  await f.run.verify();
  assert.deepEqual(f.state.calls, [{ port: 'read' }, { port: 'read' }]);
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  assert.equal(f.snapshot().plan.state, 'action_required');
  assert.equal(f.run.active, true);
});

test('a waiting obligation remains waiting without repeated navigation and resumes when the server changes its step', async () => {
  const f = fixture(plan('sponsors', { state: 'waiting' }));
  await f.run.start();
  assert.equal(f.snapshot().phase, 'waiting');
  assert.equal(f.calls('present').length, 0);
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'waiting');
  assert.equal(f.calls('navigate').length, 1);
  f.state.plan = plan('publications');
  await f.run.verify();
  assert.equal(f.calls('navigate').length, 2);
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
});

test('a waiting server step cannot open a preparation even through a stale explicit choice', async () => {
  const f = fixture(
    plan('automation', {
      state: 'waiting',
      reason: 'publication_scheduled',
      responsibility: 'platform'
    })
  );
  await f.run.start();
  f.state.calls.length = 0;
  await f.run.prepare('publication.compose');
  assert.deepEqual(f.state.calls, [{ port: 'read' }]);
  assert.equal(f.snapshot().phase, 'waiting');
  assert.equal(f.snapshot().plan.responsibility, 'platform');
});

test('a publication that becomes waiting during preparation verification never opens the old action', async () => {
  const f = fixture(
    plan('automation', { reason: 'publication_authorization_required' })
  );
  await f.run.start();
  f.state.calls.length = 0;
  f.state.plan = {
    ...f.state.plan,
    state: 'waiting',
    responsibility: 'platform'
  };
  await f.run.prepare('publication.compose');
  assert.deepEqual(f.state.calls, [{ port: 'read' }]);
  assert.equal(f.snapshot().phase, 'waiting');
});

test('an open dialogue defers a changed recommendation until the dialogue closes', async () => {
  const f = fixture();
  await f.run.start();
  f.state.canLeave = false;
  f.state.plan = plan('invoices');
  await f.run.verify();
  await f.run.verify();
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(f.calls('present').length, 1);
  f.state.canLeave = true;
  await f.run.verify();
  assert.equal(f.calls('navigate').length, 2);
  assert.equal(f.calls('navigate')[1].plan.pageId, 'invoices');
  assert.equal(f.calls('present').length, 2);
});

test('starting behind an open dialogue resumes its deferred visit after the dialogue closes', async () => {
  const f = fixture();
  f.state.canLeave = false;
  await f.run.start();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  assert.equal(f.calls('navigate').length, 0);
  assert.equal(f.calls('present').length, 0);
  f.state.canLeave = true;
  await f.run.verify();
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(f.calls('present').length, 1);
});

test('starting from completed server facts waits for the outstanding dialogue or receipt lock to clear', async () => {
  const f = fixture(completedPlan());
  f.state.canLeave = false;
  await f.run.start();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  assert.equal(f.run.active, true);
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  f.state.canLeave = true;
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'complete');
  assert.equal(f.run.active, false);
  assert.equal(f.calls('navigate').length, 0);
  assert.equal(f.calls('present').length, 0);
});

test('verification cannot announce completion while a dialogue or unresolved receipt still owns the page', async () => {
  const f = fixture();
  await f.run.start();
  f.state.canLeave = false;
  f.state.plan = completedPlan();
  await f.run.verify();
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  assert.equal(f.run.active, true);
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(f.calls('present').length, 1);
  f.state.canLeave = true;
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'complete');
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(f.calls('present').length, 1);
});

test('completion found while rereading an explicit preparation also respects an unresolved dialogue or receipt', async () => {
  const f = fixture();
  await f.run.start();
  f.state.calls.length = 0;
  f.state.canLeave = false;
  f.state.plan = completedPlan();
  await f.run.prepare('obsolete-preview');
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  assert.deepEqual(f.state.calls, [{ port: 'read' }]);
  f.state.canLeave = true;
  await f.run.verify();
  assert.equal(f.snapshot().phase, 'complete');
  assert.equal(f.calls('present').length, 0);
});

for (const pending of ['read', 'explain', 'present']) {
  test(`pause during ${pending} allows a new run while the previous late result stays obsolete`, async () => {
    const f = fixture();
    const gate = deferred();
    f.state[pending + 'Gate'] = gate;
    const previous = f.run.start();
    await reached(f, pending);
    f.run.pause();
    assert.equal(f.snapshot().phase, 'paused');
    f.state[pending + 'Gate'] = null;
    f.state.plan = plan('invoices');
    await f.run.start();
    const settled = f.snapshot();
    const calls = f.state.calls.length;
    gate.resolve();
    await previous;
    assert.equal(f.snapshot(), settled);
    assert.equal(f.snapshot().plan.pageId, 'invoices');
    assert.equal(f.snapshot().phase, 'awaiting_confirmation');
    assert.equal(f.state.calls.length, calls);
  });

  test(`a session change during ${pending} cannot expose a late result or continue the previous session`, async () => {
    const f = fixture();
    const gate = deferred();
    f.state[pending + 'Gate'] = gate;
    const previous = f.run.start();
    await reached(f, pending);
    f.state.current = false;
    f.run.clear();
    const empty = f.snapshot();
    const calls = f.state.calls.length;
    gate.resolve();
    await previous;
    assert.equal(f.snapshot(), empty);
    assert.deepEqual(empty, {
      phase: 'idle',
      plan: null,
      events: [],
      error: null
    });
    assert.equal(f.state.calls.length, calls);
    f.state.current = true;
    f.state[pending + 'Gate'] = null;
    f.state.plan = plan('invoices');
    await f.run.start();
    assert.equal(f.snapshot().plan.pageId, 'invoices');
    assert.ok(
      f
        .snapshot()
        .events.every((event) => [undefined, 'invoices'].includes(event.pageId))
    );
  });
}

test('a rejected read from a paused run cannot fail a newly started run', async () => {
  const f = fixture();
  const gate = deferred();
  f.state.readGate = gate;
  const previous = f.run.start();
  f.run.pause();
  f.state.readGate = null;
  f.state.plan = plan('invoices');
  await f.run.start();
  const settled = f.snapshot();
  gate.reject(Object.assign(new Error('obsolete'), { status: 403 }));
  await previous;
  assert.equal(f.snapshot(), settled);
});

test('duplicate start and preparation input while a read is pending do not launch concurrent work', async () => {
  const f = fixture();
  const gate = deferred();
  f.state.readGate = gate;
  const started = f.run.start();
  await f.run.start();
  await f.run.verify();
  await f.run.prepare('not-yet-presented');
  assert.equal(f.calls('read').length, 1);
  gate.resolve();
  await started;
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(f.calls('present').length, 1);
});

for (const [status, phase, error] of [
  [403, 'blocked', 'forbidden'],
  [409, 'blocked', 'stale'],
  [500, 'error', 'unavailable'],
  [undefined, 'error', 'unavailable']
]) {
  test(`a failed server read (${status ?? 'network'}) stops safely without automatic retry`, async () => {
    const f = fixture();
    f.state.readError = Object.assign(new Error('synthetic'), { status });
    await f.run.start();
    assert.equal(f.snapshot().phase, phase);
    assert.equal(f.snapshot().error, error);
    assert.equal(f.run.active, false);
    await f.run.verify();
    await f.run.prepare('forbidden-preview');
    assert.equal(f.calls('read').length, 1);
    assert.equal(f.calls('navigate').length, 0);
    assert.equal(f.calls('present').length, 0);
  });
}

test('a failed navigation blocks preparation and requires an explicit fresh start', async () => {
  const f = fixture();
  f.state.navigateResult = false;
  await f.run.start();
  assert.equal(f.snapshot().phase, 'blocked');
  assert.equal(f.snapshot().error, 'stale');
  assert.equal(f.calls('present').length, 0);
  f.state.navigateResult = true;
  await f.run.start();
  assert.equal(f.snapshot().phase, 'awaiting_confirmation');
  assert.equal(f.calls('read').length, 2);
});

for (const stage of ['explain', 'navigate', 'present']) {
  test(`a failure while calling ${stage} stops the sequence without continuing or retrying`, async () => {
    const f = fixture();
    f.ports[stage] = async () => {
      f.state.calls.push({ port: stage });
      throw new Error('Synthetic interruption');
    };
    await f.run.start();
    assert.equal(f.snapshot().phase, 'error');
    assert.equal(f.snapshot().error, 'unavailable');
    assert.equal(f.run.active, false);
    const calls = f.state.calls.length;
    await f.run.verify();
    await f.run.prepare('not-retried');
    assert.equal(f.state.calls.length, calls);
    assert.equal(f.calls(stage).length, 1);
    if (stage !== 'present') assert.equal(f.calls('present').length, 0);
  });
}

for (const presentResult of ['manual', 'unavailable']) {
  test(`a ${presentResult} preparation is displayed as pending or blocked, never completed`, async () => {
    const f = fixture();
    f.state.presentResult = presentResult;
    await f.run.start();
    assert.equal(
      f.snapshot().phase,
      presentResult === 'manual' ? 'awaiting_confirmation' : 'blocked'
    );
    assert.notEqual(f.snapshot().phase, 'complete');
  });
}

test('all nineteen administration categories have an explicit safe local destination', () => {
  assert.equal(ADMIN_GUIDANCE_PAGES.length, 19);
  for (const page of ADMIN_GUIDANCE_PAGES) {
    const result = automaticPagePlan(page.id);
    assert.equal(result.pageId, page.id);
    assert.equal(result.adminUrl, page.path);
    assert.equal(automaticAdminUrl(result.adminUrl), page.path);
    assert.equal(result.state, 'action_required');
    assert.ok(!('prepare' in result));
    assert.ok(!('command' in result));
  }
  assert.throws(() => automaticPagePlan('unregistered-category'));
});

test('a local destination preserves its query and fragment without permitting another route or origin', () => {
  const local = `/admin/fundraiser/sponsors?sponsorshipId=${payment}#media`;
  assert.equal(automaticAdminUrl(local), local);
  const opaqueQuery =
    '/admin/fundraiser/sponsors?search=https%3A%2F%2Fexample.test%2F..%2Fprivate%20copy#media';
  assert.equal(automaticAdminUrl(opaqueQuery), opaqueQuery);
  for (const invalid of [
    'https://external.example.test/admin/fundraiser',
    '//external.example.test/admin/fundraiser',
    'javascript:alert(1)',
    '/admin/login',
    '/admin/fundraiser/unknown',
    '/admin/fundraiser/sponsors/../contributions',
    '/admin/fundraiser/%2e%2e/contributions',
    '/admin/fundraiser/sponsors/./',
    '/admin/fundraiser/%5csponsors',
    '/admin/fundraiser/%2fsponsors',
    '/admin/fundraiser/sponsors\\anything',
    '/admin/fundraiser/sponsors\n',
    '/admin/fundraiser/sponsors?search=first\nsecond',
    '/admin/fundraiser/sponsors%00',
    '/admin/fundraiser/%',
    ' /admin/fundraiser',
    ''
  ])
    assert.equal(automaticAdminUrl(invalid), null, invalid);
});

function journey(changes = {}) {
  return {
    contributionId: payment,
    reference: 'SYNTHETIC-811',
    contributionType: 'personal_support',
    amountMinor: 2500,
    currency: 'CAD',
    paymentStatus: 'paid',
    state: 'complete',
    completed: 1,
    total: 1,
    steps: [
      {
        id: 'payment',
        state: 'complete',
        reason: 'payment_recorded',
        adminUrl: `/admin/fundraiser/contributions?contributionId=${payment}`
      }
    ],
    next: null,
    ...changes
  };
}

test('a payment plan comes from the exact requested payment and refuses missing next actions', () => {
  const result = automaticPaymentPlan(journey(), payment);
  assert.equal(result.state, 'complete');
  assert.equal(result.contributionId, payment);
  assert.throws(() => automaticPaymentPlan(journey(), otherPayment));
  assert.throws(() =>
    automaticPaymentPlan(
      journey({ state: 'action_required', next: null }),
      payment
    )
  );
});

test('a scheduled publication plan retains server responsibility and its exact delivery destination', () => {
  const adminUrl =
    '/admin/fundraiser/publications/automation?deliveryId=synthetic-exact-delivery';
  const result = automaticPaymentPlan(
    journey({
      state: 'waiting',
      next: {
        reason: 'publication_scheduled',
        responsibility: 'platform',
        adminUrl
      }
    }),
    payment
  );
  assert.equal(result.state, 'waiting');
  assert.equal(result.responsibility, 'platform');
  assert.equal(result.reason, 'publication_scheduled');
  assert.equal(result.adminUrl, adminUrl);
});

for (const reason of ['invoice_missing', 'credit_missing']) {
  test(`a ${reason} obligation opens the payment-scoped invoice workspace`, () => {
    const result = automaticPaymentPlan(
      journey({
        state: 'action_required',
        next: {
          reason,
          adminUrl: '/admin/fundraiser/contributions',
          target: 'unrelated-old-target'
        }
      }),
      payment
    );
    assert.equal(result.pageId, 'invoices');
    assert.equal(result.target, 'invoice-workspace');
    assert.equal(
      result.adminUrl,
      `/admin/fundraiser/invoices?contributionId=${payment}`
    );
  });
}

for (const [name, changes] of [
  [
    'an outstanding next action',
    { next: { reason: 'review', adminUrl: '/admin/fundraiser/sponsors' } }
  ],
  ['an incomplete milestone', { steps: [{ id: 'payment', state: 'waiting' }] }],
  ['no milestones', { steps: [], completed: 0, total: 0 }],
  ['an incomplete count', { completed: 0 }],
  ['a total inconsistent with milestones', { completed: 2, total: 2 }]
]) {
  test(`payment completion rejects ${name} as insufficient server evidence`, () => {
    assert.throws(() => automaticPaymentPlan(journey(changes), payment));
  });
}

test('a recommendation cannot turn external server text into a destination', () => {
  assert.throws(() =>
    automaticPaymentPlan(
      journey({
        state: 'action_required',
        next: {
          reason: 'review',
          adminUrl: 'https://external.example.test/admin/fundraiser/sponsors'
        }
      }),
      payment
    )
  );
});

test('complete and explicitly not-required milestones can establish a consistent completed payment', () => {
  const result = automaticPaymentPlan(
    journey({
      completed: 2,
      total: 2,
      steps: [
        { id: 'payment', state: 'complete' },
        { id: 'publication', state: 'not_required' }
      ]
    }),
    payment
  );
  assert.equal(result.state, 'complete');
});
