import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { platformServer, ServerModule } from '@angular/platform-server';
import { Router } from '@angular/router';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';
import { Subject } from 'rxjs';

const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['@openg7/funding-core', '@openg7/funding-i18n'].includes(specifier)) {
      return {
        url: new URL(
          `../dist/packages/${specifier.slice('@openg7/'.length)}/src/index.js`,
          import.meta.url
        ).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});
const { FundingModerationActionsComponent } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-moderation/funding-moderation-actions.component.js');
const { FundingAdminService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js');
const { FundingModerationService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-moderation.service.js');
const { AdminConfirmationService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-confirmation.service.js');
const { FundingI18nService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-i18n.service.js');
workspaceHook.deregister();

before(() =>
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  )
);
after(() => TestBed.resetTestEnvironment());

const originalSubject = { type: 'sponsorship', id: 'synthetic-sponsor' };
const originalDecision = { id: 'synthetic-decision', level: 'N4' };
const originalAppeal = { id: 'synthetic-appeal', state: 'open' };
const members = [
  { id: 'synthetic-first', role: 'owner', disabled: false },
  { id: 'synthetic-second', role: 'operator', disabled: false }
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(t, role = 'owner') {
  const writes = [];
  const events = new Subject();
  const admin = {
    sessionGeneration: signal(0),
    identity: signal({
      id: 'synthetic-original-account',
      sessionId: 'synthetic-session-original',
      role
    }),
    moderationCases: async () => ({
      items: [
        {
          state: 'pending_independent_review',
          currentDecisionId: originalDecision.id,
          assignedTo: 'admin:synthetic-first'
        }
      ]
    }),
    moderationDecisions: async () => ({ items: [originalDecision] }),
    moderationReconsiderations: async () => ({ items: [originalAppeal] }),
    accessAccounts: async () => ({ accounts: members }),
    assignModeration: async (...args) => {
      writes.push(args);
    },
    moderationDecision: async (...args) => {
      writes.push(args);
    }
  };
  const confirmation = { confirm: async () => true };
  TestBed.configureTestingModule({
    providers: [
      { provide: FundingAdminService, useValue: admin },
      { provide: AdminConfirmationService, useValue: confirmation },
      { provide: FundingI18nService, useValue: { t: (key) => key } },
      {
        provide: Router,
        useValue: { events, url: '/admin/fundraiser/sponsors' }
      }
    ]
  });
  const moderation = TestBed.inject(FundingModerationService);
  const actions = TestBed.runInInjectionContext(
    () => new FundingModerationActionsComponent()
  );
  // Supply the required subject while exercising the component's actual effects.
  const subject = signal(originalSubject);
  actions.subject = subject;
  TestBed.tick();
  t.after(() => {
    moderation.answer(null);
    TestBed.resetTestingModule();
    events.complete();
  });
  return { admin, moderation, confirmation, actions, subject, writes };
}

function replaceSession(f, { generation = true, flush = true } = {}) {
  f.admin.identity.update((identity) => ({
    ...identity,
    sessionId: 'synthetic-session-replacement'
  }));
  if (generation) f.admin.sessionGeneration.update((value) => value + 1);
  if (flush) TestBed.tick();
}

function assertPrivateStateCleared(actions) {
  assert.equal(actions.level(), 'N1');
  assert.equal(actions.busy(), false);
  assert.equal(actions.notice(), '');
  assert.equal(actions.caseState(), '');
  assert.equal(actions.currentDecisionId(), null);
  assert.deepEqual(actions.decisions(), []);
  assert.deepEqual(actions.reconsiderations(), []);
  assert.deepEqual(actions.members(), []);
  assert.equal(actions.assignedTo(), null);
  assert.equal(actions.assignmentDraft(), '');
  assert.equal(actions.assignmentState(), 'idle');
}

for (const change of ['generation', 'OIDC session']) {
  test(`a changed ${change} clears the owner history, level, assignment and notice`, async (t) => {
    const f = fixture(t);
    await f.actions.loadHistory();
    f.actions.setLevel({ target: { value: 'N4' } });
    f.actions.assignmentDraft.set('admin:synthetic-second');
    await f.actions.assign();
    assert.equal(f.actions.notice(), 'admin.moderation.assignmentSaved');
    assert.deepEqual(f.actions.decisions(), [originalDecision]);
    assert.deepEqual(f.actions.reconsiderations(), [originalAppeal]);
    assert.deepEqual(f.actions.members(), members);
    assert.equal(f.actions.level(), 'N4');

    if (change === 'generation') {
      f.admin.sessionGeneration.update((value) => value + 1);
      TestBed.tick();
    } else replaceSession(f, { generation: false });

    assert.equal(f.actions.canReview(), true);
    assert.equal(f.actions.canAssign(), true);
    assertPrivateStateCleared(f.actions);
    assert.equal(f.writes.length, 1);
  });
}

test('refreshing the same subject and identity within one session preserves local review context', async (t) => {
  const f = fixture(t);
  await f.actions.loadHistory();
  f.actions.setLevel({ target: { value: 'N4' } });
  f.subject.set({ ...originalSubject });
  f.admin.identity.update((identity) => ({ ...identity }));
  TestBed.tick();

  assert.equal(f.actions.level(), 'N4');
  assert.deepEqual(f.actions.decisions(), [originalDecision]);
  assert.deepEqual(f.actions.reconsiderations(), [originalAppeal]);
  assert.deepEqual(f.actions.members(), members);
  assert.equal(f.actions.assignmentState(), 'ready');
  assert.deepEqual(f.writes, []);
});

for (const outcome of ['success', 'failure']) {
  test(`a late history ${outcome} from a replaced session cannot restore private context or a notice`, async (t) => {
    const f = fixture(t);
    const response = deferred();
    let accountReads = 0;
    f.admin.moderationCases = () => response.promise;
    f.admin.accessAccounts = async () => {
      accountReads++;
      return { accounts: members };
    };
    const loading = f.actions.loadHistory();
    replaceSession(f, { generation: false, flush: false });
    if (outcome === 'failure') response.reject(new Error('synthetic failure'));
    else response.resolve({ items: [{ state: 'restricted' }] });
    await loading;

    assertPrivateStateCleared(f.actions);
    TestBed.tick();
    assert.equal(accountReads, 0);
    assert.deepEqual(f.writes, []);
  });
}

test('a late account list from a replaced owner session cannot restore private assignments', async (t) => {
  const f = fixture(t);
  const response = deferred();
  const accountRead = deferred();
  f.admin.accessAccounts = () => {
    accountRead.resolve();
    return response.promise;
  };
  const loading = f.actions.loadHistory();
  await accountRead.promise;
  assert.equal(f.actions.assignmentState(), 'loading');
  replaceSession(f, { generation: false, flush: false });
  response.resolve({ accounts: members });
  await loading;

  assert.deepEqual(f.actions.members(), []);
  assert.equal(f.actions.assignmentState(), 'loading');
  TestBed.tick();
  assertPrivateStateCleared(f.actions);
  assert.deepEqual(f.writes, []);
});

test('a decision returned before effects run cannot write under a replacement OIDC session', async (t) => {
  const f = fixture(t, 'operator');
  const deciding = f.actions.decide();
  assert.equal(f.actions.busy(), true);
  replaceSession(f, { generation: false, flush: false });
  f.moderation.answer({ level: 'N4' });
  await deciding;
  assert.deepEqual(f.writes, []);
  TestBed.tick();

  assertPrivateStateCleared(f.actions);
  assert.deepEqual(f.writes, []);
});

for (const change of ['session', 'account', 'destroy']) {
  test(`${change} context cleanup cancels only the decision opened by these actions`, async (t) => {
    const f = fixture(t, 'operator');
    const deciding = f.actions.decide();
    assert.ok(f.moderation.pending());
    if (change === 'destroy') TestBed.resetTestingModule();
    else {
      if (change === 'session') replaceSession(f, { generation: false });
      else {
        f.admin.identity.update((identity) => ({
          ...identity,
          id: 'synthetic-replacement-account'
        }));
        TestBed.tick();
      }
    }
    assert.equal(f.moderation.pending(), null);
    await deciding;
    assert.deepEqual(f.writes, []);
  });
}

test('a refused action never takes ownership of an existing decision from another component', async (t) => {
  const f = fixture(t, 'operator');
  const foreignDecision = f.moderation.requestDecision(originalSubject, 'N0');
  const pending = f.moderation.pending();
  const deciding = f.actions.decide();
  replaceSession(f, { generation: false });

  assert.equal(f.moderation.pending(), pending);
  await deciding;
  f.moderation.answer(null);
  assert.equal(await foreignDecision, null);
  assert.deepEqual(f.writes, []);
});

test('a confirmed assignment from the old session cannot write under a replacement owner session', async (t) => {
  const f = fixture(t);
  await f.actions.loadHistory();
  f.actions.assignmentDraft.set('admin:synthetic-second');
  const response = deferred();
  f.confirmation.confirm = () => response.promise;
  const assigning = f.actions.assign();
  replaceSession(f);
  response.resolve(true);
  await assigning;

  assertPrivateStateCleared(f.actions);
  assert.deepEqual(f.writes, []);
});
