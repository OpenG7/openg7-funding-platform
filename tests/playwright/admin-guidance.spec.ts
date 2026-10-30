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

import { SERVICE_DELIVERY_TOUR_ENABLED } from '../../apps/funding-web/src/app/features/funding/config/admin-guide-features.js';

import { expect, sampledFrames, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { restoreLegacyGuideMode } from './support/admin-guidance-bookmarks.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';

const storagePrefix = 'og7-admin-guidance:v1:';
const highlighted = '[data-og7-guidance-highlight]';
const dashboardPath = '/admin/fundraiser';
const attentionPath = dashboardPath + '/attention';
const automaticWorkspaces = [
  ['dashboard', ''],
  ['pilotage', '/pilotage'],
  ['access', '/access'],
  ['attention', '/attention'],
  ['assistant', '/assistant'],
  ['contributions', '/contributions'],
  ['sponsors', '/sponsors'],
  ['sponsorsQuality', '/sponsors/quality'],
  ['campaigns', '/campaigns'],
  ['invoices', '/invoices'],
  ['publications', '/publications'],
  ['drafts', '/publications/drafts'],
  ['batches', '/publications/batches'],
  ['calendar', '/publications/calendar'],
  ['automation', '/publications/automation'],
  ['expenses', '/expenses'],
  ['transparency', '/transparency'],
  ['audit', '/audit'],
  ['email', '/email-queue'],
  ['setup', '/setup']
] as const;
const generatedAt = '2026-10-14T12:00:00Z';

for (const [locale, theme, width, height] of [
  ['fr-CA', 'mineral', 1536, 864],
  ['en', 'night', 390, 667],
  ['fr-CA', 'graphite', 390, 844]
] as const) {
  test(`the guide keeps discovery and service delivery usable in ${locale} ${theme} at ${width} by ${height}`, async ({
    page
  }, testInfo) => {
    const f = await fixtures(page, locale);
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({
          theme: selectedTheme,
          system: false,
          density: 'comfortable'
        })
      );
    }, theme);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(dashboardPath);
    const guide = page.locator('[data-og7="admin-guidance"]');
    const guideName =
      locale === 'en'
        ? 'OpenG7 administrative guide'
        : 'Guide administratif OpenG7';
    const openGuideName =
      locale === 'en' ? 'Administrative guide' : 'Guide administratif';
    await expect(guide).toHaveAccessibleName(guideName);
    await expect(hook(page, 'toggle')).toHaveAccessibleName(openGuideName);
    await hook(page, 'toggle').click();
    await expect(guide).toHaveAccessibleName(guideName);
    await expect(hook(page, 'toggle')).toHaveAccessibleName(
      locale === 'en' ? 'Collapse the guide' : 'Réduire le guide'
    );
    await hook(page, 'toggle').click();
    await expect(guide).toHaveAccessibleName(guideName);
    await expect(hook(page, 'toggle')).toHaveAccessibleName(openGuideName);
    await hook(page, 'toggle').click();
    const discoveryLabel = locale === 'en' ? 'Discover' : 'Découvrir';
    const serviceDeliveryLabel =
      locale === 'en' ? 'Service delivery' : 'Prestations';
    const modes = hook(page, 'modes');
    await expect(modes.getByRole('button')).toHaveCount(2);
    await expect(hook(page, 'discovery-mode')).toHaveAccessibleName(
      discoveryLabel
    );
    await expect(hook(page, 'discovery-mode').locator('span')).toBeVisible();
    await expect(hook(page, 'discovery-mode')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(modes.getByRole('link')).toHaveCount(0);
    await expect(hook(page, 'service-delivery-mode')).toHaveAccessibleName(
      serviceDeliveryLabel
    );
    await expect(
      hook(page, 'service-delivery-mode').locator('span')
    ).toBeVisible();
    await expect(hook(page, 'service-delivery-mode')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    if (SERVICE_DELIVERY_TOUR_ENABLED) {
      await expect(hook(page, 'tour-play')).toHaveAccessibleName('Play');
      await expect(hook(page, 'tour-pause')).toHaveAccessibleName('Pause');
      await expect(hook(page, 'tour-stop')).toHaveAccessibleName(
        locale === 'en' ? 'Stop' : 'Arrêt'
      );
      await expect(hook(page, 'tour-pause')).toBeDisabled();
      await expect(hook(page, 'tour-stop')).toBeDisabled();
    } else {
      for (const control of ['play', 'pause', 'stop']) {
        await expect(hook(page, 'tour-' + control)).toBeHidden();
        await expect(hook(page, 'tour-' + control)).toBeDisabled();
      }
    }
    for (const removed of ['payment', 'automatic', 'workflows']) {
      await expect(hook(page, removed + '-mode')).toHaveCount(0);
    }
    await expectDiscoveryHub(page);
    await expect(hook(page, 'panel')).not.toContainText('admin.guidance.');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await hook(page, 'discovery-mode').focus();
    await page.keyboard.press('Enter');
    await expectDiscoveryHub(page);
    await expect(hook(page, 'discovery-mode')).toBeFocused();
    const audit = await new AxeBuilder({ page })
      .include('[data-og7="admin-guidance"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`guide-${locale}-${theme}-${width}.png`),
      animations: 'disabled'
    });
    expect(f.mutations).toEqual([]);
  });
}

for (const [locale, width, height, sourcePath] of [
  ['fr-CA', 1440, 900, dashboardPath],
  ['en', 1440, 900, attentionPath],
  ['fr-CA', 390, 844, attentionPath],
  ['en', 390, 844, dashboardPath]
] as const) {
  test(`service delivery stays inside the administrative guide in ${locale} at ${width}px`, async ({
    page
  }) => {
    const f = await fixtures(page, locale);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${sourcePath}?contributionId=${paymentId}#guide-context`);
    const sourceUrl = page.url();
    const main = await page.locator('#admin-main').elementHandle();
    expect(main).not.toBeNull();
    await hook(page, 'toggle').click();
    await expect(hook(page, 'panel')).toBeVisible();
    const guide = page.locator('[data-og7="admin-guidance"]');
    const initialBounds = await guide.boundingBox();
    expect(initialBounds).not.toBeNull();
    const expectStableBounds = async () => {
      const bounds = await guide.boundingBox();
      expect(bounds).not.toBeNull();
      for (const dimension of ['x', 'y', 'width', 'height'] as const) {
        expect(bounds![dimension]).toBeCloseTo(initialBounds![dimension], 0);
      }
    };
    const entry = hook(page, 'service-delivery-mode');
    await expect(entry).toHaveAccessibleName(
      locale === 'en' ? 'Service delivery' : 'Prestations'
    );
    await entry.focus();
    await page.keyboard.press('Enter');
    const feature = embeddedFeature(page);
    await expect(feature).toBeVisible();
    await expectStableBounds();
    await expect(
      hook(page, 'content').locator('[data-og7="service-delivery-embedded"]')
    ).toBeVisible();
    await expect(entry).toHaveAttribute('aria-pressed', 'true');
    await expect(hook(page, 'discovery-mode')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(feature.locator('iframe')).toHaveCount(0);
    await expect(
      feature.locator('[data-og7="service-demo-list"]')
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: locale === 'en' ? 'Service delivery' : 'Prestations de services',
        exact: true
      })
    ).toBeVisible();
    await expect(page).toHaveURL(sourceUrl);
    await expectStableBounds();
    expect(await main!.evaluate((node) => node.isConnected)).toBe(true);
    if (locale === 'en' && width === 390) {
      const audit = await new AxeBuilder({ page })
        .include('[data-og7="admin-guidance"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
    if (locale === 'fr-CA' && width === 1440) {
      const search = feature.locator('[data-og7="service-demo-search"]');
      await search.fill('Boréal');
      await expect(
        feature.locator('[data-og7="service-demo-open-dossier"]')
      ).toHaveCount(1);
      await expect(page).toHaveURL(sourceUrl);
      await search.fill('');
      await feature
        .locator('[data-og7="service-demo-filter"][data-og7-id="contenu"]')
        .click();
      await expect(
        feature.locator('[data-og7="service-demo-open-dossier"]')
      ).toHaveCount(1);
      await expect(page).toHaveURL(sourceUrl);
    }
    await feature
      .locator(
        '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
      )
      .click();
    await expect(feature.locator('[data-og7="service-demo-list"]')).toHaveCount(
      0
    );
    await expect(
      feature.locator('[data-og7="service-demo-dossier"]')
    ).toBeVisible();
    await expect(page).toHaveURL(sourceUrl);
    await feature
      .getByRole('link')
      .filter({
        has: page.getByRole('heading', {
          name:
            locale === 'en'
              ? 'Website presentation'
              : 'Présentation sur le site',
          exact: true
        })
      })
      .click();
    await expect(
      page.locator('[data-og7="service-demo-detail"][data-og7-id="web"]')
    ).toBeVisible();
    await expect(page).toHaveURL(sourceUrl);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name:
          locale === 'en' ? 'Website presentation' : 'Présentation sur le site',
        exact: true
      })
    ).toBeVisible();
    expect(await main!.evaluate((node) => node.isConnected)).toBe(true);
    expect(
      await feature.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
    await expectStableBounds();
    const back = feature.locator('[data-og7="service-demo-exit"]');
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(feature).toBeHidden();
    await expect(page).toHaveURL(sourceUrl);
    await expect(hook(page, 'panel')).toBeVisible();
    await expect(hook(page, 'discovery-mode')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expectDiscoveryHub(page);
    await expect(hook(page, 'discovery-mode')).toBeFocused();
    await expectStableBounds();
    expect(f.mutations).toEqual([]);
  });
}

