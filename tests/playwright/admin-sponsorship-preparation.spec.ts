import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminDossierPreparationReceipt,
  AdminPreparationApproval,
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import { moderationFixture } from './support/moderation.js';
import {
  actor,
  approvedAt,
  contributionId,
  observedAt,
  receipt,
  runId
} from './support/preparation-receipts-fixtures.js';

const firstId = contributionId(1);
const secondId = contributionId(3);
const receiptPath = '/api/admin/sponsorships/preparation';
const path = (tab = 'publication', id = firstId) =>
  `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=${tab}`;
const wrapper = (page: Page) =>
  page.locator('[data-og7="dossier-preparation"]');
const card = (page: Page) =>
  wrapper(page).locator('[data-og7="preparation-receipt"]');
const hook = (page: Page, name: string) =>
  wrapper(page).locator(`[data-og7="preparation-receipt-${name}"]`);

function dossierReceipt(position: number): AdminDossierPreparationReceipt {
  const source = receipt(position);
  return {
    context: 'dossier',
    contributionId: source.contributionId,
    reference: source.reference,
    version: source.version,
    status: source.status,
    payment: source.payment,
    acceptedOffer: source.acceptedOffer,
    balance: source.balance,
    checks: source.checks.filter((check) => check.code !== 'dossier_examined'),
    authorizations: source.authorizations,
    drafts: source.drafts,
    blockers: source.blockers,
    canApprove: source.canApprove,
    approval: null,
    approvalHistory: []
  };
}

function commitment(
  current: AdminDossierPreparationReceipt
): SponsorshipCommitmentRecord {
  const id = `synthetic-commitment-${current.contributionId}`;
  return {
    id,
    contributionId: current.contributionId,
    offerId: `synthetic-offer-${current.contributionId}`,
    provenance: 'accepted_offer',
    state: 'active',
    qualificationReason: null,
    version: 1,
    offer: current.acceptedOffer,
    obligations: (current.balance?.obligations ?? []).map((obligation) => ({
      ...obligation,
      commitmentId: id,
      contributionId: current.contributionId,
      blockedReason: null,
      fulfilmentEvidenceId: null
    }))
  };
}

function record(
  current: AdminDossierPreparationReceipt
): AdminSponsorshipRecord {
  return {
    id: current.contributionId,
    version: 'synthetic-dossier-v1',
    public_reference: current.reference,
    contribution_type: 'sponsorship_interest',
    amount: current.payment.amountMinor / 100,
    currency: current.payment.currency,
    payment_status: current.payment.status,
    paid_at: observedAt,
    public_name: null,
    public_display_consent: true,
    display_amount_consent: false,
    sponsor_company_name: `Atelier synthétique ${current.reference}`,
    sponsor_contact_name: 'Contact synthétique',
    sponsor_contact_email: 'preparation@example.invalid',
    sponsor_website_url: null,
    sponsor_logo_url: null,
    sponsor_message: null,
    sponsor_details_submitted_at: observedAt,
    sponsor_review_status: 'approved',
    sponsor_review_note: null,
    sponsor_reviewed_at: observedAt,
    sponsor_public_slug: null,
    sponsor_public_summary: 'Présentation synthétique privée.',
    sponsor_feed_target: 'openg7',
    sponsor_feed_channels: [],
    sponsor_feed_status: 'drafted',
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
    created_at: observedAt,
    updated_at: observedAt
  };
}

function progress(
  current: AdminDossierPreparationReceipt
): AdminSponsorshipProgress {
  const source = record(current);
  return {
    contributionId: current.contributionId,
    reference: current.reference,
    companyName: source.sponsor_company_name,
    version: source.version,
    amountMinor: current.payment.amountMinor,
    currency: current.payment.currency,
    paymentStatus: current.payment.status,
    reviewStatus: source.sponsor_review_status,
    publicConsent: true,
    publicEligible: true,
    feedStatus: source.sponsor_feed_status,
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
      {
        id: 'media',
        state: 'complete',
        reason: 'media_approved',
        tab: 'media'
      },
      {
        id: 'review',
        state: 'complete',
        reason: 'review_approved',
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
        state: 'pending',
        reason: 'publication_pending',
        tab: 'publication'
      }
    ],
    next: {
      reason: 'publication_pending',
      tab: 'publication',
      adminUrl: path('publication', current.contributionId)
    },
    documents: [],
    publications: [],
    refund: {
      workflow: 'not_requested',
      state: 'not_required',
      confirmedAmountMinor: 0,
      creditMissing: false,
      hasError: false
    },
    failedEmails: [],
    failedStripeEvents: [],
    commitment: commitment(current),
    website: {
      visible: false,
      held: true,
      canPublish: true,
      version: 'synthetic-private-website-v1',
      blockers: []
    },
    publicationCompletion: { done: 0, total: current.balance?.expected ?? 0 },
    publicationBlockers: []
  };
}

