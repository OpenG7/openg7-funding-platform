import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { AdminEmailQueueMessageRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const date = '2026-09-23T12:00:00Z';
const refreshedDate = '2026-09-24T12:00:00Z';
const failedMessage: AdminEmailQueueMessageRecord = {
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
const sentMessage: AdminEmailQueueMessageRecord = {
  ...failedMessage,
  status: 'sent',
  attempts: 2,
  next_attempt_at: refreshedDate,
  sent_at: refreshedDate,
  last_error: null,
  updated_at: refreshedDate
};

// The scoped row is only one message; these server totals include the whole queue.
const queueSnapshot = (sent: boolean) => ({
  data_source: 'database',
  messages: [sent ? sentMessage : failedMessage],
  last_updated_at: sent ? refreshedDate : date,
  summary: {
    queued_count: 11,
    sending_count: 3,
    ...(sent
      ? { sent_count: 41, failed_count: 6, retryable_count: 20 }
      : { sent_count: 40, failed_count: 7, retryable_count: 21 }),
    last_failed_at: date,
    last_error: null
  }
});

async function preparePage(page: Page, language: string, width: number) {
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
}

async function expectSentQueue(page: Page, english: boolean) {
  const row = page
    .getByRole('row')
    .filter({ hasText: failedMessage.recipient_email });
  await expect(
    row.getByRole('cell', { name: english ? 'Sent' : 'Envoye', exact: true })
  ).toBeVisible();
  await expect(row.locator('[data-og7="email-retry-result"]')).toHaveText(
    english ? 'Message sent.' : 'Message envoye.'
  );
  await expect(
    row.getByRole('button', {
      name: english ? 'Retry' : 'Relancer',
      exact: true
    })
  ).toBeDisabled();
  await expect(
    row.getByText('EMAIL_CONNECTION_ERROR', { exact: true })
  ).toHaveCount(0);
}

async function expectReconciledTotals(page: Page, english: boolean) {
  const summary = page.getByRole('region', {
    name: english ? 'Email queue summary' : 'Resume file courriel',
    exact: true
  });
  for (const [label, total] of [
    [english ? 'Queued' : 'En file', '11'],
    [english ? 'Sending' : 'Envoi', '3'],
    [english ? 'Sent' : 'Envoyes', '41'],
    [english ? 'Failures' : 'Echecs', '6']
  ]) {
    await expect(
      summary
        .locator('article')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('strong')
    ).toHaveText(total);
  }
  await expect(
    summary.getByText(english ? '20 eligible for retry' : '20 relancable(s)', {
      exact: true
    })
  ).toBeVisible();
  await expect(snapshotDate(page, english)).toContainText('24');
}

function snapshotDate(page: Page, english: boolean) {
  return page
    .getByRole('region', {
      name: english ? 'Email queue summary' : 'Resume file courriel',
      exact: true
    })
    .locator('article')
    .filter({
      has: page.getByText(english ? 'Updated' : 'Mis a jour', { exact: true })
    })
    .locator('strong');
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    test(`email retries preserve confirmation, in-flight state and accepted outcome in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await preparePage(page, language, width);
      let message = { ...failedMessage };
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
          message = {
            ...message,
            status: mode,
            sent_at: mode === 'sent' ? refreshedDate : null,
            last_error: mode === 'failed' ? 'EMAIL_CONNECTION_ERROR' : null
          };
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
                sending_count: message.status === 'sending' ? 1 : 0,
                sent_count: message.status === 'sent' ? 1 : 0,
                failed_count: message.status === 'failed' ? 1 : 0,
                retryable_count: message.status === 'sent' ? 0 : 1,
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

    for (const scenario of ['stale refresh', 'failed reconciliation'] as const)
      test(`email queue retry keeps accepted results through ${scenario} in ${language} at ${width}px`, async ({
        page
      }) => {
        const english = language === 'en';
        await preparePage(page, language, width);
        const scopes: (string | null)[] = [];
        const retries: unknown[] = [];
        const readFailure = 'Synthetic queue read failure';
        let releaseOld: (() => void) | undefined;
        await page.route('**/api/**', async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname.endsWith('/email-queue/retry')) {
            retries.push(route.request().postDataJSON());
            return route.fulfill({
              json: {
                attempted: 1,
                sent: 1,
                failed: 0,
                messageIds: [failedMessage.id],
                sentMessageIds: [failedMessage.id],
                failedMessageIds: [],
                message: sentMessage
              }
            });
          }
          if (url.pathname.endsWith('/email-queue')) {
            scopes.push(url.searchParams.get('messageId'));
            const ordinal = scopes.length;
            if (ordinal === 2) {
              if (scenario === 'failed reconciliation')
                return route.fulfill({
                  status: 503,
                  json: { error: readFailure }
                });
              await new Promise<void>((resolve) => {
                releaseOld = resolve;
              });
              return width === 1280
                ? route.fulfill({ status: 503, json: { error: readFailure } })
                : route.fulfill({ json: queueSnapshot(false) });
            }
            return route.fulfill({ json: queueSnapshot(ordinal > 1) });
          }
          return route.fulfill({ status: 503, json: {} });
        });
        await page.goto(
          `/admin/fundraiser/email-queue?messageId=${failedMessage.id}`
        );
        const row = page
          .getByRole('row')
          .filter({ hasText: failedMessage.recipient_email });
        const refresh = page.getByRole('button', {
          name: english ? 'Refresh' : 'Actualiser',
          exact: true
        });
        await expect(
          page.locator('[data-og7="attention-object-target"]')
        ).toContainText(failedMessage.id);
        if (scenario === 'stale refresh') {
          await refresh.click();
          await expect.poll(() => releaseOld !== undefined).toBe(true);
        }
        await row
          .getByRole('button', {
            name: english ? 'Retry' : 'Relancer',
            exact: true
          })
          .click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expectSentQueue(page, english);
        const error = page.getByText(readFailure, { exact: true });
        if (scenario === 'stale refresh') {
          await expect.poll(() => scopes.length).toBe(3);
          await expectReconciledTotals(page, english);
          const olderResponse = page.waitForResponse((response) =>
            new URL(response.url()).pathname.endsWith('/email-queue')
          );
          releaseOld!();
          await (await olderResponse).finished();
        } else {
          await expect(error).toBeVisible();
          await expect(row.getByText(readFailure, { exact: true })).toHaveCount(
            0
          );
          await expectSentQueue(page, english);
          await expect(snapshotDate(page, english)).toContainText('23');
          await refresh.click();
        }
        await expectSentQueue(page, english);
        await expectReconciledTotals(page, english);
        await expect(error).toHaveCount(0);
        expect(scopes).toEqual([
          failedMessage.id,
          failedMessage.id,
          failedMessage.id
        ]);
        expect(retries).toEqual([{ messageId: failedMessage.id }]);
        expect(new URL(page.url()).searchParams.get('messageId')).toBe(
          failedMessage.id
        );
      });
  }
}
