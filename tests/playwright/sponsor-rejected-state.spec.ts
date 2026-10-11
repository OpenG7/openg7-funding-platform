import type {
  AdminSponsorshipsResponse,
  SponsorshipFollowupResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { adminSessionHeaders } from './support/admin-auth.js';

// A terminal synthetic fixture exercises sponsor follow-up independently of
// N4 proposals, which remain restricted pending a distinct person's review.

test.describe('Sponsor side rejected state validation', () => {
  test('a sponsor sees a previously rejected dossier with payment still confirmed', async ({
    page,
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.rejectedFollowup;
    const privateResponse = await request.get(
      '/api/admin/sponsorships?search=' + fixture.publicReference,
      { headers: await adminSessionHeaders(request) }
    );
    expect(privateResponse.ok()).toBe(true);
    const privateRecords =
      (await privateResponse.json()) as AdminSponsorshipsResponse;
    expect(privateRecords.items).toHaveLength(1);
    expect(fixture.reviewNote).toBeTruthy();
    expect(privateRecords.items[0]).toMatchObject({
      public_reference: fixture.publicReference,
      sponsor_review_status: 'rejected',
      sponsor_review_note: fixture.reviewNote,
      payment_status: 'paid'
    });
    const response = await request.get('/api/sponsorship-followup', {
      params: { token: fixture.followupToken }
    });
    expect(response.ok()).toBe(true);
    const stored = (await response.json()) as SponsorshipFollowupResponse;
    expect(stored.reviewStatus).toBe('rejected');
    expect(stored.paymentStatus).toBe('paid');
    expect(stored).not.toHaveProperty('sponsor_review_note');
    expect(stored).not.toHaveProperty('internalReason');
    expect(JSON.stringify(stored)).not.toContain(fixture.reviewNote);
    await page.goto(
      `/fonds-des-batisseurs/suivi-commandite?token=${fixture.followupToken}`
    );

    // Verify the rejected state is displayed
    await expect(
      page.getByRole('heading', { name: /Commandite refus.e/i })
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(fixture.reviewNote);
    await expect(
      page
        .locator('.reference-code', { hasText: fixture.publicReference })
        .first()
    ).toBeVisible();

    // Verify the payment status is still paid
    await expect(
      page.locator('[data-og7="followup-summary"]').getByRole('heading', {
        name: 'Confirmé',
        exact: true
      })
    ).toBeVisible();

    // Verify the details form is not available (rejected sponsorships don't allow details submission)
    await expect(
      page.getByRole('button', {
        name: /Soumettre mes informations à l’équipe/i
      })
    ).toBeDisabled();
  });
});
