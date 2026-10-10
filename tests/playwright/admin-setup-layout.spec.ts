import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { CockpitSystem } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import {
  installAdminTokenSession,
  setupFixture
} from './support/setup-fixtures.js';

async function installFixtures(page: Page, language = 'fr-CA') {
  await installAdminTokenSession(
    page,
    'openg7-admin-session.setup-layout-fixture',
    language
  );
  const base = setupFixture();
  const data = {
    setup: {
      ...base,
      last_updated_at: new Date().toISOString(),
      stripe: {
        ...base.stripe,
        secret_key_configured: true,
        webhook_secret_configured: true
      },
      invoice: {
        ...base.invoice,
        ready: true,
        issuer_name: 'Example',
        issuer_email: 'issuer@example.test'
      }
    },
    ...cockpitFixtures(),
    setupStatus: 200,
    systemsStatus: 200,
    writes: 0
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') data.writes++;
    if (path.endsWith('/setup-status'))
      return route.fulfill({
        status: data.setupStatus,
        json: data.setupStatus === 200 ? data.setup : {}
      });
    if (path.endsWith('/cockpit/systems'))
      return route.fulfill({
        status: data.systemsStatus,
        json: data.systemsStatus === 200 ? data.systems : {}
      });
    if (path.endsWith('/cockpit/activity'))
      return route.fulfill({ json: data.activity });
    return route.fulfill({ status: 503, json: {} });
  });
  return data;
}

function markSystemsOperational(
  data: Awaited<ReturnType<typeof installFixtures>>,
  identityPatch: Partial<CockpitSystem> = {}
): void {
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) => ({
      ...system,
      state: 'operational',
      ...(system.id === 'identity' ? identityPatch : {})
    }))
  };
}

const root = (page: Page) => page.locator('[data-og7="admin-setup"]');
const recommendation = (page: Page) =>
  page.locator('[data-og7="setup-recommendation"]');
