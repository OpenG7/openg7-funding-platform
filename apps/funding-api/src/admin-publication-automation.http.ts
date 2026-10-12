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
> &
  Partial<
    Pick<PublicationAutomationService, 'imagePreview' | 'reliabilityIncidents'>
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
  readonly writeBinary?: ReturnType<typeof createHttpTransport>['writeBinary'];
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
  writeBinary,
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
        '/admin/publication-automation/incidents',
        '/api/admin/publication-automation/incidents'
      )
    ) {
      if (!ensureAdminAccess(request, response)) return true;
      try {
        if (request.method !== 'GET')
          throw new PublicationAutomationError('METHOD_NOT_ALLOWED', 405);
        if (!publicationAutomation?.reliabilityIncidents)
          throw new PublicationAutomationError('RELIABILITY_UNAVAILABLE', 503);
        const query = new URL(request.url ?? '/', publicBaseOrigin)
          .searchParams;
        const filter: import('@openg7/funding-core').PublicationReliabilityIncidentFilter =
          {
            ...(query.has('code')
              ? {
                  code: query.get(
                    'code'
                  ) as import('@openg7/funding-core').PublicationReliabilityIncidentCode
                }
              : {}),
            ...(query.has('subjectType')
              ? {
                  subjectType: query.get(
                    'subjectType'
                  ) as import('@openg7/funding-core').PublicationReliabilitySubjectType
                }
              : {}),
            ...(query.has('cursor') ? { cursor: query.get('cursor')! } : {})
          };
        const result = await publicationAutomation.reliabilityIncidents(filter);
        writeJson(request, response, 200, result, {
          'Cache-Control': 'private, no-store'
        });
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof PublicationAutomationError ? error.status : 503,
          {
            code:
              error instanceof PublicationAutomationError
                ? error.code
                : 'RELIABILITY_UNAVAILABLE'
          }
        );
      }
      return true;
    }
    if (
      routeMatches(
        request.url,
        '/admin/publication-automation/image-preview',
        '/api/admin/publication-automation/image-preview'
      )
    ) {
      if (!ensureAdminAccess(request, response) || !publicationAutomation)
        return true;
      try {
        if (request.method !== 'GET')
          throw new PublicationAutomationError('METHOD_NOT_ALLOWED', 405);
        const query = new URL(request.url ?? '/', publicBaseOrigin)
          .searchParams;
        const version = query.get('version');
        if (!version || !/^\d+$/.test(version))
          throw new PublicationAutomationError('INVALID_FILTER', 400);
        if (!writeBinary || !publicationAutomation.imagePreview)
          throw new PublicationAutomationError('AUTOMATION_UNAVAILABLE', 503);
        const image = await publicationAutomation.imagePreview(
          query.get('deliveryId') ?? '',
          Number(version)
        );
        writeBinary(request, response, 200, image.bytes, image.mimeType, {
          'Cache-Control': 'private, no-store',
          'X-Content-SHA256': image.sha256,
          'X-Publication-Delivery-Version': version
        });
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof PublicationAutomationError ? error.status : 503,
          {
            code:
              error instanceof PublicationAutomationError
                ? error.code
                : 'AUTOMATION_UNAVAILABLE'
          }
        );
      }
      return true;
    }
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
          const queueOffset = automationUrl.searchParams.get('queueOffset');
          if (
            !isMedia &&
            queueOffset !== null &&
            (!/^\d+$/.test(queueOffset) ||
              !Number.isSafeInteger(Number(queueOffset)))
          )
            throw new PublicationAutomationError('INVALID_FILTER', 400);
          writeJson(
            request,
            response,
            200,
            isMedia
              ? await publicationAutomation.mediaOptions(
                  automationUrl.searchParams.get('deliveryId') ?? undefined
                )
              : await publicationAutomation.state(undefined, {
                  sponsorshipId:
                    automationUrl.searchParams.get('sponsorshipId') ??
                    undefined,
                  deliveryId:
                    automationUrl.searchParams.get('deliveryId') ?? undefined,
                  ...(queueOffset !== null
                    ? { queueOffset: Number(queueOffset) }
                    : {})
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
