import type { ContributionActivityItem } from '@openg7/funding-core';
import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

/** Real notification component and decision panels, with synthetic endpoint fixtures. */
export function registerContributionActivityOverlayTests(ports: {
  setup(page: Page): Promise<void>;
  sponsorshipId: string;
}): void {
  for (const english of [false, true]) {
    test(`contribution notifications preserve N4 decisions and keyboard history ${english ? 'EN mobile' : 'FR desktop'}`, async ({
      page
    }) => {
      await ports.setup(page);
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const activity: ContributionActivityItem[] = [7403, 7402, 7401].map(
        (id) => ({
          id: String(id),
          contributionId: ports.sponsorshipId,
          reference: 'DEMO-NOTIFICATION-' + id,
          companyName: 'Atelier notification persistante ' + id,
          amountMinor: 50000,
          currency: 'CAD',
          confirmedAt: '2026-10-11T12:00:00Z',
          revision: 1,
          preparation: {
            state: 'worker_stopped',
            reasons: ['payment_confirmed', 'worker_stopped', 'review_required'],
            cartouche: null
          },
          email: 'not_configured',
          sms: 'disabled',
          simulatedSms: false,
          adminUrl: '/admin/fundraiser/sponsors',
          history: [
            {
              revision: 1,
              state: 'worker_stopped',
              reasons: ['worker_stopped'],
              at: '2026-10-11T12:00:00Z'
            }
          ]
        })
      );
      const claims: string[][] = [];
      const reviews: unknown[] = [];
      let activityReads = 0;
      await page.route(
        '**/api/admin/contribution-activity**',
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() === 'POST') {
            const { ids } = request.postDataJSON() as { ids: string[] };
            claims.push(ids);
            return route.fulfill({ json: { ids } });
          }
          activityReads++;
          const id = url.searchParams.get('id');
          return route.fulfill({
            json: {
              items: id
                ? activity.filter((item) => item.id === id)
                : url.searchParams.has('after')
                  ? []
                  : activity,
              hasMore: false
            }
          });
        }
      );
      await page.route('**/api/admin/sponsorships/review', (route) => {
        reviews.push(route.request().postDataJSON());
        return route.fulfill({ json: { updated: true } });
      });
      await page.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' + ports.sponsorshipId
      );
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const notifications = page.locator(
        '[data-og7="contribution-notifications"]'
      );
      const toasts = notifications.locator('[data-og7="contribution-toast"]');
      await expect(toasts).toHaveCount(3);
      await expect(notifications).toBeVisible();
      const decisionActions = page.locator('[data-og7="dossier-actions"]');
      const reject = decisionActions.getByRole('button', {
        name: english ? 'Reject' : 'Refuser',
        exact: true
      });
      await reject.scrollIntoViewIfNeeded();
      const toastBox = await notifications.boundingBox();
      const actionBox = await reject.boundingBox();
      expect(toastBox).not.toBeNull();
      expect(actionBox).not.toBeNull();
      expect(
        toastBox!.x < actionBox!.x + actionBox!.width &&
          toastBox!.x + toastBox!.width > actionBox!.x &&
          toastBox!.y < actionBox!.y + actionBox!.height &&
          toastBox!.y + toastBox!.height > actionBox!.y
      ).toBe(false);
      await reject.click();
      const refusal = page.locator('[data-og7="dossier-rejection-form"]');
      await refusal
        .getByLabel(english ? /^Internal rationale/ : /^Justification interne/)
        .fill('PRIVATE-NOTIFICATION-REGRESSION');
      await refusal
        .getByLabel(
          english ? /^Message to sponsor/ : /^Message au commanditaire/
        )
        .fill('Synthetic external explanation for the reviewed dossier.');
      await refusal
        .getByRole('checkbox', {
          name: english
            ? 'Send rejection email'
            : 'Envoyer le courriel de refus'
        })
        .uncheck();
      const confirm = refusal.getByRole('button', {
        name: english ? 'Confirm rejection' : 'Confirmer le refus',
        exact: true
      });
      await confirm.click();
      const panel = page.locator('[data-og7="moderation-decision"]');
      await expect(panel).toBeVisible();
      await expect(notifications).toBeHidden();
      await expect(toasts).toHaveCount(3);
      expect(reviews).toHaveLength(0);
      const readsBeforeDecision = activityReads;
      await expect
        .poll(() => activityReads)
        .toBeGreaterThan(readsBeforeDecision);
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(notifications).toBeVisible();
      expect(reviews).toHaveLength(0);
      await confirm.click();
      await expect(panel).toBeVisible();
      await panel
        .locator('[data-og7="moderation-primary-reason"]')
        .selectOption('DEHUMANIZATION');
      const approval = panel.locator('[data-og7="moderation-submit"]');
      await expect(approval).toBeDisabled();
      await panel.locator('[data-og7="moderation-confirmation"]').check();
      await approval.click();
      await expect.poll(() => reviews.length).toBe(1);
      expect(reviews[0]).toMatchObject({
        contributionId: ports.sponsorshipId,
        expectedVersion: 'v1',
        confirmation: ports.sponsorshipId,
        reviewStatus: 'rejected',
        notifySponsor: false,
        refundHandling: 'none',
        moderationDecision: {
          policyVersion: '1.0',
          contentVersion: 3,
          contentFingerprint: 'a'.repeat(64),
          level: 'N4',
          primaryReason: 'DEHUMANIZATION',
          internalReason: 'PRIVATE-NOTIFICATION-REGRESSION',
          sponsorExplanation:
            'Synthetic external explanation for the reviewed dossier.',
          confirmation: ports.sponsorshipId
        }
      });
      await expect(refusal).toHaveCount(0);
      await expect(decisionActions).toContainText(
        english ? 'another authorized person' : 'autre personne habilitée'
      );
      await expect(notifications).toBeVisible();
      await expect(toasts).toHaveCount(3);
      expect(claims).toEqual([activity.map((item) => item.id)]);
      const openHistory = page.locator(
        '[data-og7="contribution-activity-open"]'
      );
      await openHistory.focus();
      await page.keyboard.press('Enter');
      const history = page.getByRole('dialog', {
        name: english ? 'Contributions received' : 'Contributions reçues',
        exact: true
      });
      await expect(history).toBeVisible();
      await expect(notifications).toBeHidden();
      const row = history.locator('[data-og7-id="7401"]');
      await row.focus();
      await page.keyboard.press('Enter');
      await expect(history).toContainText('DEMO-NOTIFICATION-7401');
      await expect(
        history.getByRole('heading', {
          name: english ? 'Processing steps' : 'Étapes du traitement',
          exact: true
        })
      ).toBeVisible();
      await expect(history).not.toContainText(
        'PRIVATE-NOTIFICATION-REGRESSION'
      );
      await page.keyboard.press('Escape');
      await expect(history).toBeHidden();
      await expect(openHistory).toBeFocused();
      await expect(notifications).toBeVisible();
      expect(claims).toHaveLength(1);
    });
  }
}
