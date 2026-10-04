import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminPilotageReadController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/admin-pilotage-read.controller.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const decision = (id = 'synthetic-message', overrides = {}) => ({
  id: 'email:' + id,
  targetId: id,
  version: 'v1',
  domain: 'email',
  kind: 'email_failed',
  title: 'Synthetic queued email',
  dueAt: null,
  severity: 'today',
  detailsUrl: '/admin/fundraiser/email-queue',
  facts: [],
  actions: [{ id: 'email.retry', blocked: null }],
  ...overrides
});
const snapshot = (decisions = [decision()], overrides = {}) => ({
  generatedAt: '2026-10-03T12:00:00.000Z',
  coverage: 'complete',
  missingSources: [],
  total: decisions.length,
  page: 1,
  pageSize: 30,
  domains: {
    publications: 0,
    sponsors: 0,
    email: decisions.length,
    invoices: 0,
    contributions: 0,
    projects: 0,
    operations: 0
  },
  feeds: [],
  workerEnabled: false,
  writable: true,
  decisions,
  ...overrides
});
const email = {
  subject: 'Synthetic private subject',
  recipient: 'fixture@example.invalid',
  text: 'Synthetic private body'
};
const fixture = () => {
  const panel = signal('');
  const busy = signal(false);
  const error = signal('');
  const calls = { reads: [], calendars: 0, media: [], resets: 0, persists: 0 };
  const ports = {
    panel: panel.asReadonly(),
    busy: busy.asReadonly(),
    error,
    token: () => 'synthetic-test-token',
    translate: (key) => key,
    resetInput: () => calls.resets++,
    persist: () => calls.persists++,
    admin: {
      pilotage: async (query) => {
        calls.reads.push(query);
        return snapshot();
      },
      publicationAutomation: async () => {
        calls.calendars++;
        return { deliveries: [] };
      },
      getSponsorMediaPreview: async (token, id) => {
        calls.media.push({ token, id });
        return new Blob(['synthetic private photo']);
      }
    }
  };
  const read = new AdminPilotageReadController(ports);
  return { read, ports, panel, busy, error, calls };
};
const openDetails = async (f) => {
  await f.read.load(true);
  f.panel.set('details');
};

test('construction has no browser, storage or HTTP work until a read is requested', () => {
  const f = fixture();
  assert.deepEqual(f.calls, {
    reads: [],
    calendars: 0,
    media: [],
    resets: 0,
    persists: 0
  });
  assert.equal(f.read.state(), null);
  assert.equal(f.read.image(), '');
  f.read.dispose();
});

test('restoration chooses its dossier and server pagination rather than the first result', async () => {
  const f = fixture();
  const first = decision('first');
  const restored = decision('restored');
  f.ports.admin.pilotage = async (query) => {
    f.calls.reads.push(query);
    return snapshot([first, restored], { page: query.page, total: 61 });
  };
  f.read.domain.set('email');
  f.read.restoreSelection(restored.id);
  await f.read.load(true, 2);
  assert.equal(f.read.selected(), restored);
  assert.equal(f.read.pageCount(), 3);
  assert.deepEqual(f.read.following(), [first]);
  assert.deepEqual(f.calls.reads, [{ page: 2, domain: 'email' }]);
  await f.read.page(1);
  assert.equal(f.read.state().page, 3);
  assert.equal(f.read.selected(), first);
  assert.deepEqual(f.calls.reads.at(-1), { page: 3, domain: 'email' });
  assert.equal(f.read.loading(), false);
});

test('refresh preserves the examined dossier and exposes changed versions or permissions as stale', async () => {
  const f = fixture();
  await f.read.load(true);
  const examined = f.read.selected();
  const changed = {
    ...examined,
    version: 'v2',
    title: 'Changed server dossier'
  };
  f.ports.admin.pilotage = async () => snapshot([changed]);
  await f.read.load(false);
  assert.equal(f.read.selected(), examined);
  assert.equal(f.read.queue()[0], changed);
  assert.equal(f.read.stale(), true);
  f.read.choose(changed);
  assert.equal(f.read.stale(), false);
  f.ports.admin.pilotage = async () =>
    snapshot([
      { ...changed, actions: [{ id: 'email.retry', blocked: 'EMAIL_SENDING' }] }
    ]);
  await f.read.load(false);
  assert.equal(f.read.selected(), changed);
  assert.equal(f.read.stale(), true);
  f.ports.admin.pilotage = async () => snapshot([]);
  await f.read.load(false);
  assert.equal(f.read.selected(), changed);
  assert.equal(f.read.stale(), true);
});

