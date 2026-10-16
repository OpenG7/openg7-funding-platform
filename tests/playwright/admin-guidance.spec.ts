import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminDashboardResponse,
  AdminContributionsResponse,
  AdminPaymentJourney,
  AdminPaymentJourneyResponse,
  AdminWorkQueueResponse,
  PilotState
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';

const storagePrefix = 'og7-admin-guidance:v1:';
const highlighted = '[data-og7-guidance-highlight]';
const dashboardPath = '/admin/fundraiser';
const attentionPath = dashboardPath + '/attention';
const generatedAt = '2026-10-14T12:00:00Z';
const paymentId = '10000000-0000-4000-8000-000000000701';
const otherPaymentId = '10000000-0000-4000-8000-000000000702';
const paymentJourney = (id = paymentId): AdminPaymentJourney => ({
  contributionId: id,
  reference: id === paymentId ? 'DEMO-PAYMENT-701' : 'DEMO-PAYMENT-702',
  contributionType: 'personal_support',
  amountMinor: 2500,
  currency: 'CAD',
  paymentStatus: 'paid',
  state: 'complete',
  completed: 1,
  total: 1,
  steps: [
    {
      id: 'payment',
      state: 'complete',
      reason: 'payment_recorded',
      adminUrl: `${dashboardPath}/contributions?contributionId=${id}`
    }
  ],
  next: null
});

const dashboard: AdminDashboardResponse = {
  data_source: 'database',
  data_available: true,
  totals: {
    total_received: 0,
    total_refunded: 0,
    total_disputed: 0,
    current_available_estimate: 0,
    currency: 'CAD',
    contributions_count: 0,
    paid_contributions_count: 0
  },
  sponsorship_review: { total: 0, pending: 0, approved: 0, rejected: 0 },
  feed_publication: { planned: 0, drafted: 0, published: 0, active: 0 },
  stripe_events: { failed: 0, processing: 0, last_failed_at: null },
  recent_contributions: [],
  last_updated_at: generatedAt
};
const attention: AdminWorkQueueResponse = {
  available: true,
  coverage: 'complete',
  missingSources: [],
  generatedAt,
  timezone: 'America/Toronto',
  total: 0,
  filteredTotal: 0,
  todayTotal: 0,
  counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
  typeCounts: {
    sponsorship_needs_info: 0,
    sponsorship_needs_review: 0,
    sponsorship_needs_commitment: 0,
    sponsorship_needs_fulfilment: 0,
    sponsorship_refund_followup: 0,
    sponsorship_credit_missing: 0,
    sponsorship_timing_review: 0,
    publication_reliability_incident: 0,
    publication_needs_preparation: 0,
    publication_late: 0,
    email_delivery_failed: 0,
    invoice_missing: 0,
    stripe_event_failed: 0,
    stripe_event_stalled: 0,
    publication_ready: 0,
    publication_slot_upcoming: 0,
    financial_data_warning: 0
  },
  page: 1,
  pageSize: 25,
  items: []
};
const pilotage: PilotState = {
  generatedAt,
  coverage: 'complete',
  missingSources: [],
  total: 0,
  page: 1,
  pageSize: 30,
  domains: {
    publications: 0,
    sponsors: 0,
    email: 0,
    invoices: 0,
    contributions: 0,
    projects: 0,
    operations: 0
  },
  feeds: [],
  workerEnabled: false,
  writable: true,
  decisions: []
};

/** Built UI only: signed-in identities and synthetic GET snapshots, no API/DB. */
async function fixtures(page: Page, language = 'fr-CA') {
  const state = {
    accountId: 'guidance-owner-a',
    signedIn: true,
    pilotage: structuredClone(pilotage),
    paymentStatus: 200,
    paymentState: 'ok' as AdminPaymentJourneyResponse['status'],
    journeys: new Map([
      [paymentId, paymentJourney()],
      [otherPaymentId, paymentJourney(otherPaymentId)]
    ]),
    paymentRequests: [] as string[],
    paymentGate: null as Promise<void> | null,
    mutations: [] as { method: string; pathname: string }[]
  };
  await page.addInitScript((locale) => {
    localStorage.setItem('openg7.language', locale);
  }, language);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      state.mutations.push({ method: request.method(), pathname });
      return route.fulfill({
        status: 405,
        json: { error: 'Read-only fixture' }
      });
    }
    if (pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (pathname === '/api/admin/auth/current')
      return route.fulfill({
        status: state.signedIn ? 200 : 401,
        json: state.signedIn
          ? {
              id: state.accountId,
              sessionId: 'guidance-fixture-session',
              displayName: 'Compte synthétique',
              role: 'owner',
              expiresAt: '2099-01-01T00:00:00Z'
            }
          : {}
      });
    if (pathname === '/api/admin/dashboard')
      return route.fulfill({ json: dashboard });
    if (pathname === '/api/admin/attention')
      return route.fulfill({ json: attention });
    if (pathname === '/api/admin/pilotage')
      return route.fulfill({ json: state.pilotage });
    if (pathname === '/api/admin/payment-journey') {
      const id =
        new URL(request.url()).searchParams.get('contributionId') ?? '';
      state.paymentRequests.push(id);
      const response = {
        status: state.paymentStatus,
        json: {
          status: state.paymentState,
          generatedAt,
          journey:
            state.paymentState === 'ok'
              ? (state.journeys.get(id) ?? null)
              : null
        }
      };
      const gate = state.paymentGate;
      if (gate) await gate;
      return route.fulfill(response);
    }
    const cockpitBlock = pathname.match(
      /^\/api\/admin\/cockpit\/(metrics|activity|systems)$/
    )?.[1];
    if (cockpitBlock)
      return route.fulfill({
        json: cockpitFixtures()[
          cockpitBlock as 'metrics' | 'activity' | 'systems'
        ]
      });
    if (pathname === '/api/admin/assistant/summary')
      return route.fulfill({
        json: {
          generatedAt,
          counts: { urgent: 0, today: 0, thisWeek: 0, informational: 0 },
          sponsorships: { needsInfo: 0, needsReview: 0, approved: 0 },
          publications: { needsPreparation: 0, scheduled: 0, late: 0 },
          emails: { failed: 0 },
          attentionItems: []
        }
      });
    return route.fulfill({
      status: 503,
      json: { error: 'Unavailable in the guidance UI fixture' }
    });
  });
  return state;
}

function hook(page: Page, name: string) {
  return page.locator(`[data-og7="admin-guidance-${name}"]`);
}

