import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingHomeController } from '../dist/apps/funding-web/src/app/features/funding/services/funding-home-controller.js';

const report = (overrides = {}) => ({
  data_source: 'database',
  total_received: 350,
  total_fees: 8,
  total_net: 342,
  total_refunded: 10,
  total_payouts: 25,
  current_available_estimate: 332,
  contributions_count: 3,
  currency: 'CAD',
  monthly_summary: [
    { month: '2026-09', currency: 'CAD', total_received: 135 },
    { month: '2026-08', currency: 'CAD', total_received: 215 }
  ],
  latest_public_allocations: [
    { project_name: 'Synthetic public project', amount_allocated: 25 }
  ],
  public_builders: [],
  last_updated_at: '2026-09-18T10:00:00.000Z',
  ...overrides
});

const zeroReport = () =>
  report({
    total_received: 0,
    total_fees: 0,
    total_net: 0,
    total_refunded: 0,
    total_payouts: 0,
    current_available_estimate: 0,
    contributions_count: 0,
    monthly_summary: [],
    latest_public_allocations: []
  });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const submission = {
  amount: 25,
  consent: {
    contributionType: 'personal_support',
    publicDisplayConsent: false,
    displayAmountConsent: false,
    nonCharityAcknowledged: true
  }
};

const fixture = (t, { isBrowser = true } = {}) => {
  const state = { isBrowser, now: new Date('2026-09-19T12:00:00Z') };
  const requests = [];
  const checkoutCalls = [];
  const navigations = [];
  let cleanups = 0;
  const ports = {
    funding: {
      async getPublicFundingConfig() {
        return { business_sponsorship_enabled: false };
      },
      async getSponsorshipBatchAvailability() {
        return { data_source: 'empty', availability: [], slots: [] };
      },
      async startCheckout() {
        return { status: 'mocked', checkoutId: 'local-synthetic-checkout' };
      }
    },
    transparency: {
      async getPublicTransparency(signal) {
        requests.push(signal);
        return report();
      }
    },
    checkout: {
      start: (reference) => checkoutCalls.push(['start', reference]),
      cancel: (reference) => checkoutCalls.push(['cancel', reference]),
      dismiss: () => checkoutCalls.push(['dismiss'])
    },
    config: {
      contributionAmounts: [5, 10, 25, 50],
      currency: 'CAD',
      monthlyGoal: 270
    },
    isBrowser: () => state.isBrowser,
    now: () => state.now,
    navigate: (url) => navigations.push(url),
    clearCheckoutReturn: () => cleanups++
  };
  const controller = new FundingHomeController(ports);
  t.after(() => controller.dispose());
  return {
    controller,
    ports,
    state,
    requests,
    checkoutCalls,
    navigations,
    cleanups: () => cleanups
  };
};

test('SSR retains unavailable state without requests, monitor calls or browser access', async (t) => {
  const f = fixture(t, { isBrowser: false });
  for (const name of ['window', 'document', 'navigator']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        throw new Error(`SSR accessed ${name}`);
      }
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  for (const method of [
    'getPublicFundingConfig',
    'getSponsorshipBatchAvailability',
    'startCheckout'
  ]) {
    f.ports.funding[method] = () => assert.fail(`SSR called ${method}`);
  }
  f.controller.start(
    new URLSearchParams('checkout=success&reference=OG7-SYNTHETIC')
  );
  await f.controller.loadPublicFundingConfig();
  await f.controller.loadSponsorshipBatchAvailability();
  await f.controller.loadPublicTransparency();
  await f.controller.supportProject(submission);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.checkoutCalls, []);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.cleanups(), 0);
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  assert.equal(f.controller.lastTransparencySync(), null);
  assert.equal(f.controller.currentMonth(), '');
  assert.equal(f.controller.loadingState(), 'idle');
});

test('loading, a failed first read and an API-confirmed zero remain distinct', async (t) => {
  const f = fixture(t);
  assert.equal(f.controller.transparencyState(), 'loading');
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  f.ports.transparency.getPublicTransparency = async () => {
    throw new Error('Synthetic outage');
  };
  await f.controller.loadPublicTransparency();
  assert.equal(f.controller.transparencyState(), 'error');
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  assert.equal(f.controller.lastTransparencySync(), null);
  f.ports.transparency.getPublicTransparency = async () => zeroReport();
  await f.controller.loadPublicTransparency();
  assert.equal(f.controller.transparencyState(), 'empty');
  assert.equal(f.controller.hasTransparencySnapshot(), true);
  assert.equal(f.controller.snapshot().totals.confirmedContributions, 0);
  assert.equal(f.controller.campaignProgress(), 0);
  assert.equal(f.controller.contributionCount(), 0);
  assert.equal(
    f.controller.lastTransparencySync(),
    zeroReport().last_updated_at
  );
});

