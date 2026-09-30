import type { AdminEmailTestResult } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { setupFixture } from './support/setup-fixtures.js';

const setup = setupFixture();

for (const language of ['fr-CA', 'en']) {
  test(`setup separates queued, sending, failed and SMTP-accepted outcomes in ${language}`, async ({
    page
  }) => {
    const english = language === 'en';
    await page.setViewportSize({ width: english ? 390 : 1280, height: 950 });
    await page.addInitScript((locale) => {
      localStorage.setItem('openg7.language', locale);
      sessionStorage.setItem(
        'openg7-admin-session-token',
        'openg7-admin-session.setup-fixture'
      );
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2099-01-01T00:00:00Z'
      );
    }, language);
    let status: AdminEmailTestResult['status'] = 'queued';
    let requestId = '';
    let calls = 0;
    let setupFailed = false;
    const id = '10000000-0000-4000-8000-000000000701';
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/setup-status'))
        return route.fulfill({
          status: setupFailed ? 503 : 200,
          json: setupFailed ? {} : setup
        });
      if (path.endsWith('/email/test')) {
        if (route.request().method() === 'POST') {
          calls++;
          requestId = route.request().postDataJSON().requestId;
        }
        return route.fulfill({
          json: {
            requestId,
            messageId: id,
            to: 'admin@example.test',
            status,
            queued: status !== 'sent',
            attempted: status !== 'queued',
            sent: status === 'sent',
            error: status === 'failed' ? 'EMAIL_CONNECTION_ERROR' : null,
            deliveryMode: 'smtp'
          } satisfies AdminEmailTestResult
        });
      }
      return route.fulfill({ status: 503, json: {} });
    });
    await page.goto('/admin/fundraiser/setup');
    await page
      .getByRole('button', {
        name: english ? 'Send test' : 'Envoyer un test',
        exact: true
      })
      .click();
    const result = page.locator('[data-og7="setup-email-result"]');
    await expect(result).toContainText(
      english ? 'Test queued' : 'Test mis en file'
    );
    await expect(result).not.toContainText(
      english ? 'accepted by' : 'accepté par'
    );
    for (const [next, expected] of [
      ['sending', english ? 'Sending in progress' : 'Envoi en cours'],
      ['failed', english ? 'could not be sent' : 'a échoué'],
      [
        'sent',
        english ? 'accepted by the SMTP server' : 'accepté par le serveur SMTP'
      ]
    ] as const) {
      status = next;
      await page
        .getByRole('button', {
          name: english ? 'Check test result' : 'Vérifier le résultat du test',
          exact: true
        })
        .click();
      await expect(result).toContainText(expected);
    }
    expect(calls).toBe(1);
    await expect(
      page.locator('[data-og7="setup-email-queue"]')
    ).toHaveAttribute('href', '/admin/fundraiser/email-queue?messageId=' + id);
    setupFailed = true;
    await page
      .getByRole('button', {
        name: english ? 'Refresh' : 'Actualiser',
        exact: true
      })
      .click();
    await expect(
      page.getByRole('textbox', {
        name: english ? 'Test email' : 'Courriel de test',
        exact: true
      })
    ).toHaveCount(0);
    await expect(page.locator('[data-og7="setup-email-queue"]')).toHaveCount(0);
    setupFailed = false;
    await page
      .getByRole('button', {
        name: english ? 'Refresh' : 'Actualiser',
        exact: true
      })
      .click();
    await expect(result).toContainText(english ? 'accepted by' : 'accepté par');
    await page
      .getByRole('textbox', {
        name: english ? 'Test email' : 'Courriel de test',
        exact: true
      })
      .fill('another@example.test');
    await expect(result).toHaveCount(0);
    await expect(page.locator('[data-og7="setup-email-queue"]')).toHaveCount(0);
    expect(calls).toBe(1);
  });
}
