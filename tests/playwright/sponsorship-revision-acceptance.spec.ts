import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import type {
  AdminAuditLogResponse,
  AdminSponsorshipsResponse,
  AdminSponsorshipInvoicesResponse,
  FundTransparencyPublicResponse,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const automation = '/api/admin/publication-automation';
const cockpit = '/admin/fundraiser/publications/automation';
const feeds: PublicationFeedId[] = ['openg7:facebook', 'openg7:linkedin'];
interface Receipt {
  requests: { deliveryId: string; accepted: boolean }[];
  posts: { deliveryId: string; message: string; feedId: string }[];
}

for (const review of ['pending', 'reapproved'] as const) {
  test(`approved company edits its dossier: ${review}, revoke old deliveries and explicitly authorize the new content`, async ({
    page: admin,
    context,
    request
  }, info) => {
    test.skip(
      process.env.OPENG7_E2E_ISOLATED !== '1',
      'Disposable simulation only.'
    );
    test.setTimeout(300000);
    context.setDefaultTimeout(15000);
    const stub = process.env.STRIPE_STUB_BASE_URL!;
    const name = 'Atelier initial ' + randomUUID().slice(0, 8);
    const revisedName = name.replace('initial', 'révisé');
    const email = `revision-${randomUUID()}@simulation.example.test`;
    const errors: string[] = [];
    admin.on('pageerror', (error) => errors.push(error.message));
    const get = async <T>(url: string, authenticated = true): Promise<T> => {
      const response = await request.get(url, authenticated ? { headers } : {});
      expect(response.ok(), url).toBe(true);
      return response.json() as Promise<T>;
    };
    const command = async (data: PublicationAutomationCommand) => {
      const response = await request.post(automation, { headers, data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const state = () => get<PublicationAutomationState>(automation);
    const delivery = async (id: string) => {
      const found = (await state()).deliveries.find((job) => job.id === id);
      expect(found).toBeTruthy();
      return found!;
    };
    const receipt = (id: string) =>
      get<Receipt>(stub + '/__test__/social/receipts?deliveryId=' + id, false);
    const totals = async () => {
      const value = await get<FundTransparencyPublicResponse>(
        '/api/public/fund-transparency',
        false
      );
      return {
        received: Math.round(value.total_received * 100),
        count: value.contributions_count
      };
    };
    const setWorker = async (enabled: boolean) => {
      const current = await state();
      if (current.workerEnabled === enabled) return;
      await command({
        action: 'worker',
        enabled,
        version: current.workerVersion,
        confirmation: enabled ? 'enable-worker' : 'disable-worker'
      });
    };
    const openDelivery = async (id: string) => {
      await admin.goto(cockpit + '?deliveryId=' + id);
      const dialog = admin.getByRole('dialog', { name: 'Publication finale' });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const editDelivery = async (
      job: PublicationDelivery,
      message: string,
      due: Date
    ) => {
      const dialog = await openDelivery(job.id);
      await dialog
        .getByRole('button', { name: 'Modifier', exact: true })
        .click();
      await dialog.getByLabel('Texte exact à publier').fill(message);
      const local = await admin.evaluate((iso) => {
        const date = new Date(iso);
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      }, due.toISOString());
      await dialog.locator('input[name="date"]').fill(local);
      const saved = admin.waitForResponse(
        (r) => r.url().endsWith(automation) && r.request().method() === 'POST'
      );
      await dialog
        .getByRole('button', { name: 'Enregistrer le brouillon' })
        .click();
      expect((await saved).ok()).toBe(true);
      expect((await delivery(job.id)).status).toBe('draft');
      return dialog;
    };
    const authorize = async (
      job: PublicationDelivery,
      message: string,
      due: Date
    ) => {
      const dialog = await editDelivery(job, message, due);
      await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
      await dialog
        .getByRole('button', { name: 'Accepter et programmer' })
        .click();
      await expect(dialog).toContainText('Autorisée');
      return delivery(job.id);
    };
    const initial = await state();
    expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
    const before = await totals();
    const company = await context.newPage();
    company.on('pageerror', (error) => errors.push(error.message));
    await company.setViewportSize({ width: 390, height: 844 });
    let jobs: PublicationDelivery[] = [];
    try {
      await setWorker(false);
      for (const id of feeds) {
        await command({
          action: 'settings',
          settings: {
            id,
            paused: true,
            autoPrepare: false,
            timezone: 'UTC',
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            localTime: '08:19',
            capacity: 1,
            horizonDays: 28
          }
        });
        await command({ action: 'check', feedId: id });
      }
      await company.goto('/fonds-des-batisseurs?intent=sponsorship#support');
      const form = company.locator('[data-og7="contribution-form"]');
      await expect(
        form.getByRole('button', { name: /Commandite d'entreprise/ })
      ).toHaveAttribute('aria-pressed', 'true');
      await form.getByRole('button', { name: '500 $', exact: true }).click();
      await form.getByRole('checkbox').nth(0).check();
      await form.locator('#public-display-name').fill(name);
      await form.getByRole('checkbox').nth(1).uncheck();
      await form.getByRole('checkbox').nth(2).check();
      await form.locator('button[type="submit"]').click();
      await expect(company).toHaveURL(/\/checkout\/cs_test_/);
      const sessionId = new URL(company.url()).pathname.split('/').at(-1)!;
      const session = await get<{ client_reference_id: string }>(
        stub + '/v1/checkout/sessions/' + sessionId,
        false
      );
      await company.getByLabel('Courriel simulé').fill(email);
      await company
        .getByRole('button', { name: 'Confirmer le paiement simulé' })
        .click();
      await expect(company.locator('#followup-companyName')).toBeVisible();
      const sponsor = async () => {
        const result = await get<AdminSponsorshipsResponse>(
          '/api/admin/sponsorships?search=' + session.client_reference_id
        );
        expect(result.items).toHaveLength(1);
        return result.items[0]!;
      };
      const id = (await sponsor()).id;
      const invoices = () =>
        get<AdminSponsorshipInvoicesResponse>(
          '/api/admin/sponsorship-invoices?contributionId=' + id
        );
      await expect
        .poll(async () => (await invoices()).invoices[0]?.last_email_status)
        .toBe('sent');
      const originalInvoices = (await invoices()).invoices;
      expect(originalInvoices).toHaveLength(1);
      await company.locator('#followup-companyName').fill(name);
      await company
        .locator('#followup-contactName')
        .fill('Contact synthétique');
      await company.locator('#followup-contactEmail').fill(email);
      await company
        .locator('#followup-websiteUrl')
        .fill('https://simulation.example.test');
      const buffer = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#28556e' }
      })
        .png()
        .toBuffer();
      for (const [label, filename] of [
        ['Ajouter le logo', 'logo.png'],
        ['Ajouter des photos', 'photo.png']
      ]) {
        await company
          .getByLabel('Description des images à téléverser')
          .fill('Présentation synthétique');
        const uploaded = company.waitForResponse(
          (r) =>
            r.url().includes('/sponsorship-followup/media') &&
            r.request().method() === 'POST'
        );
        await company
          .getByLabel(label!)
          .setInputFiles({ name: filename!, mimeType: 'image/png', buffer });
        expect((await uploaded).ok()).toBe(true);
        await expect(
          company.locator('[data-og7="media-upload-attempt"]')
        ).toHaveCount(0);
      }
      await company
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      await expect(
        company
          .getByRole('status')
          .filter({ hasText: /Informations enregistrées/ })
      ).toBeVisible();
      await signInAsAdmin(admin);
      await admin.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' + id + '&tab=media'
      );
      await admin
        .getByRole('button', { name: 'Tout approuver', exact: true })
        .click();
      await expect
        .poll(async () =>
          (
            await get<SponsorshipMediaResponse>(
              '/api/admin/sponsorships/media?contributionId=' + id
            )
          ).assets.every((a) => a.reviewStatus === 'approved')
        )
        .toBe(true);
      for (const feedId of feeds) await command({ action: 'prepare', feedId });
      jobs = (await state()).deliveries.filter((j) =>
        j.sponsors.some((s) => s.id === id)
      );
      expect(jobs.map((j) => j.feedId).sort()).toEqual(feeds);
      expect(jobs.every((j) => j.sponsors.length === 1)).toBe(true);
      const originalDue = new Date(
        Math.ceil((Date.now() + 180000) / 60000) * 60000
      );
      for (let index = 0; index < jobs.length; index++) {
        jobs[index] = await authorize(
          jobs[index]!,
          `Merci à ${name}. Commandite rémunérée, recette simulée.`,
          originalDue
        );
      }
      const approvedDossier = await sponsor();
      expect(approvedDossier.sponsor_review_status).toBe('approved');

      await test.step('Autosave and reload keep the submitted profile and its authorization intact', async () => {
        await company.reload();
        await expect(company.locator('#followup-companyName')).toBeDisabled();
        await company
          .getByRole('button', { name: 'Modifier mes informations' })
          .click();
        await company.locator('#followup-companyName').fill(revisedName);
        await expect(
          company.locator('[data-og7="followup-draft-status"]')
        ).toContainText('Brouillon enregistré.');
        await company.reload();
        await expect(company.locator('#followup-companyName')).toHaveValue(
          revisedName
        );
        expect(await sponsor()).toEqual(approvedDossier);
        for (const job of jobs) expect(await delivery(job.id)).toEqual(job);
        await company.screenshot({
          path: info.outputPath('private-draft.png')
        });
      });
      const submitted = company.waitForResponse(
        (r) =>
          r.url().endsWith('/sponsorship-followup/details') &&
          r.request().method() === 'POST'
      );
      await company
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      const response = await submitted;
      expect(response.ok()).toBe(true);
      // Keep the synthetic request in memory to verify an identical later retry.
      // Its private token is never included in the evidence attachment.
      const submittedBody = response.request().postDataJSON();
      expect(await sponsor()).toMatchObject({
        sponsor_company_name: revisedName,
        sponsor_review_status: 'pending_review',
        payment_status: 'paid'
      });
      if (review === 'reapproved') {
        // Reapprove before the stopped worker can observe pending_review.
        await admin.goto('/admin/fundraiser/sponsors?sponsorshipId=' + id);
        await admin
          .getByRole('button', { name: 'Accepter', exact: true })
          .click();
        await expect
          .poll(async () => (await sponsor()).sponsor_review_status)
          .toBe('approved');
      }
      await setWorker(true);
      await expect
        .poll(
          async () =>
            (await state()).deliveries
              .filter((j) => jobs.some((old) => old.id === j.id))
              .map((j) => j.status),
          { timeout: 45000, intervals: [1000, 2000] }
        )
        .toEqual(['blocked', 'blocked']);
      expect(Date.now()).toBeLessThan(originalDue.getTime());
      for (const job of jobs) {
        expect(await delivery(job.id)).toMatchObject({
          errorCode: 'SPONSOR_REVIEW_REQUIRED',
          approvedAt: null,
          attempts: 0,
          publishedAt: null,
          version: job.version + 1
        });
        expect((await receipt(job.id)).requests).toHaveLength(0);
        const stale = await request.post(automation, {
          headers,
          data: {
            action: 'approve',
            id: job.id,
            version: job.version,
            confirmation: job.id
          }
        });
        expect(stale.status()).toBe(409);
        expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
        const blocked = await delivery(job.id);
        const direct = await request.post(automation, {
          headers,
          data: {
            action: 'approve',
            id: job.id,
            version: blocked.version,
            confirmation: job.id
          }
        });
        expect(direct.status()).toBe(409);
        expect(await direct.json()).toMatchObject({
          code: 'APPROVAL_UNAVAILABLE'
        });
      }
      const dialog = await openDelivery(jobs[0]!.id);
      const explanation = dialog.locator(
        '[data-og7="publication-review-blocker"]'
      );
      await expect(explanation).toContainText(
        'Accepter le dossier seul ne réautorise pas cet envoi.'
      );
      await dialog.screenshot({
        path: info.outputPath('revision-blocked.png')
      });
      await explanation.getByRole('link', { name: revisedName }).click();
      await expect(admin).toHaveURL(new RegExp('sponsorshipId=' + id));

      await test.step('Review the new dossier and exact content, then explicitly authorize each destination', async () => {
        await setWorker(false);
        const due = new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000);
        for (let index = 0; index < jobs.length; index++) {
          jobs[index] = await authorize(
            jobs[index]!,
            `Merci à ${revisedName}. Présentation révisée et approuvée. Commandite rémunérée, recette simulée.`,
            due
          );
        }
        expect((await sponsor()).sponsor_review_status).toBe('approved');
        expect(
          (
            await request.post('/api/sponsorship-followup/details', {
              data: submittedBody
            })
          ).ok()
        ).toBe(true);
        for (const job of jobs) expect(await delivery(job.id)).toEqual(job);
        for (const feedId of feeds) {
          const feed = (await state()).feeds.find((f) => f.id === feedId)!;
          await command({
            action: 'settings',
            settings: { ...feed, paused: false }
          });
        }
        await setWorker(true);
        await company.close();
        await admin.close();
        await expect
          .poll(
            async () =>
              (await state()).deliveries
                .filter((j) => jobs.some((old) => old.id === j.id))
                .map((j) => j.status),
            { timeout: 180000, intervals: [1000, 3000] }
          )
          .toEqual(['published', 'published']);
      });
      for (const job of jobs) {
        expect(await delivery(job.id)).toMatchObject({
          attempts: 1,
          mode: 'mock',
          errorCode: null
        });
        const captured = await receipt(job.id);
        expect(captured.requests).toHaveLength(1);
        expect(captured.posts).toHaveLength(1);
        expect(captured.posts[0]).toMatchObject({
          deliveryId: job.id,
          message: job.message,
          feedId: job.feedId
        });
        expect(captured.posts[0]!.message).not.toContain(name);
      }
      expect((await invoices()).invoices).toEqual(originalInvoices);
      expect(await totals()).toEqual({
        received: before.received + 50000,
        count: before.count + 1
      });
      expect(await sponsor()).toMatchObject({
        payment_status: 'paid',
        sponsor_review_status: 'approved',
        sponsor_company_name: revisedName
      });
      const publicData = JSON.stringify(
        await get('/api/public/sponsorships', false)
      );
      expect(publicData).not.toContain(name);
      expect(publicData).not.toContain(revisedName);
      const audit = (await get<AdminAuditLogResponse>('/api/admin/audit-log'))
        .entries;
      for (const job of jobs) {
        const entries = audit.filter((e) => e.entity_id === job.id);
        const invalidations = entries.filter(
          (e) => e.action === 'publication_automation.source_invalidated'
        );
        expect(invalidations).toHaveLength(1);
        expect(invalidations[0]).toMatchObject({
          actor: 'publication-worker',
          metadata: {
            codes: ['SPONSOR_REVIEW_REQUIRED'],
            affected: [id]
          }
        });
        expect(
          entries.filter((e) => e.action === 'publication_automation.approve')
        ).toHaveLength(2);
        expect(
          entries.filter((e) => e.action === 'publication_automation.published')
        ).toHaveLength(1);
      }
      await info.attach('sponsorship-revision-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            providers: 'simulated',
            reviewBeforeWorker: review,
            contributionId: id,
            invoiceId: originalInvoices[0]!.id,
            after: await totals(),
            deliveries: await Promise.all(jobs.map((j) => delivery(j.id))),
            receipts: await Promise.all(jobs.map((j) => receipt(j.id)))
          },
          null,
          2
        )
      });
      expect(errors).toEqual([]);
    } finally {
      await setWorker(false);
      for (const id of feeds) {
        const feed = initial.feeds.find((f) => f.id === id)!;
        await command({ action: 'settings', settings: { ...feed } });
      }
      if (!company.isClosed()) await company.close();
    }
  });
}