function embeddedFeature(page: Page): Locator {
  return page.locator('[data-og7="service-delivery-embedded"]');
}

async function openEmbeddedDelivery(page: Page, path = dashboardPath) {
  await page.goto(path);
  await hook(page, 'toggle').click();
  await hook(page, 'service-delivery-mode').click();
  await expect(embeddedFeature(page)).toBeVisible();
  await expect(page.locator('[data-og7="service-demo-list"]')).toBeVisible();
}

async function openEmbeddedEditor(page: Page) {
  await embeddedFeature(page)
    .locator(
      '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
    )
    .click();
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
    .click();
  await embeddedFeature(page)
    .getByRole('link', { name: 'Corriger le contenu', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toBeVisible();
}

async function freezeTourTime(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

async function settleTourView(page: Page) {
  // Angular schedules nested render effects after navigation and input changes.
  await page.clock.runFor(50);
}

const serviceTourScreens = [
  'dossier',
  'accord',
  'web',
  'confirmer-visibilite',
  'accord',
  'contenu',
  'corriger/texte',
  'corriger/image',
  'corriger/liens',
  'corriger/mentions',
  'corriger/options',
  'apercu',
  'approuver-preparation',
  'autorisation',
  'demander-accord',
  'apercu-envoi',
  'accord-recu',
  'conditions',
  'contact',
  'confirmer-autorisation',
  'publication',
  'planifier',
  'confirmer-envoi',
  'resultat',
  'preuves',
  'historique'
];

async function expectTourScreen(page: Page, screen: string) {
  const feature = embeddedFeature(page);
  if (screen.startsWith('corriger/')) {
    await expect(
      feature.locator('[data-og7="service-demo-editor"]')
    ).toBeVisible();
    await expect(
      feature.locator(
        `[data-og7="service-demo-editor-tab"][data-og7-id="${screen.split('/')[1]}"]`
      )
    ).toHaveAttribute('aria-current', 'page');
  } else if (
    [
      'dossier',
      'contenu',
      'autorisation',
      'publication',
      'historique'
    ].includes(screen)
  ) {
    await expect(
      feature.locator(
        `[data-og7="service-demo-${screen === 'historique' ? 'history' : screen}"]`
      )
    ).toBeVisible();
  } else {
    await expect(
      feature.locator(
        `[data-og7="service-demo-detail"][data-og7-id="${screen}"]`
      )
    ).toBeVisible();
  }
}

if (!SERVICE_DELIVERY_TOUR_ENABLED) {
  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`the disabled service tour leaves manual browsing usable in ${language} at ${width}px`, async ({
      page
    }) => {
      const f = await fixtures(page, language);
      await page.setViewportSize({ width, height: 864 });
      await page.clock.install();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(dashboardPath);
      const sourceUrl = page.url();
      await hook(page, 'toggle').click();
      await expectDiscoveryHub(page);
      for (const control of ['play', 'pause', 'stop']) {
        await expect(hook(page, 'tour-' + control)).toBeHidden();
        await expect(hook(page, 'tour-' + control)).toBeDisabled();
      }
      // Synthetic activation also respects the disabled feature gate.
      await hook(page, 'tour-play').dispatchEvent('click');
      await expect(hook(page, 'service-delivery-mode')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      await expect(embeddedFeature(page)).toHaveCount(0);
      await hook(page, 'service-delivery-mode').click();
      const feature = embeddedFeature(page);
      await expect(feature).toBeVisible();
      await expect(
        feature.locator('[data-og7="service-demo-list"]')
      ).toBeVisible();
      await freezeTourTime(page);
      await feature
        .locator(
          '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
        )
        .click();
      await settleTourView(page);
      await expectTourScreen(page, 'dossier');
      await feature
        .locator('a[href="/demo/prestations/dossier/atelier-boreal/accord"]')
        .click();
      await settleTourView(page);
      await expectTourScreen(page, 'accord');
      const web = feature.locator(
        '[data-og7="service-demo-promised-service"][data-og7-id="web"]'
      );
      await web.focus();
      await page.keyboard.press('Enter');
      await settleTourView(page);
      await expectTourScreen(page, 'web');
      for (const control of ['play', 'pause', 'stop']) {
        await expect(hook(page, 'tour-' + control)).toBeHidden();
        await expect(hook(page, 'tour-' + control)).toBeDisabled();
        await hook(page, 'tour-' + control).dispatchEvent('click');
      }
      await settleTourView(page);
      await page.clock.fastForward(60_000);
      await settleTourView(page);
      await expectTourScreen(page, 'web');
      await expect(hook(page, 'tour-status')).toHaveAttribute(
        'data-og7-state',
        'stopped'
      );
      await expect(page).toHaveURL(sourceUrl);
      expect(f.mutations).toEqual([]);
    });
  }
}

// Retain playback coverage for reactivation through the same product feature gate.
if (SERVICE_DELIVERY_TOUR_ENABLED) {
  // Built UI and synthetic dossiers only: playback never starts an API or provider.
  test('Play loads service delivery from discovery without changing the administrative URL', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.goto(`${dashboardPath}?contributionId=${paymentId}#guided-tour`);
    const sourceUrl = page.url();
    await hook(page, 'toggle').click();
    await expectDiscoveryHub(page);
    await expect(embeddedFeature(page)).toHaveCount(0);
    await hook(page, 'tour-play').focus();
    await page.keyboard.press('Enter');
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'running'
    );
    await expect(hook(page, 'tour-play')).toBeDisabled();
    await expect(hook(page, 'tour-pause')).toBeEnabled();
    await expect(page).toHaveURL(sourceUrl);
    expect(f.mutations).toEqual([]);
  });

  test('the service tour waits twenty seconds, preserves the remaining pause time and stops at the end', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEmbeddedDelivery(page);
    await hook(page, 'discovery-mode').click();
    await freezeTourTime(page);
    const sourceUrl = page.url();
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await hook(page, 'tour-pause').focus();
    await page.clock.fastForward(19_000);
    await expectTourScreen(page, 'dossier');
    await page.clock.fastForward(1000);
    await settleTourView(page);
    await expectTourScreen(page, 'accord');
    await expect(hook(page, 'tour-pause')).toBeFocused();

    await page.clock.fastForward(7000);
    await hook(page, 'tour-pause').click();
    await settleTourView(page);
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await expect(hook(page, 'tour-pause')).toBeDisabled();
    await page.clock.fastForward(40_000);
    await expectTourScreen(page, 'accord');
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expect(hook(page, 'tour-play')).toBeDisabled();
    await page.clock.fastForward(12_500);
    await expectTourScreen(page, 'accord');
    await page.clock.fastForward(600);
    await settleTourView(page);
    await expectTourScreen(page, 'web');

    await hook(page, 'tour-stop').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'stopped'
    );
    await page.clock.fastForward(40_000);
    await expectTourScreen(page, 'dossier');

    const promisedServiceClicks = await page.evaluateHandle(() => {
      const clicks: string[] = [];
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const service = target.closest<HTMLAnchorElement>(
            'a[data-og7="service-demo-promised-service"]'
          );
          const id = service?.getAttribute('data-og7-id');
          if (id) clicks.push(id);
        },
        true
      );
      return clicks;
    });
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    for (const screen of serviceTourScreens.slice(1)) {
      await page.clock.fastForward(20_000);
      await settleTourView(page);
      await expectTourScreen(page, screen);
      await expect(hook(page, 'tour-status')).toHaveAttribute(
        'data-og7-state',
        'running'
      );
    }
    await page.clock.fastForward(20_000);
    await settleTourView(page);
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'completed'
    );
    await expect(hook(page, 'tour-play')).toBeEnabled();
    await expect(hook(page, 'tour-pause')).toBeDisabled();
    await page.clock.fastForward(60_000);
    await expectTourScreen(page, 'historique');
    expect(await promisedServiceClicks.jsonValue()).toEqual([
      'web',
      'facebook'
    ]);
    await promisedServiceClicks.dispose();
    await expect(page).toHaveURL(sourceUrl);
    expect(f.mutations).toEqual([]);
  });

  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`promised service links open from the keyboard and pause the tour in ${language} at ${width}px`, async ({
      page
    }) => {
      const f = await fixtures(page, language);
      await page.setViewportSize({ width, height: 864 });
      await page.clock.install();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openEmbeddedDelivery(page);
      await freezeTourTime(page);
      const sourceUrl = page.url();
      await hook(page, 'tour-play').click();
      await settleTourView(page);
      await page.clock.fastForward(20_000);
      await settleTourView(page);
      await expectTourScreen(page, 'accord');

      for (const [id, screen] of [
        ['web', 'web'],
        ['facebook', 'contenu']
      ] as const) {
        const service = embeddedFeature(page).locator(
          `a[data-og7="service-demo-promised-service"][data-og7-id="${id}"]`
        );
        await expect(service).toHaveAttribute(
          'href',
          `/demo/prestations/dossier/atelier-boreal/${screen}`
        );
        await expect(service).toHaveAccessibleName(/\S/);
        await service.focus();
        await page.keyboard.press('Enter');
        await settleTourView(page);
        await expectTourScreen(page, screen);
        await expect(hook(page, 'tour-status')).toHaveAttribute(
          'data-og7-state',
          'paused'
        );
        await page.clock.fastForward(40_000);
        await expectTourScreen(page, screen);
        await hook(page, 'tour-play').click();
        await settleTourView(page);
        await expectTourScreen(page, 'accord');
        await expect(hook(page, 'tour-status')).toHaveAttribute(
          'data-og7-state',
          'running'
        );
      }

      await expect(page).toHaveURL(sourceUrl);
      expect(f.mutations).toEqual([]);
    });
  }

  test('the service tour pauses when a promised service link is unavailable', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEmbeddedDelivery(page);
    await freezeTourTime(page);
    const sourceUrl = page.url();
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await page.clock.fastForward(20_000);
    await settleTourView(page);
    await expectTourScreen(page, 'accord');
    await embeddedFeature(page)
      .locator('[data-og7="service-demo-promised-service"][data-og7-id="web"]')
      .evaluate((link) => link.remove());
    await page.clock.fastForward(20_000);
    await settleTourView(page);
    await expectTourScreen(page, 'accord');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await page.clock.fastForward(60_000);
    await settleTourView(page);
    await expectTourScreen(page, 'accord');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await expect(page).toHaveURL(sourceUrl);
    expect(f.mutations).toEqual([]);
  });

  test('hiding the guide and navigating service screens pause the tour without discarding local work', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEmbeddedDelivery(page);
    await freezeTourTime(page);
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await hook(page, 'toggle').click();
    await settleTourView(page);
    await page.clock.fastForward(40_000);
    await hook(page, 'toggle').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );

    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await hook(page, 'discovery-mode').click();
    await settleTourView(page);
    await page.clock.fastForward(40_000);
    await hook(page, 'service-delivery-mode').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );

    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await embeddedFeature(page)
      .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
      .click();
    await settleTourView(page);
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await embeddedFeature(page)
      .getByRole('link', { name: 'Corriger le contenu', exact: true })
      .click();
    await settleTourView(page);
    const editor = embeddedFeature(page).locator(
      '[data-og7="service-demo-editor-text"]'
    );
    const draft = 'Ce brouillon reste disponible pendant une visite en pause.';
    await editor.fill(draft);
    await settleTourView(page);
    await page.clock.fastForward(60_000);
    await expect(editor).toHaveValue(draft);
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await expect(page).toHaveURL(dashboardPath);
    expect(f.mutations).toEqual([]);
  });

  test('Play selects the first synthetic dossier and Stop resets its complete tour', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEmbeddedDelivery(page);
    const feature = embeddedFeature(page);
    await feature
      .locator(
        '[data-og7="service-demo-open-dossier"][data-og7-id="collectif-rivages"]'
      )
      .click();
    await freezeTourTime(page);
    const selectDossier = async (id: string) => {
      await feature
        .getByRole('link', { name: 'Prestations de services', exact: true })
        .click();
      await settleTourView(page);
      await feature
        .locator(`[data-og7="service-demo-open-dossier"][data-og7-id="${id}"]`)
        .click();
      await settleTourView(page);
    };
    const expectFirstDossier = async () => {
      await expect(
        feature.getByRole('link', { name: 'Atelier Boréal', exact: true })
      ).toBeVisible();
    };
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expectFirstDossier();
    await page.clock.fastForward(20_000);
    await settleTourView(page);
    await expectTourScreen(page, 'accord');
    await selectDossier('studio-canopée');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expectTourScreen(page, 'accord');
    await expectFirstDossier();
    await selectDossier('collectif-rivages');
    await hook(page, 'tour-stop').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expectFirstDossier();
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'stopped'
    );
    await selectDossier('studio-canopée');
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expectFirstDossier();
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'running'
    );
    await expect(page).toHaveURL(dashboardPath);
    expect(f.mutations).toEqual([]);
  });

  test('a modal and a hidden browser tab pause service playback until Play is requested again', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEmbeddedDelivery(page);
    await freezeTourTime(page);
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await page.locator('[data-og7="admin-search-open"]').click();
    await settleTourView(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await page.clock.fastForward(40_000);
    await page.keyboard.press('Escape');
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await hook(page, 'tour-play').click();
    await settleTourView(page);
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'running'
    );
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settleTourView(page);
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    await page.clock.fastForward(40_000);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settleTourView(page);
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'paused'
    );
    expect(f.mutations).toEqual([]);
  });

  test('revoking the session cancels a running service tour before another account signs in', async ({
    page
  }) => {
    const f = await fixtures(page);
    await page.clock.install();
    await openEmbeddedDelivery(page);
    await hook(page, 'tour-play').click();
    await expectTourScreen(page, 'dossier');
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'running'
    );
    f.signedIn = false;
    await page.route('**/api/admin/dashboard', (route) =>
      route.fulfill({ status: 401, json: {} })
    );
    await page.locator('[data-og7="dashboard-refresh"]').click();
    await expect(page).toHaveURL(/\/admin\/login\?/);
    await expect(embeddedFeature(page)).toHaveCount(0);
    await expect(hook(page, 'tour-play')).toHaveCount(0);
    await page.clock.fastForward(60_000);
    f.signedIn = true;
    f.accountId = 'guidance-tour-owner-b';
    await page.unroute('**/api/admin/dashboard');
    await page.goto(dashboardPath);
    await hook(page, 'toggle').click();
    await expect(hook(page, 'tour-status')).toHaveAttribute(
      'data-og7-state',
      'stopped'
    );
    await expect(embeddedFeature(page)).toHaveCount(0);
    await expect(hook(page, 'tour-pause')).toBeDisabled();
    expect(f.mutations).toEqual([]);
  });
}