test('one public read projects confirmed totals, negative fees and approved allocation amounts', async (t) => {
  const f = fixture(t);
  await f.controller.loadPublicTransparency();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.controller.snapshot().totals, {
    confirmedContributions: 350,
    transactionFees: -8,
    availableFunds: 332
  });
  assert.deepEqual(f.controller.snapshot().allocation, [
    { category: 'Synthetic public project', amount: 25 }
  ]);
  assert.deepEqual(f.controller.snapshot().contributors, []);
  assert.equal(f.controller.currentMonthContributions(), 135);
  assert.equal(f.controller.campaignProgress(), 50);
  assert.equal(f.controller.remainingForMonthlyGoal(), 135);
  assert.equal(f.controller.allocationTotal(), 25);
  assert.equal(f.controller.allocationShare(25), 100);
  assert.equal(
    f.controller.allocationDonut(),
    'conic-gradient(#f4b53c 0% 100%)'
  );
  assert.equal(f.controller.transparencyState(), 'synced');
});

test('campaign projections use the UTC month and matching currency without adding other currencies', async (t) => {
  const f = fixture(t);
  f.state.now = new Date('2026-09-30T19:59:59-04:00');
  f.ports.transparency.getPublicTransparency = async () =>
    report({
      monthly_summary: [
        { month: '2026-08', currency: 'CAD', total_received: 999 },
        { month: '2026-09', currency: 'USD', total_received: 500 },
        { month: '2026-09', currency: 'CAD', total_received: 135 },
        { month: '2026-10', currency: 'CAD', total_received: 27 }
      ]
    });
  await f.controller.loadPublicTransparency();
  assert.equal(f.controller.currentMonth(), '2026-09');
  assert.equal(f.controller.campaignProgress(), 50);
  f.state.now = new Date('2026-09-30T20:00:00-04:00');
  await f.controller.loadPublicTransparency();
  assert.equal(f.controller.currentMonth(), '2026-10');
  assert.equal(f.controller.currentMonthContributions(), 27);
  assert.equal(f.controller.campaignProgress(), 10);
  f.state.now = new Date('2026-11-01T00:00:00Z');
  await f.controller.loadPublicTransparency();
  assert.equal(f.controller.currentMonthContributions(), 0);
});

test('failed refresh retains the snapshot and source timestamp, then recovers', async (t) => {
  const f = fixture(t);
  await f.controller.loadPublicTransparency();
  const snapshot = f.controller.snapshot();
  const sync = f.controller.lastTransparencySync();
  f.ports.transparency.getPublicTransparency = async () => {
    throw new Error('Synthetic outage');
  };
  await f.controller.loadPublicTransparency({ silent: true });
  assert.equal(f.controller.transparencyState(), 'error');
  assert.equal(f.controller.snapshot(), snapshot);
  assert.equal(f.controller.lastTransparencySync(), sync);
  assert.equal(f.controller.hasTransparencySnapshot(), true);
  f.ports.transparency.getPublicTransparency = async () =>
    report({ total_received: 400 });
  await f.controller.loadPublicTransparency({ silent: true });
  assert.equal(f.controller.transparencyState(), 'synced');
  assert.equal(f.controller.snapshot().totals.confirmedContributions, 400);
});

test('the 15-second timeout releases an uncooperative transport and ignores its late completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(t);
  const pending = deferred();
  let signal;
  f.ports.transparency.getPublicTransparency = (value) => {
    signal = value;
    return pending.promise;
  };
  const first = f.controller.loadPublicTransparency();
  t.mock.timers.tick(14_999);
  assert.equal(f.controller.transparencyState(), 'loading');
  t.mock.timers.tick(1);
  await first;
  assert.equal(signal.aborted, true);
  assert.equal(f.controller.transparencyState(), 'error');
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  f.ports.transparency.getPublicTransparency = async () =>
    report({ total_received: 999 });
  await f.controller.loadPublicTransparency();
  pending.resolve(report({ total_received: 1 }));
  await flush();
  assert.equal(f.controller.snapshot().totals.confirmedContributions, 999);
  assert.equal(f.controller.transparencyState(), 'synced');
});

test('home refresh starts once at 30 seconds, never overlaps and stops on disposal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(t);
  f.controller.start(new URLSearchParams());
  f.controller.start(new URLSearchParams('checkout=success'));
  await flush();
  assert.equal(f.requests.length, 1);
  const pending = deferred();
  f.ports.transparency.getPublicTransparency = (signal) => {
    f.requests.push(signal);
    return pending.promise;
  };
  t.mock.timers.tick(29_999);
  assert.equal(f.requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(f.requests.length, 2);
  await f.controller.loadPublicTransparency();
  assert.equal(f.requests.length, 2);
  pending.resolve(report());
  await flush();
  f.controller.dispose();
  t.mock.timers.tick(60_000);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.checkoutCalls, []);
});