test('newer projection wins and late failures do not change errors or loading', async () => {
  const f = fixture();
  const first = deferred();
  const next = deferred();
  let count = 0;
  f.ports.admin.pilotage = () => (++count === 1 ? first.promise : next.promise);
  const oldRead = f.read.load(true);
  const currentRead = f.read.load(true, 2);
  const current = snapshot([decision('current')], { page: 2 });
  next.resolve(current);
  await currentRead;
  first.reject(new Error('obsolete failure'));
  await oldRead;
  assert.equal(f.read.state(), current);
  assert.equal(f.read.selected(), current.decisions[0]);
  assert.equal(f.error(), '');
  assert.equal(f.read.loading(), false);
});

for (const outcome of ['success', 'failure']) {
  test(`a disposed projection ignores a late ${outcome}`, async () => {
    const f = fixture();
    const pending = deferred();
    f.ports.admin.pilotage = () => pending.promise;
    const loading = f.read.load(true);
    f.read.dispose();
    if (outcome === 'success') pending.resolve(snapshot());
    else pending.reject(new Error('disposed failure'));
    assert.equal(await loading, false);
    assert.equal(f.read.state(), null);
    assert.equal(f.read.selected(), null);
    assert.equal(f.error(), '');
    assert.equal(f.calls.persists, 0);
    assert.equal(await f.read.load(true), false);
  });
}

test('busy and open panels prevent navigation without changing its selection', async () => {
  const f = fixture();
  await f.read.load(true);
  const selected = f.read.selected();
  f.busy.set(true);
  assert.equal(f.read.choose(null), false);
  assert.equal(await f.read.changeDomain('publications'), false);
  assert.equal(await f.read.page(1), false);
  assert.equal(f.read.move(1), false);
  f.busy.set(false);
  f.panel.set('confirm');
  assert.equal(f.read.choose(null), false);
  assert.equal(f.read.move(1), false);
  assert.equal(await f.read.changeDomain('publications'), false);
  assert.equal(f.read.selected(), selected);
});

test('email changes require an explicit reread before replacing the examined version', async () => {
  const f = fixture();
  await openDetails(f);
  const examined = f.read.selected();
  const changed = { ...examined, version: 'v2', email };
  f.ports.admin.pilotage = async () => snapshot([changed], { writable: false });
  assert.equal(await f.read.loadDetails(), false);
  assert.equal(f.read.detailState(), 'changed');
  assert.equal(f.read.selected(), examined);
  assert.equal(f.read.queue()[0], changed);
  assert.equal(f.read.stale(), true);
  assert.equal(await f.read.loadDetails(true), true);
  assert.equal(f.read.selected(), changed);
  assert.equal(f.read.detailState(), 'ready');
  assert.equal(f.read.state().writable, false);
  assert.equal(f.read.stale(), false);
});

test('missing email or absent private payload never displays a ready preview', async () => {
  const f = fixture();
  await openDetails(f);
  const examined = f.read.selected();
  assert.equal(await f.read.loadDetails(), false);
  assert.equal(f.read.detailState(), 'missing');
  f.ports.admin.pilotage = async () => snapshot([]);
  assert.equal(await f.read.loadDetails(), false);
  assert.equal(f.read.detailState(), 'missing');
  assert.equal(f.read.selected(), examined);
  assert.deepEqual(f.read.queue(), []);
});

for (const [status, expected] of [
  [401, 'expired'],
  [403, 'forbidden'],
  [503, 'error']
]) {
  test(`private email reports ${status} explicitly and never replays a mutation`, async () => {
    const f = fixture();
    await openDetails(f);
    let reads = 0;
    f.ports.admin.pilotage = async () => {
      reads++;
      throw Object.assign(new Error('synthetic private read denied'), {
        status
      });
    };
    assert.equal(await f.read.loadDetails(), false);
    assert.equal(f.read.detailState(), expected);
    assert.equal(f.read.selected().email, undefined);
    assert.equal(reads, 1);
  });
}

for (const change of ['close', 'selection', 'dispose']) {
  test(`a private email response after ${change} cannot update the dossier`, async () => {
    const f = fixture();
    await openDetails(f);
    const original = f.read.selected();
    const pending = deferred();
    f.ports.admin.pilotage = () => pending.promise;
    const loading = f.read.loadDetails();
    if (change === 'close') {
      f.read.invalidatePanelReads();
      f.panel.set('');
    } else if (change === 'selection') f.read.choose(decision('next'));
    else f.read.dispose();
    pending.resolve(snapshot([{ ...original, email }]));
    assert.equal(await loading, false);
    assert.equal(f.read.detailState(), 'idle');
    assert.equal(f.read.selected().email, undefined);
  });
}

