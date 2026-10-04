import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

import '@angular/compiler';
import { AdminSponsorListController } from '../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-list-controller.js';
import { AdminSponsorReviewWorkflow } from '../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-review-workflow.js';

const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core')
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    return nextResolve(specifier, context);
  }
});
const { AdminSponsorPublicationWorkflow } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-publication-workflow.js');
workspaceHook.deregister();

const sponsor = (overrides = {}) => ({
  id: 'synthetic-sponsor',
  version: 'synthetic-v1',
  public_reference: 'SYNTHETIC-1',
  sponsor_company_name: 'Synthetic company',
  public_name: null,
  sponsor_contact_email: 'synthetic@example.test',
  amount: 500,
  currency: 'CAD',
  payment_status: 'paid',
  public_display_consent: true,
  sponsor_review_status: 'pending_review',
  sponsor_review_note: 'Server note',
  sponsorship_refund_status: 'not_requested',
  sponsor_public_slug: 'synthetic-company',
  sponsor_public_summary: 'Server summary',
  sponsor_feed_target: null,
  sponsor_feed_channels: [],
  sponsor_feed_status: 'not_planned',
  sponsor_feed_public_url: null,
  sponsor_feed_notes: 'Server feed notes',
  ...overrides
});
const pagination = (overrides = {}) => ({
  page: 1,
  pageSize: 6,
  totalItems: 1,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
  ...overrides
});
const result = (items = [sponsor()], page = pagination()) => ({
  sponsorships: items,
  items,
  pagination: page
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

function fixture(t, locale = null) {
  const calls = [],
    selections = [],
    reconciliations = [],
    errors = [],
    media = [],
    logos = [],
    saved = [],
    queue = [];
  const renders = [],
    navigation = [],
    focus = [],
    scroll = [];
  const browser = { position: [0, 480], navigating: false };
  const catalog = locale
    ? JSON.parse(
        readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
      )
    : null;
  const translate = (key) => {
    if (!catalog) return key;
    const text = key
      .split('.')
      .reduce((current, segment) => current?.[segment], catalog);
    assert.equal(
      typeof text,
      'string',
      `Missing ${locale} translation: ${key}`
    );
    return text;
  };
  let closePanels = 0;
  const ports = {
    admin: {
      async getSponsorships(token, query) {
        calls.push({ token, query });
        return result();
      },
      getSavedAdminToken: () => 'synthetic-token',
      saveAdminToken: (token) => saved.push(token),
      selectSponsorship: (id) => selections.push(id),
      async refreshWorkQueue() {
        queue.push('refresh');
      }
    },
    t: translate,
    reconcile(previous, current, preserveDrafts) {
      reconciliations.push({ previous, current, preserveDrafts });
      review.reconcile(previous, current, preserveDrafts);
      publication.reconcile(previous, current, preserveDrafts);
    },
    async loadSponsorMedia(id) {
      media.push(id);
    },
    async loadLogoPreviews(records) {
      logos.push(records);
    },
    closeDecisionPanels() {
      closePanels += 1;
    },
    messageFromError(error, fallback) {
      errors.push({ error, fallback });
      return fallback;
    },
    navigation: {
      getScrollPosition: () => [...browser.position],
      scrollToPosition: (position) => scroll.push(position),
      hasPendingNavigation: () => browser.navigating,
      navigateDossier: (id, tab) => navigation.push({ id, tab }),
      afterRender: (callback) => renders.push(callback),
      focusDossier: () => focus.push('dossier'),
      focusListRow: (id) => focus.push(id)
    }
  };
  const controller = new AdminSponsorListController(ports);
  const workflowPorts = {
    t: translate,
    admin: {},
    adminToken: () => controller.adminToken(),
    canActOn: () => false,
    actionPending: () => controller.actionState() !== null,
    setActionState: (value) => controller.actionState.set(value),
    reloadSponsorships: () => controller.loadSponsorships(),
    messageFromError: ports.messageFromError,
    selectionRevision: () => controller.selectionRevision(),
    isCurrentSelection: (id) => controller.isCurrentSelection(id),
    sponsorships: () => controller.sponsorships(),
    progress: () => controller.progress(),
    canManage: () => true,
    paymentEligibilityMessage: () => '',
    confirm: async () => true
  };
  const review = new AdminSponsorReviewWorkflow(workflowPorts);
  const publication = new AdminSponsorPublicationWorkflow(workflowPorts);
  t.after(() => {
    controller.dispose();
    review.dispose();
    publication.dispose();
  });
  controller.initialize();
  return {
    controller,
    ports,
    calls,
    selections,
    reconciliations,
    errors,
    media,
    logos,
    saved,
    queue,
    renders,
    navigation,
    focus,
    scroll,
    browser,
    review,
    publication,
    closedPanels: () => closePanels
  };
}

test('listing sends typed filters and server pagination, then refreshes existing workflows and resources', async (t) => {
  const f = fixture(t),
    c = f.controller;
  c.search.set('Synthetic');
  c.reviewFilter.set('approved');
  c.feedFilter.set('planned');
  c.paymentFilter.set('paid');
  c.page.set(3);
  c.pageSize.set(10);
  const records = [
    sponsor(),
    sponsor({
      id: 'synthetic-second',
      sponsor_review_status: 'approved',
      amount: 250
    })
  ];
  f.ports.admin.getSponsorships = async (token, query) => {
    f.calls.push({ token, query });
    return result(
      records,
      pagination({
        page: 2,
        pageSize: 10,
        totalItems: 12,
        totalPages: 2,
        hasPreviousPage: true
      })
    );
  };
  await c.loadSponsorships();
  assert.deepEqual(f.calls, [
    {
      token: 'synthetic-token',
      query: {
        page: 3,
        pageSize: 10,
        search: 'Synthetic',
        reviewStatus: 'approved',
        feedStatus: 'planned',
        paymentStatus: 'paid',
        sort: 'priority',
        direction: 'desc'
      }
    }
  ]);
  assert.equal(c.state(), 'ready');
  assert.equal(c.page(), 2);
  assert.equal(c.paginationStart(), 11);
  assert.equal(c.paginationEnd(), 12);
  assert.equal(c.visibleCount(), 1);
  assert.equal(c.activeCount(), 2);
  assert.equal(c.totalContribution(), 750);
  assert.equal(c.assistantRefresh(), 1);
  assert.deepEqual(f.reconciliations, [
    { previous: [], current: records, preserveDrafts: false }
  ]);
  assert.deepEqual(f.saved, ['synthetic-token']);
  assert.deepEqual(f.queue, ['refresh']);
  assert.deepEqual(f.logos, [records]);
  assert.deepEqual(f.media, [null]);
});

test('newer filter result wins over a late success and a late authentication failure', async (t) => {
  const f = fixture(t),
    c = f.controller;
  const first = deferred(),
    second = deferred(),
    third = deferred();
  let attempt = 0;
  f.ports.admin.getSponsorships = () =>
    [first, second, third][attempt++].promise;
  const oldSuccess = c.loadSponsorships();
  const oldFailure = c.loadSponsorships();
  const current = c.loadSponsorships();
  const newest = sponsor({ id: 'synthetic-newest' });
  third.resolve(result([newest]));
  await current;
  first.resolve(result([sponsor({ id: 'synthetic-stale' })]));
  await oldSuccess;
  second.reject(
    Object.assign(new Error('Synthetic expired session'), { status: 401 })
  );
  await oldFailure;
  assert.deepEqual(c.sponsorships(), [newest]);
  assert.equal(c.state(), 'ready');
  assert.equal(f.reconciliations.length, 1);
  assert.equal(f.saved.length, 1);
  assert.deepEqual(f.errors, []);
  assert.equal(f.logos.length, 1);
  assert.deepEqual(f.media, [null]);
});

for (const failure of [false, true])
  test(`dispose prevents late ${failure ? 'failure' : 'success'} and every deferred navigation effect`, async (t) => {
    const f = fixture(t),
      c = f.controller,
      pending = deferred();
    f.ports.admin.getSponsorships = () => pending.promise;
    const load = c.loadSponsorships();
    c.selectSponsorshipById('synthetic-sponsor');
    c.navigationStarted(1, true);
    c.navigationScrolled(1, null);
    c.dispose();
    failure
      ? pending.reject(new Error('Synthetic failure'))
      : pending.resolve(result());
    await load;
    f.renders.forEach((callback) => callback());
    await flush();
    assert.deepEqual(f.reconciliations, []);
    assert.deepEqual(f.saved, []);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.scroll, []);
    assert.deepEqual(f.focus, []);
    assert.deepEqual(c.sponsorships(), []);
    const before = f.navigation.length;
    c.setSearchValue('ignored');
    c.setActiveTab('media');
    c.selectSponsorshipById('ignored');
    c.closeDetails();
    c.applyRouteSelection('ignored', 'media');
    await c.loadSponsorships();
    assert.equal(f.navigation.length, before);
    assert.equal(c.search(), '');
    assert.equal(c.activeTab(), 'overview');
  });

test('current load failure clears facts, keeps an explicit error, and can recover', async (t) => {
  const f = fixture(t),
    c = f.controller;
  await c.loadSponsorships();
  c.progress.set({ contributionId: 'synthetic-sponsor' });
  const error = new Error('Synthetic load failure');
  f.ports.admin.getSponsorships = async () => {
    throw error;
  };
  await c.loadSponsorships();
  assert.equal(c.state(), 'error');
  assert.deepEqual(c.sponsorships(), []);
  assert.equal(c.progress(), null);
  assert.deepEqual(f.errors, [{ error, fallback: '' }]);
  assert.equal(f.saved.length, 1);
  f.ports.admin.getSponsorships = async () => ({ sponsorships: [] });
  await c.loadSponsorships();
  assert.equal(c.state(), 'ready');
  assert.equal(c.paginationStart(), 0);
  assert.equal(c.paginationEnd(), 0);
  assert.equal(c.normalizedPage(), 1);
  assert.equal(c.totalPages(), 1);
});

test('filters and page size normalize inputs and reset pagination while previous and next stay bounded', async (t) => {
  const f = fixture(t),
    c = f.controller;
  c.page.set(4);
  c.setSearchValue('Synthetic');
  await flush();
  c.setReviewFilterValue('approved');
  await flush();
  c.setFeedFilterValue('drafted');
  await flush();
  c.setPaymentFilterValue('disputed');
  await flush();
  c.setPageSizeValue(25);
  await flush();
  assert.equal(c.hasActiveFilters(), true);
  assert.ok(f.calls.every(({ query }) => query.page === 1));
  assert.deepEqual(f.calls.at(-1).query, {
    page: 1,
    pageSize: 25,
    search: 'Synthetic',
    reviewStatus: 'approved',
    feedStatus: 'drafted',
    paymentStatus: 'disputed',
    sort: 'priority',
    direction: 'desc'
  });
  c.setReviewFilterValue('invalid');
  await flush();
  c.setFeedFilterValue('invalid');
  await flush();
  c.setPaymentFilterValue('invalid');
  await flush();
  c.setPageSizeValue(99);
  await flush();
  c.resetFilters();
  await flush();
  assert.equal(c.hasActiveFilters(), false);
  assert.equal(c.pageSize(), 6);
  c.pagination.set(pagination({ page: 1, totalPages: 3 }));
  c.previousPage();
  await flush();
  assert.equal(f.calls.at(-1).query.page, 1);
  c.pagination.set(pagination({ page: 3, totalPages: 3 }));
  c.nextPage();
  await flush();
  assert.equal(f.calls.at(-1).query.page, 3);
  c.pagination.set(pagination({ page: 2, totalPages: 3 }));
  c.nextPage();
  await flush();
  assert.equal(f.calls.at(-1).query.page, 3);
});

test('refresh reconciles real review and publication drafts against updated server facts', async (t) => {
  const f = fixture(t),
    c = f.controller,
    initial = sponsor();
  await c.loadSponsorships();
  c.selectSponsorshipById(initial.id);
  f.review.setReviewNoteValue(initial.id, 'Synthetic local note');
  f.publication.setPublicationField(initial.id, 'publicSummary', {
    target: { value: 'Synthetic local summary' }
  });
  const revision = c.selectionRevision();
  const updated = sponsor({
    version: 'synthetic-v2',
    sponsor_review_note: 'Updated server note',
    sponsor_public_summary: 'Updated server summary',
    sponsor_feed_notes: 'Updated server feed notes'
  });
  f.ports.admin.getSponsorships = async () => result([updated]);
  c.versionConflict.set(true);
  await c.loadSponsorships(true);
  assert.equal(c.selectedSponsorship(), updated);
  assert.equal(c.selectionRevision(), revision);
  assert.equal(c.versionConflict(), false);
  assert.equal(f.review.reviewNoteFor(initial.id), 'Synthetic local note');
  assert.equal(
    f.publication.publicationDraftFor(initial.id).publicSummary,
    'Synthetic local summary'
  );
  assert.equal(
    f.publication.publicationDraftFor(initial.id).feedNotes,
    'Updated server feed notes'
  );
  assert.equal(f.reconciliations.at(-1).preserveDrafts, true);
  await c.loadSponsorships();
  assert.equal(f.review.reviewNoteFor(initial.id), 'Updated server note');
  assert.equal(
    f.publication.publicationDraftFor(initial.id).publicSummary,
    'Updated server summary'
  );
  const feedback = c.beginApprovalFeedback(initial.id);
  f.ports.admin.getSponsorships = async () => result([]);
  await c.loadSponsorships();
  c.finishApprovalFeedback(feedback, 'success');
  assert.equal(c.selectedSponsorshipId(), null);
  assert.equal(c.selectedSponsorship(), null);
  assert.equal(c.selectionRevision(), revision + 1);
  assert.equal(c.approvalFeedback(), null);
  assert.equal(f.media.at(-1), null);
});

test('route selection normalizes tabs, loads unknown dossiers and reuses loaded ones without requests', async (t) => {
  const f = fixture(t),
    c = f.controller,
    second = sponsor({ id: 'synthetic-second' });
  f.ports.admin.getSponsorships = async (token, query) => {
    f.calls.push({ token, query });
    return result([sponsor(), second]);
  };
  c.applyRouteSelection('  synthetic-sponsor  ', 'invalid');
  await flush();
  assert.equal(c.search(), 'synthetic-sponsor');
  assert.equal(c.activeTab(), 'overview');
  assert.equal(f.calls.length, 1);
  c.applyRouteSelection('synthetic-sponsor', 'publication');
  assert.equal(c.activeTab(), 'publication');
  assert.equal(f.calls.length, 1);
  c.applyRouteSelection(second.id, 'media');
  assert.equal(c.selectedSponsorship(), second);
  assert.equal(c.search(), 'synthetic-sponsor');
  assert.equal(f.calls.length, 1);
  assert.equal(f.media.at(-1), second.id);
  c.applyRouteSelection(null, null);
  assert.equal(c.selectedSponsorshipId(), null);
  assert.equal(f.calls.length, 1);
  c.applyRouteSelection('synthetic-new', 'audit');
  await flush();
  assert.equal(f.calls.at(-1).query.search, 'synthetic-new');
  assert.equal(c.activeTab(), 'audit');
});

test('dossier navigation preserves the filtered list position and restores keyboard focus to its row', async (t) => {
  const f = fixture(t),
    c = f.controller;
  c.sponsorships.set([sponsor(), sponsor({ id: 'synthetic-second' })]);
  c.search.set('Synthetic company');
  c.selectSponsorshipById('synthetic-sponsor');
  assert.equal(c.adjacentDossier(-1), null);
  assert.equal(c.adjacentDossier(1), 'synthetic-second');
  f.renders.shift()();
  assert.deepEqual(f.focus, ['dossier']);
  f.browser.position = [0, 1200];
  c.openAdjacentDossier(1);
  f.renders.shift()();
  assert.equal(c.selectedSponsorshipId(), 'synthetic-second');
  assert.equal(c.adjacentDossier(1), null);
  c.setActiveTab('media');
  c.setActiveTab('media');
  assert.deepEqual(f.navigation.at(-1), {
    id: 'synthetic-second',
    tab: 'media'
  });
  assert.equal(f.navigation.length, 3);
  c.closeDetails();
  f.renders.shift()();
  assert.equal(c.search(), 'Synthetic company');
  assert.equal(f.closedPanels(), 1);
  assert.deepEqual(f.scroll, [[0, 480]]);
  assert.equal(f.focus.at(-1), 'synthetic-second');
  assert.deepEqual(f.navigation.at(-1), { id: null, tab: null });
});

test('closing a deep-linked dossier clears only its identifier search and reloads the queue', async (t) => {
  const f = fixture(t),
    c = f.controller;
  c.applyRouteSelection('synthetic-sponsor', 'overview');
  await flush();
  c.closeDetails();
  await flush();
  assert.equal(c.search(), '');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.at(-1).query.search, '');
  assert.equal(c.selectedSponsorshipId(), null);
});

