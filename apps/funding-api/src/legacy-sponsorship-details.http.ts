import type { IncomingMessage, ServerResponse } from 'node:http';

import type Stripe from 'stripe';
import type {
  SponsorshipDetailsRequest,
  SponsorshipDetailsResult
} from '@openg7/funding-core';

import { isSafeSponsorshipText } from '../../../packages/funding-core/src/index.js';

import { normalizeContributionPublicReference } from './contribution-public-reference.js';
import {
  normalizeContributionType,
  parseMetadataBoolean
} from './fund-contributions.repository.js';
import type { recordSponsorshipDetails } from './fund-contributions.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type {
  createHttpTransport,
  readBody as readHttpBody
} from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface LegacySponsorshipDetailsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly readBody: typeof readHttpBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly SPONSOR_TEXT_MAX_LENGTH: number;
  readonly SPONSOR_MESSAGE_MAX_LENGTH: number;
  readonly stripe: {
    readonly checkout: {
      readonly sessions: Pick<Stripe['checkout']['sessions'], 'retrieve'>;
    };
    readonly paymentIntents: Pick<Stripe['paymentIntents'], 'update'>;
  } | null;
  readonly isNonEmptySponsorText: (
    value: unknown,
    maxLength: number
  ) => value is string;
  readonly isValidSponsorEmail: (value: unknown) => value is string;
  readonly isValidOptionalHttpsUrl: (value: unknown) => boolean;
  readonly truncateStripeMetadataValue: (value: string) => string;
  readonly resolveStripePaymentIntentId: (
    value: string | Stripe.PaymentIntent | null
  ) => string | null;
  readonly reportFailure: (message: string, error?: unknown) => void;
  readonly recordSponsorshipDetails: (
    input: Parameters<typeof recordSponsorshipDetails>[1]
  ) => ReturnType<typeof recordSponsorshipDetails>;
}