test('the embedded draft survives discovery and guide collapse without intercepting save outside the feature', async ({
  page
}) => {
  const f = await fixtures(page);
  await openEmbeddedDelivery(page);
  await openEmbeddedEditor(page);
  const feature = embeddedFeature(page);
  const editor = feature.locator('[data-og7="service-demo-editor-text"]');
  const draft = 'Brouillon local conservé dans le guide administratif.';
  await editor.fill(draft);
  const originalEditor = await editor.elementHandle();
  expect(originalEditor).not.toBeNull();
  const saveOutside = async () => {
    const background = page.locator('#admin-main');
    await background.focus();
    return background.evaluate((element) => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  };
  expect(await saveOutside()).toBe(false);

  await hook(page, 'discovery-mode').click();
  await expectDiscoveryHub(page);
  await expect(hook(page, 'discovery-mode')).toBeFocused();
  await expect(feature).toBeHidden();
  expect(await originalEditor!.evaluate((node) => node.isConnected)).toBe(true);
  await hook(page, 'service-delivery-mode').click();
  await expect(editor).toHaveValue(draft);
  await hook(page, 'toggle').click();
  await expect(feature).toBeHidden();
  expect(await originalEditor!.evaluate((node) => node.isConnected)).toBe(true);

  expect(await saveOutside()).toBe(false);
  await hook(page, 'toggle').click();
  await hook(page, 'service-delivery-mode').click();
  await expect(editor).toHaveValue(draft);
  await expect(
    feature.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeHidden();
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(
    feature.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeVisible();

  await feature.locator('[data-og7="service-demo-exit"]').click();
  await expectDiscoveryHub(page);
  await expect(hook(page, 'discovery-mode')).toBeFocused();
  await expect(feature).toBeHidden();
  await hook(page, 'service-delivery-mode').click();
  await expect(editor).toHaveValue(draft);
  expect(await originalEditor!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page).toHaveURL(dashboardPath);
  expect(f.mutations).toEqual([]);
});

test('a collapsed embedded draft still warns before a browser reload', async ({
  page
}) => {
  const f = await fixtures(page);
  await openEmbeddedDelivery(page);
  await openEmbeddedEditor(page);
  const editor = page.locator('[data-og7="service-demo-editor-text"]');
  const draft =
    'Ne pas perdre ce brouillon en rechargeant la page administrative.';
  await editor.fill(draft);
  await hook(page, 'toggle').click();
  const nativeDialog = page.waitForEvent('dialog');
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await nativeDialog;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await hook(page, 'toggle').click();
  await hook(page, 'service-delivery-mode').click();
  await expect(editor).toHaveValue(draft);
  await expect(page).toHaveURL(dashboardPath);
  expect(f.mutations).toEqual([]);
});

test('administrative navigation protects an embedded draft and clears it only after confirmed departure', async ({
  page
}) => {
  const f = await fixtures(page);
  await openEmbeddedDelivery(page);
  await openEmbeddedEditor(page);
  const editor = page.locator('[data-og7="service-demo-editor-text"]');
  const draft = 'Le changement de rubrique exige une confirmation de perte.';
  await editor.fill(draft);
  await hook(page, 'toggle').click();
  const destination = page.locator(`a[href="${attentionPath}"]`).first();
  await destination.click();
  const confirmation = page.getByRole('dialog', {
    name: 'Quitter la démo ?',
    exact: true
  });
  await expect(confirmation).toBeVisible();
  await expect(embeddedFeature(page)).toBeVisible();
  await expect(confirmation).toContainText('Atelier Boréal');
  await expect(page).toHaveURL(dashboardPath);
  await confirmation.locator('[data-og7="service-demo-exit-stay"]').click();
  await expect(confirmation).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(draft);
  await hook(page, 'toggle').click();
  await destination.click();
  await expect(confirmation).toBeVisible();
  await confirmation.locator('[data-og7="service-demo-exit-confirm"]').click();
  await expect(page).toHaveURL(attentionPath);
  await expect(embeddedFeature(page)).toHaveCount(0);
  if (!(await hook(page, 'panel').isVisible()))
    await hook(page, 'toggle').click();
  await hook(page, 'service-delivery-mode').click();
  await expect(page.locator('[data-og7="service-demo-list"]')).toBeVisible();
  await expect(
    page.locator('[data-og7="service-demo-draft-badge"]')
  ).toHaveCount(0);
  await openEmbeddedEditor(page);
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).not.toHaveValue(draft);
  expect(f.mutations).toEqual([]);
});

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

function automaticHook(page: Page, name: string) {
  return page.locator(`[data-og7="automatic-${name}"]`);
}

async function openAutomatic(page: Page) {
  await expect(hook(page, 'toggle')).toBeVisible();
  if (new URL(page.url()).searchParams.has('paymentJourney'))
    await expect(hook(page, 'panel')).toBeVisible();
  else if (!(await hook(page, 'panel').isVisible()))
    await hook(page, 'toggle').click();
  // The payment link has already restored its bookmark. The next load exercises
  // the retained preparation preference rather than following that link again.
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.delete('paymentJourney');
    history.replaceState(history.state, '', url);
  });
  await restoreLegacyGuideMode(page, 'automatic');
  await page
    .locator('[data-og7="automatic-view"][data-og7-id="other"]')
    .click();
  await expect(automaticHook(page, 'scope')).toBeVisible();
}

