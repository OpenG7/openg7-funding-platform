import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import type {
  AdminAuditLogResponse,
  AdminPublicationBatchesResponse,
  AdminPublicationDraftsResponse,
  AdminSponsorshipsResponse,
  ContributionActivityResponse,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId,
  PublicSponsorshipsResponse,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const automationUrl = '/api/admin/publication-automation';
const cockpit = '/admin/fundraiser/publications/automation';
const feeds: PublicationFeedId[] = ['openg7:facebook', 'openg7:linkedin'];

test('company pays 500 CAD: private preparation, reviewed media, exact approvals and two simulated worker deliveries', async ({
  page,
  context,
  request,
  playwright,
  baseURL
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(720000);
  context.setDefaultTimeout(15000);
  let admin = page;
  await admin.setViewportSize({ width: 1280, height: 1100 });
  const errors: string[] = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  page.on('pageerror', (e) => errors.push(e.message));
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const companyName = `Atelier Boréal ${randomUUID().slice(0, 8)}`;
  const privateNote = 'Note privée de recette, à exclure de toute publication.';
  const privateEmail = 'contact@simulation.example.test';
  const get = async <T>(url: string, authenticated = true): Promise<T> => {
    const response = await request.get(url, authenticated ? { headers } : {});
    expect(response.ok(), url).toBe(true);
    return response.json() as Promise<T>;
  };
  const state = () => get<PublicationAutomationState>(automationUrl);
  const command = (data: PublicationAutomationCommand, authenticated = true) =>
    request.post(automationUrl, {
      data,
      ...(authenticated ? { headers } : {})
    });
  const initial = await state();
  expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
  const sponsor = async () => {
    const result = await get<AdminSponsorshipsResponse>(
      '/api/admin/sponsorships?search=' + encodeURIComponent(companyName)
    );
    expect(result.items).toHaveLength(1);
    return result.items[0]!;
  };
  const publicSponsors = () =>
    get<PublicSponsorshipsResponse>('/api/public/sponsorships', false);
  const assertPrivate = async () =>
    expect(JSON.stringify(await publicSponsors())).not.toContain(companyName);
  const activity = () =>
    get<ContributionActivityResponse>('/api/admin/contribution-activity');
  const delivery = async (id: string) => {
    const job = (await state()).deliveries.find((d) => d.id === id);
    expect(job).toBeTruthy();
    return job!;
  };
  const feedCard = (id: PublicationFeedId) =>
    admin.locator('[data-og7="publication-feed-settings"] article').filter({
      hasText: new RegExp(
        'OPENG7\\s+' + (id.endsWith('facebook') ? 'Facebook' : 'LinkedIn')
      )
    });
  const openDelivery = async (id: string) => {
    await admin.goto(cockpit + '?deliveryId=' + id);
    const dialog = admin.getByRole('dialog', { name: 'Publication finale' });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  await signInAsAdmin(admin);
  await admin.goto(cockpit + '?settings=feeds');
  if (initial.workerEnabled) {
    await admin.locator('[data-og7="publication-worker-toggle"]').click();
    await expect(
      admin.locator('[data-og7="publication-worker-toggle"]')
    ).toHaveAttribute('aria-checked', 'false');
  }
  const companyContext = await playwright.chromium.launchPersistentContext(
    await mkdtemp(join(tmpdir(), 'og7-sponsorship-publication-')),
    { baseURL }
  );
  companyContext.setDefaultTimeout(15000);
  try {
    await test.step('Configure paused simulation feeds for separate private proposals', async () => {
      for (const id of feeds) {
        const card = feedCard(id);
        if (!(await state()).feeds.find((f) => f.id === id)!.paused) {
          await card
            .getByRole('button', { name: 'Pause', exact: true })
            .click();
          await expect(
            card.getByRole('button', { name: 'Reprendre', exact: true })
          ).toBeVisible();
        }
        await card
          .getByRole('button', { name: 'Réglages', exact: true })
          .click();
        const settings = admin.getByRole('dialog', { name: 'Réglages' });
        await settings
          .getByRole('button', { name: 'Vérifier la connexion', exact: true })
          .click();
        await expect(settings.getByRole('status')).toContainText(
          'Connexion vérifiée'
        );
        await settings.locator('input[name="auto"]').check();
        // A distinct recurrence avoids reusing earlier suite fixtures' slots.
        await settings.locator('input[name="time"]').fill('08:17');
        await settings.locator('input[name="timezone"]').fill('UTC');
        await settings.locator('input[name="capacity"]').fill('1');
        await settings.locator('input[name="horizon"]').fill('28');
        for (const name of [
          'Dim.',
          'Lun.',
          'Mar.',
          'Mer.',
          'Jeu.',
          'Ven.',
          'Sam.'
        ]) {
          await settings.getByRole('checkbox', { name, exact: true }).check();
        }
        await settings
          .getByRole('button', { name: 'Enregistrer les réglages' })
          .click();
        await expect(settings).toBeHidden();
      }
    });

    const company =
      companyContext.pages()[0] ?? (await companyContext.newPage());
    company.on('pageerror', (e) => errors.push(e.message));
    let sessionId = '';
    let reference = '';
    let paymentIntentId = '';
    await test.step('Pay 500 CAD through the real form and signed local Checkout', async () => {
      await company.goto('/fonds-des-batisseurs?intent=sponsorship#support');
      const form = company.locator('[data-og7="contribution-form"]');
      await form
        .getByRole('button', { name: /Commandite d'entreprise/ })
        .click();
      await form.getByRole('button', { name: '500 $', exact: true }).click();
      await form.getByRole('checkbox').nth(0).check();
      await form.locator('#public-display-name').fill(companyName);
      await form.getByRole('checkbox').nth(1).uncheck();
      await form.getByRole('checkbox').nth(2).check();
      const checkout = company.waitForRequest(
        (r) => r.url().endsWith('/checkout-sessions') && r.method() === 'POST'
      );
      await form.locator('button[type="submit"]').click();
      expect((await checkout).postDataJSON()).toMatchObject({
        amount: 500,
        currency: 'CAD',
        contributionType: 'sponsorship_interest',
        publicDisplayConsent: true,
        displayAmountConsent: false,
        nonCharityAcknowledged: true
      });
      await expect(company).toHaveURL(/\/checkout\/cs_test_/);
      sessionId = new URL(company.url()).pathname.split('/').at(-1)!;
      const session = await get<{
        client_reference_id: string;
        payment_intent: string;
      }>(`${stub}/v1/checkout/sessions/${sessionId}`, false);
      reference = session.client_reference_id;
      paymentIntentId = session.payment_intent;
      await company
        .getByRole('button', { name: 'Confirmer le paiement simulé' })
        .click();
      await expect(company.locator('#followup-companyName')).toBeVisible();
      await assertPrivate();
      await admin.bringToFront();
      await expect(
        admin
          .locator('[data-og7="contribution-toast"]')
          .filter({ hasText: reference })
      ).toContainText('Paiement confirmé', { timeout: 15000 });
    });

    await test.step('Submit the private dossier, logo and presentation photo', async () => {
      await company.locator('#followup-companyName').fill(companyName);
      await company.locator('#followup-contactName').fill('Contact de recette');
      await company.locator('#followup-contactEmail').fill(privateEmail);
      await company
        .locator('#followup-websiteUrl')
        .fill('https://simulation.example.test');
      await company.locator('#followup-message').fill(privateNote);
      const buffer = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#28556e' }
      })
        .png()
        .toBuffer();
      for (const [label, filename] of [
        ['Ajouter le logo', 'logo-demo.png'],
        ['Ajouter des photos', 'photo-demo.png']
      ]) {
        await company
          .getByLabel('Description des images à téléverser')
          .fill(`Présentation de ${companyName}, image de démonstration.`);
        const upload = company.waitForResponse(
          (r) =>
            r.url().includes('/sponsorship-followup/media') &&
            r.request().method() === 'POST'
        );
        await company
          .getByLabel(label!)
          .setInputFiles({ name: filename!, mimeType: 'image/png', buffer });
        expect((await upload).ok()).toBe(true);
        await expect(
          company.locator('[data-og7="media-upload-attempt"]')
        ).toHaveCount(0, { timeout: 15000 });
      }
      await expect(company.locator('[data-og7="followup-media"]')).toHaveCount(
        2
      );
      await company
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      await expect(
        company
          .getByRole('status')
          .filter({ hasText: /Informations enregistrées/ })
      ).toBeVisible();
      await company.screenshot({
        path: info.outputPath('company-dossier-submitted.png'),
        fullPage: true
      });
    });

    const record = await sponsor();
    expect(record).toMatchObject({
      amount: 500,
      currency: 'CAD',
      payment_status: 'paid',
      sponsor_review_status: 'pending_review',
      sponsor_message: privateNote,
      sponsor_details_submitted_at: expect.any(String),
      public_display_consent: true,
      display_amount_consent: false
    });
    const provider = await get<{ metadata: Record<string, string> }>(
      `${stub}/v1/payment_intents/${paymentIntentId}`,
      false
    );
    expect(provider.metadata).toMatchObject({
      sponsorCompanyName: companyName
    });
    const media = () =>
      get<SponsorshipMediaResponse>(
        '/api/admin/sponsorships/media?contributionId=' + record.id
      );
    expect((await media()).assets).toHaveLength(2);
    expect(
      (await media()).assets.every((m) => m.reviewStatus === 'pending_review')
    ).toBe(true);

    let jobs: PublicationDelivery[] = [];
    await test.step('The worker prepares both channels but cannot authorize missing media', async () => {
      await admin.bringToFront();
      await admin.locator('[data-og7="publication-worker-toggle"]').click();
      await admin.locator('[data-og7="confirm-action"]').click();
      await expect(
        admin.locator('[data-og7="publication-worker-toggle"]')
      ).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(
          async () => {
            jobs = (await state()).deliveries.filter((j) =>
              j.sponsors.some((s) => s.id === record.id)
            );
            return jobs.map((j) => j.feedId).sort();
          },
          // Earlier acceptance tests may have claimed the five-minute preparation
          // window. Keep the real throttle and allow the next worker tick.
          { timeout: 340000, intervals: [1000, 5000] }
        )
        .toEqual(feeds);
      for (const job of jobs) {
        expect(job).toMatchObject({
          status: 'draft',
          mode: 'mock',
          autoManaged: true,
          attempts: 0,
          approvedAt: null,
          externalPostId: null
        });
        expect(job.sponsors).toHaveLength(1);
        expect(job.message).toContain(companyName);
        expect(job.message).not.toContain(privateNote);
        expect(job.message).not.toContain(privateEmail);
        expect(job.message).not.toMatch(/\b500(?:[,.]00)?\s*(?:CAD|\$)/);
      }
      const job = jobs.find((j) => j.feedId === feeds[0])!;
      const preview = await openDelivery(job.id);
      await expect(preview).toContainText(
        'Photo de présentation à fournir ou à approuver'
      );
      await expect(
        preview.getByRole('button', { name: 'Accepter et programmer' })
      ).toBeDisabled();
      const approval: PublicationAutomationCommand = {
        action: 'approve',
        id: job.id,
        version: job.version,
        confirmation: job.id,
        approveSponsors: job.sponsors.map(({ id, version }) => ({
          id,
          version
        }))
      };
      expect((await command(approval, false)).status()).toBe(401);
      const forbidden = await command(approval);
      expect(forbidden.status()).toBe(409);
      expect(await forbidden.json()).toMatchObject({
        code: 'SPONSOR_MEDIA_REQUIRED'
      });
      expect((await sponsor()).sponsor_review_status).toBe('pending_review');
      await assertPrivate();
      await preview.screenshot({
        path: info.outputPath('approval-blocked-before-media-review.png')
      });
    });

    await test.step('Review the uploaded media through the admin dossier', async () => {
      await admin.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' + record.id + '&tab=media'
      );
      // The dossier owns this route and its media review controls.
      const approveAll = admin.getByRole('button', {
        name: 'Tout approuver',
        exact: true
      });
      await expect(approveAll).toBeEnabled();
      await approveAll.click();
      await expect
        .poll(async () =>
          (await media()).assets.every((m) => m.reviewStatus === 'approved')
        )
        .toBe(true);
      expect((await sponsor()).sponsor_review_status).toBe('pending_review');
      await assertPrivate();
    });
    const photo = (await media()).assets.find(
      (m) => m.kind === 'supporting_image'
    )!;
    expect(photo.publicUrl).toBeTruthy();
    expect(photo.altText).toContain(companyName);
    const photoPath = new URL(photo.publicUrl!, baseURL).pathname;
    expect((await request.get(photoPath)).status()).toBe(404);
    const facebook = jobs.find((j) => j.feedId === feeds[0])!;
    const linkedin = jobs.find((j) => j.feedId === feeds[1])!;
    let firstApproval: PublicationDelivery;
    await test.step('Accept the sponsor and the exact Facebook proposal, retaining website privacy', async () => {
      const preview = await openDelivery(facebook.id);
      await expect(preview).toContainText('Leurs fiches restent privées');
      await preview
        .getByRole('checkbox', { name: /J’approuve ces commanditaires/ })
        .check();
      await preview
        .getByRole('button', { name: 'Accepter et programmer' })
        .click();
      await expect(preview).toContainText('Autorisée');
      firstApproval = await delivery(facebook.id);
      expect(firstApproval).toMatchObject({
        status: 'approved',
        attempts: 0,
        publishedAt: null
      });
      expect((await sponsor()).sponsor_review_status).toBe('approved');
      expect((await delivery(linkedin.id)).status).toBe('draft');
      await assertPrivate();
      expect((await request.get(photoPath)).status()).toBe(404);
    });

    // Approval requires a future time. The form accepts minute precision; leave
    // 60–120 seconds for the explicit review, then let the real 30-second worker run.
    const nearFuture = () =>
      new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000);
    const editForDelivery = async (
      job: PublicationDelivery,
      message: string
    ) => {
      const preview = await openDelivery(job.id);
      await preview
        .getByRole('button', { name: 'Modifier', exact: true })
        .click();
      await preview.getByLabel('Texte exact à publier').fill(message);
      const date = nearFuture();
      const localDate = await admin.evaluate((iso) => {
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      }, date.toISOString());
      await preview.locator('input[name="date"]').fill(localDate);
      await preview.getByLabel('Image approuvée').selectOption(photo.id);
      const save = admin.waitForResponse(
        (r) =>
          r.url().endsWith(automationUrl) && r.request().method() === 'POST'
      );
      await preview
        .getByRole('button', { name: 'Enregistrer le brouillon' })
        .click();
      const saved = await save;
      expect(saved.ok(), await saved.text()).toBe(true);
      await expect(
        preview.getByRole('button', { name: 'Accepter et programmer' })
      ).toBeDisabled();
      await expect(preview.getByRole('img')).toBeVisible();
      return preview;
    };
    const finalMessages = {
      facebook: `Merci à ${companyName} de soutenir les Bâtisseurs OpenG7. Commandite rémunérée.`,
      linkedin: `${companyName} soutient le développement de l’écosystème OpenG7. Commandite rémunérée.`
    };
    await test.step('Changing approved content revokes it; a stale approval is rejected', async () => {
      await editForDelivery(facebook, finalMessages.facebook);
      expect(await delivery(facebook.id)).toMatchObject({
        status: 'draft',
        approvedAt: null,
        attempts: 0,
        mediaId: photo.id,
        message: finalMessages.facebook
      });
      const stale = await command({
        action: 'approve',
        id: facebook.id,
        version: firstApproval!.version,
        confirmation: facebook.id
      });
      expect(stale.status()).toBe(409);
      expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    });
    await test.step('Authorize LinkedIn and resume both feeds; the unapproved Facebook edit cannot send', async () => {
      const preview = await editForDelivery(linkedin, finalMessages.linkedin);
      await preview.getByRole('checkbox', { name: /J’approuve/ }).check();
      await preview
        .getByRole('button', { name: 'Accepter et programmer' })
        .click();
      await expect(preview).toContainText('Autorisée');
      await preview.screenshot({
        path: info.outputPath('linkedin-exact-approval.png')
      });
      await admin.goto(cockpit + '?settings=feeds');
      for (const id of feeds) {
        await feedCard(id)
          .getByRole('button', { name: 'Reprendre', exact: true })
          .click();
        await expect(
          feedCard(id).getByRole('button', { name: 'Pause', exact: true })
        ).toBeVisible();
      }
      await admin.close();
      await expect
        .poll(async () => (await delivery(linkedin.id)).status, {
          timeout: 155000,
          intervals: [1000, 3000]
        })
        .toBe('published');
      expect(await delivery(facebook.id)).toMatchObject({
        status: 'draft',
        attempts: 0,
        publishedAt: null
      });
    });
    await test.step('Explicitly reauthorize Facebook and observe its server-side simulated delivery', async () => {
      admin = await context.newPage();
      await admin.setViewportSize({ width: 1280, height: 1100 });
      // Token sessions are scoped to the tab; reopening requires a real sign-in.
      await signInAsAdmin(admin);
      const preview = await editForDelivery(facebook, finalMessages.facebook);
      await preview.getByRole('checkbox', { name: /J’approuve/ }).check();
      await preview
        .getByRole('button', { name: 'Accepter et programmer' })
        .click();
      await expect(preview).toContainText('Autorisée');
      await admin.close();
      await expect
        .poll(async () => (await delivery(facebook.id)).status, {
          timeout: 155000,
          intervals: [1000, 3000]
        })
        .toBe('published');
      for (const job of [facebook, linkedin]) {
        expect(await delivery(job.id)).toMatchObject({
          mode: 'mock',
          status: 'published',
          attempts: 1,
          externalPostId: 'mock-' + job.id,
          externalPostUrl: `https://social.openg7.local/${job.feedId}/${job.id}`,
          mediaId: photo.id,
          errorCode: null,
          publishedAt: expect.any(String)
        });
      }
      // Completed simulation is not a genuine social publication in the sources.
      const batches = await get<AdminPublicationBatchesResponse>(
        '/api/admin/publication-batches'
      );
      const drafts = await get<AdminPublicationDraftsResponse>(
        '/api/admin/publication-drafts'
      );
      for (const job of [facebook, linkedin]) {
        expect(
          batches.batches.find((b) => b.id === job.batchId)?.status
        ).not.toBe('published');
        const members = drafts.drafts.filter((d) => d.batch_id === job.batchId);
        expect(members).toHaveLength(1);
        expect(members[0]!.status).not.toBe('published');
        expect(members[0]!.published_at).toBeNull();
      }
      await assertPrivate();
      expect((await request.get(photoPath)).status()).toBe(404);
    });

    await test.step('Publish the website profile through its separate admin visibility decision', async () => {
      admin = await context.newPage();
      await admin.setViewportSize({ width: 1280, height: 1100 });
      await signInAsAdmin(admin);
      await admin.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' +
          record.id +
          '&tab=publication'
      );
      const editor = admin.locator('.publication-editor');
      await expect(editor).toBeVisible();
      await editor.getByLabel(/Slug public/i).fill('recette-' + record.id);
      await editor.getByLabel(/Destination feed/i).selectOption('openg7');
      await editor.getByLabel(/Statut feed/i).selectOption('planned');
      await editor
        .getByLabel(/Resume public/i)
        .fill(
          'Entreprise de démonstration pour une recette entièrement simulée.'
        );
      await admin
        .getByRole('button', { name: 'Enregistrer', exact: true })
        .click();
      await expect(
        editor.getByText('Publication enregistree.', { exact: true })
      ).toBeVisible();
      await expect
        .poll(async () => JSON.stringify(await publicSponsors()))
        .toContain(companyName);
      const directory = await publicSponsors();
      expect(
        directory.sponsorships.find((s) => s.company_name === companyName)
      ).toMatchObject({
        message: null,
        amount: null,
        public_summary:
          'Entreprise de démonstration pour une recette entièrement simulée.'
      });
      expect((await sponsor()).sponsor_message).toBe(privateNote);
      const publicData = JSON.stringify(directory);
      for (const secret of [privateEmail, privateNote, reference])
        expect(publicData).not.toContain(secret);
      expect((await request.get(photoPath)).ok()).toBe(true);
      await company.goto('/commanditaires');
      await expect(
        company.getByText(companyName, { exact: true })
      ).toBeVisible();
      await company.screenshot({
        path: info.outputPath('public-sponsor-after-visibility-decision.png'),
        fullPage: true
      });
    });

    await test.step('Replaying payment preserves one activity and both completed deliveries', async () => {
      const replay = await request.post(stub + '/__test__/checkout-delivery', {
        data: { sessionId, action: 'deliver' }
      });
      expect(replay.ok()).toBe(true);
      const received = (await activity()).items.filter(
        (i) => i.reference === reference
      );
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        amountMinor: 50000,
        currency: 'CAD',
        email: 'sent',
        sms: 'captured'
      });
      const completed = (await state()).deliveries.filter((j) =>
        j.sponsors.some((s) => s.id === record.id)
      );
      expect(completed).toHaveLength(2);
      expect(
        completed.every(
          (j) =>
            j.status === 'published' && j.mode === 'mock' && j.attempts === 1
        )
      ).toBe(true);
      const audit = await get<AdminAuditLogResponse>('/api/admin/audit-log');
      const relevant = audit.entries.filter((e) =>
        completed.some((j) => j.id === e.entity_id)
      );
      for (const job of completed) {
        const published = relevant.filter(
          (e) =>
            e.entity_id === job.id &&
            e.action === 'publication_automation.published'
        );
        expect(published).toHaveLength(1);
        expect(published[0]).toMatchObject({
          actor: 'publication-worker',
          metadata: expect.objectContaining({
            mode: 'mock',
            feedId: job.feedId
          })
        });
      }
      await admin.goto(cockpit + '?deliveryId=' + facebook.id);
      const preview = admin.getByRole('dialog', { name: 'Publication finale' });
      await expect(preview).toContainText('Simulation');
      await expect(preview).toContainText('Publiée');
      await preview.screenshot({
        path: info.outputPath('facebook-simulation-completed.png')
      });
      await info.attach('sponsorship-publication-evidence', {
        body: JSON.stringify(
          {
            providers: 'simulated',
            amountMinor: 50000,
            currency: 'CAD',
            contributionId: record.id,
            reference,
            deliveries: completed,
            audit: relevant
          },
          null,
          2
        ),
        contentType: 'application/json'
      });
      expect(errors).toEqual([]);
    });
  } finally {
    await companyContext.close();
    // Restore shared runner settings without deleting the synthetic evidence.
    for (const id of feeds) {
      const {
        paused,
        autoPrepare,
        timezone,
        weekdays,
        localTime,
        capacity,
        horizonDays
      } = initial.feeds.find((f) => f.id === id)!;
      expect(
        (
          await command({
            action: 'settings',
            settings: {
              id,
              paused,
              autoPrepare,
              timezone,
              weekdays,
              localTime,
              capacity,
              horizonDays
            }
          })
        ).ok()
      ).toBe(true);
    }
    const current = await state();
    if (current.workerEnabled !== initial.workerEnabled) {
      expect(
        (
          await command({
            action: 'worker',
            enabled: initial.workerEnabled,
            version: current.workerVersion,
            confirmation: initial.workerEnabled
              ? 'enable-worker'
              : 'disable-worker'
          })
        ).ok()
      ).toBe(true);
    }
  }
});