export const createLegacySponsorshipDetailsHttpHandler = ({
  publicBaseOrigin,
  readBody,
  writeJson,
  SPONSOR_TEXT_MAX_LENGTH,
  SPONSOR_MESSAGE_MAX_LENGTH,
  stripe,
  isNonEmptySponsorText,
  isValidSponsorEmail,
  isValidOptionalHttpsUrl,
  truncateStripeMetadataValue,
  resolveStripePaymentIntentId,
  reportFailure,
  recordSponsorshipDetails
}: LegacySponsorshipDetailsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  const handleLegacySponsorshipDetailsRequest = async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/sponsorship-details',
        '/api/sponsorship-details'
      )
    ) {
      if (!stripe) {
        writeJson(request, response, 503, {
          error: 'Stripe is not configured.'
        });
        return true;
      }

      let parsed: SponsorshipDetailsRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as SponsorshipDetailsRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship details request body.'
        });
        return true;
      }

      if (
        typeof parsed.sessionId !== 'string' ||
        !parsed.sessionId.startsWith('cs_') ||
        parsed.sessionId.length > 200
      ) {
        writeJson(request, response, 400, {
          error: 'Invalid Stripe checkout session id.'
        });
        return true;
      }

      if (
        !isSafeSponsorshipText(parsed.companyName) ||
        parsed.companyName.length > SPONSOR_TEXT_MAX_LENGTH ||
        !isNonEmptySponsorText(parsed.companyName, SPONSOR_TEXT_MAX_LENGTH)
      ) {
        writeJson(request, response, 400, {
          error: 'Company name is required.'
        });
        return true;
      }

      if (
        !isSafeSponsorshipText(parsed.contactName) ||
        parsed.contactName.length > SPONSOR_TEXT_MAX_LENGTH ||
        !isNonEmptySponsorText(parsed.contactName, SPONSOR_TEXT_MAX_LENGTH)
      ) {
        writeJson(request, response, 400, {
          error: 'Contact name is required.'
        });
        return true;
      }

      if (!isValidSponsorEmail(parsed.contactEmail)) {
        writeJson(request, response, 400, {
          error: 'A valid contact email is required.'
        });
        return true;
      }

      if (!isValidOptionalHttpsUrl(parsed.websiteUrl)) {
        writeJson(request, response, 400, {
          error: 'Website URL must be a valid https link.'
        });
        return true;
      }

      if (!isValidOptionalHttpsUrl(parsed.logoUrl)) {
        writeJson(request, response, 400, {
          error: 'Logo URL must be a valid https link.'
        });
        return true;
      }

      if (
        parsed.message !== undefined &&
        (!isSafeSponsorshipText(parsed.message, true) ||
          parsed.message.length > SPONSOR_MESSAGE_MAX_LENGTH)
      ) {
        writeJson(request, response, 400, {
          error: 'Message is too long.'
        });
        return true;
      }

      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(parsed.sessionId, {
          expand: ['payment_intent']
        });
      } catch {
        writeJson(request, response, 404, {
          error: 'Checkout session not found.'
        });
        return true;
      }

      const sessionMetadata = session.metadata ?? {};
      if (
        normalizeContributionType(sessionMetadata.contributionType) !==
        'sponsorship_interest'
      ) {
        writeJson(request, response, 400, {
          error:
            'This checkout session is not a sponsorship interest contribution.'
        });
        return true;
      }

      if (session.payment_status !== 'paid') {
        writeJson(request, response, 409, {
          error: 'Payment for this checkout session is not confirmed yet.'
        });
        return true;
      }

      const paymentIntentId = resolveStripePaymentIntentId(
        session.payment_intent
      );
      const paymentIntentCreatedIso =
        session.payment_intent && typeof session.payment_intent !== 'string'
          ? new Date(session.payment_intent.created * 1000).toISOString()
          : new Date(session.created * 1000).toISOString();

      const companyName = parsed.companyName.trim();
      const contactName = parsed.contactName.trim();
      const contactEmail = parsed.contactEmail.trim();
      const websiteUrl = parsed.websiteUrl?.trim() || null;
      const logoUrl = parsed.logoUrl?.trim() || null;
      const message = parsed.message?.trim() || null;

      if (paymentIntentId) {
        try {
          await stripe.paymentIntents.update(paymentIntentId, {
            metadata: {
              sponsorCompanyName: truncateStripeMetadataValue(companyName),
              sponsorContactName: truncateStripeMetadataValue(contactName),
              sponsorContactEmail: truncateStripeMetadataValue(contactEmail),
              ...(websiteUrl
                ? { sponsorWebsiteUrl: truncateStripeMetadataValue(websiteUrl) }
                : {}),
              ...(logoUrl
                ? { sponsorLogoUrl: truncateStripeMetadataValue(logoUrl) }
                : {}),
              ...(message
                ? { sponsorMessage: truncateStripeMetadataValue(message) }
                : {})
            }
          });
        } catch (error) {
          reportFailure(
            'Failed to update Stripe metadata with sponsorship details.',
            error
          );
        }
      }

      let recorded = false;
      try {
        recorded = await recordSponsorshipDetails({
          stripeSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
          publicReference: normalizeContributionPublicReference(
            sessionMetadata.publicReference
          ),
          amountCents: session.amount_total ?? 0,
          currency: session.currency ?? 'cad',
          publicDisplayConsent: parseMetadataBoolean(
            sessionMetadata.publicDisplayConsent
          ),
          displayAmountConsent: parseMetadataBoolean(
            sessionMetadata.displayAmountConsent
          ),
          nonCharityAcknowledged: parseMetadataBoolean(
            sessionMetadata.nonCharityAcknowledged
          ),
          paidAtIso: paymentIntentCreatedIso,
          companyName,
          contactName,
          contactEmail,
          websiteUrl,
          logoUrl,
          message
        });
      } catch (error) {
        reportFailure('Failed to record sponsorship details.', error);
      }

      const result: SponsorshipDetailsResult = { received: true, recorded };
      writeJson(request, response, 200, result);
      return true;
    }

    return false;
  };

  return handleLegacySponsorshipDetailsRequest;
};
