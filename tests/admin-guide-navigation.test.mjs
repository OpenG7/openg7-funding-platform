import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { platformServer, ServerModule } from '@angular/platform-server';
import { NavigationSkipped, NavigationStart, Router } from '@angular/router';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';
import { Subject } from 'rxjs';

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
const { AdminGuideNavigationService, adminWorkspaceNavigationGuard } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-guide-navigation.service.js');
const { AdminPublicationNavigationService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-publication-navigation.service.js');
const { FundingAdminService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js');
workspaceHook.deregister();

before(() =>
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  )
);
after(() => TestBed.resetTestEnvironment());

function deferred() {
  let resolve;
  const promise = new Promise((accept) => (resolve = accept));
  return { promise, resolve };
}

function fixture(t) {
  const valid = signal(true);
  const admin = {
    sessionGeneration: signal(1),
    identity: signal({ id: 'synthetic-owner', sessionId: 'synthetic-session' }),
    hasValidAdminSession: () => valid()
  };
  const events = new Subject();
  const publications = { canLeave: async () => true };
  TestBed.configureTestingModule({
    providers: [
      AdminGuideNavigationService,
      { provide: FundingAdminService, useValue: admin },
      { provide: Router, useValue: { events } },
      { provide: AdminPublicationNavigationService, useValue: publications }
    ]
  });
  const registry = TestBed.inject(AdminGuideNavigationService);
  TestBed.tick();
  t.after(() => TestBed.resetTestingModule());
  return { registry, admin, valid, events, publications };
}

function participant(log, work = true) {
  const decision = deferred();
  return {
    hasLocalWork: () => work,
    reveal: () => log.push('reveal'),
    canLeave: () => {
      log.push('decide');
      return decision.promise;
    },
    cancelLeave: () => {
      log.push('cancel');
      decision.resolve(false);
    },
    answer: decision.resolve
  };
}

test('a reading-only guide leaves without revealing or requesting a decision', async (t) => {
  const f = fixture(t);
  const log = [];
  f.registry.register(participant(log, false));
  assert.equal(await f.registry.canLeave(), true);
  assert.deepEqual(log, []);
});

test('a mounted draft is revealed and cancellation preserves its participation', async (t) => {
  const f = fixture(t);
  const log = [];
  const guide = participant(log);
  f.registry.register(guide);
  const leaving = f.registry.canLeave();
  assert.deepEqual(log, ['reveal', 'decide']);
  assert.equal(await f.registry.canLeave(), false);
  guide.answer(false);
  assert.equal(await leaving, false);
  assert.equal(guide.hasLocalWork(), true);
});

for (const navigation of [
  () => new NavigationStart(2, '/admin/fundraiser/attention'),
  () => new NavigationSkipped(2, '/admin/fundraiser', 'Same URL')
]) {
  test(`${navigation().constructor.name} cancels an earlier pending departure`, async (t) => {
    const f = fixture(t);
    const log = [];
    f.registry.register(participant(log));
    const leaving = f.registry.canLeave();
    f.events.next(navigation());
    assert.equal(await leaving, false);
    assert.deepEqual(log, ['reveal', 'decide', 'cancel']);
  });
}

test('unmounting a participant cancels its decision and releases the registry', async (t) => {
  const f = fixture(t);
  const log = [];
  const unregister = f.registry.register(participant(log));
  const leaving = f.registry.canLeave();
  unregister();
  assert.equal(await leaving, false);
  assert.equal(await f.registry.canLeave(), true);
  assert.deepEqual(log, ['reveal', 'decide', 'cancel']);
});

for (const change of ['revoke', 'account', 'generation']) {
  test(`session ${change} cancels a pending draft without blocking forced cleanup`, async (t) => {
    const f = fixture(t);
    const log = [];
    f.registry.register(participant(log));
    const leaving = f.registry.canLeave();
    if (change === 'revoke') f.valid.set(false);
    else if (change === 'account')
      f.admin.identity.set({
        id: 'synthetic-other-owner',
        sessionId: 'synthetic-other-session'
      });
    else f.admin.sessionGeneration.update((value) => value + 1);
    TestBed.tick();
    assert.equal(await leaving, true);
    assert.deepEqual(log, ['reveal', 'decide', 'cancel']);
  });
}

test('an expired session bypasses guide decisions entirely', async (t) => {
  const f = fixture(t);
  const log = [];
  f.registry.register(participant(log));
  f.valid.set(false);
  assert.equal(await f.registry.canLeave(), true);
  assert.deepEqual(log, []);
});

test('editorial protection completes before the guide can show its confirmation', async (t) => {
  const f = fixture(t);
  const log = [];
  const editorial = deferred();
  const guide = participant(log);
  f.registry.register(guide);
  f.publications.canLeave = () => {
    log.push('editorial');
    return editorial.promise;
  };
  const current = { routeConfig: {}, children: [] };
  const next = { root: { routeConfig: {}, children: [] } };
  const leaving = TestBed.runInInjectionContext(() =>
    adminWorkspaceNavigationGuard(null, current, {}, next)
  );
  assert.deepEqual(log, ['editorial']);
  editorial.resolve(true);
  await Promise.resolve();
  assert.deepEqual(log, ['editorial', 'reveal', 'decide']);
  guide.answer(true);
  assert.equal(await leaving, true);
});

test('declining an editorial discard never opens the guide confirmation', async (t) => {
  const f = fixture(t);
  const log = [];
  f.registry.register(participant(log));
  f.publications.canLeave = async () => false;
  const result = await TestBed.runInInjectionContext(() =>
    adminWorkspaceNavigationGuard(
      null,
      { routeConfig: {}, children: [] },
      {},
      { root: { routeConfig: {}, children: [] } }
    )
  );
  assert.equal(result, false);
  assert.deepEqual(log, []);
});

test('a reused page keeps its mounted guide when only route state changes', async (t) => {
  const f = fixture(t);
  const log = [];
  const routeConfig = {};
  f.registry.register(participant(log));
  f.publications.canLeave = async () => {
    log.push('editorial');
    return true;
  };
  const result = await TestBed.runInInjectionContext(() =>
    adminWorkspaceNavigationGuard(
      null,
      { routeConfig, children: [] },
      {},
      {
        root: {
          routeConfig: null,
          children: [{ routeConfig, children: [] }]
        }
      }
    )
  );
  assert.equal(result, true);
  assert.deepEqual(log, ['editorial']);
});
