import { randomUUID } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AdminAutomaticRunState } from '@openg7/funding-core';

import { startIdentityStack } from './stack.mjs';
import { openAdminIdentity } from './support/admin-browser.js';

const route = '/admin/fundraiser/attention';
const hook = (page: Page, name: string) =>
  page.locator(`[data-og7="automatic-portfolio-${name}"]`);

async function acknowledgeReading(
  page: Page,
  step: 'scope' | 'dossier' | 'result' | 'summary'
) {
  await expect(hook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_approval'
  );
  await expect(hook(page, 'reading')).toHaveAttribute('data-og7-id', step);
  const approval = hook(page, 'approve');
  await expect(approval).toBeEnabled();
  const readingId = await approval.getAttribute('data-og7-id');
  expect(readingId).toMatch(/^\d+$/);
  await approval.click();
  await expect(
    page.locator(
      `[data-og7="automatic-portfolio-approve"][data-og7-id="${readingId}"]`
    )
  ).toHaveCount(0);
}

async function acknowledgePassage(page: Page, dossierCount: number) {
  // Scope, one preview and one confirmed result per dossier, then the summary.
  // These UI gestures acknowledge reading; they approve no business decision.
  await acknowledgeReading(page, 'scope');
  for (let index = 0; index < dossierCount; ++index) {
    await acknowledgeReading(page, 'dossier');
    await acknowledgeReading(page, 'result');
  }
  await acknowledgeReading(page, 'summary');
}

