import '@angular/compiler';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { platformServer, ServerModule } from '@angular/platform-server';
import { Router } from '@angular/router';
import { provideStore, Store } from '@ngrx/store';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';

const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['@openg7/funding-core', '@openg7/funding-i18n'].includes(specifier))
      return {
        url: new URL(
          `../dist/packages/${specifier.slice('@openg7/'.length)}/src/index.js`,
          import.meta.url
        ).href,
        shortCircuit: true
      };
    return nextResolve(specifier, context);
  }
});
const {
  adminCampaignsActions,
  adminCampaignsFeature,
  DEFAULT_CAMPAIGNS_QUERY
} =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-campaigns.store.js');
const { AdminCampaignsStore } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-campaigns-store.service.js');
const { FundingAdminService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js');
const { AdminDashboardRequestError } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js');
workspaceHook.deregister();

before(() =>
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  )
);
after(() => TestBed.resetTestEnvironment());

const row = (id, body = 'Synthetic content') => ({
  id,
  contributionId: '10000000-0000-4000-8000-000000000001',
  reference: 'SYNTHETIC-CAMPAIGN',
  companyName: 'Synthetic sponsor',
  paidAt: '2026-10-01T12:00:00Z',
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  quantity: 1,
  format: 'collective_text',
  obligationState: 'pending',
  timing: null,
  preparation: {
    status: 'ready',
    version: 'synthetic-v1',
    approvedAt: null,
    blockers: []
  },
  workflow: {
    obligationId: id,
    channel: 'facebook',
    target: 'openg7',
    ordinal: 1,
    state: 'action_required',
    responsibility: 'admin',
    reason: 'publication_authorization_required',
    deliveryId: null,
    scheduledAt: null
  },
  content: { title: 'Synthetic title', body },
  proof: null,
  adminUrl: '/admin/fundraiser/sponsors'
});
const response = (...items) => ({
  generatedAt: '2026-10-18T12:00:00Z',
  items,
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: items.length,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  }
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  await Promise.resolve();
  TestBed.tick();
  await Promise.resolve();
  TestBed.tick();
}

function fixture(t, { browser = true } = {}) {
  let read = async () => response(row('first'));
  const calls = [];
  const navigations = [];
  const state = { valid: true, clears: 0 };
  const admin = {
    sessionGeneration: signal(0),
    dataRevision: signal(0),
    identity: signal({
      id: 'synthetic-owner',
      sessionId: 'synthetic-session',
      role: 'owner',
      expiresAt: '2026-10-18T13:00:00Z'
    }),
    hasValidAdminSession: () => state.valid,
    clearAdminSession() {
      state.valid = false;
      state.clears++;
      admin.sessionGeneration.update((value) => value + 1);
      admin.identity.set(null);
    },
    getCampaigns(query, signal) {
      calls.push({ query, signal });
      return read(query, signal);
    }
  };
  TestBed.configureTestingModule({
    providers: [
      provideStore({
        [adminCampaignsFeature.name]: adminCampaignsFeature.reducer
      }),
      AdminCampaignsStore,
      { provide: PLATFORM_ID, useValue: browser ? 'browser' : 'server' },
      { provide: FundingAdminService, useValue: admin },
      {
        provide: Router,
        useValue: {
          url: '/admin/fundraiser/campaigns',
          navigate: async (...args) => {
            navigations.push(args);
            return true;
          }
        }
      }
    ]
  });
  const store = TestBed.inject(AdminCampaignsStore);
  const ngrx = TestBed.inject(Store);
  TestBed.tick();
  t.after(() => TestBed.resetTestingModule());
  return {
    store,
    ngrx,
    admin,
    state,
    calls,
    navigations,
    read(operation) {
      read = operation;
    }
  };
}

