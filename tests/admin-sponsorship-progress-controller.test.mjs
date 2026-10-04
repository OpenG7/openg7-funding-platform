import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSponsorshipProgressController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-progress-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const dossier = (id = 'synthetic-dossier-a') => ({
  contributionId: id,
  reference: 'SYNTHETIC-1',
  companyName: 'Synthetic company',
  version: 'synthetic-v1',
  amountMinor: 50000,
  currency: 'CAD',
  paymentStatus: 'paid',
  reviewStatus: 'pending_review',
  publicConsent: false,
  publicEligible: false,
  feedStatus: 'not_planned',
  milestones: [],
  next: {
    reason: 'review_pending',
    tab: 'overview',
    adminUrl: '/admin/fundraiser/sponsors'
  },
  documents: [],
  publications: [],
  refund: {
    workflow: 'not_requested',
    state: 'pending',
    confirmedAmountMinor: 0,
    creditMissing: false,
    hasError: false
  },
  failedEmails: [],
  failedStripeEvents: []
});
const response = (value = dossier(), status = 'ok') => ({
  status,
  generatedAt: '2026-10-04T12:00:00Z',
  dossier: value
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function fixture() {
  const state = {
    id: undefined,
    compact: false,
    destroyed: false,
    token: 'synthetic-token',
    remembered: 'synthetic-remembered-dossier'
  };
  const reads = [],
    loaded = [],
    selections = [],
    effects = [];
  const ports = {
    sponsorshipId: () => state.id,
    compact: () => state.compact,
    isDestroyed: () => state.destroyed,
    token: () => state.token,
    rememberedSelection: () => state.remembered,
    selectSponsorship: (id) => selections.push(id),
    async getSponsorshipProgress(token, id) {
      reads.push({ token, id });
      return response(dossier(id));
    },
    loaded: (value) => loaded.push(value),
    onUnauthorized: async () => effects.push('unauthorized')
  };
  const controller = new AdminSponsorshipProgressController(ports);
  return { controller, state, ports, reads, loaded, selections, effects };
}

test('progression clears its projection and emits loaded(null) before each server reread', async () => {
  const f = fixture();
  const first = response();
  f.ports.getSponsorshipProgress = async () => first;
  await f.controller.load();
  assert.strictEqual(f.controller.data(), first);
  assert.deepEqual(f.loaded, [null, first.dossier]);
  const reading = deferred();
  f.ports.getSponsorshipProgress = () => {
    assert.equal(f.controller.state(), 'loading');
    assert.equal(f.controller.data(), null);
    assert.equal(f.loaded.at(-1), null);
    return reading.promise;
  };
  const pending = f.controller.load();
  assert.equal(f.controller.data(), null);
  assert.deepEqual(f.loaded, [null, first.dossier, null]);
  const refreshed = response(dossier('synthetic-refreshed'));
  reading.resolve(refreshed);
  await pending;
  assert.strictEqual(f.controller.data(), refreshed);
  assert.equal(f.controller.state(), 'ready');
  assert.strictEqual(f.loaded.at(-1), refreshed.dossier);
  assert.equal(f.controller.data().dossier.publicEligible, false);
  assert.equal(f.controller.data().dossier.feedStatus, 'not_planned');
});

test('compact progression uses remembered selection while an explicit dossier always takes precedence', async () => {
  const f = fixture();
  await f.controller.load();
  f.state.compact = true;
  await f.controller.load();
  f.state.id = 'synthetic-explicit-dossier';
  await f.controller.load();
  assert.deepEqual(
    f.reads.map((read) => read.id),
    [undefined, 'synthetic-remembered-dossier', 'synthetic-explicit-dossier']
  );
  assert.deepEqual(f.selections, []);
});

test('a missing remembered dossier is cleared before fallback and only the fallback projection is emitted', async () => {
  const f = fixture();
  f.state.compact = true;
  const effects = [];
  const fallback = response(dossier('synthetic-fallback-dossier'));
  f.ports.loaded = (value) => {
    f.loaded.push(value);
    effects.push(['loaded', value?.contributionId ?? null]);
  };
  f.ports.selectSponsorship = (id) => effects.push(['select', id]);
  f.ports.getSponsorshipProgress = async (token, id) => {
    effects.push(['read', token, id]);
    return id ? response(null, 'not_found') : fallback;
  };
  await f.controller.load();
  assert.deepEqual(effects, [
    ['loaded', null],
    ['read', 'synthetic-token', 'synthetic-remembered-dossier'],
    ['select', null],
    ['read', 'synthetic-token', undefined],
    ['loaded', 'synthetic-fallback-dossier']
  ]);
  assert.deepEqual(f.loaded, [null, fallback.dossier]);
  assert.strictEqual(f.controller.data(), fallback);
  assert.equal(f.controller.state(), 'ready');
});

test('explicit not_found and empty, unavailable projections do not clear the remembered selection or invent a dossier', async () => {
  for (const status of ['not_found', 'empty', 'unavailable']) {
    const f = fixture();
    f.state.id = 'synthetic-explicit-dossier';
    f.state.compact = true;
    f.ports.getSponsorshipProgress = async (token, id) => {
      f.reads.push({ token, id });
      return response(null, status);
    };
    await f.controller.load();
    assert.equal(f.reads.length, 1);
    assert.deepEqual(f.selections, []);
    assert.deepEqual(f.loaded, [null, null]);
    assert.equal(f.controller.data().status, status);
    assert.equal(f.controller.state(), 'ready');
  }
});

test('missing admin token clears private projection and delegates session expiry without a server read', async () => {
  const f = fixture();
  await f.controller.load();
  f.state.token = '';
  await f.controller.load();
  assert.equal(f.reads.length, 1);
  assert.equal(f.controller.data(), null);
  assert.equal(f.controller.state(), 'error');
  assert.equal(f.loaded.at(-1), null);
  assert.deepEqual(f.effects, ['unauthorized']);
});

for (const status of [401, 403, 503]) {
  test(`progression preserves ${status} feedback and clears private data until a successful retry`, async () => {
    const f = fixture();
    await f.controller.load();
    f.ports.getSponsorshipProgress = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.load();
    assert.equal(f.controller.data(), null);
    assert.equal(f.controller.state(), status === 403 ? 'forbidden' : 'error');
    assert.equal(f.loaded.at(-1), null);
    assert.deepEqual(f.effects, status === 401 ? ['unauthorized'] : []);
    const recovered = response();
    f.ports.getSponsorshipProgress = async () => recovered;
    await f.controller.load();
    assert.equal(f.controller.state(), 'ready');
    assert.strictEqual(f.loaded.at(-1), recovered.dossier);
  });
}

test('a generic read failure reports error without expiring an authorized session', async () => {
  const f = fixture();
  f.ports.getSponsorshipProgress = async () => {
    throw new Error('Synthetic disconnected response');
  };
  await f.controller.load();
  assert.equal(f.controller.state(), 'error');
  assert.equal(f.controller.data(), null);
  assert.deepEqual(f.effects, []);
});

for (const lateFailure of [false, true]) {
  test(`a newer dossier suppresses a late ${lateFailure ? '401 failure' : 'not_found response'} and its selection fallback`, async () => {
    const f = fixture();
    f.state.compact = true;
    const old = deferred();
    f.ports.getSponsorshipProgress = () => old.promise;
    const first = f.controller.load();
    f.state.id = 'synthetic-dossier-b';
    const latest = response(dossier(f.state.id));
    f.ports.getSponsorshipProgress = async () => latest;
    await f.controller.load();
    if (lateFailure) old.reject(new AdminDashboardRequestError(401));
    else old.resolve(response(null, 'not_found'));
    await first;
    assert.strictEqual(f.controller.data(), latest);
    assert.equal(f.controller.state(), 'ready');
    assert.deepEqual(f.loaded, [null, null, latest.dossier]);
    assert.deepEqual(f.selections, []);
    assert.deepEqual(f.effects, []);
  });
}

for (const lateFailure of [false, true]) {
  test(`a remembered selection fallback cannot overwrite a newer dossier after a late ${lateFailure ? '401 failure' : 'response'}`, async () => {
    const f = fixture();
    f.state.compact = true;
    const fallback = deferred();
    f.ports.getSponsorshipProgress = (_token, id) =>
      id ? Promise.resolve(response(null, 'not_found')) : fallback.promise;
    const first = f.controller.load();
    await flush();
    assert.deepEqual(f.selections, [null]);
    f.state.id = 'synthetic-dossier-b';
    const latest = response(dossier(f.state.id));
    f.ports.getSponsorshipProgress = async () => latest;
    await f.controller.load();
    if (lateFailure) fallback.reject(new AdminDashboardRequestError(401));
    else fallback.resolve(response(dossier('synthetic-old-fallback')));
    await first;
    assert.strictEqual(f.controller.data(), latest);
    assert.equal(f.controller.state(), 'ready');
    assert.deepEqual(f.loaded, [null, null, latest.dossier]);
    assert.deepEqual(f.effects, []);
  });
}

for (const stage of ['initial', 'fallback']) {
  for (const lateFailure of [false, true]) {
    test(`destruction suppresses a late ${stage} ${lateFailure ? '401 failure' : 'response'} and private emissions`, async () => {
      const f = fixture();
      f.state.compact = true;
      const late = deferred();
      f.ports.getSponsorshipProgress = (_token, id) =>
        stage === 'fallback' && id
          ? Promise.resolve(response(null, 'not_found'))
          : late.promise;
      const pending = f.controller.load();
      if (stage === 'fallback') await flush();
      const selections = [...f.selections];
      f.state.destroyed = true;
      if (lateFailure) late.reject(new AdminDashboardRequestError(401));
      else late.resolve(response(dossier('synthetic-destroyed-dossier')));
      await pending;
      assert.equal(f.controller.data(), null);
      assert.equal(f.controller.state(), 'loading');
      assert.deepEqual(f.loaded, [null]);
      assert.deepEqual(f.selections, selections);
      assert.deepEqual(f.effects, []);
    });
  }
}

test('fallback failure preserves the cleared selection and original error state', async () => {
  const f = fixture();
  f.state.compact = true;
  f.ports.getSponsorshipProgress = async (_token, id) => {
    if (id) return response(null, 'not_found');
    throw new AdminDashboardRequestError(403);
  };
  await f.controller.load();
  assert.deepEqual(f.selections, [null]);
  assert.equal(f.controller.state(), 'forbidden');
  assert.equal(f.controller.data(), null);
  assert.deepEqual(f.loaded, [null]);
  assert.deepEqual(f.effects, []);
});
