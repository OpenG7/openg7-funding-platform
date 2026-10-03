import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminSponsorshipAccessResult } from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface AdminSponsorshipAccessHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ttlDays: number;
  readonly databaseAvailable: () => boolean;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidUuid: (value: unknown) => value is string;
  readonly normalizeRecoveryEmail: (value: unknown) => string;
  readonly SponsorshipAccessError: new (
    status: number,
    code?: string
  ) => Error & { readonly status: number; readonly code: string };
  readonly getSponsorshipAccessRecipient: (
    contributionId: string
  ) => Promise<string | null>;
  readonly issueSponsorshipAccess: (
    contributionId: string,
    recipient: string,
    options: { baseUrl: string; ttlDays: number; locale: 'fr-CA' | 'en' },
    admin: { actor: string; requestId: string }
  ) => Promise<AdminSponsorshipAccessResult>;
}

/** The service retains recipient comparison, request deduplication and audit. */
export const createAdminSponsorshipAccessHttpHandler = ({
  publicBaseOrigin,
  ttlDays,
  databaseAvailable,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  isValidUuid,
  normalizeRecoveryEmail,
  SponsorshipAccessError,
  getSponsorshipAccessRecipient,
  issueSponsorshipAccess
}: AdminSponsorshipAccessHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      !routeMatches(
        request.url,
        '/admin/sponsorships/followup-access',
        '/api/admin/sponsorships/followup-access'
      ) ||
      !['GET', 'POST'].includes(request.method ?? '')
    )
      return false;
    if (!ensureAdminAccess(request, response)) return true;
    if (!databaseAvailable()) {
      writeJson(request, response, 503, { error: 'Recovery is unavailable.' });
      return true;
    }
    try {
      if (request.method === 'GET') {
        const id =
          new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
            'contributionId'
          ) ?? '';
        if (!isValidUuid(id))
          throw new SponsorshipAccessError(400, 'validation');
        writeJson(request, response, 200, {
          recipient: await getSponsorshipAccessRecipient(id)
        });
      } else {
        const input = JSON.parse(await readBody(request, 8 * 1024));
        if (
          !input ||
          !isValidUuid(input.contributionId) ||
          !isValidUuid(input.requestId) ||
          input.confirmed !== true
        )
          throw new SponsorshipAccessError(400, 'validation');
        const recipient = normalizeRecoveryEmail(input.recipient);
        const result = await issueSponsorshipAccess(
          input.contributionId,
          recipient,
          {
            baseUrl: publicBaseOrigin,
            ttlDays,
            locale: input.locale === 'en' ? 'en' : 'fr-CA'
          },
          { actor: getAdminAuditActor(request), requestId: input.requestId }
        );
        writeJson(request, response, 200, result);
      }
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
          error: 'Access link could not be queued.',
          code:
            error instanceof SponsorshipAccessError ? error.code : 'unavailable'
        }
      );
    }
    return true;
  };
};
