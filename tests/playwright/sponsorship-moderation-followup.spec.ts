import { AxeBuilder } from '@axe-core/playwright';
import type {
  SponsorshipFollowupResponse,
  SponsorshipModerationResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  fixture,
  json,
  mock,
  token,
  visit
} from './support/sponsorship-followup.js';

const moderationSnapshot = (
  correct = false
): SponsorshipModerationResponse => ({
  items: [
    {
      decision: {
        id: '30000000-0000-4000-8000-000000000001',
        subject: {
          type: 'sponsorship',
          id: '30000000-0000-4000-8000-000000000002'
        },
        contentVersion: 5,
        policyVersion: '1.0',
        level: correct ? 'N1' : 'N4',
        primaryReason: correct ? 'MISLEADING_CLAIM' : 'DEHUMANIZATION',
        secondaryReasons: [],
        sponsorExplanation: correct
          ? 'Please correct the unsupported claim in your message.'
          : 'The submitted message dehumanizes people. You may request reconsideration.',
        createdAt: '2026-10-11T12:00:00Z',
        state: 'active',
        ...({
          internalReason: 'PRIVATE-MODERATION-NOTE-NEVER-SHOWN',
          actor: 'PRIVATE-REVIEWER-NEVER-SHOWN'
        } as object)
      },
      canCorrect: correct,
      canRequestReconsideration: true
    }
  ],
  reconsiderations: []
});

for (const english of [false, true]) {
  test(`moderation V1 private reconsideration exposes only external explanation and retains uncertain request ${english ? 'EN mobile' : 'FR desktop'}`, async ({
    page
  }) => {
    await page.setViewportSize(
      english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
    );
    const moderation = { ...moderationSnapshot() };
    const requests: Record<string, unknown>[] = [];
    await mock(page, {
      current: { ...fixture(), reviewStatus: 'rejected' },
      moderation,
      reconsideration: async (route) => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1)
          return json(route, { code: 'SYNTHETIC_UNCERTAIN' }, 503);
        moderation.reconsiderations = [
          {
            id: '30000000-0000-4000-8000-000000000003',
            decisionId: moderation.items[0].decision.id,
            state: 'open',
            createdAt: '2026-10-11T12:05:00Z'
          }
        ];
        await json(
          route,
          { id: moderation.reconsiderations[0].id, state: 'open' },
          202
        );
      }
    });
    await visit(page, english);
    const panel = page.locator('[data-og7="followup-moderation"]');
    await expect(panel).toContainText(
      'The submitted message dehumanizes people.'
    );
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE-MODERATION-NOTE-NEVER-SHOWN'
    );
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE-REVIEWER-NEVER-SHOWN'
    );
    await expect(panel.locator('[data-og7="followup-correction"]')).toHaveCount(
      0
    );
    await panel.locator('[data-og7="followup-reconsideration"]').click();
    const form = panel.locator('[data-og7="followup-reconsideration-form"]');
    await form
      .getByRole('textbox')
      .fill('Please review the full context of the submitted message.');
    const submit = form.locator('button[type="submit"]');
    await expect(submit).toBeDisabled();
    await form.getByRole('checkbox').check();
    await submit.click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await submit.click();
    await expect(panel).toContainText(
      english ? 'already open' : 'déjà en cours'
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]).toMatchObject({
      token,
      decisionId: moderation.items[0].decision.id,
      explanation: 'Please review the full context of the submitted message.'
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="followup-moderation"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });

  test(`moderation V1 N1 corrects a rejected dossier without calling legacy autosave or restoring approval ${english ? 'EN mobile' : 'FR desktop'}`, async ({
    page
  }) => {
    await page.setViewportSize(
      english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
    );
    let current: SponsorshipFollowupResponse = {
      ...fixture(),
      reviewStatus: 'rejected'
    };
    const moderation = { ...moderationSnapshot(true) };
    const corrections: Record<string, unknown>[] = [];
    let legacySaves = 0;
    await mock(page, {
      current,
      moderation,
      draft: { revision: 4, data: null, updatedAt: null },
      get: (route) => json(route, current),
      correction: async (route) => {
        const payload = route.request().postDataJSON();
        corrections.push(payload);
        current = {
          ...current,
          ...payload.data,
          reviewStatus: 'pending_review'
        };
        moderation.items = [];
        await json(route, {
          received: true,
          recorded: true,
          revision: 5,
          contentVersion: 6
        });
      }
    });
    await page.route('**/api/sponsorship-followup/draft', async (route) => {
      if (route.request().method() === 'POST') {
        legacySaves++;
        return json(route, { code: 'SPONSORSHIP_NOT_EDITABLE' }, 409);
      }
      return json(route, { revision: 4, data: null, updatedAt: null });
    });
    await visit(page, english);
    const firstField = page.getByLabel(
      english ? 'Company name' : "Nom de l'entreprise",
      { exact: false }
    );
    await expect(firstField).toBeDisabled();
    await page.locator('[data-og7="followup-correction"]').click();
    await expect(firstField).toBeFocused();
    await firstField.fill('Corrected synthetic workshop');
    await page
      .getByRole('button', {
        name: english
          ? 'Submit my information to the team'
          : 'Soumettre mes informations à l’équipe',
        exact: true
      })
      .click();
    await expect.poll(() => corrections.length).toBe(1);
    expect(corrections[0]).toMatchObject({
      token,
      decisionId: '30000000-0000-4000-8000-000000000001',
      expectedRevision: 4,
      data: { companyName: 'Corrected synthetic workshop' }
    });
    expect(legacySaves).toBe(0);
    await expect(
      page
        .locator('[data-og7="followup-summary"] [aria-current="step"]')
        .getByRole('heading', {
          name: english ? 'OpenG7 review' : 'Révision OpenG7',
          exact: true
        })
    ).toBeVisible();
    await expect(page.locator('[data-og7="followup-correction"]')).toHaveCount(
      0
    );
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE-MODERATION-NOTE-NEVER-SHOWN'
    );
  });
}
