import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  SponsorshipDetailsResult,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse
} from '@openg7/funding-core';

import { isSafeSponsorshipText } from '../../../packages/funding-core/src/index.js';

import type { SponsorshipFollowupLookup } from './fund-contributions.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type {
  getSponsorshipDraft,
  normalizeRecoveryEmail,
  recoverSponsorshipAccess,
  saveSponsorshipDraft,
  submitSponsorshipDraft
} from './sponsorship-access.service.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Bound follow-up ports retain token/payment authority and transactional draft submission. */
export interface SponsorshipFollowupHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly databaseAvailable: () => boolean;
  readonly hasDatabase: boolean;
  readonly sponsorshipFollowupTokenTtlDays: number;
  readonly SPONSOR_TEXT_MAX_LENGTH: number;
  readonly SPONSOR_MESSAGE_MAX_LENGTH: number;
  readonly followupEditablePaymentStatuses: ReadonlySet<string>;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidFollowupToken: (value: unknown) => value is string;
  readonly hasOnlyKeys: (value: unknown, keys: readonly string[]) => boolean;
  readonly isNonEmptySponsorText: (
    value: unknown,
    maxLength: number
  ) => value is string;
  readonly isValidSponsorEmail: (value: unknown) => value is string;
  readonly isValidOptionalHttpsUrl: (value: unknown) => boolean;
  readonly truncateStripeMetadataValue: (value: string) => string;
  readonly normalizeRecoveryEmail: typeof normalizeRecoveryEmail;
  readonly SponsorshipAccessError: new (
    status: number,
    code?: string
  ) => Error & { readonly status: number; readonly code: string };
  readonly getFreshSponsorshipFollowupByToken: (
    token: string
  ) => Promise<SponsorshipFollowupLookup | null>;
  readonly recoverSponsorshipAccess: (
    email: string,
    options: Parameters<typeof recoverSponsorshipAccess>[2]
  ) => ReturnType<typeof recoverSponsorshipAccess>;
  readonly getSponsorshipDraft: (
    token: string,
    ttlDays: number
  ) => ReturnType<typeof getSponsorshipDraft>;
  readonly saveSponsorshipDraft: (
    token: string,
    ttlDays: number,
    expectedRevision: Parameters<typeof saveSponsorshipDraft>[3],
    input: unknown
  ) => ReturnType<typeof saveSponsorshipDraft>;
  readonly submitSponsorshipDraft: (
    token: string,
    ttlDays: number,
    expectedRevision: Parameters<typeof submitSponsorshipDraft>[3],
    input: Parameters<typeof submitSponsorshipDraft>[4]
  ) => ReturnType<typeof submitSponsorshipDraft>;
  readonly updateStripePaymentIntentMetadata?: (
    paymentIntentId: string,
    input: { readonly metadata: Record<string, string> }
  ) => Promise<unknown>;
  readonly reportFailure: (message: string, error?: unknown) => void;
}

