import { createHash, randomBytes } from 'node:crypto';

import type Stripe from 'stripe';

import { normalizeContributionPublicReference } from '../contribution-public-reference.js';
import {
  normalizeContributionType,
  parseMetadataBoolean,
  type CheckoutSessionWebhookInput,
  type SponsorshipFollowupLookup
} from '../fund-contributions.repository.js';
import { resolvePaymentIntentId } from '../stripe-object-normalization.js';

import {
  checkoutSessionPaidAtIso,
  stripeCheckoutSessionStatus
} from './checkout.js';
import type { ReportFailure } from './contracts.js';

export const FOLLOWUP_TOKEN_BYTES = 32;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const followupEditablePaymentStatuses = new Set([
  'paid',
  'refunded',
  'disputed'
]);

export const createSponsorshipFollowupToken = (): string =>
  randomBytes(FOLLOWUP_TOKEN_BYTES).toString('base64url');

export const hashSponsorshipFollowupToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const isValidFollowupToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);

export interface SponsorshipFollowupHelperDependencies {
  readonly sponsorshipFollowupTokenTtlDays: number;
  readonly stripe: {
    readonly checkout: {
      readonly sessions: Pick<Stripe['checkout']['sessions'], 'retrieve'>;
    };
  } | null;
  readonly getSponsorshipFollowupByTokenHash: (
    tokenHash: string,
    cutoffIso: string
  ) => Promise<SponsorshipFollowupLookup | null>;
  readonly upsertCheckoutSessionFromWebhook: (
    input: CheckoutSessionWebhookInput
  ) => Promise<boolean>;
  readonly reportFailure: ReportFailure;
}

export const createSponsorshipFollowupHelpers = ({
  sponsorshipFollowupTokenTtlDays,
  stripe,
  getSponsorshipFollowupByTokenHash,
  upsertCheckoutSessionFromWebhook,
  reportFailure
}: SponsorshipFollowupHelperDependencies) => {
  const getSponsorshipFollowupTokenCutoffIso = (): string =>
    new Date(
      Date.now() - sponsorshipFollowupTokenTtlDays * MILLISECONDS_PER_DAY
    ).toISOString();

  const refreshSponsorshipFollowupPaymentStatus = async (
    followup: SponsorshipFollowupLookup,
    tokenHash: string
  ): Promise<SponsorshipFollowupLookup> => {
    if (
      followupEditablePaymentStatuses.has(followup.paymentStatus) ||
      !stripe ||
      !followup.stripeSessionId
    ) {
      return followup;
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(
        followup.stripeSessionId,
        {
          expand: ['payment_intent']
        }
      );
      const metadata = session.metadata ?? {};
      const sessionTokenHash = metadata.sponsorshipFollowupTokenHash ?? null;

      if (
        normalizeContributionType(metadata.contributionType) !==
          'sponsorship_interest' ||
        (sessionTokenHash !== null && sessionTokenHash !== tokenHash)
      ) {
        return followup;
      }

      const status = stripeCheckoutSessionStatus(session);
      await upsertCheckoutSessionFromWebhook({
        notifyAdmin: true,
        stripeSessionId: session.id,
        stripePaymentIntentId: resolvePaymentIntentId(session.payment_intent),
        publicReference: normalizeContributionPublicReference(
          metadata.publicReference ?? session.client_reference_id
        ),
        contributionType: 'sponsorship_interest',
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? 'cad',
        metadata,
        publicDisplayConsent: parseMetadataBoolean(
          metadata.publicDisplayConsent
        ),
        publicName: metadata.publicDisplayName ?? null,
        displayAmountConsent: parseMetadataBoolean(
          metadata.displayAmountConsent
        ),
        nonCharityAcknowledged: parseMetadataBoolean(
          metadata.nonCharityAcknowledged
        ),
        sponsorshipFollowupTokenHash: sessionTokenHash ?? tokenHash,
        status,
        paidAtIso: checkoutSessionPaidAtIso(session, status),
        emailPrivate: session.customer_details?.email ?? null
      });

      return (
        (await getSponsorshipFollowupByTokenHash(
          tokenHash,
          getSponsorshipFollowupTokenCutoffIso()
        )) ?? followup
      );
    } catch (error) {
      reportFailure(
        'Failed to refresh sponsorship follow-up payment status from Stripe.',
        error
      );
      return followup;
    }
  };

  const getFreshSponsorshipFollowupByToken = async (
    token: string
  ): Promise<SponsorshipFollowupLookup | null> => {
    const tokenHash = hashSponsorshipFollowupToken(token);
    const followup = await getSponsorshipFollowupByTokenHash(
      tokenHash,
      getSponsorshipFollowupTokenCutoffIso()
    );

    return followup
      ? refreshSponsorshipFollowupPaymentStatus(followup, tokenHash)
      : null;
  };

  return {
    getSponsorshipFollowupTokenCutoffIso,
    refreshSponsorshipFollowupPaymentStatus,
    getFreshSponsorshipFollowupByToken
  };
};
