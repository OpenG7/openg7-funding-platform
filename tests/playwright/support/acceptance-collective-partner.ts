import { randomUUID } from 'node:crypto';

import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import type {
  AdminSponsorshipsResponse,
  ContributionActivityResponse
} from '@openg7/funding-core';

import { acceptDisplayedSponsorshipOffer } from './acceptance-offer.js';
import { approveAcceptanceSponsorshipDossier } from './acceptance-sponsorship-dossier.js';
import { adminSessionHeaders } from './admin-auth.js';
import { expect } from './test.js';

/** A real, approved second sponsor lets the disposable recipe exercise a collective. */
export async function createAcceptanceCollectivePartner(
  context: BrowserContext,
  request: APIRequestContext,
  admin: Page
): Promise<{ id: string; name: string; reference: string }> {
  expect(process.env.OPENG7_E2E_ISOLATED).toBe('1');
  const company = await context.newPage();
  const name = `Partenaire collectif ${randomUUID().slice(0, 8)}`;
  const email = `collective-${randomUUID()}@simulation.example.test`;
  const read = async <T>(url: string, authenticated = true): Promise<T> => {
    const response = await request.get(url, {
      ...(authenticated ? { headers: await adminSessionHeaders(request) } : {})
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<T>;
  };
  try {
    await company.goto('/fonds-des-batisseurs?intent=sponsorship#support');
    const form = company.locator('[data-og7="contribution-form"]');
    await form.getByRole('button', { name: '5 $', exact: true }).click();
    await form.getByRole('checkbox').nth(0).check();
    await form.locator('#public-display-name').fill(name);
    await form.getByRole('checkbox').nth(1).uncheck();
    await form.getByRole('checkbox').nth(2).check();
    await acceptDisplayedSponsorshipOffer(form);
    await form.locator('button[type="submit"]').click();
    await expect(company).toHaveURL(/\/checkout\/cs_test_/);
    const sessionId = new URL(company.url()).pathname.split('/').at(-1)!;
    const session = await read<{
      client_reference_id: string;
      amount_total: number;
    }>(
      `${process.env.STRIPE_STUB_BASE_URL!}/v1/checkout/sessions/${sessionId}`,
      false
    );
    expect(session.amount_total).toBe(500);
    const reference = session.client_reference_id;
    await company.getByLabel('Courriel simulé').fill(email);
    await company
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(company.locator('#followup-companyName')).toBeVisible();
    await company.locator('#followup-companyName').fill(name);
    await company
      .locator('#followup-contactName')
      .fill('Contact collectif de recette');
    await company.locator('#followup-contactEmail').fill(email);
    await company
      .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
      .click();
    await expect(
      company
        .getByRole('status')
        .filter({ hasText: /Informations enregistrées/ })
    ).toBeVisible();
    const records = await read<AdminSponsorshipsResponse>(
      '/api/admin/sponsorships?search=' + reference
    );
    expect(records.items).toHaveLength(1);
    const record = records.items[0]!;
    expect(record).toMatchObject({
      amount: 5,
      payment_status: 'paid',
      public_display_consent: true
    });
    expect(record.commitment?.offer?.version).toBe('sponsorship-v4');
    expect(
      record.commitment?.obligations.map((o) => o.benefitId).sort()
    ).toEqual(['facebook_batch', 'linkedin_batch', 'website_mention']);
    await approveAcceptanceSponsorshipDossier(admin, request, record.id);
    await expect
      .poll(
        async () => {
          const activity = await read<ContributionActivityResponse>(
            '/api/admin/contribution-activity'
          );
          const item = activity.items.find(
            (entry) => entry.reference === reference
          );
          return [item?.email, item?.sms];
        },
        { timeout: 15000 }
      )
      .toEqual(['sent', 'captured']);
    return { id: record.id, name, reference };
  } finally {
    await company.close();
  }
}
