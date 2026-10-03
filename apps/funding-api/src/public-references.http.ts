import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  PublicReferenceLookupRequest,
  PublicReferenceLookupResponse,
  ReferenceRecoveryRequest,
  ReferenceRecoveryResult
} from '@openg7/funding-core';

import { normalizeContributionPublicReference } from './contribution-public-reference.js';
import type {
  lookupPublicContributionReference,
  listContributionReferencesByEmail
} from './fund-contributions.repository.js';
import type { queueContributionReferenceRecoveryEmail } from './email-notification.service.js';
import { createRouteMatcher } from './http-routing.js';
import type {
  createHttpTransport,
  readBody as readHttpBody
} from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface PublicReferencesHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly readBody: typeof readHttpBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly hasDatabase: boolean;
  readonly normalizeReferenceRecoveryEmail: (value: unknown) => string | null;
  readonly createReferenceRecoveryIdempotencyKey: (email: string) => string;
  readonly lookupPublicContributionReference: (
    publicReference: string
  ) => ReturnType<typeof lookupPublicContributionReference>;
  readonly listContributionReferencesByEmail: (
    email: string
  ) => ReturnType<typeof listContributionReferencesByEmail>;
  readonly queueContributionReferenceRecoveryEmail: (
    input: Parameters<typeof queueContributionReferenceRecoveryEmail>[1]
  ) => ReturnType<typeof queueContributionReferenceRecoveryEmail>;
  readonly reportFailure: (message: string, error?: unknown) => void;
  readonly reportWarning: (message: string) => void;
}

export const createPublicReferencesHttpHandlers = ({
  publicBaseOrigin,
  readBody,
  writeJson,
  hasDatabase,
  normalizeReferenceRecoveryEmail,
  createReferenceRecoveryIdempotencyKey,
  lookupPublicContributionReference,
  listContributionReferencesByEmail,
  queueContributionReferenceRecoveryEmail,
  reportFailure,
  reportWarning
}: PublicReferencesHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  const handleReferenceLookupRequest = async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(request.url, '/reference-lookup', '/api/reference-lookup')
    ) {
      if (!hasDatabase) {
        writeJson(request, response, 503, {
          error: 'Reference lookup requires DATABASE_URL.'
        });
        return true;
      }

      let parsed: Partial<PublicReferenceLookupRequest> | null;
      try {
        const body = await readBody(request, 4 * 1024);
        parsed = JSON.parse(
          body
        ) as Partial<PublicReferenceLookupRequest> | null;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid reference lookup request body.'
        });
        return true;
      }

      const publicReference = normalizeContributionPublicReference(
        parsed?.reference
      );
      if (!publicReference) {
        writeJson(request, response, 400, {
          error: 'A valid OpenG7 reference is required.'
        });
        return true;
      }

      try {
        const lookup = await lookupPublicContributionReference(publicReference);
        const result: PublicReferenceLookupResponse = lookup ?? {
          found: false,
          publicReference
        };

        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure(
          'Failed to look up public contribution reference.',
          error
        );
        writeJson(request, response, 502, {
          error: 'Reference lookup could not be completed.'
        });
      }
      return true;
    }

    return false;
  };

  const handleReferenceRecoveryRequest = async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/reference-recovery',
        '/api/reference-recovery'
      )
    ) {
      if (!hasDatabase) {
        writeJson(request, response, 503, {
          error: 'Reference recovery requires DATABASE_URL.'
        });
        return true;
      }

      let parsed: Partial<ReferenceRecoveryRequest> | null;
      try {
        const body = await readBody(request, 8 * 1024);
        parsed = JSON.parse(body) as Partial<ReferenceRecoveryRequest> | null;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid reference recovery request body.'
        });
        return true;
      }

      const email = normalizeReferenceRecoveryEmail(parsed?.email);
      if (!email) {
        writeJson(request, response, 400, {
          error: 'A valid email address is required.'
        });
        return true;
      }

      try {
        const references = await listContributionReferencesByEmail(email);

        if (references.length > 0) {
          try {
            const notificationResult =
              await queueContributionReferenceRecoveryEmail({
                to: email,
                references,
                idempotencyKey: createReferenceRecoveryIdempotencyKey(email)
              });

            if (!notificationResult.queued && !notificationResult.sent) {
              reportWarning(
                'Reference recovery email could not be queued or sent.'
              );
            }
          } catch {
            // A matching address must not be disclosed by a queue/SMTP failure.
            // Do not log the database error: it can contain private message data.
            reportFailure(
              'Reference recovery email could not be queued or sent.'
            );
          }
        }

        const result: ReferenceRecoveryResult = { accepted: true };
        writeJson(request, response, 202, result);
      } catch {
        reportFailure('Failed to process reference recovery request.');
        writeJson(request, response, 502, {
          error: 'Reference recovery request could not be processed.'
        });
      }
      return true;
    }

    return false;
  };

  return { handleReferenceLookupRequest, handleReferenceRecoveryRequest };
};