/** The global JSON gate remains upstream; unmatched admin, legacy and media routes fall through. */
export const createSponsorshipFollowupHttpHandler = ({
  publicBaseOrigin,
  databaseAvailable,
  hasDatabase,
  sponsorshipFollowupTokenTtlDays,
  SPONSOR_TEXT_MAX_LENGTH,
  SPONSOR_MESSAGE_MAX_LENGTH,
  followupEditablePaymentStatuses,
  readBody,
  writeJson,
  isValidFollowupToken,
  hasOnlyKeys,
  isNonEmptySponsorText,
  isValidSponsorEmail,
  isValidOptionalHttpsUrl,
  truncateStripeMetadataValue,
  normalizeRecoveryEmail,
  SponsorshipAccessError,
  getFreshSponsorshipFollowupByToken,
  recoverSponsorshipAccess,
  getSponsorshipDraft,
  saveSponsorshipDraft,
  submitSponsorshipDraft,
  updateStripePaymentIntentMetadata,
  reportFailure
}: SponsorshipFollowupHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/sponsorship-followup/recover',
        '/api/sponsorship-followup/recover'
      )
    ) {
      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Recovery is unavailable.'
        });
        return true;
      }
      let email: string;
      let locale: 'fr-CA' | 'en';
      try {
        const input = JSON.parse(await readBody(request, 8 * 1024));
        if (!hasOnlyKeys(input, ['email', 'locale']))
          throw new SponsorshipAccessError(400, 'validation');
        if (
          input.locale !== undefined &&
          !['fr-CA', 'en'].includes(input.locale)
        )
          throw new SponsorshipAccessError(400, 'validation');
        email = normalizeRecoveryEmail(input?.email);
        locale = input?.locale === 'en' ? 'en' : 'fr-CA';
      } catch {
        writeJson(request, response, 400, {
          error: 'A valid email is required.'
        });
        return true;
      }
      try {
        await recoverSponsorshipAccess(email, {
          baseUrl: publicBaseOrigin,
          ttlDays: sponsorshipFollowupTokenTtlDays,
          locale
        });
      } catch {
        // Same public response even if a matching dossier encounters a queue error.
        reportFailure('Sponsorship access recovery could not be queued.');
      }
      writeJson(request, response, 202, { accepted: true });
      return true;
    }

    if (
      routeMatches(
        request.url,
        '/sponsorship-followup/draft',
        '/api/sponsorship-followup/draft'
      ) &&
      ['GET', 'POST'].includes(request.method ?? '')
    ) {
      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Draft storage is unavailable.'
        });
        return true;
      }
      try {
        const input =
          request.method === 'POST'
            ? JSON.parse(await readBody(request, 16 * 1024))
            : null;
        if (
          request.method === 'POST' &&
          !hasOnlyKeys(input, ['token', 'expectedRevision', 'data'])
        )
          throw new SponsorshipAccessError(400, 'validation');
        const token =
          request.method === 'POST'
            ? input?.token
            : new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
                'token'
              );
        if (!isValidFollowupToken(token))
          throw new SponsorshipAccessError(404, 'access');
        const result =
          request.method === 'GET'
            ? await getSponsorshipDraft(token, sponsorshipFollowupTokenTtlDays)
            : await saveSponsorshipDraft(
                token,
                sponsorshipFollowupTokenTtlDays,
                input?.expectedRevision,
                input?.data
              );
        writeJson(request, response, 200, result);
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof SponsorshipAccessError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503,
          {
            error: 'Draft operation failed.',
            code:
              error instanceof SponsorshipAccessError
                ? error.code
                : 'unavailable'
          }
        );
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/sponsorship-followup',
        '/api/sponsorship-followup'
      )
    ) {
      if (!hasDatabase) {
        writeJson(request, response, 503, {
          error: 'Sponsorship follow-up requires DATABASE_URL.'
        });
        return true;
      }

      const token = new URL(
        request.url ?? '/',
        publicBaseOrigin
      ).searchParams.get('token');
      if (!isValidFollowupToken(token)) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship follow-up token.'
        });
        return true;
      }

      try {
        const followup = await getFreshSponsorshipFollowupByToken(token);

        if (!followup) {
          writeJson(request, response, 404, {
            error: 'Sponsorship follow-up was not found.'
          });
          return true;
        }

        const result: SponsorshipFollowupResponse = {
          found: true,
          paymentStatus: followup.paymentStatus,
          publicReference: followup.publicReference,
          reviewStatus: followup.reviewStatus,
          amount: followup.amount,
          currency: followup.currency,
          paidAt: followup.paidAt,
          sponsorshipTier: followup.sponsorshipTier,
          sponsorshipBenefits: followup.sponsorshipBenefits,
          detailsSubmitted: followup.detailsSubmitted,
          companyName: followup.companyName,
          contactName: followup.contactName,
          contactEmail: followup.contactEmail,
          websiteUrl: followup.websiteUrl,
          logoUrl: followup.logoUrl,
          message: followup.message,
          reviewedAt: followup.reviewedAt
        };

        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load sponsorship follow-up.', error);
        writeJson(request, response, 502, {
          error: 'Sponsorship follow-up could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/sponsorship-followup/details',
        '/api/sponsorship-followup/details'
      )
    ) {
      if (!hasDatabase) {
        writeJson(request, response, 503, {
          error: 'Sponsorship follow-up requires DATABASE_URL.'
        });
        return true;
      }

      let parsed: SponsorshipFollowupDetailsRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = JSON.parse(body) as SponsorshipFollowupDetailsRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship follow-up request body.'
        });
        return true;
      }

      if (
        !hasOnlyKeys(parsed, [
          'token',
          'draftRevision',
          'companyName',
          'contactName',
          'contactEmail',
          'websiteUrl',
          'logoUrl',
          'message'
        ]) ||
        !isValidFollowupToken(parsed.token)
      ) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship follow-up token.'
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

      try {
        const followup = await getFreshSponsorshipFollowupByToken(parsed.token);

        if (!followup) {
          writeJson(request, response, 404, {
            error: 'Sponsorship follow-up was not found.'
          });
          return true;
        }

        if (!followupEditablePaymentStatuses.has(followup.paymentStatus)) {
          writeJson(request, response, 409, {
            error: 'Payment for this sponsorship is not confirmed yet.'
          });
          return true;
        }

        const companyName = parsed.companyName.trim();
        const contactName = parsed.contactName.trim();
        const contactEmail = parsed.contactEmail.trim();
        const websiteUrl = parsed.websiteUrl?.trim() || null;
        const logoUrl = parsed.logoUrl?.trim() || null;
        const message = parsed.message?.trim() || null;

        const recorded = await submitSponsorshipDraft(
          parsed.token,
          sponsorshipFollowupTokenTtlDays,
          parsed.draftRevision,
          {
            companyName,
            contactName,
            contactEmail,
            websiteUrl: websiteUrl ?? '',
            logoUrl: logoUrl ?? '',
            message: message ?? ''
          }
        );

        if (
          updateStripePaymentIntentMetadata &&
          followup.stripePaymentIntentId
        ) {
          try {
            await updateStripePaymentIntentMetadata(
              followup.stripePaymentIntentId,
              {
                metadata: {
                  sponsorCompanyName: truncateStripeMetadataValue(companyName),
                  sponsorContactName: truncateStripeMetadataValue(contactName),
                  sponsorContactEmail:
                    truncateStripeMetadataValue(contactEmail),
                  ...(websiteUrl
                    ? {
                        sponsorWebsiteUrl:
                          truncateStripeMetadataValue(websiteUrl)
                      }
                    : {}),
                  ...(logoUrl
                    ? { sponsorLogoUrl: truncateStripeMetadataValue(logoUrl) }
                    : {}),
                  ...(message
                    ? { sponsorMessage: truncateStripeMetadataValue(message) }
                    : {})
                }
              }
            );
          } catch (error) {
            reportFailure(
              'Failed to update Stripe metadata with follow-up details.',
              error
            );
          }
        }

        const result: SponsorshipDetailsResult = { received: true, recorded };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to record sponsorship follow-up details.');
        writeJson(
          request,
          response,
          error instanceof SponsorshipAccessError ? error.status : 502,
          {
            error: 'Sponsorship follow-up details could not be recorded.',
            code:
              error instanceof SponsorshipAccessError
                ? error.code
                : 'unavailable'
          }
        );
      }
      return true;
    }

    return false;
  };
};
