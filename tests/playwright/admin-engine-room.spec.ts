import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationFeedId
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  engineRoomFixture,
  engineSponsorId,
  engineDeliveryId,
  goldenPathObservation,
  operationalQueueFixture
} from './support/engine-room.js';

const path = '/admin/fundraiser/engine-room';

async function destinationFixture(page: Page, reader = false) {
  const fixture = await engineRoomFixture(page);
  const base = fixture.options.snapshot.publications.feeds[0];
  const feeds = (
    [
      'openg7:facebook',
      'openg7:linkedin',
      'openg20:facebook',
      'openg20:linkedin'
    ] as PublicationFeedId[]
  ).map((id) => ({ ...base, id }));
  fixture.options.snapshot.publications.feeds = feeds;
  const state: PublicationAutomationState = {
    feeds,
    workerEnabled: false,
    workerVersion: 1,
    summary: {
      awaitingApproval: 1,
      scheduled: 0,
      exceptions: 0,
      publishedToday: 0
    },
    deliveries: fixture.options.snapshot.publications.deliveries
  };
  const commands: PublicationAutomationCommand[] = [];
  const failures = { read: false, write: false };
  await page.route('**/api/admin/auth/current', (route) =>
    route.fulfill({
      json: {
        id: 'synthetic-operator',
        sessionId: 'synthetic-session',
        displayName: 'Synthetic operator',
        role: reader ? 'reader' : 'operator',
        expiresAt: '2099-01-01T00:00:00Z'
      }
    })
  );
  await page.route('**/api/admin/publication-automation', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill(
        failures.read ? { status: 503, json: {} } : { json: state }
      );
    const command = route
      .request()
      .postDataJSON() as PublicationAutomationCommand;
    commands.push(command);
    if (failures.write)
      return route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT' } });
    if (command.action === 'settings')
      Object.assign(
        feeds.find((feed) => feed.id === command.settings.id)!,
        command.settings
      );
    return route.fulfill({ json: {} });
  });
  if (reader)
    await page.addInitScript(() =>
      sessionStorage.setItem(
        'openg7-admin-session-token',
        'openg7-admin-session.cookie'
      )
    );
  return { ...fixture, state, commands, failures };
}

for (const locale of ['fr-CA', 'en']) {
  for (const id of [
    'openg7:facebook',
    'openg7:linkedin',
    'openg20:facebook',
    'openg20:linkedin'
  ]) {
    test(`destination navigation retains ${id} in ${locale}`, async ({
      page
    }) => {
      const { commands } = await destinationFixture(page);
      await page.addInitScript(
        (value) => localStorage.setItem('openg7.language', value),
        locale
      );
      await page.setViewportSize({
        width: locale === 'en' ? 390 : 1536,
        height: 1000
      });
      await page.goto(path);
      const module = page.locator(
        `[data-og7="engine-feed"][data-og7-id="${id}"]`
      );
      await module.click();
      await page.locator('[data-og7="engine-settings-link"]').click();
      const root = page.locator('[data-og7="destination-settings"]');
      const name = `${id.endsWith('facebook') ? 'Facebook' : 'LinkedIn'} · ${id.split(':')[0].toUpperCase()}`;
      await expect(root.getByRole('heading', { level: 1 })).toHaveText(name);
      await page.goBack();
      await expect(module).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-og7="engine-settings-link"]').click();
      await page.reload();
      await expect(root.getByRole('heading', { level: 1 })).toHaveText(name);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="destination-settings"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      if (id === 'openg20:facebook')
        await page.screenshot({
          path: test.info().outputPath('destination-settings.png'),
          fullPage: true
        });
      await root.locator('footer a').click();
      await expect(module).toHaveAttribute('aria-pressed', 'true');
      expect(commands).toEqual([]);
    });
  }
}