test('a reopened email ignores the preceding failure and suppresses duplicate detail reads', async () => {
  const f = fixture();
  await openDetails(f);
  const pending = deferred();
  f.ports.admin.pilotage = () => pending.promise;
  const previous = f.read.loadDetails();
  assert.equal(await f.read.loadDetails(), false);
  f.read.invalidatePanelReads();
  f.panel.set('');
  f.panel.set('details');
  f.ports.admin.pilotage = async () =>
    snapshot([{ ...f.read.selected(), email }]);
  await f.read.loadDetails();
  pending.reject(Object.assign(new Error('old failure'), { status: 403 }));
  await previous;
  assert.equal(f.read.detailState(), 'ready');
  assert.equal(f.read.selected().email, email);
});

test('email confirmation rereads the exact dossier and blocks a changed version', async () => {
  const f = fixture();
  await f.read.load(true);
  const original = f.read.selected();
  f.ports.admin.pilotage = async () =>
    snapshot([decision('unrelated'), { ...original, email }]);
  const detail = await f.read.rereadForAction(original);
  assert.equal(detail.id, original.id);
  assert.equal(f.read.selected(), detail);
  f.ports.admin.pilotage = async () => snapshot([{ ...detail, version: 'v2' }]);
  assert.equal(await f.read.rereadForAction(detail), null);
  assert.equal(f.error(), 'VERSION_CONFLICT');
  assert.equal(f.read.selected(), detail);
});

for (const change of ['close', 'selection', 'dispose']) {
  test(`targeted lookup after ${change} is discarded without an error`, async () => {
    const f = fixture();
    await openDetails(f);
    const pending = deferred();
    f.ports.admin.pilotage = () => pending.promise;
    const lookup = f.read.lookup(f.read.selected().id);
    if (change === 'close') {
      f.read.invalidatePanelReads();
      f.panel.set('');
    } else if (change === 'selection') f.read.choose(decision('another'));
    else f.read.dispose();
    pending.reject(new Error('old targeted read'));
    assert.equal(await lookup, null);
    assert.equal(f.error(), '');
  });
}

for (const change of ['panel', 'selection', 'dispose']) {
  test(`focus lookup cannot continue after ${change} during the following page read`, async () => {
    const f = fixture();
    await f.read.load(true);
    const original = f.read.selected();
    const initialState = f.read.state();
    f.error.set('existing-error');
    const target = decision('target');
    const pending = deferred();
    f.ports.admin.pilotage = () => pending.promise;
    const loading = f.read.focusDecision(
      snapshot([target], { focusPage: 2 }),
      target,
      'email'
    );
    if (change === 'panel') f.panel.set('help');
    else if (change === 'selection') f.read.choose(decision('another'));
    else f.read.dispose();
    pending.resolve(snapshot([target], { page: 2 }));
    assert.equal(await loading, false);
    assert.equal(f.read.state(), initialState);
    assert.equal(f.error(), 'existing-error');
    assert.notEqual(f.read.selected(), target);
    if (change !== 'selection') assert.equal(f.read.selected(), original);
  });
}

test('focus lookup selects its exact decision after a successful page refresh, including an empty prior queue', async () => {
  const f = fixture();
  const target = decision('target');
  const focused = snapshot([target], { focusPage: 3 });
  f.ports.admin.pilotage = async (query) => {
    f.calls.reads.push(query);
    return snapshot([target], { page: query.page });
  };
  assert.equal(await f.read.focusDecision(focused, target, 'email'), true);
  assert.equal(f.read.selected(), target);
  assert.deepEqual(f.calls.reads, [{ page: 3, domain: 'email' }]);
});

test('calendar maps statuses, destinations and translation keys from server deliveries', async () => {
  const f = fixture();
  f.panel.set('calendar');
  const statuses = [
    'draft',
    'approved',
    'publishing',
    'published',
    'cancelled',
    'rejected'
  ];
  f.ports.admin.publicationAutomation = async () => ({
    deliveries: statuses.map((status, index) => ({
      id: 'synthetic-delivery-' + index,
      feedId: index % 2 ? 'openg20:linkedin' : 'openg7:facebook',
      status,
      scheduledAt: '2030-10-03T12:00:00.000Z',
      message: 'Synthetic calendar message'
    }))
  });
  await f.read.loadCalendar();
  assert.equal(f.read.calendarState(), 'ready');
  assert.deepEqual(
    f.read.calendar().map((entry) => entry.status),
    ['open', 'scheduled', 'scheduled', 'published', 'cancelled', 'cancelled']
  );
  assert.equal(f.read.calendar()[1].target, 'openg20');
  assert.equal(f.read.calendar()[1].channel, 'linkedin');
  assert.equal(
    f.read.calendar()[1].statusLabel,
    'admin.publicationAutomation.status.approved'
  );
});

