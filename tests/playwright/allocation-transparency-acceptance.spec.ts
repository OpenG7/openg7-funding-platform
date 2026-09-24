import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';
import type {
  AdminExpenseRecord,
  AdminExpensesResponse,
  AdminTransparencyResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { acceptanceSql } from './support/acceptance-database.js';
import { signInAsAdmin } from './support/admin-auth.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
test.use({
  contextOptions: {
    timezoneId: 'America/Toronto',
    baseURL: process.env.PLAYWRIGHT_BASE_URL
  }
});
const endpoint = '/api/admin/expenses';
const publicEndpoint = '/api/public/fund-transparency';
const hook = (page: Page, value: string) =>
  page.locator(`[data-og7="${value}"]`);
async function get<T>(
  request: APIRequestContext,
  url: string,
  admin = false
): Promise<T> {
  const response = await request.get(url, { headers: admin ? headers : {} });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('allocation: confirmed publication, public proof, concurrent edit, hide and archive with unchanged financial facts', async ({
  page,
  context,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable local stack only.'
  );
  test.setTimeout(120000);
  const name = 'Allocation locale ' + randomUUID();
  const proof = 'https://example.test/compte-rendu-public';
  const summary = () =>
    get<FundTransparencyPublicResponse>(request, publicEndpoint);
  const before = await summary();
  const ledger = () =>
    acceptanceSql('SELECT * FROM fund_transactions ORDER BY id');
  const initialLedger = await ledger();
  const baseline = await get<AdminExpensesResponse>(request, endpoint, true);
  const input = {
    projectName: name,
    publicDescription: 'Documentation publique du projet',
    expectedOutcome: 'Un guide accessible',
    progressStatus: 'planned',
    amountAllocated: 42.5,
    currency: 'CAD',
    status: 'draft'
  };
  expect((await request.post(endpoint, { data: input })).status()).toBe(401);
  for (const body of ['null', '[]', '42']) {
    for (const target of [endpoint, endpoint + '/update']) {
      expect(
        (
          await request.post(target, {
            headers: { ...headers, 'Content-Type': 'application/json' },
            data: body
          })
        ).status()
      ).toBe(400);
    }
  }
  for (const change of [
    { amountAllocated: 0 },
    { amountAllocated: 42.501 },
    { proofUrl: 'http://example.test/proof' },
    { proofUrl: 'https://synthetic:private@example.test/proof' },
    { status: 'published' },
    { status: 'active', confirmation: 'incorrect' }
  ]) {
    const denied = await request.post(endpoint, {
      headers,
      data: { ...input, ...change }
    });
    expect(denied.status()).toBe(400);
    expect((await denied.json()).code).toBe(
      'amountAllocated' in change
        ? 'invalid_amount'
        : 'proofUrl' in change
          ? 'invalid_proof'
          : 'confirmation_required'
    );
  }
  expect(
    (await get<AdminExpensesResponse>(request, endpoint, true)).summary
  ).toEqual(baseline.summary);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signInAsAdmin(page);
  expect(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  ).toBe('America/Toronto');
  await page.goto('/admin/fundraiser/expenses');
  const create = hook(page, 'allocation-create');
  await create.getByLabel('Projet ou fournisseur').fill(name);
  await create.getByLabel('Montant CAD').fill('42.50');
  await create.getByLabel('Description publique').fill(input.publicDescription);
  await create.getByLabel('Resultat attendu').fill(input.expectedOutcome);
  const created = page.waitForResponse(
    (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST'
  );
  await create.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.ok()).toBe(true);
  const original: AdminExpenseRecord = (await createdResponse.json()).expense;
  const id = original.id;
  const card = (target: Page) =>
    hook(target, 'allocation-card').filter({
      has: target.getByRole('heading', { name, exact: true })
    });
  const current = async () =>
    (
      await get<AdminExpensesResponse>(
        request,
        endpoint + '?expenseId=' + id,
        true
      )
    ).expenses[0]!;
  const audits = () =>
    acceptanceSql<{ action: string; actor: string }>(
      "SELECT action,actor FROM admin_audit_log WHERE entity_type='expense' AND entity_id=$1 ORDER BY created_at,id",
      [id]
    );
  const allocations = async () =>
    (await summary()).latest_public_allocations.filter(
      (a) => a.project_name === name
    );
  await expect(card(page)).toBeVisible();
  expect(await allocations()).toEqual([]);
  for (const confirmation of [undefined, 'wrong-allocation']) {
    const denied = await request.post(endpoint + '/update', {
      headers,
      data: {
        expenseId: id,
        expectedVersion: original.updated_at,
        status: 'published',
        confirmation
      }
    });
    expect(denied.status()).toBe(400);
    expect((await denied.json()).code).toBe('confirmation_required');
  }
  expect(await current()).toEqual(original);
  await card(page)
    .getByRole('button', { name: 'Publier', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(name);
  await expect(page.getByRole('dialog')).toContainText(input.publicDescription);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Annuler', exact: true })
    .last()
    .click();
  expect(await current()).toEqual(original);

  const confirmAction = async (target: Page, label: string) => {
    await card(target)
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(target.getByRole('dialog')).toBeVisible();
    const pending = target.waitForResponse((r) =>
      r.url().endsWith(endpoint + '/update')
    );
    await hook(target, 'confirm-action').focus();
    await target.keyboard.press('Enter');
    return pending;
  };
  expect((await confirmAction(page, 'Publier')).ok()).toBe(true);
  await expect(
    card(page).getByText('Publiee', { exact: true }).first()
  ).toBeVisible();
  const published = await current();
  expect(published.published_at).toBeTruthy();
  expect((await allocations())[0]!.amount_allocated).toBe(42.5);
  expect((await audits()).length).toBe(2);
  await card(page).getByLabel('Montant CAD').fill('65.25');
  await card(page).getByLabel('Avancement').selectOption('delivered');
  await card(page).getByLabel('Preuve publique').fill(proof);
  await card(page).getByLabel('Source de la preuve').fill('Compte rendu local');
  await card(page).getByLabel('Date de la preuve').fill('2026-09-24T12:00');
  expect((await confirmAction(page, 'Enregistrer')).ok()).toBe(true);
  await expect.poll(async () => (await current()).amount_allocated).toBe(65.25);
  const delivered = await current();
  expect(delivered.progress_status).toBe('delivered');
  expect(new Date(delivered.proof_published_at!).toISOString()).toBe(
    '2026-09-24T16:00:00.000Z'
  );
  expect(delivered.published_at).toBe(published.published_at);
  expect((await allocations())[0]!.proof_url).toBe(proof);
  const unconfirmedEdit = await request.post(endpoint + '/update', {
    headers,
    data: {
      expenseId: id,
      expectedVersion: delivered.updated_at,
      publicDescription: 'Modification non confirmée'
    }
  });
  expect(unconfirmedEdit.status()).toBe(400);
  expect(await current()).toEqual(delivered);

  const visitor = await context.newPage();
  visitor.on('pageerror', (error) => errors.push(error.message));
  for (const [prefix, width] of [
    ['', 1280],
    ['/en', 390]
  ] as const) {
    await visitor.setViewportSize({ width, height: 844 });
    await visitor.goto(prefix + '/fonds-des-batisseurs/transparence');
    const publishedPanel = hook(visitor, 'published-allocations');
    await expect(
      publishedPanel.getByRole('heading', { name, exact: true })
    ).toBeVisible();
    await expect(publishedPanel).toContainText(prefix ? '65.25' : '65,25');
    const link = publishedPanel.getByRole('link', {
      name: /Compte rendu local/
    });
    await expect(link).toHaveAttribute('href', proof);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(publishedPanel).toContainText(prefix ? 'Delivered' : 'Livr');
    const downloaded = visitor.waitForEvent('download');
    await hook(visitor, 'transparency-json').focus();
    await visitor.keyboard.press('Enter');
    const chunks: Buffer[] = [];
    for await (const chunk of await (await downloaded).createReadStream())
      chunks.push(Buffer.from(chunk));
    const exported = Buffer.concat(chunks).toString('utf8');
    expect(exported).not.toContain(name);
    expect(exported).not.toContain(proof);
    expect(exported).not.toContain('synthetic:private');
    expect(JSON.parse(exported).monthly_summary).toEqual(
      before.monthly_summary
    );
    expect(
      await visitor.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
    await info.attach('allocation-public-' + width + '.png', {
      body: await visitor.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
  }

  // Both administrators load the same version; the losing tab keeps its input.
  await visitor.goto('/fonds-des-batisseurs/transparence');
  await page.goto('/admin/fundraiser/expenses?expenseId=' + id);
  await expect(card(page)).toBeVisible();
  const second = await context.newPage();
  await signInAsAdmin(second);
  await second.goto('/admin/fundraiser/expenses?expenseId=' + id);
  await card(second)
    .getByLabel('Description publique')
    .fill('Version revue par le second administrateur');
  expect((await confirmAction(second, 'Enregistrer')).ok()).toBe(true);
  await card(page).getByLabel('Montant CAD').fill('99.99');
  expect((await confirmAction(page, 'Enregistrer')).status()).toBe(409);
  await expect(hook(page, 'allocation-conflict')).toBeVisible();
  await expect(card(page).getByLabel('Montant CAD')).toHaveValue('99.99');
  expect((await current()).amount_allocated).toBe(65.25);
  expect((await audits()).length).toBe(4);
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(hook(page, 'allocation-conflict')).toHaveCount(0);
  await expect(card(page).getByLabel('Montant CAD')).toHaveValue('65.25');
  expect((await confirmAction(page, 'Masquer')).ok()).toBe(true);
  await expect.poll(async () => (await current()).status).toBe('private');
  expect(await allocations()).toEqual([]);
  await visitor.reload();
  await expect(hook(visitor, 'transparency-json')).toBeEnabled();
  await expect(
    hook(visitor, 'published-allocations').getByRole('heading', {
      name,
      exact: true
    })
  ).toHaveCount(0);
  expect((await confirmAction(page, 'Publier')).ok()).toBe(true);
  await expect.poll(async () => (await current()).status).toBe('published');
  expect((await confirmAction(page, 'Archiver')).ok()).toBe(true);
  await expect.poll(async () => (await current()).status).toBe('archived');
  expect(await allocations()).toEqual([]);
  const auditEntries = await audits();
  expect(auditEntries.map((a) => a.action)).toEqual([
    'achievement.created',
    'achievement.published',
    'achievement.published',
    'achievement.published',
    'achievement.hidden',
    'achievement.published',
    'achievement.archived'
  ]);
  expect(auditEntries.every((a) => Boolean(a.actor))).toBe(true);
  const report = await get<AdminTransparencyResponse>(
    request,
    '/api/admin/transparency',
    true
  );
  expect(report.expenses_summary.archived_count).toBe(
    baseline.summary.archived_count + 1
  );
  expect(report.expenses_summary.published_allocated).toBe(
    baseline.summary.published_allocated
  );
  for (const key of [
    'total_received',
    'total_fees',
    'total_net',
    'total_refunded',
    'total_payouts',
    'current_available_estimate',
    'contributions_count'
  ] as const) {
    expect(report.public_summary[key]).toBe(before[key]);
  }
  expect(await ledger()).toEqual(initialLedger);
  expect(errors).toEqual([]);
});