test('preparation view navigation keeps the chosen workspace and its pending human step without a business write', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await openAutomatic(page);
  const scope = automaticHook(page, 'scope');
  await scope.selectOption('attention');
  await expect(scope).toHaveValue('attention');
  await automaticHook(page, 'start').click();
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  await expect(page).toHaveURL(attentionPath);
  await expect(scope).toHaveValue('attention');
  const pendingStep = await automaticHook(page, 'state').textContent();
  const form = (await scope.elementHandle())!;
  const paymentReads = fixture.paymentRequests.length;
  for (const view of ['records', 'batch', 'other']) {
    const navigation = page.locator(
      `[data-og7="automatic-view"][data-og7-id="${view}"]`
    );
    await navigation.click();
    await expect(navigation).toHaveAttribute('aria-pressed', 'true');
    await expect(scope).toHaveValue('attention');
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'awaiting_confirmation'
    );
    await expect(automaticHook(page, 'state')).toHaveText(pendingStep!);
    expect(fixture.mutations).toEqual([]);
    expect(fixture.paymentRequests).toHaveLength(paymentReads);
  }
  await expect(scope).toBeVisible();
  await expect(automaticHook(page, 'human-step')).toBeVisible();
  expect(
    await form.evaluate(
      (element) =>
        element.isConnected &&
        element ===
          element.ownerDocument.querySelector('[data-og7="automatic-scope"]')
    )
  ).toBe(true);
  await form.dispose();
});

