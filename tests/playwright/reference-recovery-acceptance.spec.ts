import { createHash, randomUUID } from 'node:crypto';

import type {
  AdminEmailQueueResponse,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipsResponse,
  FundTransparencyPublicResponse,
  PublicReferenceLookupResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { acceptanceSql } from './support/acceptance-database.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const recoveryUrl = '/api/reference-recovery';
interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

test('forgotten references: private responses during queue failure, unique captured email, public lookup and separate private access in FR/EN', async ({
  page: payer,
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
  const email = `recovery-${randomUUID()}@simulation.example.test`;
  const unrelatedEmail = `unrelated-${randomUUID()}@simulation.example.test`;
  const unknownEmail = `unknown-${randomUUID()}@simulation.example.test`;
  const companyName = 'Atelier récupération ' + randomUUID().slice(0, 8);
  const note = 'Brouillon privé retrouvé après perte de la référence.';
  const get = async <T>(url: string, admin = false): Promise<T> => {
    const response = await request.get(url, admin ? { headers } : {});
    expect(response.ok(), url).toBe(true);
    return response.json();
  };
  const queue = () =>
    get<AdminEmailQueueResponse>('/api/admin/email-queue', true);
  const messages = async (template: string, recipient = email) =>
    (await queue()).messages.filter(
      (m) => m.template_key === template && m.recipient_email === recipient
    );
  const mails = async () =>
    (await get<{ messages: Mail[] }>(stub + '/__test__/mail')).messages;
  const captured = async (template: string) => {
    await expect
      .poll(async () => (await messages(template))[0]?.status)
      .toBe('sent');
    const queued = await messages(template);
    expect(queued).toHaveLength(1);
    await expect
      .poll(
        async () =>
          (await mails()).filter(
            (m) =>
              m.Subject === queued[0]!.subject &&
              m.To.some((to) => to.Address === email)
          ).length
      )
      .toBe(1);
    const mail = (await mails()).find(
      (m) =>
        m.Subject === queued[0]!.subject &&
        m.To.some((to) => to.Address === email)
    )!;
    return get<{ Text: string; HTML: string }>(
      stub + '/__test__/mail/' + mail.ID
    );
  };
  const lookup = async (reference: string) => {
    const response = await request.post('/api/reference-lookup', {
      data: { reference }
    });
    expect(response.ok()).toBe(true);
    return response.json() as Promise<PublicReferenceLookupResponse>;
  };
  const totals = async () => {
    const summary = await get<FundTransparencyPublicResponse>(
      '/api/public/fund-transparency'
    );
    return {
      received: Math.round(summary.total_received * 100),
      count: summary.contributions_count
    };
  };
  const before = await totals();
  const errors: string[] = [];
  payer.on('pageerror', (e) => errors.push(e.message));
  const pay = async (amount: number, recipient: string, company = false) => {
    await payer.goto(
      '/fonds-des-batisseurs' +
        (company ? '?intent=sponsorship#support' : '#support')
    );
    const form = payer.locator('[data-og7="contribution-form"]');
    if (!company)
      await form
        .getByRole('button', { name: /Contribution personnelle/i })
        .click();
    await form
      .getByRole('button', { name: amount + ' $', exact: true })
      .click();
    await form.getByRole('checkbox').nth(0).setChecked(company);
    if (company) await form.locator('#public-display-name').fill(companyName);
    await form.getByRole('checkbox').nth(1).uncheck();
    await form.getByRole('checkbox').nth(2).check();
    await form.locator('button[type="submit"]').click();
    await expect(payer).toHaveURL(/\/checkout\/cs_test_/);
    const sessionId = new URL(payer.url()).pathname.split('/').at(-1)!;
    const session = await get<{ client_reference_id: string }>(
      stub + '/v1/checkout/sessions/' + sessionId
    );
    await payer.getByLabel('Courriel simulé').fill(recipient);
    await payer
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect
      .poll(async () => {
        const status = await lookup(session.client_reference_id);
        return status.found ? status.paymentStatus : null;
      })
      .toBe('paid');
    return { reference: session.client_reference_id, sessionId };
  };

  const personal = await pay(25, email);
  const unrelated = await pay(10, unrelatedEmail);
  const company = await pay(250, email, true);
  await expect(payer.locator('#followup-companyName')).toBeVisible();
  await payer.locator('#followup-companyName').fill(companyName);
  await payer.locator('#followup-contactEmail').fill(email);
  await payer.locator('#followup-contactName').fill('Contact de recette');
  const saved = payer.waitForResponse(
    (r) =>
      r.url().endsWith('/sponsorship-followup/draft') &&
      r.request().method() === 'POST'
  );
  await payer.locator('#followup-message').fill(note);
  expect((await saved).ok()).toBe(true);
  await expect(
    payer.locator('[data-og7="followup-draft-status"]')
  ).toContainText('Brouillon enregistré');
  const sponsor = async () => {
    const result = await get<AdminSponsorshipsResponse>(
      '/api/admin/sponsorships?search=' + company.reference,
      true
    );
    expect(result.items).toHaveLength(1);
    return result.items[0]!;
  };
  const id = (await sponsor()).id;
  const invoices = async () =>
    (
      await get<AdminSponsorshipInvoicesResponse>(
        '/api/admin/sponsorship-invoices?contributionId=' + id,
        true
      )
    ).invoices;
  await expect.poll(async () => (await invoices()).length).toBe(1);
  const originalInvoice = Object.fromEntries(
    Object.entries((await invoices())[0]!).filter(
      ([key]) => !key.startsWith('last_email_')
    )
  );
  const pdfHash = async () => {
    const response = await request.get(
      '/api/admin/sponsorship-invoices/pdf?invoiceId=' +
        (await invoices())[0]!.id,
      { headers }
    );
    expect(response.ok()).toBe(true);
    return createHash('sha256')
      .update(await response.body())
      .digest('hex');
  };
  const originalPdf = await pdfHash();
  await payer.close();
  const support = await context.newPage();
  support.on('pageerror', (e) => errors.push(e.message));
  await support.setViewportSize({ width: 390, height: 844 });

  const recover = async (recipient: string, english = false) => {
    const input = support.locator('#reference-recovery-email');
    await input.fill(recipient);
    const reply = support.waitForResponse((r) => r.url().endsWith(recoveryUrl));
    await input.press('Enter');
    const response = await reply;
    expect(response.status()).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    const status = support.locator('#reference-recovery-status');
    await expect(status).toContainText(
      english ? 'If a contribution matches' : 'Si une contribution correspond'
    );
    for (const value of [email, company.reference, personal.reference, note])
      await expect(status).not.toContainText(value);
    return status.textContent();
  };
  try {
    await test.step('Known and unknown addresses retain the same response even if the real email INSERT fails', async () => {
      await support.goto('/support');
      const summary = support.locator(
        '[data-og7="reference-recovery"] summary'
      );
      await summary.focus();
      await summary.press('Enter');
      await support.locator('#reference-recovery-email').fill('incorrect');
      await support.locator('#reference-recovery-email').press('Enter');
      await expect(
        support.locator('#reference-recovery-email')
      ).toHaveAttribute('aria-invalid', 'true');
      const unknown = await recover(unknownEmail);
      expect(
        await messages('contribution_reference_recovery', unknownEmail)
      ).toHaveLength(0);
      // This synthetic failure affects only this recipe's recipient and template.
      // No financial row, payment timestamp or existing message is changed.
      await acceptanceSql(`CREATE TABLE acceptance_reference_faults(recipient text PRIMARY KEY);
        CREATE FUNCTION acceptance_fail_reference_email() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.template_key='contribution_reference_recovery' AND EXISTS(
            SELECT 1 FROM acceptance_reference_faults WHERE recipient=NEW.recipient_email
          ) THEN RAISE EXCEPTION 'SIMULATED_REFERENCE_QUEUE_FAILURE'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER acceptance_reference_email BEFORE INSERT ON email_messages
        FOR EACH ROW EXECUTE FUNCTION acceptance_fail_reference_email();`);
      await acceptanceSql(
        'INSERT INTO acceptance_reference_faults VALUES ($1)',
        [email]
      );
      expect(await recover(email)).toBe(unknown);
      expect(await messages('contribution_reference_recovery')).toHaveLength(0);
      expect(
        (await mails()).filter(
          (m) =>
            m.Subject.includes('references') &&
            m.To.some((to) => to.Address === email)
        )
      ).toHaveLength(0);
      await acceptanceSql(
        'DELETE FROM acceptance_reference_faults WHERE recipient=$1',
        [email]
      );
    });

    let recoveredReferences: string[] = [];
    await test.step('Retry delivers both owned references once, with no other payer or private access token', async () => {
      await recover(email.toUpperCase());
      const content = await captured('contribution_reference_recovery');
      recoveredReferences = [
        ...new Set(content.Text.match(/OG7-\d{4}-[A-Z0-9]{4,8}/g))
      ];
      expect(recoveredReferences.sort()).toEqual(
        [personal.reference, company.reference].sort()
      );
      for (const value of [
        unrelated.reference,
        unrelatedEmail,
        'token=',
        note,
        'cs_test_',
        'pi_test_'
      ]) {
        expect(content.Text).not.toContain(value);
        expect(content.HTML).not.toContain(value);
      }
      const replay = await Promise.all(
        [1, 2].map(() => request.post(recoveryUrl, { data: { email } }))
      );
      for (const response of replay) {
        expect(response.status()).toBe(202);
        expect(await response.json()).toEqual({ accepted: true });
      }
      await captured('contribution_reference_recovery');
      await info.attach('captured-reference-recovery.html', {
        body: content.HTML,
        contentType: 'text/html'
      });
    });

    await test.step('FR mobile and EN desktop lookup disclose only the permitted status and offer separate private recovery', async () => {
      for (const english of [false, true]) {
        await support.setViewportSize({
          width: english ? 1280 : 390,
          height: 844
        });
        await support.goto(
          (english ? '/en' : '') + '/support?checkout=success'
        );
        const input = support.locator('#reference-lookup-input');
        const status = support.locator('#reference-lookup-status');
        await input.fill('incorrect');
        await input.press('Enter');
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await input.fill('OG7-2026-ZZZZZZZZ');
        await input.press('Enter');
        await expect(status).toContainText(
          english
            ? 'No contribution matches'
            : 'Aucune contribution ne correspond'
        );
        for (const reference of recoveredReferences) {
          const reply = support.waitForResponse((r) =>
            r.url().endsWith('/api/reference-lookup')
          );
          await input.fill(reference.toLowerCase());
          await input.press('Enter');
          const response = await reply;
          expect(response.ok()).toBe(true);
          const record = await response.json();
          expect(record).toMatchObject({
            found: true,
            publicReference: reference,
            paymentStatus: 'paid',
            amount: null,
            displayAmount: false,
            currency: 'CAD'
          });
          for (const value of [
            email,
            unrelatedEmail,
            note,
            id,
            'token',
            'cs_test_',
            'pi_test_'
          ])
            expect(JSON.stringify(record)).not.toContain(value);
          await expect(status).toContainText(english ? 'Paid' : 'Payé');
          await expect(status).toContainText(
            english ? 'Amount not public' : 'Montant non public'
          );
          if (reference === company.reference) {
            expect(record.nextStep).toBe('recover_private_link_by_email');
            const shortcut = support
              .locator('[data-og7="contribution-help"]')
              .locator('a[href$="#sponsorship-help"]');
            await expect(shortcut).toHaveCount(1);
            await shortcut.click();
            await expect(
              support.locator('#followup-recovery-email')
            ).toBeFocused();
          }
        }
        if (english) {
          await support
            .locator('[data-og7="reference-recovery"] summary')
            .click();
          const unknown = await recover(unknownEmail, true);
          expect(await recover(email, true)).toBe(unknown);
        }
        await support.screenshot({
          path: info.outputPath(
            english ? 'support-en-desktop.png' : 'support-fr-mobile.png'
          ),
          fullPage: true
        });
      }
      await captured('contribution_reference_recovery');
      const denied = await request.get(
        '/api/sponsorship-followup?token=' + company.reference
      );
      expect(denied.status()).toBe(400);
      await support.goto(
        '/fonds-des-batisseurs/suivi-commandite?reference=' + company.reference
      );
      await expect(
        support.locator('[data-og7="followup-recovery"]')
      ).toBeVisible();
      await expect(support.locator('#followup-companyName')).toHaveCount(0);
    });

    await test.step('Only the separately captured private link restores the saved dossier; submitting keeps finances intact', async () => {
      await support.goto('/support');
      const input = support.locator('#followup-recovery-email');
      for (const recipient of [unknownEmail, email]) {
        await input.fill(recipient);
        const reply = support.waitForResponse((r) =>
          r.url().endsWith('/sponsorship-followup/recover')
        );
        await input.press('Enter');
        const response = await reply;
        expect(response.status()).toBe(202);
        expect(await response.json()).toEqual({ accepted: true });
        await expect(
          support.locator('#followup-recovery-status')
        ).toContainText('Si une commandite correspond');
      }
      expect(
        await messages('sponsorship_access_recovery', unknownEmail)
      ).toHaveLength(0);
      const content = await captured('sponsorship_access_recovery');
      const link = (content.Text.match(/https?:\/\/[^\s<>]+/g) ?? []).find(
        (u) => new URL(u).pathname.endsWith('/suivi-commandite')
      )!;
      expect(new URL(link).origin).toBe(baseURL);
      expect(new URL(link).searchParams.get('token')).toBeTruthy();
      await support.goto(link);
      await expect(support.locator('#followup-companyName')).toHaveValue(
        companyName
      );
      await expect(support.locator('#followup-message')).toHaveValue(note);
      await expect(support).not.toHaveURL(/token=/);
      const submitted = support.waitForResponse(
        (r) =>
          r.url().endsWith('/sponsorship-followup/details') &&
          r.request().method() === 'POST'
      );
      await support
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      expect((await submitted).ok()).toBe(true);
      expect(await sponsor()).toMatchObject({
        payment_status: 'paid',
        sponsor_review_status: 'pending_review',
        sponsor_details_submitted_at: expect.any(String),
        sponsor_message: note
      });
      for (const payment of [personal, company, unrelated]) {
        expect(
          (
            await request.post(stub + '/__test__/checkout-delivery', {
              data: { sessionId: payment.sessionId, action: 'deliver' }
            })
          ).ok()
        ).toBe(true);
      }
      expect(await totals()).toEqual({
        received: before.received + 28500,
        count: before.count + 3
      });
      expect(await invoices()).toHaveLength(1);
      expect(
        Object.fromEntries(
          Object.entries((await invoices())[0]!).filter(
            ([key]) => !key.startsWith('last_email_')
          )
        )
      ).toEqual(originalInvoice);
      expect(await pdfHash()).toBe(originalPdf);
      expect(
        JSON.stringify(await get('/api/public/sponsorships'))
      ).not.toContain(companyName);
      await captured('contribution_reference_recovery');
      await captured('sponsorship_access_recovery');
      expect(errors).toEqual([]);
      await info.attach('reference-recovery-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            providers: 'simulated',
            references: recoveredReferences,
            excludedReference: unrelated.reference,
            sameResponseDuringQueueFailure: true,
            referenceEmails: (await messages('contribution_reference_recovery'))
              .length,
            privateAccessEmails: (await messages('sponsorship_access_recovery'))
              .length,
            invoiceUnchanged: true
          },
          null,
          2
        )
      });
    });
  } finally {
    await acceptanceSql(`DROP TRIGGER IF EXISTS acceptance_reference_email ON email_messages;
      DROP FUNCTION IF EXISTS acceptance_fail_reference_email();
      DROP TABLE IF EXISTS acceptance_reference_faults;`);
    await support.close();
  }
});
