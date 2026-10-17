import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import {
  createJourneyClock,
  journeyState
} from '../../apps/funding-web/src/app/features/funding/components/admin-cockpit/platform-journey-state.js';

import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { expect, test } from './support/test.js';

const journeyEndpoint = '**/api/admin/cockpit/journeys';
const sessionToken = 'openg7-admin-session.platform-journeys-synthetic-fixture';
const panel = (page: Page) => page.locator('[data-og7="platform-journeys"]');
const cards = (page: Page) =>
  panel(page).locator('[data-og7="platform-journey"]');
const journey = (page: Page, id: string) =>
  panel(page).locator(`[data-og7="platform-journey"][data-og7-id="${id}"]`);
const journeyDetails = (page: Page, id: string) =>
  panel(page).locator(
    `[data-og7="platform-journey-details"][data-og7-id="${id}"]`
  );
const refresh = (page: Page) =>
  panel(page)
    .locator('[data-og7="platform-journeys-refresh"]')
    .getByRole('button');

async function fixtures(page: Page, language = 'fr-CA') {
  await page.addInitScript(
    ({ token, language }) => {
      sessionStorage.setItem('openg7-admin-session-token', token);
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2099-01-01T00:00:00Z'
      );
      localStorage.setItem('openg7.language', language);
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({
          theme: 'mineral',
          system: false,
          density: 'comfortable'
        })
      );
    },
    { token: sessionToken, language }
  );
  const data = cockpitFixtures();
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/') &&
      request.method() !== 'GET'
    ) {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/admin/cockpit/')) {
      const block = path.split('/').pop() as keyof typeof data;
      await route.fulfill({ json: data[block] });
    } else if (path === '/api/admin/dashboard') {
      // The journey panel remains available when financial dashboard data is absent.
      await route.fulfill({ json: { data_available: false } });
    } else {
      await route.fulfill({ status: 503, json: {} });
    }
  });
  return { data, mutations };
}

const expectedStates = {
  contribution: 'operational',
  invoicing: 'degraded',
  sponsorship: 'unknown',
  publication: 'unavailable',
  transparency: 'unknown',
  administration: 'unknown'
} as const;
const stateLabels = {
  'fr-CA': {
    operational: 'Opérationnel',
    degraded: 'Dégradé',
    unavailable: 'Bloqué',
    unknown: 'Non vérifié'
  },
  en: {
    operational: 'Operational',
    degraded: 'Degraded',
    unavailable: 'Blocked',
    unknown: 'Not verified'
  }
} as const;
const indicatorColors = {
  operational: {
    foreground: 'rgb(5, 46, 22)',
    background: 'rgb(34, 197, 94)'
  },
  degraded: {
    foreground: 'rgb(66, 32, 6)',
    background: 'rgb(250, 204, 21)'
  },
  unavailable: {
    foreground: 'rgb(69, 10, 10)',
    background: 'rgb(239, 68, 68)'
  },
  unknown: {
    foreground: 'rgb(51, 65, 85)',
    background: 'rgb(203, 213, 225)'
  }
} as const;

test('request latency and rereading old server snapshots cannot extend a light’s lifetime', () => {
  const clock = createJourneyClock();
  const generatedAt = '2026-10-17T14:00:00.000Z';
  const observation = {
    ...cockpitFixtures().journeys.journeys[0]!,
    checkedAt: generatedAt,
    validUntil: '2026-10-17T14:01:00.000Z'
  };
  expect(journeyState(observation, clock.now(0))).toBe('unknown');
  clock.observe(generatedAt, 0, 1_000);
  expect(journeyState(observation, clock.now(59_000))).toBe('operational');
  expect(journeyState(observation, clock.now(60_000))).toBe('unknown');
  clock.observe(generatedAt, 60_000, 60_500);
  expect(journeyState(observation, clock.now(60_500))).toBe('unknown');
  clock.observe('2026-10-17T13:59:00.000Z', 60_500, 61_000);
  expect(journeyState(observation, clock.now(61_000))).toBe('unknown');
  clock.observe('invalid', 61_000, 61_500);
  expect(journeyState(observation, clock.now(61_500))).toBe('unknown');
  clock.observe(generatedAt, 61_500, 62_000);
  expect(journeyState(observation, clock.now(62_000))).toBe('unknown');

  const delayed = createJourneyClock();
  delayed.observe(generatedAt, 0, 61_000);
  expect(journeyState(observation, delayed.now(61_000))).toBe('unknown');
});

