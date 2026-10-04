import assert from 'node:assert/strict';
import test from 'node:test';

import { signal } from '@angular/core';

import { SponsorshipFollowupError } from '../dist/apps/funding-web/src/app/features/funding/models/sponsorship-followup-ui.js';
import { SponsorshipFollowupController } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorship-followup-controller.js';

const token = 'synthetic-followup-local-only-000000000001';
const details = (companyName = 'Synthetic workshop') => ({
  companyName,
  contactName: 'Synthetic contact',
  contactEmail: 'contact@example.test',
  websiteUrl: 'https://example.test',
  logoUrl: undefined,
  message: undefined
});
const followup = (overrides = {}) => ({
  found: true,
  publicReference: 'CMD-SYNTHETIC-101',
  paymentStatus: 'paid',
  reviewStatus: 'pending_review',
  amount: 250,
  currency: 'CAD',
  paidAt: '2026-09-18T12:00:00Z',
  sponsorshipTier: null,
  sponsorshipBenefits: ['website_mention'],
  detailsSubmitted: true,
  ...details(),
  reviewedAt: null,
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
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const fixture = (t, overrides = {}) => {
  const state = {
    current: followup(overrides),
    remembered: '',
    flushes: 0,
    clears: 0
  };
  const reads = [];
  const posts = [];
  const draftLoads = [];
  const browserCalls = [];
  const ports = {
    api: {
      getSponsorshipFollowup: async (value) => {
        reads.push(value);
        return state.current;
      },
      submitSponsorshipFollowupDetails: async (payload) => {
        posts.push(payload);
        state.current = followup({ ...payload, detailsSubmitted: true });
        return { received: true, recorded: true };
      }
    },
    drafts: {
      revision: signal(null),
      state: signal('loading'),
      load: async (value, restore = true) => {
        draftLoads.push({ token: value, restore });
        ports.drafts.revision.set(4);
        ports.drafts.state.set('idle');
      },
      flush: async () => {
        state.flushes++;
        return true;
      },
      clear: () => {
        state.clears++;
        ports.drafts.revision.set(null);
        ports.drafts.state.set('unavailable');
      }
    },
    browser: {
      getRememberedToken: () => {
        browserCalls.push('get');
        return state.remembered;
      },
      rememberToken: (value) => {
        browserCalls.push('remember');
        state.remembered = value;
      },
      clearToken: () => {
        browserCalls.push('clear');
        state.remembered = '';
      },
      removeUrlToken: () => browserCalls.push('removeUrl')
    }
  };
  const controller = new SponsorshipFollowupController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, state, reads, posts, draftLoads, browserCalls };
};

test('a URL token overrides remembered access, is remembered and cleaned before reading', async (t) => {
  const f = fixture(t);
  f.state.remembered = 'another-synthetic-followup-local-only-000001';
  assert.equal(await f.controller.initialize(token), true);
  assert.equal(f.controller.token(), token);
  assert.deepEqual(f.browserCalls, ['remember', 'removeUrl']);
  assert.deepEqual(f.reads, [token]);
  assert.deepEqual(f.draftLoads, [{ token, restore: true }]);
  assert.equal(f.controller.recoveryEntry(), false);
});

test('invalid explicit links never resume a remembered dossier and clear private access', async (t) => {
  for (const invalid of ['', 'short', 'x'.repeat(129), 'x'.repeat(32) + '%']) {
    const f = fixture(t);
    f.state.remembered = token;
    assert.equal(await f.controller.initialize(invalid), false);
    assert.deepEqual(f.browserCalls, ['removeUrl', 'clear']);
    assert.deepEqual(f.reads, []);
    assert.equal(f.state.remembered, '');
    assert.equal(f.controller.token(), '');
    assert.equal(f.controller.loadError(), 'access');
    assert.equal(f.controller.followup(), null);
    assert.equal(f.controller.recoveryEntry(), false);
  }
});

test('missing URL access resumes only a valid remembered token or opens recovery', async (t) => {
  for (const remembered of [token, '', 'invalid']) {
    const f = fixture(t);
    f.state.remembered = remembered;
    await f.controller.initialize(null);
    assert.equal(f.controller.token(), remembered === token ? token : '');
    assert.equal(f.controller.recoveryEntry(), remembered !== token);
    assert.deepEqual(f.reads, remembered === token ? [token] : []);
    assert.equal(f.browserCalls[0], 'get');
  }
});

test('page instances keep tokens, snapshots and feedback independent', async (t) => {
  const first = fixture(t, { detailsSubmitted: false });
  const second = fixture(t);
  await first.controller.initialize(token);
  assert.equal(first.controller.needsDetails(), true);
  assert.equal(
    first.controller.nextStepMessage(),
    'funding.followup.nextStep.details'
  );
  assert.equal(second.controller.followup(), null);
  assert.equal(second.controller.token(), '');
  await first.controller.submit(details('Changed workshop'));
  assert.equal(first.controller.saveState(), 'saved');
  assert.equal(second.controller.saveState(), 'idle');
  assert.equal(first.controller.needsDetails(), false);
  assert.equal(
    first.controller.nextStepMessage(),
    'funding.followup.nextStep.submitted'
  );
});

test('unavailable reads retain the last snapshot and allow retry without reporting expired access', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  const snapshot = f.controller.followup();
  f.ports.api.getSponsorshipFollowup = async () => {
    throw new SponsorshipFollowupError(503);
  };
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.followup(), snapshot);
  assert.equal(f.controller.loadError(), 'unavailable');
  assert.equal(f.controller.loading(), false);
  assert.equal(f.state.remembered, token);
  f.ports.api.getSponsorshipFollowup = async () =>
    followup({ paymentStatus: 'pending' });
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.loadError(), null);
  assert.equal(
    f.controller.nextStepMessage(),
    'funding.followup.payment.pending.copy'
  );
});