function paymentHook(page: Page, name: string) {
  return page.locator(`[data-og7="payment-journey-${name}"]`);
}

test('a payment journey resumes from server facts and persists only its identifier and pause cue', async ({
  page
}, info) => {
  const fixture = await fixtures(page);
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await expect(paymentHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'ready'
  );
  await expect(page.locator('[data-og7="payment-journey"]')).toContainText(
    'DEMO-PAYMENT-701'
  );
  await expect(paymentHook(page, 'complete')).toBeVisible();
  await expect(paymentHook(page, 'next')).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('payment-journey-desktop.png')
  });
  await paymentHook(page, 'pause').click();
  await page.goto(attentionPath);
  await page.reload();
  const retained = await stored(page);
  expect(retained.mode).toBe('payment');
  expect(retained.payment).toEqual({ contributionId: paymentId, paused: true });
  expect(JSON.stringify(retained)).not.toContain('DEMO-PAYMENT');
  expect(JSON.stringify(retained)).not.toContain('complete');
  expect(JSON.stringify(retained)).not.toContain('2500');

  const current = paymentJourney();
  fixture.journeys.set(paymentId, {
    ...current,
    state: 'action_required',
    completed: 0,
    steps: [{ ...current.steps[0]!, state: 'error', reason: 'stripe_failed' }],
    next: {
      reason: 'stripe_failed',
      adminUrl: `${dashboardPath}/stripe-events?contributionId=${paymentId}`,
      target: 'stripe-event-list'
    }
  });
  await paymentHook(page, 'resume').click();
  await expect(paymentHook(page, 'complete')).toHaveCount(0);
  await expect(paymentHook(page, 'next')).toHaveAttribute(
    'href',
    `${dashboardPath}/stripe-events?contributionId=${paymentId}`
  );
  await expect(
    paymentHook(page, 'milestones').locator('[data-og7-id="payment"]')
  ).toHaveAttribute('data-state', 'error');
  expect(
    fixture.paymentRequests.filter((id) => id === paymentId).length
  ).toBeGreaterThanOrEqual(2);
  expect(fixture.mutations).toEqual([]);
});

test('opening another dossier preserves the followed payment until explicitly selected', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await expect(paymentHook(page, 'complete')).toBeVisible();
  await page.goto(`${attentionPath}?contributionId=${otherPaymentId}`);
  await expect(page.locator('[data-og7="payment-journey"]')).toContainText(
    'DEMO-PAYMENT-701'
  );
  expect((await stored(page)).payment.contributionId).toBe(paymentId);
  await paymentHook(page, 'current').click();
  await expect(page.locator('[data-og7="payment-journey"]')).toContainText(
    'DEMO-PAYMENT-702'
  );
  expect((await stored(page)).payment.contributionId).toBe(otherPaymentId);
  expect(fixture.mutations).toEqual([]);
});

test('sponsor context follows sponsorshipId when a stale contributionId remains in the URL', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(
    `${dashboardPath}/sponsors?paymentJourney=${paymentId}&contributionId=${paymentId}&sponsorshipId=${otherPaymentId}`
  );
  await expect(paymentHook(page, 'complete')).toBeVisible();
  await paymentHook(page, 'current').click();
  await expect(page.locator('[data-og7="payment-journey"]')).toContainText(
    'DEMO-PAYMENT-702'
  );
  expect((await stored(page)).payment.contributionId).toBe(otherPaymentId);
  expect(fixture.mutations).toEqual([]);
});

test('ambiguous payment context on Attention does not offer to replace the followed payment', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(
    `${attentionPath}?paymentJourney=${otherPaymentId}&contributionId=${paymentId}&sponsorshipId=${otherPaymentId}`
  );
  await expect(paymentHook(page, 'complete')).toBeVisible();
  await expect(paymentHook(page, 'current')).toHaveCount(0);
  expect((await stored(page)).payment.contributionId).toBe(otherPaymentId);
  expect(fixture.mutations).toEqual([]);
});

test('the contribution entry reopens its payment journey after collapse on the same URL', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const contributions: AdminContributionsResponse = {
    data_source: 'database',
    last_updated_at: generatedAt,
    summary: {
      total_count: 1,
      paid_count: 1,
      pending_count: 0,
      sponsorship_count: 0,
      public_display_count: 0,
      total_received: 25,
      total_refunded: 0,
      total_disputed: 0,
      currency: 'CAD'
    },
    contributions: [
      {
        id: paymentId,
        public_reference: 'DEMO-PAYMENT-701',
        contribution_type: 'personal_support',
        amount: 25,
        currency: 'CAD',
        payment_status: 'paid',
        paid_at: generatedAt,
        public_name: 'Personne synthétique',
        email_private: null,
        public_display_consent: false,
        display_amount_consent: false,
        non_charity_acknowledged: true,
        sponsor_company_name: null,
        sponsor_contact_name: null,
        sponsor_contact_email: null,
        sponsor_review_status: null,
        sponsor_feed_status: null,
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        created_at: generatedAt,
        updated_at: generatedAt
      }
    ]
  };
  await page.route(
    (url) => url.pathname === '/api/admin/contributions',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: contributions });
    }
  );
  await page.goto(`${dashboardPath}/contributions?contributionId=${paymentId}`);
  const entry = page.locator('[data-og7="contribution-journey"]');
  await entry.click();
  await expect(paymentHook(page, 'complete')).toBeVisible();
  const currentUrl = page.url();
  await hook(page, 'toggle').click();
  await expect(hook(page, 'panel')).toHaveCount(0);
  await entry.click();
  await expect(paymentHook(page, 'complete')).toBeVisible();
  expect(page.url()).toBe(currentUrl);
  expect((await stored(page)).payment.contributionId).toBe(paymentId);
  expect(fixture.mutations).toEqual([]);
});

for (const failure of [
  'unavailable',
  'not_found',
  'forbidden',
  'error'
] as const) {
  test(`payment journey removes stale completion after ${failure} and can refresh safely`, async ({
    page
  }) => {
    const fixture = await fixtures(page);
    await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
    await expect(paymentHook(page, 'complete')).toBeVisible();
    fixture.paymentStatus =
      failure === 'forbidden' ? 403 : failure === 'error' ? 503 : 200;
    fixture.paymentState =
      failure === 'unavailable' || failure === 'not_found' ? failure : 'ok';
    await paymentHook(page, 'refresh').click();
    await expect(paymentHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      failure
    );
    await expect(paymentHook(page, 'complete')).toHaveCount(0);
    await expect(paymentHook(page, 'milestones')).toHaveCount(0);
    await expect(paymentHook(page, 'next')).toHaveCount(0);
    fixture.paymentStatus = 200;
    fixture.paymentState = 'ok';
    await paymentHook(page, 'refresh').click();
    await expect(paymentHook(page, 'complete')).toBeVisible();
    expect(fixture.mutations).toEqual([]);
  });
}

