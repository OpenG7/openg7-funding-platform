import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import type {
  AdminAuditLogResponse,
  AdminEmailQueueResponse,
  AdminPublicationBatchMutationResult,
  AdminPublicationDraftMutationResult,
  AdminPublicationDraftsResponse,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipsResponse,
  ContributionActivityResponse,
  FundTransparencyPublicResponse,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicSponsorshipsResponse,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import {
  acceptanceModerationDecision,
  approveAcceptanceSubject,
  completePublicationModeration
} from './support/acceptance-moderation.js';
import { completeModeration } from './support/moderation.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';
import { signInAsAdmin, adminSessionHeaders } from './support/admin-auth.js';
import { acceptDisplayedSponsorshipOffer } from './support/acceptance-offer.js';
import { confirmAcceptanceMediaUsage } from './support/acceptance-media-usage.js';
import {
  approveAcceptanceMedia,
  selectAcceptanceWebsiteMedia
} from './support/acceptance-media-review.js';
import { acceptanceSql } from './support/acceptance-database.js';
import { runAcceptancePublicationWorker } from './support/acceptance-publication-worker.js';
import {
  expectCompletedPaymentJourney,
  openPaymentJourney,
  paymentAttentionItems,
  readPaymentJourney
} from './support/payment-journey.js';
import { expect, test } from './support/test.js';

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
      const xbox =
        publicConsent && amount === 100 ? adminController(admin) : undefined;
      context.setDefaultTimeout(15000);
      const stub = process.env.STRIPE_STUB_BASE_URL!;
      const name = `Palier ${amount} ${randomUUID().slice(0, 8)}`;
      // The Xbox journey types every character through the visible keyboard.
      const publicSlug = name.toLowerCase().replaceAll(' ', '-');
      const publicSummary = 'Commandite simulée.';
      const email = `tier-${randomUUID()}@simulation.example.test`;
      const privateNote = 'Message confidentiel du commanditaire de recette.';
      const amountConsent = amount === 250;
      const excludedChannels =
        amount === 100 || !publicConsent
          ? ['facebook', 'linkedin']
          : ['linkedin'];
      const errors: string[] = [];
      admin.on('pageerror', (e) => errors.push(e.message));
      const get = async <T>(url: string, auth = true): Promise<T> => {
        const r = await request.get(
          url,
          auth ? { headers: await adminSessionHeaders(request) } : {}
        );
        expect(r.ok(), url).toBe(true);
        return r.json();
      };
      const post = async <T>(url: string, data: unknown): Promise<T> => {
        const r = await request.post(url, {
          headers: await adminSessionHeaders(request),
          data
        });
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
      const tick = (now: Date) =>
        expect
          .poll(() => runAcceptancePublicationWorker(now), {
            timeout: 15000,
            intervals: [100, 500, 1000]
          })
          .toBe(true);
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
        // Isolate scheduling from other recipes before controlled delivery ticks.
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
        const priorActivity = await get<ContributionActivityResponse>(
          '/api/admin/contribution-activity'
        );
        const priorIds = new Set(priorActivity.items.map((item) => item.id));
        const initialClaims = priorIds.size
          ? admin.waitForResponse(
              (response) =>
                new URL(response.url()).pathname ===
                  '/api/admin/contribution-activity/present' &&
                response.request().method() === 'POST'
            )
          : null;
        await admin.bringToFront();
        await signInAsAdmin(admin);
        if (initialClaims) {
          const claimed = await initialClaims;
          expect(claimed.ok()).toBe(true);
          const result = (await claimed.json()) as { ids: string[] };
          // Earlier recipes may have received payments while the admin was offline.
          // Acknowledge only that synthetic backlog before creating this payment.
          for (const id of result.ids) {
            expect(priorIds.has(id)).toBe(true);
            await admin
              .locator(`[data-og7="contribution-toast"][data-og7-id="${id}"]`)
              .getByRole('button', { name: 'Fermer', exact: true })
              .click();
          }
          await expect(
            admin.locator('[data-og7="contribution-toast"]')
          ).toHaveCount(0);
        }
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
          await acceptDisplayedSponsorshipOffer(form);
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
          const journey = await readPaymentJourney(request, contributionId);
          expect(journey.state).not.toBe('complete');
          expect(journey.next).not.toBeNull();
          expect(
            (await paymentAttentionItems(request, contributionId)).some(
              (item) => item.type === 'sponsorship_needs_info'
            )
          ).toBe(true);
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
          await confirmAcceptanceMediaUsage(company);
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
          if (publicConsent && amount === 100) {
            // Inspect the received-payment toast before navigating to the dossier.
            const journey = await readPaymentJourney(request, contributionId);
            expect(journey.next).not.toBeNull();
            await installAdminController(admin);
            await openPaymentJourney(admin, contributionId, xbox);
            const next = admin.locator('[data-og7="payment-journey-next"]');
            await expect(next).toHaveAttribute('href', journey.next!.adminUrl);
            await xbox!.activate(next);
            await expect(admin).toHaveURL(
              new URL(journey.next!.adminUrl, admin.url()).href
            );
            await xbox!.press('Y');
            await xbox!.press('B');
          }
        });

        await test.step('Review media and dossier; consent still controls website recognition', async () => {
          if (xbox)
            await xbox.activate(
              admin
                .locator('[data-og7="dossier-tabs"]')
                .getByRole('button', { name: 'Fiche et médias', exact: true })
            );
          else
            await admin.goto(
              '/admin/fundraiser/sponsors?sponsorshipId=' +
                contributionId +
                '&tab=media'
            );
          const pendingMedia = (await media()).filter(
            (asset) => asset.reviewStatus !== 'approved'
          );
          expect(pendingMedia).toHaveLength(2);
          await approveAcceptanceMedia(
            admin,
            request,
            contributionId,
            pendingMedia.map((asset) => asset.id),
            xbox
          );
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
          const accept = admin.getByRole('button', {
            name: 'Approuver la commandite',
            exact: true
          });
          if (xbox) await xbox.activate(accept);
          else await accept.click();
          await completeModeration(admin, false, xbox);
          await expect
            .poll(async () => (await sponsor()).sponsor_review_status)
            .toBe('approved');
          // Review alone keeps the website profile private until its explicit visibility decision.
          await assertPrivate();
          if (publicConsent) {
            await selectAcceptanceWebsiteMedia(
              admin,
              request,
              contributionId,
              (await media()).map((asset) => asset.id),
              xbox
            );
            await assertPrivate();
            if (xbox) {
              await xbox.activate(
                admin
                  .locator('[data-og7="dossier-tabs"]')
                  .getByRole('button', { name: 'Publication', exact: true })
              );
              await xbox.activate(
                admin.locator('[data-og7="publication-advanced"] > summary')
              );
              await xbox.text(admin.getByLabel(/Slug public/i), publicSlug);
              await xbox.select(
                admin.getByLabel(/Destination feed/i),
                'openg7'
              );
              await xbox.select(
                admin.getByRole('combobox', {
                  name: 'Statut de suivi déclaré',
                  exact: true
                }),
                'planned'
              );
              await xbox.text(
                admin.getByLabel(/Resume public/i),
                publicSummary
              );
              await xbox.activate(
                admin.getByRole('button', { name: 'Enregistrer', exact: true })
              );
            } else {
              await admin.goto(
                '/admin/fundraiser/sponsors?sponsorshipId=' +
                  contributionId +
                  '&tab=publication'
              );
              await admin
                .locator('[data-og7="publication-advanced"] > summary')
                .click();
              await admin.getByLabel(/Slug public/i).fill(publicSlug);
              await admin
                .getByLabel(/Destination feed/i)
                .selectOption('openg7');
              await admin
                .getByRole('combobox', {
                  name: 'Statut de suivi déclaré',
                  exact: true
                })
                .selectOption('planned');
              await admin.getByLabel(/Resume public/i).fill(publicSummary);
              await admin
                .getByRole('button', { name: 'Enregistrer', exact: true })
                .click();
            }
            await expect(
              admin.getByText('Paramètres de suivi enregistrés', {
                exact: true
              })
            ).toBeVisible();
            await assertPrivate();
            // The summary and slug belong to a new editorial revision. Review
            // it before the separate, consent-controlled visibility decision.
            if (xbox) {
              const editorial = admin
                .locator('[data-og7="moderation-actions"]')
                .first();
              await xbox.select(editorial.locator('select').first(), 'N0');
              await xbox.activate(
                editorial.locator('[data-og7="moderation-open"]')
              );
              const reviewed = admin.waitForResponse(
                (response) =>
                  response.url().endsWith('/api/admin/moderation/decisions') &&
                  response.request().method() === 'POST'
              );
              await completeModeration(admin, false, xbox);
              const editorialReview = await reviewed;
              expect(editorialReview.ok()).toBe(true);
              expect(editorialReview.request().postDataJSON()).toMatchObject({
                subject: { type: 'sponsorship', id: contributionId },
                decision: { level: 'N0' }
              });
              await xbox.activate(
                admin.locator('[data-og7="website-visibility"]')
              );
              await xbox.activate(admin.locator('[data-og7="confirm-action"]'));
            } else {
              await approveAcceptanceSubject(request, {
                type: 'sponsorship',
                id: contributionId
              });
              await admin.reload();
              await admin.locator('[data-og7="website-visibility"]').click();
              await admin.locator('[data-og7="confirm-action"]').click();
            }
            await expect
              .poll(async () => JSON.stringify(await directory()))
              .toContain(name);
            const publicData = await directory();
            expect(
              publicData.sponsorships.find((s) => s.company_name === name)
            ).toMatchObject({
              amount: amountConsent ? amount : null,
              message: null,
              public_summary: publicSummary
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
          const beforeDrafts = await drafts();
          const beforeJobs = await jobs();
          for (const channel of excludedChannels) {
            const input = { contributionId, feedTarget: 'openg7', channel };
            expect(
              (
                await request.post('/api/admin/publication-drafts', {
                  data: input
                })
              ).status()
            ).toBe(401);
            // An active commitment cannot acquire an unpromised destination.
            // Replaying the refusal must preserve its existing drafts/deliveries.
            for (let attempt = 0; attempt < 2; attempt++) {
              const created = await request.post(
                '/api/admin/publication-drafts',
                { headers: await adminSessionHeaders(request), data: input }
              );
              expect(created.status()).toBe(404);
              expect(await created.json()).toEqual({
                error:
                  'Approved sponsorship was not found or publication drafts migration is missing.'
              });
              expect(await drafts()).toEqual(beforeDrafts);
              expect(await jobs()).toEqual(beforeJobs);
            }
          }
          expect(beforeJobs.map((j) => j.feedId)).toEqual(
            publicConsent && amount === 250 ? ['openg7:facebook'] : []
          );
        });

        if (publicConsent)
          await test.step('Existing legacy drafts cannot bypass final destination eligibility', async () => {
            for (const channel of excludedChannels) {
              // Model an existing unbound historical source only in the guarded
              // disposable DB; the public API must not create this new draft.
              const draftId = randomUUID();
              expect(
                await acceptanceSql<{ id: string }>(
                  `INSERT INTO sponsor_publication_drafts
                   (id,contribution_id,feed_target,channel,title,body,disclosure_text,obligation_id)
                 VALUES($1::uuid,$2::uuid,'openg7',$3,$4,$5,$6,NULL)
                 RETURNING id::text AS id`,
                  [
                    draftId,
                    contributionId,
                    channel,
                    'Merci à ' + name,
                    'Reconnaissance historique synthétique du commanditaire.',
                    'Commandite rémunérée, recette simulée.'
                  ]
                )
              ).toEqual([{ id: draftId }]);
              await post('/api/admin/publication-drafts/update', {
                draftId,
                status: 'approved',
                confirmation: draftId,
                moderationDecision: await acceptanceModerationDecision(
                  request,
                  {
                    type: 'publication_draft',
                    id: draftId
                  }
                )
              });
              const batch = (
                await post<AdminPublicationBatchMutationResult>(
                  '/api/admin/publication-batches',
                  { channel, capacity: 1 }
                )
              ).batch!;
              await post('/api/admin/publication-batches/assign', {
                batchId: batch.id,
                draftId
              });
              await approveAcceptanceSubject(request, {
                type: 'publication_draft',
                id: draftId
              });
              const beforeComposeDrafts = await drafts();
              const beforeComposeJobs = await jobs();
              const composed = await request.post(automation, {
                headers: await adminSessionHeaders(request),
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
              expect(await drafts()).toEqual(beforeComposeDrafts);
              expect(await jobs()).toEqual(beforeComposeJobs);
              // This negative fixture is outside the accepted offer. Retain its
              // history, then explicitly close both source and batch via the API.
              const closedBatch =
                await post<AdminPublicationBatchMutationResult>(
                  '/api/admin/publication-batches/cancel',
                  { batchId: batch.id, confirmation: batch.id }
                );
              expect(closedBatch).toMatchObject({
                updated: true,
                batch: { id: batch.id, status: 'cancelled' }
              });
              const closedDraft =
                await post<AdminPublicationDraftMutationResult>(
                  '/api/admin/publication-drafts/update',
                  {
                    draftId,
                    status: 'cancelled',
                    confirmation: draftId,
                    reviewNote:
                      'Synthetic legacy eligibility check completed; no publication authorized.'
                  }
                );
              expect(closedDraft).toMatchObject({
                updated: true,
                draft: { id: draftId, status: 'cancelled', batch_id: null }
              });
              expect(await jobs()).toEqual(beforeComposeJobs);
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
            const message = `${job.message}\n\nMerci à ${name}. Commandite rémunérée, recette simulée.`;
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
            const savedDraft = admin.waitForResponse(
              (response) =>
                response.url().endsWith(automation) &&
                response.request().method() === 'POST' &&
                response.request().postDataJSON()?.action === 'edit'
            );
            await dialog
              .getByRole('button', { name: 'Enregistrer le brouillon' })
              .click();
            expect((await savedDraft).ok()).toBe(true);
            await expect(
              dialog.getByRole('button', { name: 'Accepter et programmer' })
            ).toBeDisabled();
            const draft = (await jobs())[0]!;
            expect(draft.id).toBe(job.id);
            expect(draft.version).toBe(job.version + 1);
            expect(draft).toMatchObject({
              status: 'draft',
              approvedAt: null,
              attempts: 0,
              message,
              mediaId: photo.id,
              scheduledAt: date.toISOString()
            });
            const missingConfirmation = await request.post(automation, {
              headers: await adminSessionHeaders(request),
              data: { action: 'approve', id: job.id, version: draft.version }
            });
            expect(missingConfirmation.status()).toBe(400);
            expect(await missingConfirmation.json()).toMatchObject({
              code: 'CONFIRMATION_REQUIRED'
            });
            expect((await jobs())[0]).toEqual(draft);
            await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
            await dialog
              .getByRole('button', { name: 'Accepter et programmer' })
              .click();
            await completePublicationModeration(admin);
            await expect(dialog).toContainText('Autorisée');
            const authorized = (await jobs())[0]!;
            const due = new Date(authorized.scheduledAt);
            expect(due.toISOString()).toBe(date.toISOString());
            const feed = (await state()).feeds.find(
              (f) => f.id === 'openg7:facebook'
            )!;
            await command({
              action: 'settings',
              settings: { ...feed, paused: false }
            });
            await worker(true);
            await admin.close();
            await tick(new Date(due.getTime() - 1));
            expect((await jobs())[0]).toMatchObject({
              status: 'approved',
              scheduledAt: authorized.scheduledAt,
              approvedAt: authorized.approvedAt,
              version: authorized.version,
              attempts: 0,
              publishedAt: null
            });
            const beforeDue = await receipts(job.id);
            expect(beforeDue.requests).toHaveLength(0);
            expect(beforeDue.posts).toHaveLength(0);
            await expect
              .poll(
                async () => {
                  await runAcceptancePublicationWorker(due);
                  return (await jobs())[0]?.status;
                },
                { timeout: 15000, intervals: [100, 500, 1000] }
              )
              .toBe('published');
            const published = (await jobs())[0]!;
            await tick(due);
            expect((await jobs())[0]).toEqual(published);
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
                  e.action === 'publication_automation.claim'
              )
            ).toHaveLength(1);
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
          const companyEmailCount = 2 + (publicConsent ? 1 : 0);
          await expect
            .poll(async () => (await companyMails()).length, { timeout: 15000 })
            .toBe(companyEmailCount);
          const companyQueue = (
            await get<AdminEmailQueueResponse>('/api/admin/email-queue')
          ).messages.filter((m) => m.recipient_email === email);
          expect(companyQueue.map((m) => m.template_key).sort()).toEqual(
            [
              'sponsorship_invoice',
              'sponsorship_followup',
              ...Array(companyEmailCount - 2).fill('sponsorship_obligation')
            ].sort()
          );
          const updates = companyQueue.filter(
            (m) => m.template_key === 'sponsorship_obligation'
          );
          const obligations = (await sponsor()).commitment!.obligations;
          const website = obligations.find((o) => o.channel === 'website')!;
          const fulfilled = updates.filter(
            (m) => m.metadata['event'] === 'fulfilled'
          );
          expect(fulfilled).toHaveLength(publicConsent ? 1 : 0);
          if (publicConsent) {
            expect(website).toMatchObject({
              state: 'fulfilled',
              fulfilmentEvidenceId: expect.any(String)
            });
            expect(fulfilled[0]!.metadata).toMatchObject({
              contributionId,
              event: 'fulfilled',
              eventId: website.fulfilmentEvidenceId,
              obligationId: website.id,
              obligationVersion: website.version
            });
          } else {
            expect(website.fulfilmentEvidenceId).toBeNull();
          }
          const approvedDates = updates.filter(
            (m) => m.metadata['event'] === 'date_approved'
          );
          // Mock publication cannot create a promised live date or fulfilment.
          expect(approvedDates).toHaveLength(0);
          if (publicConsent && amount === 250) {
            const facebook = obligations.find((o) => o.channel === 'facebook')!;
            expect(facebook.fulfilmentEvidenceId).toBeNull();
          }
          expect(updates).toHaveLength(companyEmailCount - 2);
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
          const journey = await readPaymentJourney(request, contributionId);
          if (publicConsent && amount === 100) {
            await expectCompletedPaymentJourney(
              admin,
              request,
              contributionId,
              'controller'
            );
            const progress = await get<AdminSponsorshipProgressResponse>(
              '/api/admin/sponsorships/progress?sponsorshipId=' + contributionId
            );
            expect(progress.status).toBe('ok');
            expect(progress.dossier?.contributionId).toBe(contributionId);
            expect(progress.dossier?.next.reason).toBe('complete');
            expect(progress.dossier?.publicationCompletion).toEqual({
              done: 1,
              total: 1
            });
            await admin.screenshot({
              path: info.outputPath('website-only-admin-journey-complete.png')
            });
          } else {
            // A simulated social receipt and a missing consent cannot close promises.
            expect(journey.state).not.toBe('complete');
            expect(journey.next).not.toBeNull();
          }
          await info.attach('sponsorship-tier-evidence', {
            contentType: 'application/json',
            body: JSON.stringify(
              {
                providers: 'simulated',
                publicationWorkerClock:
                  publicConsent && amount === 250
                    ? 'controlled'
                    : 'no delivery',
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
                companyEmails: companyEmailCount,
                totals: await totals()
              },
              null,
              2
            )
          });
          expect(errors).toEqual([]);
        });
      } finally {
        await worker(false);
        await company.close();
        for (const feed of initial.feeds)
          await command({ action: 'settings', settings: feed });
        await worker(initial.workerEnabled);
      }
    });
  }
}