/** The browser uses synthetic intercepted APIs only; all unhandled writes fail. */
async function fixture(page: Page, language = 'fr-CA') {
  const f = {
    receipts: new Map([
      [firstId, dossierReceipt(1)],
      [secondId, dossierReceipt(3)]
    ]),
    receiptReads: [] as string[],
    receiptGates: new Map<string, Promise<void>>(),
    receiptStatus: 200,
    receiptCode: 'UNAUTHORIZED',
    approvalGate: null as Promise<void> | null,
    approvalFailure: null as { status: number; code: string } | null,
    approvalResponseGate: null as Promise<void> | null,
    progressVersions: new Map<string, string>(),
    role: 'owner' as 'owner' | 'reader',
    calls: [] as {
      pathname: string;
      method: string;
      body?: Record<string, unknown>;
    }[],
    writes: [] as { pathname: string; body: Record<string, unknown> }[]
  };
  await page.addInitScript(
    (locale) => localStorage.setItem('openg7.language', locale),
    language
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    f.calls.push({ pathname, method });
    if (method !== 'GET') {
      const body = request.postDataJSON() as Record<string, unknown>;
      f.writes.push({ pathname, body });
      if (pathname !== `${receiptPath}/approve`)
        return route.fulfill({
          status: 405,
          json: { code: 'SYNTHETIC_EXTERNAL_WRITE_FORBIDDEN' }
        });
      if (f.approvalGate) await f.approvalGate;
      if (f.approvalFailure)
        return route.fulfill({
          status: f.approvalFailure.status,
          json: {
            code: f.approvalFailure.code,
            message: 'Synthetic private database detail'
          }
        });
      const current = f.receipts.get(String(body['contributionId']));
      if (!current) return route.fulfill({ status: 404, json: {} });
      if (current.version !== body['expectedVersion'])
        return route.fulfill({
          status: 409,
          json: { code: 'PREPARATION_VERSION_CONFLICT' }
        });
      if (!current.canApprove)
        return route.fulfill({
          status: 409,
          json: { code: 'PREPARATION_INCOMPLETE' }
        });
      const approval: AdminPreparationApproval = {
        id: String(body['requestId']),
        runId: null,
        contributionId: current.contributionId,
        version: current.version,
        actor,
        approvedAt,
        requestId: String(body['requestId']),
        auditReference: 'synthetic-dossier-preparation-audit'
      };
      const approved: AdminDossierPreparationReceipt = {
        ...current,
        status: 'approved',
        canApprove: false,
        approval,
        approvalHistory: [...current.approvalHistory, approval]
      };
      f.receipts.set(current.contributionId, approved);
      if (f.approvalResponseGate) await f.approvalResponseGate;
      return route.fulfill({ json: approved });
    }
    if (pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (pathname === '/api/admin/auth/current')
      return route.fulfill({
        json: {
          id: actor,
          sessionId: 'synthetic-dossier-preparation-session',
          displayName: 'Préparation synthétique',
          role: f.role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (pathname === receiptPath) {
      const id = url.searchParams.get('sponsorshipId') ?? '';
      f.receiptReads.push(id);
      const snapshot = f.receipts.get(id);
      const gate = f.receiptGates.get(id);
      if (gate) await gate;
      return route.fulfill({
        status: f.receiptStatus,
        json:
          f.receiptStatus === 200
            ? snapshot
            : {
                code: f.receiptCode,
                message: 'Synthetic private database detail'
              }
      });
    }
    if (
      await moderationFixture(route, [
        { type: 'sponsorship', id: firstId },
        { type: 'sponsorship', id: secondId }
      ])
    )
      return;
    if (pathname === '/api/admin/sponsorships') {
      const records = [...f.receipts.values()].map((current) => ({
        ...record(current),
        version:
          f.progressVersions.get(current.contributionId) ??
          record(current).version
      }));
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
          last_updated_at: observedAt
        }
      });
    }
    if (pathname === '/api/admin/sponsorships/progress') {
      const current = f.receipts.get(
        url.searchParams.get('sponsorshipId') ?? firstId
      )!;
      return route.fulfill({
        json: {
          status: 'ok',
          generatedAt: observedAt,
          dossier: {
            ...progress(current),
            version:
              f.progressVersions.get(current.contributionId) ??
              progress(current).version
          }
        }
      });
    }
    if (pathname === '/api/admin/sponsorships/media')
      return route.fulfill({ json: { assets: [] } });
    if (pathname === '/api/admin/sponsorship-commitments') {
      const current = f.receipts.get(
        url.searchParams.get('contributionId') ?? firstId
      )!;
      return route.fulfill({ json: { commitment: commitment(current) } });
    }
    if (pathname === '/api/admin/attention')
      return route.fulfill({
        json: {
          available: true,
          coverage: 'complete',
          missingSources: [],
          generatedAt: observedAt,
          timezone: 'America/Toronto',
          total: 0,
          filteredTotal: 0,
          todayTotal: 0,
          counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
          typeCounts: {},
          actionCounts: {},
          pendingDossierCount: 0,
          page: 1,
          pageSize: 25,
          items: []
        }
      });
    if (pathname === '/api/admin/assistant/context')
      return route.fulfill({
        json: {
          status: 'empty',
          generatedAt: observedAt,
          conversationMode: 'disabled',
          context: null
        }
      });
    return route.fulfill({
      status: 503,
      json: { code: 'SYNTHETIC_UI_FIXTURE_UNAVAILABLE' }
    });
  });
  return f;
}

