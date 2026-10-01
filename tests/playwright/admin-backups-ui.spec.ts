import type {
  AdminBackupsResponse,
  AdminDatabaseBackup
} from '@openg7/funding-core';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import { setupFixture } from './support/setup-fixtures.js';

for (const language of ['fr-CA', 'en']) {
  test(`backup setup confirms once, recovers a lost response and remains accessible in ${language}`, async ({
    page
  }) => {
    const en = language === 'en';
    await page.setViewportSize({ width: en ? 390 : 1440, height: 1000 });
    await page.addInitScript((locale) => {
      localStorage.setItem('openg7.language', locale);
      sessionStorage.setItem(
        'openg7-admin-session-token',
        'openg7-admin-session.backup-fixture'
      );
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2099-01-01T00:00:00Z'
      );
    }, language);
    let workerState: AdminBackupsResponse['workerState'] = 'not_configured';
    let job: AdminDatabaseBackup | null = null;
    let calls = 0;
    let accessStatus = 200;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/setup-status'))
        return route.fulfill({ json: setupFixture() });
      if (!url.pathname.endsWith('/backups'))
        return route.fulfill({ status: 503, json: {} });
      if (accessStatus !== 200)
        return route.fulfill({ status: accessStatus, json: {} });
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.confirmation).toBe('BACKUP_DATABASE');
        calls++;
        job = {
          requestId: body.requestId,
          source: 'manual',
          status: 'queued',
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
          bytes: null,
          sha256: null,
          retainUntil: null
        };
        return route.abort('failed');
      }
      return route.fulfill({
        json: {
          scope: 'database',
          schedule: 'daily',
          retentionDays: 30,
          checkedAt: new Date().toISOString(),
          lastWorkerAt:
            workerState === 'ready' ? new Date().toISOString() : null,
          workerState,
          jobs: job ? [job] : [],
          ...(url.searchParams.has('requestId') ? { request: job } : {})
        } satisfies AdminBackupsResponse
      });
    });
    await page.goto('/admin/fundraiser/setup?section=backups');
    const panel = page.locator('[data-og7="setup-backups"]');
    const request = page.locator('[data-og7="backup-request"]');
    const refresh = panel.getByRole('button', {
      name: en ? 'Check backups' : 'Vérifier les sauvegardes',
      exact: true
    });
    await expect(panel).toContainText(
      en ? 'Configuration required' : 'À configurer'
    );
    await expect(request).toBeDisabled();
    expect(calls).toBe(0);
    workerState = 'ready';
    await refresh.click();
    await expect(request).toBeEnabled();
    await request.focus();
    await page.keyboard.press('Enter');
    const confirm = page.locator('[data-og7="confirm-action"]');
    await expect(confirm).toBeVisible();
    expect(calls).toBe(0);
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(request).toBeFocused();
    await request.click();
    await confirm.click();
    await expect(page.locator('[data-og7="backup-uncertain"]')).toBeVisible();
    await expect(request).toBeDisabled();
    expect(calls).toBe(1);
    await page.reload();
    await expect(page.locator('[data-og7="backup-receipt"]')).toContainText(
      en ? 'Request queued' : 'Demande en attente'
    );
    await expect(request).toBeDisabled();
    expect(calls).toBe(1);
    job = { ...job!, status: 'unknown' };
    await refresh.click();
    await expect(panel).toContainText(
      en ? 'operator verification required' : 'vérification opérateur requise'
    );
    await expect(request).toBeDisabled();
    job = {
      ...job!,
      status: 'succeeded',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      bytes: 1234,
      sha256: 'a'.repeat(64),
      retainUntil: '2099-01-01T00:00:00Z'
    };
    await refresh.click();
    await expect(panel).toContainText(
      en ? 'Off-server copy verified' : 'Copie hors serveur vérifiée'
    );
    await panel
      .getByText(
        en ? 'Off-server copy evidence' : 'Preuve de copie hors serveur',
        { exact: true }
      )
      .click();
    await expect(panel).toContainText('a'.repeat(64));
    await expect(page.locator('body')).toHaveJSProperty(
      'scrollWidth',
      await page.evaluate(() => document.documentElement.clientWidth)
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="setup-backups"]')
          .analyze()
      ).violations
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/admin-layout/backup-${language}.png`,
      fullPage: true
    });
    accessStatus = 401;
    await refresh.click();
    await expect(panel).toContainText(
      en ? 'session has expired' : 'session a expiré'
    );
    await expect(panel).not.toContainText('a'.repeat(64));
    await expect(request).toBeDisabled();
    expect(calls).toBe(1);
  });
}
