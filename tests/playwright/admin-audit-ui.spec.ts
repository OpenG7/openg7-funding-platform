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
      await inspect.focus();
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