async function expectDossier(page: Page, id = firstId) {
  await expect(wrapper(page)).toBeVisible();
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toHaveAttribute('data-og7-id', id);
  await expect(
    page.locator('[data-og7="preparation-receipts-carousel"]')
  ).toHaveCount(0);
  await expect(hook(page, 'position')).toHaveCount(0);
  await expect(hook(page, 'progress')).toHaveCount(0);
}

for (const language of ['fr-CA', 'en']) {
  const failures = [
    {
      code: 'PREPARATION_SCHEMA_INCOMPATIBLE',
      message:
        language === 'en'
          ? 'a database update is required'
          : 'une mise à jour de la base de données est nécessaire'
    },
    {
      code: 'PREPARATION_DATABASE_ACCESS_DENIED',
      message:
        language === 'en'
          ? 'the technical team corrects the permissions'
          : 'la correction des droits par l’équipe technique'
    },
    {
      code: 'PREPARATION_UNAVAILABLE',
      message:
        language === 'en'
          ? 'The receipt is unavailable. Refresh to read current facts.'
          : 'Le bon est indisponible. Actualise pour relire les faits actuels.'
    }
  ];

  for (const failure of failures) {
    test(`dossier receipt read explains ${failure.code} and recovers without a write in ${language}`, async ({
      page
    }) => {
      const f = await fixture(page, language);
      f.receiptStatus = 503;
      f.receiptCode = failure.code;
      await page.goto(path());
      await expect(hook(page, 'error')).toContainText(failure.message);
      await expect(card(page)).toHaveCount(0);
      await expect(wrapper(page)).not.toContainText(
        'Synthetic private database detail'
      );
      await expect(wrapper(page)).not.toContainText(failure.code);
      expect(f.writes).toEqual([]);

      f.receiptStatus = 200;
      await hook(page, 'refresh').click();
      await expectDossier(page);
      await expect(hook(page, 'error')).toHaveCount(0);
      await expect(hook(page, 'approve')).toBeEnabled();
      expect(
        f.receiptReads.filter((id) => id === firstId).length
      ).toBeGreaterThan(1);
      expect(f.writes).toEqual([]);
    });
  }

  for (const failure of failures.slice(0, 2)) {
    test(`dossier approval explains ${failure.code} and keeps approval blocked until explicit refetch in ${language}`, async ({
      page
    }) => {
      const f = await fixture(page, language);
      f.approvalFailure = { status: 503, code: failure.code };
      await page.goto(path());
      await expectDossier(page);
      await hook(page, 'approve').click();
      await expect(hook(page, 'error')).toContainText(failure.message);
      await expectDossier(page);
      await expect(hook(page, 'refresh')).toBeEnabled();
      await expect(hook(page, 'approve')).toBeDisabled();
      await expect(hook(page, 'stamp')).toHaveCount(0);
      expect(f.receipts.get(firstId)?.canApprove).toBe(true);
      expect(f.receipts.get(firstId)?.status).toBe('ready');
      expect(
        f.receiptReads.filter((id) => id === firstId).length
      ).toBeGreaterThan(1);
      expect(f.writes).toHaveLength(1);

      f.approvalFailure = null;
      await hook(page, 'refresh').click();
      await expect(hook(page, 'error')).toHaveCount(0);
      await expect(hook(page, 'approve')).toBeEnabled();
      await expect(hook(page, 'stamp')).toHaveCount(0);
      expect(f.writes).toHaveLength(1);
    });
  }
}

