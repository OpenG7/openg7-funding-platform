import type { AdminEmailTestResult } from '@openg7/funding-core';
import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';
import {
  installAdminTokenSession,
  setupFixture
} from './support/setup-fixtures.js';

const setup = setupFixture();

for (const language of ['fr-CA', 'en']) {
  test(`setup separates queued, sending, failed and SMTP-accepted outcomes in ${language}`, async ({
    page
  }) => {
    const english = language === 'en';
    await page.setViewportSize({ width: english ? 390 : 1280, height: 950 });
    await installAdminTokenSession(
      page,
      'openg7-admin-session.setup-fixture',
      language
    );
    let status: AdminEmailTestResult['status'] = 'queued';
    let requestId = '';
    let calls = 0;
    const recoveredIds: (string | null)[] = [];
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
        } else
          recoveredIds.push(
            new URL(route.request().url()).searchParams.get('requestId')
          );
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
    const originalRequestId = requestId;
    expect(originalRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    await page.reload();
    await expect(result).toContainText(
      english ? 'Test queued' : 'Test mis en file'
    );
    expect(recoveredIds).toEqual([originalRequestId]);
    expect(calls).toBe(1);
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

async function installRecoveryFixtures(page: Page, language: string) {
  await installAdminTokenSession(
    page,
    'openg7-admin-session.setup-recovery-fixture',
    language
  );
  const data = {
    postStatus: 200,
    getStatus: 200,
    outcome: 'queued' as AdminEmailTestResult['status'],
    requestId: '',
    writes: 0,
    readIds: [] as (string | null)[]
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/setup-status'))
      return route.fulfill({ json: setup });
    if (url.pathname.endsWith('/email/test')) {
      const post = route.request().method() === 'POST';
      if (post) {
        data.writes++;
        data.requestId = route.request().postDataJSON().requestId;
      } else data.readIds.push(url.searchParams.get('requestId'));
      const status = post ? data.postStatus : data.getStatus;
      return route.fulfill({
        status,
        json:
          status === 200
            ? ({
                requestId: data.requestId,
                messageId: '10000000-0000-4000-8000-000000000703',
                to: 'admin@example.test',
                status: data.outcome,
                queued: data.outcome !== 'sent',
                attempted: data.outcome !== 'queued',
                sent: data.outcome === 'sent',
                error: null,
                deliveryMode: 'smtp'
              } satisfies AdminEmailTestResult)
            : {}
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return data;
}

for (const language of ['fr-CA', 'en']) {
  test(`setup recovers an uncertain email request without resending in ${language}`, async ({
    page
  }) => {
    const english = language === 'en';
    await page.setViewportSize({ width: english ? 390 : 1280, height: 950 });
    const data = await installRecoveryFixtures(page, language);
    data.postStatus = 503;
    await page.goto('/admin/fundraiser/setup');
    const send = page.getByRole('button', {
      name: english ? 'Send test' : 'Envoyer un test',
      exact: true
    });
    const check = page.getByRole('button', {
      name: english ? 'Check test result' : 'Vérifier le résultat du test',
      exact: true
    });
    const result = page.locator('[data-og7="setup-email-result"]');
    await send.click();
    await expect(result).toContainText(
      english ? 'Result unconfirmed' : 'Résultat non confirmé'
    );
    await expect(send).toBeDisabled();
    await expect(
      page.getByRole('textbox', {
        name: english ? 'Test email' : 'Courriel de test',
        exact: true
      })
    ).toBeDisabled();
    const originalId = data.requestId;
    data.getStatus = 503;
    await check.click();
    await expect(result).toContainText(
      english ? 'Result unconfirmed' : 'Résultat non confirmé'
    );
    await expect(send).toBeDisabled();
    data.getStatus = 200;
    await check.click();
    await expect(result).toContainText(
      english ? 'Test queued' : 'Test mis en file'
    );
    data.outcome = 'sent';
    await page.reload();
    await expect(result).toContainText(
      english ? 'accepted by the SMTP server' : 'accepté par le serveur SMTP'
    );
    expect(data.readIds).toEqual([originalId, originalId, originalId]);
    expect(data.writes).toBe(1);
  });

  test(`setup consultation survives unavailable email request storage in ${language}`, async ({
    page
  }) => {
    const english = language === 'en';
    const data = await installRecoveryFixtures(page, language);
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('openg7-email-test:'))
          throw new DOMException(
            'Synthetic denied storage',
            'QuotaExceededError'
          );
        original.call(this, key, value);
      };
    });
    await page.goto('/admin/fundraiser/setup');
    await page
      .getByRole('button', {
        name: english ? 'Send test' : 'Envoyer un test',
        exact: true
      })
      .click();
    await expect(page.locator('#setup-email').getByRole('alert')).toContainText(
      english
        ? 'cannot retain the test identifier'
        : 'ne peut pas conserver l’identifiant du test'
    );
    await expect(
      page.getByRole('textbox', {
        name: english ? 'Test email' : 'Courriel de test',
        exact: true
      })
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Guide', exact: true })
    ).toBeEnabled();
    expect(data.writes).toBe(0);
    expect(data.readIds).toEqual([]);
  });

  for (const status of [401, 403]) {
    test(`setup email consultation clears private data after ${status} in ${language}`, async ({
      page
    }) => {
      const english = language === 'en';
      const data = await installRecoveryFixtures(page, language);
      await page.goto('/admin/fundraiser/setup');
      await page
        .getByRole('button', {
          name: english ? 'Send test' : 'Envoyer un test',
          exact: true
        })
        .click();
      await expect(
        page.locator('[data-og7="setup-email-queue"]')
      ).toBeVisible();
      const originalId = data.requestId;
      data.getStatus = status;
      await page
        .getByRole('button', {
          name: english ? 'Check test result' : 'Vérifier le résultat du test',
          exact: true
        })
        .click();
      await expect(
        page.locator('[data-og7="admin-setup"] > p[role="alert"]')
      ).toContainText(
        status === 401
          ? english
            ? 'session expired or was revoked'
            : 'session a expiré ou a été révoquée'
          : english
            ? 'reserved for the owner'
            : 'réservés au propriétaire'
      );
      await expect(
        page.getByRole('textbox', {
          name: english ? 'Test email' : 'Courriel de test',
          exact: true
        })
      ).toHaveCount(0);
      await expect(page.locator('[data-og7="setup-email-queue"]')).toHaveCount(
        0
      );
      await expect(
        page.getByRole('button', { name: 'Guide', exact: true })
      ).toBeDisabled();
      expect(data.writes).toBe(1);
      expect(data.readIds).toEqual([originalId]);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('openg7-email-test:token')
        )
      ).toBe(originalId);
    });
  }
}