test('a targeted preparation completed behind records keeps focus and requires a manual landmark reveal after returning', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const originalUrl = `${attentionPath}?contributionId=${paymentId}`;
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('stripe_failed', originalUrl, 'attention-panel')
  );
  await page.goto(`${originalUrl}&paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  let release!: () => void;
  fixture.paymentGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads = fixture.paymentRequests.length;
  await automaticHook(page, 'start').click();
  await expect
    .poll(() => fixture.paymentRequests.length)
    .toBeGreaterThan(reads);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'reading'
  );
  const records = page.locator(
    '[data-og7="automatic-view"][data-og7-id="records"]'
  );
  await records.click();
  release();
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  await expect(records).toHaveAttribute('aria-pressed', 'true');
  await expect(records).toBeFocused();
  await expect(page.locator('[data-og7="admin-automatic"]')).toBeHidden();
  await expect(page.locator(highlighted)).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  expect(fixture.mutations).toEqual([]);

  const other = page.locator(
    '[data-og7="automatic-view"][data-og7-id="other"]'
  );
  await other.click();
  await expect(automaticHook(page, 'human-step')).toBeVisible();
  await expect(other).toBeFocused();
  await expect(page.locator(highlighted)).toHaveCount(0);
  await automaticHook(page, 'show').click();
  await expect(page.locator('[data-og7="attention-panel"]')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  expect(fixture.mutations).toEqual([]);
});

function pendingAutomaticJourney(
  reason: string,
  adminUrl: string,
  target?: string
): AdminPaymentJourney {
  const next = { reason, adminUrl, ...(target ? { target } : {}) };
  return {
    ...paymentJourney(),
    contributionType: 'sponsorship_interest',
    state: 'action_required',
    completed: 1,
    total: 2,
    steps: [
      ...paymentJourney().steps,
      { id: 'obligation', state: 'error', ...next }
    ],
    next
  };
}

async function automaticInvoiceFixture(page: Page, gate?: Promise<void>) {
  await page.route(
    (url) => url.pathname === '/api/admin/sponsorship-invoices',
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (gate) await gate;
      return route.fulfill({
        json: {
          data_source: 'database',
          invoices: [],
          summary: {
            total_count: 0,
            total_amount: 0,
            credit_note_count: 0,
            total_credited: 0,
            failed_email_count: 0,
            currency: 'CAD'
          },
          last_updated_at: generatedAt
        }
      });
    }
  );
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
  await restoreLegacyGuideMode(page, 'payment');
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
  await restoreLegacyGuideMode(page, 'payment');
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

async function expectDiscoveryHub(page: Page) {
  await expect(hook(page, 'discovery-mode')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const content = hook(page, 'content');
  await expect(content).toBeVisible();
  await expect(
    content.locator('[data-og7="activity-hub-embedded"]')
  ).toBeVisible();
  await expect(content.locator('[data-og7="activity-hub"]')).toBeVisible();
  await expect(hook(page, 'page')).toHaveCount(0);
  await expect(page.locator(highlighted)).toHaveCount(0);
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
  // Compare both colours in 8-bit sRGB, including the darker mineral gold.
  const rgba = (colour: string) => {
    if (
      !CSS.supports('color', colour) ||
      /^(currentcolor|inherit|initial|unset|revert(?:-layer)?)$/i.test(colour)
    )
      return null;
    // Canvas ignores unsupported assignments. Two sentinels prevent an invalid
    // token from accidentally reusing the previous colour.
    context.fillStyle = '#000000';
    context.fillStyle = colour;
    const parsed = context.fillStyle;
    context.fillStyle = '#ffffff';
    context.fillStyle = colour;
    if (context.fillStyle !== parsed) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  };
  const gold = style.getPropertyValue('--admin-gold').trim() || '#f4c957';
  const expected = rgba(gold);
  const actual = rgba(style.outlineColor);
  return {
    outlineColor: style.outlineColor,
    outlineRgba: actual,
    gold,
    goldRgba: expected,
    outlined:
      style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
    golden:
      !!expected &&
      !!actual &&
      expected[3] === 255 &&
      expected[0] > expected[1] &&
      expected[1] > expected[2] &&
      actual.every((channel, index) => channel === expected[index]),
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
  for (const palette of [
    {
      token: '',
      rgba: [244, 201, 87, 255],
      colours: [
        'rgb(244, 201, 87)',
        'color(srgb 0.9568627451 0.7882352941 0.3411764706)'
      ]
    },
    {
      token: '#8e5c10',
      rgba: [142, 92, 16, 255],
      colours: [
        'rgb(142, 92, 16)',
        'color(srgb 0.5568627451 0.3607843137 0.0627450980)'
      ]
    },
    {
      token: '#f1ce80',
      rgba: [241, 206, 128, 255],
      colours: [
        'rgb(241, 206, 128)',
        'color(srgb 0.9450980392 0.8078431373 0.5019607843)'
      ]
    }
  ]) {
    await zone.evaluate((element, token) => {
      (element as HTMLElement).style.setProperty('--admin-gold', token);
    }, palette.token);
    for (const colour of palette.colours) {
      await zone.evaluate((element, value) => {
        (element as HTMLElement).style.outlineColor = value;
      }, colour);
      await expectGoldenZone(zone);
      expect(await zone.evaluate(readGuidanceDecoration)).toMatchObject({
        outlineRgba: palette.rgba,
        goldRgba: palette.rgba
      });
    }
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
  for (const { token, outline } of [
    { token: '#8e5c10', outline: 'rgb(244, 201, 87)' },
    { token: 'not-a-colour', outline: 'rgb(244, 201, 87)' },
    { token: 'blue', outline: 'blue' },
    { token: 'transparent', outline: 'transparent' },
    { token: 'rgb(244 201 87 / 0.5)', outline: 'rgb(244 201 87 / 0.5)' }
  ]) {
    await zone.evaluate(
      (element, { token, outline }) => {
        const style = (element as HTMLElement).style;
        style.setProperty('--admin-gold', token);
        style.outlineColor = outline;
      },
      { token, outline }
    );
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

test('discovery opens from the keyboard with a local activity workspace and no automatic focus transfer', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  const toggle = hook(page, 'toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(hook(page, 'panel')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expectDiscoveryHub(page);
  await expect(toggle).toBeFocused();
  const discovery = hook(page, 'discovery-mode');
  await discovery.focus();
  await page.keyboard.press('Enter');
  await expectDiscoveryHub(page);
  await sampledFrames(page);
  await expect(discovery).toBeFocused();
  expect(fixture.paymentRequests).toEqual([]);
  expect(fixture.mutations).toEqual([]);
});

test('legacy paused discovery preferences remain inert across navigation and reload', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const retained = {
    enabled: true,
    bookmark: { pageId: 'attention', step: 1, paused: true }
  };
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storagePrefix + fixture.accountId, value: retained }
  );
  await page.goto(
    dashboardPath + '?itemId=synthetic-private-dossier#synthetic'
  );
  await expectDiscoveryHub(page);
  await navigate(page, attentionPath);
  await expectDiscoveryHub(page);
  await hook(page, 'discovery-mode').focus();
  await page.keyboard.press('Enter');
  await sampledFrames(page);
  await expect(hook(page, 'discovery-mode')).toBeFocused();
  expect(await stored(page)).toEqual(retained);
  await page.reload();
  await expectDiscoveryHub(page);
  await expect(page).toHaveURL(attentionPath);
  expect(await stored(page)).toEqual(retained);
  expect(fixture.paymentRequests).toEqual([]);
  expect(fixture.mutations).toEqual([]);
});

test('collapsing discovery preserves preferences and stays collapsed after reload', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await expectDiscoveryHub(page);
  const retained = (await stored(page)).bookmark;
  await hook(page, 'toggle').click();
  await expect(hook(page, 'panel')).toBeHidden();
  await page.reload();
  await expect(hook(page, 'panel')).toHaveCount(0);
  expect(await stored(page)).toEqual({ enabled: false, bookmark: retained });
  await hook(page, 'toggle').click();
  await expectDiscoveryHub(page);
  expect((await stored(page)).bookmark).toEqual(retained);
});

test('discovery preferences remain isolated between signed-in accounts', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          enabled: true,
          bookmark: { pageId: 'attention', step: 1, paused: true }
        })
      ),
    storagePrefix + fixture.accountId
  );
  await page.goto(dashboardPath);
  await expectDiscoveryHub(page);
  const retained = await stored(page);
  fixture.accountId = 'guidance-owner-b';
  await page.reload();
  await expect(hook(page, 'toggle')).toBeVisible();
  await expect(hook(page, 'panel')).toHaveCount(0);
  await hook(page, 'toggle').click();
  await expectDiscoveryHub(page);
  expect((await stored(page, fixture.accountId)).enabled).toBe(true);
  expect(await stored(page)).toEqual(retained);
  fixture.accountId = 'guidance-owner-a';
  await page.reload();
  await expectDiscoveryHub(page);
  expect(await stored(page)).toEqual(retained);
  expect(fixture.mutations).toEqual([]);
});

test('blocked persistence leaves discovery usable during in-app navigation', async ({
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
  await expectDiscoveryHub(page);
  await navigate(page, attentionPath);
  await expectDiscoveryHub(page);
  expect(fixture.paymentRequests).toEqual([]);
  expect(fixture.mutations).toEqual([]);
});

test('a retained payment mode keeps its storage warning after a refused write and discovery keeps the local activity hub', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await restoreLegacyGuideMode(page, 'payment');
  await page.evaluate((prefix) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith(prefix))
        throw new DOMException('Blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  }, storagePrefix);
  await hook(page, 'toggle').click();
  await expect(hook(page, 'panel')).toBeHidden();
  await hook(page, 'toggle').click();
  await expect(hook(page, 'storage-warning')).toBeVisible();
  await hook(page, 'discovery-mode').click();
  await expectDiscoveryHub(page);
  expect(fixture.paymentRequests).toEqual([]);
  expect(fixture.mutations).toEqual([]);
});

test('failed erasure from another mode remains disclosed outside the discovery workspace panel', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await restoreLegacyGuideMode(page, 'payment');
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
  await hook(page, 'toggle').click();
  await expectDiscoveryHub(page);
  expect(fixture.mutations).toEqual([]);
});

test('revoking a session removes the discovery workspace panel before another account signs in', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(dashboardPath);
  await hook(page, 'toggle').click();
  await expectDiscoveryHub(page);
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
  expect(await stored(page, fixture.accountId)).toBeNull();
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
  test(
    'invalid guidance state opens only a discovery workspace panel: ' + name,
    async ({ page }) => {
      await fixtures(page);
      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: storagePrefix + 'guidance-owner-a', value: invalid }
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(dashboardPath);
      await expect(hook(page, 'panel')).toHaveCount(0);
      await hook(page, 'toggle').click();
      await expectDiscoveryHub(page);
      expect((await stored(page)).enabled).toBe(true);
      expect(errors).toEqual([]);
    }
  );
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [1440, 320]) {
    test(
      'discovery workspace remains keyboard accessible in ' +
        language +
        ' at ' +
        width +
        'px',
      async ({ page }) => {
        const fixture = await fixtures(page, language);
        await page.setViewportSize({ width, height: 480 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(dashboardPath);
        await hook(page, 'toggle').click();
        await expectDiscoveryHub(page);
        const discovery = hook(page, 'discovery-mode');
        await discovery.focus();
        await page.keyboard.press('Enter');
        await expect(discovery).toBeFocused();
        await expect(discovery).toBeInViewport({ ratio: 0.98 });
        const audit = await new AxeBuilder({ page })
          .include('[data-og7="admin-guidance-panel"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(audit.violations).toEqual([]);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
          .toBe(true);
        expect(fixture.mutations).toEqual([]);
      }
    );
  }
}

for (const width of [1440, 320]) {
  test(
    'discovery workspace keeps its floating shell and finite entrance at ' +
      width +
      'px',
    async ({ page }) => {
      const fixture = await fixtures(page);
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 480 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(dashboardPath);
      await hook(page, 'toggle').click();
      await expectDiscoveryHub(page);
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
      const retained = await stored(page);
      await hook(page, 'move').click();
      await expect(card).toHaveAttribute('data-og7-placement', 'bottom');
      await expectDiscoveryHub(page);
      expect(await stored(page)).toEqual(retained);
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
      await expectDiscoveryHub(page);
      expect(fixture.mutations).toEqual([]);
    }
  );
}

test('discovery workspace remains available in Pilotage concentration without revealing a landmark', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await installAdminController(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(dashboardPath + '/pilotage');
  const controller = adminController(page);
  await controller.ready();
  // Pilotage owns navigation until the shared guide is explicitly selected.
  await hook(page, 'toggle').click();
  await expectDiscoveryHub(page);
  const retained = (await stored(page)).bookmark;
  await controller.activate(hook(page, 'toggle'));
  const concentration = page.locator('[data-og7="pilot-focus"]');
  await concentration.click();
  await expect(concentration).toHaveAttribute('aria-pressed', 'true');
  // Select the shared guide before using its global controller shortcut.
  await hook(page, 'toggle').focus();
  await controller.release();
  await controller.press('Y');
  await expectDiscoveryHub(page);
  await expect(hook(page, 'toggle')).toBeFocused();
  expect((await stored(page)).bookmark).toEqual(retained);
  await controller.press('B');
  await expect(hook(page, 'panel')).toBeHidden();
  await expect(concentration).toHaveAttribute('aria-pressed', 'true');
  expect(fixture.mutations).toEqual([]);
});

test('the golden pulse for a payment is gentle, finishes, and stops immediately for reduced motion', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('stripe_failed', dashboardPath, 'cockpit-metrics')
  );
  await page.goto(dashboardPath + '?paymentJourney=' + paymentId);
  await paymentHook(page, 'show').click();
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
  await paymentHook(page, 'show').click();
  await expect
    .poll(() => zone.evaluate((element) => element.getAnimations().length))
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => zone.evaluate((element) => element.getAnimations().length))
    .toBe(0);
  await expectGoldenZone(zone);
  await hook(page, 'discovery-mode').click();
  await expectDiscoveryHub(page);
  await expect(page.locator(highlighted)).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('all visible repeated payment zones are highlighted without selecting a dossier and their styles are restored', async ({
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
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney(
      'stripe_failed',
      dashboardPath + '/contributions',
      'contribution-row'
    )
  );
  await page.goto(dashboardPath + '/contributions?paymentJourney=' + paymentId);
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
  await paymentHook(page, 'show').click();
  await expect(page.locator(highlighted)).toHaveCount(2);
  await expectGoldenZone(rows.nth(0));
  await expectGoldenZone(rows.nth(1));
  await expect(rows.nth(2)).not.toHaveAttribute('data-og7-guidance-highlight');
  await expect(rows.nth(0)).toBeFocused();
  await expect(detail).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  await hook(page, 'discovery-mode').click();
  await expectDiscoveryHub(page);
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

test('all protected admin workspaces retain guidance, including unavailable data', async ({
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
    '/sponsors/quality',
    '/campaigns',
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
    await expectDiscoveryHub(page);
  }
  expect(fixture.mutations).toEqual([]);
});

for (const { language, width } of [
  { language: 'fr-CA', width: 1440 },
  { language: 'en', width: 320 }
]) {
  test(`automatic preparation explains its work, offers every admin workspace and stays accessible in ${language} at ${width}px`, async ({
    page
  }) => {
    const fixture = await fixtures(page, language);
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(dashboardPath);
    await openAutomatic(page);
    const panel = page.locator('[data-og7="admin-automatic"]');
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'idle'
    );
    await expect(automaticHook(page, 'history')).toHaveCount(0);
    await expect(automaticHook(page, 'scope').locator('option')).toHaveCount(
      automaticWorkspaces.length + 1
    );
    expect(
      await automaticHook(page, 'scope')
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => option.getAttribute('value'))
        )
    ).toEqual(['payment', ...automaticWorkspaces.map(([id]) => id)]);
    await expect(
      automaticHook(page, 'scope').locator('option[value="payment"]')
    ).toBeDisabled();
    expect(fixture.paymentRequests).toEqual([]);
    await automaticHook(page, 'scope').selectOption('attention');
    await automaticHook(page, 'start').focus();
    await page.keyboard.press('Enter');
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'awaiting_confirmation'
    );
    await expect(page).toHaveURL(attentionPath);
    await expect(automaticHook(page, 'state')).toContainText(
      language === 'en' ? 'Relevant screen:' : 'Écran concerné :'
    );
    await expect(automaticHook(page, 'state')).toContainText(
      language === 'en' ? 'Why:' : 'Pourquoi :'
    );
    await expect(automaticHook(page, 'human-step')).toBeVisible();
    await expect(panel).not.toContainText('admin.automatic.');
    await expect(panel).not.toContainText('admin.guidance.');
    await panel.locator('summary').click();
    await expect(automaticHook(page, 'history')).toContainText(
      language === 'en'
        ? 'Opening the relevant screen'
        : 'Je rejoins l’écran concerné'
    );
    await expect(automaticHook(page, 'history').locator('li')).toHaveCount(5);
    const audit = await new AxeBuilder({ page })
      .include('[data-og7="admin-guidance-panel"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await automaticHook(page, 'pause').focus();
    await page.keyboard.press('Enter');
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'paused'
    );
    expect(fixture.mutations).toEqual([]);
  });
}

for (const [workspaceId, suffix] of automaticWorkspaces) {
  test(`automatic preparation runs in the ${workspaceId} admin workspace without a business write`, async ({
    page
  }) => {
    const fixture = await fixtures(page);
    const path = dashboardPath + suffix;
    await page.goto(path);
    await openAutomatic(page);
    await automaticHook(page, 'scope').selectOption(workspaceId);
    await automaticHook(page, 'start').click();
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'awaiting_confirmation'
    );
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(hook(page, 'automatic-mode')).toHaveCount(0);
    await expect(automaticHook(page, 'human-step')).toBeVisible();
    await expect(
      page.locator('[data-og7="admin-automatic"]')
    ).not.toContainText('admin.automatic.');
    await automaticHook(page, 'pause').focus();
    await expect(automaticHook(page, 'pause')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'paused'
    );
    expect(fixture.mutations).toEqual([]);
  });
}

test('automatic payment preparation follows two current server steps and finishes only after a fresh complete journey', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const firstUrl = `${attentionPath}?contributionId=${paymentId}`;
  const secondUrl = `${dashboardPath}/email-queue?messageId=automatic-email-701`;
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('stripe_failed', firstUrl, 'attention-panel')
  );
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  await automaticHook(page, 'start').click();
  await expect(page).toHaveURL(firstUrl);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  await expect(automaticHook(page, 'complete')).toHaveCount(0);
  await expect(automaticHook(page, 'state')).toContainText('événement Stripe');
  const reads = fixture.paymentRequests.length;
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('email_failed', secondUrl)
  );
  await automaticHook(page, 'verify').click();
  await expect(page).toHaveURL(secondUrl);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  await expect(automaticHook(page, 'state')).toContainText('courriel');
  await expect(automaticHook(page, 'complete')).toHaveCount(0);
  expect(fixture.paymentRequests.length).toBeGreaterThan(reads);
  fixture.journeys.set(paymentId, paymentJourney());
  await automaticHook(page, 'verify').click();
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'complete'
  );
  await expect(automaticHook(page, 'complete')).toBeVisible();
  await expect(automaticHook(page, 'prepare')).toHaveCount(0);
  await expect(page).toHaveURL(secondUrl);
  expect(new Set(fixture.paymentRequests)).toEqual(new Set([paymentId]));
  expect(fixture.mutations).toEqual([]);
});

test('automatic preparation discards a late payment response after pause and never restarts from browser persistence', async ({
  page
}) => {
  const fixture = await fixtures(page);
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney(
      'stripe_failed',
      `${attentionPath}?contributionId=${paymentId}`,
      'attention-panel'
    )
  );
  const originalUrl = dashboardPath;
  await page.goto(`${originalUrl}?paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  let release = () => {};
  fixture.paymentGate = new Promise<void>((resolve) => (release = resolve));
  const reads = fixture.paymentRequests.length;
  await automaticHook(page, 'start').click();
  await expect
    .poll(() => fixture.paymentRequests.length)
    .toBeGreaterThan(reads);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'reading'
  );
  await automaticHook(page, 'pause').click();
  fixture.paymentGate = null;
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'paused'
  );
  await expect(page).toHaveURL(originalUrl);
  const destination = `${dashboardPath}/email-queue?messageId=automatic-email-701`;
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('email_failed', destination)
  );
  await automaticHook(page, 'start').click();
  await expect(page).toHaveURL(destination);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  const lateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/payment-journey'
  );
  release();
  await (await lateResponse).finished();
  await sampledFrames(page);
  await expect(page).toHaveURL(destination);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  await expect(automaticHook(page, 'complete')).toHaveCount(0);
  const retained = await stored(page);
  expect(retained.mode).toBe('automatic');
  expect(retained.payment.contributionId).toBe(paymentId);
  expect(JSON.stringify(retained)).not.toContain('stripe_failed');
  expect(JSON.stringify(retained)).not.toContain('DEMO-PAYMENT');
  await page.reload();
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'idle'
  );
  await expect(automaticHook(page, 'history')).toHaveCount(0);
  await expect(page).toHaveURL(destination);
  fixture.accountId = 'guidance-owner-b';
  await page.reload();
  await expect(hook(page, 'panel')).toHaveCount(0);
  await openAutomatic(page);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'idle'
  );
  await expect(
    automaticHook(page, 'scope').locator('option[value="payment"]')
  ).toBeDisabled();
  expect((await stored(page, fixture.accountId))?.payment).toBeUndefined();
  expect(fixture.mutations).toEqual([]);
});

