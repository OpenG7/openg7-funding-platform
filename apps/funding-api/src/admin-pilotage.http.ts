import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminIdentityService } from './admin-identity.js';
import type {
  AdminPilotageService,
  PilotError
} from './admin-pilotage.service.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type { PublicationAutomationError } from './publication-automation/policy.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Service ports keep request receipts, versions, confirmations and domain audit authoritative. */
export type AdminPilotageHttpPort = Pick<
  AdminPilotageService,
  'state' | 'command' | 'readReceipt' | 'acknowledgeReceipt'
> & {
  readonly editorial: Pick<
    AdminPilotageService['editorial'],
    'state' | 'propose' | 'variant'
  >;
};

export interface AdminPilotageHttpDependencies {
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
  readonly adminPilotage: AdminPilotageHttpPort | null;
  readonly adminIdentity: Pick<AdminIdentityService, 'identity'> | null;
  readonly PilotError: typeof PilotError;
  readonly PublicationAutomationError: typeof PublicationAutomationError;
}

/** Authorize before body or service access; unrelated paths fall through untouched. */
export const createAdminPilotageHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  adminPilotage,
  adminIdentity,
  PilotError,
  PublicationAutomationError
}: AdminPilotageHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      routeMatches(
        request.url,
        '/admin/pilotage',
        '/api/admin/pilotage',
        '/admin/pilotage/command',
        '/api/admin/pilotage/command',
        '/admin/pilotage/receipt',
        '/api/admin/pilotage/receipt',
        '/admin/pilotage/programme',
        '/api/admin/pilotage/programme',
        '/admin/pilotage/variant',
        '/api/admin/pilotage/variant'
      )
    ) {
      response.setHeader('Cache-Control', 'private, no-store');
      if (!ensureAdminAccess(request, response)) return true;
      if (!adminPilotage) {
        writeJson(request, response, 503, { code: 'PILOTAGE_UNAVAILABLE' });
        return true;
      }
      try {
        const url = new URL(request.url ?? '/', publicBaseOrigin);
        const writable = adminIdentity?.identity(request)?.role !== 'reader';
        const owner =
          !adminIdentity || adminIdentity.identity(request)?.role === 'owner';
        const actor = getAdminAuditActor(request);
        if (
          url.pathname.endsWith('/programme') ||
          url.pathname.endsWith('/variant')
        ) {
          if (request.method === 'GET' && url.pathname.endsWith('/programme')) {
            writeJson(
              request,
              response,
              200,
              await adminPilotage.editorial.state(writable)
            );
          } else if (request.method === 'POST') {
            if (!writable) throw new PilotError('READ_ONLY', 403);
            if (
              !request.headers['content-type']
                ?.toLowerCase()
                .startsWith('application/json')
            )
              throw new PilotError('INVALID_COMMAND', 415);
            const input = JSON.parse(await readBody(request, 4096));
            const result = url.pathname.endsWith('/variant')
              ? await adminPilotage.editorial.variant(input)
              : await adminPilotage.editorial.propose(input);
            writeJson(request, response, 200, result);
          } else
            writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
        } else if (
          request.method === 'POST' &&
          url.pathname.endsWith('/command')
        ) {
          if (
            !request.headers['content-type']
              ?.toLowerCase()
              .startsWith('application/json')
          )
            throw new PilotError('INVALID_COMMAND', 415);
          writeJson(
            request,
            response,
            200,
            await adminPilotage.command(
              JSON.parse(await readBody(request, 16 * 1024)),
              actor,
              writable,
              owner
            )
          );
        } else if (
          request.method === 'POST' &&
          url.pathname.endsWith('/receipt')
        ) {
          if (!writable) throw new PilotError('READ_ONLY', 403);
          if (
            !request.headers['content-type']
              ?.toLowerCase()
              .startsWith('application/json')
          )
            throw new PilotError('INVALID_COMMAND', 415);
          writeJson(
            request,
            response,
            200,
            await adminPilotage.acknowledgeReceipt(
              JSON.parse(await readBody(request, 4096)),
              actor
            )
          );
        } else if (
          request.method === 'GET' &&
          url.pathname.endsWith('/receipt')
        ) {
          const result = await adminPilotage.readReceipt(
            url.searchParams.get('id') ?? '',
            actor
          );
          writeJson(
            request,
            response,
            result ? 200 : 404,
            result ?? { code: 'RECEIPT_NOT_FOUND' }
          );
        } else if (
          request.method === 'GET' &&
          url.pathname.endsWith('/pilotage')
        ) {
          const page = Number(url.searchParams.get('page') ?? 1);
          if (!Number.isSafeInteger(page) || page < 1)
            throw new PilotError('INVALID_QUERY', 400);
          writeJson(
            request,
            response,
            200,
            await adminPilotage.state(
              {
                page,
                domain: url.searchParams.get('domain') ?? undefined,
                id: url.searchParams.get('id') ?? undefined
              },
              writable,
              owner
            )
          );
        } else
          writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof PilotError ||
            error instanceof PublicationAutomationError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503,
          {
            code:
              error instanceof PilotError ||
              error instanceof PublicationAutomationError
                ? error.code
                : 'PILOTAGE_UNAVAILABLE'
          }
        );
      }
      return true;
    }

    return false;
  };
};