test('the current sponsorship preparation appears only in Publication and preserves its accepted offer and exact private content', async ({
  page
}) => {
  const f = await fixture(page);
  await page.goto(path('overview'));
  const tabs = page.locator('[data-og7="dossier-tabs"]');
  await expect(tabs).toBeVisible();
  await expect(wrapper(page)).toHaveCount(0);
  expect(f.receiptReads).toEqual([]);
  await tabs.getByRole('button', { name: 'Publication', exact: true }).click();
  await expectDossier(page);
  await expect(
    hook(page, 'offer').getByText(/1\s*×\s*Présentation sur le site Web/i)
  ).toBeVisible();
  await hook(page, 'content').locator('summary').click();
  await expect(hook(page, 'content')).toContainText(
    'Présentation privée du dossier synthétique 1.'
  );
  await hook(page, 'details').locator('summary').click();
  await expect(hook(page, 'details')).toContainText(
    'synthetic-historical-offer-v1'
  );
  await tabs.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await expect(wrapper(page)).toHaveCount(0);
  expect(f.writes).toEqual([]);
  expect(
    f.calls.some((call) =>
      call.pathname.startsWith('/api/admin/automatic-runs')
    )
  ).toBe(false);
});

test('changing the current dossier only reads data and discards the previous dossier receipt when it arrives late', async ({
  page
}) => {
  const f = await fixture(page);
  let release!: () => void;
  f.receiptGates.set(
    firstId,
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await page.goto(path());
  await expect.poll(() => f.receiptReads).toContain(firstId);
  await page
    .getByRole('button', { name: 'Dossier suivant', exact: true })
    .click();
  await expectDossier(page, secondId);
  const lateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === receiptPath &&
      new URL(response.url()).searchParams.get('sponsorshipId') === firstId
  );
  release();
  await (await lateResponse).finished();
  await sampledFrames(page);
  await expectDossier(page, secondId);
  await expect(card(page)).toContainText('DEMO-PREP-003');
  await expect(card(page)).not.toContainText('DEMO-PREP-001');
  expect(f.writes).toEqual([]);
  expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('the dossier receipt and a batch receipt for the same payment keep separate accessible descriptions', async ({
  page
}) => {
  const f = await fixture(page);
  await page.route('**/api/admin/automatic-runs**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/preparation'))
      return route.fulfill({
        json: receipt(Number(url.searchParams.get('position')))
      });
    if (url.pathname.endsWith('/report'))
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    const manifest = Array.from({ length: 6 }, (_, index) =>
      receipt(index + 1)
    );
    return route.fulfill({
      json: {
        run: {
          id: runId,
          version: 2,
          status: 'paused',
          startedAt: observedAt,
          updatedAt: observedAt,
          observedAt,
          pass: 1,
          cursor: 1,
          dossierCount: manifest.length,
          processedCount: 1,
          balancedCount: 0,
          outstandingCount: 1,
          unknownCount: 0,
          uncoveredCount: manifest.length - 1,
          newPaymentCount: 0,
          currencyTotals: [
            {
              currency: 'CAD',
              amountMinor: manifest.reduce(
                (total, item) => total + item.payment.amountMinor,
                0
              )
            }
          ],
          latestEntry: null,
          nextContributionId: contributionId(2),
          globalBalanced: false
        },
        balance: null
      }
    });
  });
  await page.goto(path());
  await expectDossier(page);
  await page.locator('[data-og7="admin-guidance-toggle"]').click();
  await page.locator('[data-og7="admin-guidance-automatic-mode"]').click();
  const receipts = page.locator('[data-og7="preparation-receipt"]');
  await expect(receipts).toHaveCount(2);
  const descriptions = await receipts.evaluateAll((elements) =>
    elements.map((element) => {
      const button = element.querySelector(
        '[data-og7="preparation-receipt-approve"]'
      )!;
      const ids = button.getAttribute('aria-describedby')!.split(/\s+/);
      return {
        references: ids.length,
        unique: ids.every(
          (id) =>
            element.ownerDocument.querySelectorAll(`[id="${CSS.escape(id)}"]`)
              .length === 1
        ),
        local: ids.every((id) =>
          element.contains(element.ownerDocument.getElementById(id))
        )
      };
    })
  );
  expect(descriptions).toEqual([
    { references: 2, unique: true, local: true },
    { references: 2, unique: true, local: true }
  ]);
  expect(f.writes).toEqual([]);
});