test('the reducer rejects obsolete generations and session responses after reset', () => {
  const reduce = adminCampaignsFeature.reducer;
  let state = reduce(undefined, { type: 'synthetic:init' });
  state = reduce(
    state,
    adminCampaignsActions.synchronized({
      sessionKey: 'synthetic:one',
      revision: 0
    })
  );
  state = reduce(
    state,
    adminCampaignsActions.loadRequested({ query: DEFAULT_CAMPAIGNS_QUERY })
  );
  const oldGeneration = state.requestGeneration;
  state = reduce(
    state,
    adminCampaignsActions.synchronized({
      sessionKey: 'synthetic:two',
      revision: 0
    })
  );
  const before = state;
  state = reduce(
    state,
    adminCampaignsActions.loadSucceeded({
      requestGeneration: oldGeneration,
      sessionKey: 'synthetic:one',
      response: response(row('private'))
    })
  );
  assert.equal(state, before);
  assert.equal(state.data, null);
  assert.deepEqual(state.query, DEFAULT_CAMPAIGNS_QUERY);
  state = reduce(
    state,
    adminCampaignsActions.loadFailed({
      requestGeneration: oldGeneration,
      sessionKey: 'synthetic:one',
      status: 'error'
    })
  );
  assert.equal(state, before);
});

test('the injectable store is the single NgRx source and survives detaching the page', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  assert.equal(f.store.state(), 'ready');
  const query = {
    ...DEFAULT_CAMPAIGNS_QUERY,
    page: 2,
    channel: 'linkedin',
    target: 'openg20',
    search: 'Synthetic',
    sort: 'due_at',
    direction: 'asc'
  };
  await f.store.load(query);
  f.store.select(f.store.data().items[0]);
  assert.equal(f.store.selectedId(), 'first');
  assert.deepEqual(
    f.ngrx.selectSignal(adminCampaignsFeature.selectQuery)(),
    query
  );
  const count = f.calls.length;
  f.store.detach();
  assert.deepEqual(f.store.query(), query);
  assert.equal(f.store.selectedId(), 'first');
  assert.equal(f.calls.length, count);
  f.read(async () =>
    response(row('first', 'Fresh server content after returning'))
  );
  await f.store.connect();
  assert.equal(f.calls.length, count + 1);
  assert.deepEqual(f.calls.at(-1).query, query);
  assert.equal(
    f.store.selected().content.body,
    'Fresh server content after returning'
  );
  assert.equal(
    f.ngrx.selectSignal(adminCampaignsFeature.selectData)(),
    f.store.data()
  );
});

test('a changed query aborts the previous API read and ignores its late response', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  const first = deferred(),
    second = deferred();
  let index = 0;
  f.read(() => (index++ === 0 ? first.promise : second.promise));
  const oldRead = f.store.load({
    ...DEFAULT_CAMPAIGNS_QUERY,
    channel: 'facebook'
  });
  const oldSignal = f.calls.at(-1).signal;
  const currentRead = f.store.load({
    ...DEFAULT_CAMPAIGNS_QUERY,
    channel: 'linkedin'
  });
  assert.equal(oldSignal.aborted, true);
  second.resolve(response(row('current')));
  await currentRead;
  first.resolve(response(row('obsolete')));
  await oldRead;
  assert.equal(f.store.query().channel, 'linkedin');
  assert.equal(f.store.data().items[0].id, 'current');
});

test('detaching during a read cancels it without accepting a late private response', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  const pending = deferred();
  f.read(() => pending.promise);
  const reading = f.store.load({ ...DEFAULT_CAMPAIGNS_QUERY, page: 2 });
  const signal = f.calls.at(-1).signal;
  f.store.detach();
  assert.equal(signal.aborted, true);
  const before = f.store.data();
  pending.resolve(response(row('private-late')));
  await reading;
  assert.equal(f.store.data(), before);
  assert.equal(f.store.query().page, 2);
});

