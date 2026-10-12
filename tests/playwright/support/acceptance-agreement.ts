import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';
import type {
  SponsorshipCommitmentRecord,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';

import { acceptanceSql } from './acceptance-database.js';
import { adminSessionHeaders } from './admin-auth.js';
import { expect } from './test.js';

/** Qualify declared synthetic history through the real owner command, never a current price list. */
export async function recordAcceptanceHistoricalAgreement(
  request: APIRequestContext,
  contributionId: string,
  offer: SponsorshipOfferSnapshot
): Promise<SponsorshipCommitmentRecord> {
  await acceptanceSql(
    `INSERT INTO sponsorship_commitments(contribution_id,provenance,state,qualification_reason)
     VALUES($1::uuid,'historical_unverified','needs_confirmation','Explicit synthetic agreement awaiting qualification')`,
    [contributionId]
  );
  const headers = await adminSessionHeaders(request);
  const current = await request.get(
    `/api/admin/sponsorship-commitments?contributionId=${contributionId}`,
    { headers }
  );
  expect(current.ok(), await current.text()).toBe(true);
  const before = (await current.json()) as {
    commitment: SponsorshipCommitmentRecord;
  };
  expect(before.commitment).toMatchObject({
    contributionId,
    state: 'needs_confirmation',
    provenance: 'historical_unverified',
    obligations: []
  });
  expect(offer.version).toBe('historical-qualification-v1');
  const response = await request.post(
    '/api/admin/sponsorship-commitments/qualify',
    {
      headers,
      data: {
        requestId: randomUUID(),
        contributionId,
        expectedVersion: before.commitment.version,
        confirmation: contributionId,
        reason:
          'An explicit synthetic agreement is part of this disposable recipe.',
        evidenceReference: `synthetic://acceptance-agreement/${contributionId}`,
        offer
      }
    }
  );
  expect(response.ok(), await response.text()).toBe(true);
  const after = (await response.json()) as {
    commitment: SponsorshipCommitmentRecord;
  };
  expect(after.commitment).toMatchObject({
    contributionId,
    state: 'active',
    provenance: 'qualified_historical',
    version: before.commitment.version + 1,
    offer
  });
  expect(after.commitment.obligations).toHaveLength(
    offer.benefits.reduce((count, benefit) => count + benefit.quantity, 0)
  );
  return after.commitment;
}

/** A placement edit alone cannot rewrite the commercial destination. */
export async function adjustAcceptanceObligationDestination(
  request: APIRequestContext,
  contributionId: string,
  channel: 'facebook' | 'linkedin',
  target: 'openg7' | 'openg20'
): Promise<void> {
  const headers = await adminSessionHeaders(request);
  const current = await request.get(
    `/api/admin/sponsorship-commitments?contributionId=${contributionId}`,
    { headers }
  );
  expect(current.ok(), await current.text()).toBe(true);
  const { commitment } = (await current.json()) as {
    commitment: SponsorshipCommitmentRecord;
  };
  expect(commitment.state).toBe('active');
  const obligations = commitment.obligations.filter(
    (obligation) =>
      obligation.channel === channel &&
      ['pending', 'blocked'].includes(obligation.state)
  );
  expect(obligations).toHaveLength(1);
  const obligation = obligations[0]!;
  const response = await request.post(
    '/api/admin/sponsorship-commitments/adjust',
    {
      headers,
      data: {
        requestId: randomUUID(),
        obligationId: obligation.id,
        expectedVersion: obligation.version,
        confirmation: obligation.id,
        kind: 'destination',
        target,
        reason:
          'Explicit synthetic agreement to change this outstanding destination.'
      }
    }
  );
  expect(response.ok(), await response.text()).toBe(true);
  const result = (await response.json()) as {
    commitment: SponsorshipCommitmentRecord;
  };
  expect(
    result.commitment.obligations.find((item) => item.id === obligation.id)
  ).toMatchObject({
    target,
    version: obligation.version + 1,
    state: obligation.state
  });
}