test('refresh clears old payment facts while loading and a late response cannot replace the selected payment', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(
    `${dashboardPath}?paymentJourney=${paymentId}&contributionId=${otherPaymentId}`
  );
  await expect(paymentHook(page, 'complete')).toBeVisible();
  let release!: () => void;
  fixture.paymentGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await paymentHook(page, 'refresh').click();
  await expect(paymentHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'loading'
  );
  await expect(paymentHook(page, 'complete')).toHaveCount(0);
  await expect(paymentHook(page, 'next')).toHaveCount(0);
  fixture.paymentGate = null;
  await paymentHook(page, 'current').click();
  await expect(page.locator('[data-og7="payment-journey"]')).toContainText(
    'DEMO-PAYMENT-702'
  );
  release();
  await expect(paymentHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'ready'
  );
  await expect(page.locator('[data-og7="payment-journey"]')).not.toContainText(
    'DEMO-PAYMENT-701'
  );
  expect((await stored(page)).payment.contributionId).toBe(otherPaymentId);
  expect(fixture.mutations).toEqual([]);
});

test('an invalid payment identifier is ignored and following payments stays optional', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(`${dashboardPath}?paymentJourney=private@example.test`);
  await hook(page, 'toggle').click();
  await hook(page, 'payment-mode').click();
  await expect(paymentHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'idle'
  );
  expect(fixture.paymentRequests).toEqual([]);
  expect(fixture.mutations).toEqual([]);
});

test('opening the next action rechecks server facts and does not follow a stale recommendation', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const current = paymentJourney();
  fixture.journeys.set(paymentId, {
    ...current,
    state: 'action_required',
    completed: 0,
    steps: [{ ...current.steps[0]!, state: 'error', reason: 'stripe_failed' }],
    next: {
      reason: 'stripe_failed',
      adminUrl: `${dashboardPath}/stripe-events?contributionId=${paymentId}`
    }
  });
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await expect(paymentHook(page, 'next')).toBeVisible();
  fixture.journeys.set(paymentId, current);
  await paymentHook(page, 'next').click();
  await expect(paymentHook(page, 'complete')).toBeVisible();
  await expect(paymentHook(page, 'changed')).toBeVisible();
  await expect(page).toHaveURL(`${dashboardPath}?paymentJourney=${paymentId}`);
  expect(
    fixture.paymentRequests.filter((id) => id === paymentId).length
  ).toBeGreaterThanOrEqual(2);
  expect(fixture.mutations).toEqual([]);
});

