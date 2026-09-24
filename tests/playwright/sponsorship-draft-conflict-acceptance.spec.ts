import type {
  AdminAuditLogResponse,
  FundTransparencyPublicResponse,
  SponsorshipDraftSnapshot,
  SponsorshipFollowupResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN, SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { expect, test } from './support/test.js';

test('two company tabs preserve edits on conflict and cannot restore a discarded draft or overwrite a newer submission', async ({
  page: a,
  context,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(120000);
  const fixture = SPONSORSHIP_FIXTURES.draftConcurrency;
  const token = fixture.followupToken;
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const url = '/api/sponsorship-followup';
  const get = async <T>(path: string, authenticated = false): Promise<T> => {
    const r = await request.get(path, authenticated ? { headers } : {});
    expect(r.ok(), path).toBe(true);
    return r.json();
  };
  const followup = () =>
    get<SponsorshipFollowupResponse>(url + '?token=' + token);
  const draft = () =>
    get<SponsorshipDraftSnapshot>(url + '/draft?token=' + token);
  const original = await followup();
  expect(original).toMatchObject({
    companyName: fixture.companyName,
    reviewStatus: 'approved',
    paymentStatus: 'paid'
  });
  const totals = await get<FundTransparencyPublicResponse>(
    '/api/public/fund-transparency'
  );
  context.setDefaultTimeout(15000);
  const b = await context.newPage();
  await a.setViewportSize({ width: 1280, height: 900 });
  await b.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  const banner = (page: typeof a) =>
    page.locator('[data-og7="followup-draft-status"]');
  const save = (page: typeof a) =>
    page.waitForResponse(
      (r) => r.url().endsWith(url + '/draft') && r.request().method() === 'POST'
    );
  const reload = (page: typeof a) =>
    page
      .getByRole('button', { name: 'Charger le brouillon sauvegardé' })
      .click();
  const company = (page: typeof a) => page.locator('#followup-companyName');
  try {
    for (const page of [a, b]) {
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/fonds-des-batisseurs/suivi-commandite?token=' + token);
      await expect(company(page)).toHaveValue(fixture.companyName);
      await page
        .getByRole('button', { name: 'Modifier mes informations' })
        .click();
      await expect(banner(page)).not.toContainText('Chargement');
    }
    await test.step('Two independent tabs start from the same revision; the losing tab keeps its own text', async () => {
      const saved = save(a);
      await company(a).fill('Brouillon conservé sur le serveur');
      expect((await saved).status()).toBe(200);
      const conflict = save(b);
      await b.locator('#followup-message').fill('Texte local à ne pas perdre');
      expect((await conflict).status()).toBe(409);
      await expect(banner(b)).toContainText('autre');
      await expect(b.locator('#followup-message')).toHaveValue(
        'Texte local à ne pas perdre'
      );
      await expect(company(b)).toHaveValue(fixture.companyName);
      await expect(
        b.getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
      ).toBeDisabled();
      expect(await followup()).toEqual(original);
      expect((await draft()).data?.companyName).toBe(
        'Brouillon conservé sur le serveur'
      );
      await b.screenshot({
        path: info.outputPath('draft-conflict-mobile.png'),
        fullPage: true
      });
    });
    await test.step('Explicit reload permits a new revision; stale discard cannot erase it', async () => {
      await reload(b);
      await expect(company(b)).toHaveValue('Brouillon conservé sur le serveur');
      const saved = save(b);
      await b.locator('#followup-message').fill('Nouvelle révision partagée');
      expect((await saved).status()).toBe(200);
      const conflict = save(a);
      await a.getByRole('button', { name: 'Annuler la saisie' }).click();
      expect((await conflict).status()).toBe(409);
      expect((await draft()).data?.message).toBe('Nouvelle révision partagée');
      await reload(a);
      await expect(a.locator('#followup-message')).toHaveValue(
        'Nouvelle révision partagée'
      );
    });
    await test.step('Discard creates a tombstone; neither stale autosave nor stale submission revives it', async () => {
      const before = await draft();
      const discarded = save(a);
      await a.getByRole('button', { name: 'Annuler la saisie' }).click();
      expect((await discarded).status()).toBe(200);
      await expect(company(a)).toHaveValue(fixture.companyName);
      const tombstone = await draft();
      expect(tombstone).toMatchObject({
        data: null,
        revision: before.revision + 1
      });
      const conflict = save(b);
      await b.locator('#followup-message').fill('Ancienne révision refusée');
      expect((await conflict).status()).toBe(409);
      const staleSubmit = await request.post(url + '/details', {
        data: { token, ...before.data, draftRevision: before.revision }
      });
      expect(staleSubmit.status()).toBe(409);
      expect(await draft()).toEqual(tombstone);
      expect(await followup()).toEqual(original);
      await reload(b);
      await expect(company(b)).toHaveValue(fixture.companyName);
    });
    await test.step('A fresh explicit submission reaches review exactly once without financial or public changes', async () => {
      const staleRevision = (await draft()).revision;
      await a
        .getByRole('button', { name: 'Modifier mes informations' })
        .click();
      await a
        .locator('#followup-message')
        .fill('Modification finale soumise volontairement');
      const submitted = a.waitForResponse(
        (r) =>
          r.url().endsWith(url + '/details') && r.request().method() === 'POST'
      );
      await a
        .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
        .click();
      const response = await submitted;
      expect(response.status()).toBe(200);
      const stale = await request.post(url + '/details', {
        data: {
          ...response.request().postDataJSON(),
          draftRevision: staleRevision,
          message: 'Ancienne saisie à refuser'
        }
      });
      expect(stale.status()).toBe(409);
      expect(await followup()).toMatchObject({
        companyName: fixture.companyName,
        reviewStatus: 'pending_review',
        paymentStatus: 'paid',
        message: 'Modification finale soumise volontairement'
      });
      expect((await draft()).data).toBeNull();
      const after = await get<FundTransparencyPublicResponse>(
        '/api/public/fund-transparency'
      );
      expect(after.total_received).toBe(totals.total_received);
      expect(after.contributions_count).toBe(totals.contributions_count);
      const records = await get<{ items: { id: string }[] }>(
        '/api/admin/sponsorships?search=' + fixture.publicReference,
        true
      );
      const audit = await get<AdminAuditLogResponse>(
        '/api/admin/audit-log',
        true
      );
      expect(
        audit.entries.filter(
          (e) =>
            e.entity_id === records.items[0]!.id &&
            e.action === 'sponsorship.details_submitted'
        )
      ).toHaveLength(1);
      expect(
        JSON.stringify(await get('/api/public/sponsorships'))
      ).not.toContain('Modification finale soumise volontairement');
      expect(errors).toEqual([]);
    });
  } finally {
    await b.close();
  }
});
