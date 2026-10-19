import type { Locator, Page } from '@playwright/test';
import type {
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  controllerId,
  controllerJourneysFixtures,
  controllerPath
} from './support/controller-journeys.fixtures.js';

type Language = 'fr-CA' | 'en';
type DossierTab = 'overview' | 'identity' | 'publication' | 'billing' | 'audit';

const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
const tabNames = (language: Language): Record<DossierTab, string> => ({
  overview: language === 'en' ? 'Overview' : 'Aperçu',
  identity: language === 'en' ? 'Profile & media' : 'Fiche et médias',
  publication: 'Publication',
  billing: 'Finances',
  audit: language === 'en' ? 'History' : 'Historique'
});

async function dossierFixtures(
  page: Page,
  role: 'reader' | 'operator' | 'owner',
  language: Language
) {
  const state = await controllerJourneysFixtures(page, role, language, {
    hardware: 'native'
  });
  await page.route(
    '**/api/admin/sponsorships/media/workspace*',
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const workspace: SponsorMediaWorkspace = {
        contributionId: controllerId,
        revision: 'dossier-v2-fixture-media-v1',
        writable: role !== 'reader',
        assets: state.media.map((asset): SponsorMediaWorkspaceAsset => ({
          ...asset,
          batchId: null,
          usageSource: 'media',
          ruleId: null,
          websiteSelected: false,
          readiness: {
            state: 'needs_review',
            reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
          },
          moderation: {
            state: null,
            level: null,
            contentVersion: 3,
            fingerprint: 'a'.repeat(64),
            currentDecisionId: null
          }
        })),
        rules: [],
        batches: []
      };
      await route.fulfill({ json: workspace });
    }
  );
  await page.route(
    '**/api/admin/sponsorships/media/analyses*',
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        json: {
          contributionId: controllerId,
          capabilities: {
            technical: 'local',
            vision: 'not_configured',
            ocr: 'not_configured'
          },
          runs: []
        }
      });
    }
  );
  return state;
}

async function expectFiveTabs(
  page: Page,
  language: Language,
  active: DossierTab
): Promise<void> {
  const tabs = hook(page, 'dossier-tabs');
  await expect(tabs.getByRole('button')).toHaveCount(5);
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
  for (const [id, name] of Object.entries(tabNames(language))) {
    const button = tabs.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    if (id === active)
      await expect(button).toHaveAttribute('aria-current', 'page');
  }
}

async function expectDossierHeader(page: Page): Promise<void> {
  const header = hook(page, 'dossier-header');
  await expect(
    header.getByRole('heading', { name: 'Xbox fixture', exact: true })
  ).toBeVisible();
  await expect(header).toContainText('500');
  await expect(header).toContainText('CAD');
  await expect(
    header.locator('[data-og7="dossier-public-reference"]')
  ).toHaveText('XBOX-401');
  // The public reference remains readable while the optional dates are closed.
  await expect(
    header.locator('[data-og7="dossier-public-reference"]')
  ).toBeVisible();
  await expect(header.getByText('XBOX-401', { exact: true })).toHaveCount(1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    )
    .toBe(true);
}