test('approving a dossier preparation records its version and actor without publishing or moving away', async ({
  page
}) => {
  const f = await fixture(page);
  let release!: () => void;
  f.approvalGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(path());
  await expectDossier(page);
  await hook(page, 'approve').click();
  await expect(hook(page, 'approve')).toBeDisabled();
  await expect(hook(page, 'stamp')).toHaveCount(0);
  await expect.poll(() => f.writes.length).toBe(1);
  release();
  await expect(hook(page, 'stamp')).toContainText(actor);
  await expect(hook(page, 'stamp')).toContainText(
    receipt(1).version.slice(0, 12)
  );
  await expect(
    hook(page, 'stamp').locator(`time[datetime="${approvedAt}"]`)
  ).toBeVisible();
  await expectDossier(page);
  expect(f.writes[0]).toMatchObject({
    pathname: `${receiptPath}/approve`,
    body: {
      contributionId: firstId,
      expectedVersion: receipt(1).version,
      confirmed: true
    }
  });
  expect(f.writes[0]!.body).not.toHaveProperty('runId');
  expect(f.receipts.get(firstId)?.approval?.runId).toBeNull();
  await page.reload();
  await expectDossier(page);
  await expect(hook(page, 'stamp')).toContainText(actor);
  expect(f.writes).toHaveLength(1);
});