test('identity restoration for the same session keeps the applied query', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  await f.store.load({
    ...DEFAULT_CAMPAIGNS_QUERY,
    page: 2,
    channel: 'facebook'
  });
  f.store.detach();
  f.admin.identity.set({
    ...f.admin.identity(),
    expiresAt: '2026-10-18T14:00:00Z'
  });
  await settle();
  assert.equal(f.store.query().page, 2);
  assert.equal(f.store.query().channel, 'facebook');
});

for (const change of ['logout', 'role', 'identity', 'session']) {
  test(`${change} purges private NgRx state while the campaigns page is detached`, async (t) => {
    const f = fixture(t);
    await f.store.connect();
    await f.store.load({
      ...DEFAULT_CAMPAIGNS_QUERY,
      page: 2,
      search: 'Synthetic private filter'
    });
    f.store.select(f.store.data().items[0]);
    f.store.detach();
    const calls = f.calls.length;
    if (change === 'logout') f.admin.clearAdminSession();
    else
      f.admin.identity.update((identity) => ({
        ...identity,
        ...(change === 'role'
          ? { role: 'reader' }
          : change === 'identity'
            ? { id: 'synthetic-other-owner' }
            : { sessionId: 'synthetic-other-session' })
      }));
    await settle();
    assert.equal(f.store.data(), null);
    assert.equal(f.store.selectedId(), null);
    assert.deepEqual(f.store.query(), DEFAULT_CAMPAIGNS_QUERY);
    assert.equal(f.calls.length, calls);
  });
}

test('a late 401 cannot sign out a replacement session', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  const pending = deferred();
  f.read(() => pending.promise);
  const loading = f.store.load();
  f.store.detach();
  f.admin.identity.update((identity) => ({
    ...identity,
    sessionId: 'synthetic-new-session'
  }));
  await settle();
  pending.reject(new AdminDashboardRequestError(401));
  await loading;
  assert.equal(f.state.clears, 0);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.store.data(), null);
});

test('a preparation revision refreshes the applied query only while the page is connected', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  await f.store.load({ ...DEFAULT_CAMPAIGNS_QUERY, channel: 'linkedin' });
  f.store.select(f.store.data().items[0]);
  const pending = deferred();
  f.read(() => pending.promise);
  const count = f.calls.length;
  f.admin.dataRevision.update((value) => value + 1);
  await settle();
  assert.equal(f.calls.length, count + 1);
  assert.equal(f.calls.at(-1).query.channel, 'linkedin');
  assert.equal(f.store.data(), null);
  pending.resolve(response(row('first', 'Fresh approved preparation')));
  await settle();
  assert.equal(f.store.selected().content.body, 'Fresh approved preparation');
  f.store.detach();
  const detachedCount = f.calls.length;
  f.admin.dataRevision.update((value) => value + 1);
  await settle();
  assert.equal(f.calls.length, detachedCount);
  assert.equal(f.store.data(), null);
  assert.equal(f.store.query().channel, 'linkedin');
});

for (const [status, expected] of [
  [401, 'forbidden'],
  [403, 'forbidden'],
  [503, 'unavailable'],
  [500, 'error']
]) {
  test(`HTTP ${status} purges stale results and retains the correct recovery state`, async (t) => {
    const f = fixture(t);
    await f.store.connect();
    f.store.select(f.store.data().items[0]);
    f.read(async () => {
      throw new AdminDashboardRequestError(status);
    });
    await f.store.load();
    await settle();
    assert.equal(f.store.data(), null);
    assert.equal(f.store.selected(), null);
    assert.equal(f.store.state(), expected);
    assert.equal(f.state.clears, status === 401 ? 1 : 0);
    assert.equal(f.navigations.length, status === 401 ? 1 : 0);
  });
}

test('an old view cannot apply its private query to a replacement session before effects flush', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  const oldQuery = {
    ...DEFAULT_CAMPAIGNS_QUERY,
    search: 'Synthetic old account filter',
    page: 2
  };
  await f.store.load(oldQuery);
  f.admin.identity.update((identity) => ({
    ...identity,
    sessionId: 'synthetic-replacement-session'
  }));
  // No TestBed.tick: the asynchronous session observer has not run yet.
  await f.store.load(oldQuery);
  assert.deepEqual(f.calls.at(-1).query, DEFAULT_CAMPAIGNS_QUERY);
  assert.deepEqual(f.store.query(), DEFAULT_CAMPAIGNS_QUERY);
});

