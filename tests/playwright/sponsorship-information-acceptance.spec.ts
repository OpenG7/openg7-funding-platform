import { createHash, randomUUID } from 'node:crypto';

import sharp from 'sharp';
import type { Page } from '@playwright/test';
import type {
  AdminAssistantContextResponse,
  AdminAuditLogResponse,
  AdminEmailQueueResponse,
  AdminInformationRequest,
  AdminInformationRequestResult,
  AdminSponsorshipDetailsRequest,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipsResponse,
  FundTransparencyPublicResponse,
  PublicationAutomationState,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { runAcceptanceReviewReminder } from './support/acceptance-review-reminder.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const requestUrl = '/api/admin/sponsorships/request-information';
const detailsUrl = '/api/admin/sponsorships/details';
interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}
interface MailContent {
  Text: string;
  HTML: string;
}

test('incomplete paid dossier: confirmed contact correction, stale request refusal, captured information email, company completion and daily review reminder', async ({
  page: admin,
  context,
  request,
  baseURL
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(180000);
  context.setDefaultTimeout(15000);
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const name = 'Dossier à compléter ' + randomUUID().slice(0, 8);
  const paymentEmail = `payer-${randomUUID()}@simulation.example.test`;
  const oldContact = `old-${randomUUID()}@simulation.example.test`;
  const currentContact = `current-${randomUUID()}@simulation.example.test`;
  const privateNote = 'Note privée de la recette de demande d’informations.';
  const body =
    'Bonjour, merci de soumettre votre fiche et une photo de présentation via votre lien de suivi initial.';
  const errors: string[] = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  const get = async <T>(url: string, auth = true): Promise<T> => {
    const r = await request.get(url, auth ? { headers } : {});
    expect(r.ok(), url).toBe(true);
    return r.json();
  };
  const queue = () => get<AdminEmailQueueResponse>('/api/admin/email-queue');
  const mails = async () =>
    (await get<{ messages: Mail[] }>(stub + '/__test__/mail', false)).messages;
  const content = (mail: Mail) =>
    get<MailContent>(stub + '/__test__/mail/' + mail.ID, false);
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
  let reference = '';
  let id = '';
  let sessionId = '';
  const sponsor = async () => {
    const result = await get<AdminSponsorshipsResponse>(
      '/api/admin/sponsorships?search=' + reference
    );
    expect(result.items).toHaveLength(1);
    return result.items[0]!;
  };
  const assistant = () =>
    get<AdminAssistantContextResponse>(
      '/api/admin/assistant/context?sponsorshipId=' + id
    );
  const informationMessages = async () =>
    (await queue()).messages.filter(
      (m) =>
        m.template_key === 'sponsorship_information_request' &&
        m.metadata['contributionId'] === id
    );
  const audit = async () =>
    (await get<AdminAuditLogResponse>('/api/admin/audit-log')).entries.filter(
      (e) => e.entity_id === id
    );
  const invoices = async () =>
    (
      await get<AdminSponsorshipInvoicesResponse>(
        '/api/admin/sponsorship-invoices?contributionId=' + id
      )
    ).invoices;
  const media = async () =>
    (
      await get<SponsorshipMediaResponse>(
        '/api/admin/sponsorships/media?contributionId=' + id
      )
    ).assets;
  const publicData = () => get('/api/public/sponsorships', false);
  const originalTotals = await totals();
  const company = await context.newPage();
  company.on('pageerror', (e) => errors.push(e.message));
  await company.setViewportSize({ width: 390, height: 844 });
  const otherAdmin = await context.newPage();
  otherAdmin.on('pageerror', (e) => errors.push(e.message));
  let originalInvoice: unknown;
  let pdfHash = '';
  const invoiceSnapshot = async () => {
    const invoice = (await invoices())[0]!;
    return Object.fromEntries(
      Object.entries(invoice).filter(([key]) => !key.startsWith('last_email_'))
    );
  };
  const assertFinance = async () => {
    expect(await invoices()).toHaveLength(1);
    expect(await invoiceSnapshot()).toEqual(originalInvoice);
    expect(await totals()).toEqual({
      received: originalTotals.received + 25000,
      count: originalTotals.count + 1
    });
    expect(await sponsor()).toMatchObject({
      amount: 250,
      currency: 'CAD',
      payment_status: 'paid'
    });
  };
  const correct = async (page: Page, email: string) => {
    await page.goto('/admin/fundraiser/sponsors?sponsorshipId=' + id);
    await page.locator('[data-og7="edit-dossier"]').click();
    const form = page.locator('[data-og7="edit-dossier-form"]');
    await form.locator('[name="companyName"]').fill(name);
    await form.locator('[name="contactName"]').fill('Contact de recette');
    await form.locator('[name="contactEmail"]').fill(email);
    await form
      .locator('[name="websiteUrl"]')
      .fill('https://simulation.example.test');
    await form.locator('[name="reason"]').selectOption('contact_update');
    await form
      .getByRole('button', { name: 'Enregistrer les modifications' })
      .click();
    const confirmation = page
      .getByRole('dialog')
      .filter({ has: page.locator('[data-og7="confirm-action"]') });
    await expect(confirmation).toContainText(email);
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    expect((await sponsor()).sponsor_contact_email).not.toBe(email);
    await form
      .getByRole('button', { name: 'Enregistrer les modifications' })
      .click();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith(detailsUrl) && r.request().method() === 'POST'
    );
    await page.locator('[data-og7="confirm-action"]').click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    await expect(form).toBeHidden();
    expect((await sponsor()).sponsor_contact_email).toBe(email);
    return response.request().postDataJSON() as AdminSponsorshipDetailsRequest;
  };
  const openRequest = async () => {
    await admin.goto('/admin/fundraiser/assistant?sponsorshipId=' + id);
    await expect(
      admin.locator('[data-og7="assistant-next-step"]')
    ).toContainText('Compléter les informations');
    await admin
      .getByRole('button', { name: 'Demander des informations', exact: true })
      .click();
    await expect(admin.locator('[data-og7="assistant-draft"]')).toContainText(
      'Brouillon non envoyé'
    );
    await admin.getByLabel('Message', { exact: true }).fill(body);
  };
  const remind = async (now: Date) => {
    const prior = (await mails()).map((m) => m.ID);
    const result = await runAcceptanceReviewReminder(now);
    expect(result.error).toBeNull();
    if (!result.messageId) {
      expect(result.skippedReason).toBe('nothing_due');
      return null;
    }
    await expect
      .poll(
        async () =>
          (await queue()).messages.find((m) => m.id === result.messageId)
            ?.status
      )
      .toBe('sent');
    const message = (await queue()).messages.find(
      (m) => m.id === result.messageId
    )!;
    await expect
      .poll(
        async () =>
          (await mails()).filter(
            (m) => m.Subject === message.subject && !prior.includes(m.ID)
          ).length
      )
      .toBe(1);
    const captured = (await mails()).find(
      (m) => m.Subject === message.subject && !prior.includes(m.ID)
    )!;
    return { ...result, mail: captured, content: await content(captured) };
  };
  const day = 86400000;
  const time = new Date();
  try {
    await test.step('A signed payment creates the invoice while the unsubmitted dossier stays incomplete', async () => {
      await signInAsAdmin(admin);
      await signInAsAdmin(otherAdmin);
      await company.goto('/fonds-des-batisseurs?intent=sponsorship#support');
      const form = company.locator('[data-og7="contribution-form"]');
      await form.getByRole('button', { name: '250 $', exact: true }).click();
      await form.getByRole('checkbox').nth(0).check();
      await form.locator('#public-display-name').fill(name);
      await form.getByRole('checkbox').nth(2).check();
      await form.locator('button[type="submit"]').click();
      await expect(company).toHaveURL(/\/checkout\/cs_test_/);
      sessionId = new URL(company.url()).pathname.split('/').at(-1)!;
      reference = (
        await get<{ client_reference_id: string }>(
          stub + '/v1/checkout/sessions/' + sessionId,
          false
        )
      ).client_reference_id;
      await company.getByLabel('Courriel simulé').fill(paymentEmail);
      await company
        .getByRole('button', { name: 'Confirmer le paiement simulé' })
        .click();
      await expect(company.locator('#followup-companyName')).toBeVisible();
      id = (await sponsor()).id;
      originalInvoice = await invoiceSnapshot();
      const pdf = await request.get(
        '/api/admin/sponsorship-invoices/pdf?invoiceId=' +
          (await invoices())[0]!.id,
        { headers }
      );
      expect(pdf.ok()).toBe(true);
      pdfHash = createHash('sha256')
        .update(await pdf.body())
        .digest('hex');
      expect((await sponsor()).sponsor_details_submitted_at).toBeNull();
      expect((await assistant()).context?.nextStep).toBe(
        'complete_information'
      );
      expect(JSON.stringify(await publicData())).not.toContain(name);
      await assertFinance();
      await company.goto('about:blank');
    });

    let correction: AdminSponsorshipDetailsRequest;
    await test.step('The administrator corrects contact details with confirmation and an immutable invoice', async () => {
      correction = await correct(otherAdmin, oldContact);
      expect(
        (await audit()).filter((e) => e.action === 'sponsorship.details.update')
      ).toHaveLength(1);
      expect(await informationMessages()).toHaveLength(0);
      expect((await sponsor()).sponsor_review_status).toBe('pending_review');
      await assertFinance();
      const replay = await request.post(detailsUrl, {
        headers,
        data: correction
      });
      expect(replay.ok()).toBe(true);
      expect(
        (await audit()).filter((e) => e.action === 'sponsorship.details.update')
      ).toHaveLength(1);
      const noConfirmation = await request.post(detailsUrl, {
        headers,
        data: { ...correction, confirmed: false }
      });
      expect(noConfirmation.status()).toBe(400);
      expect(
        (await request.post(detailsUrl, { data: correction })).status()
      ).toBe(401);
      expect(
        (
          await request.post(detailsUrl, {
            headers,
            data: { ...correction, contactEmail: currentContact }
          })
        ).status()
      ).toBe(409);
    });

    await test.step('A contact change invalidates an already prepared information request', async () => {
      await openRequest();
      await expect(
        admin.getByLabel('Destinataire', { exact: true })
      ).toHaveValue(oldContact);
      await correct(otherAdmin, currentContact);
      await admin.getByRole('button', { name: 'Vérifier l’envoi' }).click();
      const rejected = admin.waitForResponse((r) =>
        r.url().endsWith(requestUrl)
      );
      await admin
        .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
        .click();
      expect((await rejected).status()).toBe(409);
      await expect(admin.getByRole('alert')).toContainText(
        'Le dossier a changé'
      );
      expect(await informationMessages()).toHaveLength(0);
      expect(
        (await mails()).some((m) => m.To.some((r) => r.Address === oldContact))
      ).toBe(false);
      await assertFinance();
    });

    let sentRequest: AdminInformationRequest;
    let informationMessageId = '';
    await test.step('The reviewed request is captured once at the current address and audited without private content', async () => {
      await openRequest();
      await expect(
        admin.getByLabel('Destinataire', { exact: true })
      ).toHaveValue(currentContact);
      const review = admin.getByRole('button', { name: 'Vérifier l’envoi' });
      await review.click();
      await expect(admin.getByRole('dialog')).toContainText(currentContact);
      await expect(admin.getByRole('dialog')).toContainText(body);
      await admin.keyboard.press('Escape');
      await expect(review).toBeFocused();
      expect(await informationMessages()).toHaveLength(0);
      await review.click();
      const sent = admin.waitForResponse((r) => r.url().endsWith(requestUrl));
      await admin
        .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
        .click();
      const response = await sent;
      expect(response.ok()).toBe(true);
      sentRequest = response
        .request()
        .postDataJSON() as AdminInformationRequest;
      informationMessageId = (
        (await response.json()) as AdminInformationRequestResult
      ).messageId;
      await expect(
        admin.getByRole('link', { name: 'Suivre le courriel' })
      ).toHaveAttribute(
        'href',
        '/admin/fundraiser/email-queue?messageId=' + informationMessageId
      );
      const noConfirmation = await request.post(requestUrl, {
        headers,
        data: { ...sentRequest, confirmed: false }
      });
      expect(noConfirmation.status()).toBe(400);
      expect(
        (await request.post(requestUrl, { data: sentRequest })).status()
      ).toBe(401);
      const replays = await Promise.all(
        [1, 2].map(() =>
          request.post(requestUrl, { headers, data: sentRequest })
        )
      );
      for (const replay of replays) {
        expect(replay.ok()).toBe(true);
        expect((await replay.json()).messageId).toBe(informationMessageId);
      }
      await expect
        .poll(async () => (await informationMessages())[0]?.status)
        .toBe('sent');
      expect(await informationMessages()).toHaveLength(1);
      await expect
        .poll(
          async () =>
            (await mails()).filter((m) =>
              m.To.some((r) => r.Address === currentContact)
            ).length
        )
        .toBe(1);
      const received = (await mails()).find((m) =>
        m.To.some((r) => r.Address === currentContact)
      )!;
      expect((await content(received)).Text).toContain(body);
      expect(
        (await mails()).some((m) => m.To.some((r) => r.Address === oldContact))
      ).toBe(false);
      const auditEntries = await audit();
      expect(
        auditEntries.filter(
          (e) => e.action === 'sponsorship.request_information'
        )
      ).toHaveLength(1);
      expect(
        auditEntries.filter((e) => e.action === 'sponsorship.details.update')
      ).toHaveLength(2);
      for (const secret of [oldContact, currentContact, body, privateNote])
        expect(JSON.stringify(auditEntries)).not.toContain(secret);
      await admin.getByRole('link', { name: 'Suivre le courriel' }).click();
      await expect(
        admin.getByRole('row').filter({ hasText: currentContact })
      ).toContainText('Envoy');
      await admin.screenshot({
        path: info.outputPath('information-message-sent.png'),
        fullPage: true
      });
    });

    await test.step('An incomplete dossier is excluded even when the reminder clock is advanced', async () => {
      const early = await remind(new Date(time.getTime() + day * 2));
      if (early) expect(early.content.Text).not.toContain(reference);
    });

    await test.step('The company uses its original captured follow-up link and submits the missing fiche and photo', async () => {
      const followupMessage = (await queue()).messages.find(
        (m) =>
          m.template_key === 'sponsorship_followup' &&
          m.recipient_email === paymentEmail
      )!;
      expect(followupMessage).toBeTruthy();
      const received = (await mails()).find(
        (m) =>
          m.Subject === followupMessage.subject &&
          m.To.some((r) => r.Address === paymentEmail)
      )!;
      const text = (await content(received)).Text;
      const link = (text.match(/https?:\/\/[^\s<>]+/g) ?? []).find((u) =>
        new URL(u).pathname.endsWith('/suivi-commandite')
      )!;
      expect(new URL(link).origin).toBe(baseURL);
      await company.goto(link);
      await expect(company.locator('#followup-companyName')).toHaveValue(name);
      await expect(company.locator('#followup-contactEmail')).toHaveValue(
        currentContact
      );
      await expect(company).not.toHaveURL(/token=/);
      await company.locator('#followup-message').fill(privateNote);
      const buffer = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#28556e' }
      })
        .png()
        .toBuffer();
      await company
        .getByLabel('Description des images à téléverser')
        .fill('Présentation synthétique du dossier.');
      await company.getByLabel('Ajouter des photos').setInputFiles({
        name: 'presentation.png',
        mimeType: 'image/png',
        buffer
      });
      await expect(
        company.locator('[data-og7="media-upload-attempt"]')
      ).toHaveCount(0, { timeout: 15000 });
      await expect.poll(async () => (await media()).length).toBe(1);
      expect((await media())[0]).toMatchObject({
        kind: 'supporting_image',
        reviewStatus: 'pending_review',
        uploadedBy: 'sponsor',
        altText: 'Présentation synthétique du dossier.',
        publicUrl: null
      });
      await company
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      await expect(
        company
          .getByRole('status')
          .filter({ hasText: /Informations enregistrées/ })
      ).toBeVisible();
      expect((await sponsor()).sponsor_details_submitted_at).toBeTruthy();
      expect((await assistant()).context?.canRequestInformation).toBe(false);
      expect((await sponsor()).sponsor_review_status).toBe('pending_review');
      expect(JSON.stringify(await publicData())).not.toContain(name);
      const repeat = await request.post(requestUrl, {
        headers,
        data: sentRequest
      });
      expect(repeat.ok()).toBe(true);
      expect((await repeat.json()).messageId).toBe(informationMessageId);
      expect(
        (
          await request.post(requestUrl, {
            headers,
            data: {
              ...sentRequest,
              subject: 'Nouvelle demande devenue inutile'
            }
          })
        ).status()
      ).toBe(409);
      await assertFinance();
    });

    await test.step('An aged complete dossier enters one daily reminder; the captured link leads back to a protected review', async () => {
      const submitted = new Date(
        (await sponsor()).sponsor_details_submitted_at!
      );
      const tooSoon = await remind(new Date(submitted.getTime() + 60000));
      if (tooSoon) expect(tooSoon.content.Text).not.toContain(reference);
      const due = new Date(submitted.getTime() + 3 * day);
      const reminder = await remind(due);
      expect(reminder).toBeTruthy();
      expect(reminder!.content.Text).toContain(reference);
      for (const secret of [
        paymentEmail,
        currentContact,
        privateNote,
        'token='
      ])
        expect(reminder!.content.Text).not.toContain(secret);
      const link = reminder!.content.HTML.match(/href="([^"]+)"/i)?.[1];
      expect(link).toBe(baseURL + '/admin/fundraiser/sponsors');
      await info.attach('captured-review-reminder.html', {
        body: reminder!.content.HTML,
        contentType: 'text/html'
      });
      const mailCount = (await mails()).length;
      const repeats = await Promise.all([
        runAcceptanceReviewReminder(due),
        runAcceptanceReviewReminder(due)
      ]);
      expect(
        repeats.every((r) => r.duplicate && r.messageId === reminder!.messageId)
      ).toBe(true);
      expect((await mails()).length).toBe(mailCount);
      await company.goto(link!);
      await expect(company).toHaveURL(/\/admin\/login/);
      await admin.goto(link!);
      await admin.getByLabel('Recherche', { exact: true }).fill(reference);
      await admin.getByRole('button', { name: new RegExp(name) }).click();
      await admin.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' + id + '&tab=media'
      );
      await admin
        .getByRole('button', { name: 'Tout approuver', exact: true })
        .click();
      await expect
        .poll(async () =>
          (await media()).every((m) => m.reviewStatus === 'approved')
        )
        .toBe(true);
      await admin
        .getByRole('button', { name: 'Accepter', exact: true })
        .click();
      await expect
        .poll(async () => (await sponsor()).sponsor_review_status)
        .toBe('approved');
      const after = await remind(new Date(submitted.getTime() + 4 * day));
      if (after) expect(after.content.Text).not.toContain(reference);
      const jobs = (
        await get<PublicationAutomationState>(
          '/api/admin/publication-automation'
        )
      ).deliveries.filter((d) => d.sponsors.some((s) => s.id === id));
      expect(jobs.every((d) => d.approvedAt === null && d.attempts === 0)).toBe(
        true
      );
      await assertFinance();
      const pdf = await request.get(
        '/api/admin/sponsorship-invoices/pdf?invoiceId=' +
          (await invoices())[0]!.id,
        { headers }
      );
      expect(pdf.ok()).toBe(true);
      expect(
        createHash('sha256')
          .update(await pdf.body())
          .digest('hex')
      ).toBe(pdfHash);
      const replay = await request.post(stub + '/__test__/checkout-delivery', {
        data: { sessionId, action: 'deliver' }
      });
      expect(replay.ok()).toBe(true);
      await assertFinance();
      expect(await informationMessages()).toHaveLength(1);
      await info.attach('information-and-review-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            providers: 'simulated',
            reminderClock: 'injected; dossier/payment timestamps unchanged',
            contributionId: id,
            reference,
            informationMessageId,
            reminderMessageId: reminder!.messageId,
            corrections: (await audit()).filter(
              (e) => e.action === 'sponsorship.details.update'
            ).length,
            invoiceUnchanged: true,
            review: (await sponsor()).sponsor_review_status
          },
          null,
          2
        )
      });
      expect(errors).toEqual([]);
    });
  } finally {
    await company.close();
    await otherAdmin.close();
  }
});
