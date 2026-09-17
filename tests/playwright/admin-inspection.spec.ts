import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

const id = '10000000-0000-4000-8000-000000000701';
const date = '2026-09-17T12:00:00Z';
const drawer = (page: Page) => page.locator('dialog[open]');

async function fixtures(page: Page, language = 'fr-CA') {
  await page.addInitScript((language) => {
    localStorage.setItem('openg7.language', language);
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.inspection-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
    const original = URL.revokeObjectURL;
    Object.assign(window, { revokedResources: [] as string[] });
    URL.revokeObjectURL = (value) => {
      (
        window as unknown as { revokedResources: string[] }
      ).revokedResources.push(value);
      original(value);
    };
  }, language);
  const requests: {
    path: string;
    query: string;
    method: string;
    authorization: string | undefined;
  }[] = [];
  const options = {
    pdfStatus: 200,
    pdfType: 'application/pdf',
    pdfGate: null as Promise<void> | null,
    proofUrl: 'https://example.invalid/proof'
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    requests.push({
      path: url.pathname,
      query: url.search,
      method: req.method(),
      authorization: req.headers()['authorization']
    });
    if (url.pathname.endsWith('/sponsorship-invoices/pdf')) {
      if (options.pdfGate) await options.pdfGate;
      return route.fulfill({
        status: options.pdfStatus,
        contentType: options.pdfType,
        body: '%PDF-1.4 fixture'
      });
    }
    if (url.pathname.endsWith('/sponsorship-invoices'))
      return route.fulfill({
        json: {
          invoices: [
            {
              id,
              contribution_id: id,
              invoice_number: 'FAC-701',
              currency: 'CAD',
              subtotal: 100.5,
              tax: 0,
              total: 100.5,
              issued_at: date,
              paid_at: date,
              issuer_name: 'OpenG7',
              sponsor_name: 'Atelier Nord',
              public_reference: 'OG7-701',
              line_items: [
                {
                  description: 'Commandite',
                  quantity: 1,
                  unit_amount: 100.5,
                  total: 100.5
                }
              ],
              credit_notes: []
            }
          ],
          summary: {
            total_count: 1,
            total_amount: 100.5,
            currency: 'CAD',
            credit_note_count: 0,
            total_credited: 0,
            failed_email_count: 0
          }
        }
      });
    if (url.pathname.endsWith('/search'))
      return route.fulfill({
        json: {
          available: true,
          missingSources: [],
          total: 1,
          page: 1,
          pageSize: 10,
          groups: [
            {
              contributionId: id,
              title: 'Atelier Nord',
              reference: 'OG7-701',
              amountMinor: 10050,
              currency: 'CAD',
              sponsorship: true,
              invoice: { id, number: 'FAC-701' },
              publications: []
            }
          ]
        }
      });
    if (url.pathname.endsWith('/email-queue/retry'))
      return route.fulfill({ json: { sent: 0, attempted: 1 } });
    if (url.pathname.endsWith('/email-queue'))
      return route.fulfill({
        json: {
          summary: {
            queued_count: 0,
            sending_count: 0,
            sent_count: 0,
            failed_count: 1,
            retryable_count: 1,
            last_failed_at: date
          },
          last_updated_at: date,
          messages: [
            {
              id,
              recipient_email: 'fixture@example.invalid',
              subject: 'Facture FAC-701',
              status: 'failed',
              template_key: 'invoice',
              attempts: 1,
              max_attempts: 3,
              next_attempt_at: date,
              last_error: 'Delivery unavailable',
              updated_at: date
            }
          ]
        }
      });
    if (url.pathname.endsWith('/audit-log'))
      return route.fulfill({
        json: {
          entries: [
            {
              id,
              actor: 'Fixture',
              action: 'note.saved',
              entity_type: 'sponsorship',
              entity_id: id,
              summary: 'Note synthétique',
              metadata: {},
              created_at: date
            }
          ]
        }
      });
    if (url.pathname.endsWith('/expenses'))
      return route.fulfill({
        json: {
          summary: {
            total_count: 1,
            draft_count: 1,
            published_count: 0,
            total_allocated: 100.5,
            currency: 'CAD'
          },
          expenses: [
            {
              id: '701',
              project_name: 'Projet Nord',
              public_description: 'Preuve synthétique',
              expected_outcome: '',
              progress_status: 'planned',
              proof_url: options.proofUrl,
              proof_source: 'Fixture',
              proof_published_at: date,
              amount_allocated: 100.5,
              currency: 'CAD',
              status: 'draft',
              published_at: null,
              created_at: date,
              updated_at: date
            }
          ]
        }
      });
    if (url.pathname.endsWith('/stripe-event'))
      return route.fulfill({
        json: {
          available: true,
          event: {
            id: 'evt_701',
            type: 'charge.updated',
            status: 'failed',
            receivedAt: date,
            processedAt: null,
            error: 'processing_failed'
          }
        }
      });
    if (url.pathname.endsWith('/attention'))
      return route.fulfill({
        json: {
          available: true,
          coverage: 'complete',
          missingSources: [],
          generatedAt: date,
          timezone: 'America/Toronto',
          total: 1,
          filteredTotal: 1,
          todayTotal: 1,
          counts: { urgent: 1, today: 0, this_week: 0, informational: 0 },
          typeCounts: {},
          page: 1,
          pageSize: 25,
          items: [
            {
              id: 'stripe:evt_701',
              type: 'stripe_event_failed',
              severity: 'urgent',
              title: 'Failure',
              explanation: 'Failure',
              adminUrl: '/admin/fundraiser/attention?itemId=stripe%3Aevt_701',
              detectedAt: date,
              facts: { reference: 'evt_701' },
              suggestedActions: []
            }
          ]
        }
      });
    return route.fulfill({ status: 503, json: {} });
  });
  return { requests, options };
}