/** Real OIDC, API, PostgreSQL and built Web; no application response is intercepted. */
test('automatic responsibilities traverse confirmed payments and retain a dated honest report through reload and a new payment', async ({
  playwright
}, info) => {
  let stack: Awaited<ReturnType<typeof startIdentityStack>> | undefined;
  let context: BrowserContext | undefined;
  try {
    stack = await startIdentityStack();
    const { pool, origin } = stack;
    const cad = randomUUID();
    const usd = randomUUID();
    const sponsor = randomUUID();

    // This recipe starts from recorded confirmed payments. The separate Stripe
    // acceptance recipes qualify webhook confirmation; no payment is fabricated
    // through a success URL, browser state or the automatic-run UI here.
    await pool.query(
      `INSERT INTO fund_contributions
       (id,contribution_type,amount_cents,currency,status,paid_at,public_reference,non_charity_acknowledged)
       VALUES($1,'personal_support',2500,'cad','paid',NOW(),'DEMO-AUTOMATIC-CAD',TRUE),
             ($2,'personal_support',1700,'usd','paid',NOW(),'DEMO-AUTOMATIC-USD',TRUE)`,
      [cad, usd]
    );
    const sourceBefore = (
      await pool.query(
        `SELECT id::text,contribution_type,amount_cents,currency,status,paid_at::text
       FROM fund_contributions ORDER BY id`
      )
    ).rows;
    const opened = await openAdminIdentity(playwright.chromium, origin, route);
    context = opened.context;
    const page = opened.page;
    const commands: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.startsWith('/api/admin/automatic-runs') &&
        request.method() === 'POST'
      )
        commands.push(pathname);
    });
    const read = async (): Promise<AdminAutomaticRunState> => {
      const response = await page.request.get('/api/admin/automatic-runs');
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toContain('no-store');
      return response.json();
    };
    const entries = async (runId: string) =>
      (
        await pool.query(
          `SELECT id::text,run_id::text,pass,contribution_id::text,actor,request_id::text,
              audit_reference::text,before_balance,balance,actions,created_at::text
       FROM admin_automatic_run_entries WHERE run_id=$1 ORDER BY id`,
          [runId]
        )
      ).rows;

    await test.step('The owner starts a real sequential passage; currencies and zero promised benefits remain distinct', async () => {
      expect((await read()).run).toBeNull();
      await page.locator('[data-og7="admin-guidance-toggle"]').click();
      await page.locator('[data-og7="admin-guidance-automatic-mode"]').click();
      await expect(hook(page, 'state')).toHaveAttribute(
        'data-og7-id',
        'review'
      );
      expect(commands).toEqual([]);
      await hook(page, 'start').click();
      await acknowledgePassage(page, 2);
      await expect(hook(page, 'state')).toHaveAttribute(
        'data-og7-id',
        'completed'
      );
      await expect(hook(page, 'completion')).toHaveAttribute(
        'data-og7-id',
        'balanced'
      );
      await expect(hook(page, 'observed')).toBeVisible();
      const state = await read();
      expect(state.run).toMatchObject({
        status: 'completed',
        dossierCount: 2,
        processedCount: 2,
        balancedCount: 2,
        outstandingCount: 0,
        unknownCount: 0,
        globalBalanced: true,
        newPaymentCount: 0,
        currencyTotals: [
          { currency: 'CAD', amountMinor: 2500 },
          { currency: 'USD', amountMinor: 1700 }
        ]
      });
      expect(Date.parse(state.run!.observedAt!)).toBeGreaterThan(0);
      expect(commands.filter((path) => path.endsWith('/advance'))).toHaveLength(
        2
      );
    });

    const first = (await read()).run!;
    const firstEntries = await entries(first.id);
    expect(firstEntries).toHaveLength(2);
    expect(firstEntries.map((entry) => entry.contribution_id).sort()).toEqual(
      [cad, usd].sort()
    );
    for (const entry of firstEntries) {
      expect(entry.before_balance).toMatchObject({
        status: 'balanced',
        expected: 0,
        fulfilled: 0,
        waived: 0,
        unknown: 0
      });
      expect(entry.balance).toEqual(entry.before_balance);
      expect(entry.actions).toEqual([]);
      const audit = await pool.query(
        'SELECT actor,action,entity_id FROM admin_audit_log WHERE id=$1',
        [entry.audit_reference]
      );
      expect(audit.rows).toEqual([
        {
          actor: entry.actor,
          action: 'automatic_run.dossier_checked',
          entity_id: first.id
        }
      ]);
    }

    await test.step('Reload only reads the durable report and never restarts the completed passage', async () => {
      const before = commands.length;
      await page.reload();
      await expect(hook(page, 'state')).toHaveAttribute(
        'data-og7-id',
        'completed'
      );
      await hook(page, 'report').locator('summary').click();
      await expect(hook(page, 'report-entry')).toHaveCount(2);
      await expect(hook(page, 'report')).toContainText('DEMO-AUTOMATIC-CAD');
      await expect(hook(page, 'report')).toContainText('DEMO-AUTOMATIC-USD');
      expect(commands).toHaveLength(before);
      expect(await entries(first.id)).toEqual(firstEntries);
      const report = await page.request.get(
        '/api/admin/automatic-runs/report',
        { params: { runId: first.id, limit: 50 } }
      );
      expect(report.status()).toBe(200);
      expect(
        (await report.json()).entries.map(
          (entry: { auditReference: string }) => entry.auditReference
        )
      ).toEqual(firstEntries.map((entry) => entry.audit_reference));
    });

    await test.step('A later historical sponsor appears outside the original manifest and prevents a false global balance', async () => {
      await pool.query(
        `INSERT INTO fund_contributions
         (id,contribution_type,amount_cents,currency,status,paid_at,public_reference,sponsor_company_name,non_charity_acknowledged)
         VALUES($1,'sponsorship_interest',50000,'cad','paid',NOW(),'DEMO-AUTOMATIC-HISTORICAL','Entreprise synthétique à qualifier',TRUE)`,
        [sponsor]
      );
      const before = commands.length;
      await hook(page, 'refresh').click();
      await expect(hook(page, 'new-payments')).toContainText('1');
      await expect(hook(page, 'completion')).toHaveAttribute(
        'data-og7-id',
        'outstanding'
      );
      expect((await read()).run).toMatchObject({
        id: first.id,
        newPaymentCount: 1,
        globalBalanced: false
      });
      expect(commands).toHaveLength(before);
      expect(await entries(first.id)).toEqual(firstEntries);
    });

    await test.step('A voluntary new passage includes all three dossiers, parks unknown promises and writes a rereadable report', async () => {
      await hook(page, 'start').click();
      await acknowledgePassage(page, 3);
      await expect(hook(page, 'state')).toHaveAttribute(
        'data-og7-id',
        'completed'
      );
      const state = await read();
      expect(state.run).toMatchObject({
        status: 'completed',
        dossierCount: 3,
        processedCount: 3,
        balancedCount: 2,
        outstandingCount: 1,
        unknownCount: 1,
        globalBalanced: false,
        newPaymentCount: 0
      });
      expect(state.run!.id).not.toBe(first.id);
      const reportEntries = await entries(state.run!.id);
      expect(reportEntries).toHaveLength(3);
      const historical = reportEntries.find(
        (entry) => entry.contribution_id === sponsor
      )!;
      expect(historical.balance).toMatchObject({
        status: 'unknown',
        fulfilled: 0,
        waived: 0
      });
      expect(historical.balance.reasons).toContain(
        'commitment_needs_confirmation'
      );
      expect(historical.actions).toEqual([]);
      await expect(hook(page, 'completion')).toHaveAttribute(
        'data-og7-id',
        'outstanding'
      );
      if ((await hook(page, 'report').getAttribute('open')) === null)
        await hook(page, 'report').locator('summary').click();
      await expect(hook(page, 'report-entry')).toHaveCount(3);
      await expect(hook(page, 'proof')).toHaveCount(0);
      const beforeReload = commands.length;
      await page.reload();
      await expect(hook(page, 'state')).toHaveAttribute(
        'data-og7-id',
        'completed'
      );
      await hook(page, 'report').locator('summary').click();
      await expect(hook(page, 'report-entry')).toHaveCount(3);
      expect(commands).toHaveLength(beforeReload);
      expect(await entries(state.run!.id)).toEqual(reportEntries);
      expect(await entries(first.id)).toEqual(firstEntries);
      // Remaining human interventions must stay reachable when confirmed
      // payments use different currencies. No scalar money total is inferred.
      const attention = await page.request.get('/api/admin/attention');
      expect(attention.status()).toBe(200);
      const work = await attention.json();
      expect(work.coverage).toBe('complete');
      expect(
        work.items.some(
          (item: { contributionId?: string }) => item.contributionId === sponsor
        )
      ).toBe(true);
      const attentionPanel = page.locator('[data-og7="attention-panel"]');
      await expect(attentionPanel).toHaveAttribute('aria-busy', 'false');
      await expect(attentionPanel.locator('.notice.error')).toHaveCount(0);
      await expect(page.locator('[data-og7="attention-items"]')).toBeVisible();
      await info.attach('automatic-responsibilities-real-server-report', {
        body: JSON.stringify(
          { firstRun: first.id, finalRun: state.run!.id, reportEntries },
          null,
          2
        ),
        contentType: 'application/json'
      });
      await page.screenshot({
        path: info.outputPath(
          'automatic-responsibilities-real-server-report.png'
        ),
        fullPage: true
      });
    });

    expect(
      (
        await pool.query(
          `SELECT id::text,contribution_type,amount_cents,currency,status,paid_at::text
       FROM fund_contributions WHERE id=ANY($1::uuid[]) ORDER BY id`,
          [[cad, usd]]
        )
      ).rows
    ).toEqual(sourceBefore);
    const effects = await pool.query(`SELECT
      (SELECT count(*)::int FROM sponsorship_invoices) AS invoices,
      (SELECT count(*)::int FROM sponsorship_credit_notes) AS credits,
      (SELECT count(*)::int FROM email_messages) AS emails,
      (SELECT count(*)::int FROM sponsor_publication_drafts) AS drafts,
      (SELECT count(*)::int FROM publication_deliveries) AS deliveries,
      (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) AS evidence`);
    expect(effects.rows[0]).toEqual({
      invoices: 0,
      credits: 0,
      emails: 0,
      drafts: 0,
      deliveries: 0,
      evidence: 0
    });
  } finally {
    await context?.close();
    await stack?.stop();
  }
});