test('a delayed approval response cannot restore an approved stamp after the parent dossier changes version', async ({
  page
}) => {
  const f = await fixture(page);
  let release!: () => void;
  f.approvalResponseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(path());
  await expectDossier(page);
  await hook(page, 'approve').click();
  await expect.poll(() => f.receipts.get(firstId)?.status).toBe('approved');
  const committed = f.receipts.get(firstId)!;
  expect(committed.approval).toMatchObject({
    version: receipt(1).version,
    actor,
    approvedAt
  });
  f.receipts.set(firstId, {
    ...committed,
    version: 'b'.repeat(64),
    status: 'review_required',
    canApprove: true,
    approval: null,
    drafts: committed.drafts.map((draft) => ({
      ...draft,
      version: '2',
      body: 'Nouvelle préparation synthétique après l’accord enregistré.'
    }))
  });
  f.progressVersions.set(firstId, 'synthetic-dossier-v2');
  await page
    .locator('[data-og7="sponsorship-progress"]')
    .getByRole('button', { name: 'Actualiser le dossier', exact: true })
    .click();
  await expect(card(page)).toContainText('À revoir');
  const delayedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${receiptPath}/approve`
  );
  release();
  await (await delayedResponse).finished();
  await sampledFrames(page);
  await expect(card(page)).toContainText('À revoir');
  await expect(hook(page, 'stamp')).toHaveCount(0);
  await expect(
    card(page).getByTitle('b'.repeat(64), { exact: true })
  ).toBeVisible();
  await hook(page, 'history').locator('summary').click();
  await expect(hook(page, 'history')).toContainText(actor);
  await expect(
    hook(page, 'history').locator(`time[datetime="${approvedAt}"]`)
  ).toBeVisible();
  await hook(page, 'content').locator('summary').click();
  await expect(hook(page, 'content')).toContainText(
    'Nouvelle préparation synthétique après l’accord enregistré.'
  );
  expect(f.writes).toHaveLength(1);
});

test('a changed preparation reloads À revoir and keeps the previous version agreement in history', async ({
  page
}) => {
  const f = await fixture(page);
  await page.goto(path());
  await expectDossier(page);
  const original = f.receipts.get(firstId)!;
  const prior: AdminPreparationApproval = {
    id: '10000000-0000-4000-8000-000000001198',
    runId: null,
    contributionId: firstId,
    version: original.version,
    actor: 'synthetic-previous-reviewer',
    approvedAt: observedAt,
    requestId: '10000000-0000-4000-8000-000000001197',
    auditReference: 'synthetic-prior-dossier-agreement'
  };
  f.receipts.set(firstId, {
    ...original,
    version: 'a'.repeat(64),
    status: 'review_required',
    approvalHistory: [prior],
    drafts: original.drafts.map((draft) => ({
      ...draft,
      version: '2',
      body: 'Présentation privée synthétique révisée.'
    }))
  });
  await hook(page, 'approve').click();
  await expect(hook(page, 'error')).toBeVisible();
  await expect(card(page)).toContainText('À revoir');
  await expectDossier(page);
  await expect(hook(page, 'stamp')).toHaveCount(0);
  await hook(page, 'history').locator('summary').click();
  await expect(hook(page, 'history')).toContainText(prior.actor);
  await hook(page, 'content').locator('summary').click();
  await expect(hook(page, 'content')).toContainText(
    'Présentation privée synthétique révisée.'
  );
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]!.body['expectedVersion']).toBe(original.version);
  expect(f.receiptReads.filter((id) => id === firstId).length).toBeGreaterThan(
    1
  );
});

test('a missing consent is explained in the dossier receipt and disables preparation approval', async ({
  page
}) => {
  const f = await fixture(page);
  const current = f.receipts.get(firstId)!;
  f.receipts.set(firstId, {
    ...current,
    status: 'incomplete',
    canApprove: false,
    authorizations: current.authorizations.map((check) =>
      check.code === 'public_consent' ? { ...check, state: 'missing' } : check
    ),
    blockers: [{ code: 'public_consent_missing', adminUrl: path('identity') }]
  });
  await page.goto(path());
  await expectDossier(page);
  await expect(hook(page, 'blockers')).toContainText(/consentement/i);
  await expect(
    hook(page, 'summary').getByText('À compléter', { exact: true })
  ).toBeVisible();
  await expect(hook(page, 'approve')).toBeDisabled();
  expect(f.writes).toEqual([]);
});

test('a reader can open exact dossier content while preparation approval stays disabled', async ({
  page
}) => {
  const f = await fixture(page);
  f.role = 'reader';
  await page.goto(path());
  await expectDossier(page);
  await hook(page, 'content').locator('summary').click();
  await expect(hook(page, 'content')).toContainText(
    'Présentation privée du dossier synthétique 1.'
  );
  await expect(hook(page, 'approve')).toBeDisabled();
  expect(f.writes).toEqual([]);
});

for (const status of [401, 403]) {
  test(`a ${status} dossier read removes private preparation content without repeating an agreement`, async ({
    page
  }) => {
    const f = await fixture(page);
    await page.goto(path());
    await expectDossier(page);
    f.receiptStatus = status;
    f.receiptCode = 'PREPARATION_SCHEMA_INCOMPATIBLE';
    await hook(page, 'refresh').click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      'Présentation privée du dossier synthétique 1.'
    );
    if (status === 403)
      await expect(hook(page, 'error')).toContainText(
        'Tes droits ne permettent plus cette opération.'
      );
    expect(f.writes).toEqual([]);
  });
}

for (const [width, language] of [
  [1440, 'fr-CA'],
  [390, 'en']
] as const) {
  test(`the Publication receipt supports keyboard review and approval at 125% in ${language} on ${width}px`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const f = await fixture(page, language);
    await page.goto(path());
    await expectDossier(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25';
    });
    await card(page).focus();
    await expect(card(page)).toBeFocused();
    const bounds = await card(page).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await card(page).screenshot({
      path: testInfo.outputPath(`dossier-preparation-${width}-125.png`),
      animations: 'disabled'
    });
    const contentToggle = hook(page, 'content').locator('summary');
    await expect(contentToggle).toHaveAccessibleName(
      language === 'en'
        ? 'Review prepared content'
        : 'Relire le contenu préparé'
    );
    await contentToggle.focus();
    await page.keyboard.press('Enter');
    await expect(hook(page, 'content')).toHaveJSProperty('open', true);
    expect(f.writes).toEqual([]);
    const audit = await new AxeBuilder({ page })
      .include('[data-og7="dossier-preparation"]')
      .analyze();
    expect(audit.violations).toEqual([]);
    await hook(page, 'approve').focus();
    await page.keyboard.press('Enter');
    await expect(hook(page, 'stamp')).toContainText(actor);
    await expect(card(page)).toBeFocused();
    await expectDossier(page);
    expect(f.writes).toHaveLength(1);
    await expect(wrapper(page)).not.toContainText('admin.automatic.');
  });
}