const card = (page: Page, id: string) =>
  page.locator(`[data-og7="setup-system"][data-og7-id="${id}"]`);

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1600]) {
    test(`setup combines observed health, configuration and accessible details in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const data = await installFixtures(page, language);
      const en = language === 'en';
      await page.goto('/admin/fundraiser/setup');
      await expect(root(page).getByRole('heading', { level: 1 })).toHaveText(
        en
          ? 'Configuration and system status'
          : 'Configuration et état du système'
      );
      await expect(page.locator('[data-og7="setup-system"]')).toHaveCount(5);
      await expect(card(page, 'stripe')).toHaveAttribute(
        'data-state',
        'operational'
      );
      await expect(
        card(page, 'stripe').locator('[data-og7-id="webhooks"]')
      ).toContainText(en ? 'No recent activity' : 'Aucune activité récente');
      await expect(card(page, 'database')).toHaveAttribute(
        'data-state',
        'operational'
      );
      await expect(card(page, 'identity')).toHaveAttribute(
        'data-state',
        'operational'
      );
      await expect(card(page, 'identity')).toContainText('Keycloak');
      await expect(card(page, 'identity')).toContainText(
        en
          ? 'Realm, public keys, and Keycloak and database readiness verified'
          : 'Realm, clés publiques et disponibilité de Keycloak et de sa base vérifiés'
      );
      await expect(card(page, 'identity').locator('time')).toHaveAttribute(
        'datetime',
        data.systems.generatedAt
      );
      await expect(page.locator('#setup-readiness')).toContainText(
        en
          ? 'OIDC checks validate neither client sign-in nor MFA'
          : 'Les contrôles OIDC ne valident ni la connexion du client ni le MFA'
      );
      await expect(recommendation(page)).toContainText(
        en
          ? 'A service needs your attention'
          : 'Un service demande votre attention'
      );
      await expect(page.locator('[data-og7="setup-checklist"]')).toContainText(
        '6 / 6'
      );
      await card(page, 'identity').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#setup-identity')).toBeFocused();
      await card(page, 'storage').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#setup-storage')).toBeFocused();
      await card(page, 'database').click();
      await expect(page.locator('#setup-database')).toBeFocused();
      await expect(page.locator('#setup-database details')).toHaveAttribute(
        'open',
        ''
      );
      const guide = root(page).getByRole('button', {
        name: 'Guide',
        exact: true
      });
      await guide.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('dialog').locator(':focus')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(guide).toBeFocused();
      const variables = page.locator('[data-og7="setup-configuration-table"]');
      await expect(variables).not.toBeVisible();
      await root(page)
        .getByRole('navigation', {
          name: en ? 'Configuration sections' : 'Sections de configuration'
        })
        .getByRole('button', { name: 'Configuration', exact: true })
        .click();
      await expect(page.locator('#setup-env')).toBeFocused();
      await expect(variables).toBeVisible();
      if (width === 390) {
        await variables.focus();
        await expect(variables).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect
          .poll(() => variables.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .include('openg7-admin-setup-page')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(data.writes).toBe(0);
      await page.locator('#setup-env summary').click();
      await page.locator('#setup-overview').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`setup-${language}-${width}.png`),
        fullPage: true
      });
    });
  }
}

test('a timed-out identity check blocks readiness without changing the configuration checklist', async ({
  page
}) => {
  const data = await installFixtures(page);
  markSystemsOperational(data, {
    state: 'unavailable',
    evidence: 'check_failed',
    observedAt: null
  });
  await page.goto('/admin/fundraiser/setup');
  await expect(card(page, 'identity')).toHaveAttribute(
    'data-state',
    'unavailable'
  );
  await expect(card(page, 'identity')).toContainText(
    'La vérification n’a pas abouti'
  );
  await expect(card(page, 'identity').locator('time')).toHaveAttribute(
    'datetime',
    data.systems.generatedAt
  );
  await expect(page.locator('[data-og7="setup-checklist"]')).toContainText(
    '6 / 6'
  );
  await expect(recommendation(page)).toHaveAttribute('data-tone', 'warning');
  await recommendation(page).getByRole('button').click();
  await expect(page.locator('#setup-identity')).toBeFocused();
  expect(data.writes).toBe(0);
});

test('identity freshness expires independently and its recommendation opens the identity section', async ({
  page
}) => {
  await page.clock.install({ time: new Date() });
  const data = await installFixtures(page);
  markSystemsOperational(data, {
    validUntil: new Date(Date.now() + 15_000).toISOString()
  });
  await page.goto('/admin/fundraiser/setup');
  await expect(recommendation(page)).toHaveAttribute('data-tone', 'success');
  await page.clock.runFor(31_000);
  await expect(card(page, 'identity')).toHaveAttribute('data-state', 'unknown');
  await expect(card(page, 'identity')).toContainText('Observation périmée');
  await expect(card(page, 'database')).toHaveAttribute(
    'data-state',
    'operational'
  );
  await expect(page.locator('#setup-readiness')).toContainText(
    '4 / 5 contrôles confirmés'
  );
  await expect(recommendation(page)).toContainText(
    'La disponibilité OIDC reste à vérifier'
  );
  await recommendation(page).getByRole('button').click();
  await expect(page.locator('#setup-identity')).toBeFocused();
  expect(data.writes).toBe(0);
});

test('an older four-system response cannot prove OIDC readiness', async ({
  page
}) => {
  const data = await installFixtures(page);
  markSystemsOperational(data);
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.filter((system) => system.id !== 'identity')
  };
  await page.goto('/admin/fundraiser/setup');
  await expect(page.locator('[data-og7="setup-system"]')).toHaveCount(4);
  await expect(recommendation(page)).toHaveAttribute('data-tone', 'neutral');
  await expect(recommendation(page)).toContainText(
    'La disponibilité OIDC reste à vérifier'
  );
  await recommendation(page).getByRole('button').click();
  await expect(page.locator('#setup-identity')).toBeFocused();
  expect(data.writes).toBe(0);
});

for (const count of [4, 5]) {
  test(`token mode keeps its configuration guidance with a ${count}-system response`, async ({
    page
  }) => {
    const data = await installFixtures(page);
    data.setup.identity = { ...data.setup.identity!, mode: 'token' };
    markSystemsOperational(data, {
      state: 'not_configured',
      provider: 'OIDC',
      evidence: 'not_configured',
      observedAt: null
    });
    data.systems = {
      ...data.systems,
      systems: data.systems.systems.filter(
        (system) => count === 5 || system.id !== 'identity'
      )
    };
    await page.goto('/admin/fundraiser/setup');
    await expect(page.locator('[data-og7="setup-system"]')).toHaveCount(count);
    if (count === 5)
      await expect(card(page, 'identity')).toHaveAttribute(
        'data-state',
        'not_configured'
      );
    await expect(recommendation(page)).toContainText(
      'Préparer le passage à OIDC'
    );
    await expect(recommendation(page)).toHaveAttribute('data-tone', 'neutral');
    await recommendation(page).getByRole('button').click();
    await expect(page.locator('#setup-identity')).toBeFocused();
    expect(data.writes).toBe(0);
  });
}

test('expired service observations remove the reassuring recommendation without reloading', async ({
  page
}) => {
  await page.clock.install();
  const data = await installFixtures(page);
  markSystemsOperational(data);
  await page.goto('/admin/fundraiser/setup');
  await expect(recommendation(page)).toHaveAttribute('data-tone', 'success');
  await page.clock.runFor(61_000);
  await expect(recommendation(page)).toContainText(
    'La disponibilité OIDC reste à vérifier'
  );
  await expect(card(page, 'database')).toHaveAttribute('data-state', 'unknown');
  expect(data.writes).toBe(0);
});

test('a failed service refresh stays unconfirmed throughout a pending retry, then recovers', async ({
  page
}) => {
  const data = await installFixtures(page);
  markSystemsOperational(data);
  await page.goto('/admin/fundraiser/setup');
  await expect(recommendation(page)).toHaveAttribute('data-tone', 'success');
  await expect(card(page, 'database')).toHaveAttribute(
    'data-state',
    'operational'
  );
  data.systemsStatus = 503;
  await page
    .locator('#setup-readiness')
    .getByRole('button', {
      name: 'Actualiser les contrôles des services',
      exact: true
    })
    .click();
  await expect(card(page, 'database')).toHaveAttribute('data-state', 'unknown');
  await expect(
    page.getByRole('textbox', { name: 'Courriel de test', exact: true })
  ).toBeVisible();
  data.systemsStatus = 200;
  let releaseResponse!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/admin/cockpit/systems', async (route) => {
    await pendingResponse;
    await route.fulfill({ json: data.systems });
  });
  const refresh = page.locator('#setup-readiness').getByRole('button', {
    name: 'Actualiser les contrôles des services',
    exact: true
  });
  try {
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(card(page, 'database')).toHaveAttribute(
      'data-state',
      'unknown'
    );
    await expect(page.locator('#setup-readiness')).toContainText(
      '0 / 5 contrôles confirmés'
    );
    await expect(page.locator('#setup-readiness')).toContainText(
      'Dernière lecture conservée'
    );
    await expect(recommendation(page)).toHaveAttribute('data-tone', 'neutral');
  } finally {
    releaseResponse();
  }
  await expect(card(page, 'database')).toHaveAttribute(
    'data-state',
    'operational'
  );
  await expect(recommendation(page)).toHaveAttribute('data-tone', 'success');
  await expect(page.locator('#setup-readiness')).not.toContainText(
    'Dernière lecture conservée'
  );
  expect(data.writes).toBe(0);
});

test('Stripe webhook failures stay visible independently of an operational connection', async ({
  page
}) => {
  const data = await installFixtures(page);
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) => ({
      ...system,
      state: system.id === 'stripe' ? 'degraded' : 'operational',
      evidence: system.id === 'stripe' ? 'pending_errors' : system.evidence
    }))
  };
  await page.goto('/admin/fundraiser/setup');
  const stripe = card(page, 'stripe');
  await expect(stripe).toHaveAttribute('data-state', 'operational');
  await expect(stripe.locator('[data-og7-id="connection"]')).toContainText(
    'Opérationnel'
  );
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'Dégradé'
  );
  await expect(recommendation(page).getByRole('link')).toHaveAttribute(
    'href',
    '/admin/fundraiser/attention?type=stripe_event_failed'
  );

  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) =>
      system.id === 'stripe'
        ? { ...system, state: 'unknown', evidence: 'check_failed' }
        : system
    )
  };
  await page
    .getByRole('button', { name: 'Actualiser les contrôles des services' })
    .click();
  await expect(stripe.locator('[data-og7-id="connection"]')).toContainText(
    'Opérationnel'
  );
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'La vérification n’a pas abouti'
  );
  await expect(recommendation(page)).toContainText(
    'Des observations restent à confirmer'
  );
  expect(data.writes).toBe(0);
});

test('Stripe connection failure is not masked by a recent webhook and opens connection settings', async ({
  page
}) => {
  const data = await installFixtures(page);
  const lastWebhook = new Date(Date.now() - 120_000).toISOString();
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) => ({
      ...system,
      state: 'operational',
      ...(system.id === 'stripe'
        ? {
            evidence: 'recent_webhook' as const,
            observedAt: lastWebhook,
            connection: {
              ...system.connection!,
              state: 'unavailable' as const,
              evidence: 'check_failed' as const,
              observedAt: null
            }
          }
        : {})
    }))
  };
  await page.goto('/admin/fundraiser/setup');
  const stripe = card(page, 'stripe');
  await expect(stripe).toHaveAttribute('data-state', 'unavailable');
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'Activité récente'
  );
  await expect(
    stripe.locator('[data-og7-id="webhooks"] time').first()
  ).toHaveAttribute('datetime', lastWebhook);
  await recommendation(page).getByRole('button').click();
  await expect(page.locator('#setup-stripe')).toBeFocused();
  expect(data.writes).toBe(0);
});

test('Stripe connection and webhook checks expire independently and legacy responses stay unconfirmed', async ({
  page
}) => {
  await page.clock.install({ time: new Date() });
  const data = await installFixtures(page);
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) =>
      system.id === 'stripe'
        ? {
            ...system,
            state: 'operational',
            evidence: 'recent_webhook',
            observedAt: new Date(
              Date.now() - 14 * 60_000 - 45_000
            ).toISOString(),
            validUntil: new Date(Date.now() + 15_000).toISOString()
          }
        : system
    )
  };
  await page.goto('/admin/fundraiser/setup');
  const stripe = card(page, 'stripe');
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'Activité récente'
  );
  // The shared cockpit clock refreshes displayed observations every 30 seconds.
  await page.clock.runFor(31_000);
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'Observation périmée'
  );
  await expect(stripe.locator('[data-og7-id="connection"]')).toContainText(
    'Opérationnel'
  );
  await page.clock.runFor(30_000);
  await expect(stripe.locator('[data-og7-id="connection"]')).toContainText(
    'Observation périmée'
  );
  await expect(stripe).toHaveAttribute('data-state', 'unknown');

  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) => ({
      ...system,
      connection: undefined
    }))
  };
  await page
    .getByRole('button', { name: 'Actualiser les contrôles des services' })
    .click();
  await expect(stripe).toContainText(
    'La connexion à Stripe n’a pas été vérifiée'
  );
  await expect(stripe).toHaveAttribute('data-state', 'unknown');
});

test('an unreadable queue never shows confirmed zero counters or enables sending a test', async ({
  page
}) => {
  const data = await installFixtures(page);
  data.setup = {
    ...data.setup,
    email: {
      ...data.setup.email,
      last_error: 'Queue inspection unavailable',
      last_failed_at: null
    }
  };
  await page.goto('/admin/fundraiser/setup');
  await expect(recommendation(page)).toContainText(
    'L’état de la file reste à vérifier'
  );
  await expect(page.locator('#setup-queue strong')).toHaveText([
    '—',
    '—',
    '—',
    '—'
  ]);
  await expect(
    page.getByRole('button', { name: 'Envoyer un test', exact: true })
  ).toBeDisabled();
  expect(data.writes).toBe(0);
});

test('email failures recommend the existing recovery queue and deep links focus their section', async ({
  page
}) => {
  const data = await installFixtures(page);
  data.setup = {
    ...data.setup,
    email: { ...data.setup.email, failed_count: 2 }
  };
  await page.goto('/admin/fundraiser/setup?section=database');
  await expect(page.locator('#setup-database')).toBeFocused();
  await expect(recommendation(page)).toContainText(
    'Des courriels demandent une intervention'
  );
  await expect(recommendation(page).getByRole('link')).toHaveAttribute(
    'href',
    '/admin/fundraiser/email-queue'
  );
  expect(data.writes).toBe(0);
});

test('owner-only setup data and its guide disappear after a forbidden refresh', async ({
  page
}) => {
  const data = await installFixtures(page);
  await page.goto('/admin/fundraiser/setup');
  await expect(card(page, 'database')).toBeVisible();
  data.setupStatus = 403;
  await page
    .locator('#setup-overview')
    .getByRole('button', { name: 'Actualiser', exact: true })
    .click();
  await expect(page.locator('[data-og7="setup-system"]')).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Courriel de test', exact: true })
  ).toHaveCount(0);
  await expect(
    root(page).getByRole('button', { name: 'Guide', exact: true })
  ).toBeDisabled();
});

test('an expired system session returns to the same setup section after sign-in', async ({
  page
}) => {
  const data = await installFixtures(page);
  await page.goto('/admin/fundraiser/setup?section=storage');
  await expect(card(page, 'database')).toHaveAttribute(
    'data-state',
    'operational'
  );
  data.systemsStatus = 401;
  await page
    .locator('#setup-readiness')
    .getByRole('button', {
      name: 'Actualiser les contrôles des services',
      exact: true
    })
    .click();
  await expect(page).toHaveURL(/\/admin\/login\?/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(
    '/admin/fundraiser/setup?section=storage'
  );
  await expect(page.locator('[data-og7="setup-system"]')).toHaveCount(0);
});

test('a Stripe incident opens the filtered work queue and the entire guide stays read-only', async ({
  page
}) => {
  const data = await installFixtures(page);
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) => ({
      ...system,
      state: system.id === 'stripe' ? 'degraded' : 'operational'
    }))
  };
  await page.goto('/admin/fundraiser/setup');
  await expect(
    recommendation(page).getByRole('link', {
      name: 'Examiner les événements Stripe'
    })
  ).toHaveAttribute(
    'href',
    '/admin/fundraiser/attention?type=stripe_event_failed'
  );
  const guide = root(page).getByRole('button', { name: 'Guide', exact: true });
  await guide.click();
  for (let step = 1; step < 8; step++) {
    await expect(page.getByRole('dialog')).toContainText(`Etape ${step} / 8`);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Suivant', exact: true })
      .click();
  }
  await expect(page.getByRole('dialog')).toContainText('Etape 8 / 8');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Terminer', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(guide).toBeFocused();
  expect(data.writes).toBe(0);
});