async function expectFocusVisible(control: Locator): Promise<void> {
  await expect(control).toBeFocused();
  await expect(control).toBeInViewport();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return !!hit && (hit === element || element.contains(hit));
      })
    )
    .toBe(true);
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const viewport of [
    { width: 1536, height: 864 },
    { width: 390, height: 844 }
  ]) {
    test(`the ${language} dossier header opens exact-subject moderation and returns to Publication at ${viewport.width}px`, async ({
      page
    }, testInfo) => {
      const state = await dossierFixtures(page, 'owner', language);
      await page.setViewportSize(viewport);
      await page.goto(controllerPath('publication'));
      await expectDossierHeader(page);
      await expectFiveTabs(page, language, 'publication');
      const originalUrl = page.url();
      const trigger = hook(page, 'dossier-header').getByRole('button', {
        name:
          language === 'en' ? 'Editorial moderation' : 'Modération éditoriale',
        exact: true
      });
      await expect(trigger).toHaveAttribute('data-og7', 'dossier-tool-toggle');
      await expect(trigger).toHaveAttribute('data-og7-id', 'moderation');
      await expect(hook(page, 'moderation-actions')).toHaveCount(0);
      await trigger.focus();
      await page.keyboard.press('Enter');
      const tool = page.locator(
        '[data-og7="dossier-tool-panel"][data-og7-id="moderation"]'
      );
      await expect(tool).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const actions = tool.locator('[data-og7="moderation-actions"]');
      await expect(actions).toHaveCount(1);
      await actions.getByRole('combobox').first().selectOption('N0');
      const contentRead = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname === '/api/admin/moderation/content' &&
          url.searchParams.get('subjectType') === 'sponsorship' &&
          url.searchParams.get('subjectId') === controllerId
        );
      });
      const openDecision = actions.locator('[data-og7="moderation-open"]');
      await openDecision.focus();
      await page.keyboard.press('Enter');
      const content = await (await contentRead).json();
      expect(content).toMatchObject({
        subject: { type: 'sponsorship', id: controllerId },
        contentVersion: 3,
        fingerprint: 'a'.repeat(64)
      });
      const decision = hook(page, 'moderation-decision');
      await expect(decision).toHaveCount(1);
      await expect(decision).toBeVisible();
      await expect(decision).toContainText(
        new RegExp(
          `${language === 'en' ? 'Content version' : 'Version du contenu'}:\\s*3`
        )
      );
      await expect(
        decision.locator('[data-og7="moderation-confirmation"]')
      ).not.toBeChecked();
      expect(state.commands).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(decision).toHaveCount(0);
      await expect(openDecision).toBeFocused();
      await expect(
        tool.locator('[data-og7="dossier-tool-close"]')
      ).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(tool).toBeHidden();
      await expectFocusVisible(trigger);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(page.url()).toBe(originalUrl);
      await expectFiveTabs(page, language, 'publication');
      expect(state.sponsor.sponsor_review_status).toBe('pending_review');
      expect(state.commands).toEqual([]);
      await expectNoHorizontalOverflow(page);
      if (
        (language === 'fr-CA' && viewport.width === 1536) ||
        (language === 'en' && viewport.width === 390)
      ) {
        await page.goto(controllerPath('overview'));
        await expectFiveTabs(page, language, 'overview');
        await expect(hook(page, 'dossier-recommendation')).not.toContainText(
          'admin.dossier.'
        );
        await hook(page, 'dossier-header').scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(
            `dossier-overview-${language}-${viewport.width}.png`
          ),
          animations: 'disabled'
        });
        if (language === 'en') {
          await hook(page, 'dossier-recommendation').scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath(
              'dossier-overview-en-390-recommendation.png'
            ),
            animations: 'disabled'
          });
        }
        expect(state.commands).toEqual([]);
      }
    });

    test(`a ${language} reader can inspect the five-tab dossier without a moderation entry at ${viewport.width}px`, async ({
      page
    }) => {
      const state = await dossierFixtures(page, 'reader', language);
      await page.setViewportSize(viewport);
      await page.goto(controllerPath('identity'));
      await expectDossierHeader(page);
      await expectFiveTabs(page, language, 'identity');
      await expect(
        page.locator(
          '[data-og7="dossier-tool-toggle"][data-og7-id="moderation"]'
        )
      ).toHaveCount(0);
      await expect(hook(page, 'moderation-open')).toHaveCount(0);
      await expect(hook(page, 'identity-edit')).toHaveCount(0);
      const gallery = hook(page, 'dossier-media-gallery');
      const openGallery = hook(page, 'dossier-media-open-gallery');
      await openGallery.focus();
      await page.keyboard.press('Enter');
      await expect(gallery).toBeFocused();
      await expect(hook(page, 'media-gallery')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('sponsorshipId')).toBe(
        controllerId
      );
      expect(state.commands).toEqual([]);
      await expectNoHorizontalOverflow(page);
    });
  }
}

for (const { language, viewport } of [
  { language: 'fr-CA', viewport: { width: 1536, height: 864 } },
  { language: 'en', viewport: { width: 390, height: 844 } }
] as const) {
  test(`an ${language} operator follows the media alias and returns to profile without a sixth tab at ${viewport.width}px`, async ({
    page
  }, testInfo) => {
    const state = await dossierFixtures(page, 'operator', language);
    await page.setViewportSize(viewport);
    await page.goto(controllerPath('media'));
    await expectFiveTabs(page, language, 'identity');
    const gallery = hook(page, 'dossier-media-gallery');
    await expect(gallery).toBeFocused();
    await expect(hook(page, 'dossier-media-summary')).toBeVisible();
    await expect(hook(page, 'dossier-media-file-count')).toContainText('1');
    await page.screenshot({
      path: testInfo.outputPath(
        `dossier-media-alias-${language}-${viewport.width}.png`
      ),
      animations: 'disabled'
    });
    const identityTab = hook(page, 'dossier-tabs').getByRole('button', {
      name: tabNames(language).identity,
      exact: true
    });
    await identityTab.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('tab'))
      .toBe('identity');
    await expect(identityTab).toBeFocused();
    await expect(hook(page, 'dossier-identity')).toBeVisible();
    await expectFiveTabs(page, language, 'identity');
    await hook(page, 'dossier-media-open-gallery').focus();
    await page.keyboard.press('Enter');
    await expect(gallery).toBeFocused();
    expect(new URL(page.url()).searchParams.get('sponsorshipId')).toBe(
      controllerId
    );
    expect(state.commands).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
}

for (const { language, viewport } of [
  { language: 'fr-CA', viewport: { width: 390, height: 844 } },
  { language: 'en', viewport: { width: 1536, height: 864 } }
] as const) {
  test(`the ${language} refund alias keeps Finances selected and the dossier usable at 200% and ${viewport.width}px`, async ({
    page
  }) => {
    const state = await dossierFixtures(page, 'owner', language);
    await page.setViewportSize(viewport);
    await page.goto(controllerPath('refund'));
    await expectFiveTabs(page, language, 'billing');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectDossierHeader(page);
    const headerModeration = hook(page, 'dossier-header').locator(
      '[data-og7="dossier-tool-toggle"][data-og7-id="moderation"]'
    );
    await headerModeration.scrollIntoViewIfNeeded();
    await headerModeration.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-og7="dossier-tool-panel"][data-og7-id="moderation"]')
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expectFocusVisible(headerModeration);
    await expectFiveTabs(page, language, 'billing');
    expect(new URL(page.url()).searchParams.get('tab')).toBe('refund');
    expect(new URL(page.url()).searchParams.get('sponsorshipId')).toBe(
      controllerId
    );
    expect(state.commands).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
}
