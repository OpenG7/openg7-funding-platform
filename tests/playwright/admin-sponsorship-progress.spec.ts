import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipRecord,
  SponsorMediaAsset,
  SponsorshipIntervention,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const id = '10000000-0000-4000-8000-000000000401';
const secondId = '10000000-0000-4000-8000-000000000402';
const date = '2026-09-16T14:00:00Z';
const path = (tab = 'overview', value = id) =>
  `/admin/fundraiser/sponsors?sponsorshipId=${value}&tab=${tab}`;
const dossier = (value = id): AdminSponsorshipProgress => ({
  contributionId: value,
  reference: value === id ? 'DEMO-401' : 'DEMO-402',
  companyName: value === id ? 'Atelier Boréal' : 'Atelier Rivage',
  version: 'v1',
  amountMinor: 50000,
  currency: 'CAD',
  paymentStatus: 'paid',
  reviewStatus: 'pending_review',
  publicConsent: true,
  publicEligible: false,
  feedStatus: 'not_planned',
  milestones: [
    {
      id: 'payment',
      state: 'complete',
      reason: 'payment_recorded',
      tab: 'overview'
    },
    {
      id: 'identity',
      state: 'complete',
      reason: 'identity_complete',
      tab: 'identity'
    },
    { id: 'media', state: 'complete', reason: 'media_approved', tab: 'media' },
    {
      id: 'review',
      state: 'pending',
      reason: 'review_pending',
      tab: 'overview'
    },
    {
      id: 'billing',
      state: 'complete',
      reason: 'invoice_issued',
      tab: 'billing'
    },
    {
      id: 'publication',
      state: 'cancelled',
      reason: 'publication_cancelled',
      tab: 'publication'
    }
  ],
  next: { reason: 'review_pending', tab: 'overview', adminUrl: path() },
  documents: [
    {
      id: secondId,
      number: 'FAC-DEMO-401',
      kind: 'invoice',
      amountMinor: 50000,
      currency: 'CAD',
      issuedAt: date
    }
  ],
  publications: [
    {
      id: secondId,
      channel: 'facebook',
      target: 'openg7',
      status: 'approved',
      batchStatus: 'cancelled',
      slotStatus: null,
      deliveryStatus: null,
      deliveryMode: null,
      scheduledAt: null,
      publishedAt: null
    }
  ],
  refund: {
    workflow: 'completed',
    state: 'partial',
    confirmedAmountMinor: 20000,
    creditMissing: true,
    hasError: false
  },
  failedEmails: [{ id: secondId, template: 'invoice' }],
  failedStripeEvents: []
});
const record = (value = id): AdminSponsorshipRecord => ({
  id: value,
  version: 'v1',
  public_reference: dossier(value).reference,
  contribution_type: 'sponsorship_interest',
  amount: 500,
  currency: 'CAD',
  payment_status: 'paid',
  paid_at: date,
  public_name: null,
  public_display_consent: true,
  display_amount_consent: false,
  sponsor_company_name: dossier(value).companyName,
  sponsor_contact_name: 'Contact démo',
  sponsor_contact_email: 'demo@example.invalid',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_message: null,
  sponsor_details_submitted_at: date,
  sponsor_review_status: 'pending_review',
  sponsor_review_note: null,
  sponsor_reviewed_at: null,
  sponsor_public_slug: null,
  sponsor_public_summary: null,
  sponsor_feed_target: null,
  sponsor_feed_channels: [],
  sponsor_feed_status: 'not_planned',
  sponsor_feed_public_url: null,
  sponsor_feed_notes: null,
  sponsor_visibility_updated_at: null,
  sponsorship_refund_status: 'not_requested',
  sponsorship_refund_requested_at: null,
  sponsorship_refund_processed_at: null,
  sponsorship_refund_completed_at: null,
  sponsorship_refund_id: null,
  sponsorship_refund_amount: null,
  sponsorship_refund_reason: null,
  sponsorship_refund_note: null,
  sponsorship_refund_error: null,
  admin_audit_entries: [],
  created_at: date,
  updated_at: date
});
async function fixtures(page: Page, role?: 'reader' | 'operator' | 'owner') {
  await page.addInitScript((oidc) => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      oidc ? 'openg7-admin-session.cookie' : 'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, Boolean(role));
  const calls: {
    url: URL;
    method: string;
    body: Record<string, unknown> | null;
  }[] = [];
  const options = {
    status: 200,
    state: 'ok' as AdminSponsorshipProgressResponse['status'],
    reviewStatus: 409,
    reviewUpdated: true,
    detailsStatus: 200,
    journalReadStatus: 200,
    journalSaveStatus: 200,
    journalGate: null as Promise<void> | null,
    journalReadGate: null as Promise<void> | null,
    journalState:
      'decision_required' as SponsorshipInterventionsResponse['followup']['state'],
    journal: new Map<string, SponsorshipIntervention[]>(),
    detailsGate: null as Promise<void> | null,
    edited: new Map<string, Partial<AdminSponsorshipRecord>>(),
    queueCount: 3,
    version: 'v1',
    listStatus: 200,
    listSize: 2,
    media: [] as SponsorMediaAsset[],
    mutationStatus: 200,
    mutationGate: null as Promise<void> | null,
    reviewGate: null as Promise<void> | null,
    progressGate: null as Promise<void> | null,
    listGate: null as Promise<void> | null,
    next: null as AdminSponsorshipProgress['next'] | null,
    milestones: null as AdminSponsorshipProgress['milestones'] | null,
    progressOverrides: {} as Partial<AdminSponsorshipProgress>
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    calls.push({
      url,
      method: req.method(),
      body:
        req.postData() &&
        req.headers()['content-type']?.includes('application/json')
          ? (req.postDataJSON() as Record<string, unknown>)
          : null
    });
    if (url.pathname === '/api/admin/auth/current' && role)
      return route.fulfill({
        json: {
          id: 'dossier-fixture',
          sessionId: 'dossier-session',
          displayName: 'Dossier fixture',
          role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (url.pathname === '/api/admin/sponsorships/interventions') {
      const payload = req.method() === 'POST' ? req.postDataJSON() : null;
      const selected =
        payload?.contributionId ?? url.searchParams.get('sponsorshipId') ?? id;
      if (req.method() === 'POST') {
        if (options.journalGate) await options.journalGate;
        if (options.journalSaveStatus !== 200)
          return route.fulfill({
            status: options.journalSaveStatus,
            json: { error: 'Synthetic journal failure' }
          });
        const entries = options.journal.get(selected) ?? [];
        const entry = entries.find((e) => e.id === payload.requestId) ?? {
          id: payload.requestId,
          kind: payload.kind,
          note: payload.note,
          nextReviewOn: payload.nextReviewOn,
          actor: 'Operator fixture',
          recordedAt: date
        };
        if (!entries.some((e) => e.id === entry.id))
          options.journal.set(selected, [entry, ...entries]);
        if (payload.kind === 'extension') options.journalState = 'extended';
        return route.fulfill({ json: entry });
      }
      if (selected === id && options.journalReadGate)
        await options.journalReadGate;
      if (options.journalReadStatus !== 200)
        return route.fulfill({
          status: options.journalReadStatus,
          json: { error: 'Synthetic journal failure' }
        });
      const entries = options.journal.get(selected) ?? [];
      const cursor = url.searchParams.get('before');
      const offset = cursor ? entries.findIndex((e) => e.id === cursor) + 1 : 0;
      return route.fulfill({
        json: {
          entries: entries.slice(offset, offset + 25),
          nextCursor:
            entries.length > offset + 25 ? entries[offset + 24].id : null,
          followup: {
            state: options.journalState,
            ageDays: 35,
            nextReviewOn:
              entries.find((e) => e.kind === 'extension')?.nextReviewOn ?? null,
            lastEmail: { status: 'failed', at: date }
          }
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/progress') {
      const selected = url.searchParams.get('sponsorshipId') || id;
      if (selected === id && options.progressGate) await options.progressGate;
      const current = { ...record(selected), ...options.edited.get(selected) };
      const coordinatesPresent = Boolean(
        current.sponsor_company_name && current.sponsor_contact_email
      );
      const identityStep: AdminSponsorshipProgress['milestones'][number] = {
        id: 'identity',
        tab: 'identity',
        state: !coordinatesPresent
          ? 'blocked'
          : current.sponsor_details_submitted_at
            ? 'complete'
            : 'pending',
        reason: !coordinatesPresent
          ? 'identity_missing'
          : current.sponsor_details_submitted_at
            ? 'identity_complete'
            : 'identity_submission_pending'
      };
      return route.fulfill({
        status: options.status,
        json: {
          status: options.state,
          generatedAt: date,
          dossier:
            options.state === 'ok'
              ? {
                  ...dossier(selected),
                  ...options.progressOverrides,
                  milestones:
                    options.milestones ??
                    dossier(selected).milestones.map((step) =>
                      step.id === 'identity' ? identityStep : step
                    ),
                  next:
                    options.next ??
                    (identityStep.state === 'complete'
                      ? dossier(selected).next
                      : {
                          reason: identityStep.reason,
                          tab: 'identity',
                          adminUrl: path('identity', selected)
                        })
                }
              : null
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships') {
      if (options.listGate) await options.listGate;
      if (options.listStatus !== 200)
        return route.fulfill({
          status: options.listStatus,
          json: { error: 'Synthetic list failure' }
        });
      const search = url.searchParams.get('search');
      const records = Array.from({ length: options.listSize }, (_, index) =>
        index === 0
          ? id
          : index === 1
            ? secondId
            : `10000000-0000-4000-8000-${String(index + 401).padStart(12, '0')}`
      )
        .filter((value) => !search || !search.includes('-') || search === value)
        .map((value) => ({
          ...record(value),
          version: options.version,
          ...options.edited.get(value)
        }));
      const currentPage = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('pageSize') || 6);
      const items = records.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
      );
      return route.fulfill({
        json: {
          data_source: 'database',
          items,
          sponsorships: items,
          pagination: {
            page: currentPage,
            pageSize,
            totalItems: records.length,
            totalPages: Math.max(1, Math.ceil(records.length / pageSize)),
            hasPreviousPage: currentPage > 1,
            hasNextPage: currentPage * pageSize < records.length
          },
          last_updated_at: date
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/media')
      return route.fulfill({ json: { assets: options.media } });
    if (
      url.pathname.includes('/sponsorships/media/content/') ||
      (url.pathname === '/api/admin/sponsorships/logo' &&
        req.method() === 'GET')
    )
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
          'base64'
        )
      });
    if (
      url.pathname === '/api/admin/sponsorships/followup-access' &&
      req.method() === 'GET'
    )
      return route.fulfill({ json: { recipient: 'payment@example.invalid' } });
    if (
      req.method() === 'POST' &&
      [
        '/api/admin/sponsorships/media/review',
        '/api/admin/sponsorships/media/delete',
        '/api/admin/sponsorships/logo',
        '/api/admin/sponsorships/logo/delete',
        '/api/admin/sponsorships/publication',
        '/api/admin/sponsorships/website-visibility',
        '/api/admin/sponsorships/refund',
        '/api/admin/sponsorships/followup-access'
      ].includes(url.pathname)
    ) {
      if (options.mutationGate) await options.mutationGate;
      if (options.mutationStatus !== 200)
        return route.fulfill({
          status: options.mutationStatus,
          json: { error: 'Synthetic action failure' }
        });
      const input = req.headers()['content-type']?.includes('application/json')
        ? req.postDataJSON()
        : {};
      if (url.pathname.endsWith('/website-visibility')) {
        options.progressOverrides = {
          ...options.progressOverrides,
          website: {
            visible: input.visible,
            held: !input.visible,
            canPublish: true,
            version: 'v2',
            blockers: []
          },
          publicationCompletion: { done: input.visible ? 1 : 0, total: 1 }
        };
      }
      if (url.pathname.endsWith('/media/review'))
        options.media = options.media.map((asset) =>
          asset.id === input.assetId
            ? {
                ...asset,
                altText: input.altText || null,
                reviewStatus: input.reviewStatus,
                version: asset.version + '-updated'
              }
            : asset
        );
      if (url.pathname.endsWith('/media/delete'))
        options.media = options.media.filter(
          (asset) => asset.id !== input.assetId
        );
      if (url.pathname.endsWith('/logo'))
        options.edited.set(id, {
          sponsor_logo_url: `/api/public/sponsor-logos/${id}.webp`
        });
      if (url.pathname.endsWith('/logo/delete'))
        options.edited.set(id, { sponsor_logo_url: null });
      if (url.pathname.endsWith('/publication'))
        options.edited.set(id, {
          ...options.edited.get(id),
          sponsor_public_slug: input.publicSlug,
          sponsor_public_summary: input.publicSummary,
          sponsor_feed_status: input.feedStatus,
          sponsor_feed_target: input.feedTarget,
          sponsor_feed_channels: input.feedChannels,
          sponsor_feed_public_url: input.feedPublicUrl,
          sponsor_feed_notes: input.feedNotes
        });
      return route.fulfill({
        json: {
          updated: true,
          status: 'queued',
          sizeBytes: 68,
          refundWorkflowStatus: 'processing',
          refundStatus: 'pending'
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/details') {
      if (options.detailsGate) await options.detailsGate;
      const input = req.postDataJSON();
      if (options.detailsStatus === 200)
        options.edited.set(input.contributionId, {
          ...options.edited.get(input.contributionId),
          sponsor_company_name: input.companyName,
          public_name: input.publicName || null,
          sponsor_contact_name: input.contactName || null,
          sponsor_contact_email: input.contactEmail || null,
          sponsor_website_url: input.websiteUrl || null,
          version: 'v2'
        });
      return route.fulfill({
        status: options.detailsStatus,
        json:
          options.detailsStatus === 200
            ? { updated: true, version: 'v2' }
            : { error: 'Synthetic correction failure' }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/review') {
      if (options.reviewGate) await options.reviewGate;
      return route.fulfill({
        status: options.reviewStatus,
        json:
          options.reviewStatus === 200
            ? { updated: options.reviewUpdated }
            : { error: 'Conflict' }
      });
    }
    if (url.pathname === '/api/admin/attention')
      return route.fulfill({
        json: {
          available: true,
          coverage: 'complete',
          missingSources: [],
          generatedAt: date,
          timezone: 'America/Toronto',
          total: options.queueCount,
          filteredTotal: 0,
          todayTotal: options.queueCount,
          counts: {
            urgent: 0,
            today: options.queueCount,
            this_week: 0,
            informational: 2
          },
          typeCounts: {},
          actionCounts: { sponsorship_needs_review: options.queueCount },
          page: 1,
          pageSize: 25,
          items: [],
          firstSponsorshipId: id
        }
      });
    if (url.pathname === '/api/admin/assistant/context')
      return route.fulfill({
        json: {
          status: 'empty',
          generatedAt: date,
          conversationMode: 'disabled',
          context: null
        }
      });
    return route.fulfill({
      status: 503,
      json: { error: 'Synthetic fixture unavailable' }
    });
  });
  return { calls, options };
}
const progress = (page: Page) =>
  page.locator('[data-og7="sponsorship-progress"]');
const tabs = (page: Page) => page.locator('[data-og7="dossier-tabs"]');

const editForm = (page: Page) => page.locator('[data-og7="edit-dossier-form"]');
const guide = (page: Page) => page.locator('[data-og7="dossier-guide"]');

for (const width of [1280, 390]) {
  test(`dossier guide explains all milestones without validating them at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'operator');
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path());
    const panel = guide(page);
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: 'Revue', exact: true })
    ).toBeVisible();
    await expect(panel).toContainText('À traiter maintenant');
    const previous = panel.locator('[data-og7="guide-previous"]');
    const next = panel.locator('[data-og7="guide-next"]');
    for (let count = 0; count < 3; count++) await previous.click();
    await expect(previous).toBeDisabled();
    const titles = [
      'Paiement',
      'Identité',
      'Médias',
      'Revue',
      'Facturation',
      'Publication'
    ];
    for (const [index, title] of titles.entries()) {
      await expect(
        panel.getByRole('heading', { name: title, exact: true })
      ).toBeVisible();
      await expect(panel).toContainText(`Étape ${index + 1} sur 6`);
      await expect(panel.locator('ol > li')).toHaveCount(3);
      await expect(panel).toContainText('Qui intervient :');
      await expect(panel).toContainText('Condition de validation :');
      if (index < 5) {
        await next.focus();
        await page.keyboard.press('Enter');
      }
    }
    await expect(next).toBeDisabled();
    await expect(
      progress(page).locator('[data-og7-id="review"]')
    ).toHaveAttribute('data-state', 'pending');
    await expect(
      progress(page).locator('[data-og7-id="publication"]')
    ).toHaveAttribute('data-state', 'cancelled');
    await panel.locator('[data-og7="guide-recommended"]').click();
    await expect(
      panel.getByRole('heading', { name: 'Revue', exact: true })
    ).toBeVisible();
    for (let repeat = 0; repeat < 2; repeat++) {
      await panel.locator('[data-og7="guide-open-section"]').click();
      await expect(page).toHaveURL(/tab=overview#dossier-review$/);
      await expect(page.locator('#dossier-review')).toBeFocused();
      await expect(page.locator('#dossier-review')).toBeInViewport();
    }
    const summary = panel.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    if (width === 390)
      await panel.screenshot({ path: 'test-results/dossier-guide-mobile.png' });
  });
}

for (const role of ['owner', 'operator', 'reader'] as const) {
  test(`dossier guide identity actions respect ${role} access and recorded submission`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, role);
    options.edited.set(id, {
      sponsor_contact_email: null,
      sponsor_details_submitted_at: null
    });
    await page.goto(path('identity'));
    const panel = guide(page);
    await expect(
      panel.getByRole('heading', { name: 'Identité', exact: true })
    ).toBeVisible();
    await expect(panel.locator('[data-og7="guide-reason"]')).toContainText(
      'Coordonnées à compléter'
    );
    const edit = panel.locator('[data-og7="guide-edit-identity"]');
    if (role === 'reader') {
      await expect(edit).toHaveCount(0);
      await expect(panel).toContainText(
        'Vous consultez ce dossier en lecture seule'
      );
      await panel.locator('[data-og7="guide-open-section"]').click();
      await expect(page.locator('#dossier-identity')).toBeFocused();
      options.edited.set(id, { sponsor_details_submitted_at: null });
      await page.reload();
    } else {
      await edit.click();
      await expect(editForm(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(edit).toBeFocused();
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      await edit.click();
      await editForm(page)
        .getByLabel('Courriel du contact', { exact: true })
        .fill('guide@example.invalid');
      await editForm(page)
        .getByRole('button', { name: 'Enregistrer les modifications' })
        .click();
      expect(postsTo(calls, '/details')).toHaveLength(0);
      await page.locator('[data-og7="confirm-action"]').click();
      await expect(editForm(page)).toBeHidden();
    }
    await expect(panel.locator('[data-og7="guide-reason"]')).toContainText(
      'Coordonnées renseignées. En attente de la transmission'
    );
    await expect(panel).toContainText(
      'Une correction administrative des coordonnées ne remplace pas cette transmission'
    );
    if (role === 'owner') {
      await panel.locator('[data-og7="guide-followup-access"]').click();
      await expect(
        page.locator('[data-og7="admin-followup-access"]')
      ).toBeFocused();
      await expect(
        page.locator('[data-og7="admin-followup-access"]')
      ).toBeInViewport();
    } else {
      await expect(
        panel.locator('[data-og7="guide-followup-access"]')
      ).toHaveCount(0);
      await expect(panel).toContainText('demandez à un propriétaire');
    }
    expect(
      calls.filter((call) => call.url.pathname.endsWith('/followup-access'))
    ).toHaveLength(0);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(
      role === 'reader' ? 0 : 1
    );
  });
}

for (const [reason, tab, title, section] of [
  ['refund_check', 'refund', 'Refund to check', 'refund'],
  ['stripe_failed', 'overview', 'Failed Stripe event', 'stripe'],
  ['email_failed', 'billing', 'Failed email', 'billing']
] as const) {
  test(`dossier guide prioritizes ${reason} in English on mobile`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'operator');
    options.next = { reason, tab, adminUrl: path(tab) };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path());
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    const panel = guide(page);
    await expect(
      panel.getByRole('heading', { name: title, exact: true })
    ).toBeVisible();
    await expect(panel).toContainText('Step 1 of 7');
    await expect(panel).toContainText('Handle now');
    await expect(panel).not.toContainText('admin.dossier.');
    if (reason === 'refund_check')
      await expect(panel).toContainText('Ask an owner to process it');
    await panel.locator('[data-og7="guide-open-section"]').click();
    await expect(page.locator('#dossier-' + section)).toBeFocused();
    await expect(page.locator('#dossier-' + section)).toBeInViewport();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
}

test('dossier guide clears unavailable facts and resets its recommendation after changing dossier', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.progressGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto('/admin/fundraiser/sponsors');
  await expect(progress(page)).toContainText('Chargement du dossier');
  await expect(guide(page)).toHaveCount(0);
  release();
  options.progressGate = null;
  await guide(page).locator('[data-og7="guide-previous"]').click();
  await expect(
    guide(page).getByRole('heading', { name: 'Médias', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: /Atelier Rivage/ }).click();
  await expect(
    guide(page).getByRole('heading', { name: 'Revue', exact: true })
  ).toBeVisible();
  await expect(
    guide(page).locator('[data-og7="guide-open-section"]')
  ).toHaveAttribute(
    'href',
    new RegExp(`sponsorshipId=${secondId}.*#dossier-review$`)
  );
  for (const status of [503, 403]) {
    options.status = status;
    await progress(page)
      .getByRole('button', { name: 'Actualiser le dossier' })
      .click();
    await expect(guide(page)).toHaveCount(0);
    await expect(progress(page).getByRole('alert')).toBeVisible();
  }
});

test('completed dossier guide remains consultable and never asks to validate browsing', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.next = { reason: 'complete', tab: 'overview', adminUrl: path() };
  options.milestones = dossier().milestones.map((step) => ({
    ...step,
    state: 'complete'
  }));
  await page.goto(path());
  const panel = guide(page);
  await expect(panel).toContainText(
    'Toutes les étapes requises sont terminées'
  );
  await expect(panel).not.toContainText('À traiter maintenant');
  for (let count = 0; count < 5; count++)
    await panel.locator('[data-og7="guide-next"]').click();
  await expect(panel.locator('[data-og7="guide-next"]')).toBeDisabled();
  await expect(panel.locator('[data-og7="guide-recommended"]')).toHaveCount(0);
  await expect(panel.locator('[data-og7="guide-edit-identity"]')).toHaveCount(
    0
  );
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

for (const role of ['owner', 'operator', 'reader'] as const) {
  test(`identity guidance separates missing coordinates and submission for ${role}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, role);
    options.edited.set(id, {
      sponsor_company_name: null,
      sponsor_contact_email: null,
      sponsor_details_submitted_at: null
    });
    await page.setViewportSize({
      width: role === 'owner' ? 1280 : 390,
      height: 844
    });
    await page.goto(path('identity') + '#dossier-identity');
    const identity = page.locator('#dossier-identity');
    await expect(identity).toBeFocused();
    await expect(identity.getByRole('complementary')).toContainText(
      'Coordonnées et transmission : deux actions distinctes'
    );
    await expect(identity.getByRole('complementary')).toContainText(
      'elle ne transmet pas le formulaire au nom du commanditaire'
    );
    await expect(
      identity.locator('[data-og7="identity-coordinates-status"]')
    ).toContainText(
      'Renseignez le nom de l’entreprise et le courriel du contact'
    );
    await expect(
      identity.locator('[data-og7="identity-submission-status"]')
    ).toContainText('En attente de la transmission');
    await expect(identity).toContainText(
      'Une correction administrative des coordonnées ne remplace pas cette transmission.'
    );
    await expect(
      progress(page).locator('[data-og7-id="identity"]')
    ).toContainText('Coordonnées à compléter');
    const edit = identity.locator('[data-og7="identity-edit"]');
    if (role === 'reader') {
      await expect(edit).toHaveCount(0);
      await expect(identity).toContainText('Votre accès est en lecture seule');
    } else {
      await edit.focus();
      await page.keyboard.press('Enter');
      await expect(editForm(page)).toBeVisible();
      await expect(
        editForm(page).getByLabel('Nom de l’entreprise', { exact: true })
      ).toHaveValue('');
      await page.keyboard.press('Escape');
      await expect(edit).toBeFocused();
    }
    const followup = identity.locator('[data-og7="identity-followup-access"]');
    if (role === 'owner') {
      await followup.click();
      const access = page.locator('[data-og7="admin-followup-access"]');
      await expect(access).toBeFocused();
      await expect(access).toBeInViewport();
      await page.keyboard.press('Tab');
      await expect(access.getByRole('button')).toBeFocused();
      expect(
        calls.filter((call) => call.url.pathname.endsWith('/followup-access'))
      ).toHaveLength(0);
    } else {
      await expect(followup).toHaveCount(0);
      await expect(identity).toContainText('demandez à un propriétaire');
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
}

for (const alreadySubmitted of [false, true]) {
  test(`identity correction preserves sponsor submission: ${alreadySubmitted}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'operator');
    options.edited.set(id, {
      sponsor_contact_email: null,
      sponsor_details_submitted_at: alreadySubmitted ? date : null
    });
    await page.goto(path('identity'));
    const identity = page.locator('#dossier-identity');
    await identity.locator('[data-og7="identity-edit"]').click();
    const form = editForm(page);
    await expect(form).toContainText(
      'Cette correction ne remplace pas la transmission du formulaire'
    );
    const submissionHelp = form.locator(
      '[data-og7="edit-dossier-submission-help"]'
    );
    if (alreadySubmitted) await expect(submissionHelp).toHaveCount(0);
    else
      await expect(submissionHelp).toContainText(
        'Même si vous remplissez tous les champs'
      );
    await form
      .getByLabel('Courriel du contact', { exact: true })
      .fill('identity@example.invalid');
    await form
      .getByRole('button', { name: 'Enregistrer les modifications' })
      .click();
    expect(postsTo(calls, '/details')).toHaveLength(0);
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(
      identity.locator('[data-og7="identity-coordinates-status"]')
    ).toContainText(
      'Le nom de l’entreprise et le courriel du contact sont renseignés.'
    );
    const step = progress(page).locator('[data-og7-id="identity"]');
    await expect(step).toHaveAttribute(
      'data-state',
      alreadySubmitted ? 'complete' : 'pending'
    );
    await expect(
      identity.locator('[data-og7="identity-submission-status"]')
    ).toHaveText(
      alreadySubmitted
        ? 'Le commanditaire a transmis son formulaire.'
        : 'En attente de la transmission du formulaire par le commanditaire.'
    );
    if (!alreadySubmitted) {
      await expect(
        identity.locator('[data-og7="identity-submission-required"]')
      ).toContainText('vous ne pouvez pas la valider à sa place');
      await expect(progress(page)).toContainText(
        'Coordonnées renseignées. En attente de la transmission'
      );
      // Simulate a later sponsor submission returned by the API, independently of the correction.
      options.edited.set(id, {
        ...options.edited.get(id),
        sponsor_details_submitted_at: date
      });
      await page.reload();
      await expect(step).toHaveAttribute('data-state', 'complete');
      await expect(
        identity.locator('[data-og7="identity-submission-status"]')
      ).toHaveText('Le commanditaire a transmis son formulaire.');
    }
    await expect(
      identity.locator('[data-og7="identity-submission-required"]')
    ).toHaveCount(0);
    await expect(
      identity.locator('[data-og7="identity-followup-access"]')
    ).toHaveCount(0);
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].url.pathname).toBe('/api/admin/sponsorships/details');
    expect(writes[0].body).not.toHaveProperty('sponsor_details_submitted_at');
  });
}

test('pending sponsor submission is explained from the cockpit through identity in English on mobile', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  options.edited.set(id, { sponsor_details_submitted_at: null });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser');
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(progress(page)).toContainText(
    'Contact details are present. Waiting for the sponsor'
  );
  await progress(page)
    .getByRole('link', { name: 'View identity', exact: true })
    .click();
  const identity = page.locator('#dossier-identity');
  await expect(identity).toBeFocused();
  await expect(identity).toBeInViewport();
  await expect(identity).toContainText(
    'The company name and contact email are present.'
  );
  await expect(identity).toContainText(
    'Waiting for the sponsor to submit their form.'
  );
  await expect(identity.getByRole('complementary')).toContainText(
    'Contact details and submission: two separate actions'
  );
  await expect(
    identity.locator('[data-og7="identity-submission-required"]')
  ).toContainText('Even if you fill in every field');
  await expect(
    identity.getByRole('button', { name: 'Edit identity and contact details' })
  ).toBeEnabled();
  await expect(
    identity.getByRole('button', { name: 'View sponsor follow-up access' })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

const actions = (page: Page) => page.locator('[data-og7="dossier-actions"]');

for (const width of [1920, 1280, 390]) {
  test(`review actions float within the selected dossier at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path());
    const panel = page.locator('[data-og7="sponsorship-dossier"]');
    const dock = actions(page);
    await expect(dock).toHaveAccessibleName('Actions de validation');
    await expect(dock).toContainText('Atelier Boréal');
    await expect(dock).toContainText('DEMO-401');

    // Bring the dossier into view without scrolling to its action footer.
    await panel.evaluate((element) => {
      element.scrollTop = 0;
      window.scrollTo({
        top: scrollY + element.getBoundingClientRect().top - 24,
        behavior: 'instant'
      });
    });
    for (const label of [
      'Remettre en attente',
      'Refuser',
      'Rembourser Stripe',
      'Accepter'
    ]) {
      await expect(
        dock.getByRole('button', { name: label, exact: true })
      ).toBeInViewport({ ratio: 1 });
    }
    const initialDock = await dock.boundingBox();
    expect(initialDock!.y + initialDock!.height).toBeLessThanOrEqual(844);

    await tabs(page)
      .getByRole('button', { name: 'Médias', exact: true })
      .click();
    await expect(
      dock.getByRole('button', { name: 'Accepter', exact: true })
    ).toBeInViewport({ ratio: 1 });
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'instant'
      });
    });
    const review = page.locator('#dossier-review');
    await expect(review).toBeInViewport({ ratio: 1 });
    const reviewBox = await review.boundingBox();
    const dockBox = await dock.boundingBox();
    expect(reviewBox!.y + reviewBox!.height).toBeLessThanOrEqual(dockBox!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    await page.screenshot({
      path: `test-results/dossier-floating-actions-${width}.png`
    });
  });
}

const mediaAsset = (assetId = secondId): SponsorMediaAsset => ({
  id: assetId,
  contributionId: id,
  kind: 'supporting_image',
  reviewStatus: 'pending_review',
  uploadedBy: 'sponsor',
  originalFilename: 'fixture.png',
  originalMimeType: 'image/png',
  originalSizeBytes: 68,
  processedMimeType: 'image/webp',
  processedSizeBytes: 68,
  width: 1,
  height: 1,
  altText: 'Description initiale',
  sortOrder: 0,
  publicUrl: null,
  reviewedAt: null,
  version: 'v1',
  createdAt: date
});
const postsTo = (
  calls: Awaited<ReturnType<typeof fixtures>>['calls'],
  suffix: string
) =>
  calls.filter(
    (call) => call.method === 'POST' && call.url.pathname.endsWith(suffix)
  );

test('dossier controls respect reader and operator permissions', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.media = [mediaAsset()];
  await page.goto(path());
  await expect(
    page.getByText('Accès en lecture seule', { exact: false })
  ).toBeVisible();
  await expect(actions(page).getByRole('button')).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0);
  await expect(page.locator('[data-og7="admin-followup-access"]')).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: 'Modifier le dossier', exact: true })
  ).toBeDisabled();
  await page
    .locator('openg7-admin-sponsor-detail-overview')
    .getByRole('button', { name: 'Note interne', exact: true })
    .click();
  await expect(
    page.locator('dialog[open]').getByRole('textbox')
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await tabs(page).getByRole('button', { name: 'Médias', exact: true }).click();
  const media = page.locator('openg7-admin-sponsor-detail-media');
  for (const button of [
    'Tout approuver',
    'Approuver le media',
    'Refuser',
    'Supprimer',
    'Supprimer le logo'
  ])
    await expect(
      media.getByRole('button', { name: button, exact: true })
    ).toBeDisabled();
  await expect(media.locator('input[type="file"]')).toBeDisabled();
  await media.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await expect(page.locator('dialog[open]').getByRole('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  await page.locator('[data-og7="publication-advanced"] summary').click();
  await expect(
    page
      .locator('[data-og7="dossier-publication-editor"]')
      .getByRole('button', { name: 'Enregistrer', exact: true })
  ).toBeDisabled();
  await expect(page.getByLabel('Slug public', { exact: false })).toBeDisabled();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('operator can review but owner controls are absent', async ({ page }) => {
  await fixtures(page, 'operator');
  await page.goto(path());
  await expect(
    actions(page).getByRole('button', { name: 'Accepter', exact: true })
  ).toBeEnabled();
  await expect(
    actions(page).getByRole('button', { name: 'Refuser', exact: true })
  ).toBeEnabled();
  await expect(
    actions(page).getByRole('button', {
      name: 'Rembourser Stripe',
      exact: true
    })
  ).toHaveCount(0);
  await expect(page.locator('[data-og7="admin-followup-access"]')).toHaveCount(
    0
  );
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`approval effect waits for confirmation and respects ${reducedMotion}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    options.reviewGate = new Promise((resolve) => {
      release = resolve;
    });
    options.reviewStatus = 200;
    await page.goto(path());
    const approve = page.locator('[data-og7="sponsorship-approve"]');
    await expect(approve).toHaveAttribute('data-state', 'idle');
    await approve.focus();
    await page.keyboard.press('Enter');
    await expect(approve).toHaveAttribute('data-state', 'pending');
    await expect(approve).toHaveAttribute('aria-busy', 'true');
    await expect(approve).toBeDisabled();
    await expect(actions(page)).toHaveAttribute(
      'data-approval-state',
      'pending'
    );
    const moving = () =>
      approve.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .map(
            (animation) =>
              (animation as CSSAnimation).animationName ||
              animation.constructor.name
          )
      );
    if (reducedMotion === 'reduce') expect(await moving()).toEqual([]);
    else expect((await moving()).length).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    expect(postsTo(calls, '/review')).toHaveLength(1);

    options.edited.set(id, {
      sponsor_review_status: 'approved',
      version: 'v2'
    });
    release();
    await expect(approve).toHaveAttribute('data-state', 'success');
    await expect(approve).toHaveAttribute('aria-busy', 'false');
    await expect(approve).toBeDisabled();
    await expect(actions(page)).toHaveAttribute(
      'data-approval-state',
      'success'
    );
    if (reducedMotion === 'reduce') expect(await moving()).toEqual([]);
    else {
      expect((await moving()).length).toBeGreaterThan(0);
      // Capture the actual CSS celebration at its peak for visual review.
      await approve.evaluate((element) => {
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 280;
        }
      });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: `test-results/dossier-approval-${reducedMotion}.png`
    });
    await expect(approve).toHaveAttribute('data-state', 'idle');
    await expect(approve).toBeDisabled();
    expect(postsTo(calls, '/review')).toHaveLength(1);
  });
}

for (const failure of ['http', 'not_updated'] as const) {
  test(`approval effect reports ${failure} failure without celebrating and allows retry`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.reviewStatus = failure === 'http' ? 503 : 200;
    options.reviewUpdated = failure !== 'not_updated';
    await page.goto(path());
    const approve = page.locator('[data-og7="sponsorship-approve"]');
    await approve.click();
    await expect(approve).toHaveAttribute('data-state', 'error');
    await expect(approve).toHaveAttribute('aria-busy', 'false');
    await expect(approve).toBeEnabled();
    await expect(actions(page)).toHaveAttribute('data-approval-state', 'error');
    options.reviewStatus = 200;
    options.reviewUpdated = true;
    options.edited.set(id, { sponsor_review_status: 'approved' });
    await approve.click();
    await expect(approve).toHaveAttribute('data-state', 'success');
    expect(postsTo(calls, '/review')).toHaveLength(2);
  });
}

test('late approval never celebrates on another dossier or after returning to its source', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  options.reviewStatus = 200;
  await page.goto('/admin/fundraiser/sponsors');
  const approve = page.locator('[data-og7="sponsorship-approve"]');
  await approve.click();
  await expect(approve).toHaveAttribute('data-state', 'pending');
  await page.getByRole('button', { name: /Atelier Rivage/ }).click();
  await expect(actions(page)).toContainText('DEMO-402');
  await expect(approve).toHaveAttribute('data-state', 'idle');
  release();
  await expect(approve).toBeEnabled();
  await expect(approve).toHaveAttribute('data-state', 'idle');
  await page.getByRole('button', { name: /Atelier Boréal/ }).click();
  await expect(actions(page)).toContainText('DEMO-401');
  await expect(approve).toHaveAttribute('data-state', 'idle');
});

test('review controls disable redundant decisions and retain mandatory refusal confirmation', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.reviewStatus = 200;
  await page.goto(path('identity'));
  await expect(
    actions(page).getByRole('button', { name: 'Remettre en attente' })
  ).toBeDisabled();
  const reject = actions(page).getByRole('button', {
    name: 'Refuser',
    exact: true
  });
  await reject.click();
  await expect(page).toHaveURL(path('overview'));
  const form = page.locator('[data-og7="dossier-rejection-form"]');
  await expect(form.getByLabel('Raison interne du refus')).toBeFocused();
  const confirm = form.getByRole('button', { name: /Confirmer/ });
  await expect(confirm).toBeDisabled();
  await form.getByLabel('Raison interne du refus').fill('Motif synthétique');
  await form.getByRole('checkbox').uncheck();
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(reject).toBeFocused();
  expect(postsTo(calls, '/review')).toHaveLength(0);
  await reject.click();
  await confirm.click();
  await expect(form).toHaveCount(0);
  expect(postsTo(calls, '/review')[0]?.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    reviewStatus: 'rejected',
    reviewNote: 'Motif synthétique',
    notifySponsor: false
  });
  options.edited.set(id, { sponsor_review_status: 'approved' });
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    actions(page).getByRole('button', { name: 'Accepter', exact: true })
  ).toBeDisabled();
  await actions(page)
    .getByRole('button', { name: 'Remettre en attente' })
    .click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(postsTo(calls, '/review')).toHaveLength(1);
  await actions(page)
    .getByRole('button', { name: 'Remettre en attente' })
    .click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect.poll(() => postsTo(calls, '/review').length).toBe(2);
});

test('bulk media approval keeps edited alternative text and approved media text remains editable', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.media = [mediaAsset()];
  await page.goto(path('media'));
  const media = page.locator('[data-og7="admin-sponsor-media"]');
  await media
    .getByRole('textbox')
    .fill('Description préparée avant approbation');
  await page.getByRole('button', { name: 'Tout approuver' }).click();
  await expect(media.getByRole('textbox')).toHaveValue(
    'Description préparée avant approbation'
  );
  const saveText = media.getByRole('button', {
    name: 'Enregistrer le texte alternatif'
  });
  await expect(saveText).toBeDisabled();
  expect(postsTo(calls, '/media/review')[0]?.body?.['altText']).toBe(
    'Description préparée avant approbation'
  );
  await media
    .getByRole('textbox')
    .fill('Description corrigée après approbation');
  await expect(saveText).toBeEnabled();
  await saveText.click();
  await expect(saveText).toBeDisabled();
  expect(postsTo(calls, '/media/review')[1]?.body).toMatchObject({
    reviewStatus: 'approved',
    expectedVersion: 'v1-updated',
    altText: 'Description corrigée après approbation'
  });
});

test('media decisions lock competing actions and deletion needs confirmation', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.media = [mediaAsset()];
  let release!: () => void;
  options.mutationGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path('media'));
  const media = page.locator('[data-og7="admin-sponsor-media"]');
  await media.getByRole('button', { name: 'Approuver le media' }).click();
  for (const button of ['Accepter', 'Refuser', 'Rembourser Stripe'])
    await expect(
      actions(page).getByRole('button', { name: button, exact: true })
    ).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  release();
  await expect(
    media.getByRole('button', { name: 'Refuser', exact: true })
  ).toBeEnabled();
  options.mutationGate = null;
  await media.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="confirm-action"]')).toBeHidden();
  expect(postsTo(calls, '/media/review')).toHaveLength(1);
  await media.getByRole('button', { name: 'Refuser', exact: true }).click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(
    media.getByRole('button', { name: 'Refuser', exact: true })
  ).toBeDisabled();
  await media.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="confirm-action"]')).toBeHidden();
  expect(postsTo(calls, '/media/delete')).toHaveLength(0);
  await media.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(media).toHaveCount(0);
  expect(postsTo(calls, '/media/delete')[0]?.body).toMatchObject({
    assetId: secondId,
    confirmation: secondId,
    expectedVersion: 'v1-updated-updated'
  });
});

