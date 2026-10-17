import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { platformServer, ServerModule } from '@angular/platform-server';
import { Router } from '@angular/router';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';

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
const { FundingModerationPanelComponent } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-moderation/funding-moderation-panel.component.js');
const { FundingAdminService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js');
const { FundingModerationService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-moderation.service.js');
const { FundingI18nService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-i18n.service.js');
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

function fixture(t) {
  let reject;
  const response = new Promise((_resolve, no) => {
    reject = no;
  });
  const request = {
    subject: { type: 'sponsorship', id: 'synthetic-sponsor' },
    level: 'N0'
  };
  const state = { token: 'synthetic-session-original', clears: 0, reads: 0 };
  const admin = {
    sessionGeneration: signal(0),
    identity: signal({
      sessionId: 'synthetic-session-original',
      role: 'operator'
    }),
    getSavedAdminToken: () => state.token,
    clearAdminSession: () => {
      state.clears++;
      state.token = '';
      admin.identity.set(null);
      admin.sessionGeneration.update((value) => value + 1);
    },
    moderationContent: () => {
      state.reads++;
      return response;
    }
  };
  const moderation = {
    pending: signal(request),
    answer: () => moderation.pending.set(null)
  };
  const navigations = [];
  TestBed.configureTestingModule({
    providers: [
      { provide: FundingAdminService, useValue: admin },
      { provide: FundingModerationService, useValue: moderation },
      { provide: FundingI18nService, useValue: {} },
      {
        provide: Router,
        useValue: {
          url: '/admin/fundraiser/sponsors',
          navigate: (...args) => {
            navigations.push(args);
            return Promise.resolve(true);
          }
        }
      }
    ]
  });
  const panel = TestBed.runInInjectionContext(
    () => new FundingModerationPanelComponent()
  );
  TestBed.tick();
  assert.equal(state.reads, 1);
  t.after(() => TestBed.resetTestingModule());
  return { admin, moderation, panel, state, navigations, reject };
}

async function unauthorized(f) {
  f.reject(new AdminDashboardRequestError(401));
  await Promise.resolve();
  TestBed.tick();
}

test('a current moderation content refusal clears the session and returns to sign-in', async (t) => {
  const f = fixture(t);
  await unauthorized(f);
  assert.equal(f.state.clears, 1);
  assert.equal(f.moderation.pending(), null);
  assert.equal(f.panel.content(), null);
  assert.deepEqual(f.navigations, [
    [
      ['/admin/login'],
      {
        queryParams: {
          returnUrl: '/admin/fundraiser/sponsors',
          sessionExpired: '1'
        }
      }
    ]
  ]);
});

test('a concurrent private read clearing the session cannot swallow moderation reauthentication', async (t) => {
  const f = fixture(t);
  f.state.token = '';
  f.admin.identity.set(null);
  f.admin.sessionGeneration.update((value) => value + 1);
  TestBed.tick();
  assert.equal(f.moderation.pending(), null);
  await unauthorized(f);
  assert.equal(f.navigations.length, 1);
  assert.equal(f.state.clears, 1);
  assert.equal(f.panel.content(), null);
});

test('a late refusal from a replaced session never clears or redirects the new session', async (t) => {
  const f = fixture(t);
  f.state.token = 'synthetic-session-new';
  f.admin.identity.set({
    sessionId: 'synthetic-session-new',
    role: 'operator'
  });
  f.admin.sessionGeneration.update((value) => value + 1);
  TestBed.tick();
  await unauthorized(f);
  assert.equal(f.state.token, 'synthetic-session-new');
  assert.equal(f.state.clears, 0);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.panel.content(), null);
});
