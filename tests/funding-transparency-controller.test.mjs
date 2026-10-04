import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingTransparencyController } from '../dist/apps/funding-web/src/app/features/funding/services/funding-transparency-controller.js';

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
    {
      month: '2026-09',
      currency: 'CAD',
      total_received: 135,
      total_fees: 3,
      total_net: 132,
      total_refunded: 10,
      total_payouts: 0,
      contributions_count: 1
    },
    {
      month: '2026-08',
      currency: 'CAD',
      total_received: 215,
      total_fees: 5,
      total_net: 210,
      total_refunded: 0,
      total_payouts: 25,
      contributions_count: 2
    }
  ],
  latest_public_allocations: [
    {
      project_name: 'Synthetic public project',
      public_description: 'Synthetic public description',
      expected_outcome: 'Synthetic public outcome',
      amount_allocated: 0,
      currency: 'CAD',
      status: 'published',
      published_at: null
    }
  ],
  public_builders: [],
  last_updated_at: '2026-09-18T10:00:00.000Z',
  notes_admin: 'synthetic-private-field',
  ...overrides
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
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const fixture = (t, { isBrowser = true } = {}) => {
  const state = { now: new Date('2026-09-19T12:00:00.000Z'), isBrowser };
  const requests = [];
  const navigations = [];
  const links = [];
  const ports = {
    transparency: {
      async getPublicTransparency() {
        return report();
      }
    },
    config: { currency: 'CAD', monthlyGoal: 270 },
    i18n: { t: (key) => key },
    isBrowser: () => state.isBrowser,
    now: () => state.now,
    navigate: async (params) => {
      navigations.push(params);
      return true;
    },
    publicLink: (params) => {
      links.push(params);
      const query = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== null)
      );
      return (
        '/en/fonds-des-batisseurs/transparence' +
        (query.size ? '?' + query : '')
      );
    }
  };
  const service = ports.transparency.getPublicTransparency;
  ports.transparency.getPublicTransparency = (signal) => {
    requests.push(signal);
    return service();
  };
  const controller = new FundingTransparencyController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, state, requests, navigations, links };
};