test('publication save normalizes the slug, confirms visibility and preserves a failed draft', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.edited.set(id, { sponsor_review_status: 'approved' });
  await page.goto(path('publication'));
  const editor = page.locator('[data-og7="dossier-publication-editor"]');
  await page.locator('[data-og7="publication-advanced"] summary').click();
  const slug = editor.getByLabel('Slug public', { exact: false });
  const save = editor.getByRole('button', { name: 'Enregistrer', exact: true });
  await slug.fill('invalid slug !');
  await expect(slug).toHaveValue('invalid-slug');
  await slug.fill('atelier-demo');
  await editor.getByLabel('Destination feed').selectOption('openg7');
  await editor.getByLabel('Statut feed').selectOption('published');
  await save.click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(postsTo(calls, '/publication')).toHaveLength(0);
  options.mutationStatus = 503;
  await save.click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(editor).toContainText('Synthetic action failure');
  await expect(slug).toHaveValue('atelier-demo');
  options.mutationStatus = 200;
  await save.click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(save).toBeDisabled();
  expect(postsTo(calls, '/publication')[1]?.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    publicSlug: 'atelier-demo',
    feedStatus: 'published'
  });
});

test('refund validates amount and reference, cancellation is inert and submission is singular', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  await page.goto(path('refund'));
  const opener = actions(page).getByRole('button', {
    name: 'Rembourser Stripe'
  });
  await opener.click();
  const form = page.locator('[data-og7="dossier-refund-form"]');
  const amount = form.getByRole('spinbutton');
  await expect(amount).toBeFocused();
  const confirm = form.getByRole('button', { name: /^Rembours/ });
  await expect(confirm).toBeDisabled();
  await form.locator('input[autocomplete="off"]').fill('DEMO-401');
  await amount.fill('501');
  await expect(confirm).toBeDisabled();
  await amount.fill('25');
  await form.getByRole('checkbox').uncheck();
  await expect(confirm).toBeEnabled();
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(opener).toBeFocused();
  expect(postsTo(calls, '/refund')).toHaveLength(0);
  await opener.click();
  let release!: () => void;
  options.mutationGate = new Promise((resolve) => {
    release = resolve;
  });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(
    form.getByRole('button', { name: 'Annuler', exact: true })
  ).toBeDisabled();
  release();
  await expect(form).toHaveCount(0);
  expect(postsTo(calls, '/refund')).toHaveLength(1);
  expect(postsTo(calls, '/refund')[0]?.body).toMatchObject({
    contributionId: id,
    confirmationText: 'DEMO-401',
    amount: 25,
    notifySponsor: false,
    expectedVersion: 'v1'
  });
});