test('automatic preparation waiting for a late zone cannot reveal it after pause and a new run for the same account', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await automaticInvoiceFixture(page);
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney(
      'invoice_missing',
      `${dashboardPath}/invoices?contributionId=${paymentId}`,
      'automatic-late-invoice-zone'
    )
  );
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  await automaticHook(page, 'start').click();
  await expect(page).toHaveURL(
    `${dashboardPath}/invoices?contributionId=${paymentId}`
  );
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'preparing'
  );
  await automaticHook(page, 'pause').click();
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'paused'
  );
  const destination = `${attentionPath}?contributionId=${paymentId}`;
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('stripe_failed', destination, 'attention-panel')
  );
  await automaticHook(page, 'start').click();
  await expect(page).toHaveURL(destination);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  // A late fixture landmark awakens the old DOM observer after the new run.
  // No application handler or state is invoked by the test.
  await page.evaluate(() => {
    const marker = document.createElement('section');
    marker.setAttribute('data-og7', 'automatic-late-invoice-zone');
    marker.textContent = 'Repère synthétique arrivé après la pause';
    document.getElementById('admin-main')!.append(marker);
  });
  await sampledFrames(page, 6);
  await expect(
    page.locator('[data-og7="automatic-late-invoice-zone"]')
  ).not.toHaveAttribute('data-og7-guidance-highlight', '');
  await expect(
    page.locator('openg7-admin-confirmation dialog[open]')
  ).toHaveCount(0);
  await expect(page).toHaveURL(destination);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  expect(fixture.mutations).toEqual([]);
});

