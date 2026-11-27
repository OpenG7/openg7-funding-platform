import { AxeBuilder } from '@axe-core/playwright';
import type { AdminFlowMeasurement } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  engineRoomFixture,
  engineSponsorId,
  operationalQueueFixture
} from './support/engine-room.js';

const path = '/admin/fundraiser/engine-room';
const observation = (): AdminFlowMeasurement => ({
  definition: 'sponsorship-obligation-flow/v1',
  observedAt: new Date().toISOString(),
  window: {
    from: '2026-11-18T12:00:00Z',
    to: '2026-11-25T12:00:00Z',
    timezone: 'UTC'
  },
  scope: {},
  status: 'available',
  sources: [
    'sponsorship_obligations.created_at',
    'qualifiedSponsorshipEvidenceIds'
  ],
  excludedDossiers: 2,
  humanActiveSeconds: null,
  autonomyRate: null,
  totals: {
    population: 6,
    entries: 3,
    qualifiedExits: 1,
    open: 4,
    qualified: 1,
    adjusted: 1,
    overdue: 2,
    undated: 1,
    ageSamples: 3,
    unknownAge: 1,
    oldestAgeSeconds: 500,
    medianAgeSeconds: 100,
    p95AgeSeconds: 500,
    cycleSamples: 1,
    medianCycleSeconds: 60,
    p95CycleSeconds: 60
  },
  cohorts: []
});
for (const language of ['fr-CA', 'en'])
  for (const width of [390, 768, 1280, 1440, 1920]) {
    test(`flow baseline is explicit and voluntary in ${language} at ${width}`, async ({
      page
    }, info) => {
      const { options, writes } = await engineRoomFixture(page);
      const base = observation();
      const m: AdminFlowMeasurement = {
        ...base,
        cohorts: [
          {
            ...base.totals!,
            channel: 'facebook',
            target: 'openg7',
            format: 'collective_text',
            mode: 'live',
            deadline: 'dated'
          }
        ]
      };
      options.snapshot = {
        ...options.snapshot,
        flowMeasurement: m,
        workQueue: operationalQueueFixture()
      };
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(path);
      const panel = page.locator('[data-og7="flow-measurement"]');
      await expect(panel.locator('[data-og7="flow-entries"]')).toHaveText('3');
      await expect(panel.locator('[data-og7="flow-exits"]')).toHaveText('1');
      await expect(panel.locator('[data-og7="flow-open"]')).toHaveText('4');
      await expect(
        page.locator('[data-og7="engine-kpi-created"] strong')
      ).toHaveText('3');
      await expect(
        page.locator('[data-og7="engine-kpi-human"] strong')
      ).toHaveText('1');
      await expect(
        page.locator('[data-og7="engine-kpi-platform"] strong')
      ).toHaveText('1');
      await expect(page.locator('[data-og7="engine-paths"]')).toContainText(
        language === 'en' ? 'not measured' : 'non mesurés'
      );
      await page.screenshot({
        path: info.outputPath(`cockpit-${language}-${width}.png`),
        fullPage: true
      });
      if (width >= 1280) {
        const scene = await page
          .locator('[data-og7="engine-scene"]')
          .boundingBox();
        const inspector = await page
          .locator('[data-og7="engine-detail"]')
          .boundingBox();
        const queue = await page
          .locator('[data-og7="operational-queue"]')
          .boundingBox();
        expect(inspector!.x).toBeGreaterThan(scene!.x);
        expect(queue!.x).toBeGreaterThan(inspector!.x);
        expect(Math.abs(inspector!.y - scene!.y)).toBeLessThan(2);
        const before = await page.evaluate(() => scrollY);
        await page.locator('[data-og7="engine-preflight"]').focus();
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => scrollY)).toBe(before);
      }
      await panel.locator('details').first().locator('summary').click();
      await expect(panel.locator('table')).toContainText('facebook');
      const human = panel.locator('[data-og7="human-work-sample"]');
      await human.locator('summary').click();
      await expect(human.locator('[data-og7="human-start"]')).toBeDisabled();
      await human.locator('[data-og7="human-consent"]').check();
      await human.locator('[data-og7="human-start"]').click();
      await expect(human.locator('[data-og7="human-pause"]')).toBeEnabled();
      await expect
        .poll(async () =>
          Number(await human.locator('[data-og7="human-total"]').textContent())
        )
        .toBeGreaterThan(0);
      // Foreground loss pauses and does not resume the sample automatically.
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(human.locator('[data-og7="human-pause"]')).toBeDisabled();
      const stopped = await human
        .locator('[data-og7="human-total"]')
        .textContent();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(human.locator('[data-og7="human-start"]')).toBeEnabled();
      await expect(human.locator('[data-og7="human-total"]')).toHaveText(
        stopped!
      );
      await human.locator('[data-og7="human-clear"]').click();
      await expect(
        human.locator('[data-og7="human-consent"]')
      ).not.toBeChecked();
      await expect(human.locator('[data-og7="human-total"]')).toHaveText('0');
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="flow-measurement"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      expect(writes).toEqual([]);
    });
  }
