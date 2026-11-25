import type {
  SponsorshipGoldenPath,
  SponsorshipGoldenPathObservation
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { loadAdminCampaignsOnClient } from './admin-campaigns.service.js';
import { loadPaymentJourneyOnClient } from './admin-payment-journey.service.js';
import { loadResponsibilityBalanceOnClient } from './admin-responsibility-balance.service.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { loadSponsorshipCommitment } from './sponsorship-commitments.repository.js';
import { loadSponsorshipProgressPublications } from './sponsorship-progress.repository.js';

export interface GoldenPathReadPorts {
  readonly balance: typeof loadResponsibilityBalanceOnClient;
  readonly journey: typeof loadPaymentJourneyOnClient;
  readonly commitment: typeof loadSponsorshipCommitment;
  readonly campaigns: typeof loadAdminCampaignsOnClient;
  readonly publications: typeof loadSponsorshipProgressPublications;
}
const defaultPorts: GoldenPathReadPorts = {
  balance: loadResponsibilityBalanceOnClient,
  journey: loadPaymentJourneyOnClient,
  commitment: loadSponsorshipCommitment,
  campaigns: loadAdminCampaignsOnClient,
  publications: loadSponsorshipProgressPublications
};

/** Read owners sequentially on one immutable snapshot. No provider or command port. */
export async function loadSponsorshipGoldenPathOnClient(
  db: PoolClient,
  contributionId: string,
  now = new Date(),
  ports: GoldenPathReadPorts = defaultPorts
): Promise<SponsorshipGoldenPathObservation> {
  const id = contributionId.toLowerCase();
  const balance = await ports.balance(db, id, now);
  if (balance.contributionId !== id)
    throw new Error('GOLDEN_PATH_SCOPE_MISMATCH');
  if (balance.contributionType !== 'sponsorship_interest')
    return { status: 'not_sponsorship', path: null };
  const journey = await ports.journey(db, id, now);
  if (journey.status !== 'ok' || journey.journey?.contributionId !== id)
    throw new Error('GOLDEN_PATH_UNAVAILABLE');
  const commitment = await ports.commitment(db, id);
  if (commitment && commitment.contributionId !== id)
    throw new Error('GOLDEN_PATH_SCOPE_MISMATCH');
  const campaigns = await ports.campaigns(
    db,
    {
      page: 1,
      pageSize: 100,
      sponsorshipId: id,
      sort: 'paid_at',
      direction: 'asc'
    },
    now
  );
  const publications = await ports.publications(db, id);
  const observedAt = now.toISOString();
  const services = balance.obligations.map((obligation) => {
    const campaign = campaigns.items.find(
      (item) =>
        item.contributionId === id &&
        item.id === obligation.id &&
        item.channel === obligation.channel &&
        item.target === obligation.target &&
        item.ordinal === obligation.ordinal
    );
    return {
      obligation,
      preparation: campaign?.preparation ?? null,
      workflow: campaign?.workflow ?? null,
      executions: publications
        .filter(
          (item) =>
            item.obligationId === obligation.id &&
            item.channel === obligation.channel &&
            item.target === obligation.target
        )
        .map((item) => ({
          id: item.id,
          obligationId: item.obligationId,
          deliveryId: item.deliveryId ?? null,
          deliveryStatus: item.deliveryStatus,
          deliveryMode: item.deliveryMode,
          scheduledAt: item.scheduledAt,
          publishedAt: item.publishedAt
        })),
      adminUrl: `/admin/fundraiser/campaigns?sponsorshipId=${id}&obligationId=${obligation.id}`
    };
  });
  const path: SponsorshipGoldenPath = {
    contributionId: id,
    reference: balance.reference,
    observedAt,
    version: balance.version,
    paymentStatus: balance.paymentStatus,
    amountMinor: balance.amountMinor,
    currency: balance.currency,
    state: balance.status,
    reasons: balance.reasons,
    counts: {
      expected: balance.expected,
      fulfilled: balance.fulfilled,
      waived: balance.waived,
      outstanding: balance.outstanding,
      unknown: balance.unknown
    },
    commitment: commitment
      ? {
          id: commitment.id,
          version: commitment.version,
          state: commitment.state,
          offerId: commitment.offerId
        }
      : null,
    steps: journey.journey.steps,
    next: balance.next,
    services,
    partial:
      campaigns.pagination.hasNextPage ||
      services.some((item) => item.preparation === null),
    sources: (
      [
        'responsibilities',
        'payment_journey',
        'campaigns',
        'publications'
      ] as const
    ).map((owner) => ({ owner, observedAt }))
  };
  return { status: 'available', path };
}

export async function readSponsorshipGoldenPath(
  pool: Pool | null,
  contributionId: string,
  now = new Date(),
  ports: GoldenPathReadPorts = defaultPorts
): Promise<SponsorshipGoldenPathObservation> {
  if (!pool || !isValidUuid(contributionId))
    return { status: 'unavailable', path: null };
  try {
    return await withPostgresTransaction(
      pool,
      (db) => loadSponsorshipGoldenPathOnClient(db, contributionId, now, ports),
      { readOnlySnapshot: true }
    );
  } catch (error) {
    return {
      status:
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'CONTRIBUTION_NOT_FOUND'
          ? 'not_found'
          : 'unavailable',
      path: null
    };
  }
}
