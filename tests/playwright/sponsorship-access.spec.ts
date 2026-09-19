import { randomUUID } from 'node:crypto';

import type { AdminEmailQueueResponse } from '@openg7/funding-core';

import { ADMIN_TOKEN, SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { openFixtureSponsorship, signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

test('persistent drafts, public recovery and confirmed admin resend use the real API', async ({
  page,
  request
}) => {
  const fixture = SPONSORSHIP_FIXTURES.followupRecovery;
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
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
  const queued = { messages: await accessEmails() };
  expect(queued.messages).toHaveLength(1);
  expect(queued.messages[0].recipient_email).toBe(fixture.paymentEmail);
  expect(queued.messages[0].status).toBe('queued');
  expect(queued.messages[0].attempts).toBe(0);
  expect(queued.messages[0].template_key).toBe('sponsorship_access_recovery');
  const retry = await request.post(accessUrl, { headers, data: payload });
  expect((await retry.json()).status).toBe('already_queued');
  expect(
    (
      await request.post('/api/sponsorship-followup/recover', {
        data: { email: fixture.paymentEmail }
      })
    ).status()
  ).toBe(202);
  expect(await accessEmails()).toHaveLength(1);
  const after = await (
    await request.get(
      '/api/admin/sponsorships?search=' +
        encodeURIComponent(fixture.companyName),
      { headers }
    )
  ).json();
  expect(
    after.items[0].admin_audit_entries.some(
      (entry: { action: string }) =>
        entry.action === 'sponsorship.access_link_requested'
    )
  ).toBe(true);
  const draft = await (
    await request.get(
      '/api/sponsorship-followup/draft?token=' + fixture.followupToken
    )
  ).json();
  expect(draft.data.companyName).toBe('Brouillon récupération E2E');
});