test('destination settings preserve drafts after failure and separate check, save and resume', async ({
  page
}) => {
  const { commands, failures } = await destinationFixture(page);
  await page.goto(
    '/admin/fundraiser/publications/destinations/openg7:facebook'
  );
  const capacity = page.locator('[formControlName="capacity"]');
  await expect(capacity).toHaveValue('3');
  await capacity.fill('4');
  await page.locator('[data-og7="destination-check"]').click();
  await expect(capacity).toHaveValue('4');
  expect(commands.map((command) => command.action)).toEqual(['check']);
  failures.write = true;
  await page.locator('[data-og7="destination-save"]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(capacity).toHaveValue('4');
  await expect(page.locator('[data-og7="destination-save"]')).toBeEnabled();
  failures.write = false;
  await page.locator('[data-og7="destination-save"]').click();
  await expect(page.locator('[data-og7="destination-save"]')).toBeDisabled();
  expect(commands.map((command) => command.action)).toEqual([
    'check',
    'settings',
    'settings'
  ]);
  const saved = commands.at(-1);
  expect(saved).toEqual({
    action: 'settings',
    settings: expect.objectContaining({
      id: 'openg7:facebook',
      capacity: 4,
      paused: true
    })
  });
  await page.locator('[data-og7="destination-pause"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button').last().click();
  await expect(page.locator('[data-og7="destination-pause"]')).toContainText(
    'pause'
  );
  expect(commands.at(-1)).toEqual({
    action: 'settings',
    settings: expect.objectContaining({ paused: false })
  });
});

test('destination settings reject invalid input and protect unsaved departure', async ({
  page
}) => {
  await destinationFixture(page);
  await page.goto(
    '/admin/fundraiser/publications/destinations/openg7:facebook?sponsorshipId=synthetic&decisionId=synthetic-decision'
  );
  const capacity = page.locator('[formControlName="capacity"]');
  await capacity.fill('11');
  await expect(page.locator('[data-og7="destination-save"]')).toBeDisabled();
  await page.locator('[data-og7="destination-settings"] footer a').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button').first().click();
  await expect(capacity).toHaveValue('11');
  await page
    .locator('[data-og7="destination-settings"] footer button')
    .first()
    .click();
  await expect(capacity).toHaveValue('3');
  await page.locator('[data-og7="destination-settings"] footer a').click();
  await expect(page).toHaveURL(
    /sponsorshipId=synthetic.*decisionId=synthetic-decision.*feedId=openg7/
  );
});

test('destination settings show unknown observations and a reader cannot mutate', async ({
  page
}) => {
  const { commands } = await destinationFixture(page, true);
  await page.goto(
    '/admin/fundraiser/publications/destinations/openg7:facebook'
  );
  await expect(page.locator('[formControlName="capacity"]')).toBeDisabled();
  await expect(page.locator('[data-og7="destination-check"]')).toHaveCount(0);
  await expect(page.locator('[data-og7="destination-save"]')).toHaveCount(0);
  await expect(page.locator('[data-og7="destination-settings"]')).toContainText(
    'Non disponible'
  );
  expect(commands).toEqual([]);
});

test('destination missing and failed reads do not invent a state', async ({
  page
}) => {
  const { failures, commands } = await destinationFixture(page);
  await page.goto('/admin/fundraiser/publications/destinations/invalid');
  await expect(
    page.getByRole('heading', { name: 'Destination introuvable' })
  ).toBeVisible();
  failures.read = true;
  await page.goto(
    '/admin/fundraiser/publications/destinations/openg7:facebook'
  );
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-og7="destination-save"]')).toHaveCount(0);
  expect(commands).toEqual([]);
});

test('destination execution and diagnostic links reuse filtered publishing operations', async ({
  page
}) => {
  const { commands } = await destinationFixture(page);
  await page.goto(
    '/admin/fundraiser/publications/destinations/openg7:facebook'
  );
  const root = page.locator('[data-og7="destination-settings"]');
  await root
    .getByRole('button', { name: 'File et exécutions', exact: true })
    .click();
  await root
    .getByRole('link', { name: 'Ouvrir les opérations de cette destination' })
    .click();
  await expect(page.locator('h1')).toHaveText('Opérations de publication');
  await expect(page.locator('.delivery-controls select')).toHaveValue(
    'openg7:facebook'
  );
  await expect(page.locator('.job')).toHaveCount(1);
  const link = page.locator(
    '[data-og7="publication-destination-link"][data-og7-id="openg7:facebook"]'
  );
  await link.click();
  await root
    .getByRole('button', { name: 'Journal et diagnostics', exact: true })
    .click();
  await root
    .getByRole('link', { name: 'Voir les exceptions de cette destination' })
    .click();
  await expect(page.locator('.delivery-controls select')).toHaveValue(
    'openg7:facebook'
  );
  await expect(page.locator('.job')).toHaveCount(0);
  expect(commands).toEqual([]);
});

