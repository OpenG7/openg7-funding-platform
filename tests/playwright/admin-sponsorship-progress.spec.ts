import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipRecord
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
async function fixtures(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  const calls: {
    url: URL;
    method: string;
    body: Record<string, unknown> | null;
  }[] = [];
  const options = {
    status: 200,
    state: 'ok' as AdminSponsorshipProgressResponse['status'],
    reviewStatus: 409,
    queueCount: 3,
    version: 'v1',
    reviewGate: null as Promise<void> | null,
    progressGate: null as Promise<void> | null
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    calls.push({
      url,
      method: req.method(),
      body: req.postData()
        ? (req.postDataJSON() as Record<string, unknown>)
        : null
    });
    if (url.pathname === '/api/admin/sponsorships/progress') {
      const selected = url.searchParams.get('sponsorshipId') || id;
      if (selected === id && options.progressGate) await options.progressGate;
      return route.fulfill({
        status: options.status,
        json: {
          status: options.state,
          generatedAt: date,
          dossier: options.state === 'ok' ? dossier(selected) : null
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships') {
      const search = url.searchParams.get('search');
      const records = [id, secondId]
        .filter((value) => !search || !search.includes('-') || search === value)
        .map((value) => ({ ...record(value), version: options.version }));
      return route.fulfill({
        json: {
          data_source: 'database',
          items: records,
          sponsorships: records,
          pagination: {
            page: 1,
            pageSize: 6,
            totalItems: records.length,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false
          },
          last_updated_at: date
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/media')
      return route.fulfill({ json: { assets: [] } });
    if (url.pathname === '/api/admin/sponsorships/review') {
      if (options.reviewGate) await options.reviewGate;
      return route.fulfill({
        status: options.reviewStatus,
        json:
          options.reviewStatus === 200
            ? { updated: true }
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
  const next = progress(page).getByRole('link', { name: 'Open step' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=overview/);
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
