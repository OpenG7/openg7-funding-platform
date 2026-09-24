import { randomUUID } from 'node:crypto';

import type {
  AdminAuditLogResponse,
  AdminPublicationBatchMutationResult,
  AdminPublicationDraftMutationResult,
  AdminSponsorshipsResponse,
  PilotCommand,
  ProgrammeState,
  PublicationAutomationCommand,
  PublicationAutomationState
} from '@openg7/funding-core';

import { ADMIN_TOKEN, SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

test('a rejected company blocks its approved collective post; reviewed recomposition and new approval publish only the retained company', async ({
  page,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(210000);
  page.setDefaultTimeout(15000);
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const automation = '/api/admin/publication-automation';
  const feedId = 'openg7:facebook';
  const get = async <T>(url: string, auth = true): Promise<T> => {
    const r = await request.get(url, auth ? { headers } : {});
    expect(r.ok(), url).toBe(true);
    return r.json();
  };
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const r = await request.post(url, { headers, data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const state = () => get<PublicationAutomationState>(automation);
  const command = (input: PublicationAutomationCommand) =>
    post(automation, input);
  const programme = () => get<ProgrammeState>('/api/admin/pilotage/programme');
  const worker = async (enabled: boolean) => {
    const current = await state();
    if (current.workerEnabled !== enabled)
      await command({
        action: 'worker',
        enabled,
        version: current.workerVersion,
        confirmation: enabled ? 'enable-worker' : 'disable-worker'
      });
  };
  const sponsor = async (reference: string) =>
    (
      await get<AdminSponsorshipsResponse>(
        '/api/admin/sponsorships?search=' + reference
      )
    ).items[0]!;
  const removedFixture = SPONSORSHIP_FIXTURES.collectiveRemoved;
  const retainedFixture = SPONSORSHIP_FIXTURES.collectiveRetained;
  const removed = await sponsor(removedFixture.publicReference);
  const retained = await sponsor(retainedFixture.publicReference);
  const initial = await state();
  const initialFeed = initial.feeds.find((f) => f.id === feedId)!;
  expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let id = '';
  const delivery = async () =>
    (await state()).deliveries.find((d) => d.id === id)!;
  const receipts = () =>
    get<{ requests: unknown[]; posts: { message: string }[] }>(
      process.env.STRIPE_STUB_BASE_URL +
        '/__test__/social/receipts?deliveryId=' +
        id,
      false
    );
  const openDelivery = async () => {
    await page.goto(
      '/admin/fundraiser/publications/automation?deliveryId=' + id
    );
    const dialog = page.getByRole('dialog', { name: 'Publication finale' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const approve = async () => {
    const dialog = await openDelivery();
    await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
    await dialog
      .getByRole('button', { name: 'Accepter et programmer' })
      .click();
    await expect(dialog).toContainText('Autorisée');
  };
  try {
    await worker(false);
    await command({
      action: 'settings',
      settings: {
        ...initialFeed,
        paused: true,
        autoPrepare: false,
        capacity: 2
      }
    });
    await command({ action: 'check', feedId });
    const batch = (
      await post<AdminPublicationBatchMutationResult>(
        '/api/admin/publication-batches',
        {
          channel: 'facebook',
          capacity: 2,
          notes: 'Collective repair simulation'
        }
      )
    ).batch!;
    for (const s of [removed, retained]) {
      const draft = (
        await post<AdminPublicationDraftMutationResult>(
          '/api/admin/publication-drafts',
          { contributionId: s.id, feedTarget: 'openg7', channel: 'facebook' }
        )
      ).draft!;
      await post('/api/admin/publication-drafts/update', {
        draftId: draft.id,
        status: 'approved'
      });
      await post('/api/admin/publication-batches/assign', {
        batchId: batch.id,
        draftId: draft.id
      });
    }
    await post('/api/admin/publication-batches/schedule', {
      batchId: batch.id,
      scheduledAt: new Date(Date.now() + 86400000).toISOString()
    });
    id = (
      await post<{ id: string }>(automation, {
        action: 'compose',
        feedId,
        kind: 'sponsorship',
        batchId: batch.id
      })
    ).id;
    expect((await delivery()).sponsors.map((s) => s.id).sort()).toEqual(
      [removed.id, retained.id].sort()
    );
    await signInAsAdmin(page);
    await approve();
    const approved = await delivery();
    await test.step('Reject one company through the admin form while its approved publication is still in the future', async () => {
      await page.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' +
          removed.id +
          '&tab=publication'
      );
      await page.getByRole('button', { name: 'Refuser', exact: true }).click();
      await page
        .getByLabel(/Raison interne du refus/i)
        .fill(
          'Entreprise retirée du lot de recette. Aucun remboursement demandé.'
        );
      await page.getByRole('button', { name: /Confirmer le refus/i }).click();
      await expect
        .poll(
          async () =>
            (await sponsor(removedFixture.publicReference))
              .sponsor_review_status
        )
        .toBe('rejected');
      const proposed = (await programme()).issues.find(
        (i) => i.deliveryId === id
      )!.repair!;
      expect(proposed.removed).toContain(removed.id);
      expect(proposed.sponsors.map((s) => s.id)).toEqual([retained.id]);
      await worker(true);
      await expect
        .poll(async () => (await delivery()).status, { timeout: 30000 })
        .toBe('blocked');
      await worker(false);
      expect(await delivery()).toMatchObject({
        attempts: 0,
        approvedAt: null,
        publishedAt: null,
        version: approved.version + 1
      });
      expect((await receipts()).requests).toHaveLength(0);
      const stale = await post<{ code: string }>(
        '/api/admin/pilotage/command',
        {
          requestId: randomUUID(),
          action: 'publication.repair',
          targetId: id,
          confirmation: id,
          version: proposed.version
        }
      );
      expect(stale.code).toBe('VERSION_CONFLICT');
    });
    await test.step('Preview and cancel change nothing; confirmed recomposition creates a draft with no publishing authority', async () => {
      await page.goto('/admin/fundraiser/pilotage');
      await page.locator('[data-og7="open-programme"]').click();
      await page
        .getByRole('button', { name: 'Résoudre les incidents', exact: true })
        .click();
      const incident = page.locator(
        '[data-og7="programme-incident"][data-og7-id="' + id + '"]'
      );
      await expect(incident).toContainText(retainedFixture.companyName);
      const before = await delivery();
      await incident
        .getByRole('button', { name: 'Examiner cette recomposition' })
        .click();
      const confirmation = page.locator('[data-og7="programme-confirmation"]');
      await expect(confirmation).toContainText('nouvelle approbation');
      await confirmation
        .getByRole('button', { name: 'Revenir à la proposition', exact: true })
        .click();
      expect(await delivery()).toEqual(before);
      await incident
        .getByRole('button', { name: 'Examiner cette recomposition' })
        .click();
      const pending = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/pilotage/command') &&
          r.request().method() === 'POST'
      );
      await confirmation
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .click();
      const response = await pending;
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ status: 'completed' });
      const input = response.request().postDataJSON() as PilotCommand;
      const auth = response.request().headers()['authorization'];
      const replay = await page.request.post('/api/admin/pilotage/command', {
        headers: auth ? { Authorization: auth } : {},
        data: input
      });
      expect((await replay.json()).status).toBe('completed');
      const repaired = await delivery();
      expect(repaired).toMatchObject({
        status: 'draft',
        approvedAt: null,
        attempts: 0,
        mediaId: null
      });
      expect(repaired.sponsors.map((s) => s.id)).toEqual([retained.id]);
      expect(repaired.message).toContain(retainedFixture.companyName);
      expect(repaired.message).not.toContain(removedFixture.companyName);
      expect((await receipts()).requests).toHaveLength(0);
      await page.screenshot({
        path: info.outputPath('collective-repair-confirmed.png'),
        fullPage: true
      });
    });
    await test.step('Review the exact recomposed content, authorize its new schedule and capture one provider post', async () => {
      const dialog = await openDelivery();
      await dialog
        .getByRole('button', { name: 'Modifier', exact: true })
        .click();
      const due = new Date(Date.now() + 60000);
      const local = await page.evaluate((iso) => {
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      }, due.toISOString());
      await dialog.locator('input[name="date"]').fill(local);
      await dialog
        .getByRole('button', { name: 'Enregistrer le brouillon' })
        .click();
      await expect(
        dialog.getByRole('checkbox', { name: /J’approuve/ })
      ).toBeVisible();
      await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
      await dialog
        .getByRole('button', { name: 'Accepter et programmer' })
        .click();
      await expect(dialog).toContainText('Autorisée');
      await command({
        action: 'settings',
        settings: {
          ...initialFeed,
          paused: false,
          autoPrepare: false,
          capacity: 2
        }
      });
      await worker(true);
      await expect
        .poll(async () => (await delivery()).status, {
          timeout: 100000,
          intervals: [1000, 2000]
        })
        .toBe('published');
      await worker(false);
      const received = await receipts();
      expect(received.requests).toHaveLength(1);
      expect(received.posts).toHaveLength(1);
      expect(received.posts[0]!.message).toBe((await delivery()).message);
      expect(received.posts[0]!.message).not.toContain(
        removedFixture.companyName
      );
      expect(await sponsor(removedFixture.publicReference)).toMatchObject({
        payment_status: 'paid',
        sponsor_review_status: 'rejected',
        amount: removed.amount
      });
      const audits = (
        await get<AdminAuditLogResponse>('/api/admin/audit-log')
      ).entries.filter((e) => e.entity_id === id);
      expect(
        audits.filter(
          (e) => e.action === 'publication_automation.repair_proposed'
        )
      ).toHaveLength(1);
      expect(
        audits.filter((e) => e.action === 'publication_automation.approve')
      ).toHaveLength(2);
      expect(
        audits.filter((e) => e.action === 'publication_automation.published')
      ).toHaveLength(1);
      await info.attach('collective-repair-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          providers: 'simulated',
          delivery: await delivery(),
          receipts: received
        })
      });
      expect(errors).toEqual([]);
    });
  } finally {
    await worker(false);
    await command({ action: 'settings', settings: initialFeed });
  }
});