for (const language of ['fr-CA', 'en']) {
  test(`a scheduled publication stays with the platform without another preparation or delivery question in ${language}`, async ({
    page
  }) => {
    const fixture = await fixtures(page, language);
    const destination = `${dashboardPath}/publications/automation?deliveryId=10000000-0000-4000-8000-000000000799`;
    const pending = pendingAutomaticJourney(
      'publication_scheduled',
      destination
    );
    const waiting: AdminPaymentJourney = {
      ...pending,
      state: 'waiting',
      steps: pending.steps.map((step) =>
        step.id === 'obligation'
          ? { ...step, state: 'pending', responsibility: 'platform' }
          : step
      ),
      next: { ...pending.next!, responsibility: 'platform' }
    };
    fixture.journeys.set(paymentId, waiting);
    await page.setViewportSize({
      width: language === 'en' ? 320 : 1440,
      height: 900
    });
    await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
    await expect(paymentHook(page, 'platform-waiting')).toBeVisible();
    await expect(paymentHook(page, 'next')).toHaveAccessibleName(
      language === 'en' ? 'View publication' : 'Voir la publication'
    );
    await openAutomatic(page);
    await automaticHook(page, 'scope').selectOption('payment');
    await automaticHook(page, 'start').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(destination);
    await expect(automaticHook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'waiting'
    );
    await expect(automaticHook(page, 'platform-step')).toContainText(
      language === 'en' ? 'platform handles' : 'plateforme prend en charge'
    );
    await expect(automaticHook(page, 'human-step')).toHaveCount(0);
    await expect(automaticHook(page, 'prepare')).toHaveCount(0);
    await expect(automaticHook(page, 'complete')).toHaveCount(0);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    for (const reason of [
      'publication_publishing',
      'publication_retry_pending'
    ]) {
      fixture.journeys.set(paymentId, {
        ...waiting,
        next: { ...waiting.next!, reason }
      });
      await automaticHook(page, 'verify').focus();
      await page.keyboard.press('Enter');
      await expect(automaticHook(page, 'state')).toContainText(
        language === 'en'
          ? reason === 'publication_publishing'
            ? 'sending'
            : 'retry'
          : reason === 'publication_publishing'
            ? 'envoie'
            : 'reprise'
      );
      await expect(automaticHook(page, 'state')).toHaveAttribute(
        'data-og7-id',
        'waiting'
      );
      await expect(automaticHook(page, 'prepare')).toHaveCount(0);
    }
    expect(fixture.mutations).toEqual([]);
  });
}

