import { createHash, randomUUID } from 'node:crypto';

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
  posts: {
    deliveryId: string;
    message: string;
    feedId: string;
    mediaId: string | null;
    mediaSha256: string | null;
  }[];
}

for (const change of ['replace-logo', 'delete-photo'] as const) {
  test(`approved media ${change}: revoke old deliveries and explicitly authorize the revised publication`, async ({
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
    let selectedMediaId: string | null = null;
    const email = `media-${randomUUID()}@simulation.example.test`;
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
      await dialog
        .locator('select[name="media"]')
        .selectOption(selectedMediaId ?? '');
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
            localTime: change === 'replace-logo' ? '08:21' : '08:22',
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
        ['Ajouter des photos', 'photo.png'],
        ['Ajouter des photos', 'backup.png']
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
      const submission = company.waitForResponse(
        (r) =>
          r.url().endsWith('/sponsorship-followup/details') &&
          r.request().method() === 'POST'
      );
      await company
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      const token = (await submission).request().postDataJSON().token as string;
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
      const assets = async () =>
        (
          await get<SponsorshipMediaResponse>(
            '/api/admin/sponsorships/media?contributionId=' + id
          )
        ).assets;
      const originalAsset = (await assets()).find(
        (a) =>
          a.kind === (change === 'replace-logo' ? 'logo' : 'supporting_image')
      )!;
      selectedMediaId = originalAsset.id;
      // Media selection requires an approved dossier; website visibility remains separate.
      await admin.goto('/admin/fundraiser/sponsors?sponsorshipId=' + id);
      await admin
        .getByRole('button', { name: 'Accepter', exact: true })
        .click();
      await expect
        .poll(async () => (await sponsor()).sponsor_review_status)
        .toBe('approved');
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
      await test.step('Release website visibility separately and verify the current public media', async () => {
        await admin.goto(
          '/admin/fundraiser/sponsors?sponsorshipId=' + id + '&tab=publication'
        );
        await admin.getByLabel(/Slug public/i).fill('media-' + id);
        await admin.getByLabel(/Destination feed/i).selectOption('openg7');
        await admin.getByLabel(/^Statut feed/i).selectOption('planned');
        await admin
          .getByLabel(/Resume public/i)
          .fill('Présentation publique synthétique.');
        await admin
          .getByRole('button', { name: 'Enregistrer', exact: true })
          .click();
        await expect(
          admin.getByText('Publication enregistree.', { exact: true })
        ).toBeVisible();
      });
      const publicPath = '/api/public/sponsor-media/' + originalAsset.id;
      const originalPublic = await request.get(publicPath);
      expect(originalPublic.status()).toBe(200);
      expect(originalPublic.headers()['cache-control']).toBe('no-store');
      const oldHash = createHash('sha256')
        .update(
          await sharp(await originalPublic.body())
            .rotate()
            .jpeg({ quality: 90 })
            .toBuffer()
        )
        .digest('hex');
      // Use the browser cache as well as a fresh HTTP request when testing revocation.
      expect(
        await company.evaluate(
          async (url) => (await fetch(url)).status,
          publicPath
        )
      ).toBe(200);
      const removeData = {
        assetId: originalAsset.id,
        expectedVersion: originalAsset.version
      };
      await test.step('An approved asset cannot be deleted by its sponsor or without administrator confirmation', async () => {
        const sponsorDelete = await request.post(
          '/api/sponsorship-followup/media/delete',
          { data: { ...removeData, token } }
        );
        expect(sponsorDelete.status()).toBe(409);
        const noAuth = await request.post(
          '/api/admin/sponsorships/media/delete',
          { data: { ...removeData, confirmation: originalAsset.id } }
        );
        expect([401, 403]).toContain(noAuth.status());
        const noConfirmation = await request.post(
          '/api/admin/sponsorships/media/delete',
          { headers, data: removeData }
        );
        expect(noConfirmation.status()).toBe(400);
        expect(await noConfirmation.json()).toMatchObject({
          code: 'CONFIRMATION_REQUIRED'
        });
        const stale = await request.post(
          '/api/admin/sponsorships/media/delete',
          {
            headers,
            data: {
              ...removeData,
              expectedVersion: '2000-01-01 00:00:00+00',
              confirmation: originalAsset.id
            }
          }
        );
        expect(stale.status()).toBe(409);
        expect((await request.get(publicPath)).status()).toBe(200);
        await admin.goto(
          '/admin/fundraiser/sponsors?sponsorshipId=' + id + '&tab=media'
        );
        const card = admin.locator(
          '[data-og7="admin-sponsor-media"][data-og7-id="' +
            originalAsset.id +
            '"]'
        );
        await card
          .getByRole('button', { name: 'Supprimer', exact: true })
          .click();
        await admin
          .getByRole('dialog', { name: 'Confirmer l’action' })
          .getByRole('button', { name: 'Annuler', exact: true })
          .last()
          .click();
        expect((await assets()).some((a) => a.id === originalAsset.id)).toBe(
          true
        );
        await card
          .getByRole('button', { name: 'Supprimer', exact: true })
          .click();
        const removed = admin.waitForResponse(
          (r) =>
            r.url().endsWith('/admin/sponsorships/media/delete') &&
            r.request().method() === 'POST'
        );
        await admin.locator('[data-og7="confirm-action"]').click();
        expect((await removed).ok()).toBe(true);
        await expect(card).toHaveCount(0);
      });
      expect((await request.get(publicPath)).status()).toBe(404);
      expect(
        (
          await request.get(
            '/api/admin/sponsorships/media/content/' + originalAsset.id,
            { headers }
          )
        ).status()
      ).toBe(404);
      expect(
        (
          await request.get(
            '/api/sponsorship-followup/media/content/' + originalAsset.id,
            { headers: { 'x-sponsorship-followup-token': token } }
          )
        ).status()
      ).toBe(404);
      expect(
        await company.evaluate(
          async (url) => (await fetch(url)).status,
          publicPath
        )
      ).toBe(404);
      expect(
        JSON.stringify(await get('/api/public/sponsorships', false))
      ).not.toContain(originalAsset.id);
      selectedMediaId = null;
      let expectedHash: string | null = null;
      if (change === 'replace-logo') {
        await company.reload();
        await company
          .getByRole('button', { name: 'Modifier mes informations' })
          .click();
        await company
          .getByLabel('Description des images à téléverser')
          .fill('Nouveau logo synthétique');
        const uploaded = company.waitForResponse(
          (r) =>
            r.url().includes('/sponsorship-followup/media') &&
            r.request().method() === 'POST'
        );
        const replacement = await sharp({
          create: {
            width: 800,
            height: 600,
            channels: 3,
            background: '#bd5728'
          }
        })
          .png()
          .toBuffer();
        await company.getByLabel('Ajouter le logo').setInputFiles({
          name: 'replacement.png',
          mimeType: 'image/png',
          buffer: replacement
        });
        expect((await uploaded).ok()).toBe(true);
        const pending = (await assets()).find((a) => a.kind === 'logo')!;
        selectedMediaId = pending.id;
        expect(pending.reviewStatus).toBe('pending_review');
        expect(
          (
            await request.get('/api/public/sponsor-media/' + pending.id)
          ).status()
        ).toBe(404);
        expect(
          JSON.stringify(await get('/api/public/sponsorships', false))
        ).not.toContain(pending.id);
        // A replacement and dossier reapproved before the worker runs cannot revive the old image.
        await admin.reload();
        const card = admin.locator(
          '[data-og7="admin-sponsor-media"][data-og7-id="' + pending.id + '"]'
        );
        await card
          .getByRole('button', { name: 'Approuver le media', exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (await assets()).find((a) => a.id === pending.id)?.reviewStatus
          )
          .toBe('approved');
        expect(
          (
            await request.get('/api/public/sponsor-media/' + pending.id)
          ).status()
        ).toBe(404);
        await admin.goto('/admin/fundraiser/sponsors?sponsorshipId=' + id);
        await admin
          .getByRole('button', { name: 'Accepter', exact: true })
          .click();
        await expect
          .poll(async () => (await sponsor()).sponsor_review_status)
          .toBe('approved');
        expect(
          (
            await request.get('/api/public/sponsor-media/' + pending.id)
          ).status()
        ).toBe(200);
        const preview = await request.get(
          '/api/admin/sponsorships/media/content/' + pending.id,
          { headers }
        );
        expect(preview.ok()).toBe(true);
        expectedHash = createHash('sha256')
          .update(
            await sharp(await preview.body())
              .rotate()
              .jpeg({ quality: 90 })
              .toBuffer()
          )
          .digest('hex');
        expect(expectedHash).not.toBe(oldHash);
      }
      for (const job of jobs)
        expect(await delivery(job.id)).toMatchObject({
          status: 'approved',
          version: job.version,
          approvedAt: job.approvedAt,
          mediaId: originalAsset.id
        });
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
          errorCode: 'MEDIA_NOT_APPROVED',
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
        '[data-og7="publication-media-blocker"]'
      );
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(explanation).toContainText(
        'Une nouvelle autorisation est nécessaire pour chaque destination.'
      );
      await dialog.screenshot({
        path: info.outputPath('media-blocked.png')
      });
      await explanation.getByRole('link', { name }).click();
      await expect(admin).toHaveURL(new RegExp('sponsorshipId=' + id));

      await test.step('Select the revised media or text-only content and explicitly authorize each destination', async () => {
        await setWorker(false);
        const due = new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000);
        for (let index = 0; index < jobs.length; index++) {
          jobs[index] = await authorize(
            jobs[index]!,
            `Merci à ${name}. Visuel révisé et approuvé. Commandite rémunérée, recette simulée.`,
            due
          );
        }
        expect((await sponsor()).sponsor_review_status).toBe('approved');
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
          feedId: job.feedId,
          mediaId: selectedMediaId,
          mediaSha256: expectedHash
        });
        expect(captured.posts[0]!.mediaId).not.toBe(originalAsset.id);
      }
      expect((await invoices()).invoices).toEqual(originalInvoices);
      expect(await totals()).toEqual({
        received: before.received + 50000,
        count: before.count + 1
      });
      expect(await sponsor()).toMatchObject({
        payment_status: 'paid',
        sponsor_review_status: 'approved',
        sponsor_company_name: name
      });
      const publicData = JSON.stringify(
        await get('/api/public/sponsorships', false)
      );
      expect(publicData).toContain(name);
      expect(publicData).not.toContain(originalAsset.id);
      const audit = (await get<AdminAuditLogResponse>('/api/admin/audit-log'))
        .entries;
      expect(
        audit.filter(
          (e) =>
            e.entity_id === originalAsset.id &&
            e.action === 'sponsorship.media.delete'
        )
      ).toHaveLength(1);
      for (const job of jobs) {
        const entries = audit.filter((e) => e.entity_id === job.id);
        const invalidations = entries.filter(
          (e) => e.action === 'publication_automation.media_invalidated'
        );
        expect(invalidations).toHaveLength(1);
        expect(invalidations[0]).toMatchObject({
          actor: 'publication-worker',
          metadata: {
            code: 'MEDIA_NOT_APPROVED',
            mediaId: originalAsset.id
          }
        });
        expect(
          entries.filter((e) => e.action === 'publication_automation.approve')
        ).toHaveLength(2);
        expect(
          entries.filter((e) => e.action === 'publication_automation.published')
        ).toHaveLength(1);
      }
      await info.attach('sponsorship-media-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            providers: 'simulated',
            mediaChange: change,
            removedMediaId: originalAsset.id,
            expectedMediaId: selectedMediaId,
            expectedJpegHash: expectedHash,
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