test('a current-view late 401 synchronizes a replacement session before applying any side effect', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  const pending = deferred();
  f.read(() => pending.promise);
  const loading = f.store.load();
  f.admin.identity.update((identity) => ({
    ...identity,
    sessionId: 'synthetic-replacement-session'
  }));
  f.read(async () => response(row('replacement-data')));
  // The pending result is handled before Angular flushes the session effect.
  pending.reject(new AdminDashboardRequestError(401));
  await loading;
  await settle();
  assert.equal(f.state.clears, 0);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.store.data().items[0].id, 'replacement-data');
});

for (const change of ['revision', 'session']) {
  test(`selecting an old row after a ${change} change before effects flush reloads the current context`, async (t) => {
    const f = fixture(t);
    await f.store.connect();
    const appliedQuery = {
      ...DEFAULT_CAMPAIGNS_QUERY,
      channel: 'facebook',
      page: 2
    };
    await f.store.load(appliedQuery);
    const oldRow = f.store.data().items[0];
    const count = f.calls.length;
    const pending = deferred();
    f.read(() => pending.promise);
    if (change === 'revision')
      f.admin.dataRevision.update((value) => value + 1);
    else
      f.admin.identity.update((identity) => ({
        ...identity,
        sessionId: 'synthetic-replacement-session'
      }));
    // The old row is clicked before the asynchronous observer sees the change.
    f.store.select(oldRow);
    assert.equal(f.calls.length, count + 1);
    assert.deepEqual(
      f.calls.at(-1).query,
      change === 'revision' ? appliedQuery : DEFAULT_CAMPAIGNS_QUERY
    );
    assert.equal(f.store.selected(), null);
    pending.resolve(response(row('current-context')));
    await settle();
    assert.equal(f.store.state(), 'ready');
    assert.equal(f.store.data().items[0].id, 'current-context');
    assert.equal(f.calls.length, count + 1);
    assert.equal(f.store.selected(), null);
  });
}

test('a dossier handoff clears unrelated filters and leaves multiple passages for an explicit choice', async (t) => {
  const f = fixture(t);
  await f.store.connect();
  await f.store.load({
    ...DEFAULT_CAMPAIGNS_QUERY,
    page: 2,
    search: 'Another dossier',
    channel: 'linkedin',
    state: 'complete'
  });
  const sponsorshipId = '10000000-0000-4000-8000-000000000001';
  f.read(async () =>
    response(
      row('20000000-0000-4000-8000-000000000001'),
      row('20000000-0000-4000-8000-000000000002')
    )
  );
  await f.store.connect({ sponsorshipId });
  assert.deepEqual(f.calls.at(-1).query, {
    ...DEFAULT_CAMPAIGNS_QUERY,
    sponsorshipId
  });
  assert.equal(f.store.selected(), null);
});

test('a dossier with exactly one promised passage selects that passage after the scoped read', async (t) => {
  const f = fixture(t);
  const id = '20000000-0000-4000-8000-000000000001';
  f.read(async () => response(row(id)));
  await f.store.connect({
    sponsorshipId: '10000000-0000-4000-8000-000000000001'
  });
  assert.equal(f.store.selectedId(), id);
});

test('a handoff to the same dossier preserves the selected twenty-sixth passage through an exact API scope', async (t) => {
  const f = fixture(t);
  const sponsorshipId = '10000000-0000-4000-8000-000000000001';
  const obligationId = '20000000-0000-4000-8000-000000000026';
  f.read(async () => response(row(obligationId)));
  await f.store.connect();
  await f.store.load({ ...DEFAULT_CAMPAIGNS_QUERY, page: 2 });
  f.store.select(f.store.data().items[0]);
  f.store.detach();
  await f.store.connect({ sponsorshipId });
  assert.deepEqual(f.calls.at(-1).query, {
    ...DEFAULT_CAMPAIGNS_QUERY,
    sponsorshipId,
    obligationId
  });
  assert.equal(f.store.selectedId(), obligationId);
});