test('automatic preparation rechecks a selected invoice action and follows a changed recommendation without opening its stale confirmation', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await automaticInvoiceFixture(page);
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney(
      'invoice_missing',
      `${dashboardPath}/sponsors?sponsorshipId=${paymentId}&tab=invoice`,
      'sponsorship-dossier'
    )
  );
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  await automaticHook(page, 'start').click();
  await expect(page).toHaveURL(
    `${dashboardPath}/invoices?contributionId=${paymentId}`
  );
  const confirmation = page.locator('openg7-admin-confirmation dialog[open]');
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Annuler', exact: true })
    .last()
    .click();
  const invoicePreparation = page.locator(
    '[data-og7="automatic-prepare"][data-og7-id="invoice-backfill"]'
  );
  await expect(invoicePreparation).toBeVisible();
  const destination = `${dashboardPath}/email-queue?messageId=automatic-email-701`;
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney('email_failed', destination)
  );
  await invoicePreparation.click();
  await expect(page).toHaveURL(destination);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  await expect(confirmation).toHaveCount(0);
  await expect(invoicePreparation).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

test('automatic payment preparation stops on forbidden reads and shows no stale completion or business action', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  fixture.paymentStatus = 403;
  await automaticHook(page, 'start').click();
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'blocked'
  );
  await expect(automaticHook(page, 'state')).toContainText(
    'Ton rôle ne permet pas cette lecture'
  );
  await expect(automaticHook(page, 'complete')).toHaveCount(0);
  await expect(automaticHook(page, 'prepare')).toHaveCount(0);
  await expect(page).toHaveURL(dashboardPath);
  expect(fixture.mutations).toEqual([]);
});

test('automatic invoice generation opens the real confirmation and waits for a human before the scoped write', async ({
  page
}) => {
  const fixture = await fixtures(page);
  let releaseInvoices = () => {};
  const invoiceGate = new Promise<void>(
    (resolve) => (releaseInvoices = resolve)
  );
  await automaticInvoiceFixture(page, invoiceGate);
  const payloads: unknown[] = [];
  await page.route('**/api/admin/sponsorship-invoices/backfill', (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    fixture.mutations.push({
      method: request.method(),
      pathname: new URL(request.url()).pathname
    });
    payloads.push(request.postDataJSON());
    return route.fulfill({
      json: {
        data_source: 'database',
        eligible_count: 1,
        missing_count: 1,
        processed_count: 1,
        created_count: 1,
        skipped_count: 0,
        remaining_count: 0,
        failed_count: 0,
        invoiceIds: [],
        invoices: [],
        errors: [],
        last_updated_at: generatedAt
      }
    });
  });
  fixture.journeys.set(
    paymentId,
    pendingAutomaticJourney(
      'invoice_missing',
      `${dashboardPath}/sponsors?sponsorshipId=${paymentId}&tab=invoice`,
      'sponsorship-dossier'
    )
  );
  await page.goto(`${dashboardPath}?paymentJourney=${paymentId}`);
  await openAutomatic(page);
  await automaticHook(page, 'scope').selectOption('payment');
  await automaticHook(page, 'start').click();
  await expect(page).toHaveURL(
    `${dashboardPath}/invoices?contributionId=${paymentId}`
  );
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'preparing'
  );
  const confirmation = page.locator('openg7-admin-confirmation dialog[open]');
  await expect(
    page.locator('[data-og7="invoice-workspace"] nav button').first()
  ).toBeDisabled();
  // The workspace exists before its GET finishes. Advancing real frames must
  // keep preparation pending until the page-owned button becomes available.
  await sampledFrames(page, 6);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'preparing'
  );
  await expect(confirmation).toHaveCount(0);
  expect(payloads).toEqual([]);
  expect(fixture.mutations).toEqual([]);
  releaseInvoices();
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(paymentId);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  expect(payloads).toEqual([]);
  expect(fixture.mutations).toEqual([]);
  const reads = fixture.paymentRequests.length;
  await confirmation.locator('[data-og7="confirm-action"]').click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).toEqual({
    limit: 1,
    contributionId: paymentId,
    confirmation: paymentId
  });
  await expect(confirmation).toHaveCount(0);
  await expect
    .poll(() => fixture.paymentRequests.length)
    .toBeGreaterThan(reads);
  await expect(automaticHook(page, 'complete')).toHaveCount(0);
  fixture.journeys.set(paymentId, paymentJourney());
  await automaticHook(page, 'verify').click();
  await expect(automaticHook(page, 'complete')).toBeVisible();
  expect(fixture.mutations).toEqual([
    { method: 'POST', pathname: '/api/admin/sponsorship-invoices/backfill' }
  ]);
});

test('automatic preparation can start and pause through the shared simulated Xbox controls', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await installAdminController(page);
  await page.goto(dashboardPath);
  const controller = adminController(page);
  await controller.ready();
  await controller.activate(hook(page, 'toggle'));
  await restoreLegacyGuideMode(page, 'automatic');
  await controller.ready();
  await controller.activate(
    page.locator('[data-og7="automatic-view"][data-og7-id="other"]')
  );
  await expect(automaticHook(page, 'scope')).toBeVisible();
  await controller.select(automaticHook(page, 'scope'), 'attention');
  await controller.activate(automaticHook(page, 'start'));
  await expect(page).toHaveURL(attentionPath);
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_confirmation'
  );
  // Navigation focuses the administrative page; Y explicitly rejoins the guide.
  await controller.press('Y');
  await controller.activate(automaticHook(page, 'pause'));
  await expect(automaticHook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'paused'
  );
  expect(fixture.mutations).toEqual([]);
});
