import type { ContributionType } from './contribution-contracts.js';
import type { SponsorshipCharterAcceptance } from './moderation-followup.js';
import type { SponsorshipOfferAcceptance } from './sponsorship-offers.js';
import type { SponsorshipOfferFormatOptions } from './sponsorship-publication-formats.js';

export interface CheckoutConsentPayload {
  readonly contributionType: ContributionType;
  readonly publicDisplayConsent: boolean;
  readonly publicDisplayName?: string;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
  /** Required only when the API has activated validated public charter terms. */
  readonly charterAcceptance?: SponsorshipCharterAcceptance;
  /** The reference displayed before a new business Checkout; the API snapshots its own terms. */
  readonly offerAcceptance?: SponsorshipOfferAcceptance;
  readonly offerFormats?: SponsorshipOfferFormatOptions;
}

export interface CheckoutRequest extends CheckoutConsentPayload {
  /** Opaque identifier retained when retrying the same logical checkout attempt. */
  readonly idempotencyKey: string;
  readonly amount: number;
  readonly currency: 'CAD';
  readonly projectId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface MockCheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'mocked';
}

export interface RedirectCheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'redirected';
}

export type CheckoutResult = MockCheckoutResult | RedirectCheckoutResult;

export const createMockCheckoutResult = (
  request: CheckoutRequest
): MockCheckoutResult => ({
  checkoutId: `mock-${request.projectId}-${request.amount}`,
  redirectUrl: 'https://example.org/mock-checkout',
  status: 'mocked'
});
