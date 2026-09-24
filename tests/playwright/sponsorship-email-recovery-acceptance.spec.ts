import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { BrowserContext } from '@playwright/test';
import type {
  AdminAuditLogResponse,
  AdminEmailQueueMessageRecord,
  AdminEmailQueueResponse,
  AdminSponsorshipsResponse,
  PublicationAutomationState,
  SponsorshipDraftSnapshot
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const queueUrl = '/api/admin/email-queue';
const followupUrl = '/fonds-des-batisseurs/suivi-commandite';
interface CapturedMail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

test('paid company recovers its saved dossier from a captured email after SMTP failure, restart and concurrent admin retry', async ({
  page: admin,
  context,
  playwright,
  baseURL,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(240000);
  context.setDefaultTimeout(15000);
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const companyName = `Atelier accès ${randomUUID().slice(0, 8)}`;
  const paymentEmail = `payer-${randomUUID().slice(0, 8)}@simulation.example.test`;
  const contactEmail = `contact-${randomUUID().slice(0, 8)}@simulation.example.test`;
  const note = 'Brouillon privé conservé pendant la panne courriel.';
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  const newCompanyBrowser = async () => {
    const profile = await mkdtemp(join(tmpdir(), 'og7-email-recovery-'));
    const browser = await playwright.chromium.launchPersistentContext(profile, {
      baseURL,
      viewport: { width: 390, height: 844 }
    });
    browser.setDefaultTimeout(15000);
    contexts.push(browser);
    const page = browser.pages()[0] ?? (await browser.newPage());
    page.on('pageerror', (e) => errors.push(e.message));
    return { browser, page };
  };
  const get = async <T>(url: string, authenticated = true): Promise<T> => {
    const response = await request.get(url, authenticated ? { headers } : {});
    expect(response.ok(), url).toBe(true);
    return response.json() as Promise<T>;
  };
  const gate = async (mode: 'allow' | 'reject' | 'hold') => {
    expect(
      (await request.post(stub + '/__test__/smtp', { data: { mode } })).ok()
    ).toBe(true);
  };
  const smtp = () =>
    get<{
      mode: string;
      held: number;
      connections: number;
      rejected: number;
      forwarded: number;
    }>(stub + '/__test__/smtp', false);
  const queue = () => get<AdminEmailQueueResponse>(queueUrl);
  const recoveryMessages = async () =>
    (await queue()).messages.filter(
      (m) =>
        m.template_key === 'sponsorship_access_recovery' &&
        m.recipient_email === paymentEmail
    );
  const captured = async (subject: string) =>
    (
      await get<{ messages: CapturedMail[] }>(stub + '/__test__/mail', false)
    ).messages.filter(
      (m) =>
        m.Subject === subject &&
        m.To.some((recipient) => recipient.Address === paymentEmail)
    );
  let contributionId = '';
  let message: AdminEmailQueueMessageRecord;
  let savedDraft: SponsorshipDraftSnapshot;
  let link = '';
  const sponsor = async () => {
    const records = await get<AdminSponsorshipsResponse>(
      '/api/admin/sponsorships?search=' + contributionId
    );
    expect(records.items).toHaveLength(1);
    return records.items[0]!;
  };
  const currentMessage = async () => {
    const response = await get<AdminEmailQueueResponse>(
      queueUrl + '?messageId=' + message.id
    );
    expect(response.messages).toHaveLength(1);
    return response.messages[0]!;
  };
  try {
    await gate('allow');
    await signInAsAdmin(admin);
    const company = await newCompanyBrowser();
    await test.step('Pay 500 CAD, save an incomplete private draft and close the browser', async () => {
      await company.page.goto(
        '/fonds-des-batisseurs?intent=sponsorship#support'
      );
      const form = company.page.locator('[data-og7="contribution-form"]');
      await form
        .getByRole('button', { name: /Commandite d'entreprise/ })
        .click();
      await form.getByRole('button', { name: '500 $', exact: true }).click();
      await form.getByRole('checkbox').nth(0).check();
      await form.locator('#public-display-name').fill(companyName);
      await form.getByRole('checkbox').nth(1).uncheck();
      await form.getByRole('checkbox').nth(2).check();
      await form.locator('button[type="submit"]').click();
      await expect(company.page).toHaveURL(/\/checkout\/cs_test_/);
      const sessionId = new URL(company.page.url()).pathname.split('/').at(-1)!;
      const session = await get<{ client_reference_id: string }>(
        stub + '/v1/checkout/sessions/' + sessionId,
        false
      );
      contributionId = session.client_reference_id;
      await company.page.getByLabel('Courriel simulé').fill(paymentEmail);
      await company.page
        .getByRole('button', { name: 'Confirmer le paiement simulé' })
        .click();
      await expect(company.page.locator('#followup-companyName')).toBeVisible();
      await company.page.locator('#followup-companyName').fill(companyName);
      await company.page.locator('#followup-contactEmail').fill(contactEmail);
      const save = company.page.waitForResponse(
        (r) =>
          r.url().endsWith('/sponsorship-followup/draft') &&
          r.request().method() === 'POST'
      );
      await company.page.locator('#followup-message').fill(note);
      savedDraft = (await (await save).json()) as SponsorshipDraftSnapshot;
      await expect(
        company.page.locator('[data-og7="followup-draft-status"]')
      ).toContainText('Brouillon enregistré');
      expect(savedDraft.data).toMatchObject({
        companyName,
        contactEmail,
        message: note,
        contactName: ''
      });
      expect(await sponsor()).toMatchObject({
        amount: 500,
        currency: 'CAD',
        payment_status: 'paid',
        sponsor_details_submitted_at: null
      });
      contributionId = (await sponsor()).id;
      await company.browser.close();
      // Drain unrelated payment/invoice notifications before injecting the outage.
      await expect
        .poll(
          async () =>
            (await queue()).messages.filter(
              (m) =>
                m.status === 'sending' ||
                (m.status === 'queued' &&
                  new Date(m.next_attempt_at).getTime() <= Date.now())
            ).length,
          { timeout: 30000 }
        )
        .toBe(0);
    });
    const recovery = await newCompanyBrowser();
    await test.step('A lost link leads to a uniform recovery response; SMTP failure stays visible to the admin', async () => {
      await gate('reject');
      await recovery.page.goto(followupUrl + '?token=invalid');
      await expect(recovery.page.locator('#followup-companyName')).toHaveCount(
        0
      );
      const panel = recovery.page.locator('[data-og7="followup-recovery"]');
      const statuses: string[] = [];
      for (const email of [
        contactEmail,
        'unknown@simulation.example.test',
        paymentEmail
      ]) {
        await panel.getByRole('textbox').fill(email);
        const received = recovery.page.waitForResponse((r) =>
          r.url().endsWith('/sponsorship-followup/recover')
        );
        await panel
          .getByRole('button', { name: 'Recevoir un nouveau lien de suivi' })
          .click();
        const response = await received;
        expect(response.status()).toBe(202);
        expect(await response.json()).toEqual({ accepted: true });
        await expect(panel.getByRole('status')).toContainText(
          'Si une commandite correspond'
        );
        statuses.push((await panel.getByRole('status').textContent())!);
        if (email !== paymentEmail)
          expect(await recoveryMessages()).toHaveLength(0);
      }
      expect(new Set(statuses).size).toBe(1);
      await expect
        .poll(async () => (await recoveryMessages())[0]?.status)
        .toBe('failed');
      expect(await recoveryMessages()).toHaveLength(1);
      message = (await recoveryMessages())[0]!;
      expect(message).toMatchObject({
        attempts: 1,
        status: 'failed',
        sent_at: null
      });
      expect(message.last_error).toMatch(/^EMAIL_/);
      expect(await captured(message.subject)).toHaveLength(0);
      // Repeated public requests keep the same logical message and token.
      await Promise.all(
        [1, 2].map(async () => {
          const response = await request.post(
            '/api/sponsorship-followup/recover',
            { data: { email: paymentEmail } }
          );
          expect(response.status()).toBe(202);
          expect(await response.json()).toEqual({ accepted: true });
        })
      );
      expect(await recoveryMessages()).toHaveLength(1);
      await admin.goto('/admin/fundraiser/email-queue?messageId=' + message.id);
      const row = admin.getByRole('row').filter({ hasText: paymentEmail });
      await expect(row).toContainText('Echec');
      await row.getByRole('button', { name: 'Relancer', exact: true }).click();
      await expect(admin.getByRole('dialog')).toContainText(paymentEmail);
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: 'Annuler', exact: true })
        .filter({ hasText: 'Annuler' })
        .click();
      expect((await currentMessage()).attempts).toBe(1);
      await admin.screenshot({
        path: info.outputPath('email-recovery-failed.png'),
        fullPage: true
      });
      // Admin resend uses the authoritative payment address and preserves the
      // recent failed message during its documented one-minute grouping window.
      await admin.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' + contributionId
      );
      const accessPanel = admin.locator('[data-og7="admin-followup-access"]');
      await accessPanel.getByRole('button').click();
      await expect(admin.getByRole('dialog')).toContainText(paymentEmail);
      await admin.locator('[data-og7="confirm-action"]').click();
      await expect(accessPanel.getByRole('status')).toContainText(/échoué/i);
      expect(await recoveryMessages()).toHaveLength(1);
    });
    await test.step('Restart the isolated API and preserve the draft, failed message and retry backoff', async () => {
      const before = await currentMessage();
      const project = process.env.COMPOSE_PROJECT_NAME!;
      expect(project).toMatch(/^og7-acceptance-[a-f0-9-]+$/);
      expect(process.env.COMPOSE_FILE).toBe(
        resolve('docker-compose.acceptance.yml')
      );
      await promisify(execFile)(
        'docker',
        ['compose', '--project-name', project, 'restart', 'api'],
        { windowsHide: true, timeout: 60000 }
      );
      await expect
        .poll(
          async () => {
            try {
              return (await request.get(queueUrl, { headers })).status();
            } catch {
              return 0;
            }
          },
          { timeout: 45000, intervals: [1000] }
        )
        .toBe(200);
      expect(await currentMessage()).toMatchObject({
        status: 'failed',
        attempts: 1,
        next_attempt_at: before.next_attempt_at
      });
      expect(new Date(before.next_attempt_at).getTime()).toBeGreaterThan(
        Date.now()
      );
      // The real one-minute backoff expires after restart: a second rejected
      // greeting proves that the resumed worker consumes the persistent queue.
      await expect
        .poll(
          async () => {
            const current = await currentMessage();
            return { status: current.status, attempts: current.attempts };
          },
          { timeout: 75000, intervals: [1000] }
        )
        .toEqual({ status: 'failed', attempts: 2 });
      expect(
        new Date((await currentMessage()).next_attempt_at).getTime()
      ).toBeGreaterThan(new Date(before.next_attempt_at).getTime());
      expect(await captured(message.subject)).toHaveLength(0);
    });
    await test.step('Two concurrent admin retries and the worker leave one accepted email', async () => {
      await admin.goto('/admin/fundraiser/email-queue?messageId=' + message.id);
      const row = admin.getByRole('row').filter({ hasText: paymentEmail });
      await expect(row).toContainText('Echec');
      expect(
        (
          await request.post(queueUrl + '/retry', {
            data: { messageId: message.id }
          })
        ).status()
      ).toBe(401);
      await gate('hold');
      const before = await smtp();
      await row.getByRole('button', { name: 'Relancer', exact: true }).click();
      const completed = admin.waitForResponse((r) =>
        r.url().endsWith('/email-queue/retry')
      );
      await admin.locator('[data-og7="confirm-action"]').click();
      try {
        await expect
          .poll(async () => (await smtp()).held, { intervals: [100] })
          .toBe(1);
        const competitors = await Promise.all(
          [1, 2].map(() =>
            request.post(queueUrl + '/retry', {
              headers,
              data: { messageId: message.id }
            })
          )
        );
        for (const response of competitors) {
          expect(response.ok()).toBe(true);
          expect(await response.json()).toMatchObject({
            attempted: 0,
            sent: 0,
            message: { status: 'sending', attempts: 3 }
          });
        }
        expect((await smtp()).connections).toBe(before.connections + 1);
        await expect(
          row.getByRole('button', { name: 'Relance...', exact: true })
        ).toBeDisabled();
      } finally {
        await gate('allow');
      }
      expect((await completed).ok()).toBe(true);
      await expect(row.locator('[data-og7="email-retry-result"]')).toHaveText(
        'Message envoye.'
      );
      await expect(
        row.getByRole('button', { name: 'Relancer', exact: true })
      ).toBeDisabled();
      expect(await currentMessage()).toMatchObject({
        status: 'sent',
        attempts: 3,
        last_error: null
      });
      expect(
        (
          await request.post(queueUrl + '/retry', {
            headers,
            data: { messageId: message.id }
          })
        ).status()
      ).toBe(409);
      await expect
        .poll(async () => (await captured(message.subject)).length)
        .toBe(1);
      const mail = (await captured(message.subject))[0]!;
      const content = await get<{ Text: string }>(
        stub + '/__test__/mail/' + mail.ID,
        false
      );
      const urls = content.Text.match(/https?:\/\/[^\s<>]+/g) ?? [];
      link = urls.find((u) => new URL(u).pathname.endsWith(followupUrl))!;
      expect(link).toBeTruthy();
      expect(new URL(link).origin).toBe(baseURL);
      expect(new URL(link).searchParams.get('token')).toMatch(
        /^[A-Za-z0-9_-]{43}$/
      );
      await admin.screenshot({
        path: info.outputPath('email-recovery-sent.png'),
        fullPage: true
      });
    });
    await test.step('Open the actual captured link in a fresh browser, restore the draft and submit for review', async () => {
      await recovery.browser.close();
      const resumed = await newCompanyBrowser();
      const draftLoaded = resumed.page.waitForResponse((r) =>
        r.url().includes('/sponsorship-followup/draft?')
      );
      await resumed.page.goto(link);
      expect(await (await draftLoaded).json()).toMatchObject({
        revision: savedDraft.revision,
        data: savedDraft.data
      });
      await expect(resumed.page.locator('#followup-companyName')).toHaveValue(
        companyName
      );
      await expect(resumed.page.locator('#followup-contactEmail')).toHaveValue(
        contactEmail
      );
      await expect(resumed.page.locator('#followup-message')).toHaveValue(note);
      await expect(resumed.page).not.toHaveURL(/token=/);
      expect((await sponsor()).sponsor_details_submitted_at).toBeNull();
      await resumed.page.screenshot({
        path: info.outputPath('recovered-draft-mobile.png'),
        fullPage: true
      });
      await resumed.page
        .locator('#followup-contactName')
        .fill('Contact de recette');
      await resumed.page
        .locator('#followup-websiteUrl')
        .fill('https://simulation.example.test');
      const submitted = resumed.page.waitForResponse(
        (r) =>
          r.url().endsWith('/sponsorship-followup/details') &&
          r.request().method() === 'POST'
      );
      await resumed.page
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      expect((await submitted).ok()).toBe(true);
      await expect(
        resumed.page
          .getByRole('status')
          .filter({ hasText: /Informations enregistrées/ })
      ).toBeVisible();
      const record = await sponsor();
      expect(record).toMatchObject({
        amount: 500,
        currency: 'CAD',
        payment_status: 'paid',
        sponsor_review_status: 'pending_review',
        sponsor_message: note,
        sponsor_details_submitted_at: expect.any(String)
      });
      await admin.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' + contributionId
      );
      await expect(
        admin.getByRole('complementary', {
          name: 'Dossier commanditaire selectionne'
        })
      ).toContainText(companyName);
      const publicData = JSON.stringify(
        await get('/api/public/sponsorships', false)
      );
      for (const privateValue of [
        companyName,
        note,
        paymentEmail,
        contactEmail,
        new URL(link).searchParams.get('token')!
      ])
        expect(publicData).not.toContain(privateValue);
      const publications = await get<PublicationAutomationState>(
        '/api/admin/publication-automation'
      );
      expect(
        publications.deliveries.filter(
          (d) =>
            d.sponsors.some((s) => s.id === contributionId) &&
            ['approved', 'published'].includes(d.status)
        )
      ).toHaveLength(0);
      expect(await captured(message.subject)).toHaveLength(1);
      expect(await recoveryMessages()).toHaveLength(1);
      const audit = (await get<AdminAuditLogResponse>('/api/admin/audit-log'))
        .entries;
      const accessAudit = audit.filter(
        (e) =>
          e.entity_id === contributionId &&
          e.action === 'sponsorship.access_link_requested'
      );
      const submissionAudit = audit.filter(
        (e) =>
          e.entity_id === contributionId &&
          e.action === 'sponsorship.details_submitted'
      );
      expect(accessAudit).toHaveLength(1);
      expect(submissionAudit).toHaveLength(1);
      const retries = audit.filter(
        (e) => e.entity_id === message.id && e.action === 'email_queue.retry'
      );
      expect(retries.filter((e) => e.metadata['sent'] === 1)).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(
        new URL(link).searchParams.get('token')!
      );
      await info.attach('email-recovery-proof', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              contributionId,
              amountMinor: 50000,
              currency: 'CAD',
              apiRestarted: true,
              draftRestored: true,
              smtp: await smtp(),
              message: await currentMessage(),
              acceptedMessages: 1,
              review: record.sponsor_review_status,
              accessAudit,
              submissionAudit,
              retries
            },
            null,
            2
          )
        )
      });
    });
    expect(errors).toEqual([]);
  } finally {
    await gate('allow');
    for (const browser of contexts) await browser.close();
  }
});