test('private access resend confirms recipient and retry reuses the request identifier', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  await page.goto(path());
  const access = page.locator('[data-og7="admin-followup-access"]');
  await access.getByRole('button').click();
  await expect(page.locator('dialog[open]')).toContainText(
    'payment@example.invalid'
  );
  await page.keyboard.press('Escape');
  expect(postsTo(calls, '/followup-access')).toHaveLength(0);
  options.mutationStatus = 503;
  await access.getByRole('button').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(access).toContainText('Le lien n’a pas pu être mis en file');
  options.mutationStatus = 200;
  await access.getByRole('button').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(access).toContainText('Le courriel est en file d’envoi');
  await expect.poll(() => postsTo(calls, '/followup-access').length).toBe(2);
  const sent = postsTo(calls, '/followup-access');
  expect(sent[1]?.body).toEqual(sent[0]?.body);
  expect(sent[0]?.body).toMatchObject({
    contributionId: id,
    recipient: 'payment@example.invalid',
    confirmed: true
  });
});

test('logo upload rejects invalid files, reports failure and deletion is confirmed', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  await page.goto(path('media'));
  const media = page.locator('openg7-admin-sponsor-detail-media');
  const upload = media.locator('input[type="file"]');
  const remove = media.getByRole('button', { name: 'Supprimer le logo' });
  await expect(remove).toBeDisabled();
  await upload.setInputFiles({
    name: 'fixture.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic')
  });
  await expect(media).toContainText('Logo refuse');
  expect(postsTo(calls, '/logo')).toHaveLength(0);
  await upload.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(512 * 1024 + 1)
  });
  expect(postsTo(calls, '/logo')).toHaveLength(0);
  const file = {
    name: 'fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic image handled by API fixture')
  };
  options.mutationStatus = 503;
  await upload.setInputFiles(file);
  await expect(media).toContainText('Synthetic action failure');
  options.mutationStatus = 200;
  await upload.setInputFiles(file);
  await expect(remove).toBeEnabled();
  await expect(media.getByRole('img')).toHaveAttribute('src', /^blob:/);
  await remove.click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="confirm-action"]')).toBeHidden();
  expect(postsTo(calls, '/logo/delete')).toHaveLength(0);
  await remove.click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(remove).toBeDisabled();
  expect(postsTo(calls, '/logo/delete')[0]?.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1'
  });
});

