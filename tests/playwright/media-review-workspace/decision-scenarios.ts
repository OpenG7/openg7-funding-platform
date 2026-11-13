import type { Page } from '@playwright/test';
import type {
  AdminAssistantContextResponse,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse,
  AdminInformationRequest,
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import { test, expect } from '../support/test.js';

import {
  area,
  createMediaWorkspaceFixture,
  type MediaWorkspaceTestContext
} from './fixture.js';
import { registerApproveAllMediaTests } from './approve-all-scenarios.js';

function addPlatformAcceptance(
  asset: SponsorMediaWorkspaceAsset,
  locale: 'fr-CA' | 'en' = 'fr-CA'
): void {
  Object.assign(asset, {
    usageSource: 'media',
    ruleId: null,
    usageAcceptance: {
      id: 'synthetic-platform-acceptance',
      termsVersion: 'synthetic-media-terms-v1',
      termsFingerprint: 'f'.repeat(64),
      locale,
      acceptedAt: '2026-11-09T15:20:00.000Z',
      source: 'platform_acceptance'
    }
  });
}

function pendingPhotos(state: SponsorMediaWorkspace): void {
  for (const asset of state.assets.slice(0, 2))
    Object.assign(asset, {
      kind: 'supporting_image',
      usageAcceptance: undefined,
      usageSource: 'media',
      ruleId: null,
      usage: {
        state: 'needs_confirmation',
        channels: [],
        targets: [],
        transformations: [],
        credit: null,
        restrictions: null
      },
      readiness: {
        state: 'blocked',
        reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
      }
    });
}

/** One dossier message and a server-owned two-photo snapshot; no mail provider runs. */
async function photoConsentRequestFixture(
  page: Page,
  state: SponsorMediaWorkspace,
  language: 'fr-CA' | 'en' = 'fr-CA'
) {
  const requests = {
    contextReads: [] as URL[],
    preparations: [] as AdminAssistantPrepareRequest[],
    posts: [] as AdminInformationRequest[],
    receiptReads: [] as URL[],
    consentWrites: [] as string[],
    dropResponse: false,
    applicable: true
  };
  const english = language === 'en';
  const at = '2026-11-10T15:20:00.000Z';
  const recipient = 'synthetic-photo-contact@example.invalid';
  const subject = english
    ? 'Permission for your photos'
    : 'Autorisation de vos photos';
  const linkNotice = english
    ? 'One private link is added automatically after delivery is confirmed.'
    : 'Un seul lien privé est ajouté automatiquement après confirmation de l’envoi.';
  const body = [
    english
      ? 'Please review the following photos using one private link.'
      : 'Veuillez examiner les photos suivantes depuis un seul lien privé.',
    ...state.assets.slice(0, 2).map((asset) => asset.originalFilename),
    english
      ? 'Sending this request does not record your consent.'
      : 'L’envoi de cette demande ne consigne pas votre consentement.'
  ].join('\n\n');
  const mediaSnapshot = state.assets.slice(0, 2).map((asset) => ({
    id: asset.id,
    version: asset.version
  }));
  const context: AdminAssistantContextResponse = {
    status: 'ok',
    generatedAt: at,
    conversationMode: 'disabled',
    context: {
      contributionId: state.contributionId,
      reference: 'SYNTHETIC-PHOTO-CONSENT',
      version: 'a'.repeat(64),
      paymentStatus: 'paid',
      refundStatus: 'not_requested',
      reviewStatus: 'approved',
      feedStatus: 'not_planned',
      publicConsent: true,
      missingFields: [],
      media: {
        total: state.assets.length,
        approved: 0,
        pending: state.assets.length,
        rejected: 0
      },
      promisedChannels: ['facebook'],
      coveredChannels: [],
      nextStep: 'review_media',
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${state.contributionId}&tab=media`,
      canRequestInformation: false
    }
  };
  const proposal: AdminAssistantPrepareResponse = {
    status: 'ok',
    message: null,
    draft: {
      type: 'sponsorship_media_consent_request',
      title: subject,
      generatedAt: at,
      reference: state.contributionId,
      sent: false,
      published: false,
      persisted: false,
      fields: [{ label: english ? 'Subject' : 'Objet', value: subject }],
      bodyLines: [body],
      notice: `${english ? 'No email sent.' : 'Aucun courriel envoyé.'} ${linkNotice}`,
      limitations: [],
      adminUrl: context.context!.adminUrl
    },
    delivery: {
      contributionId: state.contributionId,
      contextVersion: context.context!.version,
      recipient,
      subject,
      body,
      purpose: 'media_consent',
      language,
      mediaSnapshot
    }
  };
  const receipt = (requestId: string) => ({
    requestId,
    contributionId: state.contributionId,
    found: true,
    messageId: '80000000-0000-4000-8000-000000000002',
    acceptedAt: at,
    deliveryStatus: 'queued',
    sentAt: null
  });
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/(?:sponsorships\/(?:consent|media\/(?:usage|rules|batch\/execute))|sponsorship-followup\/media\/usage)(?:\?|$)/.test(
        new URL(request.url()).pathname
      )
    )
      requests.consentWrites.push(request.url());
  });
  await page.route('**/api/admin/assistant/context?*', (route) => {
    requests.contextReads.push(new URL(route.request().url()));
    return route.fulfill({ json: context });
  });
  await page.route('**/api/admin/assistant/prepare', (route) => {
    requests.preparations.push(route.request().postDataJSON());
    return route.fulfill({
      json: requests.applicable
        ? proposal
        : {
            status: 'not_applicable',
            draft: null,
            message: 'No current photos or contact available.'
          }
    });
  });
  await page.route(
    '**/api/admin/sponsorships/request-information',
    async (route) => {
      const input = route.request().postDataJSON() as AdminInformationRequest;
      requests.posts.push(input);
      if (requests.dropResponse) return route.abort('failed');
      return route.fulfill({
        json: { ...receipt(input.requestId), status: 'queued' }
      });
    }
  );
  await page.route(
    '**/api/admin/sponsorships/information-request-receipt?*',
    (route) => {
      const url = new URL(route.request().url());
      requests.receiptReads.push(url);
      return route.fulfill({
        json: receipt(url.searchParams.get('requestId') ?? '')
      });
    }
  );
  return Object.assign(requests, {
    proposal,
    recipient,
    subject,
    body,
    linkNotice,
    mediaSnapshot
  });
}

export function registerMediaWorkspaceDecisionTests(
  context: MediaWorkspaceTestContext
): void {
  registerApproveAllMediaTests(context);
  const fixture = createMediaWorkspaceFixture(context);
  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    for (const entry of ['dossier', 'pending'] as const) {
      test(`one photo consent request requires confirmed delivery for the dossier from ${entry} ${language}`, async ({
        page
      }) => {
        const { state, calls } = await fixture(page);
        pendingPhotos(state);
        const originalPhotos = structuredClone(state.assets.slice(0, 2));
        const requests = await photoConsentRequestFixture(
          page,
          state,
          language
        );
        const english = language === 'en';
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(context.path('media'));
        if (english)
          await page
            .getByRole('button', {
              name: 'Switch administration language to English'
            })
            .click();
        if (entry === 'pending') {
          await area(page)
            .locator('[data-og7="media-tile"]')
            .first()
            .getByRole('button')
            .click();
          await area(page)
            .locator('[data-og7="media-inspector-approve"]')
            .click();
        }
        const opener = page.locator(
          `[data-og7="${entry === 'dossier' ? 'media-consent-request-open' : 'media-acceptance-request-consent'}"]`
        );
        await expect(opener).toHaveText(
          english
            ? 'Request consent for photos'
            : 'Demander le consentement des photos'
        );
        await opener.focus();
        await opener.press('Enter');
        const drawer = page.getByRole('dialog', {
          name: english
            ? 'Request consent for photos'
            : 'Demander le consentement des photos',
          exact: true
        });
        const panel = drawer.locator('[data-og7="media-consent-request"]');
        const form = panel.locator('[data-og7="assistant-information-form"]');
        await expect(form).toBeVisible();
        expect(requests.preparations).toEqual([
          {
            type: 'sponsorship_media_consent_request',
            reference: state.contributionId,
            language
          }
        ]);
        expect(
          requests.contextReads.map((url) =>
            url.searchParams.get('sponsorshipId')
          )
        ).toEqual([state.contributionId]);
        const recipient = form.getByLabel(
          english ? 'Recipient' : 'Destinataire',
          { exact: true }
        );
        await expect(recipient).toHaveValue(requests.recipient);
        await expect(recipient).toHaveAttribute('readonly', '');
        await expect(form.getByLabel('Message', { exact: true })).toHaveValue(
          requests.body
        );
        await expect(panel).toContainText(requests.linkNotice);
        expect(requests.body).not.toMatch(/\{\{[^}]+\}\}/);
        for (const photo of originalPhotos)
          expect(requests.body).toContain(photo.originalFilename);
        expect(requests.posts).toEqual([]);
        expect(requests.consentWrites).toEqual([]);
        expect(calls.rules).toEqual([]);
        expect(calls.plans).toEqual([]);
        expect(calls.executes).toEqual([]);
        await drawer
          .getByRole('button', {
            name: english ? 'Close' : 'Fermer',
            exact: true
          })
          .click();
        await expect(panel).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(requests.posts).toEqual([]);
        expect(state.assets.slice(0, 2)).toEqual(originalPhotos);
        await opener.press('Enter');
        await expect(form).toBeVisible();
        expect(requests.preparations).toHaveLength(2);
        const editedBody = `${requests.body}\n\n${english ? 'Synthetic message reviewed by the administrator.' : 'Message synthétique examiné par l’administration.'}`;
        await form.getByLabel('Message', { exact: true }).fill(editedBody);
        expect(editedBody).not.toMatch(/\{\{[^}]+\}\}/);
        const reviewSend = form.getByRole('button', {
          name: english ? 'Review delivery' : 'Vérifier l’envoi',
          exact: true
        });
        await reviewSend.focus();
        await reviewSend.press('Enter');
        const confirmation = page.getByRole('dialog', {
          name: english
            ? 'Confirm information request'
            : 'Confirmer la demande d’informations',
          exact: true
        });
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText(requests.recipient);
        await expect(confirmation).toContainText(editedBody);
        expect(requests.posts).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(confirmation).not.toBeVisible();
        await expect(reviewSend).toBeFocused();
        expect(requests.posts).toEqual([]);
        await reviewSend.press('Enter');
        await confirmation
          .getByRole('button', {
            name: english ? 'Confirm delivery' : 'Confirmer l’envoi',
            exact: true
          })
          .click();
        await expect(
          panel.locator('[data-og7="assistant-information-receipt"]')
        ).toBeVisible();
        expect(requests.posts).toEqual([
          {
            ...requests.proposal.delivery,
            requestId: expect.stringMatching(
              /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
            ),
            body: editedBody,
            confirmed: true
          }
        ]);
        expect(requests.posts[0]!.mediaSnapshot).toEqual(
          requests.mediaSnapshot
        );
        expect(requests.posts[0]!.mediaSnapshot).toHaveLength(2);
        expect(requests.posts[0]).not.toHaveProperty('assetId');
        expect(requests.posts[0]!.purpose).toBe('media_consent');
        expect(requests.posts[0]!.language).toBe(language);
        expect(state.assets.slice(0, 2)).toEqual(originalPhotos);
        expect(requests.consentWrites).toEqual([]);
        expect(calls.rules).toEqual([]);
        expect(calls.plans).toEqual([]);
        expect(calls.executes).toEqual([]);
        expect(
          await page.evaluate(
            (id) =>
              sessionStorage.getItem(
                'openg7-assistant-information-pending:' + id
              ),
            state.contributionId
          )
        ).toBeNull();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        await drawer
          .getByRole('button', {
            name: english ? 'Close' : 'Fermer',
            exact: true
          })
          .click();
        await expect(panel).toHaveCount(0);
        await expect(opener).toBeFocused();
        if (entry === 'pending') {
          await expect(
            page.locator('[data-og7="media-acceptance-pending"]')
          ).toBeVisible();
          await expect(
            page.locator('[data-og7="media-acceptance-approve"]')
          ).toBeDisabled();
          await expect(
            page.locator('[data-og7="media-acceptance-proof"]')
          ).toHaveCount(0);
        }
      });
    }
  }

  test('one photo consent request recovers a lost receipt after reopening without another send', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    pendingPhotos(state);
    const originalPhotos = structuredClone(state.assets.slice(0, 2));
    const requests = await photoConsentRequestFixture(page, state);
    requests.dropResponse = true;
    await page.goto(context.path('media'));
    const opener = area(page).locator(
      '[data-og7="media-consent-request-open"]'
    );
    await opener.click();
    const drawer = page.getByRole('dialog', {
      name: 'Demander le consentement des photos',
      exact: true
    });
    const panel = drawer.locator('[data-og7="media-consent-request"]');
    await panel
      .getByRole('button', { name: 'Vérifier l’envoi', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
      .click();
    await expect(
      panel.locator('[data-og7="assistant-information-uncertain"]')
    ).toBeVisible();
    expect(requests.posts).toHaveLength(1);
    const pending = requests.posts[0]!;
    expect(pending.mediaSnapshot).toEqual(requests.mediaSnapshot);
    expect(
      await page.evaluate(
        (id) =>
          sessionStorage.getItem('openg7-assistant-information-pending:' + id),
        state.contributionId
      )
    ).toBe(pending.requestId);
    await expect(
      panel.getByRole('button', { name: 'Vérifier l’envoi', exact: true })
    ).toBeDisabled();
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    const verify = panel.locator(
      '[data-og7="assistant-information-receipt-check"]'
    );
    await expect(verify).toBeVisible();
    expect(requests.preparations).toHaveLength(1);
    expect(requests.posts).toHaveLength(1);
    await verify.click();
    const receipt = panel.locator('[data-og7="assistant-information-receipt"]');
    await expect(receipt).toBeVisible();
    await expect(receipt).toBeFocused();
    expect(requests.receiptReads).toHaveLength(1);
    expect(requests.receiptReads[0]!.searchParams.get('requestId')).toBe(
      pending.requestId
    );
    expect(requests.receiptReads[0]!.searchParams.get('contributionId')).toBe(
      state.contributionId
    );
    expect(requests.posts).toHaveLength(1);
    expect(state.assets.slice(0, 2)).toEqual(originalPhotos);
    expect(requests.consentWrites).toEqual([]);
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
    expect(
      await page.evaluate(
        (id) =>
          sessionStorage.getItem('openg7-assistant-information-pending:' + id),
        state.contributionId
      )
    ).toBeNull();
  });

  for (const scenario of ['reader', 'withdrawn', 'rejected', 'logo'] as const) {
    test(`photo consent request is unavailable for ${scenario} media`, async ({
      page
    }) => {
      const { state, calls } = await fixture(
        page,
        scenario === 'reader' ? 'reader' : 'operator'
      );
      pendingPhotos(state);
      for (const asset of state.assets.slice(0, 2)) {
        if (scenario === 'withdrawn')
          Object.assign(asset, {
            usage: { ...asset.usage, state: 'withdrawn' }
          });
        if (scenario === 'rejected')
          Object.assign(asset, { reviewStatus: 'rejected' });
        if (scenario === 'logo') Object.assign(asset, { kind: 'logo' });
      }
      const requests = await photoConsentRequestFixture(page, state);
      await page.goto(context.path('media'));
      await expect(
        area(page).locator('[data-og7="media-tile"]').first()
      ).toBeVisible();
      await expect(
        area(page).locator('[data-og7="media-consent-request-open"]')
      ).toHaveCount(0);
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      if (scenario === 'withdrawn' || scenario === 'logo') {
        await area(page)
          .locator('[data-og7="media-inspector-approve"]')
          .click();
        await expect(
          page.locator('[data-og7="media-acceptance-review"]')
        ).toBeVisible();
      }
      await expect(
        page.locator('[data-og7="media-acceptance-request-consent"]')
      ).toHaveCount(0);
      expect(requests.preparations).toEqual([]);
      expect(requests.posts).toEqual([]);
      expect(requests.consentWrites).toEqual([]);
      expect(calls.rules).toEqual([]);
    });
  }

  test('a withdrawn photo never offers another consent request while a different photo still awaits initial permission', async ({
    page
  }) => {
    const { state } = await fixture(page);
    pendingPhotos(state);
    const withdrawn = state.assets[0]!;
    Object.assign(withdrawn, {
      usage: { ...withdrawn.usage, state: 'withdrawn' }
    });
    const requests = await photoConsentRequestFixture(page, state);
    await page.goto(context.path('media'));
    await expect(
      area(page).locator('[data-og7="media-consent-request-open"]')
    ).toBeVisible();
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await area(page).locator('[data-og7="media-inspector-approve"]').click();
    await expect(
      page.locator('[data-og7="media-acceptance-review"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-og7="media-acceptance-request-consent"]')
    ).toHaveCount(0);
    expect(requests.preparations).toEqual([]);
    expect(requests.posts).toEqual([]);
  });

  test('photo consent request with no current photos or contact exposes no delivery form', async ({
    page
  }) => {
    const { state } = await fixture(page);
    pendingPhotos(state);
    const requests = await photoConsentRequestFixture(page, state);
    requests.applicable = false;
    await page.goto(context.path('media'));
    await area(page).locator('[data-og7="media-consent-request-open"]').click();
    const panel = page.locator('[data-og7="media-consent-request"]');
    await expect(panel).toBeVisible();
    await expect(
      panel.locator('[data-og7="assistant-information-form"]')
    ).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText(
      'Aucun brouillon applicable à l’état actuel du dossier.'
    );
    expect(requests.preparations).toHaveLength(1);
    expect(requests.posts).toEqual([]);
    expect(requests.consentWrites).toEqual([]);
  });

  for (const [language, width, entry] of [
    ['fr-CA', 1440, 'button'],
    ['en', 390, 'context']
  ] as const) {
    test(`platform media acceptance offers a simple explicit review and restores cancelled focus ${language}`, async ({
      page
    }, info) => {
      const { state, calls } = await fixture(page);
      const selected = state.assets[0]!;
      addPlatformAcceptance(selected, language);
      Object.assign(selected, { altText: null });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      const english = language === 'en';
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const tiles = area(page).locator('[data-og7="media-tile"]');
      await tiles.nth(1).getByRole('checkbox').check();
      await tiles.first().getByRole('button').click();
      const inspector = area(page).locator('[data-og7="media-inspector"]');
      const opener =
        entry === 'context'
          ? inspector
              .locator('[data-og7="context-controller"]')
              .getByRole('button', {
                name: english ? 'Permissions' : 'Autorisations',
                exact: true
              })
          : inspector.locator('[data-og7="media-inspector-approve"]');
      await opener.focus();
      await opener.press('Enter');
      const dialog = page.locator('dialog[open]');
      const review = dialog.locator('[data-og7="media-acceptance-review"]');
      const approve = review.locator('[data-og7="media-acceptance-approve"]');
      const cancel = review.locator('[data-og7="media-acceptance-cancel"]');
      await expect(review).toBeVisible();
      await expect(review).toContainText(selected.originalFilename);
      await expect(
        review.locator('[data-og7="media-acceptance-proof"]')
      ).toBeVisible();
      await expect(
        review.locator('[data-og7="media-acceptance-proof"] time')
      ).toHaveAttribute('datetime', '2026-11-09T15:20:00.000Z');
      await expect(review).toContainText('synthetic-media-terms-v1');
      await expect(approve).toHaveText(
        english ? 'Approve and continue' : 'Approuver et continuer'
      );
      await expect(cancel).toHaveText(english ? 'Cancel' : 'Annuler');
      await expect(
        review.locator('[data-og7="media-acceptance-reject"]')
      ).toHaveText(english ? 'Reject' : 'Refuser');
      await expect(
        review.locator('[data-og7="media-usage-evidence"]')
      ).toHaveCount(0);
      await expect(
        review.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(approve).toBeDisabled();
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await cancel.focus();
      await cancel.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await opener.press('Enter');
      await review
        .locator('[data-og7="media-acceptance-alt"]')
        .fill('Human description of the exact accepted image');
      await expect(approve).toBeEnabled();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await dialog.screenshot({
        path: info.outputPath(`platform-media-review-${language}-${width}.png`)
      });
      await approve.click();
      await expect(
        area(page).locator('[data-og7="media-batch-receipt"]')
      ).toBeVisible();
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toHaveLength(1);
      expect(calls.plans[0]).toMatchObject({
        contributionId: state.contributionId,
        expectedRevision: 'workspace-v1',
        action: 'approve',
        assets: [
          {
            id: selected.id,
            version: 'asset-v1',
            altText: 'Human description of the exact accepted image'
          }
        ]
      });
      expect(calls.plans[0]!.assets).toHaveLength(1);
      expect(calls.executes).toHaveLength(1);
      expect(calls.executes[0]).toMatchObject({
        planId: 'synthetic-plan',
        confirmation: 'synthetic-plan',
        humanReviewed: true
      });
      expect(calls.plans.map((plan) => plan.action)).toEqual(['approve']);
      expect(selected.websiteSelected).toBe(false);
      await expect(dialog).toHaveCount(0);
    });
  }

  test('platform media acceptance requires explicit review of recorded restrictions', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    const selected = state.assets[0]!;
    addPlatformAcceptance(selected);
    Object.assign(selected, {
      usage: {
        ...selected.usage,
        restrictions: 'Synthetic restriction: retain the event attribution'
      }
    });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await area(page).locator('[data-og7="media-inspector-approve"]').click();
    const review = page.locator('[data-og7="media-acceptance-review"]');
    const approve = review.locator('[data-og7="media-acceptance-approve"]');
    const restrictions = review.getByRole('checkbox');
    await expect(review).toContainText(
      'Synthetic restriction: retain the event attribution'
    );
    await expect(restrictions).not.toBeChecked();
    await expect(approve).toBeDisabled();
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
    await restrictions.check();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(
      area(page).locator('[data-og7="media-batch-receipt"]')
    ).toBeVisible();
    expect(calls.plans[0]!.assets).toEqual([
      {
        id: selected.id,
        version: 'asset-v1',
        altText: selected.altText,
        usageRestrictionsConfirmed: true
      }
    ]);
    expect(calls.rules).toEqual([]);
    expect(calls.executes).toHaveLength(1);
  });

  for (const conflict of [
    'server-conflict',
    'changed-manifest',
    'changed-acceptance',
    'blocked-manifest'
  ] as const) {
    test(`platform media acceptance never executes after ${conflict}`, async ({
      page
    }) => {
      const { state, calls } = await fixture(page);
      const selected = state.assets[0]!;
      addPlatformAcceptance(selected);
      await page.route(
        '**/api/admin/sponsorships/media/batch/plan',
        async (route) => {
          if (conflict === 'server-conflict') {
            calls.plans.push(route.request().postDataJSON());
            await route.fulfill({
              status: 409,
              json: { error: 'MEDIA_WORKSPACE_CHANGED' }
            });
            return;
          }
          if (conflict === 'blocked-manifest') {
            const request = route.request().postDataJSON();
            calls.plans.push(request);
            await route.fulfill({
              json: {
                id: 'synthetic-blocked-plan',
                contributionId: state.contributionId,
                action: request.action,
                revision: state.revision,
                expiresAt: new Date(Date.now() + 600000).toISOString(),
                blocked: [{ id: selected.id, reasons: ['MEDIA_INVALID'] }],
                effects: [],
                assets: [{ ...selected, altText: request.assets[0].altText }]
              }
            });
            return;
          }
          if (conflict === 'changed-acceptance')
            Object.assign(selected, {
              usageAcceptance: {
                ...selected.usageAcceptance,
                id: 'synthetic-different-acceptance'
              }
            });
          else {
            Object.assign(selected, { version: 'asset-v2' });
            Object.assign(state, { revision: 'workspace-v2' });
          }
          await route.fallback();
        }
      );
      await page.goto(context.path('media'));
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      await area(page).locator('[data-og7="media-inspector-approve"]').click();
      const review = page.locator('[data-og7="media-acceptance-review"]');
      await expect(review).toBeVisible();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
      await review.locator('[data-og7="media-acceptance-approve"]').click();
      await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
      expect(calls.plans).toHaveLength(1);
      expect(calls.plans[0]).toMatchObject({
        expectedRevision: 'workspace-v1',
        assets: [{ id: selected.id, version: 'asset-v1' }]
      });
      expect(calls.executes).toEqual([]);
      expect(calls.rules).toEqual([]);
      await expect(
        area(page).locator('[data-og7="media-batch-receipt"]')
      ).toHaveCount(0);
    });
  }

  test('platform media acceptance reconciles a lost decision receipt without another approval', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    addPlatformAcceptance(state.assets[0]!);
    let receiptReads = 0;
    await page.route(
      '**/api/admin/sponsorships/media/batch/execute',
      async (route) => {
        calls.executes.push(route.request().postDataJSON());
        await route.abort('failed');
      }
    );
    await page.route('**/api/admin/sponsorships/media/receipt?**', (route) => {
      receiptReads++;
      return route.fulfill({
        json: {
          found: true,
          result: {
            requestId: calls.executes[0]?.requestId,
            planId: 'synthetic-plan',
            status: 'completed',
            action: 'approve',
            items: []
          }
        }
      });
    });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    await area(page).locator('[data-og7="media-inspector-approve"]').click();
    const review = page.locator('[data-og7="media-acceptance-review"]');
    const approve = review.locator('[data-og7="media-acceptance-approve"]');
    await approve.click();
    await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
    await expect(approve).toBeDisabled();
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    await review.locator('[data-og7="media-acceptance-cancel"]').click();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeDisabled();
    await area(page).locator('[data-og7="media-reconcile"]').click();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeEnabled();
    expect(receiptReads).toBe(1);
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    expect(calls.rules).toEqual([]);
  });

  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`media workspace pages 100 files with one inspector and bounded private thumbnails ${language}`, async ({
      page
    }, info) => {
      const { calls } = await fixture(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      if (language === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      await area(page)
        .locator('[data-og7="media-page-size"]')
        .selectOption('25');
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        25
      );
      await expect(
        area(page).locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      await expect(
        area(page).locator('[data-og7="media-inspector"]')
      ).toHaveCount(1);
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      await expect(
        area(page).locator('[data-og7="media-full-preview"] img')
      ).toBeVisible();
      await expect(
        area(page).locator('[data-og7="media-inspector-alt"]')
      ).toHaveValue('Vue synthétique 1');
      expect(calls.maxActive).toBeLessThanOrEqual(4);
      expect(calls.thumbnails.length).toBeLessThanOrEqual(25);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await area(page).screenshot({
        path: info.outputPath(`media-workspace-${language}-${width}.png`)
      });
      await area(page).evaluate((element) =>
        element.scrollIntoView({ block: 'start', behavior: 'instant' })
      );
      await page.screenshot({
        path: info.outputPath(
          `media-workspace-viewport-${language}-${width}.png`
        )
      });
      await area(page).locator('[data-og7="media-next-page"]').click();
      await expect(
        area(page).locator('[data-og7="media-tile"]').first()
      ).toContainText('photo-026.webp');
      await area(page).locator('[data-og7="media-search"]').fill('photo-100');
      await expect(area(page).locator('[data-og7="media-tile"]')).toHaveCount(
        1
      );
      await area(page)
        .locator('[data-og7="media-tile"]')
        .getByRole('button')
        .click();
      await area(page).locator('[data-og7="media-inspector-approve"]').click();
      await expect(
        page.locator('[data-og7="media-acceptance-approve"]')
      ).toBeDisabled();
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
    });
  }

  for (const [language, width] of [
    ['fr-CA', 1440],
    ['en', 390]
  ] as const) {
    test(`media review explains missing sponsor consent without manual evidence or rights mutation ${language}`, async ({
      page
    }) => {
      const { state, calls } = await fixture(page);
      const selected = state.assets[0]!;
      Object.assign(selected, {
        altText: null,
        usage: {
          state: 'needs_confirmation',
          channels: [],
          targets: [],
          transformations: [],
          credit: null,
          restrictions: null
        },
        usageSource: 'media',
        ruleId: null,
        readiness: {
          state: 'blocked',
          reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
        }
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(context.path('media'));
      const english = language === 'en';
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const tiles = area(page).locator('[data-og7="media-tile"]');
      await tiles.nth(1).getByRole('checkbox').check();
      await tiles.first().getByRole('button').click();
      const inspector = area(page).locator('[data-og7="media-inspector"]');
      const openers = [
        inspector.locator('[data-og7="media-inspector-approve"]'),
        inspector
          .locator('[data-og7="context-controller"]')
          .getByRole('button', {
            name: english ? 'Permissions' : 'Autorisations',
            exact: true
          })
      ];
      for (const opener of openers) {
        await expect(opener).toBeEnabled();
        await opener.focus();
        await opener.press('Enter');
        const dialog = page.locator('dialog[open]');
        const review = dialog.locator('[data-og7="media-acceptance-review"]');
        await expect(review).toContainText(selected.originalFilename);
        await expect(
          review.locator('[data-og7="media-acceptance-pending"]')
        ).toBeVisible();
        await expect(
          review.locator('[data-og7="media-acceptance-proof"]')
        ).toHaveCount(0);
        await expect(
          review.locator('[data-og7="media-usage-editor"]')
        ).toHaveCount(0);
        await expect(
          review.locator('[data-og7="media-usage-evidence"]')
        ).toHaveCount(0);
        await expect(review.getByRole('combobox')).toHaveCount(0);
        const approve = review.locator('[data-og7="media-acceptance-approve"]');
        await expect(approve).toBeDisabled();
        await review
          .locator('[data-og7="media-acceptance-alt"]')
          .fill('Description does not grant permission');
        await expect(approve).toBeDisabled();
        await expect(
          review.locator('[data-og7="media-acceptance-reject"]')
        ).toBeEnabled();
        expect(calls.rules).toEqual([]);
        expect(calls.plans).toEqual([]);
        expect(calls.executes).toEqual([]);
        await review.locator('[data-og7="media-acceptance-cancel"]').click();
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      }
      expect(selected.usage?.state).toBe('needs_confirmation');
      expect(selected.reviewStatus).toBe('pending_review');
      expect(selected.websiteSelected).toBe(false);
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
    });
  }

  for (const reasons of [
    ['MEDIA_INVALID'],
    ['MEDIA_USAGE_WITHDRAWN'],
    ['MEDIA_REJECTED'],
    ['MODERATION_RESTRICTED'],
    ['MODERATION_RECONSIDERATION_OPEN'],
    ['MEDIA_USAGE_CONFIRMATION_REQUIRED', 'MEDIA_INVALID']
  ]) {
    test(`media review keeps a blocked file readable without approving ${reasons.join(' and ')}`, async ({
      page
    }) => {
      const { state, calls } = await fixture(page);
      Object.assign(state.assets[0]!, {
        readiness: { state: 'blocked', reasons }
      });
      await page.goto(context.path('media'));
      await area(page)
        .locator('[data-og7="media-tile"]')
        .first()
        .getByRole('button')
        .click();
      await area(page).locator('[data-og7="media-inspector-approve"]').click();
      const review = page.locator('[data-og7="media-acceptance-review"]');
      await expect(review).toBeVisible();
      await expect(
        review.locator('[data-og7="media-acceptance-approve"]')
      ).toBeDisabled();
      await expect(
        review.locator('[data-og7="media-usage-editor"]')
      ).toHaveCount(0);
      expect(calls.rules).toEqual([]);
      expect(calls.plans).toEqual([]);
      expect(calls.executes).toEqual([]);
    });
  }

  test('simple media review opens the existing explicit rejection confirmation for the inspected file only', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(1).getByRole('checkbox').check();
    await tiles.first().getByRole('button').click();
    const opener = area(page).locator('[data-og7="media-inspector-approve"]');
    await opener.click();
    await page.locator('[data-og7="media-acceptance-reject"]').click();
    const dialog = page.locator('dialog[open]');
    const prepare = dialog.getByRole('button', {
      name: 'Examiner le refus',
      exact: true
    });
    await expect(prepare).toBeDisabled();
    const reason = dialog.getByRole('combobox', {
      name: 'Motif de modération',
      exact: true
    });
    await expect(reason).toBeFocused();
    await expect(
      dialog.getByRole('textbox', {
        name: 'Raison interne privée',
        exact: true
      })
    ).toHaveValue('');
    await expect(
      dialog.getByRole('textbox', {
        name: 'Explication destinée au commanditaire',
        exact: true
      })
    ).toHaveValue('');
    expect(state.assets[0]!.reviewStatus).toBe('pending_review');
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await page.locator('[data-og7="media-acceptance-reject"]').click();
    await reason.selectOption('IP_RIGHTS');
    await dialog
      .getByRole('textbox', {
        name: 'Raison interne privée',
        exact: true
      })
      .fill('Synthetic review of this exact file');
    await dialog
      .getByRole('textbox', {
        name: 'Explication destinée au commanditaire',
        exact: true
      })
      .fill('Please provide a photograph you are authorized to share.');
    await prepare.click();
    await expect(
      page.locator('[data-og7="media-batch-manifest"]')
    ).toBeVisible();
    expect(calls.plans).toHaveLength(1);
    expect(calls.plans[0]).toMatchObject({
      action: 'reject',
      reason: 'IP_RIGHTS',
      expectedRevision: 'workspace-v1',
      assets: [{ id: state.assets[0]!.id, version: 'asset-v1' }]
    });
    expect(calls.plans[0]!.assets).toHaveLength(1);
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
    expect(calls.rules).toEqual([]);
    expect(calls.executes).toEqual([]);
  });

  test('media workspace confirms one exact manifest for a multi-file human decision without publishing', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await tiles.nth(0).getByRole('button').click();
    await area(page)
      .locator('[data-og7="media-inspector-alt"]')
      .fill('Exact human alternative text');
    await area(page).locator('[data-og7="media-batch-approve"]').click();
    await expect(
      page.locator('[data-og7="media-batch-manifest"]')
    ).toContainText('Exact human alternative text');
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
    expect(calls.executes).toHaveLength(0);
    await page.locator('[data-og7="media-manifest-confirmation"]').check();
    await page.locator('[data-og7="media-batch-execute"]').click();
    await expect(
      area(page).locator('[data-og7="media-batch-receipt"]')
    ).toBeVisible();
    expect(calls.plans).toHaveLength(1);
    expect(calls.executes).toHaveLength(1);
    expect(calls.plans[0].assets).toHaveLength(2);
    expect(calls.plans[0].assets[0].altText).toBe(
      'Exact human alternative text'
    );
    expect(calls.executes[0]).toMatchObject({
      planId: 'synthetic-plan',
      confirmation: 'synthetic-plan',
      humanReviewed: true
    });
  });

  test('media workspace common permissions are informational and never grant rights to a selection', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.goto(context.path('media'));
    const tiles = area(page).locator('[data-og7="media-tile"]');
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
    await expect(
      area(page).locator('[data-og7="media-dossier-rules"]')
    ).toHaveCount(0);
    await expect(
      area(page).locator('[data-og7="media-batch-rules"]')
    ).toHaveCount(0);
    await tiles.first().getByRole('button').click();
    const inspector = area(page).locator('[data-og7="media-inspector"]');
    await inspector.getByText('Plus d’options', { exact: true }).click();
    await expect(
      inspector.getByRole('button', {
        name: 'Personnaliser les autorisations',
        exact: true
      })
    ).toHaveCount(0);
    await expect(
      inspector.getByRole('button', {
        name: 'Rétablir l’héritage',
        exact: true
      })
    ).toHaveCount(0);
    await expect(page.locator('[data-og7="media-usage-evidence"]')).toHaveCount(
      0
    );
    await expect(page.locator('[data-og7="media-rules-future"]')).toHaveCount(
      0
    );
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
  });

  test('media workspace lost receipt suspends writes and verifies read-only without replay', async ({
    page
  }) => {
    const { calls } = await fixture(page);
    await page.route(
      '**/api/admin/sponsorships/media/batch/execute',
      async (route) => {
        calls.executes.push(route.request().postDataJSON());
        await route.abort('failed');
      }
    );
    await page.route('**/api/admin/sponsorships/media/receipt?**', (route) =>
      route.fulfill({
        json: {
          found: true,
          result: {
            requestId: calls.executes[0]?.requestId,
            planId: 'synthetic-plan',
            status: 'completed',
            action: 'approve',
            items: []
          }
        }
      })
    );
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('checkbox')
      .check();
    await area(page).locator('[data-og7="media-batch-approve"]').click();
    await page.locator('[data-og7="media-manifest-confirmation"]').check();
    await page.locator('[data-og7="media-batch-execute"]').click();
    await expect(page.locator('dialog[open] [role="alert"]')).toBeVisible();
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: 'Fermer', exact: true })
      .click();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    await area(page).locator('[data-og7="media-reconcile"]').click();
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeEnabled();
    expect(calls.executes).toHaveLength(1);
  });

  test('media workspace reader can inspect with the keyboard while all writes and private history stay unavailable', async ({
    page
  }) => {
    const { state, calls } = await fixture(page, 'reader');
    addPlatformAcceptance(state.assets[0]!);
    await page.goto(context.path('media'));
    const tile = area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button');
    await tile.focus();
    await tile.press('Enter');
    await expect(
      area(page).locator('[data-og7="media-full-preview"] img')
    ).toBeVisible();
    await expect(
      area(page).locator('[data-og7="media-inspector-alt"]')
    ).toBeDisabled();
    await expect(
      area(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeDisabled();
    await expect(area(page).locator('[data-og7="media-history"]')).toHaveCount(
      0
    );
    await expect(
      area(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    expect(calls.plans).toHaveLength(0);
    expect(calls.executes).toHaveLength(0);
    await expect(
      page.locator('[data-og7="media-acceptance-review"]')
    ).toHaveCount(0);
  });

  test('empty media workspace offers no rights grant or future inheritance', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state, { assets: [] });
    await page.goto(context.path('media'));
    await expect(
      area(page).locator('[data-og7="media-gallery-empty"]')
    ).toBeVisible();
    for (const hook of [
      'media-dossier-rules',
      'media-batch-rules',
      'media-rules-future',
      'media-usage-editor'
    ])
      await expect(page.locator(`[data-og7="${hook}"]`)).toHaveCount(0);
    expect(calls.rules).toEqual([]);
    expect(calls.plans).toEqual([]);
    expect(calls.executes).toEqual([]);
  });

  test('media workspace site selection manifest warns about immediate website visibility and keeps social authorization separate', async ({
    page
  }) => {
    const { state, calls } = await fixture(page);
    Object.assign(state.assets[0], { reviewStatus: 'approved' });
    await page.goto(context.path('media'));
    await area(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button')
      .click();
    const inspector = area(page).locator('[data-og7="media-inspector"]');
    await inspector.getByText('Plus d’options', { exact: true }).click();
    await inspector
      .getByRole('button', { name: 'Choisir pour le site', exact: true })
      .click();
    await expect(page.locator('dialog[open]')).toContainText(
      'Il peut devenir visible immédiatement'
    );
    await expect(page.locator('dialog[open]')).toContainText(
      'aucune publication sur les réseaux sociaux'
    );
    expect(calls.plans[0].action).toBe('website_select');
    expect(calls.executes).toHaveLength(0);
    await expect(
      page.locator('[data-og7="media-batch-execute"]')
    ).toBeDisabled();
  });
}