test('invoice drawer keeps page context, traps focus, retries and releases protected PDF', async ({
  page
}) => {
  const { options, requests } = await fixtures(page);
  await page.setViewportSize({ width: 1672, height: 941 });
  options.pdfStatus = 503;
  await page.goto('/admin/fundraiser/invoices?contributionId=' + id);
  const opener = page.getByRole('button', {
    name: 'Prévisualiser la facture',
    exact: true
  });
  await opener.click();
  await expect(drawer(page).getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('contributionId=' + id));
  options.pdfStatus = 200;
  await drawer(page).getByRole('button', { name: 'Réessayer' }).click();
  const pdf = drawer(page).getByRole('link', { name: /PDF/ });
  await expect(pdf).toHaveAttribute('href', /^blob:/);
  await expect(drawer(page)).toContainText('100,50');
  await page.screenshot({ path: 'test-results/lot7-invoice-desktop.png' });
  const source = await pdf.getAttribute('href');
  expect(
    requests
      .filter((r) => r.path.endsWith('/pdf'))
      .every((r) => r.authorization?.startsWith('Bearer openg7-admin-session.'))
  ).toBe(true);
  const close = drawer(page).getByRole('button', { name: 'Fermer le panneau' });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(
    drawer(page).getByRole('button', { name: 'Revenir à la page' })
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { revokedResources: string[] }).revokedResources
    )
  ).toContain(source);
  expect(requests.some((r) => r.method === 'POST')).toBe(false);
});

test('invoice opened from search restores toolbar focus and follows its exact full page', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await page.locator('[data-og7="admin-search-open"]').click();
  await drawer(page).getByRole('searchbox').fill('FAC-701');
  await drawer(page)
    .getByRole('button', { name: /FAC-701/ })
    .click();
  await expect(drawer(page).getByRole('link', { name: /PDF/ })).toBeVisible();
  await drawer(page)
    .getByRole('link', { name: 'Ouvrir la page complète' })
    .click();
  await expect(page).toHaveURL(new RegExp('/invoices\\?contributionId=' + id));
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

for (const status of [401, 403])
  test(`invoice access ${status} clears protected content`, async ({
    page
  }) => {
    const { options } = await fixtures(page);
    options.pdfStatus = status;
    await page.goto('/admin/fundraiser/invoices');
    await page
      .getByRole('button', { name: 'Prévisualiser la facture', exact: true })
      .click();
    if (status === 401) await expect(page).toHaveURL(/\/admin\/login/);
    else {
      await expect(drawer(page).getByRole('alert')).toBeVisible();
      await expect(drawer(page)).not.toContainText('Atelier Nord');
    }
    await expect(page.locator('a[href^="blob:"]')).toHaveCount(0);
  });

test('closing an in-flight preview ignores its late response and unexpected MIME is retryable', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.pdfGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/admin/fundraiser/invoices');
  await page
    .getByRole('button', { name: 'Prévisualiser la facture', exact: true })
    .click();
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  release();
  options.pdfGate = null;
  options.pdfType = 'text/html';
  await page
    .getByRole('button', { name: 'Prévisualiser la facture', exact: true })
    .click();
  await expect(drawer(page).getByRole('alert')).toBeVisible();
  await expect(drawer(page).locator('a[href^="blob:"]')).toHaveCount(0);
  await expect(
    drawer(page).getByRole('button', { name: 'Réessayer' })
  ).toBeEnabled();
});

