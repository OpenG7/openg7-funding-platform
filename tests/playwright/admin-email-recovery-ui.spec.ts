import { AxeBuilder } from '@axe-core/playwright';
import type { AdminEmailQueueMessageRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    test(`email retries preserve confirmation, in-flight state and accepted outcome in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
        sessionStorage.setItem(
          'openg7-admin-session-token',
          'openg7-admin-session.email-fixture'
        );
        sessionStorage.setItem(
          'openg7-admin-session-expires-at',
          '2099-01-01T00:00:00Z'
        );
      }, language);
      const date = '2026-09-23T12:00:00Z';
      let message: AdminEmailQueueMessageRecord = {
        id: '10000000-0000-4000-8000-000000000701',
        template_key: 'sponsorship_access_recovery',
        recipient_email: 'company@example.test',
        from_email: 'sender@example.test',
        reply_to_email: null,
        subject: 'Private access',
        status: 'failed',
        attempts: 1,
        max_attempts: 5,
        next_attempt_at: date,
        sent_at: null,
        last_error: 'EMAIL_CONNECTION_ERROR',
        metadata: {},
        created_at: date,
        updated_at: date
      };
      let mode: 'sending' | 'sent' | 'failed' = 'sending';
      let calls = 0;
      let release: (() => void) | undefined;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/email-queue/retry')) {
          calls++;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          message = { ...message, status: mode };
          return route.fulfill({
            json: {
              attempted: mode === 'failed' ? 1 : 0,
              sent: 0,
              failed: mode === 'failed' ? 1 : 0,
              messageIds: [],
              sentMessageIds: [],
              failedMessageIds: [],
              message
            }
          });
        }
        if (path.endsWith('/email-queue'))
          return route.fulfill({
            json: {
              data_source: 'database',
              messages: [message],
              last_updated_at: date,
              summary: {
                queued_count: 0,
                sending_count: 0,
                sent_count: 0,
                failed_count: 1,
                retryable_count: 1,
                last_failed_at: date,
                last_error: null
              }
            }
          });
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/email-queue');
      const row = page
        .getByRole('row')
        .filter({ hasText: message.recipient_email });
      const retry = row.getByRole('button', {
        name: english ? 'Retry' : 'Relancer',
        exact: true
      });
      await retry.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toContainText(
        message.recipient_email
      );
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page
        .getByRole('dialog')
        .getByRole('button', {
          name: english ? 'Cancel' : 'Annuler',
          exact: true
        })
        .filter({ hasText: english ? 'Cancel' : 'Annuler' })
        .click();
      expect(calls).toBe(0);
      await expect(retry).toBeEnabled();
      await expect(retry).toBeFocused();
      const result = row.locator('[data-og7="email-retry-result"]');
      for (const outcome of ['sending', 'failed', 'sent'] as const) {
        mode = outcome;
        await retry.click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expect
          .poll(() => calls)
          .toBe(['sending', 'failed', 'sent'].indexOf(outcome) + 1);
        await expect(
          row.getByRole('button', {
            name: english ? 'Retrying…' : 'Relance...',
            exact: true
          })
        ).toBeDisabled();
        release!();
        const expected =
          outcome === 'sending'
            ? english
              ? 'Delivery is already in progress'
              : 'Un envoi est déjà en cours'
            : outcome === 'failed'
              ? english
                ? 'the message is still failing'
                : 'le message reste en echec'
              : english
                ? 'Message sent.'
                : 'Message envoye.';
        await expect(result).toContainText(expected);
        await expect(result).toHaveAttribute('role', 'status');
      }
      await expect(retry).toBeDisabled();
      expect(calls).toBe(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      const axe = await new AxeBuilder({ page }).include('main').analyze();
      expect(axe.violations).toEqual([]);
    });
  }
}