test('a payment bookmark belongs to its signed-in account and revoked sessions clear the visible journey', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await expect(paymentHook(page, 'complete')).toBeVisible();
  fixture.accountId = 'guidance-owner-b';
  await page.goto(attentionPath);
  await expect(hook(page, 'toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(await stored(page, fixture.accountId)).toBeNull();
  await hook(page, 'toggle').click();
  await hook(page, 'payment-mode').click();
  await expect(paymentHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'idle'
  );
  fixture.signedIn = false;
  await page.goto(attentionPath);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.locator('[data-og7="payment-journey"]')).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('showing a payment action is available only on its exact page and dossier', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const current = paymentJourney();
  fixture.journeys.set(paymentId, {
    ...current,
    state: 'action_required',
    completed: 0,
    steps: [{ ...current.steps[0]!, state: 'pending' }],
    next: {
      reason: 'stripe_failed',
      adminUrl: `${dashboardPath}?contributionId=${paymentId}`,
      target: 'cockpit-metrics'
    }
  });
  await page.goto(
    `${attentionPath}?paymentJourney=${paymentId}&contributionId=${paymentId}`
  );
  await expect(paymentHook(page, 'next')).toBeVisible();
  await expect(paymentHook(page, 'show')).toHaveCount(0);
  await page.goto(`${dashboardPath}?contributionId=${otherPaymentId}`);
  await expect(paymentHook(page, 'next')).toBeVisible();
  await expect(paymentHook(page, 'show')).toHaveCount(0);
  await page.goto(`${dashboardPath}?contributionId=${paymentId}`);
  await paymentHook(page, 'show').click();
  await expectGoldenZone(page.locator('[data-og7="cockpit-metrics"]'));
  expect(fixture.mutations).toEqual([]);
});

test('a missing payment action zone is explained without highlighting unrelated page content', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const current = paymentJourney();
  fixture.journeys.set(paymentId, {
    ...current,
    state: 'action_required',
    completed: 0,
    steps: [{ ...current.steps[0]!, state: 'pending' }],
    next: {
      reason: 'stripe_failed',
      adminUrl: `${dashboardPath}?contributionId=${paymentId}`,
      target: 'missing-payment-landmark'
    }
  });
  await page.goto(
    `${dashboardPath}?paymentJourney=${paymentId}&contributionId=${paymentId}`
  );
  await paymentHook(page, 'show').click();
  await expect(hook(page, 'panel')).toContainText(
    'Ce repère n’est pas visible pour le moment.'
  );
  await expect(page.locator(highlighted)).toHaveCount(0);
  await expect(paymentHook(page, 'complete')).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('English mobile payment guidance remains keyboard accessible without horizontal overflow', async ({
  page
}, info) => {
  const fixture = await fixtures(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await expect(paymentHook(page, 'complete')).toBeVisible();
  await paymentHook(page, 'refresh').focus();
  await page.keyboard.press('Enter');
  await expect(paymentHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'ready'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('payment-journey-mobile.png')
  });
  expect(fixture.mutations).toEqual([]);
});

async function expectStep(page: Page, id: 'read' | 'choose' | 'verify') {
  await expect(hook(page, 'step')).toHaveAttribute('data-og7-id', id);
}

async function expectGoldenZone(zone: Locator) {
  await expect(zone).toHaveAttribute('data-og7-guidance-highlight', '');
  await expect
    .poll(() => zone.evaluate(readGuidanceDecoration))
    .toMatchObject({ outlined: true, golden: true, halo: true });
}

function readGuidanceDecoration(element: Element) {
  const style = getComputedStyle(element);
  const canvas = element.ownerDocument.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot inspect the guidance outline colour');
  // CSSOM may serialize colours as rgb() or normalized color(srgb ...).
  // Let the browser convert the actual computed colour to 8-bit sRGB first.
  context.fillStyle = style.outlineColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return {
    outlineColor: style.outlineColor,
    outlineRgba: [red, green, blue, alpha],
    outlined:
      style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
    golden:
      alpha === 255 &&
      red >= 170 &&
      green >= 110 &&
      red > green &&
      green > blue,
    halo: style.boxShadow !== 'none'
  };
}

test('the golden halo assertion handles CSS colour formats and rejects other colours', async ({
  page
}) => {
  await page.setContent(`
    <div data-og7-guidance-highlight style="outline: 3px solid;
      box-shadow: 0 0 6px #f4c957">Landmark</div>
  `);
  const zone = page.locator(highlighted);
  for (const colour of [
    'rgb(244, 201, 87)',
    'color(srgb 0.9568627451 0.7882352941 0.3411764706)'
  ]) {
    await zone.evaluate((element, value) => {
      (element as HTMLElement).style.outlineColor = value;
    }, colour);
    await expectGoldenZone(zone);
    expect((await zone.evaluate(readGuidanceDecoration)).outlineRgba).toEqual([
      244, 201, 87, 255
    ]);
  }
  for (const colour of [
    'color(srgb 0 0 1)',
    'color(srgb 0 1 1)',
    'color(srgb 0.8 0.8 0.8)',
    'rgb(244 201 87 / 0)'
  ]) {
    await zone.evaluate((element, value) => {
      (element as HTMLElement).style.outlineColor = value;
    }, colour);
    expect(await zone.evaluate(readGuidanceDecoration)).toMatchObject({
      outlined: true,
      golden: false,
      halo: true
    });
  }
});

async function stored(page: Page, accountId = 'guidance-owner-a') {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storagePrefix + accountId);
}

async function navigate(page: Page, path: string) {
  await page
    .locator('openg7-admin-nav')
    .getByRole('navigation')
    .locator(`a[href="${path}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
}

async function forget(page: Page) {
  await hook(page, 'panel').locator('summary').click();
  await hook(page, 'forget').click();
}

async function expectShownLandmarkUncovered(page: Page) {
  // The guide may move and finish aligning a nested scrollport on the next frame.
  await expect(async () => {
    const placement = await page.evaluate(() => {
      const guide = document.querySelector('[data-og7="admin-guidance"]');
      const target = document.activeElement;
      if (!guide || !(target instanceof HTMLElement)) return null;
      const card = guide.getBoundingClientRect();
      const landmark = target.getBoundingClientRect();
      const x = landmark.left + landmark.width / 2;
      const y = landmark.top + Math.min(landmark.height / 2, 12);
      const foreground = document.elementFromPoint(x, y);
      return {
        inMain: document.getElementById('admin-main')?.contains(target),
        cardTop: card.top,
        cardBottom: card.bottom,
        pointX: x,
        pointY: y,
        pointOutsideCard:
          x < card.left || x > card.right || y < card.top || y > card.bottom,
        unobscured: foreground !== null && target.contains(foreground),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight
      };
    });
    expect(placement).not.toBeNull();
    expect(placement!.inMain).toBe(true);
    expect(placement!.cardTop).toBeGreaterThanOrEqual(-1);
    expect(placement!.cardBottom).toBeLessThanOrEqual(
      placement!.viewportHeight + 1
    );
    expect(placement!.pointX).toBeGreaterThanOrEqual(0);
    expect(placement!.pointX).toBeLessThan(placement!.viewportWidth);
    expect(placement!.pointY).toBeGreaterThanOrEqual(0);
    expect(placement!.pointY).toBeLessThan(placement!.viewportHeight);
    expect(placement!.pointOutsideCard).toBe(true);
    expect(placement!.unobscured).toBe(true);
  }).toPass({ timeout: 7000 });
  await expect(hook(page, 'toggle')).toBeInViewport({ ratio: 1 });
}

test('guidance is opt-in, keyboard-operable and only focuses landmarks', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  const toggle = hook(page, 'toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(hook(page, 'panel')).toHaveCount(0);
  await expect(page.locator('h1')).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(hook(page, 'panel')).toBeVisible();
  await expectStep(page, 'read');
  await hook(page, 'next').focus();
  await page.keyboard.press('Enter');
  await expectStep(page, 'choose');
  await hook(page, 'previous').focus();
  await page.keyboard.press('Enter');
  await expectStep(page, 'read');
  await hook(page, 'show').focus();
  await page.keyboard.press('Enter');
  await expectShownLandmarkUncovered(page);
  await expect(hook(page, 'step')).toBeInViewport({ ratio: 1 });
  await expect(hook(page, 'next')).toBeInViewport({ ratio: 1 });
  await hook(page, 'next').focus();
  await page.keyboard.press('Enter');
  await expectStep(page, 'choose');
  await hook(page, 'next').focus();
  await page.keyboard.press('Enter');
  await expectStep(page, 'verify');
  await expect(hook(page, 'step')).toBeFocused();
  await hook(page, 'restart').focus();
  await page.keyboard.press('Enter');
  await expectStep(page, 'read');
  await expect(hook(page, 'step')).toBeFocused();
  expect(await stored(page)).toEqual({
    enabled: true,
    bookmark: { pageId: 'dashboard', step: 0, paused: false }
  });
  expect(fixture.mutations).toEqual([]);
});

test('pause survives navigation and reload and resumes a safe page without dossier parameters', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(
    attentionPath + '?itemId=private-dossier&email=private@example.test#private'
  );
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  await expectStep(page, 'choose');
  await hook(page, 'pause').click();
  await expect(hook(page, 'paused')).toBeVisible();
  await navigate(page, dashboardPath);
  await expect(hook(page, 'paused')).toBeVisible();
  await page.reload();
  await expect(hook(page, 'paused')).toBeVisible();
  expect(await stored(page)).toEqual({
    enabled: true,
    bookmark: { pageId: 'attention', step: 1, paused: true }
  });
  await hook(page, 'resume').click();
  await expect(page).toHaveURL(attentionPath);
  await expectStep(page, 'choose');
  await expect(hook(page, 'paused')).toHaveCount(0);
  expect(await stored(page)).toEqual({
    enabled: true,
    bookmark: { pageId: 'attention', step: 1, paused: false }
  });
  expect(fixture.mutations).toEqual([]);
});

test('resume here replaces only the local bookmark and forgetting resets the aid', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(attentionPath);
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  await hook(page, 'pause').click();
  await navigate(page, dashboardPath);
  await hook(page, 'resume-here').click();
  await expect(page).toHaveURL(dashboardPath);
  await expectStep(page, 'read');
  expect(await stored(page)).toEqual({
    enabled: true,
    bookmark: { pageId: 'dashboard', step: 0, paused: false }
  });
  await hook(page, 'next').click();
  await hook(page, 'next').click();
  await hook(page, 'restart').click();
  await expectStep(page, 'read');
  await forget(page);
  await expect(hook(page, 'panel')).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  await expect(hook(page, 'toggle')).toBeFocused();
  expect(fixture.mutations).toEqual([]);
});

test('hiding the aid preserves its bookmark but keeps it off after reload', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  await hook(page, 'toggle').click();
  await expect(hook(page, 'panel')).toHaveCount(0);
  await page.reload();
  await expect(hook(page, 'panel')).toHaveCount(0);
  expect(await stored(page)).toEqual({
    enabled: false,
    bookmark: { pageId: 'dashboard', step: 1, paused: false }
  });
  await hook(page, 'toggle').click();
  await expectStep(page, 'choose');
});

test('different signed-in accounts never inherit one another’s guidance', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  await hook(page, 'pause').click();
  const firstBookmark = await stored(page);
  fixture.accountId = 'guidance-owner-b';
  await page.reload();
  await expect(hook(page, 'toggle')).toBeVisible();
  await expect(hook(page, 'panel')).toHaveCount(0);
  await hook(page, 'toggle').click();
  await expectStep(page, 'read');
  expect(await stored(page, 'guidance-owner-b')).toEqual({
    enabled: true,
    bookmark: { pageId: 'dashboard', step: 0, paused: false }
  });
  expect(await stored(page)).toEqual(firstBookmark);
  fixture.accountId = 'guidance-owner-a';
  await page.reload();
  await expect(hook(page, 'paused')).toBeVisible();
  await hook(page, 'resume').click();
  await expectStep(page, 'choose');
  expect(fixture.mutations).toEqual([]);
});

test('blocked browser persistence keeps a visible warning and a bookmark during in-app navigation', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.addInitScript((prefix) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith(prefix))
        throw new DOMException('Blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith(prefix))
        throw new DOMException('Blocked', 'SecurityError');
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string) {
      if (key.startsWith(prefix))
        throw new DOMException('Blocked', 'SecurityError');
      return remove.call(this, key);
    };
  }, storagePrefix);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await expect(hook(page, 'storage-warning')).toBeVisible();
  await hook(page, 'next').click();
  await hook(page, 'pause').click();
  await navigate(page, attentionPath);
  await expect(hook(page, 'paused')).toBeVisible();
  await expect(hook(page, 'storage-warning')).toBeVisible();
  await hook(page, 'resume').click();
  await expect(page).toHaveURL(dashboardPath);
  await expectStep(page, 'choose');
  await forget(page);
  await expect(hook(page, 'panel')).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('a missing landmark falls back to the main content without losing the step', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath + '/pilotage');
  await hook(page, 'toggle').click();
  await expectStep(page, 'read');
  // With no decision selected, the dossier summary is deliberately absent.
  await expect(page.locator('[data-og7="pilot-summary"]')).toHaveCount(0);
  await hook(page, 'show').click();
  await expect(page.locator(highlighted)).toHaveCount(1);
  await expectGoldenZone(page.locator('h1'));
  expect(
    await page.evaluate(() =>
      document.getElementById('admin-main')?.contains(document.activeElement)
    )
  ).toBe(true);
  await expect(hook(page, 'panel').getByRole('status')).toBeVisible();
  await expectStep(page, 'read');
  await hook(page, 'next').click();
  await expectStep(page, 'choose');
  await expect(page.locator(highlighted)).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('failed erasure is disclosed while the local aid stays hidden for the visit', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  const retained = await stored(page);
  await page.evaluate((prefix) => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key.startsWith(prefix))
        throw new DOMException('Blocked', 'SecurityError');
      return remove.call(this, key);
    };
  }, storagePrefix);
  await forget(page);
  await expect(hook(page, 'panel')).toHaveCount(0);
  await expect(
    page.locator('[data-og7="admin-guidance"]').getByRole('status')
  ).toContainText('peut réapparaître au rechargement');
  await expect(hook(page, 'toggle')).toBeFocused();
  expect(await stored(page)).toEqual(retained);
  await navigate(page, attentionPath);
  await expect(hook(page, 'panel')).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('a revoked session removes guidance before another account signs in', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  await hook(page, 'pause').click();
  const retained = await stored(page);
  fixture.signedIn = false;
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.locator('[data-og7="dashboard-refresh"]').click();
  await expect(page).toHaveURL(/\/admin\/login\?/);
  await expect(hook(page, 'panel')).toHaveCount(0);
  await expect(hook(page, 'toggle')).toHaveCount(0);
  expect(await stored(page)).toEqual(retained);
  fixture.signedIn = true;
  fixture.accountId = 'guidance-owner-b';
  await page.unroute('**/api/admin/dashboard');
  await page.goto(dashboardPath);
  await expect(hook(page, 'toggle')).toBeVisible();
  await expect(hook(page, 'panel')).toHaveCount(0);
  expect(await stored(page, 'guidance-owner-b')).toBeNull();
  expect(fixture.mutations).toEqual([]);
});

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 320]
] as const) {
  test(`showing a landmark gives its whole zone a static golden halo with reduced motion in ${language} at ${width}px`, async ({
    page
  }) => {
    const fixture = await fixtures(page, language);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(dashboardPath);
    await hook(page, 'toggle').click();
    const bookmark = await stored(page);
    const metrics = page.locator('[data-og7="cockpit-metrics"]');
    await hook(page, 'show').click();
    await expectGoldenZone(metrics);
    await expectShownLandmarkUncovered(page);
    expect(
      await metrics.evaluate((element) => element.getAnimations().length)
    ).toBe(0);
    expect(await stored(page)).toEqual(bookmark);
    await page.screenshot({
      path: `test-results/admin-guidance-gold-preview-${width === 1440 ? 'desktop' : 'mobile'}.png`
    });
    await hook(page, 'next').click();
    await expect(page.locator(highlighted)).toHaveCount(0);
    await hook(page, 'show').click();
    await expectGoldenZone(page.locator('[data-og7="cockpit-systems"]'));
    await hook(page, 'pause').click();
    await expect(page.locator(highlighted)).toHaveCount(0);
    await hook(page, 'resume').click();
    await hook(page, 'show').click();
    await expect(page.locator(highlighted)).toHaveCount(1);
    await hook(page, 'toggle').click();
    await expect(page.locator(highlighted)).toHaveCount(0);
    await hook(page, 'toggle').click();
    if (width === 1440) {
      await hook(page, 'show').click();
      await expect(page.locator(highlighted)).toHaveCount(1);
      await navigate(page, attentionPath);
      await expect(page.locator(highlighted)).toHaveCount(0);
    }
    expect(fixture.mutations).toEqual([]);
  });
}

test('the golden pulse is gentle, finishes, and stops immediately for reduced motion', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await hook(page, 'show').click();
  const zone = page.locator('[data-og7="cockpit-metrics"]');
  await expectGoldenZone(zone);
  const pulse = await zone.evaluate((element) =>
    element.getAnimations().map((animation) => {
      const timing = animation.effect!.getTiming();
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      return {
        duration: Number(timing.duration),
        iterations: timing.iterations ?? 1,
        distinctShadows: new Set(frames.map((frame) => frame.boxShadow)).size,
        changesLayout: frames.some(
          (frame) => frame.transform !== undefined || frame.width !== undefined
        )
      };
    })
  );
  expect(pulse).toHaveLength(1);
  expect(pulse[0].duration).toBeGreaterThanOrEqual(1000);
  expect(pulse[0].duration).toBeLessThanOrEqual(2500);
  expect(pulse[0].iterations).toBeGreaterThanOrEqual(2);
  expect(pulse[0].iterations).toBeLessThanOrEqual(4);
  expect(pulse[0].duration * pulse[0].iterations).toBeLessThanOrEqual(8000);
  expect(pulse[0].distinctShadows).toBeGreaterThan(1);
  expect(pulse[0].changesLayout).toBe(false);
  const firstShadow = await zone.evaluate(
    (element) => getComputedStyle(element).boxShadow
  );
  await expect
    .poll(() => zone.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe(firstShadow);
  await expect
    .poll(() =>
      zone.evaluate(
        (element) =>
          element
            .getAnimations()
            .filter((animation) => animation.playState === 'running').length
      )
    )
    .toBe(0);
  await expectGoldenZone(zone);
  await hook(page, 'show').click();
  await expect
    .poll(() => zone.evaluate((element) => element.getAnimations().length))
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => zone.evaluate((element) => element.getAnimations().length))
    .toBe(0);
  await expectGoldenZone(zone);
  await hook(page, 'next').click();
  await expect(page.locator(highlighted)).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('all visible repeated zones are highlighted without selecting a dossier and their styles are restored', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const contributions: AdminContributionsResponse = {
    data_source: 'database',
    last_updated_at: generatedAt,
    summary: {
      total_count: 3,
      paid_count: 0,
      pending_count: 3,
      sponsorship_count: 0,
      public_display_count: 0,
      total_received: 0,
      total_refunded: 0,
      total_disputed: 0,
      currency: 'CAD'
    },
    contributions: [1, 2, 3].map((index) => ({
      id: `10000000-0000-4000-8000-00000000075${index}`,
      public_reference: `OG7-SYNTHETIC-GUIDANCE-${index}`,
      contribution_type: 'personal_support',
      amount: 2500,
      currency: 'CAD',
      payment_status: 'pending',
      paid_at: null,
      public_name: `Personne synthétique ${index}`,
      email_private: null,
      public_display_consent: false,
      display_amount_consent: false,
      non_charity_acknowledged: true,
      sponsor_company_name: null,
      sponsor_contact_name: null,
      sponsor_contact_email: null,
      sponsor_review_status: null,
      sponsor_feed_status: null,
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      created_at: generatedAt,
      updated_at: generatedAt
    }))
  };
  await page.route('**/api/admin/contributions', (route) =>
    route.fulfill({ json: contributions })
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(dashboardPath + '/contributions');
  const rows = page.locator('[data-og7="contribution-row"]');
  await expect(rows).toHaveCount(3);
  await rows.nth(2).evaluate((element) => {
    (element as HTMLElement).hidden = true;
  });
  const originalStyles = await rows.evaluateAll((elements) =>
    elements.map((element, index) => {
      const target = element as HTMLElement;
      target.style.setProperty(
        '--original-guidance-outline',
        '1px dashed rgb(111, 123, 135)'
      );
      target.style.setProperty(
        'outline',
        index === 1
          ? 'var(--original-guidance-outline)'
          : '1px dashed rgb(111, 123, 135)',
        'important'
      );
      target.style.setProperty(
        'box-shadow',
        'rgb(20, 30, 40) 0px 0px 2px',
        'important'
      );
      return {
        outline: target.style.getPropertyValue('outline'),
        outlinePriority: target.style.getPropertyPriority('outline'),
        shadow: target.style.getPropertyValue('box-shadow'),
        shadowPriority: target.style.getPropertyPriority('box-shadow'),
        tabindex: target.getAttribute('tabindex')
      };
    })
  );
  const detail = page.locator(
    '[aria-labelledby="selected-contribution-title"]'
  );
  await expect(detail).toHaveCount(0);
  const originalUrl = page.url();
  await hook(page, 'toggle').click();
  await hook(page, 'next').click();
  await expectStep(page, 'choose');
  await hook(page, 'show').click();
  await expect(page.locator(highlighted)).toHaveCount(2);
  await expectGoldenZone(rows.nth(0));
  await expectGoldenZone(rows.nth(1));
  await expect(rows.nth(2)).not.toHaveAttribute('data-og7-guidance-highlight');
  await expect(rows.nth(0)).toBeFocused();
  await expect(detail).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  await hook(page, 'next').click();
  await expect(page.locator(highlighted)).toHaveCount(0);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const target = element as HTMLElement;
        return {
          outline: target.style.getPropertyValue('outline'),
          outlinePriority: target.style.getPropertyPriority('outline'),
          shadow: target.style.getPropertyValue('box-shadow'),
          shadowPriority: target.style.getPropertyPriority('box-shadow'),
          tabindex: target.getAttribute('tabindex')
        };
      })
    )
  ).toEqual(originalStyles);
  expect(fixture.mutations).toEqual([]);
});

for (const [name, invalid] of [
  ['malformed JSON', '{'],
  [
    'unknown page',
    JSON.stringify({
      enabled: true,
      bookmark: { pageId: 'unknown', step: 0, paused: true }
    })
  ],
  [
    'out-of-bounds step',
    JSON.stringify({
      enabled: true,
      bookmark: { pageId: 'dashboard', step: 999, paused: false }
    })
  ]
] as const) {
  test(`invalid guidance state is discarded safely: ${name}`, async ({
    page
  }) => {
    await fixtures(page);
    await page.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, value);
      },
      { key: storagePrefix + 'guidance-owner-a', value: invalid }
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(dashboardPath);
    await expect(hook(page, 'panel')).toHaveCount(0);
    await hook(page, 'toggle').click();
    await expectStep(page, 'read');
    expect(await stored(page)).toEqual({
      enabled: true,
      bookmark: { pageId: 'dashboard', step: 0, paused: false }
    });
    expect(errors).toEqual([]);
  });
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [1440, 320]) {
    test(`guidance remains readable, accessible and keyboard reachable in ${language} at ${width}px`, async ({
      page
    }) => {
      const fixture = await fixtures(page, language);
      await page.setViewportSize({ width, height: 480 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(dashboardPath);
      await hook(page, 'toggle').click();
      await expect(hook(page, 'page')).toContainText(
        language === 'en' ? 'Dashboard' : 'Tableau de bord'
      );
      await expect(hook(page, 'panel')).not.toContainText('admin.guidance.');
      await expect(page.locator('[data-og7="admin-guidance"]')).toHaveCSS(
        'animation-name',
        'none'
      );
      if (language === 'fr-CA') {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({
          path: `test-results/admin-guidance-preview-${width === 1440 ? 'desktop' : 'mobile'}.png`
        });
        await page.setViewportSize({ width, height: 480 });
      }
      const audit = await new AxeBuilder({ page })
        .include('[data-og7="admin-guidance-panel"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(audit.violations).toEqual([]);
      await hook(page, 'show').focus();
      await page.keyboard.press('Enter');
      await expectGoldenZone(page.locator('[data-og7="cockpit-metrics"]'));
      await expectShownLandmarkUncovered(page);
      await hook(page, 'next').focus();
      await expect(hook(page, 'next')).toBeFocused();
      // Chromium may clip a fraction of a CSS pixel inside the scrollable card.
      await expect(hook(page, 'next')).toBeInViewport({ ratio: 0.99 });
      await page.keyboard.press('Enter');
      await expectStep(page, 'choose');
      await expect(page.locator(highlighted)).toHaveCount(0);
      await hook(page, 'pause').focus();
      await page.keyboard.press('Enter');
      await expect(hook(page, 'paused')).toBeVisible();
      await hook(page, 'resume').focus();
      await page.keyboard.press('Enter');
      await expectStep(page, 'choose');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(fixture.mutations).toEqual([]);
    });
  }
}

for (const width of [1440, 320]) {
  test(`floating guidance keeps its place, can move away from controls and animates only once at ${width}px`, async ({
    page
  }) => {
    const fixture = await fixtures(page);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 480 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(dashboardPath);
    await hook(page, 'toggle').click();
    const card = page.locator('[data-og7="admin-guidance"]');
    await expect(card).not.toHaveCSS('animation-name', 'none');
    expect(
      await card.evaluate((element) =>
        getComputedStyle(element)
          .animationIterationCount.split(',')
          .every((count) => Number(count.trim()) === 1)
      )
    ).toBe(true);
    await expect
      .poll(() =>
        card.evaluate(
          (element) =>
            element
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === 'running' || animation.pending
              ).length
        )
      )
      .toBe(0);
    const initial = (await card.boundingBox())!;
    await page.evaluate(() =>
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'instant'
      })
    );
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const afterScroll = (await card.boundingBox())!;
    expect(afterScroll.x).toBeCloseTo(initial.x, 0);
    expect(afterScroll.y).toBeCloseTo(initial.y, 0);
    await hook(page, 'next').click();
    await expectStep(page, 'choose');
    const retained = await stored(page);
    const beforeMove = (await card.boundingBox())!;
    await hook(page, 'move').click();
    await expect
      .poll(async () => (await card.boundingBox())!.y)
      .toBeGreaterThan(beforeMove.y + 1);
    await expectStep(page, 'choose');
    expect(await stored(page)).toEqual(retained);
    await hook(page, 'show').click();
    await expectShownLandmarkUncovered(page);
    await hook(page, 'next').focus();
    await page.keyboard.press('Enter');
    await expectStep(page, 'verify');

    const refresh = page.locator('[data-og7="dashboard-refresh"]');
    await refresh.evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'instant' })
    );
    const response = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/admin/dashboard' &&
        candidate.request().method() === 'GET'
    );
    await refresh.click();
    expect((await response).status()).toBe(200);
    await expectStep(page, 'verify');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(card).toHaveCSS('animation-name', 'none');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('searchbox')).toBeFocused();
    expect(
      await card.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const foreground = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return document.querySelector('dialog[open]')?.contains(foreground);
      })
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expectStep(page, 'verify');
    expect(fixture.mutations).toEqual([]);
  });
}

test('guidance remains available in Pilotage concentration on a short mobile screen', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(dashboardPath + '/pilotage');
  await hook(page, 'toggle').click();
  const retained = (await stored(page)).bookmark;
  // Reducing the floating card clears covered controls on a narrow screen.
  await hook(page, 'toggle').click();
  expect((await stored(page)).bookmark).toEqual(retained);
  const concentration = page.locator('[data-og7="pilot-focus"]');
  await concentration.evaluate((element) =>
    element.scrollIntoView({ block: 'start', behavior: 'instant' })
  );
  await concentration.click();
  await expect(page.locator('[data-og7="pilot-focus"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await hook(page, 'toggle').click();
  await expectStep(page, 'read');
  expect((await stored(page)).bookmark).toEqual(retained);
  await expect(hook(page, 'toggle')).toBeVisible();
  await expect(hook(page, 'panel')).toBeVisible();
  await hook(page, 'pause').click();
  await expect(hook(page, 'paused')).toBeVisible();
  await hook(page, 'resume').click();
  await expectStep(page, 'read');
  await hook(page, 'show').click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await expect(page.locator('[data-og7="pilot-focus"]')).toBeVisible();
  await hook(page, 'toggle').click();
  expect((await stored(page)).bookmark).toEqual(retained);
  await concentration.evaluate((element) =>
    element.scrollIntoView({ block: 'start', behavior: 'instant' })
  );
  await concentration.click();
  await expect(page.locator('[data-og7="pilot-focus"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await hook(page, 'toggle').click();
  await expectStep(page, 'read');
  expect((await stored(page)).bookmark).toEqual(retained);
  expect(fixture.mutations).toEqual([]);
});

for (const { width, concentrated, placement } of [
  { width: 1440, concentrated: false, placement: 'top' },
  { width: 1440, concentrated: false, placement: 'bottom' },
  { width: 390, concentrated: false, placement: 'top' },
  { width: 390, concentrated: true, placement: 'bottom' }
] as const) {
  test(`showing a golden Pilotage zone clears the action bar and nested scroll frame at ${width}px, ${placement}, concentration ${concentrated}`, async ({
    page
  }, testInfo) => {
    const fixture = await fixtures(page);
    const id = '10000000-0000-4000-8000-000000000761';
    fixture.pilotage.total = 1;
    fixture.pilotage.domains.publications = 1;
    fixture.pilotage.decisions = [
      {
        id: 'publication:' + id,
        domain: 'publications',
        kind: 'publication_draft',
        targetId: id,
        version: '1',
        title: 'Dossier synthétique du guide',
        severity: 'this_week',
        dueAt: generatedAt,
        detailsUrl: dashboardPath + '/publications/drafts',
        facts: [],
        actions: [{ id: 'publication.approve', blocked: null }],
        publication: {
          id,
          feedId: 'openg7:facebook',
          kind: 'news',
          batchId: null,
          message: Array.from(
            { length: 40 },
            (_, index) => `Paragraphe synthétique ${index + 1} à examiner.`
          ).join('\n'),
          scheduledAt: generatedAt,
          mediaId: null,
          mediaUrl: null,
          mediaAlt: null,
          accountId: 'synthetic-account',
          mode: 'mock',
          autoManaged: false,
          sponsors: [],
          version: 1,
          status: 'draft',
          attempts: 0,
          nextAttemptAt: null,
          externalPostId: null,
          externalPostUrl: null,
          errorCode: null,
          approvedAt: null,
          publishedAt: null
        }
      }
    ];
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(dashboardPath + '/pilotage');
    if (concentrated) await page.locator('[data-og7="pilot-focus"]').click();
    const summary = page.locator('[data-og7="pilot-summary"]');
    const frame = page.locator('[data-og7="pilot-scroll"]');
    await expect(summary).toBeVisible();
    expect(await frame.evaluate((element) => element.scrollTop)).toBe(0);
    const initialSummary = (await summary.boundingBox())!;
    const initialFrame = (await frame.boundingBox())!;
    expect(initialSummary.y).toBeGreaterThan(
      initialFrame.y + initialFrame.height
    );
    await hook(page, 'toggle').click();
    if (placement === 'bottom') await hook(page, 'move').click();
    await expect(page.locator('[data-og7="admin-guidance"]')).toHaveAttribute(
      'data-og7-placement',
      placement
    );
    const bookmark = await stored(page);
    await hook(page, 'show').click();
    await expectGoldenZone(summary);
    await expect
      .poll(() => frame.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(async () => {
      const visibility = await summary.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const frame = element
          .closest('[data-og7="pilot-scroll"]')!
          .getBoundingClientRect();
        const toolbar = document
          .querySelector('[data-og7="pilot-controls"]')!
          .getBoundingClientRect();
        const card = document
          .querySelector('[data-og7="admin-guidance"]')!
          .getBoundingClientRect();
        const focused = document.activeElement as HTMLElement;
        const heading = focused.getBoundingClientRect();
        const top = Math.max(0, frame.top);
        const bottom = Math.min(innerHeight, frame.bottom, toolbar.top);
        const cardCrossesZone =
          rect.left < card.right && rect.right > card.left;
        const availableHeight = cardCrossesZone
          ? Math.max(
              Math.min(bottom, card.top) - top,
              bottom - Math.max(top, card.bottom)
            )
          : bottom - top;
        const wholeZoneFits = rect.height + 16 <= availableHeight;
        const points = [
          {
            x: heading.left + heading.width / 2,
            y: heading.top + Math.min(heading.height / 2, 12)
          }
        ];
        if (wholeZoneFits) {
          points.push({ x: rect.left + rect.width / 2, y: rect.bottom - 3 });
        }
        return {
          zone: { top: rect.top, bottom: rect.bottom, height: rect.height },
          viewport: { top, bottom, availableHeight },
          card: { top: card.top, bottom: card.bottom },
          focusedWithin: element.contains(focused),
          wholeZoneFits,
          wholeZoneVisible: rect.top >= top + 6 && rect.bottom <= bottom - 6,
          wholeZoneClearsCard:
            !cardCrossesZone ||
            rect.bottom <= card.top - 6 ||
            rect.top >= card.bottom + 6,
          pointsVisible: points.every(({ x, y }) => {
            const front = document.elementFromPoint(x, y);
            return (
              y >= top &&
              y < bottom &&
              front !== null &&
              element.contains(front)
            );
          })
        };
      });
      expect(visibility).toMatchObject({
        focusedWithin: true,
        pointsVisible: true
      });
      if (visibility.wholeZoneFits) {
        expect(visibility).toMatchObject({
          wholeZoneVisible: true,
          wholeZoneClearsCard: true
        });
      }
    }).toPass({ timeout: 7000 });
    await expectStep(page, 'read');
    expect(await stored(page)).toEqual(bookmark);
    await page.screenshot({
      path: testInfo.outputPath('gold-zone-above-pilotage-actions.png')
    });
    // A target inside the bar must itself remain reachable without activating it.
    await hook(page, 'next').click();
    await hook(page, 'show').click();
    const details = page.locator('[data-og7="pilot-details"]');
    await expectGoldenZone(details);
    await expectShownLandmarkUncovered(page);
    await expect(details).toBeFocused();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(fixture.mutations).toEqual([]);
  });
}

test('all eighteen protected admin workspaces retain guidance, including unavailable data', async ({
  page
}) => {
  test.setTimeout(90000);
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  for (const suffix of [
    '',
    '/pilotage',
    '/access',
    '/attention',
    '/assistant',
    '/contributions',
    '/sponsors',
    '/invoices',
    '/publications',
    '/publications/drafts',
    '/publications/batches',
    '/publications/calendar',
    '/publications/automation',
    '/expenses',
    '/transparency',
    '/audit',
    '/email-queue',
    '/setup'
  ]) {
    await page.goto(dashboardPath + suffix);
    await expect(hook(page, 'toggle')).toBeVisible();
    await expect(hook(page, 'panel')).toBeVisible();
    await expect(hook(page, 'page')).not.toBeEmpty();
    await expect(hook(page, 'panel')).not.toContainText('admin.guidance.');
  }
  expect(fixture.mutations).toEqual([]);
});