test('email inspection preserves filters and retry requires a cancellable explicit decision', async ({
  page
}) => {
  const { requests } = await fixtures(page);
  await page.goto('/admin/fundraiser/email-queue');
  await page.getByRole('searchbox').fill('fixture');
  const opener = page.getByRole('button', { name: 'fixture@example.invalid' });
  await opener.click();
  await expect(drawer(page)).toContainText('Delivery unavailable');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(page.getByRole('searchbox')).toHaveValue('fixture');
  await page.getByRole('button', { name: 'Relancer', exact: true }).click();
  await expect(drawer(page)).toContainText('fixture@example.invalid');
  await page.keyboard.press('Escape');
  expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  await page.getByRole('button', { name: 'Relancer', exact: true }).click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect
    .poll(() => requests.filter((r) => r.method === 'POST').length)
    .toBe(1);
  await expect(
    page.getByText('Relance tentee, le message reste en echec.')
  ).toBeVisible();
});

test('audit and proof drawers open exact records on the same page', async ({
  page
}) => {
  const { requests, options } = await fixtures(page);
  await page.goto('/admin/fundraiser/audit');
  await page.getByRole('button', { name: 'note.saved' }).click();
  await expect(drawer(page)).toContainText('Note synthétique');
  await drawer(page)
    .getByRole('link', { name: 'Ouvrir la page complète' })
    .click();
  await expect
    .poll(() => requests.some((r) => r.query === '?entryId=' + id))
    .toBe(true);
  options.proofUrl = 'javascript:alert(1)';
  await page.goto('/admin/fundraiser/expenses');
  await page
    .getByRole('button', { name: 'Pièce justificative', exact: true })
    .click();
  await expect(drawer(page)).toContainText('Projet Nord');
  await expect(drawer(page).locator('a[href^="javascript:"]')).toHaveCount(0);
  await drawer(page)
    .getByRole('link', { name: 'Ouvrir la page complète' })
    .click();
  await expect
    .poll(() => requests.some((r) => r.query === '?expenseId=701'))
    .toBe(true);
});

test('Stripe drawer is translated and fills a 320px mobile viewport', async ({
  page
}) => {
  await fixtures(page, 'en');
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/admin/fundraiser/attention');
  await page.getByRole('button', { name: 'Stripe event', exact: true }).click();
  await expect(drawer(page)).toContainText('evt_701');
  await expect(drawer(page)).toContainText('charge.updated');
  const size = await drawer(page).boundingBox();
  expect(size?.width).toBe(320);
  expect(
    await drawer(page).evaluate((el) => el.scrollWidth <= el.clientWidth)
  ).toBe(true);
  await page.screenshot({ path: 'test-results/lot7-drawer-mobile.png' });
});

test('publishing an expense requires confirmation and cancellation sends no mutation', async ({
  page
}) => {
  const { requests } = await fixtures(page);
  await page.goto('/admin/fundraiser/expenses');
  await page.getByRole('button', { name: 'Publier', exact: true }).click();
  await expect(drawer(page)).toContainText('Projet Nord');
  await page.keyboard.press('Escape');
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(
    0
  );
  await page.getByRole('button', { name: 'Publier', exact: true }).click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect
    .poll(
      () =>
        requests.filter((request) => request.path.endsWith('/expenses/update'))
          .length
    )
    .toBe(1);
});

test('private CSV export names its scope and requires explicit confirmation', async ({
  page
}) => {
  await fixtures(page);
  let exports = 0;
  await page.route('**/api/admin/contributions', (route) =>
    route.fulfill({
      json: {
        contributions: [
          {
            id,
            public_reference: 'OG7-701',
            contribution_type: 'personal_support',
            amount: 100.5,
            currency: 'CAD',
            payment_status: 'paid',
            paid_at: date,
            created_at: date,
            public_display_consent: false,
            display_amount_consent: false
          }
        ],
        summary: {
          total_count: 1,
          paid_count: 1,
          sponsorship_count: 0,
          total_received: 100.5,
          currency: 'CAD'
        }
      }
    })
  );
  await page.route('**/api/admin/contributions.csv', (route) => {
    exports++;
    return route.fulfill({
      contentType: 'text/csv',
      body: 'reference\nFIXTURE\n'
    });
  });
  await page.goto('/admin/fundraiser/contributions');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(drawer(page)).toContainText('données privées des contributions');
  await page.keyboard.press('Escape');
  expect(exports).toBe(0);
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = page.waitForEvent('download');
  await page.locator('[data-og7="confirm-action"]').click();
  await download;
  expect(exports).toBe(1);
});

test('all admin routes share a single layout, translated headings and mobile width', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    'contributions',
    'sponsors',
    'publications',
    'invoices',
    'expenses',
    'transparency',
    'email-queue',
    'audit',
    'setup',
    'assistant'
  ]) {
    await page.goto('/admin/fundraiser/' + route);
    await expect(page.locator('[data-og7="admin-layout"]')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator('h1')).not.toContainText('admin.');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      route
    ).toBe(true);
    const french = await page.locator('h1').innerText();
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    if (
      !['audit', 'publications', 'contributions', 'assistant'].includes(route)
    )
      await expect(page.locator('h1')).not.toHaveText(french);
    await page
      .getByRole('button', { name: 'Passer l’administration en français' })
      .click();
  }
});
