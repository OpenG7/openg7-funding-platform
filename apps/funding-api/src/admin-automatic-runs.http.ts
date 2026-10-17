import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createHttpTransport } from './http-transport.js';
import { firstHeaderValue, isJsonContentType } from './http-routing.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { createAdminDossierPreparationHttpHandler } from './admin-dossier-preparation.http.js';
import type { AdminPreparationService } from './admin-preparation.service.js';
import {
  preparationHttpFailure,
  type PreparationFailureDiagnostic
} from './admin-preparation-errors.js';
import {
  AdminAutomaticRunError,
  type AdminAutomaticRunsService
} from './admin-automatic-runs.service.js';

export interface AdminAutomaticRunsHttpDependencies {
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
  readonly automaticRuns: Pick<
    AdminAutomaticRunsService,
    | 'state'
    | 'start'
    | 'advance'
    | 'control'
    | 'report'
    | 'preparation'
    | 'approvePreparation'
  > | null;
  readonly dossierPreparations?: Pick<
    AdminPreparationService,
    'dossierPreparation' | 'approveDossierPreparation'
  > | null;
  readonly reportPreparationFailure?: (
    diagnostic: PreparationFailureDiagnostic
  ) => void;
}

/** Identity/origin/role policy runs before actor, body, filters or database access. */
export function createAdminAutomaticRunsHttpHandler(
  deps: AdminAutomaticRunsHttpDependencies
) {
  const handleDossier = createAdminDossierPreparationHttpHandler({
    ...deps,
    preparations: deps.dossierPreparations ?? null
  });
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    if (await handleDossier(request, response)) return true;
    let url: URL;
    try {
      url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    } catch {
      return false;
    }
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    const base = '/admin/automatic-runs';
    if (
      ![
        base,
        base + '/advance',
        base + '/control',
        base + '/report',
        base + '/preparation',
        base + '/preparation/approve'
      ].includes(path)
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    try {
      const allowed =
        request.method === 'GET'
          ? path === base
            ? ['runId']
            : path === base + '/report'
              ? ['runId', 'after', 'limit']
              : path === base + '/preparation'
                ? ['runId', 'position']
                : []
          : [];
      if (
        [...url.searchParams.keys()].some(
          (key) =>
            !allowed.includes(key) || url.searchParams.getAll(key).length !== 1
        )
      )
        throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
      if (
        url.searchParams.has('runId') &&
        !isValidUuid(url.searchParams.get('runId'))
      )
        throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
      for (const field of ['after', 'limit', 'position']) {
        const value = url.searchParams.get(field);
        if (
          value !== null &&
          (!/^(?:0|[1-9]\d*)$/.test(value) ||
            !Number.isSafeInteger(Number(value)) ||
            (field === 'limit' && (Number(value) < 1 || Number(value) > 100)) ||
            (field === 'position' && Number(value) < 1))
        )
          throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
      }
      if (
        request.method === 'GET' &&
        [base + '/report', base + '/preparation'].includes(path) &&
        (!url.searchParams.has('runId') ||
          (path === base + '/preparation' && !url.searchParams.has('position')))
      )
        throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
      if (!deps.automaticRuns)
        throw new AdminAutomaticRunError('RUN_UNAVAILABLE', 503);
      const actor = deps.getAdminAuditActor(request);
      if (request.method === 'GET' && path === base) {
        const state = await deps.automaticRuns.state(
          actor,
          url.searchParams.get('runId') ?? undefined
        );
        deps.writeJson(request, response, 200, state);
      } else if (request.method === 'GET' && path === base + '/preparation') {
        const receipt = await deps.automaticRuns.preparation(
          actor,
          url.searchParams.get('runId') ?? '',
          Number(url.searchParams.get('position'))
        );
        deps.writeJson(request, response, 200, receipt);
      } else if (request.method === 'GET' && path === base + '/report') {
        const runId = url.searchParams.get('runId') ?? '';
        const after = url.searchParams.has('after')
          ? Number(url.searchParams.get('after'))
          : 0;
        const limit = url.searchParams.has('limit')
          ? Number(url.searchParams.get('limit'))
          : 50;
        const report = await deps.automaticRuns.report(
          actor,
          runId,
          after,
          limit
        );
        deps.writeJson(request, response, 200, report);
      } else if (
        request.method === 'POST' &&
        ![base + '/report', base + '/preparation'].includes(path)
      ) {
        if (
          !isJsonContentType(
            firstHeaderValue(request.headers['content-type']) ?? undefined
          )
        )
          throw new AdminAutomaticRunError('RUN_JSON_REQUIRED', 415);
        let input: unknown;
        try {
          input = JSON.parse(await deps.readBody(request, 4096));
        } catch {
          throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
        }
        const state =
          path === base
            ? await deps.automaticRuns.start(input, actor)
            : path === base + '/advance'
              ? await deps.automaticRuns.advance(input, actor)
              : path === base + '/preparation/approve'
                ? await deps.automaticRuns.approvePreparation(input, actor)
                : await deps.automaticRuns.control(input, actor);
        deps.writeJson(request, response, 200, state);
      } else throw new AdminAutomaticRunError('METHOD_NOT_ALLOWED', 405);
    } catch (error) {
      if (
        path === base + '/preparation' ||
        path === base + '/preparation/approve'
      ) {
        const failure = preparationHttpFailure(
          error,
          path === base + '/preparation' ? 'carousel_read' : 'carousel_approve',
          deps.reportPreparationFailure
        );
        deps.writeJson(request, response, failure.status, failure.payload);
        return true;
      }
      const safe = error instanceof AdminAutomaticRunError ? error : null;
      deps.writeJson(request, response, safe?.status ?? 503, {
        code: safe?.code ?? 'RUN_UNAVAILABLE',
        error: 'Administrative responsibility reconciliation is unavailable.'
      });
    }
    return true;
  };
}