test('delayed render callbacks cannot focus an older selection or restore a closed list after reopening', (t) => {
  const f = fixture(t),
    c = f.controller;
  c.selectSponsorshipById('synthetic-sponsor');
  c.closeDetails();
  c.selectSponsorshipById('synthetic-sponsor');
  f.renders.splice(0).forEach((callback) => callback());
  assert.deepEqual(f.focus, ['dossier']);
  assert.deepEqual(f.scroll, []);
});

test('dossier tab scroll runs after router scrolling and is cancelled by newer navigation, cancellation or destruction', async (t) => {
  const f = fixture(t),
    c = f.controller;
  c.navigationStarted(1, true);
  c.navigationScrolled(1, null);
  assert.deepEqual(f.scroll, []);
  await flush();
  assert.deepEqual(f.scroll, [[0, 480]]);
  c.navigationStarted(2, true);
  c.navigationScrolled(2, null);
  c.navigationStarted(3, false);
  await flush();
  assert.equal(f.scroll.length, 1);
  c.navigationStarted(4, true);
  c.navigationCancelled(4);
  c.navigationScrolled(4, null);
  await flush();
  assert.equal(f.scroll.length, 1);
  c.navigationStarted(5, true);
  c.navigationScrolled(5, null);
  f.browser.navigating = true;
  await flush();
  assert.equal(f.scroll.length, 1);
  f.browser.navigating = false;
  c.navigationStarted(6, true);
  const section = {
    fragment: 'dossier-media',
    sponsorshipId: 'synthetic-sponsor',
    tab: 'media'
  };
  c.navigationScrolled(6, section);
  assert.deepEqual(c.pendingSection(), section);
  c.navigationStarted(7, false);
  assert.equal(c.pendingSection(), null);
  c.navigationStarted(8, true);
  c.navigationScrolled(8, null);
  c.dispose();
  await flush();
  assert.equal(f.scroll.length, 1);
});

