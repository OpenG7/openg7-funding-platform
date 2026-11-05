import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  PreflightRehearsalResponse,
  PreflightRehearsalRun,
  PreflightRehearsalScenario
} from '@openg7/funding-core';

import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport } from '../http-transport.js';

import { uuid } from './contracts.js';
import type { PreflightRehearsalConfig } from './rehearsal-config.js';
import { PreflightRehearsalService } from './rehearsal.js';
import { RehearsalError } from './rehearsal-store.js';

interface Dependencies {
  readonly publicBaseOrigin: string;
  readonly config: PreflightRehearsalConfig;
  readonly ensureAdminAuthorization: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly canLaunch: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: (
    request: IncomingMessage,
    maxBytes: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly service?: Pick<
    PreflightRehearsalService,
    'list' | 'start' | 'observe' | 'resume'
  >;
}

/** Authenticated local recipe. Only an explicit POST may submit or resume a synthetic mission. */
export function createPreflightRehearsalHttpHandler(deps: Dependencies) {
  const service = deps.config.enabled
    ? (deps.service ?? new PreflightRehearsalService(deps.config))
    : null;
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    const match =
      /^\/admin\/preflight\/rehearsals(?:\/([0-9a-f-]{36})(\/resume)?)?$/i.exec(
        path
      );
    if (!match) return false;
    if (!deps.ensureAdminAuthorization(request, response)) return true;
    const wrapper = async (
      run: PreflightRehearsalRun | null
    ): Promise<PreflightRehearsalResponse> => ({
      enabled: deps.config.enabled,
      canLaunch: deps.config.enabled && deps.canLaunch(request),
      consoleUrl: deps.config.consoleUrl,
      run,
      runs: service ? await service.list() : []
    });
    const write = (status: number, payload: unknown) =>
      deps.writeJson(request, response, status, payload, {
        'Cache-Control': 'private, no-store'
      });
    if (
      url.search ||
      Object.keys(request.headers).some((key) =>
        /^(?:x-)?(?:(?:preflight|funding|source)-)?(?:tenant(?:[-_]id)?|applications?|allowed[-_]applications|roles?|subject)$/i.test(
          key
        )
      )
    ) {
      write(400, {
        code: 'PREFLIGHT_REHEARSAL_INVALID_REQUEST',
        error: 'Invalid recipe request.'
      });
      return true;
    }
    const id = match[1],
      resume = !!match[2],
      method = request.method ?? '';
    if (
      (method !== 'GET' && method !== 'POST') ||
      (method === 'GET' && resume) ||
      (method === 'POST' && id && !resume)
    ) {
      response.setHeader('Allow', resume ? 'POST' : id ? 'GET' : 'GET, POST');
      write(405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });
      return true;
    }
    if (
      method === 'POST' &&
      (request.headers.origin !== deps.publicBaseOrigin ||
        !deps.canLaunch(request))
    ) {
      write(403, {
        code: 'PREFLIGHT_REHEARSAL_FORBIDDEN',
        error: 'Recipe launch is not permitted.'
      });
      return true;
    }
    if (!service) {
      const body = await wrapper(null);
      write(
        method === 'GET' ? 200 : 409,
        method === 'GET'
          ? body
          : {
              ...body,
              code: 'PREFLIGHT_REHEARSAL_DISABLED',
              error: 'Local recipe is disabled.'
            }
      );
      return true;
    }
    try {
      if (id) {
        try {
          uuid(id);
        } catch {
          write(400, {
            code: 'PREFLIGHT_REHEARSAL_INVALID_REQUEST',
            error: 'Invalid recipe identifier.'
          });
          return true;
        }
      }
      let run: PreflightRehearsalRun | null = null;
      if (method === 'GET') {
        const selected = id ?? (await service.list())[0]?.id;
        if (selected)
          run = await service.observe(
            selected,
            deps.getAdminAuditActor(request)
          );
      } else {
        if (!isJsonContentType(request.headers['content-type'])) {
          write(415, {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            error: 'JSON content is required.'
          });
          return true;
        }
        let body: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(
            await deps.readBody(request, 2048)
          );
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error();
          body = parsed as Record<string, unknown>;
          if (resume) {
            if (Object.keys(body).length) throw new Error();
          } else {
            if (
              Object.keys(body).length !== 2 ||
              !Object.hasOwn(body, 'requestId') ||
              !['standard', 'missing_input'].includes(body.scenario as string)
            )
              throw new Error();
            uuid(body.requestId);
          }
        } catch {
          write(400, {
            code: 'PREFLIGHT_REHEARSAL_INVALID_REQUEST',
            error: 'Invalid recipe request.'
          });
          return true;
        }
        run = resume
          ? await service.resume(id!, deps.getAdminAuditActor(request))
          : await service.start(
              body.requestId as string,
              body.scenario as PreflightRehearsalScenario,
              deps.getAdminAuditActor(request)
            );
      }
      write(200, await wrapper(run));
    } catch (error) {
      const problem =
        error instanceof RehearsalError
          ? error
          : new RehearsalError('PREFLIGHT_REHEARSAL_UNAVAILABLE');
      write(problem.status, {
        code: problem.code,
        error: 'The local recipe could not be read or executed.'
      });
    }
    return true;
  };
}
