import type { Locator, Page, TestInfo } from '@playwright/test';
import type {
  AdminExpenseRecord,
  AdminExpensesResponse,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { expectAdminPageFits } from './support/admin-design-review.js';

// Built Angular app and intercepted synthetic APIs only. Every unexpected
// write is refused; these tests never contact an API, Stripe, or email service.
type Role = 'reader' | 'operator' | 'owner';
const date = '2026-10-18T12:00:00Z';
const invoiceId = '10000000-0000-4000-8000-000000000861';
const contributionId = '10000000-0000-4000-8000-000000000862';
const expenseId = '10000000-0000-4000-8000-000000000863';
const invoice: AdminSponsorshipInvoiceRecord = {
  id: invoiceId,
  contribution_id: contributionId,
  invoice_number: 'INV-UX-SYNTHETIC',
  public_reference: 'OG7-UX-SYNTHETIC',
  stripe_session_id: 'cs_test_ux_finance',
  stripe_payment_intent_id: null,
  issued_at: date,
  paid_at: date,
  currency: 'CAD',
  subtotal: 500,
  tax: 0,
  total: 500,
  tax_label: '',
  issuer_name: 'OpenG7 simulation',
  issuer_email: null,
  issuer_address: null,
  issuer_tax_id: null,
  sponsor_name: 'Synthetic private sponsor UX',
  sponsor_contact_name: 'Synthetic contact UX',
  sponsor_contact_email: 'finance-ux@example.test',
  sponsor_website_url: null,
  line_items: [
    {
      description: 'Synthetic sponsorship',
      quantity: 1,
      unit_amount: 500,
      total: 500
    }
  ],
  notes: null,
  last_email_status: 'sent',
  last_email_recipient: 'finance-ux@example.test',
  last_email_sent_at: date,
  last_email_error: null,
  credit_notes: []
};
const invoiceListing: AdminSponsorshipInvoicesResponse = {
  data_source: 'database',
  invoices: [invoice],
  last_updated_at: date,
  summary: {
    total_count: 1,
    total_amount: 500,
    credit_note_count: 0,
    total_credited: 0,
    failed_email_count: 0,
    currency: 'CAD'
  }
};
const expense: AdminExpenseRecord = {
  id: expenseId,
  project_name: 'Synthetic private expense UX',
  public_description: 'Synthetic allocation description',
  expected_outcome: 'Synthetic expected outcome',
  progress_status: 'in_progress',
  proof_url: 'https://example.test/synthetic-ux-proof',
  proof_source: 'Synthetic source',
  proof_published_at: date,
  amount_allocated: 42.5,
  currency: 'CAD',
  status: 'draft',
  published_at: null,
  created_at: date,
  updated_at: date
};
const expenseListing: AdminExpensesResponse = {
  data_source: 'database',
  expenses: [expense],
  last_updated_at: date,
  summary: {
    total_count: 1,
    published_count: 0,
    draft_count: 1,
    private_count: 0,
    archived_count: 0,
    total_allocated: 42.5,
    published_allocated: 0,
    currency: 'CAD'
  }
};

async function fixtures(page: Page, role: Role, language = 'en') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((language) => {
    localStorage.setItem('openg7.language', language);
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.cookie'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, language);
  const options = {
    invoiceStatus: 200,
    expenseStatus: 200,
    emailStatus: 'sent'
  };
  const calls: {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
  }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({
      method: request.method(),
      path,
      body: request.postData() ? request.postDataJSON() : null
    });
    if (request.method() !== 'GET')
      return route.fulfill({ status: 403, json: { error: 'forbidden' } });
    if (path.endsWith('/auth/current'))
      return route.fulfill({
        json: {
          id: 'synthetic-finance-' + role,
          sessionId: 'synthetic-finance-session',
          displayName: 'Synthetic ' + role,
          role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path.endsWith('/sponsorship-invoices/pdf'))
      return route.fulfill({
        contentType: 'application/pdf',
        body: '%PDF-1.4\nSynthetic fixture'
      });
    if (path.endsWith('/sponsorship-invoices'))
      return route.fulfill({
        status: options.invoiceStatus,
        json:
          options.invoiceStatus === 200
            ? {
                ...invoiceListing,
                invoices: [
                  { ...invoice, last_email_status: options.emailStatus }
                ]
              }
            : { error: 'fixture_read_failure' }
      });
    if (path.endsWith('/admin/expenses'))
      return route.fulfill({
        status: options.expenseStatus,
        json:
          options.expenseStatus === 200
            ? expenseListing
            : { error: 'fixture_read_failure' }
      });
    return route.fulfill({ status: 503, json: {} });
  });
  return {
    options,
    calls,
    writes: () => calls.filter((call) => call.method !== 'GET')
  };
}

const invoiceDetail = (page: Page) =>
  page.locator('openg7-admin-invoice-detail');
const expenseCard = (page: Page) =>
  page.locator('[data-og7="allocation-card"]');
const drawer = (page: Page) => page.locator('dialog[open]');

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expectAdminPageFits(page);
  const path = testInfo.outputPath(name + '.png');
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function cancelAndRestore(page: Page, opener: Locator) {
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
}

for (const { width, language } of [
  { width: 1536, language: 'fr-CA' },
  { width: 390, language: 'en' }
]) {
  for (const role of ['reader', 'operator', 'owner'] as const) {
    test(`financial capabilities preserve ${role} consultation and restrict owner actions in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      const f = await fixtures(page, role, language);
      const english = language === 'en';
      await page.setViewportSize({ width, height: 864 });
      await page.goto('/admin/fundraiser/invoices');
      expect(
        await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      ).toEqual({ width, height: 864 });
      await expect(invoiceDetail(page)).toContainText(invoice.invoice_number);
      const backfill = page.locator('[data-og7="invoice-backfill"]');
      if (role === 'owner') await expect(backfill).toBeEnabled();
      else {
        await expect(backfill).toBeDisabled();
        await expect(
          page.locator('[data-og7="financial-read-only"]')
        ).toBeVisible();
      }
      const resend = invoiceDetail(page).getByRole('button', {
        name: english ? 'Resend' : 'Renvoyer',
        exact: true
      });
      if (role === 'reader') await expect(resend).toBeDisabled();
      else {
        await expect(resend).toBeEnabled();
        await resend.focus();
        await page.keyboard.press('Enter');
        await expect(drawer(page)).toContainText('finance-ux@example.test');
        expect(f.writes()).toEqual([]);
        await cancelAndRestore(page, resend);
      }
      const preview = invoiceDetail(page).getByRole('button', {
        name: english ? 'Preview invoice' : 'Prévisualiser la facture',
        exact: true
      });
      await preview.focus();
      await page.keyboard.press('Enter');
      await expect(
        drawer(page).getByRole('link', {
          name: english
            ? 'Open PDF in a new tab'
            : 'Ouvrir le PDF dans un nouvel onglet'
        })
      ).toHaveAttribute('href', /^blob:/);
      await cancelAndRestore(page, preview);
      const download = page.waitForEvent('download');
      await invoiceDetail(page)
        .getByRole('button', {
          name: english ? 'Download PDF' : 'Telecharger PDF',
          exact: true
        })
        .click();
      expect((await download).suggestedFilename()).toContain(
        'INV-UX-SYNTHETIC'
      );
      await capture(page, testInfo, `invoices-${role}-${width}`);

      await page.goto('/admin/fundraiser/expenses');
      const card = expenseCard(page);
      await expect(
        card.getByRole('heading', { name: expense.project_name })
      ).toBeVisible();
      if (role === 'owner') {
        await expect(
          page.locator('[data-og7="allocation-create"]')
        ).toBeVisible();
        await expect(
          card.getByRole('button', {
            name: english ? 'Publish' : 'Publier',
            exact: true
          })
        ).toBeEnabled();
        for (const control of await card
          .locator('input, textarea, select')
          .all())
          await expect(control).toBeEditable();
      } else {
        await expect(
          page.locator('[data-og7="allocation-create"]')
        ).toHaveCount(0);
        await expect(
          page.locator('[data-og7="financial-read-only"]')
        ).toBeVisible();
        await expect(
          card.getByRole('button', {
            name: /^(Save|Publish|Hide|Archive|Enregistrer|Publier|Masquer|Archiver)$/
          })
        ).toHaveCount(0);
        for (const control of await card
          .locator('input, textarea, select')
          .all())
          await expect(control).not.toBeEditable();
      }
      const proof = card.getByRole('button', {
        name: english ? 'Supporting document' : 'Pièce justificative',
        exact: true
      });
      await proof.focus();
      await page.keyboard.press('Enter');
      await expect(drawer(page)).toContainText(expense.project_name);
      await expect(
        drawer(page).getByRole('link', {
          name: english
            ? 'View supporting document'
            : 'Consulter le justificatif'
        })
      ).toHaveAttribute('href', expense.proof_url!);
      await cancelAndRestore(page, proof);
      await capture(page, testInfo, `expenses-${role}-${width}`);
      expect(f.writes()).toEqual([]);
    });
  }
}

test('uncertain SMTP status is explicit and leads to reconciliation without renqueue', async ({
  page
}) => {
  const f = await fixtures(page, 'owner');
  f.options.emailStatus = 'uncertain';
  await page.goto('/admin/fundraiser/invoices');
  await expect(
    invoiceDetail(page).getByText(
      'Email · Uncertain outcome — verification required',
      {
        exact: true
      }
    )
  ).toBeVisible();
  await expect(
    invoiceDetail(page).getByRole('button', { name: 'Resend', exact: true })
  ).toBeDisabled();
  const link = page.locator('[data-og7="document-email-reconcile"]');
  await expect(link).toHaveAttribute('href', '/admin/fundraiser/email-queue');
  await link.focus();
  await expect(link).toBeFocused();
  expect(f.writes()).toEqual([]);
});

for (const surface of ['invoices', 'expenses'] as const) {
  test(`${surface} marks a failed refresh stale, blocks mutations, then purges private data on 403`, async ({
    page
  }) => {
    const f = await fixtures(page, 'owner');
    await page.goto('/admin/fundraiser/' + surface);
    const snapshot =
      surface === 'invoices' ? invoiceDetail(page) : expenseCard(page);
    const privateText =
      surface === 'invoices' ? invoice.sponsor_name : expense.project_name;
    await expect(snapshot).toContainText(privateText);
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    if (surface === 'invoices') f.options.invoiceStatus = 500;
    else f.options.expenseStatus = 500;
    await refresh.click();
    await expect(page.locator('[data-og7="financial-stale"]')).toBeVisible();
    await expect(snapshot).toContainText(privateText);
    if (surface === 'invoices')
      await expect(
        page.locator('[data-og7="invoice-backfill"]')
      ).toBeDisabled();
    else {
      await expect(
        expenseCard(page).getByRole('button', { name: 'Publish', exact: true })
      ).toBeDisabled();
      await expect(
        page
          .locator('[data-og7="allocation-create"]')
          .getByRole('button', { name: 'Add', exact: true })
      ).toBeDisabled();
    }
    if (surface === 'invoices') f.options.invoiceStatus = 403;
    else f.options.expenseStatus = 403;
    await refresh.click();
    await expect(page.locator('[data-og7="financial-stale"]')).toHaveCount(0);
    await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
    await expect(page.locator('openg7-admin-document-delivery')).toHaveCount(0);
    await expect(page.locator('[data-og7="allocation-card"]')).toHaveCount(0);
    expect(f.writes()).toEqual([]);
  });
}

for (const width of [1536, 390]) {
  test(`owner financial confirmations cancel without writes, restore focus, and honor a server 403 at ${width}px`, async ({
    page
  }, testInfo) => {
    const f = await fixtures(page, 'owner');
    await page.setViewportSize({ width, height: 864 });
    await page.goto(
      '/admin/fundraiser/invoices?contributionId=' + contributionId
    );
    await expect(invoiceDetail(page)).toContainText(invoice.invoice_number);
    const backfill = page.locator('[data-og7="invoice-backfill"]');
    await backfill.focus();
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toContainText(contributionId);
    expect(f.writes()).toEqual([]);
    await cancelAndRestore(page, backfill);
    await backfill.click();
    await capture(page, testInfo, `invoice-confirmation-${width}`);
    await drawer(page).locator('[data-og7="confirm-action"]').click();
    await expect.poll(() => f.writes().length).toBe(1);
    expect(f.writes()[0].body).toMatchObject({
      contributionId,
      confirmation: contributionId
    });
    await expect(
      page.getByText(invoice.sponsor_name, { exact: true })
    ).toHaveCount(0);

    await page.goto('/admin/fundraiser/expenses');
    const publish = expenseCard(page).getByRole('button', {
      name: 'Publish',
      exact: true
    });
    await publish.focus();
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toContainText(expense.project_name);
    expect(f.writes()).toHaveLength(1);
    await cancelAndRestore(page, publish);
    await publish.click();
    await capture(page, testInfo, `expense-confirmation-${width}`);
    await drawer(page).locator('[data-og7="confirm-action"]').click();
    await expect.poll(() => f.writes().length).toBe(2);
    expect(f.writes()[1].body).toMatchObject({
      expenseId,
      status: 'published',
      confirmation: expenseId
    });
    await expect(expenseCard(page)).toHaveCount(0);
    await expect(drawer(page)).toHaveCount(0);
  });
}

test('financial read-only consultation keeps focus and fits with text enlarged to 200%', async ({
  page
}, testInfo) => {
  const f = await fixtures(page, 'reader');
  await page.setViewportSize({ width: 1536, height: 864 });
  for (const surface of ['invoices', 'expenses']) {
    await page.goto('/admin/fundraiser/' + surface);
    await expect(
      page.locator('[data-og7="financial-read-only"]')
    ).toBeVisible();
    // Text enlargement is measured here; this does not qualify native browser zoom.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const consultation =
      surface === 'invoices'
        ? invoiceDetail(page).getByRole('button', {
            name: 'Preview invoice',
            exact: true
          })
        : expenseCard(page).getByRole('button', {
            name: 'Supporting document',
            exact: true
          });
    await consultation.scrollIntoViewIfNeeded();
    await consultation.focus();
    await expect(consultation).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await capture(page, testInfo, `${surface}-text-200-percent`);
    await cancelAndRestore(page, consultation);
    await expectAdminPageFits(page);
  }
  expect(f.writes()).toEqual([]);
});

test('owner financial consultation fits a 768x432 CSS viewport equivalent to 200% reflow', async ({
  page
}, testInfo) => {
  const f = await fixtures(page, 'owner');
  // Half the baseline CSS viewport exercises reflow at equivalent available
  // space; it does not operate or qualify native browser zoom or OS scaling.
  await page.setViewportSize({ width: 768, height: 432 });
  for (const surface of ['invoices', 'expenses']) {
    await page.goto('/admin/fundraiser/' + surface);
    expect(
      await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    ).toEqual({ width: 768, height: 432 });
    const consultation =
      surface === 'invoices'
        ? invoiceDetail(page).getByRole('button', {
            name: 'Preview invoice',
            exact: true
          })
        : expenseCard(page).getByRole('button', {
            name: 'Supporting document',
            exact: true
          });
    await expect(consultation).toBeVisible();
    await expectAdminPageFits(page);
    await consultation.scrollIntoViewIfNeeded();
    await consultation.focus();
    await expect(consultation).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Enter');
    const close = drawer(page).getByRole('button', {
      name: 'Close panel',
      exact: true
    });
    await expect(close).toBeFocused();
    await expect(close).toBeInViewport({ ratio: 1 });
    await capture(page, testInfo, `${surface}-reflow-equivalent-200-percent`);
    await cancelAndRestore(page, consultation);
    await expect(consultation).toBeInViewport({ ratio: 1 });
  }
  expect(f.writes()).toEqual([]);
});