for (const language of ['fr-CA', 'en'])
  test(`engine exception priorities preserve human and platform reasons in ${language}`, async ({
    page
  }) => {
    const { options, writes } = await engineRoomFixture(page);
    options.snapshot = {
      ...options.snapshot,
      workQueue: operationalQueueFixture()
    };
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(path);
    const queue = page.locator('[data-og7="operational-queue"]');
    await expect(
      queue.locator('[data-og7="operational-human-count"]')
    ).toHaveText('1');
    await expect(
      queue.locator('[data-og7="operational-platform-count"]')
    ).toHaveText('1');
    await expect(
      queue.locator('[data-og7="operational-intervention"]')
    ).toHaveCount(1);
    await expect(
      queue.locator('[data-og7="operational-platform-item"]')
    ).toHaveCount(1);
    await expect(
      queue.locator('[data-og7="operational-intervention"]')
    ).toContainText(language === 'en' ? 'uncertain' : 'incertain');
    await expect(
      queue.locator('[data-og7="operational-platform-item"]')
    ).toContainText(language === 'en' ? 'scheduled' : 'programmée');
    await expect(
      queue.locator('[data-og7="operational-intervention"] a').last()
    ).toHaveAttribute(
      'href',
      '/admin/fundraiser/attention?itemId=synthetic-human-exception'
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="operational-queue"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(writes).toEqual([]);
  });

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1536]) {
    test(`GP1 retains qualified proof, a simulated next passage and native links in ${language} at ${width}`, async ({
      page
    }, info) => {
      const { options, writes } = await engineRoomFixture(page);
      options.snapshot = {
        ...options.snapshot,
        goldenPath: goldenPathObservation()
      };
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(path + '?sponsorshipId=' + engineSponsorId);
      const cycle = page.locator('[data-og7="sponsorship-golden-path"]');
      await expect(cycle.getByRole('heading', { level: 2 })).toHaveText(
        language === 'en'
          ? 'Sponsorship recognition cycle'
          : 'Cycle de reconnaissance de la commandite'
      );
      await expect(cycle).toContainText('SYNTHETIC-GP1');
      await expect(
        cycle.locator('[data-og7="golden-path-service"]')
      ).toHaveCount(2);
      const next = cycle.locator('[data-og7="golden-path-next"]');
      await expect(next).toContainText(
        language === 'en'
          ? 'Platform processing'
          : 'Traitement par la plateforme'
      );
      await expect(next.getByRole('link')).toHaveAttribute(
        'href',
        `/admin/fundraiser/publications/automation?deliveryId=${engineDeliveryId}`
      );
      const services = cycle.locator('[data-og7="golden-path-service"]');
      await services.first().locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(
        cycle.locator('[data-og7="golden-path-proof"]')
      ).toContainText('2026');
      await services.nth(1).locator('summary').click();
      await expect(services.nth(1)).toContainText('Simulation');
      await expect(services.nth(1)).toContainText(
        language === 'en' ? 'No qualified evidence' : 'Aucune preuve qualifiée'
      );
      await expect(cycle.locator('[data-og7="golden-path-proof"]')).toHaveCount(
        1
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="sponsorship-golden-path"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath('sponsorship-golden-path.png'),
        fullPage: true
      });
      expect(writes).toEqual([]);
    });
  }
}