test('expired reads clear token, draft and private snapshot', async (t) => {
  for (const status of [400, 401, 403, 404, 410]) {
    const f = fixture(t);
    await f.controller.initialize(token);
    f.ports.api.getSponsorshipFollowup = async () => {
      throw new SponsorshipFollowupError(status);
    };
    await f.controller.load();
    assert.equal(f.controller.loadError(), 'access');
    assert.equal(f.controller.followup(), null);
    assert.equal(f.controller.token(), '');
    assert.equal(f.state.remembered, '');
    assert.equal(f.state.clears, 1);
    assert.equal(f.controller.loading(), false);
  }
});

test('busy reads cannot overlap or submit, and a late response cannot restore expired access', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  const request = deferred();
  let requests = 0;
  f.ports.api.getSponsorshipFollowup = () => {
    requests++;
    return request.promise;
  };
  const read = f.controller.load();
  assert.equal(await f.controller.load(), false);
  await f.controller.submit(details('Changed workshop'));
  assert.equal(requests, 1);
  assert.deepEqual(f.posts, []);
  f.controller.clearAccess();
  request.resolve(followup());
  assert.equal(await read, false);
  assert.equal(f.controller.followup(), null);
  assert.equal(f.controller.loadError(), 'access');
});

test('draft initialization invalidated by access expiry cannot trigger another draft reload', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  f.ports.drafts.revision.set(null);
  const pending = deferred();
  let loads = 0;
  f.ports.drafts.load = async () => {
    loads++;
    await pending.promise;
  };
  const reload = f.controller.reloadDraft();
  await settle();
  f.controller.clearAccess();
  pending.resolve();
  await reload;
  assert.equal(loads, 1);
  assert.equal(f.controller.followup(), null);
});