test('failed media approval preserves its text and can be retried without changing the decision', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.media = [mediaAsset()];
  options.mutationStatus = 503;
  await page.goto(path('media'));
  const media = page.locator('[data-og7="admin-sponsor-media"]');
  await media.getByRole('textbox').fill('Description conservée');
  await page.getByRole('button', { name: 'Tout approuver' }).click();
  await expect(page.locator('openg7-admin-sponsor-detail-media')).toContainText(
    'Synthetic action failure'
  );
  await expect(media.getByRole('textbox')).toHaveValue('Description conservée');
  options.mutationStatus = 200;
  await page.getByRole('button', { name: 'Tout approuver' }).click();
  await expect(
    media.getByRole('button', { name: 'Enregistrer le texte alternatif' })
  ).toBeDisabled();
  expect(postsTo(calls, '/media/review')[1]?.body).toEqual(
    postsTo(calls, '/media/review')[0]?.body
  );
});

test('English mobile media editing works with keyboard and without horizontal overflow', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.media = [{ ...mediaAsset(), reviewStatus: 'approved' }];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('media'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const media = page.locator('[data-og7="admin-sponsor-media"]');
  await media.getByRole('textbox').fill('Updated alternative text');
  const save = media.getByRole('button', { name: 'Save alternative text' });
  await save.focus();
  await save.press('Enter');
  await expect(save).toBeDisabled();
  expect(postsTo(calls, '/media/review')[0]?.body?.['altText']).toBe(
    'Updated alternative text'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
});

for (const blocked of [
  { payment_status: 'refunded' },
  { payment_status: 'disputed' },
  { sponsorship_refund_status: 'processing' }
] as const) {
  test(`ineligible financial state disables approval, publication and refund: ${JSON.stringify(blocked)}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.edited.set(id, blocked);
    await page.goto(path('publication'));
    await page.locator('[data-og7="publication-advanced"] summary').click();
    await expect(
      actions(page).getByRole('button', { name: 'Accepter', exact: true })
    ).toBeDisabled();
    await expect(
      actions(page).getByRole('button', { name: 'Rembourser Stripe' })
    ).toBeDisabled();
    await expect(
      page
        .locator('[data-og7="dossier-publication-editor"]')
        .getByRole('button', { name: 'Enregistrer', exact: true })
    ).toBeDisabled();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
}

test('copy, refresh, close, list pagination and filter reset perform their named actions', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.listSize = 8;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(path());
  await page.getByRole('button', { name: 'Copier', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('DEMO-401');
  await page
    .getByRole('button', { name: 'Fermer le dossier', exact: true })
    .click();
  await expect(page).not.toHaveURL(/sponsorshipId=/);
  await expect(tabs(page)).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0);
  const list = page.locator('openg7-admin-sponsors-list-panel');
  await list
    .getByRole('button', { name: 'Reinitialiser', exact: true })
    .click();
  await expect(list.getByRole('searchbox')).toHaveValue('');
  await expect(
    list.getByRole('button', { name: 'Page precedente' })
  ).toBeDisabled();
  await list.getByRole('button', { name: 'Page suivante' }).click();
  await expect(
    list.getByRole('button', { name: 'Page suivante' })
  ).toBeDisabled();
  await list.getByRole('button', { name: 'Page precedente' }).click();
  await expect(
    list.getByRole('button', { name: 'Page precedente' })
  ).toBeDisabled();
  await list.getByLabel('Par page').selectOption('10');
  await expect(
    list.getByRole('button', { name: 'Page suivante' })
  ).toBeDisabled();
  await list.getByLabel('Statut de revue').selectOption('approved');
  await expect
    .poll(() =>
      calls
        .filter((call) => call.url.pathname === '/api/admin/sponsorships')
        .at(-1)
        ?.url.searchParams.get('reviewStatus')
    )
    .toBe('approved');
  options.listStatus = 503;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Reessayer' })).toBeVisible();
  options.listStatus = 200;
  await list.getByRole('button', { name: 'Reessayer' }).click();
  await expect(list.getByRole('button', { name: 'Reessayer' })).toHaveCount(0);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
const saveDetails = async (page: Page) => {
  await editForm(page)
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  await page.locator('[data-og7="confirm-action"]').click();
};

for (const width of [1440, 390]) {
  test(`opening dossier editing prefills every company field at ${width}px`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.edited.set(id, {
      public_name: 'Boréal public',
      sponsor_contact_name: 'Camille Boréal',
      sponsor_contact_email: 'camille@example.invalid',
      sponsor_website_url: 'https://boreal.example.invalid'
    });
    await page.addInitScript(() => {
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        const form = this.querySelector('[data-og7="edit-dossier-form"]');
        if (form) {
          form.setAttribute(
            'data-values-at-open',
            JSON.stringify(
              Array.from(form.querySelectorAll('input'), (input) => input.value)
            )
          );
        }
        showModal.call(this);
      };
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path());
    const opener = page.getByRole('button', {
      name: 'Modifier le dossier',
      exact: true
    });
    const form = editForm(page);
    const expected = [
      ['Nom de l’entreprise', 'Atelier Boréal'],
      ['Nom public', 'Boréal public'],
      ['Nom du contact', 'Camille Boréal'],
      ['Courriel du contact', 'camille@example.invalid'],
      ['Site web', 'https://boreal.example.invalid']
    ];
    for (let opening = 0; opening < 2; opening++) {
      await opener.click();
      await expect(form).toHaveAttribute(
        'data-values-at-open',
        JSON.stringify(expected.map(([, value]) => value))
      );
      for (const [label, value] of expected) {
        await expect(form.getByLabel(label, { exact: true })).toHaveValue(
          value
        );
      }
      await expect(
        form.getByRole('button', { name: 'Enregistrer les modifications' })
      ).toBeDisabled();
      await expect(form.getByLabel('Motif de la modification')).toHaveValue(
        'correction'
      );
      await form
        .getByLabel('Motif de la modification')
        .selectOption('organization_update');
      await form
        .getByLabel('Nom de l’entreprise', { exact: true })
        .fill('Brouillon annulé');
      await form.getByRole('button', { name: 'Annuler', exact: true }).click();
    }
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
}

test('switching dossiers prefills the selected company and clears absent optional fields', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.edited.set(id, {
    public_name: 'Boréal public',
    sponsor_website_url: 'https://boreal.example.invalid'
  });
  options.edited.set(secondId, {
    sponsor_contact_name: null,
    sponsor_contact_email: null
  });
  await page.goto('/admin/fundraiser/sponsors');
  const opener = page.getByRole('button', {
    name: 'Modifier le dossier',
    exact: true
  });
  const form = editForm(page);
  await opener.click();
  await expect(form.getByLabel('Nom public', { exact: true })).toHaveValue(
    'Boréal public'
  );
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: /Atelier Rivage/ }).click();
  await expect(actions(page)).toContainText('Atelier Rivage');
  await expect(actions(page)).toContainText('DEMO-402');
  await expect(actions(page)).not.toContainText('Atelier Boréal');
  await opener.click();
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Atelier Rivage');
  for (const label of [
    'Nom public',
    'Nom du contact',
    'Courriel du contact',
    'Site web'
  ]) {
    await expect(form.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await expect(
    form.getByRole('button', { name: 'Enregistrer les modifications' })
  ).toBeDisabled();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('dossier identity correction requires confirmation and refreshes the saved fields', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  const form = editForm(page);
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Atelier Boréal');
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Atelier corrigé');
  await form
    .getByLabel('Nom public', { exact: true })
    .fill('Nom public corrigé');
  await form
    .getByLabel('Courriel du contact', { exact: true })
    .fill('corrected@example.invalid');
  await form
    .getByLabel('Site web', { exact: true })
    .fill('https://example.invalid/updated');
  await form
    .getByLabel('Motif de la modification')
    .selectOption('contact_update');
  await form
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .filter({ has: page.locator('[data-og7="confirm-action"]') })
  ).toContainText('corrected@example.invalid');
  expect(calls.filter((c) => c.url.pathname.endsWith('/details'))).toHaveLength(
    0
  );
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Les modifications du dossier sont enregistrées.' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Atelier corrigé', exact: true })
  ).toBeVisible();
  const writes = calls.filter((c) => c.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    confirmed: true,
    companyName: 'Atelier corrigé',
    publicName: 'Nom public corrigé',
    contactName: 'Contact démo',
    contactEmail: 'corrected@example.invalid',
    websiteUrl: 'https://example.invalid/updated',
    reason: 'contact_update'
  });
  expect(writes[0].body?.['requestId']).toMatch(/^[0-9a-f-]{36}$/);
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  await expect(
    form.getByLabel('Courriel du contact', { exact: true })
  ).toHaveValue('corrected@example.invalid');
});

test('invalid dossier fields show associated errors and cancellation restores focus without saving', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  const opener = page.getByRole('button', {
    name: 'Modifier le dossier',
    exact: true
  });
  await opener.click();
  const form = editForm(page);
  await form.getByLabel('Nom de l’entreprise', { exact: true }).fill('');
  await form
    .getByLabel('Courriel du contact', { exact: true })
    .fill('invalid-email');
  await form
    .getByLabel('Site web', { exact: true })
    .fill('javascript:alert(1)');
  await form
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  for (const label of [
    'Nom de l’entreprise',
    'Courriel du contact',
    'Site web'
  ]) {
    await expect(form.getByLabel(label, { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await expect(form.getByLabel(label, { exact: true })).toHaveAttribute(
      'aria-describedby',
      /sponsor-edit-error-/
    );
  }
  await page.keyboard.press('Escape');
  await expect(form).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

test('dossier save failure preserves entries and retry reuses the same request without duplicate submissions', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.detailsStatus = 503;
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  const form = editForm(page);
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Correction conservée');
  await saveDetails(page);
  await expect(form.getByRole('alert')).toContainText(
    'Vos saisies sont conservées'
  );
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Correction conservée');
  options.detailsStatus = 200;
  let release!: () => void;
  options.detailsGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await saveDetails(page);
  await expect(
    form.getByRole('button', { name: 'Enregistrement…' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  await expect
    .poll(() => calls.filter((c) => c.url.pathname.endsWith('/details')).length)
    .toBe(2);
  const writes = calls.filter((c) => c.url.pathname.endsWith('/details'));
  expect(writes[0].body).toEqual(writes[1].body);
  release();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Correction conservée', exact: true })
  ).toBeVisible();
});

test('a conflicting dossier requires refresh before another correction', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.detailsStatus = 409;
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  const form = editForm(page);
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Correction en conflit');
  await saveDetails(page);
  await expect(form.getByRole('alert')).toContainText('Ce dossier a changé');
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Correction en conflit');
  await expect(
    form.getByRole('button', { name: 'Enregistrer les modifications' })
  ).toBeDisabled();
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  options.version = 'v2';
  options.detailsStatus = 200;
  await page
    .getByRole('alert')
    .filter({ hasText: 'Le dossier a changé' })
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le dossier a changé' })
  ).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Correction après actualisation');
  await saveDetails(page);
  await expect(form).not.toBeVisible();
  const writes = calls.filter((c) => c.url.pathname.endsWith('/details'));
  expect(writes[1].body?.['expectedVersion']).toBe('v2');
});

for (const status of [401, 403]) {
  test(`dossier correction clears the draft on authorization failure ${status}`, async ({
    page
  }) => {
    const { options } = await fixtures(page);
    options.detailsStatus = status;
    await page.goto(path());
    await page
      .getByRole('button', { name: 'Modifier le dossier', exact: true })
      .click();
    await editForm(page)
      .getByLabel('Nom de l’entreprise', { exact: true })
      .fill('Private correction draft');
    await saveDetails(page);
    await expect(editForm(page)).not.toBeVisible();
    if (status === 401)
      await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);
    else
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'l’autorisation de modifier' })
      ).toBeVisible();
  });
}

test('English dossier editing works on mobile and cancelling confirmation keeps the draft', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await page.getByRole('button', { name: 'Edit dossier', exact: true }).click();
  const form = editForm(page);
  await form.getByLabel('Company name', { exact: true }).fill('Corrected name');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form.getByLabel('Company name', { exact: true })).toHaveValue(
    'Corrected name'
  );
  await expect(
    form.getByRole('button', { name: 'Save changes', exact: true })
  ).toBeFocused();
  expect(
    await form.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1
    )
  ).toBe(true);
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

test('note drawer retains the draft after failure, blocks duplicate save and restores focus', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.reviewStatus = 503;
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path());
  const opener = page.getByRole('button', { name: 'Modifier la note' });
  await opener.click();
  const drawer = page.locator('dialog[open]');
  await drawer.getByRole('textbox').fill('Note de test conservée');
  await drawer.getByRole('button', { name: 'Enregistrer la note' }).click();
  await expect(
    drawer.getByRole('button', { name: 'Enregistrement...' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  release();
  await expect(drawer).toContainText('Conflict');
  await expect(drawer.getByRole('textbox')).toHaveValue(
    'Note de test conservée'
  );
  expect(calls.filter((c) => c.url.pathname.endsWith('/review'))).toHaveLength(
    1
  );
  options.reviewGate = null;
  options.reviewStatus = 200;
  await drawer.getByRole('button', { name: 'Enregistrer la note' }).click();
  await expect(drawer).toContainText('Note enregistree.');
  expect(
    calls.filter((c) => c.url.pathname.endsWith('/review'))[1]?.body?.[
      'reviewNote'
    ]
  ).toBe('Note de test conservée');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('media and history inspections stay inside the selected dossier', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/sponsorships/media?**', (route) =>
    route.fulfill({
      json: {
        assets: [
          {
            id: secondId,
            contributionId: id,
            kind: 'logo',
            version: 'v1',
            reviewStatus: 'pending_review',
            altText: 'Logo de test',
            width: 1,
            height: 1,
            sizeBytes: 68,
            mimeType: 'image/png',
            createdAt: date,
            updatedAt: date
          }
        ]
      }
    })
  );
  await page.route('**/api/admin/sponsorships/media/content/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
        'base64'
      )
    })
  );
  await page.goto(path('media'));
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await expect(page.locator('dialog[open]').getByRole('img')).toHaveAttribute(
    'src',
    /^blob:/
  );
  await page.keyboard.press('Escape');
  await tabs(page).getByRole('button', { name: 'Historique' }).click();
  await page.getByRole('button', { name: 'Historique du dossier' }).click();
  await expect(page.locator('dialog[open]')).toContainText(
    'Aucune entrée d’audit disponible'
  );
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/tab=audit/);
});

test('seven dossier tabs use direct URLs; invoice is complete before review; browsing makes no writes', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path('billing'));
  await expect(tabs(page).getByRole('button')).toHaveCount(7);
  await expect(
    progress(page).locator('[data-og7-id="billing"]')
  ).toHaveAttribute('data-state', 'complete');
  await expect(
    progress(page).locator('[data-og7-id="review"]')
  ).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('[data-og7="dossier-facts"]')).toContainText(
    'FAC-DEMO-401'
  );
  await tabs(page)
    .getByRole('button', { name: 'Identité', exact: true })
    .click();
  await expect(page).toHaveURL(/tab=identity/);
  await expect(page.locator('[data-og7="dossier-identity"]')).toContainText(
    'demo@example.invalid'
  );
  await tabs(page).getByRole('button', { name: 'Médias', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Photos en revue' })
  ).toBeVisible();
  await page.reload();
  await expect(
    tabs(page).getByRole('button', { name: 'Médias', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});

for (const width of [1280, 390]) {
  test(`dossier tabs preserve scroll and keyboard focus at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('media'));
    const navigation = tabs(page);
    await expect(
      navigation.getByRole('button', { name: 'Médias', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await navigation.evaluate((element) =>
      window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - 280,
        behavior: 'instant'
      })
    );
    let refundPosition = 0;
    for (const [index, tab] of [
      'overview',
      'identity',
      'media',
      'publication',
      'billing',
      'refund',
      'audit',
      'audit'
    ].entries()) {
      const button = navigation
        .getByRole('button')
        .nth(
          [
            'overview',
            'identity',
            'media',
            'publication',
            'billing',
            'refund',
            'audit'
          ].indexOf(tab)
        );
      await button.focus();
      const before = await page.evaluate(() => window.scrollY);
      if (index === 6) refundPosition = before;
      expect(before).toBeGreaterThan(100);
      if (index % 2) await button.press('Enter');
      else await button.click();
      await expect(page).toHaveURL(path(tab));
      await expect(button).toHaveAttribute('aria-current', 'page');
      // Let the router's scheduled scrolling and the new panel layout complete.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      const position = await page.evaluate(() => ({
        y: window.scrollY,
        maximum: document.documentElement.scrollHeight - window.innerHeight
      }));
      expect(position.y).toBeCloseTo(Math.min(before, position.maximum), 0);
      await expect(button).toBeFocused();
      await expect(button).toBeInViewport();
    }
    await page.goBack();
    await expect(page).toHaveURL(path('refund'));
    await expect
      .poll(() =>
        page.evaluate(
          (expected) =>
            Math.abs(
              window.scrollY -
                Math.min(
                  expected,
                  document.documentElement.scrollHeight - window.innerHeight
                )
            ),
          refundPosition
        )
      )
      .toBeLessThan(1);
    await page.goForward();
    await expect(page).toHaveURL(path('audit'));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    // Leaving the dossier must still use the normal router scroll behavior.
    await page
      .getByRole('link', { name: 'Assistant', exact: true })
      .last()
      .click();
    await expect(page).toHaveURL('/admin/fundraiser/assistant');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
}