test('GP1 source failures, older APIs and partial coverage never become a successful empty cycle', async ({
  page
}) => {
  const { options, writes } = await engineRoomFixture(page);
  options.snapshot = {
    ...options.snapshot,
    goldenPath: goldenPathObservation()
  };
  options.snapshot = {
    ...options.snapshot,
    goldenPath: {
      status: 'available',
      path: { ...options.snapshot.goldenPath!.path!, partial: true }
    }
  };
  await page.goto(path + '?sponsorshipId=' + engineSponsorId);
  await expect(page.locator('[data-og7="golden-path-partial"]')).toBeVisible();
  options.snapshot = {
    ...options.snapshot,
    goldenPath: { status: 'unavailable', path: null }
  };
  await page.locator('[data-og7="engine-room-refresh"]').click();
  await expect(page.locator('[data-og7="golden-path-empty"]')).toContainText(
    'indisponible'
  );
  await expect(page.locator('[data-og7="golden-path-counts"]')).toHaveCount(0);
  options.snapshot = { ...options.snapshot, goldenPath: undefined };
  await page.locator('[data-og7="engine-room-refresh"]').click();
  await expect(page.locator('[data-og7="golden-path-empty"]')).toContainText(
    'Non observé'
  );
  options.fail = true;
  await page.locator('[data-og7="engine-room-refresh"]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.locator('[data-og7="sponsorship-golden-path"]')
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('a collective opens the chosen participant cycle and retains decision return context', async ({
  page
}) => {
  const { options, reads, writes } = await engineRoomFixture(page);
  options.snapshot = {
    ...options.snapshot,
    goldenPath: goldenPathObservation()
  };
  await page.goto(
    path +
      '?deliveryId=' +
      engineDeliveryId +
      '&decisionId=publication:synthetic'
  );
  await expect(
    page.locator('[data-og7="sponsorship-golden-path"]')
  ).toHaveCount(0);
  const participant = page
    .locator('[data-og7="golden-path-participants"] a')
    .first();
  await expect(participant).toContainText('Entreprise synthétique');
  await participant.click();
  await expect(
    page.locator('[data-og7="sponsorship-golden-path"]')
  ).toContainText('SYNTHETIC-GP1');
  expect(reads.at(-1)).toBe('?sponsorshipId=' + engineSponsorId);
  await expect(
    page.locator('[data-og7="engine-room-scope"] a').first()
  ).toHaveAttribute(
    'href',
    '/admin/fundraiser/pilotage?decisionId=publication:synthetic'
  );
  expect(writes).toEqual([]);
});
for (const language of ['fr-CA', 'en'])
  for (const width of [390, 1024, 1536]) {
    test(`engine room distinguishes settings, destinations and relay evidence in ${language} at ${width}`, async ({
      page
    }, info) => {
      const { writes } = await engineRoomFixture(page);
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 1000 });
      const navigation = await page.goto(path);
      expect(navigation?.status()).toBe(200);
      await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(2);
      const facebook = page.locator(
        '[data-og7="engine-feed"][data-og7-id="openg7:facebook"]'
      );
      const linkedin = page.locator(
        '[data-og7="engine-feed"][data-og7-id="openg7:linkedin"]'
      );
      await expect(facebook).toContainText('Simulation');
      await expect(linkedin).toContainText(
        language === 'fr-CA' ? 'Réel' : 'Live'
      );
      await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
        language === 'fr-CA' ? 'n’est pas mesurée' : 'is not measured'
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="engine-room"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath('engine-room.png'),
        fullPage: true
      });
      const scene = await page
        .locator('[data-og7="engine-scene"]')
        .boundingBox();
      const inspector = page.locator('[data-og7="engine-detail"]');
      const inspectionBox = await inspector.boundingBox();
      if (width >= 768)
        expect(inspectionBox!.x).toBeGreaterThanOrEqual(
          scene!.x + scene!.width
        );
      else
        expect(inspectionBox!.y).toBeGreaterThanOrEqual(
          scene!.y + scene!.height
        );
      await facebook.click();
      await expect(facebook).toHaveAttribute('aria-pressed', 'true');
      await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(
        'Facebook · OPENG7'
      );
      await page.locator('[data-og7="engine-diagnostic-tab"]').click();
      await expect(inspector).toContainText('sandbox-page');
      const settings = new URL(
        (await page
          .locator('[data-og7="engine-settings-link"]')
          .getAttribute('href'))!,
        page.url()
      );
      expect(settings.searchParams.get('feedId')).toBe('openg7:facebook');
      await page
        .locator(
          width === 390
            ? '[data-og7="engine-switch-preflight"]'
            : '[data-og7="engine-preflight"]'
        )
        .click();
      if (width === 390) {
        await expect(
          page.locator('[data-og7="engine-publications"]')
        ).not.toBeVisible();
        await expect(
          page.locator('[data-og7="engine-preflight"]')
        ).toBeVisible();
      }
      await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
        language === 'fr-CA' ? 'Aucun signal exploitable' : 'No usable signal'
      );
      await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
        language === 'fr-CA' ? 'Non vérifiée' : 'Not verified'
      );
      expect(writes).toEqual([]);
    });
  }

test('stale and partial observations remain explicit and do not animate a false running engine', async ({
  page
}) => {
  const { options, writes } = await engineRoomFixture(page);
  options.snapshot = {
    ...options.snapshot,
    observedAt: '2020-01-01T00:00:00Z',
    publications: { ...options.snapshot.publications, partial: true }
  };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(
    page.locator('[data-og7="engine-room-summary"] [role="status"]')
  ).toBeVisible();
  const blade = page.locator('openg7-engine-motor i').first();
  expect(
    await blade.evaluate((element) => getComputedStyle(element).animationName)
  ).toBe('none');
  expect(
    await page
      .locator('openg7-engine-motor')
      .evaluateAll((motors) =>
        motors.every((motor) => motor.getAttribute('data-state') === 'unknown')
      )
  ).toBe(true);
  await page.locator('[data-og7="engine-feed"]').first().click();
  await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
    'Observation ancienne'
  );
  expect(writes).toEqual([]);
});

