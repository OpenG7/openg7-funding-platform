import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';

const initialJob: PublicationDelivery = {
  id: '11111111-1111-4111-8111-111111111111',
  feedId: 'openg20:facebook',
  kind: 'news',
  batchId: null,
  message: 'Notre prochaine réalisation pour la communauté.',
  scheduledAt: '2030-06-03T14:00:00Z',
  mediaId: null,
  mediaUrl: null,
  mediaAlt: null,
  accountId: 'fixture-page-20',
  mode: 'mock',
  version: 1,
  status: 'draft',
  attempts: 0,
  nextAttemptAt: null,
  externalPostId: null,
  externalPostUrl: null,
  errorCode: null,
  approvedAt: null,
  publishedAt: null
};
async function fixtures(
  page: Page,
  status: PublicationDelivery['status'] = 'draft',
  conflict = false
): Promise<PublicationAutomationCommand[]> {
  const commands: PublicationAutomationCommand[] = [];
  const state: PublicationAutomationState = {
    workerEnabled: true,
    summary: {
      awaitingApproval: 1,
      scheduled: 0,
      exceptions: status === 'uncertain' ? 1 : 0,
      publishedToday: 2
    },
    feeds: [
      'openg7:facebook',
      'openg7:linkedin',
      'openg20:facebook',
      'openg20:linkedin'
    ].map((id) => ({
      id: id as PublicationDelivery['feedId'],
      paused: true,
      autoPrepare: false,
      timezone: 'America/Toronto',
      weekdays: [2, 4],
      localTime: '10:00',
      capacity: 5,
      horizonDays: 14,
      mode: 'mock',
      accountId: 'fixture-page-20',
      configured: true,
      expiresAt: null,
      connection: 'ready',
      checkedAt: '2030-06-01T12:00:00Z'
    })),
    deliveries: [{ ...initialJob, status }]
  };
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/publication-automation/media'))
      return route.fulfill({ json: [] });
    if (!path.endsWith('/publication-automation'))
      return route.fulfill({ status: 503, json: {} });
    if (route.request().method() === 'GET')
      return route.fulfill({ json: state });
    const c = route.request().postDataJSON() as PublicationAutomationCommand;
    commands.push(c);
    if (conflict)
      return route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT' } });
    const job = state.deliveries[0]!;
    if (c.action === 'approve') {
      job.status = 'approved';
      job.version++;
    }
    if (c.action === 'edit') {
      job.message = c.message;
      job.status = 'draft';
      job.version++;
    }
    if (c.action === 'settings') {
      Object.assign(
        state.feeds.find((f) => f.id === c.settings.id)!,
        c.settings
      );
    }
    return route.fulfill({ json: { id: 'id' in c ? c.id : undefined } });
  });
  return commands;
}
test('approves the exact destination and version only after an explicit decision; edits revoke approval', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await expect(
    page.getByRole('heading', { name: 'Pilotage des feeds', exact: true })
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="publication-automation"] article')
  ).toHaveCount(4);
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('fixture-page-20');
  const authorize = dialog.getByRole('button', { name: 'Autoriser cet envoi' });
  await expect(authorize).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
  await authorize.click();
  await expect(dialog).toContainText('Autorisée');
  expect(commands[0]).toEqual({
    action: 'approve',
    id: initialJob.id,
    version: 1,
    confirmation: initialJob.id
  });
  await dialog.getByLabel('Texte exact à publier').fill('Texte final modifié.');
  await dialog
    .getByRole('button', { name: 'Enregistrer le brouillon' })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Autoriser cet envoi' })
  ).toBeDisabled();
  expect(commands[1]).toMatchObject({
    action: 'edit',
    version: 2,
    message: 'Texte final modifié.'
  });
});
test('unsaved changes cannot be approved and stale versions never show success', async ({
  page
}) => {
  const commands = await fixtures(page, 'draft', true);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await dialog.getByLabel('Texte exact à publier').fill('A local change');
  await expect(
    dialog.getByRole('checkbox', { name: /J’approuve/ })
  ).toBeDisabled();
  expect(commands).toHaveLength(0);
  await dialog
    .getByRole('button', { name: 'Enregistrer le brouillon' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Cette publication a changé'
  );
  await expect(dialog.getByLabel('Texte exact à publier')).toHaveValue(
    'A local change'
  );
});
test('exceptions require investigation and never offer a blind retry', async ({
  page
}) => {
  const commands = await fixtures(page, 'uncertain');
  await page.goto('/admin/fundraiser/publications/automation');
  await page.getByRole('button', { name: 'À résoudre', exact: true }).click();
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('Aucune relance automatique');
  await expect(
    dialog.getByRole('button', { name: 'Autoriser cet envoi' })
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Annuler cet envoi' })
  ).toHaveCount(0);
  await dialog
    .getByText('Après vérification : la publication est absente', {
      exact: true
    })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Consigner la vérification' })
  ).toBeDisabled();
  expect(commands).toHaveLength(0);
});
test('editorial posts appear in the calendar with localized status and open their approval', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.getByRole('button', { name: 'Calendrier', exact: true }).click();
  await page.getByLabel('Choisir un mois').fill('2030-06');
  const entry = page.locator(
    '[data-og7="calendar-entry"][data-og7-id="' + initialJob.id + '"]'
  );
  await expect(entry).toContainText('Notre prochaine réalisation');
  await expect(entry).toContainText('Actualité');
  await page.screenshot({
    path: 'test-results/admin-layout/publication-automation-calendar.png',
    fullPage: true
  });
  await entry.click();
  await expect(
    page.getByRole('dialog', { name: 'Publication finale' })
  ).toBeVisible();
});

test('mobile keyboard flow, contrast and focus restoration', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser/publications/automation');
  await expect(
    page.getByRole('heading', { name: 'Pilotage des feeds', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  const item = page.locator('[data-og7-id="' + initialJob.id + '"]');
  await item.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toBeVisible();
  const a11y = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(a11y.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(item).toBeFocused();
  await page.screenshot({
    path: 'test-results/admin-layout/publication-automation-mobile.png',
    fullPage: true
  });
});