test('runtime configuration failure disables sponsorship and clears availability', async (t) => {
  const f = fixture(t);
  const availability = { data_source: 'database', availability: [], slots: [] };
  let reads = 0;
  f.ports.funding.getPublicFundingConfig = async () => ({
    business_sponsorship_enabled: true,
    allowed_contribution_amounts: [15, 75]
  });
  f.ports.funding.getSponsorshipBatchAvailability = async () => {
    reads++;
    return availability;
  };
  await f.controller.loadPublicFundingConfig();
  assert.deepEqual(f.controller.allowedContributionAmounts(), [15, 75]);
  assert.equal(f.controller.sponsorshipSelectionEnabled(), true);
  assert.equal(f.controller.sponsorshipBatchAvailability(), availability);
  assert.equal(reads, 1);
  f.ports.funding.getPublicFundingConfig = async () => {
    throw new Error('Synthetic config outage');
  };
  await f.controller.loadPublicFundingConfig();
  assert.equal(f.controller.sponsorshipSelectionEnabled(), false);
  assert.equal(f.controller.sponsorshipBatchAvailability(), null);
  assert.equal(reads, 1);
});

test('disabled configuration uses fallback amounts and invalidates older availability responses', async (t) => {
  const f = fixture(t);
  const pending = deferred();
  f.ports.funding.getPublicFundingConfig = async () => ({
    business_sponsorship_enabled: true
  });
  f.ports.funding.getSponsorshipBatchAvailability = () => pending.promise;
  const first = f.controller.loadPublicFundingConfig();
  await flush();
  f.ports.funding.getPublicFundingConfig = async () => ({
    business_sponsorship_enabled: false
  });
  await f.controller.loadPublicFundingConfig();
  pending.resolve({ data_source: 'database', availability: [], slots: [] });
  await first;
  assert.equal(f.controller.sponsorshipSelectionEnabled(), false);
  assert.equal(f.controller.sponsorshipBatchAvailability(), null);
  assert.deepEqual(
    f.controller.allowedContributionAmounts(),
    f.ports.config.contributionAmounts
  );
});

test('checkout success delegates server verification and only keeps valid sponsorship follow-up intent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(t);
  const token = 'synthetic_followup_token_for_tests_12345';
  f.controller.start(
    new URLSearchParams({
      checkout: 'success',
      contributionType: 'sponsorship_interest',
      followup_token: token
    })
  );
  assert.deepEqual(f.checkoutCalls, [['start', null]]);
  assert.equal(f.controller.pendingSponsorFollowupToken(), token);
  assert.equal(f.controller.loadingState(), 'idle');
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  f.controller.dismissCheckoutNotice();
  assert.deepEqual(f.checkoutCalls, [['start', null], ['dismiss']]);
  assert.equal(f.controller.pendingSponsorFollowupToken(), null);
  assert.equal(f.cleanups(), 1);
  for (const params of [
    {
      checkout: 'success',
      contributionType: 'sponsorship_interest',
      followup_token: 'invalid'
    },
    {
      checkout: 'success',
      contributionType: 'personal_support',
      followup_token: token
    },
    {
      checkout: 'cancel',
      reference: 'OG7-SYNTHETIC',
      contributionType: 'sponsorship_interest',
      followup_token: token
    }
  ]) {
    const other = fixture(t);
    other.controller.start(new URLSearchParams(params));
    assert.equal(other.controller.pendingSponsorFollowupToken(), null);
    assert.deepEqual(other.checkoutCalls, [
      [
        params.checkout === 'cancel' ? 'cancel' : 'start',
        params.reference ?? null
      ]
    ]);
  }
});

test('submission blocks a second checkout, keeps mocked feedback explicit and rereads authoritative totals', async (t) => {
  const f = fixture(t);
  await f.controller.loadPublicTransparency();
  const snapshot = f.controller.snapshot();
  const checkout = deferred();
  const transparency = deferred();
  const submissions = [];
  f.ports.funding.startCheckout = (amount, consent) => {
    submissions.push({ amount, consent });
    return checkout.promise;
  };
  f.ports.transparency.getPublicTransparency = () => transparency.promise;
  const first = f.controller.supportProject(submission);
  await f.controller.supportProject(submission);
  assert.deepEqual(submissions, [submission]);
  assert.equal(f.controller.loadingState(), 'loading');
  checkout.resolve({
    status: 'mocked',
    checkoutId: 'local-synthetic-checkout'
  });
  await first;
  assert.equal(f.controller.loadingState(), 'success');
  assert.equal(f.controller.checkoutResultMode(), 'mocked');
  assert.equal(f.controller.snapshot(), snapshot);
  assert.deepEqual(f.checkoutCalls, []);
  transparency.resolve(report({ total_received: 400 }));
  await flush();
  assert.equal(f.controller.snapshot().totals.confirmedContributions, 400);
});