test('editing eligibility and unchanged values block submissions before draft flush', async (t) => {
  for (const overrides of [
    { paymentStatus: 'pending' },
    { paymentStatus: 'failed' },
    { paymentStatus: 'expired' },
    { reviewStatus: 'rejected' }
  ]) {
    const f = fixture(t, overrides);
    await f.controller.initialize(token);
    await f.controller.submit(details('Changed workshop'));
    assert.equal(f.state.flushes, 0);
    assert.deepEqual(f.posts, []);
  }
  const f = fixture(t);
  await f.controller.initialize(token);
  await f.controller.submit(details('  Synthetic workshop  '));
  assert.equal(f.state.flushes, 0);
  assert.deepEqual(f.posts, []);
});

test('refunded, disputed and approved records retain existing edit eligibility', async (t) => {
  for (const overrides of [
    { paymentStatus: 'refunded' },
    { paymentStatus: 'disputed' },
    { reviewStatus: 'approved' }
  ]) {
    const f = fixture(t, overrides);
    await f.controller.initialize(token);
    await f.controller.submit(details('Changed workshop'));
    assert.equal(f.posts.length, 1);
    assert.equal(f.controller.saveState(), 'saved');
  }
});

test('submission flushes first, uses the resulting revision and blocks double submission', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  const flush = deferred();
  f.ports.drafts.flush = () => flush.promise;
  const save = f.controller.submit(details('  Changed workshop  '));
  await f.controller.submit(details('Another workshop'));
  assert.equal(f.controller.saving(), true);
  assert.deepEqual(f.posts, []);
  f.ports.drafts.revision.set(9);
  flush.resolve(true);
  await save;
  assert.deepEqual(f.posts, [
    { token, ...details('Changed workshop'), draftRevision: 9 }
  ]);
  assert.equal(f.controller.saving(), false);
  assert.equal(f.controller.saveState(), 'saved');
  assert.deepEqual(f.draftLoads, [
    { token, restore: true },
    { token, restore: false }
  ]);
  assert.equal(f.reads.length, 2);
});

test('failed draft flush leaves submission available without sending details', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  f.ports.drafts.flush = async () => false;
  await f.controller.submit(details('Changed workshop'));
  assert.deepEqual(f.posts, []);
  assert.equal(f.controller.saveState(), 'idle');
  assert.equal(f.controller.saving(), false);
  assert.equal(f.controller.savedDetails(), null);
});

test('both received and recorded must be true before showing saved details or reloading', async (t) => {
  for (const result of [
    { received: true, recorded: false },
    { received: false, recorded: true },
    { received: false, recorded: false }
  ]) {
    const f = fixture(t);
    await f.controller.initialize(token);
    f.ports.api.submitSponsorshipFollowupDetails = async () => result;
    await f.controller.submit(details('Changed workshop'));
    assert.equal(f.controller.saveState(), 'unconfirmed');
    assert.equal(f.controller.savedDetails(), null);
    assert.equal(f.controller.saving(), false);
    assert.equal(f.draftLoads.length, 1);
    assert.equal(f.reads.length, 1);
  }
});

test('a confirmed save stays saved after refresh failure and unchanged details cannot be sent again', async (t) => {
  const f = fixture(t, { detailsSubmitted: false });
  await f.controller.initialize(token);
  f.ports.api.getSponsorshipFollowup = async () => {
    throw new SponsorshipFollowupError(503);
  };
  await f.controller.submit(details('Changed workshop'));
  assert.equal(f.controller.saveState(), 'saved');
  assert.deepEqual(f.controller.savedDetails(), details('Changed workshop'));
  assert.equal(f.controller.loadError(), 'unavailable');
  assert.equal(f.controller.needsDetails(), false);
  await f.controller.submit(details('Changed workshop'));
  assert.equal(f.posts.length, 1);
  assert.equal(f.state.flushes, 1);
});

