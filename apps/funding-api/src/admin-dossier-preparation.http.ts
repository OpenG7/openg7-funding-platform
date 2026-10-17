import type { IncomingMessage, ServerResponse } from 'node:http';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';
import type { AdminPreparationService } from './admin-preparation.service.js';
import {
  preparationHttpFailure,
  type PreparationFailureDiagnostic
} from './admin-preparation-errors.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { firstHeaderValue, isJsonContentType } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

export interface AdminDossierPreparationHttpDependencies {
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
  readonly preparations: Pick<
    AdminPreparationService,
    'dossierPreparation' | 'approveDossierPreparation'
  > | null;
  readonly reportPreparationFailure?: (
    diagnostic: PreparationFailureDiagnostic
  ) => void;
}

/** An ordinary administrative dossier read has no automatic-run dependency. */
export function createAdminDossierPreparationHttpHandler(
  deps: AdminDossierPreparationHttpDependencies
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
    const base = '/admin/sponsorships/preparation';
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (path !== base && path !== base + '/approve') return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    try {
      const allowed =
        request.method === 'GET' && path === base ? ['sponsorshipId'] : [];
      if (
        [...url.searchParams.keys()].some(
          (key) =>
            !allowed.includes(key) || url.searchParams.getAll(key).length !== 1
        )
      )
        throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
      if (!deps.preparations)
        throw new AdminAutomaticRunError('RUN_UNAVAILABLE', 503);
      if (request.method === 'GET' && path === base) {
        const id = url.searchParams.get('sponsorshipId');
        if (!isValidUuid(id))
          throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
        const receipt = await deps.preparations.dossierPreparation(id!);
        deps.writeJson(request, response, 200, receipt);
      } else if (request.method === 'POST' && path === base + '/approve') {
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
        const receipt = await deps.preparations.approveDossierPreparation(
          input,
          deps.getAdminAuditActor(request)
        );
        deps.writeJson(request, response, 200, receipt);
      } else throw new AdminAutomaticRunError('METHOD_NOT_ALLOWED', 405);
    } catch (error) {
      const failure = preparationHttpFailure(
        error,
        path === base ? 'dossier_read' : 'dossier_approve',
        deps.reportPreparationFailure
      );
      deps.writeJson(request, response, failure.status, failure.payload);
    }
    return true;
  };
}
