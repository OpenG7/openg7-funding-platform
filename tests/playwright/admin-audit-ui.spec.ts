import type { Page } from '@playwright/test';
import type { AdminAuditLogEntry } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const date = '2026-09-29T14:30:00Z';
const entries: AdminAuditLogEntry[] = Array.from(
  { length: 21 },
  (_, index) => ({
    id: `audit-fixture-${index + 1}`,
    action: `note.saved.${index + 1}`,
    actor: `Fixture ${index + 1}`,
    entity_type: 'record',
    entity_id: `synthetic-reference-${index + 1}-with-a-long-identifier`,
    summary: `Synthetic audit summary ${index + 1}. ${'Additional context. '.repeat(12)}`,
    metadata: {},
    created_at: date
  })
);

async function fixtures(page: Page, language = 'fr-CA') {
  const options = {
    entries,
    status: 200,
    gate: null as Promise<void> | null
  };
  const queries: string[] = [];
  await page.addInitScript((language) => {
    localStorage.setItem('openg7.language', language);
  }, language);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/config')) {
      return route.fulfill({ json: { mode: 'oidc' } });
    }
    if (url.pathname.endsWith('/auth/current')) {
      return route.fulfill({
        json: {
          id: 'audit-reader-fixture',
          sessionId: 'audit-session-fixture',
          displayName: 'Reader fixture',
          role: 'reader',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    }
    if (url.pathname.endsWith('/audit-log')) {
      queries.push(url.search);
      if (options.gate) await options.gate;
      const entryId = url.searchParams.get('entryId');
      return route.fulfill({
        status: options.status,
        json: {
          data_source: 'database',
          entries: entryId
            ? options.entries.filter((entry) => entry.id === entryId)
            : options.entries,
          last_updated_at: date
        }
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return { options, queries };
}

const auditPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    border: 'rgb(216, 224, 236)',
    text: 'rgb(23, 43, 80)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    border: 'rgb(64, 86, 111)',
    text: 'rgb(241, 245, 252)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    border: 'rgb(86, 97, 110)',
    text: 'rgb(243, 244, 246)'
  }
} as const;

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  test(`audit retains ${theme} surfaces and readable entries on French mobile and English desktop`, async ({
    page
  }) => {
    await fixtures(page);
    await page.addInitScript((theme) => {
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false, density: 'comfortable' })
      );
    }, theme);
    for (const { language, width } of [
      { language: 'fr-CA', width: 320 },
      { language: 'en', width: 1280 }
    ]) {
      await test.step(`${language} at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        if (language === 'fr-CA') await page.goto('/admin/fundraiser/audit');
        else
          await page
            .getByRole('banner')
            .getByRole('button', {
              name: 'Switch administration language to English'
            })
            .click();
        const audit = page.locator('[data-og7="admin-audit"]');
        const panel = audit.locator('section[aria-labelledby="audit-title"]');
        const rows = audit.locator('[data-og7="audit-entry"]');
        await expect(rows).toHaveCount(20);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(audit).toHaveCSS('gap', '16px');
        await expect(panel).toHaveCSS(
          'background-color',
          auditPalettes[theme].panel
        );
        await expect(panel).toHaveCSS(
          'border-top-color',
          auditPalettes[theme].border
        );
        await expect(panel).toHaveCSS('border-radius', '10.4px');
        await expect(panel.locator(':scope > header')).toHaveCSS(
          'padding',
          '16px'
        );
        const inspect = rows.first().getByRole('button');
        await expect(inspect).toHaveCSS('color', auditPalettes[theme].text);
        await expect(inspect).toHaveCSS('min-height', '44px');
        await expect(audit.getByRole('searchbox')).toHaveCSS(
          'min-height',
          '44px'
        );
        await expect(rows.first()).toHaveCSS(
          'display',
          width <= 700 ? 'block' : 'table-row'
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
      });
    }
  });
}

test('audit retains its inclusive 700px table and search breakpoint', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/audit');
  const audit = page.locator('[data-og7="admin-audit"]');
  const table = audit.getByRole('table');
  const row = audit.locator('[data-og7="audit-entry"]').first();
  await expect(row).toBeVisible();
  for (const width of [700, 701]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await expect(table).toHaveCSS(
        'display',
        width === 700 ? 'block' : 'table'
      );
      await expect(row.getByRole('cell').first()).toHaveCSS(
        'display',
        width === 700 ? 'block' : 'table-cell'
      );
      await expect(audit.getByRole('searchbox').locator('..')).toHaveCSS(
        'flex-basis',
        width === 700 ? '100%' : '352px'
      );
      await expect(table.locator('thead')).toHaveCSS(
        'position',
        width === 700 ? 'absolute' : 'static'
      );
      expect(
        await audit.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
      ).toBe(true);
    });
  }
});

for (const language of ['fr-CA', 'en']) {
  for (const width of [320, 1280]) {
    test(`audit pagination, search and keyboard inspection in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const { options } = await fixtures(page, language);
      await page.goto('/admin/fundraiser/audit');
      const audit = page.locator('[data-og7="admin-audit"]');
      const rows = audit.locator('[data-og7="audit-entry"]');
      const search = audit.getByRole('searchbox');
      const next = audit.getByRole('button', {
        name: language === 'en' ? 'Next' : 'Suivant',
        exact: true
      });
      const previous = audit.getByRole('button', {
        name: language === 'en' ? 'Previous' : 'Précédent',
        exact: true
      });
      await expect(rows).toHaveCount(20);
      await expect(audit.locator('[data-og7="audit-count"]')).toHaveText(
        language === 'en' ? '21 entries' : '21 entrées'
      );
      await expect(previous).toBeDisabled();
      await next.click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-og7-id', entries[20].id);
      await expect(next).toBeDisabled();
      await previous.click();
      await expect(rows).toHaveCount(20);

      // A reference on another page remains searchable across all loaded entries.
      await search.fill(entries[20].entity_id!);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-og7-id', entries[20].id);
      await expect(audit.locator('[data-og7="audit-count"]')).toHaveText(
        language === 'en' ? '1 entry' : '1 entrée'
      );
      await expect(next).toHaveCount(0);
      const inspect = rows.getByRole('button', { name: entries[20].action });
      await page.keyboard.press('Tab');
      await inspect.focus();
      await inspect.hover();
      await expect(inspect).toBeFocused();
      await expect(inspect).toHaveCSS('outline-style', 'solid');
      await expect(inspect).toHaveCSS('outline-width', '3px');
      await expect(inspect).toHaveCSS('outline-offset', '3px');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(entries[20].summary!);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(inspect).toBeFocused();

      await search.fill('no-matching-fixture');
      await expect(
        audit.getByRole('heading', {
          name: language === 'en' ? 'No entries found' : 'Aucune entrée trouvée'
        })
      ).toBeVisible();
      await audit
        .getByRole('button', {
          name: language === 'en' ? 'Clear search' : 'Effacer la recherche'
        })
        .click();
      await expect(search).toBeFocused();
      await expect(rows).toHaveCount(20);
      expect(
        await audit.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`audit-${language}-${width}.png`),
        fullPage: true
      });

      // A refresh with fewer entries must not leave the current page empty.
      await next.click();
      options.entries = entries.slice(0, 1);
      await audit
        .getByRole('button', {
          name: language === 'en' ? 'Refresh' : 'Actualiser',
          exact: true
        })
        .click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-og7-id', entries[0].id);
      await expect(next).toHaveCount(0);
    });
  }
}

