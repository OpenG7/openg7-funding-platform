import type {
  AdminBackupsResponse,
  AdminDatabaseBackup
} from '@openg7/funding-core';
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import { setupFixture } from './support/setup-fixtures.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';

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
    await panel.getByRole('button', { name: /^(Details|Détails) ·/ }).click();
    const evidence = page.locator('[data-og7="backup-evidence"]');
    await expect(evidence).toContainText('a'.repeat(64));
    await page.keyboard.press('Escape');
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

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1440]) {
    const theme = language === 'fr-CA' && width === 1440 ? 'mineral' : 'night';
    test(`backup overview, guides and history remain truthful and accessible in ${language} at ${width}px with ${theme} palette`, async ({
      page
    }) => {
      const en = language === 'en';
      await page.setViewportSize({ width, height: 1050 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      await page.addInitScript(
        ({ locale, palette }) => {
          localStorage.setItem('openg7.language', locale);
          localStorage.setItem(
            'openg7.pilotage.appearance.v1',
            JSON.stringify({ theme: palette, system: false })
          );
          sessionStorage.setItem(
            'openg7-admin-session-token',
            'openg7-admin-session.backup-fixture'
          );
          sessionStorage.setItem(
            'openg7-admin-session-expires-at',
            '2099-01-01T00:00:00Z'
          );
        },
        { locale: language, palette: theme }
      );
      const cockpit = cockpitFixtures();
      let writes = 0;
      let accessStatus = 200;
      const snapshot: { value: AdminBackupsResponse } = {
        value: {
          scope: 'database',
          schedule: 'daily',
          retentionDays: 30,
          checkedAt: new Date().toISOString(),
          lastWorkerAt: null,
          workerState: 'not_configured',
          jobs: []
        }
      };
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== 'GET') writes++;
        if (path.endsWith('/setup-status'))
          return route.fulfill({ json: setupFixture() });
        if (path.endsWith('/cockpit/systems'))
          return route.fulfill({ json: cockpit.systems });
        if (path.endsWith('/cockpit/activity'))
          return route.fulfill({ json: cockpit.activity });
        if (!path.endsWith('/backups'))
          return route.fulfill({ status: 503, json: {} });
        return route.fulfill({
          status: accessStatus,
          json: accessStatus === 200 ? snapshot.value : {}
        });
      });
      await page.goto('/admin/fundraiser/setup');
      const panel = page.locator('[data-og7="setup-backups"]');
      const request = panel.locator('[data-og7="backup-request"]');
      const refresh = panel.getByRole('button', {
        name: en ? 'Check backups' : 'Vérifier les sauvegardes',
        exact: true
      });
      await page.locator('[data-og7="setup-backups-nav"]').click();
      await expect(
        page.locator('[data-og7="setup-backups-nav"]')
      ).toHaveAttribute('aria-current', 'location');
      await expect(page.locator('#setup-backups')).toBeFocused();
      await expect(
        panel.locator('[data-og7="backup-service-state"]')
      ).toHaveText(en ? 'Configuration required' : 'À configurer');
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      if (theme === 'mineral') {
        const warning = panel.locator('[data-og7="backup-service-state"]');
        await expect(warning).toBeVisible();
        const audit = await new AxeBuilder({ page })
          .include('[data-og7="backup-service-state"]')
          .withRules(['color-contrast'])
          .analyze();
        expect(audit.violations).toEqual([]);
        expect(audit.incomplete).toEqual([]);
      }
      await expect(request).toBeDisabled();
      const bounds = await panel.boundingBox();
      const contentBounds = await page
        .locator('[data-og7="admin-setup"]')
        .boundingBox();
      expect(bounds!.width).toBeGreaterThan(contentBounds!.width * 0.97);
      await expect(panel.locator('[data-og7="backup-empty"]')).toBeVisible();
      await panel.screenshot({
        path: `test-results/admin-layout/backup-premium-${language}-${width}-activation.png`
      });
      const activation = panel.locator('[data-og7="backup-activation-open"]');
      await activation.click();
      const dialog = page.getByRole('dialog', {
        name: en
          ? 'Prepare your first backup'
          : 'Préparer votre première sauvegarde'
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('listitem')).toHaveCount(3);
      await page.keyboard.press('Shift+Tab');
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Close panel' : 'Fermer le panneau'
        })
      ).toBeFocused();
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(activation).toBeFocused();
      expect(writes).toBe(0);

      const stamp = new Date().toISOString();
      const jobs: AdminDatabaseBackup[] = Array.from(
        { length: 6 },
        (_, index) => ({
          requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          source: index % 2 ? 'manual' : 'daily',
          status: index === 2 ? 'failed' : 'succeeded',
          createdAt: new Date(
            Date.now() - (index + 1) * 86400000
          ).toISOString(),
          startedAt: new Date(
            Date.now() - (index + 1) * 86400000 + 1000
          ).toISOString(),
          finishedAt: new Date(
            Date.now() - (index + 1) * 86400000 + 60000
          ).toISOString(),
          bytes: index === 2 ? null : 268435456,
          sha256: index === 2 ? null : String(index).repeat(64),
          retainUntil: index === 2 ? null : '2099-01-01T00:00:00Z'
        })
      );
      snapshot.value = {
        ...snapshot.value,
        workerState: 'ready',
        checkedAt: stamp,
        lastWorkerAt: stamp,
        jobs
      };
      await refresh.click();
      await expect(request).toBeEnabled();
      await expect(
        panel.locator('[data-og7="backup-history-row"]')
      ).toHaveCount(5);
      await expect(
        panel.locator('[data-og7="backup-overview"]')
      ).not.toContainText(en ? 'No verified copy' : 'Aucune copie vérifiée');
      await expect(
        panel.getByText(
          en ? 'Off-server copy verified' : 'Copie hors serveur vérifiée',
          { exact: true }
        )
      ).toHaveCount(4);
      await expect(
        panel.getByText(en ? 'Backup failed' : 'Sauvegarde échouée', {
          exact: true
        })
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="setup-backups"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await expect(page.locator('body')).toHaveJSProperty(
        'scrollWidth',
        await page.evaluate(() => document.documentElement.clientWidth)
      );
      await panel.screenshot({
        path: `test-results/admin-layout/backup-premium-${language}-${width}-history.png`
      });
      await panel.locator('[data-og7="backup-history-toggle"]').click();
      await expect(
        panel.locator('[data-og7="backup-history-row"]')
      ).toHaveCount(6);
      const details = panel
        .locator('[data-og7="backup-history-row"]')
        .last()
        .getByRole('button');
      await details.click();
      const proof = page.getByRole('dialog', {
        name: en ? 'Off-server copy evidence' : 'Preuve de copie hors serveur'
      });
      await expect(proof).toContainText('5'.repeat(64));
      await expect(proof).toContainText('America/Toronto');
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(details).toBeFocused();
      await panel.locator('[data-og7="backup-history-toggle"]').click();
      await expect(
        panel.locator('[data-og7="backup-history-row"]')
      ).toHaveCount(5);
      const recovery = panel.locator('[data-og7="backup-recovery"]');
      await recovery.click();
      const recoveryDialog = page.getByRole('dialog', {
        name: en ? 'Prepare a recovery' : 'Préparer une récupération'
      });
      await expect(recoveryDialog.getByRole('listitem')).toHaveCount(3);
      await expect(recoveryDialog.getByRole('link')).toHaveAttribute(
        'href',
        '/admin/fundraiser/audit'
      );
      await page.keyboard.press('Escape');
      await expect(recovery).toBeFocused();

      snapshot.value = {
        ...snapshot.value,
        checkedAt: new Date(Date.now() - 120000).toISOString()
      };
      await refresh.click();
      await expect(
        panel.locator('[data-og7="backup-service-state"]')
      ).toHaveText(en ? 'Observation expired' : 'Observation périmée');
      await expect(request).toBeDisabled();
      snapshot.value = {
        ...snapshot.value,
        checkedAt: new Date().toISOString(),
        jobs: [{ ...jobs[0], status: 'unknown' }, ...jobs.slice(1)]
      };
      await refresh.click();
      await expect(panel.locator('[data-og7="backup-receipt"]')).toContainText(
        en ? 'operator' : 'opérateur'
      );
      await expect(request).toBeDisabled();
      accessStatus = 503;
      await refresh.click();
      await expect(panel.locator('[data-og7="backup-error"]')).toHaveCount(1);
      await expect(
        panel.locator('[data-og7="backup-service-state"]')
      ).toHaveText(en ? 'Status needs checking' : 'Statut à vérifier');
      await expect(
        panel.locator('[data-og7="backup-history-row"]')
      ).toHaveCount(5);
      await expect(request).toBeDisabled();
      accessStatus = 200;
      await refresh.click();
      await panel
        .locator('[data-og7="backup-history-row"]')
        .last()
        .getByRole('button')
        .click();
      await expect(page.locator('[data-og7="backup-evidence"]')).toBeVisible();
      accessStatus = 403;
      await page.clock.fastForward(15000);
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(
        panel.locator('[data-og7="backup-history-row"]')
      ).toHaveCount(0);
      await expect(page.locator('[data-og7="backup-evidence"]')).toHaveCount(0);
      await expect(request).toBeDisabled();
      expect(writes).toBe(0);
    });
  }
}