test('redirected checkout navigates once and never confirms payment or changes the public snapshot', async (t) => {
  const f = fixture(t);
  f.ports.funding.startCheckout = async () => ({
    status: 'redirected',
    redirectUrl: 'https://checkout.example.test/synthetic'
  });
  await f.controller.supportProject(submission);
  await f.controller.supportProject(submission);
  assert.deepEqual(f.navigations, ['https://checkout.example.test/synthetic']);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.checkoutCalls, []);
  assert.equal(f.controller.checkoutResultMode(), null);
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  assert.equal(f.controller.loadingState(), 'loading');
});

test('checkout rejection reports failure and permits a later submission without creating confirmed totals', async (t) => {
  const f = fixture(t);
  let calls = 0;
  f.ports.funding.startCheckout = async () => {
    calls++;
    throw new Error('Synthetic checkout failure');
  };
  await f.controller.supportProject(submission);
  assert.equal(f.controller.loadingState(), 'error');
  assert.equal(f.controller.checkoutResultMode(), null);
  assert.equal(f.controller.hasTransparencySnapshot(), false);
  await f.controller.supportProject(submission);
  assert.equal(calls, 2);
});

test('instances keep snapshots, submission feedback and configuration isolated', async (t) => {
  const first = fixture(t);
  const second = fixture(t);
  await first.controller.loadPublicTransparency();
  await first.controller.supportProject(submission);
  assert.equal(first.controller.hasTransparencySnapshot(), true);
  assert.equal(first.controller.checkoutResultMode(), 'mocked');
  assert.equal(second.controller.hasTransparencySnapshot(), false);
  assert.equal(second.controller.checkoutResultMode(), null);
  assert.equal(second.controller.loadingState(), 'idle');
  assert.equal(second.controller.sponsorshipSelectionEnabled(), false);
});

test('disposal aborts transparency and ignores late success or rejection from every transport', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const reject of [false, true]) {
    const f = fixture(t);
    f.ports.funding.getPublicFundingConfig = async () => ({
      business_sponsorship_enabled: true
    });
    await f.controller.loadPublicFundingConfig();
    const previousAvailability = f.controller.sponsorshipBatchAvailability();
    const config = deferred();
    const availability = deferred();
    const transparency = deferred();
    const checkout = deferred();
    let signal;
    f.ports.funding.getPublicFundingConfig = () => config.promise;
    f.ports.funding.getSponsorshipBatchAvailability = () =>
      availability.promise;
    f.ports.funding.startCheckout = () => checkout.promise;
    f.ports.transparency.getPublicTransparency = (value) => {
      signal = value;
      return transparency.promise;
    };
    const promises = [
      f.controller.loadPublicFundingConfig(),
      f.controller.loadSponsorshipBatchAvailability(),
      f.controller.loadPublicTransparency(),
      f.controller.supportProject(submission)
    ];
    f.controller.dispose();
    f.controller.dispose();
    assert.equal(signal.aborted, true);
    if (reject) {
      for (const pending of [config, availability, transparency, checkout])
        pending.reject(new Error('Synthetic late failure'));
    } else {
      config.resolve({
        business_sponsorship_enabled: true,
        allowed_contribution_amounts: [75]
      });
      availability.resolve({
        data_source: 'database',
        availability: [],
        slots: []
      });
      transparency.resolve(report());
      checkout.resolve({
        status: 'redirected',
        redirectUrl: 'https://checkout.example.test/synthetic'
      });
    }
    await Promise.all(promises);
    assert.equal(f.controller.hasTransparencySnapshot(), false);
    assert.equal(f.controller.lastTransparencySync(), null);
    assert.equal(f.controller.transparencyState(), 'loading');
    assert.equal(f.controller.loadingState(), 'loading');
    assert.equal(f.controller.sponsorshipSelectionEnabled(), true);
    assert.equal(
      f.controller.sponsorshipBatchAvailability(),
      previousAvailability
    );
    assert.deepEqual(
      f.controller.allowedContributionAmounts(),
      f.ports.config.contributionAmounts
    );
    assert.deepEqual(f.navigations, []);
    f.controller.start(new URLSearchParams('checkout=success'));
    f.controller.dismissCheckoutNotice();
    await f.controller.supportProject(submission);
    t.mock.timers.tick(60_000);
    assert.deepEqual(f.checkoutCalls, []);
    assert.equal(f.cleanups(), 0);
  }
});
