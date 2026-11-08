import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PublicationWorkshopState } from '@openg7/funding-core';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport } from '../http-transport.js';

import {
  PublicationWorkshopError,
  type PublicationWorkshopService
} from './workshop.js';

interface Dependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAuthorization: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly canManage: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: (
    request: IncomingMessage,
    maxBytes: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly service: Pick<
    PublicationWorkshopService,
    'read' | 'prepare' | 'adopt'
  > | null;
}

const scopeHeader =
  /^(?:x-)?(?:(?:preflight|funding|source)-)?(?:tenant(?:[-_]id)?|applications?|allowed[-_]applications|roles?|subject)$/i;
const invalid = () =>
  new PublicationWorkshopError('PUBLICATION_WORKSHOP_INVALID_REQUEST', 400);

function parseCommand(
  raw: unknown,
  action: 'prepare' | 'adopt'
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const body = raw as Record<string, unknown>;
  const allowed = [
    'contributionId',
    'requestId',
    'expectedSourceVersion',
    ...(action === 'adopt' ? ['proposalId'] : [])
  ];
  if (
    Object.keys(body).length !== allowed.length ||
    Object.keys(body).some((key) => !allowed.includes(key)) ||
    !isValidUuid(body.contributionId) ||
    !isValidUuid(body.requestId) ||
    !(
      (action === 'prepare' && body.expectedSourceVersion === null) ||
      (Number.isSafeInteger(body.expectedSourceVersion) &&
        Number(body.expectedSourceVersion) > 0)
    ) ||
    (action === 'adopt' && !isValidUuid(body.proposalId))
  )
    throw invalid();
  return body;
}

/** Private read and explicit draft adoption; no publication or approval command is exposed. */
export function createPublicationWorkshopHttpHandler(deps: Dependencies) {
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    } catch {
      return false;
    }
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    const base = '/admin/sponsorships/publication-workshop';
    const action =
      path === base + '/prepare'
        ? 'prepare'
        : path === base + '/adopt'
          ? 'adopt'
          : null;
    if (path !== base && !action) return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAuthorization(request, response)) return true;
    const write = (status: number, payload: unknown) =>
      deps.writeJson(request, response, status, payload, {
        'Cache-Control': 'private, no-store'
      });
    try {
      if (request.method !== (action ? 'POST' : 'GET')) {
        response.setHeader('Allow', action ? 'POST' : 'GET');
        throw new PublicationWorkshopError('METHOD_NOT_ALLOWED', 405);
      }
      if (Object.keys(request.headers).some((key) => scopeHeader.test(key)))
        throw invalid();
      let result: PublicationWorkshopState;
      if (!action) {
        const ids = url.searchParams.getAll('contributionId');
        if (
          url.searchParams.size !== 1 ||
          ids.length !== 1 ||
          !isValidUuid(ids[0])
        )
          throw invalid();
        const contributionId = ids[0]!.toLowerCase();
        result = deps.service
          ? await deps.service.read(contributionId)
          : {
              contributionId,
              enabled: false,
              sourceVersion: null,
              sourceSnapshotDigest: null,
              mission: null,
              proposal: null,
              history: [],
              canPrepare: false,
              canAdopt: false
            };
      } else {
        if (
          !deps.canManage(request) ||
          request.headers.origin !== deps.publicBaseOrigin
        )
          throw new PublicationWorkshopError(
            'PUBLICATION_WORKSHOP_FORBIDDEN',
            403
          );
        if (url.search) throw invalid();
        if (!isJsonContentType(request.headers['content-type']))
          throw new PublicationWorkshopError('UNSUPPORTED_MEDIA_TYPE', 415);
        let raw: unknown;
        try {
          raw = JSON.parse(await deps.readBody(request, 4096));
        } catch {
          throw invalid();
        }
        const body = parseCommand(raw, action);
        if (!deps.service)
          throw new PublicationWorkshopError(
            'PUBLICATION_WORKSHOP_DISABLED',
            409
          );
        result = await deps.service[action](
          body,
          deps.getAdminAuditActor(request)
        );
      }
      const canManage = deps.canManage(request);
      write(200, {
        ...result,
        canPrepare: result.canPrepare && canManage,
        canAdopt: result.canAdopt && canManage
      });
    } catch (error) {
      const known = error instanceof PublicationWorkshopError;
      write(known ? error.status : 503, {
        code: known ? error.code : 'PUBLICATION_WORKSHOP_UNAVAILABLE',
        error: 'Publication preparation could not be read or updated.'
      });
    }
    return true;
  };
}