test('audit distinguishes loading, failure, empty journal and a direct entry link', async ({
  page
}) => {
  const { options, queries } = await fixtures(page);
  let release = () => {};
  options.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  options.status = 500;
  await page.goto('/admin/fundraiser/audit');
  const audit = page.locator('[data-og7="admin-audit"]');
  const refresh = audit.getByRole('button', {
    name: 'Actualiser',
    exact: true
  });
  await expect(audit.getByRole('status')).toContainText(
    "Chargement de l'audit"
  );
  await expect(refresh).toBeDisabled();
  await expect(
    audit.getByRole('heading', { name: 'Aucune entrée trouvée' })
  ).toHaveCount(0);
  release();
  await expect(audit.getByRole('alert')).toContainText(
    "Impossible de charger le journal d'audit"
  );
  options.status = 200;
  options.entries = [];
  await refresh.click();
  await expect(audit.getByRole('alert')).toHaveCount(0);
  await expect(audit).toContainText(
    'Le journal se remplira lors des prochaines actions admin.'
  );
  await expect(
    audit.getByRole('button', { name: 'Effacer la recherche' })
  ).toHaveCount(0);
  options.entries = entries;
  await page.goto(`/admin/fundraiser/audit?entryId=${entries[20].id}`);
  await expect(audit.locator('[data-og7="audit-entry"]')).toHaveCount(1);
  await expect(audit.locator('[data-og7="audit-entry"]')).toHaveAttribute(
    'data-og7-id',
    entries[20].id
  );
  expect(queries).toContain(`?entryId=${entries[20].id}`);
});
