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
const { FundingModerationFeatureComponent } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-moderation/funding-moderation-feature.component.js');
const { FundingAdminService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js');
const { FundingModerationService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-moderation.service.js');
workspaceHook.deregister();

before(() =>
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  )
);
after(() => TestBed.resetTestEnvironment());

const firstSubject = Object.freeze({
  type: 'sponsorship',
  id: 'synthetic-subject-original'
});
const secondSubject = Object.freeze({
  type: 'sponsorship',
  id: 'synthetic-subject-next'
});

function fixture(t) {
  const events = new Subject();
  const admin = {
    sessionGeneration: signal(0),
    identity: signal({ role: 'operator' })
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: FundingAdminService, useValue: admin },
      { provide: Router, useValue: { events } }
    ]
  });
  const moderation = TestBed.inject(FundingModerationService);
  const feature = TestBed.runInInjectionContext(
    () => new FundingModerationFeatureComponent()
  );
  // Exercise the feature lifecycle independently of rendering its action panel.
  // These signals supply the subject input and the child's in-flight state.
  const subject = signal(firstSubject);
  const busy = signal(false);
  feature.subject = subject;
  feature.busy = busy;
  const openedChanges = [];
  feature.openedChange.subscribe((opened) => openedChanges.push(opened));
  TestBed.tick();
  t.after(() => {
    moderation.answer(null);
    TestBed.resetTestingModule();
    events.complete();
  });
  return { admin, moderation, feature, subject, busy, openedChanges };
}

function beginDecision(f, subject = firstSubject) {
  f.feature.open(false);
  assert.equal(f.feature.opened(), true);
  assert.equal(f.feature.visited(), true);
  const decision = f.moderation.requestDecision(subject, 'N0');
  f.busy.set(true);
  TestBed.tick();
  return decision;
}

function assertReset(f) {
  assert.equal(f.feature.opened(), false);
  assert.equal(f.feature.visited(), false);
  assert.deepEqual(f.openedChanges, [true, false]);
}

test('a new reference to the same typed subject preserves an open moderation feature', (t) => {
  const f = fixture(t);
  f.feature.open(false);
  f.subject.set({ ...firstSubject });
  TestBed.tick();
  assert.equal(f.feature.opened(), true);
  assert.equal(f.feature.visited(), true);
  assert.deepEqual(f.openedChanges, [true]);
});

for (const subject of [secondSubject, { type: 'media', id: firstSubject.id }]) {
  test(`switching to ${subject.type}:${subject.id} without navigation cancels the old feature's decision`, async (t) => {
    const f = fixture(t);
    const decision = beginDecision(f);
    f.subject.set(subject);
    TestBed.tick();
    assertReset(f);
    assert.equal(f.moderation.pending(), null);
    assert.equal(await decision, null);
  });
}

test('a replacement session resets the feature and cancels its unfinished decision', async (t) => {
  const f = fixture(t);
  const decision = beginDecision(f);
  f.admin.sessionGeneration.update((generation) => generation + 1);
  TestBed.tick();
  assertReset(f);
  assert.equal(f.moderation.pending(), null);
  assert.equal(await decision, null);
});

test('losing review rights closes the feature and cancels its unfinished decision', async (t) => {
  const f = fixture(t);
  const decision = beginDecision(f);
  f.admin.identity.set({ role: 'reader' });
  TestBed.tick();
  assert.equal(f.feature.canReview(), false);
  assertReset(f);
  assert.equal(f.moderation.pending(), null);
  assert.equal(await decision, null);
  f.busy.set(false);
  f.feature.open(false);
  assert.equal(f.feature.opened(), false);
});

for (const [description, subject, busy] of [
  ['another subject', secondSubject, true],
  ['the same subject from an idle feature', firstSubject, false]
]) {
  test(`resetting a feature leaves a pending decision for ${description} untouched`, async (t) => {
    const f = fixture(t);
    f.feature.open(false);
    const decision = f.moderation.requestDecision(subject, 'N0');
    const pending = f.moderation.pending();
    f.busy.set(busy);
    f.admin.sessionGeneration.update((generation) => generation + 1);
    TestBed.tick();
    assertReset(f);
    assert.equal(f.moderation.pending(), pending);
    f.moderation.answer(null);
    assert.equal(await decision, null);
  });
}

test('destroying a feature cancels its own unfinished decision', async (t) => {
  const f = fixture(t);
  const decision = beginDecision(f);
  TestBed.resetTestingModule();
  assert.equal(f.moderation.pending(), null);
  assert.equal(await decision, null);
});

test('destroying a feature preserves a pending decision for another subject', async (t) => {
  const f = fixture(t);
  const decision = beginDecision(f, secondSubject);
  const pending = f.moderation.pending();
  TestBed.resetTestingModule();
  assert.equal(f.moderation.pending(), pending);
  f.moderation.answer(null);
  assert.equal(await decision, null);
});