for (const width of [1280, 390]) {
  test(`dossier progress links preserve scroll including repeated steps at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    const returnTo =
      '/admin/fundraiser/assistant?type=sponsorship_needs_review';
    await page.goto(
      path('identity') + '&returnTo=' + encodeURIComponent(returnTo)
    );
    await expect(
      progress(page).locator('[data-og7-id="identity"]')
    ).toBeVisible();
    await progress(page).evaluate((element) =>
      window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - 120,
        behavior: 'instant'
      })
    );
    const steps = [
      ['identity', 'identity'],
      ['payment', 'overview'],
      ['media', 'media'],
      ['review', 'overview'],
      ['billing', 'billing'],
      ['publication', 'publication']
    ] as const;
    for (const [index, [step, tab]] of steps.entries()) {
      const link = progress(page)
        .locator(`[data-og7-id="${step}"]`)
        .getByRole('link');
      // Keep the clicked milestone above the floating review actions before
      // measuring navigation scroll, so Playwright need not reveal it on click.
      await link.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      await link.focus();
      const before = await page.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(100);
      if (index % 2) await link.press('Enter');
      else await link.click();
      await expect(page).toHaveURL(
        path(tab) + '&returnTo=' + encodeURIComponent(returnTo)
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      const position = await page.evaluate(() => ({
        y: window.scrollY,
        maximum: document.documentElement.scrollHeight - innerHeight
      }));
      expect(position.y).toBeCloseTo(Math.min(before, position.maximum), 0);
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const width of [1280, 390]) {
  test(`next step reveals and focuses review across tabs and on repeated clicks at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    const returnTo =
      '/admin/fundraiser/attention?type=sponsorship_needs_review';
    const query = '&returnTo=' + encodeURIComponent(returnTo);
    await page.goto(path('identity') + query);
    const next = progress(page).locator('[data-og7="dossier-next"]');
    await expect(next).toHaveText('Voir les actions de validation');
    await expect(next).toHaveAttribute(
      'href',
      path() + query + '#dossier-review'
    );
    const target = page.locator('#dossier-review');
    for (const keyboard of [false, true]) {
      await next.scrollIntoViewIfNeeded();
      await next.focus();
      const before = await page.evaluate(() => scrollY);
      if (keyboard) await next.press('Enter');
      else await next.click();
      await expect(page).toHaveURL(path() + query + '#dossier-review');
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport();
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);
      await page.keyboard.press('Tab');
      await expect(
        actions(page).getByRole('button', { name: 'Refuser', exact: true })
      ).toBeFocused();
    }
    // Leaving a section via a normal tab keeps the viewport instead of replaying the anchor.
    const billing = tabs(page).getByRole('button', {
      name: 'Facturation',
      exact: true
    });
    await billing.scrollIntoViewIfNeeded();
    await billing.focus();
    const before = await page.evaluate(() => scrollY);
    await billing.click();
    await expect(page).toHaveURL(path('billing') + query);
    await expect(billing).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(
          (position) =>
            Math.abs(
              scrollY -
                Math.min(
                  position,
                  document.documentElement.scrollHeight - innerHeight
                )
            ),
          before
        )
      )
      .toBeLessThan(2);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