test('immersive mobile shell keeps global tools and language accessible without hiding the room', async ({
  page
}) => {
  const { writes } = await engineRoomFixture(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(path);
  await expect(page.locator('[data-og7="engine-publications"]')).toBeVisible();
  const tools = page.getByRole('button', { name: 'Outils', exact: true });
  await expect(tools).toHaveAttribute('aria-expanded', 'false');
  await tools.click();
  await expect(tools).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Intelligent engine room'
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-og7="admin-layout"]')
        .analyze()
    ).violations
  ).toEqual([]);
  expect(writes).toEqual([]);
});

test('disabled delivery modules and configured local preparation never become confirmed activity', async ({
  page
}) => {
  const { options, writes } = await engineRoomFixture(page);
  options.snapshot = {
    ...options.snapshot,
    publications: {
      ...options.snapshot.publications,
      workerEnabled: false,
      feeds: options.snapshot.publications.feeds.map((feed) => ({
        ...feed,
        mode: 'disabled',
        configured: false,
        accountId: null,
        connection: 'unchecked',
        paused: true
      }))
    },
    preflight: {
      ...options.snapshot.preflight,
      connectorEnabled: false,
      localPreparationEnabled: true
    }
  };
  await page.goto(path);
  await expect(page.locator('[data-og7="engine-publications"]')).toContainText(
    'Configuration à examiner'
  );
  await page.locator('[data-og7="engine-feed"]').first().click();
  await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
    'La diffusion est désactivée pour cette destination.'
  );
  await page.locator('[data-og7="engine-diagnostic-tab"]').click();
  await expect(page.locator('[data-og7="engine-diagnostics"]')).toContainText(
    'Aucun compte configuré'
  );
  await page.locator('[data-og7="engine-preflight"]').click();
  await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
    'Préparation locale configurée'
  );
  expect(writes).toEqual([]);
});

test('dossier entry preserves scope and exact return without loading unrelated destinations', async ({
  page
}) => {
  const { reads, writes } = await engineRoomFixture(page);
  await page.goto(
    path +
      '?sponsorshipId=' +
      engineSponsorId +
      '&decisionId=publication%3Asynthetic'
  );
  await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(1);
  expect(reads[0]).toBe('?sponsorshipId=' + engineSponsorId);
  await expect(
    page.locator('[data-og7="engine-room-scope"] a').first()
  ).toHaveAttribute(
    'href',
    '/admin/fundraiser/pilotage?decisionId=publication:synthetic'
  );
  await page.locator('[data-og7="engine-room-scope"] a').last().click();
  await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(2);
  expect(writes).toEqual([]);
});

test('partial owner failure keeps Preflight visible and a failed refresh clears private observations', async ({
  page
}) => {
  const { options, writes } = await engineRoomFixture(page);
  options.snapshot = {
    ...options.snapshot,
    publications: {
      available: false,
      workerEnabled: null,
      feeds: [],
      deliveries: [],
      partial: false
    }
  };
  await page.goto(path);
  await expect(
    page.locator('[data-og7="engine-detail"] [role="status"]')
  ).toBeVisible();
  await page.locator('[data-og7="engine-preflight"]').click();
  await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
    'Preflight'
  );
  options.fail = true;
  await page.locator('[data-og7="engine-room-refresh"]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-og7="engine-detail"]')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('an old dossier response cannot replace a newer route context', async ({
  page
}) => {
  const { writes } = await engineRoomFixture(page);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let first = true;
  await page.route(/\/api\/admin\/engine-room(?:\?|$)/, async (route) => {
    if (!first) return route.fallback();
    first = false;
    entered();
    await gate;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto(path + '?sponsorshipId=' + engineSponsorId);
  await started;
  await page.locator('[data-og7="engine-room-scope"] a').last().click();
  await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(2);
  const late = page.waitForResponse(
    (response) =>
      response.url().includes('/engine-room') && response.status() === 503
  );
  release();
  await late;
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(2);
  expect(writes).toEqual([]);
});
