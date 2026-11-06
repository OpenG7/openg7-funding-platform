import type { IncomingMessage, ServerResponse } from 'node:http';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';
import type { AdminPreflightWorkSessionsService } from './admin-preflight-work-sessions.service.js';
import type { createHttpTransport } from './http-transport.js';
import { firstHeaderValue, isJsonContentType } from './http-routing.js';
import { isValidUuid } from './business-helpers/request-validation.js';

export interface AdminPreflightWorkSessionsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: (
    request: IncomingMessage,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly workSessions: Pick<
    AdminPreflightWorkSessionsService,
    'state' | 'start' | 'command' | 'saveDraft'
  > | null;
}
/** Existing identity, origin and role checks precede parsing and every private read. */
export function createAdminPreflightWorkSessionsHttpHandler(
  deps: AdminPreflightWorkSessionsHttpDependencies
) {
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
    const path = url.pathname.replace(/^\/api(?=\/)/, ''),
      base = '/admin/preflight/work-sessions';
    const command =
      /^\/admin\/preflight\/work-sessions\/([0-9a-f-]{36})\/commands$/i.exec(
        path
      );
    const save = path === '/admin/sponsorships/preparation/service/save-draft';
    if (path !== base && !command && !save) return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    try {
      if (!deps.workSessions)
        throw new AdminAutomaticRunError('WORK_SESSION_UNAVAILABLE', 503);
      const actor = deps.getAdminAuditActor(request);
      if (request.method === 'GET' && path === base) {
        for (const name of url.searchParams.keys())
          if (
            !['sessionId', 'requestId'].includes(name) ||
            url.searchParams.getAll(name).length !== 1
          )
            throw new AdminAutomaticRunError(
              'WORK_SESSION_INVALID_REQUEST',
              400
            );
        const sessionId = url.searchParams.get('sessionId') ?? undefined,
          requestId = url.searchParams.get('requestId') ?? undefined;
        if (
          (sessionId !== undefined && !isValidUuid(sessionId)) ||
          (requestId !== undefined && !isValidUuid(requestId))
        )
          throw new AdminAutomaticRunError('WORK_SESSION_INVALID_REQUEST', 400);
        deps.writeJson(
          request,
          response,
          200,
          await deps.workSessions.state(actor, sessionId, requestId)
        );
      } else if (request.method === 'POST') {
        if (url.searchParams.size || (command && !isValidUuid(command[1])))
          throw new AdminAutomaticRunError('WORK_SESSION_INVALID_REQUEST', 400);
        if (
          !isJsonContentType(
            firstHeaderValue(request.headers['content-type']) ?? undefined
          )
        )
          throw new AdminAutomaticRunError('WORK_SESSION_JSON_REQUIRED', 415);
        let input: unknown;
        try {
          input = JSON.parse(await deps.readBody(request, 16384));
        } catch {
          throw new AdminAutomaticRunError('WORK_SESSION_INVALID_REQUEST', 400);
        }
        const result = save
          ? await deps.workSessions.saveDraft(input, actor)
          : command
            ? await deps.workSessions.command(command[1]!, input, actor)
            : await deps.workSessions.start(input, actor);
        deps.writeJson(request, response, 200, result);
      } else throw new AdminAutomaticRunError('METHOD_NOT_ALLOWED', 405);
    } catch (error) {
      const known = error instanceof AdminAutomaticRunError;
      deps.writeJson(request, response, known ? error.status : 503, {
        code: known ? error.code : 'WORK_SESSION_UNAVAILABLE',
        error: 'Private work session is unavailable.'
      });
    }
    return true;
  };
}
