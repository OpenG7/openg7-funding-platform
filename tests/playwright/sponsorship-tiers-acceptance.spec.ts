import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import type {
  AdminAuditLogResponse,
  AdminEmailQueueResponse,
  AdminPublicationBatchMutationResult,
  AdminPublicationDraftMutationResult,
  AdminPublicationDraftsResponse,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipsResponse,
  ContributionActivityResponse,
  FundTransparencyPublicResponse,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicSponsorshipsResponse,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const automation = '/api/admin/publication-automation';
const cockpit = '/admin/fundraiser/publications/automation';
interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}
interface SocialReceipts {
  requests: { deliveryId: string }[];
  posts: {
    deliveryId: string;
    feedId: string;
    message: string;
    mediaId: string;
  }[];
}

for (const amount of [100, 250]) {
  for (const publicConsent of [true, false]) {
    test(`company ${amount} CAD, public consent ${publicConsent}: promised benefits, reviewed recognition and authorized simulated delivery`, async ({
      page: admin,
      context,
      request
    }, info) => {
      test.skip(
        process.env.OPENG7_E2E_ISOLATED !== '1',
        'Disposable simulation only.'
      );
      test.setTimeout(240000);
      context.setDefaultTimeout(15000);
      const stub = process.env.STRIPE_STUB_BASE_URL!;
      const name = `Palier ${amount} ${randomUUID().slice(0, 8)}`;
      const email = `tier-${randomUUID()}@simulation.example.test`;
      const privateNote = 'Message confidentiel du commanditaire de recette.';
      const amountConsent = amount === 250;
      const errors: string[] = [];
      admin.on('pageerror', (e) => errors.push(e.message));
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
      const directory = () =>
        get<PublicSponsorshipsResponse>('/api/public/sponsorships', false);
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
      const mails = () =>
        get<{ messages: Mail[] }>(stub + '/__test__/mail', false);
      const adminMails = async () =>
        (await mails()).messages.filter(
          (m) =>
            m.To.some((r) => r.Address === 'admin@simulation.example.test') &&
            m.Subject.includes('Contribution')
        );
      const companyMails = async () =>
        (await mails()).messages.filter((m) =>
          m.To.some((r) => r.Address === email)
        );
      const sms = () =>
        get<{ items: { id: string; text: string }[] }>(
          stub + '/__test__/sms',
          false
        );
      const receipts = (id: string) =>
        get<SocialReceipts>(
          stub + '/__test__/social/receipts?deliveryId=' + id,
          false
        );
      const initial = await state();
      expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
      const before = await totals();
      const beforeMails = (await adminMails()).map((m) => m.ID);
      const beforeSms = (await sms()).items.map((m) => m.id);
      const company = await context.newPage();
      company.on('pageerror', (e) => errors.push(e.message));
      await company.setViewportSize({ width: 390, height: 844 });
      let reference = '';
      let sessionId = '';
      let contributionId = '';
      const sponsor = async () => {
        const response = await get<AdminSponsorshipsResponse>(
          '/api/admin/sponsorships?search=' + reference
        );
        expect(response.items).toHaveLength(1);
        return response.items[0]!;
      };
      const activity = async () =>
        (
          await get<ContributionActivityResponse>(
            '/api/admin/contribution-activity'
          )
        ).items.filter((i) => i.reference === reference);
      const jobs = async () =>
        (await state()).deliveries.filter((j) =>
          j.sponsors.some((s) => s.id === contributionId)
        );
      const drafts = async () =>
        (
          await get<AdminPublicationDraftsResponse>(
            '/api/admin/publication-drafts'
          )
        ).drafts.filter((d) => d.contribution_id === contributionId);
      const invoices = async () =>
        (
          await get<AdminSponsorshipInvoicesResponse>(
            '/api/admin/sponsorship-invoices?contributionId=' + contributionId
          )
        ).invoices;
      const queuedEmails = async () =>
        (await get<AdminEmailQueueResponse>('/api/admin/email-queue')).messages
          .filter(
            (m) =>
              m.recipient_email === email ||
              m.metadata['contributionId'] === contributionId
          )
          .map((m) => m.id)
          .sort();
      const media = async () =>
        (
          await get<SponsorshipMediaResponse>(
            '/api/admin/sponsorships/media?contributionId=' + contributionId
          )
        ).assets;
      const assertPrivate = async () =>
        expect(JSON.stringify(await directory())).not.toContain(name);
      try {
        await worker(false);
        // Isolate scheduling from other recipes, keeping the actual worker cadence.
        for (const feed of initial.feeds)
          await command({
            action: 'settings',
            settings: {
              ...feed,
              paused: true,
              autoPrepare: false,
              timezone: 'UTC',
              weekdays: [0, 1, 2, 3, 4, 5, 6],
              capacity: 1,
              localTime: amount === 100 ? '08:31' : '08:32',
              horizonDays: 28
            }
          });
        await signInAsAdmin(admin);
        await admin.goto(cockpit);

        await test.step('Pay the selected tier through the public form and signed local Checkout', async () => {
          await company.goto(
            '/fonds-des-batisseurs?intent=sponsorship#support'
          );
          const form = company.locator('[data-og7="contribution-form"]');
          await expect(
            form.getByRole('button', { name: /Commandite d'entreprise/ })
          ).toHaveAttribute('aria-pressed', 'true');
          await form
            .getByRole('button', { name: `${amount} $`, exact: true })
            .click();
          const achieved = form.locator('ul[role="list"]');
          await expect(achieved.getByRole('listitem')).toHaveCount(
            amount === 100 ? 1 : 2
          );
          if (amount === 250) await expect(achieved).toContainText('Facebook');
          await expect(achieved).not.toContainText('LinkedIn');
          await form.getByRole('checkbox').nth(0).setChecked(publicConsent);
          if (publicConsent)
            await form.locator('#public-display-name').fill(name);
          await form.getByRole('checkbox').nth(1).setChecked(amountConsent);
          await form.getByRole('checkbox').nth(2).check();
          const checkout = company.waitForResponse(
            (r) =>
              r.url().endsWith('/checkout-sessions') &&
              r.request().method() === 'POST'
          );
          await form.locator('button[type="submit"]').click();
          const checkoutResponse = await checkout;
          expect(checkoutResponse.ok()).toBe(true);
          expect(checkoutResponse.request().postDataJSON()).toMatchObject({
            amount,
            currency: 'CAD',
            contributionType: 'sponsorship_interest',
            publicDisplayConsent: publicConsent,
            displayAmountConsent: amountConsent,
            nonCharityAcknowledged: true
          });
          await expect(company).toHaveURL(/\/checkout\/cs_test_/);
          sessionId = new URL(company.url()).pathname.split('/').at(-1)!;
          const session = await get<{
            client_reference_id: string;
            amount_total: number;
            currency: string;
          }>(`${stub}/v1/checkout/sessions/${sessionId}`, false);
          reference = session.client_reference_id;
          expect(session).toMatchObject({
            amount_total: amount * 100,
            currency: 'cad'
          });
          expect(await totals()).toEqual(before);
          expect(await activity()).toHaveLength(0);
          await company.getByLabel('Courriel simulé').fill(email);
          await company
            .getByRole('button', { name: 'Confirmer le paiement simulé' })
            .click();
          await expect(company.locator('#followup-companyName')).toBeVisible();
          contributionId = (await sponsor()).id;
          expect(await sponsor()).toMatchObject({
            amount,
            currency: 'CAD',
            payment_status: 'paid',
            public_display_consent: publicConsent,
            display_amount_consent: amountConsent,
            sponsor_review_status: 'pending_review',
            sponsor_feed_channels: []
          });
          expect(await invoices()).toHaveLength(1);
          expect((await invoices())[0]).toMatchObject({
            total: amount,
            currency: 'CAD'
          });
          await assertPrivate();
          await admin.bringToFront();
          await expect(
            admin
              .locator('[data-og7="contribution-toast"]')
              .filter({ hasText: reference })
          ).toContainText('Paiement confirmé', { timeout: 15000 });
        });

        await test.step('Submit the dossier and actual logo/photo uploads while recognition stays private', async () => {
          await company.locator('#followup-companyName').fill(name);
          await company
            .locator('#followup-contactName')
            .fill('Contact de recette');
          await company.locator('#followup-contactEmail').fill(email);
          await company
            .locator('#followup-websiteUrl')
            .fill('https://simulation.example.test');
          await company.locator('#followup-message').fill(privateNote);
          const buffer = await sharp({
            create: {
              width: 800,
              height: 600,
              channels: 3,
              background: '#28556e'
            }
          })
            .png()
            .toBuffer();
          for (const [label, filename] of [
            ['Ajouter le logo', 'logo.png'],
            ['Ajouter des photos', 'photo.png']
          ]) {
            await company
              .getByLabel('Description des images à téléverser')
              .fill(`Image de démonstration de ${name}.`);
            const uploaded = company.waitForResponse(
              (r) =>
                r.url().includes('/sponsorship-followup/media') &&
                r.request().method() === 'POST'
            );
            await company.getByLabel(label!).setInputFiles({
              name: filename!,
              mimeType: 'image/png',
              buffer
            });
            expect((await uploaded).ok()).toBe(true);
            await expect(
              company.locator('[data-og7="media-upload-attempt"]')
            ).toHaveCount(0, { timeout: 15000 });
          }
          await company
            .getByRole('button', {
              name: 'Soumettre mes informations à l’équipe'
            })
            .click();
          await expect(
            company
              .getByRole('status')
              .filter({ hasText: /Informations enregistrées/ })
          ).toBeVisible();
          expect(await media()).toHaveLength(2);
          expect(
            (await media()).every((m) => m.reviewStatus === 'pending_review')
          ).toBe(true);
          await assertPrivate();
        });

        await test.step('The activity explains the amount and consent; preparation cannot grant approval', async () => {
          await worker(true);
          await expect
            .poll(async () => (await activity())[0]?.preparation?.state, {
              timeout: 15000
            })
            .toBe(publicConsent ? 'prepared' : 'waiting_consent');
          const item = (await activity())[0]!;
          expect(item.preparation?.reasons).toEqual(
            expect.arrayContaining([
              'website_eligible',
              amount === 100 ? 'facebook_below_threshold' : 'facebook_eligible',
              'linkedin_below_threshold'
            ])
          );
          if (!publicConsent) {
            expect(item.preparation?.cartouche).toBeNull();
            expect(item.preparation?.reasons).toContain('consent_missing');
          }
          await admin.bringToFront();
          const toast = admin.locator(
            `[data-og7="contribution-toast"][data-og7-id="${item.id}"]`
          );
          await toast
            .getByRole('button', { name: 'Voir la préparation' })
            .click();
          const drawer = admin.getByRole('dialog');
          if (publicConsent)
            await expect(
              drawer.locator('[data-og7="website-cartouche"]')
            ).toContainText(name);
          else
            await expect(
              drawer.locator('[data-og7="website-cartouche"]')
            ).toHaveCount(0);
          await expect(drawer).toContainText(
            'Le seuil de contribution pour LinkedIn n’est pas atteint.'
          );
          await expect
            .poll(
              async () => [
                (await activity())[0]?.email,
                (await activity())[0]?.sms
              ],
              { timeout: 15000 }
            )
            .toEqual(['sent', 'captured']);
          await drawer.screenshot({
            path: info.outputPath('tier-reasoning.png')
          });
          await admin.keyboard.press('Escape');
          await worker(false);
          for (const feedId of ['openg7:facebook', 'openg7:linkedin'] as const)
            await command({ action: 'prepare', feedId });
          const expected =
            publicConsent && amount === 250 ? ['openg7:facebook'] : [];
          expect((await jobs()).map((j) => j.feedId)).toEqual(expected);
          expect((await drafts()).map((d) => d.channel)).toEqual(
            expected.length ? ['facebook'] : []
          );
          for (const job of await jobs()) {
            expect(job).toMatchObject({
              status: 'draft',
              approvedAt: null,
              attempts: 0,
              publishedAt: null
            });
            expect(job.sponsors).toHaveLength(1);
            for (const secret of [email, privateNote, reference])
              expect(job.message).not.toContain(secret);
          }
          expect((await sponsor()).sponsor_review_status).toBe(
            'pending_review'
          );
          await assertPrivate();
        });

        await test.step('Review media and dossier; consent still controls website recognition', async () => {
          await admin.goto(
            '/admin/fundraiser/sponsors?sponsorshipId=' +
              contributionId +
              '&tab=media'
          );
          await admin
            .getByRole('button', { name: 'Tout approuver', exact: true })
            .click();
          await expect
            .poll(async () =>
              (await media()).every((m) => m.reviewStatus === 'approved')
            )
            .toBe(true);
          for (const asset of await media())
            expect(
              (
                await request.get('/api/public/sponsor-media/' + asset.id)
              ).status()
            ).toBe(404);
          await assertPrivate();
          await admin
            .getByRole('button', { name: 'Accepter', exact: true })
            .click();
          await expect
            .poll(async () => (await sponsor()).sponsor_review_status)
            .toBe('approved');
          // Ordinary dossier approval makes consenting profiles eligible. Social
          // approval is a separate decision; combined acceptance has its own hold.
          if (publicConsent) {
            await admin.goto(
              '/admin/fundraiser/sponsors?sponsorshipId=' +
                contributionId +
                '&tab=publication'
            );
            await admin
              .getByLabel(/Slug public/i)
              .fill('tier-' + contributionId);
            await admin.getByLabel(/Destination feed/i).selectOption('openg7');
            await admin.getByLabel(/^Statut feed/i).selectOption('planned');
            await admin
              .getByLabel(/Resume public/i)
              .fill('Présentation publique synthétique du commanditaire.');
            await admin
              .getByRole('button', { name: 'Enregistrer', exact: true })
              .click();
            await expect(
              admin.getByText('Publication enregistree.', { exact: true })
            ).toBeVisible();
            const publicData = await directory();
            expect(
              publicData.sponsorships.find((s) => s.company_name === name)
            ).toMatchObject({
              amount: amountConsent ? amount : null,
              message: null,
              public_summary:
                'Présentation publique synthétique du commanditaire.'
            });
            for (const secret of [email, privateNote, reference])
              expect(JSON.stringify(publicData)).not.toContain(secret);
            for (const asset of await media())
              expect(
                (
                  await request.get('/api/public/sponsor-media/' + asset.id)
                ).ok()
              ).toBe(true);
            await company.goto('/commanditaires');
            await expect(
              company.getByText(name, { exact: true })
            ).toBeVisible();
            await company.screenshot({
              path: info.outputPath('public-recognition-mobile.png'),
              fullPage: true
            });
          } else {
            await assertPrivate();
            for (const asset of await media())
              expect(
                (
                  await request.get('/api/public/sponsor-media/' + asset.id)
                ).status()
              ).toBe(404);
          }
        });

        await test.step('Excluded destinations cannot become sendable through direct API requests', async () => {
          const excluded =
            amount === 100 || !publicConsent
              ? ['facebook', 'linkedin']
              : ['linkedin'];
          for (const channel of excluded) {
            const input = { contributionId, feedTarget: 'openg7', channel };
            expect(
              (
                await request.post('/api/admin/publication-drafts', {
                  data: input
                })
              ).status()
            ).toBe(401);
            const created = await request.post(
              '/api/admin/publication-drafts',
              { headers, data: input }
            );
            if (!publicConsent) {
              expect(created.status()).toBe(404);
              continue;
            }
            // Legacy manual drafts are allowed. The final composer must enforce
            // destination eligibility even for a manually approved source draft.
            expect(created.ok()).toBe(true);
            const draft = (
              (await created.json()) as AdminPublicationDraftMutationResult
            ).draft!;
            await post('/api/admin/publication-drafts/update', {
              draftId: draft.id,
              status: 'approved'
            });
            const batch = (
              await post<AdminPublicationBatchMutationResult>(
                '/api/admin/publication-batches',
                { channel, capacity: 1 }
              )
            ).batch!;
            await post('/api/admin/publication-batches/assign', {
              batchId: batch.id,
              draftId: draft.id
            });
            const composed = await request.post(automation, {
              headers,
              data: {
                action: 'compose',
                feedId: `openg7:${channel}`,
                kind: 'sponsorship',
                batchId: batch.id
              }
            });
            expect(composed.status()).toBe(409);
            expect(await composed.json()).toMatchObject({
              code: 'SOURCE_NOT_ELIGIBLE'
            });
          }
          expect((await jobs()).map((j) => j.feedId)).toEqual(
            publicConsent && amount === 250 ? ['openg7:facebook'] : []
          );
        });

        if (publicConsent && amount === 250)
          await test.step('Only explicitly approved Facebook content is delivered once by the worker', async () => {
            const job = (await jobs())[0]!;
            const photo = (await media()).find(
              (m) => m.kind === 'supporting_image'
            )!;
            await command({ action: 'check', feedId: 'openg7:facebook' });
            await admin.goto(cockpit + '?deliveryId=' + job.id);
            const dialog = admin.getByRole('dialog', {
              name: 'Publication finale'
            });
            await dialog
              .getByRole('button', { name: 'Modifier', exact: true })
              .click();
            const message = `Merci à ${name}. Commandite rémunérée, recette simulée.`;
            await dialog.getByLabel('Texte exact à publier').fill(message);
            await dialog.getByLabel('Image approuvée').selectOption(photo.id);
            const date = new Date(
              Math.ceil((Date.now() + 60000) / 60000) * 60000
            );
            const localDate = await admin.evaluate((iso) => {
              const d = new Date(iso);
              return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16);
            }, date.toISOString());
            await dialog.locator('input[name="date"]').fill(localDate);
            await dialog
              .getByRole('button', { name: 'Enregistrer le brouillon' })
              .click();
            await expect(
              dialog.getByRole('button', { name: 'Accepter et programmer' })
            ).toBeDisabled();
            const draft = (await jobs())[0]!;
            expect(draft).toMatchObject({
              status: 'draft',
              approvedAt: null,
              attempts: 0
            });
            const missingConfirmation = await request.post(automation, {
              headers,
              data: { action: 'approve', id: job.id, version: draft.version }
            });
            expect(missingConfirmation.status()).toBe(400);
            await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
            await dialog
              .getByRole('button', { name: 'Accepter et programmer' })
              .click();
            await expect(dialog).toContainText('Autorisée');
            const feed = (await state()).feeds.find(
              (f) => f.id === 'openg7:facebook'
            )!;
            await command({
              action: 'settings',
              settings: { ...feed, paused: false }
            });
            await worker(true);
            await admin.close();
            await expect
              .poll(async () => (await jobs())[0]?.status, {
                timeout: 155000,
                intervals: [1000, 3000]
              })
              .toBe('published');
            expect((await jobs())[0]).toMatchObject({
              mode: 'mock',
              attempts: 1,
              mediaId: photo.id,
              publishedAt: expect.any(String)
            });
            const received = await receipts(job.id);
            expect(
              received.requests.filter((r) => r.deliveryId === job.id)
            ).toHaveLength(1);
            expect(
              received.posts.filter((r) => r.deliveryId === job.id)
            ).toEqual([
              expect.objectContaining({
                feedId: 'openg7:facebook',
                message,
                mediaId: photo.id
              })
            ]);
            const audit = await get<AdminAuditLogResponse>(
              '/api/admin/audit-log'
            );
            expect(
              audit.entries.filter(
                (e) =>
                  e.entity_id === job.id &&
                  e.action === 'publication_automation.published'
              )
            ).toEqual([
              expect.objectContaining({
                actor: 'publication-worker',
                metadata: expect.objectContaining({ mode: 'mock' })
              })
            ]);
          });

        await test.step('Payment and preparation replays preserve one invoice, notification set and delivery', async () => {
          await expect
            .poll(async () => (await companyMails()).length, { timeout: 15000 })
            .toBe(2);
          const invoiceIds = (await invoices()).map((i) => i.id);
          const companyMailIds = (await companyMails()).map((m) => m.ID).sort();
          const emailIds = await queuedEmails();
          expect(emailIds.length).toBeGreaterThanOrEqual(2);
          expect(
            (await adminMails()).filter((m) => !beforeMails.includes(m.ID))
          ).toHaveLength(1);
          expect(
            (await sms()).items.filter((m) => !beforeSms.includes(m.id))
          ).toHaveLength(1);
          const completed = await jobs();
          const deliveryIds = completed.map((j) => j.id);
          await post(stub + '/__test__/checkout-delivery', {
            sessionId,
            action: 'deliver'
          });
          for (const feedId of ['openg7:facebook', 'openg7:linkedin'] as const)
            await command({ action: 'prepare', feedId });
          expect(await totals()).toEqual({
            received: before.received + amount * 100,
            count: before.count + 1
          });
          expect((await invoices()).map((i) => i.id)).toEqual(invoiceIds);
          expect(await activity()).toHaveLength(1);
          expect((await jobs()).map((j) => j.id)).toEqual(deliveryIds);
          expect(await queuedEmails()).toEqual(emailIds);
          expect((await companyMails()).map((m) => m.ID).sort()).toEqual(
            companyMailIds
          );
          expect(
            (await adminMails()).filter((m) => !beforeMails.includes(m.ID))
          ).toHaveLength(1);
          expect(
            (await sms()).items.filter((m) => !beforeSms.includes(m.id))
          ).toHaveLength(1);
          for (const id of deliveryIds) {
            expect((await receipts(id)).requests).toHaveLength(1);
            expect((await receipts(id)).posts).toHaveLength(1);
          }
          if (!publicConsent) await assertPrivate();
          await info.attach('sponsorship-tier-evidence', {
            contentType: 'application/json',
            body: JSON.stringify(
              {
                providers: 'simulated',
                amountMinor: amount * 100,
                currency: 'CAD',
                publicConsent,
                amountConsent,
                contributionId,
                reference,
                invoiceIds,
                preparation: (await activity())[0]?.preparation,
                deliveries: completed.map(
                  ({ id, feedId, status, mode, attempts }) => ({
                    id,
                    feedId,
                    status,
                    mode,
                    attempts
                  })
                ),
                adminEmails: 1,
                sms: 1,
                companyEmails: 2,
                totals: await totals()
              },
              null,
              2
            )
          });
          expect(errors).toEqual([]);
        });
      } finally {
        await company.close();
        for (const feed of initial.feeds)
          await command({ action: 'settings', settings: feed });
        await worker(initial.workerEnabled);
      }
    });
  }
}
