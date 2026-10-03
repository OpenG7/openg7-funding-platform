import type { IncomingMessage, ServerResponse } from 'node:http';

import type Stripe from 'stripe';
import type {
  CheckoutRequest,
  CheckoutResult,
  ContributionType,
  RedirectCheckoutResult
} from '@openg7/funding-core';

import { isValidSponsorshipAmount } from '../../../packages/funding-core/src/index.js';

import {
  buildSponsorshipFollowupUrl,
  sponsorshipFollowupLocaleFromUrl
} from './sponsorship-followup-links.js';
import type { insertCheckoutSessionRecord } from './fund-contributions.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type {
  createHttpTransport,
  readBody as readHttpBody
} from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface PublicPaymentsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly readBody: typeof readHttpBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly projectId: string;
  readonly isProduction: boolean;
  readonly businessSponsorshipEnabled: boolean;
  readonly allowedContributionAmounts: ReadonlySet<number>;
  readonly PUBLIC_DISPLAY_NAME_MAX_LENGTH: number;
  readonly stripeApiHost: string | undefined;
  readonly navigableSimulatedCheckout: boolean;
  readonly stripe: {
    readonly checkout: {
      readonly sessions: Pick<Stripe['checkout']['sessions'], 'create'>;
    };
  } | null;
  readonly normalizeAmount: (amount: number) => number;
  readonly isAllowedContributionType: (
    value: unknown
  ) => value is ContributionType;
  readonly isBoolean: (value: unknown) => value is boolean;
  readonly isNonEmptySponsorText: (
    value: unknown,
    maxLength: number
  ) => value is string;
  readonly isValidOptionalBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly createDevelopmentCheckoutResult: (
    request: CheckoutRequest
  ) => CheckoutResult;
  readonly resolveCheckoutReturnUrl: (
    candidateUrl: string,
    fallbackPath: string
  ) => string;
  readonly createSponsorshipFollowupToken: () => string;
  readonly hashSponsorshipFollowupToken: (token: string) => string;
  readonly createContributionPublicReference: () => string;
  readonly buildContributionCheckoutSuccessUrl: (
    returnUrl: string,
    publicReference: string
  ) => string;
  readonly buildContributionReceiptDescription: (
    publicReference: string
  ) => string;
  readonly truncateStripeMetadataValue: (value: string) => string;
  readonly resolveStripePaymentIntentId: (
    value: string | Stripe.PaymentIntent | null
  ) => string | null;
  readonly insertCheckoutSessionRecord: (
    input: Parameters<typeof insertCheckoutSessionRecord>[1]
  ) => ReturnType<typeof insertCheckoutSessionRecord>;
  readonly reportFailure: (message: string, error?: unknown) => void;
}