const nextDestinations = [
  ['payment_unconfirmed', 'overview', 'payment', 'Voir le paiement'],
  ['stripe_failed', 'overview', 'stripe', 'Voir les erreurs Stripe'],
  ['identity_missing', 'identity', 'identity', 'Voir l’identité'],
  ['media_review', 'media', 'media', 'Voir les médias'],
  ['credit_missing', 'billing', 'billing', 'Voir la facturation'],
  ['publication_pending', 'publication', 'publication', 'Voir la publication'],
  ['refund_check', 'refund', 'refund', 'Voir le remboursement']
] as const;

for (const [reason, tab, section, label] of nextDestinations) {
  test(`next step reaches its named section: ${reason}`, async ({ page }) => {
    const { calls, options } = await fixtures(page);
    options.next = { reason, tab, adminUrl: path(tab) };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path());
    const link = progress(page).getByRole('link', { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(path(tab) + '#dossier-' + section);
    await expect(page.locator('#dossier-' + section)).toBeFocused();
    await expect(page.locator('#dossier-' + section)).toBeInViewport();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('next step from the cockpit waits for dossier data before focusing its section', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  await page.goto('/admin/fundraiser');
  const next = progress(page).locator('[data-og7="dossier-next"]');
  await expect(next).toBeVisible();
  let releaseList!: () => void;
  let releaseProgress!: () => void;
  options.listGate = new Promise((resolve) => {
    releaseList = resolve;
  });
  options.progressGate = new Promise((resolve) => {
    releaseProgress = resolve;
  });
  await next.click();
  await expect(page).toHaveURL(path() + '#dossier-review');
  await expect(page.locator('#dossier-review')).toHaveCount(0);
  releaseList();
  await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
  releaseProgress();
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('a direct section link works for a reader after reload without enabling mutations', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'reader');
  await page.goto(path() + '#dossier-review');
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toContainText('À réviser');
  await expect(actions(page).getByRole('button')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('leaving a pending section cancels its delayed focus request', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.progressGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path() + '#dossier-review');
  await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
  const identity = tabs(page).getByRole('button', {
    name: 'Identité',
    exact: true
  });
  await identity.click();
  await expect(page).toHaveURL(path('identity'));
  release();
  await expect(progress(page)).toHaveAttribute('aria-busy', 'false');
  await expect(identity).toBeFocused();
  await expect(page.locator('#dossier-review')).not.toBeFocused();
});

test('browser history restores the viewport after visiting a next-step section', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(path('identity'));
  const next = progress(page).locator('[data-og7="dossier-next"]');
  await next.scrollIntoViewIfNeeded();
  await next.focus();
  const before = await page.evaluate(() => scrollY);
  await next.click();
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  const destination = await page.evaluate(() => scrollY);
  await page.goBack();
  await expect(page).toHaveURL(path('identity'));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.goForward();
  await expect(page).toHaveURL(path() + '#dossier-review');
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeCloseTo(destination, 0);
});

test('completed dossiers have a completion message without a next-step link in either view', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.next = { reason: 'complete', tab: 'overview', adminUrl: path() };
  for (const url of [path(), '/admin/fundraiser']) {
    await page.goto(url);
    await expect(progress(page)).toContainText('Dossier terminé');
    await expect(
      progress(page).locator('[data-og7="dossier-next"]')
    ).toHaveCount(0);
    await expect(progress(page).locator('ol').getByRole('link')).toHaveCount(6);
  }
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(progress(page)).toContainText('Dossier complete');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('publication cancellation, partial refund, missing credit and failed email are linked to their dossiers', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(path('publication'));
  await expect(page.locator('[data-og7="dossier-facts"]')).toContainText(
    'Annulé'
  );
  await tabs(page)
    .getByRole('button', { name: 'Remboursements', exact: true })
    .click();
  await expect(page.locator('[data-og7="dossier-facts"]')).toContainText(
    '200,00'
  );
  await expect(page.locator('[data-og7="dossier-facts"]')).toContainText(
    'Partiel'
  );
  await tabs(page)
    .getByRole('button', { name: 'Facturation', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Consulter le courriel en échec.' })
  ).toHaveAttribute('href', new RegExp(`messageId=${secondId}`));
  await expect(
    page.getByRole('link', { name: 'Ouvrir la facturation du dossier' })
  ).toHaveAttribute('href', new RegExp(`contributionId=${id}`));
});

test('return to filtered queue survives tab navigation and badge counts refresh after confirmed review', async ({
  page
}) => {
  const { options } = await fixtures(page);
  const destination =
    '/admin/fundraiser/attention?type=sponsorship_needs_review&priority=today&page=2';
  await page.goto(path() + '&returnTo=' + encodeURIComponent(destination));
  await expect(
    page.locator('[data-og7="nav-count"][data-og7-id="sponsors"]')
  ).toHaveText('3');
  await tabs(page)
    .getByRole('button', { name: 'Facturation', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="return-to-attention"]')
  ).toHaveAttribute('href', destination);
  options.reviewStatus = 200;
  options.queueCount = 0;
  await page.getByRole('button', { name: 'Accepter', exact: true }).click();
  await expect(
    page.locator('[data-og7="nav-count"][data-og7-id="sponsors"]')
  ).toHaveCount(0);
  await page.locator('[data-og7="return-to-attention"]').click();
  await expect(page).toHaveURL(destination);
});

test('version conflict offers reload; pending action is disabled and retry uses the new version', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path());
  const approve = page.getByRole('button', { name: 'Accepter', exact: true });
  await approve.click();
  await expect(approve).toBeDisabled();
  release();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le dossier a changé' })
  ).toBeVisible();
  options.version = 'v2';
  options.reviewGate = null;
  await page
    .getByRole('alert')
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le dossier a changé' })
  ).toHaveCount(0);
  options.reviewStatus = 200;
  await approve.click();
  await expect(approve).toBeEnabled();
  expect(
    calls
      .filter((c) => c.url.pathname.endsWith('/review'))
      .map((c) => c.body?.['expectedVersion'])
  ).toEqual(['v1', 'v2']);
});

