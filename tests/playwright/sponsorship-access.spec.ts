import { randomUUID } from 'node:crypto';

import type {
  AdminEmailQueueResponse,
  AdminSponsorshipsResponse
} from '@openg7/funding-core';

import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import {
  openFixtureSponsorship,
  signInAsAdmin,
  adminSessionHeaders
} from './support/admin-auth.js';
import { expect, test } from './support/test.js';

test('persistent drafts, public recovery and confirmed admin resend use the real API', async ({
  page,
  request
}) => {
  const fixture = SPONSORSHIP_FIXTURES.followupRecovery;
  const headers = await adminSessionHeaders(request);
  const records = await (
    await request.get(
      '/api/admin/sponsorships?search=' +
        encodeURIComponent(fixture.companyName),
      { headers }
    )
  ).json();
  const id: string = records.items[0].id;
  const accessUrl = '/api/admin/sponsorships/followup-access';
  const accessEmails = async () => {
    const queue = (await (
      await request.get('/api/admin/email-queue', { headers })
    ).json()) as AdminEmailQueueResponse;
    return queue.messages.filter(
      (message) => message.recipient_email === fixture.paymentEmail
    );
  };
  expect(
    (await request.get(accessUrl + '?contributionId=' + id)).status()
  ).toBe(401);
  expect((await request.post(accessUrl, { data: {} })).status()).toBe(401);
  const payload = {
    contributionId: id,
    recipient: fixture.paymentEmail,
    requestId: randomUUID(),
    confirmed: true,
    locale: 'fr-CA'
  };
  expect(
    (
      await request.post(accessUrl, {
        headers,
        data: { ...payload, confirmed: false }
      })
    ).status()
  ).toBe(400);
  expect(
    (
      await request.post(accessUrl, {
        headers,
        data: { ...payload, recipient: fixture.contactEmail }
      })
    ).status()
  ).toBe(409);
  expect(
    (
      await request.get('/api/sponsorship-followup/draft?token=invalid')
    ).status()
  ).toBe(404);

  await page.goto(
    '/fonds-des-batisseurs/suivi-commandite?token=' + fixture.followupToken
  );
  await page.getByRole('button', { name: 'Modifier mes informations' }).click();
  await page
    .getByLabel("Nom de l'entreprise", { exact: false })
    .fill('Brouillon récupération E2E');
  await expect(
    page.locator('[data-og7="followup-draft-status"]')
  ).toContainText('Brouillon enregistré.');
  const followup = await (
    await request.get(
      '/api/sponsorship-followup?token=' + fixture.followupToken
    )
  ).json();
  expect(followup.companyName).toBe(fixture.companyName);
  expect(followup.reviewStatus).toBe('approved');
  await page.reload();
  await expect(
    page.getByLabel("Nom de l'entreprise", { exact: false })
  ).toHaveValue('Brouillon récupération E2E');

  // Uniform responses, including the editable contact address which cannot grant access.
  for (const email of ['absent@example.invalid', fixture.contactEmail]) {
    const result = await request.post('/api/sponsorship-followup/recover', {
      data: { email, locale: 'fr-CA' }
    });
    expect(result.status()).toBe(202);
    expect(await result.json()).toEqual({ accepted: true });
  }
  await signInAsAdmin(page);
  await openFixtureSponsorship(page, fixture.companyName);
  await page.getByText('Accès au suivi', { exact: true }).click();
  const panel = page.locator('[data-og7="admin-followup-access"]');
  await panel.getByRole('button').click();
  await expect(page.getByRole('dialog')).toContainText(fixture.paymentEmail);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Annuler', exact: true })
    .filter({ hasText: 'Annuler' })
    .click();
  expect(await accessEmails()).toHaveLength(0);
  await panel.getByRole('button').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(panel.getByRole('status')).toContainText(
    'Le courriel est en file'
  );
  const messages = await accessEmails();
  expect(messages).toHaveLength(1);
  const message = messages[0]!;
  expect(message.recipient_email).toBe(fixture.paymentEmail);
  // The real worker may claim or deliver the message before this queue read.
  expect([
    { status: 'queued', attempts: 0 },
    { status: 'sending', attempts: 1 },
    { status: 'sent', attempts: 1 }
  ]).toContainEqual({ status: message.status, attempts: message.attempts });
  expect(message.template_key).toBe('sponsorship_access_recovery');
  const retry = await request.post(accessUrl, { headers, data: payload });
  expect(retry.status()).toBe(200);
  expect(
    message.status === 'sent'
      ? ['already_sent']
      : ['already_queued', 'already_sent']
  ).toContain((await retry.json()).status);
  expect(
    (
      await request.post('/api/sponsorship-followup/recover', {
        data: { email: fixture.paymentEmail }
      })
    ).status()
  ).toBe(202);
  const replayedMessages = await accessEmails();
  expect(replayedMessages).toHaveLength(1);
  expect(replayedMessages[0]).toMatchObject({
    id: message.id,
    recipient_email: fixture.paymentEmail,
    template_key: 'sponsorship_access_recovery'
  });
  if (message.status === 'sent') {
    expect(replayedMessages[0]).toMatchObject({ status: 'sent', attempts: 1 });
  }
  const after = (await (
    await request.get(
      '/api/admin/sponsorships?search=' +
        encodeURIComponent(fixture.companyName),
      { headers }
    )
  ).json()) as AdminSponsorshipsResponse;
  const accessAudits = after.items[0]!.admin_audit_entries.filter(
    (entry) => entry.action === 'sponsorship.access_link_requested'
  );
  expect(accessAudits).toHaveLength(1);
  expect(accessAudits[0]!.metadata.messageId).toBe(message.id);
  const draft = await (
    await request.get(
      '/api/sponsorship-followup/draft?token=' + fixture.followupToken
    )
  ).json();
  expect(draft.data.companyName).toBe('Brouillon récupération E2E');
});