const browser = (t) => {
  const blobs = [];
  const anchors = [];
  const revoked = [];
  const copied = [];
  const focus = [];
  const registry = {
    focus: (options) => focus.push({ focus: options }),
    scrollIntoView: (options) => focus.push({ scroll: options })
  };
  const document = {
    hidden: false,
    getElementById: (id) => (id === 'public-registry' ? registry : null),
    createElement: (tag) => {
      assert.equal(tag, 'a');
      const anchor = {
        href: '',
        download: '',
        clicks: 0,
        click() {
          this.clicks++;
        }
      };
      anchors.push(anchor);
      return anchor;
    }
  };
  const navigator = {
    clipboard: {
      writeText: async (value) => {
        copied.push(value);
      }
    }
  };
  const window = { location: { origin: 'https://funding.example.test' } };
  for (const [name, value] of Object.entries({ document, navigator, window })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  t.mock.method(URL, 'createObjectURL', (blob) => {
    blobs.push(blob);
    return `blob:synthetic-${blobs.length}`;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  return { document, navigator, blobs, anchors, revoked, copied, focus };
};

test('SSR keeps unknown values and never reads browser globals or starts requests', async (t) => {
  const f = fixture(t, { isBrowser: false });
  for (const name of ['document', 'navigator', 'window']) {
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
  f.controller.applyView('2026-09', 'refunds');
  f.controller.start();
  await f.controller.refresh();
  f.controller.scrollToRegistry();
  f.controller.downloadReport();
  f.controller.downloadCsv();
  await f.controller.copyTransparencyLink();
  f.controller.selectFilter('fees');
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.controller.checkedAt(), null);
  assert.equal(f.controller.monthlyProgress(), null);
  assert.equal(f.controller.copyState(), '');
  assert.deepEqual(
    f.controller.kpiCards().map((card) => card.value),
    [null, null, null, null]
  );
});

test('one instance request feeds all projections and keeps public allocation descriptions', async (t) => {
  const f = fixture(t);
  await f.controller.refresh();
  assert.equal(f.requests.length, 1);
  assert.equal(f.controller.hasSnapshot(), true);
  assert.equal(f.controller.canExport(), true);
  assert.equal(f.controller.currentMonthReceived(), 135);
  assert.equal(f.controller.monthlyProgress(), 50);
  assert.equal(f.controller.remainingForGoal(), 135);
  assert.deepEqual(f.controller.availableMonths(), ['2026-09', '2026-08']);
  assert.equal(
    f.controller.publicAllocations()[0].public_description,
    'Synthetic public description'
  );
  assert.equal(f.controller.publicAllocations()[0].amount_allocated, 0);
  assert.equal(
    f.controller.sourceLabel(),
    'funding.transparencyPage.sync.database'
  );
  assert.equal(f.controller.checkedAt(), '2026-09-19T12:00:00.000Z');
});

test('controllers isolate selected views, errors and snapshots across instances', async (t) => {
  const first = fixture(t);
  const second = fixture(t);
  await first.controller.refresh();
  first.controller.selectPeriod('2026-08');
  first.controller.selectFilter('fees');
  assert.equal(second.controller.data(), null);
  assert.equal(second.controller.period(), 'all');
  assert.equal(second.controller.registryFilter(), 'all');
  second.ports.transparency.getPublicTransparency = async () => {
    throw new Error('synthetic outage');
  };
  await second.controller.refresh();
  assert.equal(second.controller.error(), true);
  assert.equal(first.controller.error(), false);
  assert.equal(first.controller.canExport(), true);
});

test('malformed and mixed currency responses preserve a stale snapshot without confirming zero', async (t) => {
  const f = fixture(t);
  await f.controller.refresh();
  const snapshot = f.controller.data();
  const checkedAt = f.controller.checkedAt();
  for (const invalid of [
    {},
    report({
      monthly_summary: [{ ...report().monthly_summary[0], currency: 'USD' }]
    })
  ]) {
    f.ports.transparency.getPublicTransparency = async () => invalid;
    await f.controller.refresh();
    assert.equal(f.controller.data(), snapshot);
    assert.equal(f.controller.checkedAt(), checkedAt);
    assert.equal(f.controller.hasSnapshot(), true);
    assert.equal(f.controller.error(), true);
    assert.equal(f.controller.canExport(), false);
    assert.equal(f.controller.kpiCards()[0].value, 350);
  }
  f.ports.transparency.getPublicTransparency = async () => report();
  await f.controller.refresh();
  assert.equal(f.controller.error(), false);
  assert.equal(f.controller.canExport(), true);
});

test('no source, first-load failure and a confirmed zero are three distinct states', async (t) => {
  const f = fixture(t);
  f.ports.transparency.getPublicTransparency = async () => {
    throw new Error('synthetic failure');
  };
  await f.controller.refresh();
  assert.equal(f.controller.error(), true);
  assert.equal(f.controller.hasSnapshot(), false);
  assert.equal(f.controller.kpiCards()[0].value, null);
  const zero = report({
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
  f.ports.transparency.getPublicTransparency = async () => ({
    ...zero,
    data_source: 'empty'
  });
  await f.controller.refresh();
  assert.equal(f.controller.error(), false);
  assert.equal(f.controller.hasSnapshot(), false);
  assert.equal(f.controller.monthlyProgress(), null);
  assert.equal(f.controller.canExport(), false);
  f.ports.transparency.getPublicTransparency = async () => zero;
  await f.controller.refresh();
  assert.equal(f.controller.hasSnapshot(), true);
  assert.equal(f.controller.kpiCards()[0].value, 0);
  assert.equal(f.controller.monthlyProgress(), 0);
  assert.equal(f.controller.canExport(), true);
});

test('month rollover, cached previous month and foreign report currency leave campaign progress unknown', async (t) => {
  const f = fixture(t);
  await f.controller.refresh();
  f.state.now = new Date('2026-10-01T00:00:01.000Z');
  f.ports.transparency.getPublicTransparency = async () => {
    throw new Error('synthetic outage');
  };
  await f.controller.refresh();
  assert.equal(f.controller.currentMonth(), '2026-10');
  assert.equal(f.controller.currentMonthReceived(), null);
  f.ports.transparency.getPublicTransparency = async () =>
    report({ generated_at: '2026-09-30T23:59:30.000Z' });
  await f.controller.refresh();
  assert.equal(f.controller.monthlyProgress(), null);
  f.ports.transparency.getPublicTransparency = async () =>
    report({ generated_at: '2026-10-01T00:00:00.000Z' });
  await f.controller.refresh();
  assert.equal(f.controller.monthlyProgress(), 0);
  f.ports.transparency.getPublicTransparency = async () =>
    report({ currency: 'USD', monthly_summary: [] });
  await f.controller.refresh();
  assert.equal(f.controller.hasSnapshot(), true);
  assert.equal(f.controller.currentMonthReceived(), null);
  assert.equal(f.controller.kpiCards()[0].value, 350);
});

test('unknown, pending and confirmed fees retain their public labels', async (t) => {
  const f = fixture(t);
  for (const [pending_fee_count, suffix] of [
    [undefined, 'feesUnknown'],
    [2, 'feesPending'],
    [0, 'feesComplete']
  ]) {
    f.ports.transparency.getPublicTransparency = async () =>
      report({ pending_fee_count });
    await f.controller.refresh();
    assert.equal(
      f.controller.feeQualityKey(),
      'funding.transparencyPage.kpis.' + suffix
    );
  }
});

test('timeout releases loading even if the transport ignores abort, and a late result cannot replace a retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(t);
  await f.controller.refresh();
  const stale = f.controller.data();
  const pending = deferred();
  let signal;
  f.ports.transparency.getPublicTransparency = (value) => {
    signal = value;
    return pending.promise;
  };
  const refresh = f.controller.refresh();
  await f.controller.refresh();
  assert.equal(f.controller.loading(), true);
  assert.equal(f.controller.canExport(), false);
  t.mock.timers.tick(15_000);
  await refresh;
  assert.equal(signal.aborted, true);
  assert.equal(f.controller.loading(), false);
  assert.equal(f.controller.error(), true);
  assert.equal(f.controller.data(), stale);
  const fresh = report({ total_received: 999 });
  f.ports.transparency.getPublicTransparency = async () => fresh;
  await f.controller.refresh();
  pending.resolve(report({ total_received: 1 }));
  await flush();
  assert.equal(f.controller.data(), fresh);
  assert.equal(f.controller.error(), false);
  assert.equal(f.controller.canExport(), true);
});

test('polling starts once, skips hidden pages and cannot overlap an active request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const b = browser(t);
  const f = fixture(t);
  f.controller.start();
  f.controller.start();
  await flush();
  assert.equal(f.requests.length, 1);
  b.document.hidden = true;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(f.requests.length, 1);
  b.document.hidden = false;
  const pending = deferred();
  f.ports.transparency.getPublicTransparency = (signal) => {
    f.requests.push(signal);
    return pending.promise;
  };
  t.mock.timers.tick(60_000);
  await flush();
  await f.controller.refresh();
  assert.equal(f.requests.length, 2);
  pending.resolve(report());
  await flush();
  f.controller.dispose();
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(f.requests.length, 2);
});

test('destroying during a request aborts it, releases resources and ignores late completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  browser(t);
  const f = fixture(t);
  const pending = deferred();
  f.ports.transparency.getPublicTransparency = (signal) => {
    f.requests.push(signal);
    return pending.promise;
  };
  f.controller.start();
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.requests[0].aborted, true);
  pending.resolve(report());
  await flush();
  assert.equal(f.controller.data(), null);
  assert.equal(f.controller.checkedAt(), null);
  assert.equal(f.controller.error(), false);
  f.controller.applyView('2026-09', 'refunds');
  f.controller.start();
  await f.controller.refresh();
  t.mock.timers.tick(120_000);
  assert.equal(f.requests.length, 1);
  assert.equal(f.controller.period(), 'all');
});

test('shared unavailable periods persist through load and exports stay blocked until an available view is selected', async (t) => {
  const b = browser(t);
  const f = fixture(t);
  f.controller.applyView('2024-01', 'refunds');
  await f.controller.refresh();
  assert.equal(f.controller.period(), '2024-01');
  assert.equal(f.controller.periodUnavailable(), true);
  f.controller.downloadReport();
  f.controller.downloadCsv();
  assert.deepEqual(b.blobs, []);
  f.controller.selectPeriod('2025-01');
  assert.equal(f.controller.period(), '2024-01');
  assert.deepEqual(f.navigations, []);
  f.controller.selectPeriod('2026-08');
  assert.equal(f.controller.canExport(), true);
  assert.deepEqual(f.navigations.at(-1), {
    period: '2026-08',
    type: 'refunds'
  });
  f.controller.selectFilter('fees');
  assert.deepEqual(f.navigations.at(-1), { period: '2026-08', type: 'fees' });
  f.controller.applyView('2026-13', 'unknown');
  assert.equal(f.controller.period(), 'all');
  assert.equal(f.controller.registryFilter(), 'all');
  f.controller.selectPeriod('all');
  assert.deepEqual(f.navigations.at(-1), { period: null, type: null });
});

test('JSON and CSV keep selected month, currency, provenance and public field limits; Blob URLs are revoked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const b = browser(t);
  const f = fixture(t);
  await f.controller.refresh();
  f.controller.selectPeriod('2026-09');
  f.controller.handleReportAction('json');
  f.controller.handleReportAction('csv');
  const json = JSON.parse(await b.blobs[0].text());
  assert.equal(json.period, '2026-09');
  assert.equal(json.scope, 'month');
  assert.equal(json.currency, 'CAD');
  assert.equal(json.data_source, 'database');
  assert.equal(json.exported_at, '2026-09-19T12:00:00.000Z');
  assert.equal(json.total_received, undefined);
  assert.equal(json.monthly_summary.length, 1);
  assert.equal(json.monthly_summary[0].total_received, 135);
  assert.equal(json.pending_fee_count, undefined);
  assert.equal(JSON.stringify(json).includes('synthetic-private'), false);
  const csv = await b.blobs[1].text();
  assert.match(csv, /2026-09,CAD,135,3,132,10/);
  assert.equal(csv.includes('2026-08'), false);
  assert.deepEqual(
    b.anchors.map((anchor) => anchor.download),
    [
      'openg7-transparence-fonds-batisseurs-2026-09.json',
      'openg7-registre-public-2026-09.csv'
    ]
  );
  assert.deepEqual(
    b.anchors.map((anchor) => anchor.clicks),
    [1, 1]
  );
  t.mock.timers.tick(0);
  assert.deepEqual(b.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
  f.controller.selectPeriod('all');
  f.controller.downloadReport();
  const all = JSON.parse(await b.blobs[2].text());
  assert.equal(all.total_received, 350);
  assert.equal(all.monthly_summary.length, 2);
  f.controller.dispose();
  assert.deepEqual(b.revoked, [
    'blob:synthetic-1',
    'blob:synthetic-2',
    'blob:synthetic-3'
  ]);
  t.mock.timers.tick(1);
  f.controller.downloadReport();
  assert.equal(b.revoked.length, 3);
  assert.equal(b.blobs.length, 3);
});

test('registry activation focuses before scrolling and disposed actions cannot touch the DOM', (t) => {
  const b = browser(t);
  const f = fixture(t);
  f.controller.scrollToRegistry();
  assert.deepEqual(b.focus, [
    { focus: { preventScroll: true } },
    { scroll: { block: 'start', behavior: 'auto' } }
  ]);
  f.controller.dispose();
  f.controller.scrollToRegistry();
  assert.equal(b.focus.length, 2);
});

test('copy uses only the current localized public view and reports clipboard failures', async (t) => {
  const b = browser(t);
  const f = fixture(t);
  f.controller.applyView('2026-09', 'fees');
  await f.controller.copyTransparencyLink();
  assert.equal(
    b.copied[0],
    'https://funding.example.test/en/fonds-des-batisseurs/transparence?period=2026-09&type=fees'
  );
  assert.equal(f.controller.copyState(), 'copied');
  b.navigator.clipboard.writeText = async () => {
    throw new Error('synthetic denied');
  };
  await f.controller.copyTransparencyLink();
  assert.equal(f.controller.copyState(), 'copyFailed');
});

test('late copy results cannot announce the previous view, overwrite a newer failure or write after disposal', async (t) => {
  const b = browser(t);
  const f = fixture(t);
  const first = deferred();
  b.navigator.clipboard.writeText = () => first.promise;
  const firstCopy = f.controller.copyTransparencyLink();
  f.controller.applyView('2026-08', 'refunds');
  first.resolve();
  await firstCopy;
  assert.equal(f.controller.copyState(), '');
  const second = deferred();
  b.navigator.clipboard.writeText = () => second.promise;
  const secondCopy = f.controller.copyTransparencyLink();
  b.navigator.clipboard.writeText = async () => {
    throw new Error('synthetic denied');
  };
  await f.controller.copyTransparencyLink();
  second.resolve();
  await secondCopy;
  assert.equal(f.controller.copyState(), 'copyFailed');
  const third = deferred();
  b.navigator.clipboard.writeText = () => third.promise;
  const thirdCopy = f.controller.copyTransparencyLink();
  f.controller.dispose();
  third.resolve();
  await thirdCopy;
  assert.equal(f.controller.copyState(), 'copyFailed');
});