test('cockpit remembers selected dossier for this session and clears it on logout', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path('billing', secondId));
  await expect(progress(page)).toContainText('Progression du dossier');
  await page
    .getByRole('navigation', { name: 'Navigation admin du fonds' })
    .getByRole('link', { name: 'Tableau de bord', exact: true })
    .click();
  await expect(progress(page)).toContainText('Atelier Rivage');
  expect(
    calls
      .filter((c) => c.url.pathname.endsWith('/progress'))
      .at(-1)
      ?.url.searchParams.get('sponsorshipId')
  ).toBe(secondId);
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-selected-sponsorship')
    )
  ).toBeNull();
});

test('unselected cockpit falls back to priority dossier; empty and unavailable remain explicit', async ({
  page
}) => {
  const { options } = await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(progress(page)).toContainText('Atelier Boréal');
  options.state = 'empty';
  await progress(page)
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(progress(page)).toContainText(
    'Aucune commandite ne demande une action'
  );
  options.status = 503;
  await progress(page)
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(progress(page).getByRole('alert')).toContainText('indisponible');
  await expect(progress(page).locator('ol')).toHaveCount(0);
});

test('denied progress clears facts and expired session returns to login', async ({
  page
}) => {
  const { options } = await fixtures(page);
  await page.goto(path('billing'));
  await expect(page.locator('[data-og7="dossier-facts"]')).toContainText(
    'FAC-DEMO-401'
  );
  options.status = 403;
  await progress(page)
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(progress(page).getByRole('alert')).toContainText('pas accès');
  await expect(page.locator('[data-og7="dossier-facts"]')).not.toContainText(
    'FAC-DEMO-401'
  );
  options.status = 401;
  await progress(page)
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('English compact dossier supports keyboard at mobile width without horizontal overflow', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser');
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(progress(page)).toContainText('Current sponsorship');
  const next = progress(page).getByRole('link', {
    name: 'View review actions'
  });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=overview/);
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  await expect(
    tabs(page).getByRole('button', { name: 'Summary', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/lot4-mobile.png',
    fullPage: true
  });
});

test('intervention journal records actions with actor and date, retains notes across tabs and supports extension', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'operator');
  await page.goto(path('refund'));
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await expect(journal).toContainText('Dossier incomplet — décision requise');
  await expect(journal.locator('[data-og7="intervention-kind"]')).toHaveValue(
    'internal'
  );
  await expect(journal).toContainText('Envoi en échec');
  await expect(
    journal.locator('[data-og7="interventions-access"]')
  ).toHaveCount(0);
  await journal.locator('[data-og7="intervention-kind"]').selectOption('phone');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Appel effectué. Le commanditaire demande un délai.');
  await tabs(page)
    .getByRole('button', { name: 'Historique', exact: true })
    .click();
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    'Appel effectué. Le commanditaire demande un délai.'
  );
  await journal.locator('[data-og7="intervention-save"]').focus();
  await page.keyboard.press('Enter');
  await expect(
    journal.locator('[data-og7="interventions-history"]')
  ).toContainText('Operator fixture');
  await expect(journal.locator('time')).toHaveAttribute('datetime', date);
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    ''
  );
  await expect(
    journal.locator('[data-og7="intervention-save"]')
  ).toBeDisabled();
  await journal
    .locator('[data-og7="intervention-kind"]')
    .selectOption('extension');
  await journal.locator('[data-og7="intervention-date"]').fill('2099-01-01');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Nouvelle échéance convenue.');
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(
    journal.locator('[data-og7="interventions-state"]')
  ).toContainText('délai supplémentaire');
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(2);
  await expect(journal.locator('[data-og7="intervention-kind"]')).toHaveValue(
    'internal'
  );
  const writes = calls.filter((c) => c.method === 'POST');
  expect(
    writes.filter((c) => c.url.pathname.endsWith('/interventions'))
  ).toHaveLength(2);
  expect(
    writes.filter((c) =>
      /refund|followup-access|request-information/.test(c.url.pathname)
    )
  ).toHaveLength(0);
});

test('intervention journal retries the same request after an uncertain save and blocks a double submit', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  options.journalSaveStatus = 503;
  await page.goto(path('audit'));
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Relance effectuée, réponse attendue.');
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(journal.getByRole('alert')).toContainText(
    'enregistrement n’est pas confirmé'
  );
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    'Relance effectuée, réponse attendue.'
  );
  options.journalSaveStatus = 200;
  let release!: () => void;
  options.journalGate = new Promise((resolve) => {
    release = resolve;
  });
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(
    journal.locator('[data-og7="intervention-save"]')
  ).toBeDisabled();
  release();
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(1);
  const saves = calls.filter(
    (c) => c.method === 'POST' && c.url.pathname.endsWith('/interventions')
  );
  expect(saves).toHaveLength(2);
  expect(saves[1].body?.requestId).toBe(saves[0].body?.requestId);
});

for (const status of [401, 403])
  test(`intervention journal clears private drafts on ${status}`, async ({
    page
  }) => {
    const { options } = await fixtures(page, 'operator');
    await page.goto(path('audit'));
    const journal = page.locator('[data-og7="dossier-interventions"]');
    await journal
      .locator('[data-og7="intervention-note"]')
      .fill('Private synthetic draft');
    options.journalSaveStatus = status;
    await journal.locator('[data-og7="intervention-save"]').click();
    if (status === 401) await expect(page).toHaveURL(/admin\/login/);
    else {
      await expect(journal.getByRole('alert')).toBeVisible();
      await expect(journal.locator('textarea')).toHaveCount(0);
    }
  });

test('intervention journal keeps older notes readable for a reader and renders note text safely', async ({
  page
}) => {
  const { options, calls } = await fixtures(page, 'reader');
  options.journal.set(
    id,
    Array.from({ length: 27 }, (_, i) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      actor: 'Operator fixture',
      recordedAt: date,
      kind: 'internal',
      note:
        i === 26 ? '<img src=x onerror=alert(1)> Historical note' : `Note ${i}`,
      nextReviewOn: null
    }))
  );
  await page.goto(path('refund'));
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await expect(journal.locator('[data-og7="intervention-form"]')).toHaveCount(
    0
  );
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(25);
  await journal.locator('[data-og7="interventions-more"]').click();
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(27);
  await expect(journal).toContainText(
    '<img src=x onerror=alert(1)> Historical note'
  );
  await expect(journal.locator('img')).toHaveCount(0);
  expect(
    calls.filter(
      (c) => c.method === 'POST' && c.url.pathname.endsWith('/interventions')
    )
  ).toHaveLength(0);
});