test('an explicit unknown passage does not fall back to another obligation', async (t) => {
  const f = fixture(t);
  const sponsorshipId = '10000000-0000-4000-8000-000000000001';
  const obligationId = '20000000-0000-4000-8000-000000000099';
  f.read(async () => response());
  await f.store.connect({ sponsorshipId, obligationId });
  assert.deepEqual(f.calls.at(-1).query, {
    ...DEFAULT_CAMPAIGNS_QUERY,
    sponsorshipId,
    obligationId
  });
  assert.equal(f.store.state(), 'ready');
  assert.equal(f.store.selected(), null);
});

test('a late dossier handoff cannot select a passage after another destination is loaded', async (t) => {
  const f = fixture(t);
  const old = deferred();
  const firstId = '10000000-0000-4000-8000-000000000001';
  const secondId = '10000000-0000-4000-8000-000000000002';
  f.read((query) =>
    query.sponsorshipId === firstId
      ? old.promise
      : Promise.resolve(
          response(
            {
              ...row('20000000-0000-4000-8000-000000000002'),
              contributionId: secondId
            },
            {
              ...row('20000000-0000-4000-8000-000000000003'),
              contributionId: secondId
            }
          )
        )
  );
  const obsolete = f.store.connect({ sponsorshipId: firstId });
  await f.store.connect({ sponsorshipId: secondId });
  old.resolve(response(row('20000000-0000-4000-8000-000000000001')));
  await obsolete;
  assert.equal(f.store.query().sponsorshipId, secondId);
  assert.equal(f.store.selected(), null);
  assert.equal(f.store.data().items[0].contributionId, secondId);
});

test('showing all campaigns removes a previous dossier and obligation scope', async (t) => {
  const f = fixture(t);
  const obligationId = '20000000-0000-4000-8000-000000000001';
  f.read(async () => response(row(obligationId)));
  await f.store.connect({
    sponsorshipId: '10000000-0000-4000-8000-000000000001',
    obligationId
  });
  assert.equal(f.store.selectedId(), obligationId);
  await f.store.connect(null);
  assert.deepEqual(f.calls.at(-1).query, DEFAULT_CAMPAIGNS_QUERY);
  assert.deepEqual(f.store.query(), DEFAULT_CAMPAIGNS_QUERY);
  assert.equal(f.store.selectedId(), null);
});

for (const synchronous of [false, true]) {
  test(`a focused route keeps its dossier after a session change${synchronous ? ' before effects flush' : ''}`, async (t) => {
    const f = fixture(t);
    const sponsorshipId = '10000000-0000-4000-8000-000000000001';
    f.read(async () =>
      response(
        row('20000000-0000-4000-8000-000000000001'),
        row('20000000-0000-4000-8000-000000000002')
      )
    );
    await f.store.connect({ sponsorshipId });
    f.store.select(f.store.data().items[0]);
    await f.store.load({ ...f.store.query(), channel: 'facebook' });
    const before = f.calls.length;
    f.admin.identity.update((identity) => ({
      ...identity,
      sessionId: 'synthetic-replacement-session'
    }));
    if (synchronous) await f.store.load();
    await settle();
    assert.equal(f.calls.length, before + 1);
    assert.deepEqual(f.calls.at(-1).query, {
      ...DEFAULT_CAMPAIGNS_QUERY,
      sponsorshipId
    });
    assert.equal(f.store.selectedId(), null);
    assert.equal(f.store.state(), 'ready');
  });
}

test('server rendering never starts an authenticated campaigns read', async (t) => {
  const f = fixture(t, { browser: false });
  await f.store.connect();
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.data(), null);
});
