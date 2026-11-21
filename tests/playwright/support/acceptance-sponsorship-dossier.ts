import type { APIRequestContext, Page } from '@playwright/test';
import type {
  AdminSponsorshipsResponse,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { adminSessionHeaders } from './admin-auth.js';
import { completeModeration } from './moderation.js';
import { expect } from './test.js';

/** Approve one submitted fixture before planning, without authorizing a delivery. */
export async function approveAcceptanceSponsorshipDossier(
  page: Page,
  request: APIRequestContext,
  contributionId: string
): Promise<void> {
  expect(
    process.env.OPENG7_E2E_ISOLATED,
    'Disposable fixture review only.'
  ).toBe('1');
  const read = async () => {
    const response = await request.get('/api/admin/sponsorships', {
      headers: await adminSessionHeaders(request),
      params: { search: contributionId }
    });
    expect(response.ok(), await response.text()).toBe(true);
    const records = (await response.json()) as AdminSponsorshipsResponse;
    const record = records.items.find((item) => item.id === contributionId);
    expect(record).toBeTruthy();
    return record!;
  };
  const current = await read();
  if (current.sponsor_review_status === 'approved') return;
  expect(current.sponsor_review_status).toBe('pending_review');
  await page.goto(
    '/admin/fundraiser/sponsors?sponsorshipId=' +
      contributionId +
      '&tab=publication'
  );
  await page.locator('[data-og7="sponsorship-approve"]').click();
  await completeModeration(page);
  await expect
    .poll(async () => (await read()).sponsor_review_status)
    .toBe('approved');
}

/** Capacity-one delivery recipes leave the two agreed collective passages open. */
export async function expectAcceptanceCollectivesPending(
  request: APIRequestContext,
  contributionId: string
): Promise<void> {
  const response = await request.get('/api/admin/sponsorship-commitments', {
    headers: await adminSessionHeaders(request),
    params: { contributionId }
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { commitment } = (await response.json()) as {
    commitment: SponsorshipCommitmentRecord;
  };
  const collective = commitment.obligations.filter((obligation) =>
    obligation.benefitId.endsWith('_batch')
  );
  expect(collective).toHaveLength(2);
  expect(
    collective.every(
      (obligation) =>
        obligation.state === 'pending' && obligation.minimumParticipants === 2
    )
  ).toBe(true);
}