export const createPublicPaymentsHttpHandler = ({
  publicBaseOrigin,
  readBody,
  writeJson,
  projectId,
  isProduction,
  businessSponsorshipEnabled,
  allowedContributionAmounts,
  PUBLIC_DISPLAY_NAME_MAX_LENGTH,
  stripeApiHost,
  navigableSimulatedCheckout,
  stripe,
  normalizeAmount,
  isAllowedContributionType,
  isBoolean,
  isNonEmptySponsorText,
  isValidOptionalBoundedText,
  createDevelopmentCheckoutResult,
  resolveCheckoutReturnUrl,
  createSponsorshipFollowupToken,
  hashSponsorshipFollowupToken,
  createContributionPublicReference,
  buildContributionCheckoutSuccessUrl,
  buildContributionReceiptDescription,
  truncateStripeMetadataValue,
  resolveStripePaymentIntentId,
  insertCheckoutSessionRecord,
  reportFailure
}: PublicPaymentsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  const handlePublicPaymentsRequest = async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(request.url, '/checkout-sessions', '/api/checkout-sessions')
    ) {
      let parsed: CheckoutRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as CheckoutRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid checkout request body.'
        });
        return true;
      }

      const amount = normalizeAmount(parsed.amount);
      const isSponsorshipContribution =
        parsed.contributionType === 'sponsorship_interest';
      const isAmountAllowed = isSponsorshipContribution
        ? isValidSponsorshipAmount(amount)
        : allowedContributionAmounts.has(amount);

      if (!Number.isFinite(amount) || !isAmountAllowed) {
        writeJson(request, response, 400, {
          error: 'Checkout amount is not allowed.'
        });
        return true;
      }

      if (!isAllowedContributionType(parsed.contributionType)) {
        writeJson(request, response, 400, {
          error: 'Checkout contribution type is not allowed.'
        });
        return true;
      }

      if (isSponsorshipContribution && !businessSponsorshipEnabled) {
        writeJson(request, response, 403, {
          error: 'Business sponsorship checkout is disabled.'
        });
        return true;
      }

      if (
        !isBoolean(parsed.publicDisplayConsent) ||
        !isBoolean(parsed.displayAmountConsent) ||
        parsed.nonCharityAcknowledged !== true
      ) {
        writeJson(request, response, 400, {
          error: 'Checkout consent fields are invalid or incomplete.'
        });
        return true;
      }

      if (
        parsed.publicDisplayConsent === true &&
        !isNonEmptySponsorText(
          parsed.publicDisplayName,
          PUBLIC_DISPLAY_NAME_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error:
            'Public display name is required when public display consent is granted.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.publicDisplayName,
          PUBLIC_DISPLAY_NAME_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Public display name is too long.'
        });
        return true;
      }

      // Legacy local fallback remains available. Acceptance opts into a local,
      // navigable Checkout and still confirms payment through the signed webhook.
      if (!stripe || (stripeApiHost && !navigableSimulatedCheckout)) {
        if (!isProduction) {
          writeJson(
            request,
            response,
            200,
            createDevelopmentCheckoutResult(parsed)
          );
          return true;
        }

        writeJson(request, response, 503, {
          error: 'Stripe checkout is not configured.'
        });
        return true;
      }

      try {
        const successUrl = resolveCheckoutReturnUrl(
          parsed.successUrl,
          '/?checkout=success'
        );
        const cancelUrl = resolveCheckoutReturnUrl(
          parsed.cancelUrl,
          '/?checkout=cancel'
        );
        const requiresReview =
          parsed.contributionType === 'sponsorship_interest';
        const sponsorshipFollowupToken = requiresReview
          ? createSponsorshipFollowupToken()
          : null;
        const sponsorshipFollowupTokenHash = sponsorshipFollowupToken
          ? hashSponsorshipFollowupToken(sponsorshipFollowupToken)
          : null;
        const publicReference = createContributionPublicReference();
        const checkoutCancelUrl = new URL(cancelUrl);
        checkoutCancelUrl.searchParams.set('reference', publicReference);
        const checkoutSuccessUrl = sponsorshipFollowupToken
          ? buildSponsorshipFollowupUrl(
              successUrl,
              sponsorshipFollowupToken,
              sponsorshipFollowupLocaleFromUrl(successUrl)
            )
          : buildContributionCheckoutSuccessUrl(successUrl, publicReference);
        const publicDisplayName =
          parsed.publicDisplayConsent === true &&
          typeof parsed.publicDisplayName === 'string'
            ? parsed.publicDisplayName.trim()
            : '';
        const checkoutMetadata: Record<string, string> = {
          projectId,
          project: 'openg7',
          program: 'builders_fund',
          publicReference,
          contributionType: parsed.contributionType,
          publicDisplayConsent: String(parsed.publicDisplayConsent),
          displayAmountConsent: String(parsed.displayAmountConsent),
          nonCharityAcknowledged: String(parsed.nonCharityAcknowledged),
          requiresReview: String(requiresReview),
          ...(publicDisplayName
            ? {
                publicDisplayName:
                  truncateStripeMetadataValue(publicDisplayName)
              }
            : {}),
          ...(sponsorshipFollowupTokenHash
            ? {
                sponsorshipFollowupTokenHash
              }
            : {})
        };

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          client_reference_id: publicReference,
          success_url: checkoutSuccessUrl,
          cancel_url: checkoutCancelUrl.toString(),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'cad',
                unit_amount: Math.round(amount * 100),
                product_data: {
                  name: `OpenG7 ${projectId} - ${publicReference}`,
                  description:
                    buildContributionReceiptDescription(publicReference)
                }
              }
            }
          ],
          payment_intent_data: {
            description: buildContributionReceiptDescription(publicReference),
            metadata: checkoutMetadata
          },
          metadata: checkoutMetadata
        });
        try {
          await insertCheckoutSessionRecord({
            stripeSessionId: session.id,
            stripePaymentIntentId: resolveStripePaymentIntentId(
              session.payment_intent
            ),
            publicReference,
            contributionType: parsed.contributionType,
            amountCents: Math.round(amount * 100),
            currency: 'cad',
            metadata: checkoutMetadata,
            publicDisplayConsent: parsed.publicDisplayConsent,
            publicName: publicDisplayName || null,
            displayAmountConsent: parsed.displayAmountConsent,
            nonCharityAcknowledged: parsed.nonCharityAcknowledged,
            sponsorshipFollowupTokenHash
          });
        } catch (error) {
          reportFailure('Failed to record Stripe checkout session.', error);
        }

        const result: RedirectCheckoutResult = {
          checkoutId: session.id,
          redirectUrl: session.url ?? successUrl,
          status: 'redirected'
        };

        writeJson(request, response, 200, result);
        return true;
      } catch (error) {
        reportFailure('Failed to create Stripe checkout session.', error);

        if (!isProduction) {
          writeJson(
            request,
            response,
            200,
            createDevelopmentCheckoutResult(parsed)
          );
          return true;
        }

        writeJson(request, response, 502, {
          error: 'Stripe checkout session could not be created.'
        });
        return true;
      }
    }

    return false;
  };

  return handlePublicPaymentsRequest;
};
