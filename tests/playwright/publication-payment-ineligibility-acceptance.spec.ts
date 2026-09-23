import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import type {
  AdminAuditLogResponse,
  AdminSponsorshipRecord,
  AdminSponsorshipRefundResult,
  AdminSponsorshipsResponse,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest,
  buildStripeEvent
} from './support/stripe-webhook.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const automation = '/api/admin/publication-automation';
const cockpit = '/admin/fundraiser/publications/automation';
const feeds: PublicationFeedId[] = ['openg7:facebook', 'openg7:linkedin'];
type Scenario = 'refunded' | 'disputed' | 'paid';
interface Company {
  scenario: Scenario;
  name: string;
  record: AdminSponsorshipRecord;
  sessionId: string;
  paymentIntentId: string;
  chargeId: string;
  jobs: PublicationDelivery[];
}

test('scheduled sponsorships stop after refund or dispute while eligible control deliveries still run', async ({
  page,
  context,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(360000);
  context.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const stub = process.env.STRIPE_STUB_BASE_URL!;
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
    const job = (await state()).deliveries.find((j) => j.id === id);
    expect(job).toBeTruthy();
    return job!;
  };
  const sponsor = async (reference: string) => {
    const result = await get<AdminSponsorshipsResponse>(
      '/api/admin/sponsorships?search=' + encodeURIComponent(reference)
    );
    expect(result.items).toHaveLength(1);
    return result.items[0]!;
  };
  const media = (id: string) =>
    get<SponsorshipMediaResponse>(
      '/api/admin/sponsorships/media?contributionId=' + id
    );
  const events: Record<string, unknown>[] = [];
  const deliverEvent = async (event: Record<string, unknown>) => {
    const signed = buildSignedWebhookRequest(event);
    const response = await request.post('/api/stripe/webhook', {
      data: signed.body,
      headers: signed.headers
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  const initial = await state();
  expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
  const companies: Company[] = [];
  const buffer = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#28556e' }
  })
    .png()
    .toBuffer();
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
    await page.goto(cockpit + '?deliveryId=' + id);
    const dialog = page.getByRole('dialog', { name: 'Publication finale' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
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
    for (const scenario of ['refunded', 'disputed', 'paid'] as const) {
      await test.step(`Create a paid 500 CAD company and submitted media for ${scenario}`, async () => {
        const name = `Atelier ${scenario} ${randomUUID().slice(0, 8)}`;
        await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
        const form = page.locator('[data-og7="contribution-form"]');
        await form
          .getByRole('button', { name: /Commandite d'entreprise/ })
          .click();
        await form.getByRole('button', { name: '500 $', exact: true }).click();
        await form.getByRole('checkbox').nth(0).check();
        await form.locator('#public-display-name').fill(name);
        await form.getByRole('checkbox').nth(1).uncheck();
        await form.getByRole('checkbox').nth(2).check();
        await form.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/checkout\/cs_test_/);
        const sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
        const session = await get<{
          client_reference_id: string;
          payment_intent: string;
          metadata: Record<string, string>;
        }>(stub + '/v1/checkout/sessions/' + sessionId, false);
        await page
          .getByRole('button', { name: 'Confirmer le paiement simulé' })
          .click();
        await expect(page.locator('#followup-companyName')).toBeVisible();
        const registration = await request.post(
          stub + '/__test__/payment-intents',
          {
            data: {
              id: session.payment_intent,
              amount: 50000,
              currency: 'cad',
              fee: 0,
              metadata: session.metadata
            }
          }
        );
        expect(registration.ok()).toBe(true);
        const chargeId: string = (await registration.json()).chargeId;
        const payment = buildPaymentIntentSucceededEvent({
          eventId: 'evt_publication_payment_' + randomUUID(),
          paymentIntentId: session.payment_intent,
          chargeId,
          amountCents: 50000
        });
        events.push(payment);
        await deliverEvent(payment);
        await page.locator('#followup-companyName').fill(name);
        await page.locator('#followup-contactName').fill('Contact de recette');
        await page
          .locator('#followup-contactEmail')
          .fill('contact@simulation.example.test');
        await page
          .locator('#followup-websiteUrl')
          .fill('https://simulation.example.test');
        for (const [label, filename] of [
          ['Ajouter le logo', 'logo.png'],
          ['Ajouter des photos', 'photo.png']
        ]) {
          await page
            .getByLabel('Description des images à téléverser')
            .fill('Présentation synthétique de ' + name);
          const uploaded = page.waitForResponse(
            (r) =>
              r.url().includes('/sponsorship-followup/media') &&
              r.request().method() === 'POST'
          );
          await page
            .getByLabel(label!)
            .setInputFiles({ name: filename!, mimeType: 'image/png', buffer });
          expect((await uploaded).ok()).toBe(true);
          await expect(
            page.locator('[data-og7="media-upload-attempt"]')
          ).toHaveCount(0);
        }
        await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(
          2
        );
        await page
          .getByRole('button', {
            name: 'Soumettre mes informations à l’équipe'
          })
          .click();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: /Informations enregistrées/ })
        ).toBeVisible();
        const record = await sponsor(session.client_reference_id);
        expect(record).toMatchObject({
          payment_status: 'paid',
          sponsor_review_status: 'pending_review'
        });
        companies.push({
          scenario,
          name,
          record,
          sessionId,
          paymentIntentId: session.payment_intent,
          chargeId,
          jobs: []
        });
      });
    }
    await signInAsAdmin(page);
    await test.step('Review presentation media and prepare separate Facebook and LinkedIn proposals', async () => {
      for (const company of companies) {
        await page.goto(
          '/admin/fundraiser/sponsors?sponsorshipId=' +
            company.record.id +
            '&tab=media'
        );
        await page
          .getByRole('button', { name: 'Tout approuver', exact: true })
          .click();
        await expect
          .poll(async () =>
            (await media(company.record.id)).assets.every(
              (a) => a.reviewStatus === 'approved'
            )
          )
          .toBe(true);
      }
      for (const id of feeds) await command({ action: 'prepare', feedId: id });
      const prepared = await state();
      for (const company of companies) {
        company.jobs = prepared.deliveries.filter((j) =>
          j.sponsors.some((s) => s.id === company.record.id)
        );
        expect(company.jobs.map((j) => j.feedId).sort()).toEqual(feeds);
        expect(
          company.jobs.every(
            (j) =>
              j.status === 'draft' &&
              j.sponsors.length === 1 &&
              j.attempts === 0
          )
        ).toBe(true);
      }
    });
    // Keep all jobs on one real future deadline. No test-only clock or DB mutation.
    const due = new Date(Math.ceil((Date.now() + 120000) / 60000) * 60000);
    await test.step('Explicitly authorize the six exact publications in the browser', async () => {
      for (const company of companies) {
        for (const job of company.jobs) {
          const dialog = await openDelivery(job.id);
          await dialog
            .getByRole('button', { name: 'Modifier', exact: true })
            .click();
          await dialog
            .getByLabel('Texte exact à publier')
            .fill(
              `Merci à ${company.name}. Commandite rémunérée, recette simulée.`
            );
          const localDate = await page.evaluate((iso) => {
            const d = new Date(iso);
            return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
          }, due.toISOString());
          await dialog.locator('input[name="date"]').fill(localDate);
          // Combined sponsor acceptance authorizes the reviewed presentation;
          // these delivery proposals use text only.
          const save = page.waitForResponse(
            (r) =>
              r.url().endsWith(automation) && r.request().method() === 'POST'
          );
          await dialog
            .getByRole('button', { name: 'Enregistrer le brouillon' })
            .click();
          expect((await save).ok()).toBe(true);
          await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
          await dialog
            .getByRole('button', { name: 'Accepter et programmer' })
            .click();
          await expect(dialog).toContainText('Autorisée');
          const approved = await delivery(job.id);
          expect(approved).toMatchObject({
            status: 'approved',
            attempts: 0,
            scheduledAt: due.toISOString(),
            approvedAt: expect.any(String)
          });
          Object.assign(job, approved);
        }
      }
    });

    await test.step('Confirm the full refund and deliver the signed dispute before dispatch', async () => {
      const refund = companies.find((c) => c.scenario === 'refunded')!;
      await page.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' +
          refund.record.id +
          '&tab=refund'
      );
      await page
        .getByRole('button', { name: 'Rembourser Stripe', exact: true })
        .click();
      const panel = page.getByRole('region', { name: 'Remboursement Stripe' });
      await panel
        .getByLabel(/Texte de confirmation/)
        .fill(refund.record.public_reference!);
      await panel
        .getByRole('checkbox', {
          name: /Envoyer le courriel de remboursement/i
        })
        .uncheck();
      const pending = page.waitForResponse(
        (r) =>
          r.url().endsWith('/sponsorships/refund') &&
          r.request().method() === 'POST'
      );
      await panel
        .getByRole('button', { name: 'Rembourser Stripe', exact: true })
        .click();
      const result = await pending;
      expect(result.status(), await result.text()).toBe(200);
      const receipt = (await result.json()) as AdminSponsorshipRefundResult;
      expect(receipt).toMatchObject({
        refunded: true,
        amount: 500,
        creditNote: { total: 500 }
      });
      const charge = await get<Record<string, unknown>>(
        stub + '/v1/charges/' + refund.chargeId,
        false
      );
      const event = buildStripeEvent(
        'evt_scheduled_refund_' + randomUUID(),
        'charge.refunded',
        charge
      );
      events.push(event);
      await deliverEvent(event);

      const disputed = companies.find((c) => c.scenario === 'disputed')!;
      const dispute = buildStripeEvent(
        'evt_scheduled_dispute_' + randomUUID(),
        'charge.dispute.created',
        {
          id: 'dp_simulated_' + randomUUID(),
          object: 'dispute',
          charge: disputed.chargeId,
          payment_intent: disputed.paymentIntentId,
          amount: 50000,
          currency: 'cad',
          status: 'needs_response',
          reason: 'fraudulent'
        }
      );
      events.push(dispute);
      await deliverEvent(dispute);
      for (const company of companies) {
        expect(
          (await sponsor(company.record.public_reference!)).payment_status
        ).toBe(company.scenario);
        for (const job of company.jobs)
          expect((await delivery(job.id)).status).toBe('approved');
      }
      expect(Date.now()).toBeLessThan(due.getTime());
    });

    const invalid = companies.filter((c) => c.scenario !== 'paid');
    const control = companies.find((c) => c.scenario === 'paid')!;
    await test.step('The worker revokes ineligible approvals before their due date', async () => {
      for (const id of feeds) {
        const feed = (await state()).feeds.find((f) => f.id === id)!;
        await command({
          action: 'settings',
          settings: { ...feed, paused: false }
        });
      }
      await page.goto(cockpit);
      await page.locator('[data-og7="publication-worker-toggle"]').click();
      await page.locator('[data-og7="confirm-action"]').click();
      await expect(
        page.locator('[data-og7="publication-worker-toggle"]')
      ).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(
          async () => {
            const current = await state();
            return invalid
              .flatMap((c) => c.jobs)
              .every(
                (j) =>
                  current.deliveries.find((d) => d.id === j.id)?.status ===
                  'blocked'
              );
          },
          { timeout: 45000, intervals: [1000, 2000] }
        )
        .toBe(true);
      expect(Date.now()).toBeLessThan(due.getTime());
      for (const company of invalid) {
        for (const job of company.jobs) {
          expect(await delivery(job.id)).toMatchObject({
            status: 'blocked',
            errorCode: 'SOURCE_NOT_ELIGIBLE',
            approvedAt: null,
            attempts: 0,
            publishedAt: null,
            externalPostId: null,
            version: job.version + 1
          });
          const current = await delivery(job.id);
          expect(current.sponsors[0]).toMatchObject({
            id: company.record.id,
            paymentStatus: company.scenario
          });
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
          expect(await stale.json()).toMatchObject({
            code: 'VERSION_CONFLICT'
          });
          const fresh = await request.post(automation, {
            headers,
            data: {
              action: 'approve',
              id: job.id,
              version: current.version,
              confirmation: job.id
            }
          });
          expect(fresh.status()).toBe(409);
          expect(await fresh.json()).toMatchObject({
            code: 'APPROVAL_UNAVAILABLE'
          });
        }
        const dialog = await openDelivery(company.jobs[0]!.id);
        const reason = dialog.locator(
          '[data-og7="publication-payment-blocker"]'
        );
        await expect(reason).toContainText(
          company.scenario === 'refunded'
            ? 'Le paiement a été remboursé'
            : 'Le paiement fait l’objet d’une contestation'
        );
        await expect(
          dialog.getByRole('button', { name: 'Accepter et programmer' })
        ).toHaveCount(0);
        await dialog.screenshot({
          path: info.outputPath(company.scenario + '-blocked.png')
        });
        await reason.getByRole('link', { name: company.name }).click();
        await expect(page).toHaveURL(
          new RegExp('sponsorshipId=' + company.record.id)
        );
        await expect(
          page
            .locator('openg7-admin-sponsor-detail-header')
            .getByText(
              company.scenario === 'refunded' ? 'Rembourse' : 'Litige',
              { exact: true }
            )
        ).toBeVisible();
      }
      for (const job of control.jobs)
        expect((await delivery(job.id)).status).toBe('approved');
    });

    await test.step('After the deadline only the eligible control sends, with the browser closed', async () => {
      await page.close();
      await expect
        .poll(
          async () => {
            const current = await state();
            return control.jobs.every(
              (j) =>
                current.deliveries.find((d) => d.id === j.id)?.status ===
                'published'
            );
          },
          { timeout: 210000, intervals: [1000, 3000] }
        )
        .toBe(true);
      for (const job of control.jobs)
        expect(await delivery(job.id)).toMatchObject({
          attempts: 1,
          mode: 'mock',
          externalPostId: 'mock-' + job.id,
          publishedAt: expect.any(String)
        });
      // Re-deliver both financial facts and earlier successes. A late payment
      // confirmation must never restore an invalidated publication authorization.
      for (const event of [...events].reverse()) await deliverEvent(event);
      for (const company of companies) {
        expect(
          (
            await request.post(stub + '/__test__/checkout-delivery', {
              data: { sessionId: company.sessionId, action: 'deliver' }
            })
          ).ok()
        ).toBe(true);
        expect(
          (await sponsor(company.record.public_reference!)).payment_status
        ).toBe(company.scenario);
      }
      for (const company of invalid)
        for (const job of company.jobs)
          expect(await delivery(job.id)).toMatchObject({
            status: 'blocked',
            attempts: 0,
            approvedAt: null,
            externalPostId: null,
            publishedAt: null,
            version: job.version + 1
          });
      const audit = await get<AdminAuditLogResponse>('/api/admin/audit-log');
      const evidence = audit.entries.filter((e) =>
        companies.some((c) => c.jobs.some((j) => j.id === e.entity_id))
      );
      for (const company of invalid)
        for (const job of company.jobs) {
          const entries = evidence.filter((e) => e.entity_id === job.id);
          const invalidations = entries.filter(
            (e) => e.action === 'publication_automation.source_invalidated'
          );
          expect(invalidations).toHaveLength(1);
          expect(invalidations[0]).toMatchObject({
            actor: 'publication-worker',
            metadata: {
              codes: ['PAYMENT_REQUIRED'],
              affected: [company.record.id]
            }
          });
          expect(
            entries.some((e) =>
              [
                'publication_automation.claim',
                'publication_automation.published'
              ].includes(e.action)
            )
          ).toBe(false);
        }
      for (const job of control.jobs)
        expect(
          evidence.filter(
            (e) =>
              e.entity_id === job.id &&
              e.action === 'publication_automation.published'
          )
        ).toHaveLength(1);
      await info.attach('publication-payment-ineligibility-evidence', {
        body: JSON.stringify(
          {
            providers: 'simulated',
            deadline: due,
            companies: companies.map(({ scenario, record }) => ({
              scenario,
              contributionId: record.id
            })),
            deliveries: (await state()).deliveries.filter((d) =>
              companies.some((c) => c.jobs.some((j) => j.id === d.id))
            ),
            audit: evidence
          },
          null,
          2
        ),
        contentType: 'application/json'
      });
      expect(errors).toEqual([]);
    });
  } finally {
    await setWorker(false);
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
      });
    }
    await setWorker(initial.workerEnabled);
  }
});
