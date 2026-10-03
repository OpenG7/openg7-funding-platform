import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PublicationAutomationCommand } from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type { PublicationAutomationError } from './publication-automation/policy.js';
import type { PublicationAutomationService } from './publication-automation/service.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** The service owns final approval, version checks, provider delivery and persistent audit. */
export type AdminPublicationAutomationHttpPort = Pick<
  PublicationAutomationService,
  'state' | 'mediaOptions' | 'command'
>;

export interface AdminPublicationAutomationHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (
    request: ApiRequest,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly publicationAutomation: AdminPublicationAutomationHttpPort | null;
  readonly PublicationAutomationError: typeof PublicationAutomationError;
}

/** Authorize before body or service access; unrelated paths fall through untouched. */
export const createAdminPublicationAutomationHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  publicationAutomation,
  PublicationAutomationError
}: AdminPublicationAutomationHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      routeMatches(
        request.url,
        '/admin/publication-automation',
        '/api/admin/publication-automation',
        '/admin/publication-automation/media',
        '/api/admin/publication-automation/media'
      )
    ) {
      if (!ensureAdminAccess(request, response) || !publicationAutomation)
        return true;
      try {
        if (request.method === 'GET') {
          const automationUrl = new URL(request.url ?? '/', publicBaseOrigin);
          const isMedia = automationUrl.pathname.endsWith('/media');
          writeJson(
            request,
            response,
            200,
            isMedia
              ? await publicationAutomation.mediaOptions()
              : await publicationAutomation.state(undefined, {
                  sponsorshipId:
                    automationUrl.searchParams.get('sponsorshipId') ??
                    undefined,
                  deliveryId:
                    automationUrl.searchParams.get('deliveryId') ?? undefined
                })
          );
        } else if (
          request.method === 'POST' &&
          !new URL(request.url ?? '/', publicBaseOrigin).pathname.endsWith(
            '/media'
          )
        ) {
          const input = JSON.parse(
            await readBody(request)
          ) as PublicationAutomationCommand;
          writeJson(
            request,
            response,
            200,
            await publicationAutomation.command(
              input,
              getAdminAuditActor(request)
            )
          );
        } else
          writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      } catch (error) {
        const status =
          error instanceof PublicationAutomationError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503;
        writeJson(request, response, status, {
          code:
            error instanceof PublicationAutomationError
              ? error.code
              : 'AUTOMATION_UNAVAILABLE'
        });
      }
      return true;
    }

    return false;
  };
};
