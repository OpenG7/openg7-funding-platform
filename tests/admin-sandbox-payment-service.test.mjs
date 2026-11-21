import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { platformServer, ServerModule } from '@angular/platform-server';
import { Router } from '@angular/router';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const { createSponsorshipOfferSnapshot } =
  await import('../dist/packages/funding-core/src/index.js');
const { AdminSandboxService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-sandbox.service.js');
const { AdminGuidanceService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-guidance.service.js');
const { FundingAdminService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js');
const { FundingI18nService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-i18n.service.js');
const { FundingService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding.service.js');
workspaceHook.deregister();

before(() =>
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  )
);
after(() => TestBed.resetTestEnvironment());

test('sandbox sponsorship defaults and removed presets quote the displayed 5 CAD amount, while choosing 10 CAD revokes acceptance', async (t) => {
  const quotedAmounts = [];
  TestBed.configureTestingModule({
    providers: [
      {
        provide: FundingService,
        useValue: {
          getSponsorshipOffer: async (amountMinor, currency) => {
            quotedAmounts.push({ amountMinor, currency });
            const snapshot = createSponsorshipOfferSnapshot(
              amountMinor,
              currency
            );
            return {
              ...snapshot,
              fingerprint: createHash('sha256')
                .update(JSON.stringify(snapshot))
                .digest('hex')
            };
          },
          getSponsorshipCharter: async () => ({ active: false })
        }
      },
      {
        provide: FundingAdminService,
        useValue: { identity: signal(null), sessionGeneration: signal(0) }
      },
      { provide: AdminGuidanceService, useValue: {} },
      { provide: FundingI18nService, useValue: {} },
      { provide: Router, useValue: {} }
    ]
  });
  t.after(() => TestBed.resetTestingModule());
  const sandbox = TestBed.inject(AdminSandboxService);
  sandbox.available.set(true);

  await sandbox.choose('sponsorship_interest');
  assert.deepEqual(sandbox.amounts(), [5, 10, 15]);
  assert.equal(sandbox.amount(), 5);
  assert.equal(sandbox.offer().amountMinor, 500);
  assert.deepEqual(
    sandbox.offer().benefits.map((benefit) => benefit.id),
    ['website_mention', 'facebook_batch', 'linkedin_batch']
  );
  assert.equal(sandbox.canCreate(), false);
  sandbox.accepted.set(true);
  assert.equal(sandbox.canCreate(), true);

  await sandbox.choose('sponsorship_interest', 10);
  assert.equal(sandbox.amount(), 10);
  assert.equal(sandbox.offer().amountMinor, 1000);
  assert.equal(sandbox.offer().benefits.length, 4);
  assert.equal(sandbox.accepted(), false);
  assert.equal(sandbox.canCreate(), false);

  await sandbox.choose('sponsorship_interest', 500);
  assert.equal(sandbox.amount(), 5);
  assert.equal(sandbox.offer().amountMinor, 500);
  assert.deepEqual(quotedAmounts, [
    { amountMinor: 500, currency: 'CAD' },
    { amountMinor: 1000, currency: 'CAD' },
    { amountMinor: 500, currency: 'CAD' }
  ]);
});