test('HTTP 400 validation and draft conflicts preserve access and the current record', async (t) => {
  for (const error of [
    new SponsorshipFollowupError(400),
    new SponsorshipFollowupError(409, 'draft_conflict'),
    new Error('synthetic network failure')
  ]) {
    const f = fixture(t);
    await f.controller.initialize(token);
    const snapshot = f.controller.followup();
    f.ports.api.submitSponsorshipFollowupDetails = async () => {
      throw error;
    };
    await f.controller.submit(details('Changed workshop'));
    assert.equal(f.controller.saveState(), 'error');
    assert.equal(f.controller.followup(), snapshot);
    assert.equal(f.state.remembered, token);
    assert.equal(f.controller.token(), token);
    assert.equal(f.state.clears, 0);
    assert.equal(
      f.ports.drafts.state(),
      error.code === 'draft_conflict' ? 'conflict' : 'idle'
    );
  }
});

test('expired submission access clears the record instead of claiming success', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  f.ports.api.submitSponsorshipFollowupDetails = async () => {
    throw new SponsorshipFollowupError(410);
  };
  await f.controller.submit(details('Changed workshop'));
  assert.equal(f.controller.followup(), null);
  assert.equal(f.controller.loadError(), 'access');
  assert.equal(f.controller.savedDetails(), null);
  assert.equal(f.state.remembered, '');
  assert.equal(f.controller.saving(), false);
});

test('explicit draft reload reads the latest follow-up then restores the server draft', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  f.state.current = followup({ companyName: 'External correction' });
  f.ports.drafts.state.set('conflict');
  await f.controller.reloadDraft();
  assert.equal(f.controller.followup().companyName, 'External correction');
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.draftLoads.at(-1), { token, restore: true });
  assert.equal(f.ports.drafts.state(), 'idle');
});

test('destruction during a read ignores success and failures without loading a draft', async (t) => {
  for (const reject of [false, true]) {
    const f = fixture(t);
    const request = deferred();
    f.ports.api.getSponsorshipFollowup = () => request.promise;
    const initial = f.controller.initialize(token);
    f.controller.dispose();
    if (reject) request.reject(new SponsorshipFollowupError(410));
    else request.resolve(followup());
    assert.equal(await initial, false);
    assert.equal(f.controller.followup(), null);
    assert.equal(f.controller.loadError(), null);
    assert.deepEqual(f.draftLoads, []);
    assert.equal(await f.controller.load(), false);
    await f.controller.reloadDraft();
    await f.controller.submit(details('Changed workshop'));
    assert.deepEqual(f.posts, []);
  }
});

test('destruction or access expiration during flush prevents a subsequent details POST', async (t) => {
  for (const action of ['dispose', 'clearAccess']) {
    const f = fixture(t);
    await f.controller.initialize(token);
    const flush = deferred();
    f.ports.drafts.flush = () => flush.promise;
    const save = f.controller.submit(details('Changed workshop'));
    f.controller[action]();
    flush.resolve(true);
    await save;
    assert.deepEqual(f.posts, []);
    assert.equal(f.controller.savedDetails(), null);
  }
});

test('late mutation receipts cannot mark saved after destruction or expired access', async (t) => {
  for (const action of ['dispose', 'clearAccess']) {
    const f = fixture(t);
    await f.controller.initialize(token);
    const request = deferred();
    f.ports.api.submitSponsorshipFollowupDetails = () => request.promise;
    const save = f.controller.submit(details('Changed workshop'));
    await settle();
    f.controller[action]();
    request.resolve({ received: true, recorded: true });
    await save;
    assert.equal(f.controller.savedDetails(), null);
    assert.equal(f.controller.saveState(), 'idle');
    assert.equal(f.draftLoads.length, 1);
    assert.equal(f.reads.length, 1);
  }
});

test('destruction during confirmed draft reconciliation prevents a follow-up refresh', async (t) => {
  const f = fixture(t);
  await f.controller.initialize(token);
  const reload = deferred();
  f.ports.drafts.load = () => reload.promise;
  const save = f.controller.submit(details('Changed workshop'));
  await settle();
  assert.equal(f.controller.saveState(), 'saved');
  f.controller.dispose();
  reload.resolve();
  await save;
  assert.equal(f.reads.length, 1);
});