test('closing and reopening a calendar ignores its old failure', async () => {
  const f = fixture();
  f.panel.set('calendar');
  const pending = deferred();
  f.ports.admin.publicationAutomation = () => pending.promise;
  const previous = f.read.loadCalendar();
  f.read.invalidatePanelReads();
  f.panel.set('');
  f.panel.set('calendar');
  f.ports.admin.publicationAutomation = async () => ({ deliveries: [] });
  await f.read.loadCalendar();
  pending.reject(new Error('old calendar failure'));
  await previous;
  assert.equal(f.read.calendarState(), 'ready');
  assert.deepEqual(f.read.calendar(), []);
});

for (const change of ['selection', 'dispose']) {
  test(`calendar ignores a response after ${change}`, async () => {
    const f = fixture();
    f.panel.set('calendar');
    const pending = deferred();
    f.ports.admin.publicationAutomation = () => pending.promise;
    const loading = f.read.loadCalendar();
    if (change === 'selection') f.read.choose(decision('next'));
    else f.read.dispose();
    pending.resolve({
      deliveries: [
        {
          id: 'old',
          feedId: 'openg7:facebook',
          status: 'approved',
          scheduledAt: null,
          message: 'Old delivery'
        }
      ]
    });
    await loading;
    assert.equal(f.read.calendarState(), 'idle');
    assert.deepEqual(f.read.calendar(), []);
  });
}

test('current calendar failure is explicit and never loads a closed calendar', async () => {
  const f = fixture();
  await f.read.loadCalendar();
  assert.equal(f.calls.calendars, 0);
  f.panel.set('calendar');
  f.ports.admin.publicationAutomation = async () => {
    throw new Error('synthetic unavailable');
  };
  await f.read.loadCalendar();
  assert.equal(f.read.calendarState(), 'error');
});

test('media ownership releases URLs and ignores older success and failure after selection or disposal', async (t) => {
  const f = fixture();
  const created = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = 'blob:synthetic-' + (created.length + 1);
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const old = deferred();
  const current = deferred();
  const after = deferred();
  const requests = [old, current, after];
  f.ports.admin.getSponsorMediaPreview = (token, id) => {
    f.calls.media.push({ token, id });
    return requests.shift().promise;
  };
  f.read.choose(
    decision('old', { sponsor: { presentationId: 'old-private-media' } })
  );
  f.read.choose(
    decision('current', { publication: { mediaId: 'current-private-media' } })
  );
  const photo = new Blob(['current synthetic photo']);
  current.resolve(photo);
  await current.promise;
  assert.equal(f.read.image(), 'blob:synthetic-1');
  old.reject(new Error('old media unavailable'));
  await old.promise.catch(() => {});
  assert.equal(f.read.previewFailed(), false);
  assert.equal(created.length, 1);
  f.read.choose(
    decision('after', { sponsor: { presentationId: 'after-private-media' } })
  );
  assert.equal(f.read.image(), '');
  assert.deepEqual(revoked, ['blob:synthetic-1']);
  f.read.dispose();
  after.resolve(new Blob(['disposed photo']));
  await after.promise;
  assert.equal(created.length, 1);
  assert.equal(f.read.image(), '');
  assert.deepEqual(
    f.calls.media.map(({ id }) => id),
    ['old-private-media', 'current-private-media', 'after-private-media']
  );
});

test('a current media failure is explicit and a dossier without media clears the fallback', async () => {
  const f = fixture();
  const pending = deferred();
  f.ports.admin.getSponsorMediaPreview = () => pending.promise;
  f.read.choose(
    decision('photo', {
      sponsor: { presentationId: 'synthetic-private-photo' }
    })
  );
  pending.reject(new Error('synthetic unavailable preview'));
  await pending.promise.catch(() => {});
  assert.equal(f.read.previewFailed(), true);
  assert.equal(f.read.image(), '');
  f.read.choose(decision('without-photo'));
  assert.equal(f.read.previewFailed(), false);
  assert.equal(f.read.image(), '');
});