test('intervention journal rejects a late response for another dossier and recovers from a read failure', async ({
  page
}) => {
  const { options, calls } = await fixtures(page);
  let release!: () => void;
  options.journalReadGate = new Promise((resolve) => {
    release = resolve;
  });
  options.journal.set(id, [
    {
      id,
      actor: 'Fixture',
      recordedAt: date,
      kind: 'internal',
      note: 'OLD DOSSIER PRIVATE NOTE',
      nextReviewOn: null
    }
  ]);
  await page.goto('/admin/fundraiser/sponsors?tab=audit');
  await expect
    .poll(() => calls.some((c) => c.url.pathname.endsWith('/interventions')))
    .toBe(true);
  await page.getByRole('button', { name: /Atelier Rivage/ }).click();
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await expect(journal).toContainText('Aucune intervention consignée');
  release();
  await expect(journal).not.toContainText('OLD DOSSIER PRIVATE NOTE');
  options.journalReadStatus = 503;
  await page.reload();
  await expect(journal.getByRole('alert')).toContainText('actualisé');
  options.journalReadStatus = 200;
  await journal
    .getByRole('button', { name: 'Actualiser le journal', exact: true })
    .click();
  await expect(journal.getByRole('alert')).toHaveCount(0);
});

test('intervention journal is usable in English on mobile', async ({
  page
}) => {
  await fixtures(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('audit'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await expect(journal).toContainText('Incomplete record — decision required');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Sponsor contacted. Awaiting reply.');
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(
    journal.locator('[data-og7="interventions-history"]')
  ).toContainText('Sponsor contacted. Awaiting reply.');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await journal.screenshot({ path: 'test-results/interventions-mobile.png' });
});

test('a late progress response cannot overwrite a newly selected dossier or reset list filters', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  let release!: () => void;
  options.progressGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto('/admin/fundraiser/sponsors');
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.url.pathname.endsWith('/progress') &&
          c.url.searchParams.get('sponsorshipId') === id
      )
    )
    .toBe(true);
  await page.getByRole('button', { name: /Atelier Rivage/ }).click();
  await expect(
    progress(page).locator('[data-og7="dossier-next"]')
  ).toHaveAttribute('href', new RegExp(`sponsorshipId=${secondId}`));
  release();
  await tabs(page)
    .getByRole('button', { name: 'Facturation', exact: true })
    .click();
  await expect(
    progress(page).locator('[data-og7="dossier-next"]')
  ).toHaveAttribute('href', new RegExp(`sponsorshipId=${secondId}`));
  expect(
    calls.filter((c) => c.url.pathname === '/api/admin/sponsorships')
  ).toHaveLength(1);
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.screenshot({
    path: 'test-results/lot4-dossier-desktop.png',
    fullPage: true
  });
});

for (const width of [1280, 390]) {
  test(`publication bridge explains benefits and opens the exact delivery at ${width}px`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.progressOverrides = {
      publicationCompletion: { done: 0, total: 3 },
      publicationBlockers: ['media'],
      publications: [
        {
          ...dossier().publications[0]!,
          batchStatus: null,
          deliveryId: secondId,
          deliveryStatus: 'draft',
          deliveryMode: 'live',
          scheduledAt: date
        }
      ]
    };
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('publication'));
    const journey = page.locator('[data-og7="dossier-publication-journey"]');
    await expect(
      journey.getByRole('heading', { name: 'Ce que prévoit la contribution' })
    ).toBeVisible();
    await expect(journey).toContainText(
      'Reconnaissance collective sur Facebook'
    );
    await expect(journey).toContainText(
      'Reconnaissance collective sur LinkedIn'
    );
    await expect(journey).toContainText('Contreparties livrées : 0 / 3');
    await expect(
      journey.getByRole('link', { name: 'Approuver une photo de présentation' })
    ).toHaveAttribute('href', path('media'));
    const link = journey.getByRole('link', { name: 'Vérifier et programmer' });
    await expect(link).toHaveAttribute(
      'href',
      `/admin/fundraiser/publications/automation?sponsorshipId=${id}&deliveryId=${secondId}`
    );
    await expect(
      page.locator('[data-og7="dossier-publication-editor"]')
    ).not.toBeVisible();
    await expect(
      journey.locator('[data-og7="publication-channel"]')
    ).toHaveCount(2);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-og7="dossier-publication-journey"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    await journey.screenshot({
      path: `test-results/publication-bridge-${width}.png`
    });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`automation\\?sponsorshipId=${id}&deliveryId=${secondId}`)
    );
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
}

for (const [deliveryStatus, deliveryMode, label] of [
  ['approved', 'live', 'Programmée avec autorisation'],
  ['published', 'mock', 'Simulation terminée'],
  ['published', 'live', 'Publiée'],
  ['uncertain', 'live', 'Résultat à vérifier'],
  ['blocked', 'live', 'Envoi bloqué']
] as const) {
  test(`publication bridge displays ${deliveryStatus}/${deliveryMode} without inventing success`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.progressOverrides = {
      publicationCompletion: {
        done: deliveryStatus === 'published' && deliveryMode === 'live' ? 1 : 0,
        total: 3
      },
      publications: [
        {
          ...dossier().publications[0]!,
          batchStatus: null,
          deliveryId: secondId,
          deliveryStatus,
          deliveryMode,
          feedPaused: true,
          deliveryError:
            deliveryStatus === 'blocked' ? 'UNKNOWN_PROVIDER_CODE' : null,
          publicUrl: 'https://example.invalid/post'
        }
      ]
    };
    await page.goto(path('publication'));
    const journey = page.locator('[data-og7="dossier-publication-journey"]');
    await expect(journey).toContainText(label);
    await expect(journey).not.toContainText('UNKNOWN_PROVIDER_CODE');
    const published = deliveryStatus === 'published' && deliveryMode === 'live';
    await expect(journey).toContainText(
      `Contreparties livrées : ${published ? 1 : 0} / 3`
    );
    await expect(
      journey.getByRole('link', { name: 'Voir la publication', exact: true })
    ).toHaveCount(published ? 1 : 0);
    if (deliveryMode === 'mock')
      await expect(journey).toContainText('aucun envoi réel');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('publication bridge keeps CAD thresholds out of other currencies and supports English read-only access', async ({
  page
}) => {
  const { options, calls } = await fixtures(page, 'reader');
  options.progressOverrides = { currency: 'USD', publications: [] };
  await page.goto(path('publication'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const journey = page.locator('[data-og7="dossier-publication-journey"]');
  await expect(
    journey.getByRole('heading', { name: 'Publications for this sponsorship' })
  ).toBeVisible();
  await expect(journey).toContainText(
    'Benefits and destinations need confirmation for this currency.'
  );
  await expect(journey.locator('[data-og7="publication-channel"]')).toHaveCount(
    0
  );
  await expect(
    journey.getByRole('link', { name: 'Follow this dossier in the engine' })
  ).toHaveAttribute(
    'href',
    `/admin/fundraiser/publications/automation?sponsorshipId=${id}`
  );
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

for (const width of [1280, 390]) {
  test(`website publication is confirmed, waits for server facts, and can be hidden at ${width}px`, async ({
    page
  }) => {
    const { options, calls } = await fixtures(page, 'operator');
    options.progressOverrides = {
      amountMinor: 10000,
      publications: [],
      website: {
        visible: false,
        held: true,
        canPublish: true,
        version: 'site-v1',
        blockers: []
      },
      publicationCompletion: { done: 0, total: 1 }
    };
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('publication'));
    const site = page.locator('[data-og7="publication-website"]');
    const action = site.locator('[data-og7="website-visibility"]');
    await expect(site).toContainText('Fiche masquée — prête à publier');
    await expect(page.locator('[data-og7="publication-channel"]')).toHaveCount(
      0
    );
    await action.click();
    await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
    expect(
      calls.filter((c) => c.url.pathname.endsWith('/website-visibility'))
    ).toHaveLength(0);
    await page
      .getByRole('button', { name: 'Annuler', exact: true })
      .last()
      .click();
    expect(
      calls.filter((c) => c.url.pathname.endsWith('/website-visibility'))
    ).toHaveLength(0);
    let release!: () => void;
    options.mutationGate = new Promise((resolve) => {
      release = resolve;
    });
    await action.click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(action).toBeDisabled();
    await expect(site).toContainText('Fiche masquée');
    release();
    options.mutationGate = null;
    await expect(site).toContainText('Fiche visible');
    expect(
      calls.find((c) => c.url.pathname.endsWith('/website-visibility'))?.body
    ).toEqual({
      contributionId: id,
      expectedVersion: 'site-v1',
      visible: true,
      confirmed: true
    });
    await expect(
      page.locator('[data-og7="dossier-publication-journey"]')
    ).toContainText('Contreparties livrées : 1 / 1');
    await action.click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(site).toContainText('Fiche masquée');
    await site
      .getByRole('button', { name: 'Voir les paramètres de la fiche' })
      .click();
    await expect(
      page.locator('[data-og7="publication-advanced"] > summary')
    ).toBeFocused();
    await expect(
      page.locator('[data-og7="dossier-publication-editor"]')
    ).toBeVisible();
    const a11y = await new AxeBuilder({ page })
      .include('[data-og7="publication-website"]')
      .analyze();
    expect(a11y.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  });
}

test('website publication failure preserves confirmed visibility and readers cannot mutate it', async ({
  page
}) => {
  const { options, calls } = await fixtures(page, 'reader');
  options.progressOverrides = {
    website: {
      visible: true,
      held: false,
      canPublish: true,
      version: 'site-v1',
      blockers: []
    }
  };
  await page.goto(path('publication'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const site = page.locator('[data-og7="publication-website"]');
  await expect(site).toContainText('Profile visible');
  await expect(site.locator('[data-og7="website-visibility"]')).toHaveCount(0);
  await expect(
    site.getByRole('link', { name: 'View the directory' })
  ).toHaveAttribute('href', '/commanditaires');
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

test('website visibility errors retain the previous state and missing prerequisites disable publishing', async ({
  page
}) => {
  const { options } = await fixtures(page, 'operator');
  options.progressOverrides = {
    website: {
      visible: false,
      held: true,
      canPublish: true,
      version: 'site-v1',
      blockers: []
    }
  };
  options.mutationStatus = 503;
  await page.goto(path('publication'));
  const site = page.locator('[data-og7="publication-website"]');
  await site.locator('[data-og7="website-visibility"]').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(site).toContainText('La visibilité n’a pas pu être modifiée');
  await expect(site).toHaveAttribute('data-state', 'hidden');
  options.progressOverrides = {
    ...options.progressOverrides,
    website: {
      visible: false,
      held: true,
      canPublish: false,
      version: 'site-v1',
      blockers: ['consent', 'media']
    }
  };
  await page.reload();
  await expect(site.locator('[data-og7="website-visibility"]')).toBeDisabled();
  await expect(
    site.getByRole('link', { name: 'Approuver une photo de présentation' })
  ).toHaveAttribute('href', path('media'));
});