test('missing or unavailable measurements stay unknown and navigation clears voluntary samples', async ({
  page
}) => {
  const { options, writes } = await engineRoomFixture(page);
  await page.goto(path);
  await expect(page.locator('[data-og7="flow-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-og7="flow-open"]')).toHaveCount(0);
  await expect(
    page.locator('[data-og7="engine-kpi-created"] strong')
  ).toHaveText('Inconnu');
  const human = page.locator('[data-og7="human-work-sample"]');
  await human.locator('summary').click();
  await human.locator('[data-og7="human-consent"]').check();
  await human.locator('[data-og7="human-start"]').click();
  await page.goto(path + '?sponsorshipId=' + engineSponsorId);
  await page.locator('[data-og7="human-work-sample"] summary').click();
  await expect(page.locator('[data-og7="human-consent"]')).not.toBeChecked();
  await expect(page.locator('[data-og7="human-total"]')).toHaveText('0');
  options.snapshot = {
    ...options.snapshot,
    flowMeasurement: {
      ...observation(),
      status: 'unavailable',
      totals: null,
      cohorts: []
    }
  };
  await page.locator('[data-og7="engine-room-refresh"]').click();
  await expect(page.locator('[data-og7="flow-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-og7="flow-open"]')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('cockpit distinguishes zero, unknown and unmeasured durations without inventing capacity or history', async ({
  page
}) => {
  const { options, writes } = await engineRoomFixture(page);
  const m = observation();
  options.snapshot = {
    ...options.snapshot,
    flowMeasurement: {
      ...m,
      totals: {
        ...m.totals!,
        entries: 0,
        qualifiedExits: 0,
        overdue: 0,
        undated: 9,
        medianAgeSeconds: 350014,
        p95AgeSeconds: 1120702,
        oldestAgeSeconds: 1120702,
        cycleSamples: 0,
        medianCycleSeconds: null,
        p95CycleSeconds: null
      }
    }
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(path);
  await expect(
    page.locator('[data-og7="engine-kpi-created"] strong')
  ).toHaveText('0');
  await expect(page.locator('[data-og7="engine-kpi-human"] strong')).toHaveText(
    'Inconnu'
  );
  await expect(page.locator('[data-og7="engine-kpi-overdue"]')).toContainText(
    'Ouvertes sans échéance : 9'
  );
  await expect(page.locator('[data-og7="flow-age"]')).toContainText(
    '4 j 1 h / 12 j 23 h'
  );
  await expect(page.locator('[data-og7="flow-comparison"]')).not.toContainText(
    '%'
  );
  await expect(page.locator('[data-og7="flow-measurement"]')).toContainText(
    'Non mesuré / Non mesuré'
  );
  const sources = page.locator('[data-og7="flow-measurement"] details').nth(1);
  await sources.locator('summary').click();
  await expect(sources).toContainText('350014 / 1120702');
  await expect(sources).toContainText('2026-11-18T12:00:00Z');
  options.fail = true;
  await page.locator('[data-og7="engine-room-refresh"]').click();
  await expect(
    page.locator('[data-og7="engine-kpi-created"] strong')
  ).toHaveText('Inconnu');
  await expect(page.locator('[data-og7="flow-age"]')).toHaveCount(0);
  expect(writes).toEqual([]);
});