test('selection revision invalidates leave-and-return feedback and disposal cancels pulse and feedback timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t),
    c = f.controller;
  c.selectSponsorshipById('synthetic-sponsor');
  t.mock.timers.tick(0);
  assert.equal(c.selectionPulseId(), 'synthetic-sponsor');
  t.mock.timers.tick(520);
  assert.equal(c.selectionPulseId(), null);
  const old = c.beginApprovalFeedback('synthetic-sponsor');
  c.selectSponsorshipById('synthetic-second');
  c.selectSponsorshipById('synthetic-sponsor');
  c.finishApprovalFeedback(old, 'success');
  assert.equal(c.approvalFeedback(), null);
  const current = c.beginApprovalFeedback('synthetic-sponsor');
  c.finishApprovalFeedback(current, 'success');
  assert.equal(c.approvalFeedback().phase, 'success');
  t.mock.timers.tick(3000);
  assert.equal(c.approvalFeedback(), null);
  c.pulseSelection('synthetic-sponsor');
  c.beginApprovalFeedback('synthetic-sponsor');
  c.dispose();
  t.mock.timers.tick(5000);
  assert.equal(c.selectionPulseId(), null);
  assert.equal(c.approvalFeedback(), null);
});

for (const locale of ['fr-CA', 'en'])
  test(`feed filters keep existing ${locale} translations`, (t) => {
    const c = fixture(t, locale).controller;
    assert.deepEqual(
      c.feedStatusOptions().map(({ value }) => value),
      ['not_planned', 'planned', 'drafted', 'published']
    );
    assert.ok(
      c
        .feedStatusOptions()
        .every(({ label }) => label && !label.startsWith('admin.'))
    );
  });

test('a controller instance has independent state and construction does not read browser globals', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() {
      throw new Error('Unexpected browser access');
    }
  });
  t.after(() =>
    descriptor
      ? Object.defineProperty(globalThis, 'navigator', descriptor)
      : delete globalThis.navigator
  );
  const first = fixture(t).controller,
    second = fixture(t).controller;
  first.search.set('Synthetic isolated search');
  first.sponsorships.set([sponsor()]);
  assert.equal(second.search(), '');
  assert.deepEqual(second.sponsorships(), []);
});

test('a clipboard response after destruction cannot change copy feedback', async (t) => {
  const pending = deferred(),
    descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => pending.promise } }
  });
  t.after(() =>
    descriptor
      ? Object.defineProperty(globalThis, 'navigator', descriptor)
      : delete globalThis.navigator
  );
  const c = fixture(t).controller;
  const copied = c.copyReference(sponsor());
  c.dispose();
  pending.resolve();
  await copied;
  assert.deepEqual(c.copyMessages(), {});
});