for (const offset of [-300_000, 300_000]) {
  test(`server observations expire normally with a client clock offset of ${offset / 60_000} minutes`, async ({
    page
  }) => {
    await page.clock.install({ time: new Date(Date.now() + offset) });
    const { data, mutations } = await fixtures(page);
    await page.goto('/admin/fundraiser');
    const contribution = journey(page, 'contribution');
    await expect(contribution).toHaveAttribute('data-state', 'operational');

    // A wall-clock adjustment must not age or renew the server evidence.
    await page.clock.setSystemTime(new Date(Date.now() + offset + 3_600_000));
    await refresh(page).click();
    await expect(contribution).toHaveAttribute('data-state', 'operational');
    await page.clock.fastForward(59_000);
    await expect(contribution).toHaveAttribute('data-state', 'operational');
    await page.clock.fastForward(2_000);
    await expect(contribution).toHaveAttribute('data-state', 'unknown');
    // The poll and this retry return the same snapshot, without extending its TTL.
    await refresh(page).click();
    await expect(contribution).toHaveAttribute('data-state', 'unknown');
    await contribution.click();
    await expect(
      journeyDetails(page, 'contribution')
        .locator(`time[datetime="${data.journeys.journeys[0]!.checkedAt}"]`)
        .first()
    ).toBeVisible();
    expect(mutations).toEqual([]);
  });
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`synthetic journey observations explain six indicators with keyboard details in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 950 });
      const { data, mutations } = await fixtures(page, language);
      await page.goto('/admin/fundraiser');
      await expect(
        panel(page).getByRole('heading', {
          name: language === 'en' ? 'Journey status' : 'État des parcours'
        })
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(cards(page)).toHaveCount(6);
      for (const [id, state] of Object.entries(expectedStates)) {
        const card = journey(page, id);
        await expect(card).toHaveAttribute('data-state', state);
        await expect(card).toContainText(stateLabels[language][state]);
        await expect(
          card.locator('[data-og7="platform-journey-light"]')
        ).toHaveCSS('color', indicatorColors[state].foreground);
        await expect(
          card.locator('[data-og7="platform-journey-light"]')
        ).toHaveCSS('background-color', indicatorColors[state].background);
        await expect(card).toHaveAccessibleName(/\S/);
        await expect(card).not.toContainText('admin.');
      }
      // Each indicator exposes its expanded state and opens its evidence by keyboard.
      const contribution = journey(page, 'contribution');
      const details = journeyDetails(page, 'contribution');
      await expect(details).toBeHidden();
      await contribution.focus();
      await page.keyboard.press('Enter');
      await expect(contribution).toHaveAttribute('aria-expanded', 'true');
      await expect(contribution).toBeFocused();
      await expect(contribution).toHaveCSS('outline-width', '3px');
      await expect(details).toBeVisible();
      await expect(contribution).toContainText('Test');
      await expect(details.locator('time')).not.toHaveCount(0);
      await expect(
        details.locator(
          `time[datetime="${data.journeys.journeys[0]!.validUntil}"]`
        )
      ).toBeVisible();
      await expect(details.getByRole('link')).toHaveAttribute(
        'href',
        '/admin/fundraiser'
      );
      await expect(
        details.locator('[data-og7="platform-journey-step"]')
      ).toHaveCount(4);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await contribution.focus();
      await page.keyboard.press('Space');
      await expect(contribution).toHaveAttribute('aria-expanded', 'false');
      await expect(contribution).toBeFocused();
      await expect(details).toBeHidden();
      const review = journey(page, 'sponsorship');
      await review.click();
      await expect(review).toHaveAttribute('data-state', 'unknown');
      await expect(journeyDetails(page, 'sponsorship')).toContainText(
        language === 'en'
          ? 'An administrative review is pending'
          : 'Une revue administrative est attendue'
      );
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="platform-journeys"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await journeyDetails(page, 'sponsorship').locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(review).toHaveAttribute('aria-expanded', 'false');
      await expect(journeyDetails(page, 'sponsorship')).toBeHidden();
      await expect(review).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(mutations).toEqual([]);
      await panel(page).screenshot({
        path: testInfo.outputPath(`journeys-${language}-${width}.png`)
      });
    });
  }
}

test('expired observations lose their green indicator without reloading or inventing a new proof', async ({
  page
}) => {
  await page.clock.install();
  const { data, mutations } = await fixtures(page);
  await page.goto('/admin/fundraiser');
  const contribution = journey(page, 'contribution');
  await expect(contribution).toHaveAttribute('data-state', 'operational');
  await contribution.click();
  await page.clock.fastForward(90_000);
  await expect(contribution).toHaveAttribute('data-state', 'unknown');
  await expect(journeyDetails(page, 'contribution')).toContainText(/périmée/);
  await expect(
    journeyDetails(page, 'contribution')
      .locator(`time[datetime="${data.journeys.journeys[0]!.checkedAt}"]`)
      .first()
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test('automatic GET refresh updates journey observations after 45 seconds without overlapping reads', async ({
  page
}) => {
  await page.clock.install();
  const { data, mutations } = await fixtures(page);
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let releaseResponse!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route(journeyEndpoint, async (route) => {
    expect(route.request().method()).toBe('GET');
    const index = ++calls;
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (index === 2) await pendingResponse;
      const time = await page.evaluate(() => Date.now());
      const checkedAt = new Date(time).toISOString();
      const validUntil = new Date(time + 60_000).toISOString();
      await route.fulfill({
        json: {
          generatedAt: checkedAt,
          journeys: data.journeys.journeys.map((item) => ({
            ...item,
            ...(index > 1 && item.id === 'contribution'
              ? { state: 'degraded', diagnostic: 'processing_delayed' }
              : {}),
            checkedAt,
            observedAt: checkedAt,
            validUntil,
            steps: item.steps.map((step) => ({
              ...step,
              checkedAt,
              observedAt: checkedAt,
              validUntil
            }))
          }))
        }
      });
    } finally {
      active--;
    }
  });
  await page.goto('/admin/fundraiser');
  const contribution = journey(page, 'contribution');
  await expect(contribution).toHaveAttribute('data-state', 'operational');
  await expect.poll(() => calls).toBe(1);
  try {
    await page.clock.fastForward(45_000);
    await expect.poll(() => calls).toBe(2);
    await expect(refresh(page)).toBeDisabled();
    await page.clock.fastForward(45_000);
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
  } finally {
    releaseResponse();
  }
  await expect(contribution).toHaveAttribute('data-state', 'degraded');
  await expect(refresh(page)).toBeEnabled();
  expect(mutations).toEqual([]);
});

test('a failed refresh retains the snapshot while removing green until a successful read', async ({
  page
}) => {
  const { data, mutations } = await fixtures(page);
  await page.goto('/admin/fundraiser');
  const contribution = journey(page, 'contribution');
  await expect(contribution).toHaveAttribute('data-state', 'operational');
  await contribution.click();
  await page.route(journeyEndpoint, (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await refresh(page).click();
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(cards(page)).toHaveCount(6);
  await expect(
    panel(page).locator(
      '[data-og7="platform-journey"][data-state="operational"]'
    )
  ).toHaveCount(0);
  await expect(contribution).toHaveAttribute('data-state', 'unknown');
  await expect(panel(page)).toContainText('Dernière lecture conservée');
  await expect(
    journeyDetails(page, 'contribution')
      .locator(`time[datetime="${data.journeys.journeys[0]!.checkedAt}"]`)
      .first()
  ).toBeVisible();
  let releaseResponse!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route(journeyEndpoint, async (route) => {
    await pendingResponse;
    await route.fulfill({ json: data.journeys });
  });
  try {
    await refresh(page).click();
    await expect(refresh(page)).toBeDisabled();
    await expect(contribution).toHaveAttribute('data-state', 'unknown');
  } finally {
    releaseResponse();
  }
  await expect(contribution).toHaveAttribute('data-state', 'operational');
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test('an initial read failure is explicit and can be retried without a mutation', async ({
  page
}) => {
  const { data, mutations } = await fixtures(page);
  await page.route(journeyEndpoint, (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await page.route(journeyEndpoint, (route) =>
    route.fulfill({ json: data.journeys })
  );
  await refresh(page).click();
  await expect(cards(page)).toHaveCount(6);
  await expect(journey(page, 'contribution')).toHaveAttribute(
    'data-state',
    'operational'
  );
  expect(mutations).toEqual([]);
});

test('a forbidden read removes private observations even after an earlier successful read', async ({
  page
}) => {
  const { data, mutations } = await fixtures(page);
  let allowed = false;
  await page.route(journeyEndpoint, (route) =>
    allowed
      ? route.fulfill({ json: data.journeys })
      : route.fulfill({ status: 403, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(panel(page).locator('time')).toHaveCount(0);
  allowed = true;
  await refresh(page).click();
  await expect(cards(page)).toHaveCount(6);
  await journey(page, 'contribution').click();
  allowed = false;
  await refresh(page).click();
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(
    panel(page).locator('[data-og7="platform-journey-details"]')
  ).toHaveCount(0);
  await expect(panel(page).locator('time')).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test('an expired API session redirects to login and clears the saved token', async ({
  page
}) => {
  await fixtures(page);
  await page.route(journeyEndpoint, (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
  await expect(panel(page)).toHaveCount(0);
});

test('journey observations remain visible when the independent dashboard request fails', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(cards(page)).toHaveCount(6);
  await expect(journey(page, 'contribution')).toHaveAttribute(
    'data-state',
    'operational'
  );
  await refresh(page).click();
  await expect(journey(page, 'contribution')).toHaveAttribute(
    'data-state',
    'operational'
  );
});
