import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createHttpTransport, readBody } from './http-transport.js';
import { isJsonContentType } from './http-routing.js';
import {
  consentCheck,
  consentUuid,
  SponsorshipConsentError
} from './admin-sponsorship-consent-policy.js';
import type { AdminSponsorshipConsentService } from './admin-sponsorship-consent.service.js';

interface ConsentHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly service: Pick<
    AdminSponsorshipConsentService,
    'read' | 'record' | 'receipt'
  > | null;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly canRecord: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: typeof readBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
}

export function createAdminSponsorshipConsentHttpHandler(
  deps: ConsentHttpDependencies
) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    const base = '/admin/sponsorships/consent';
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (![base, base + '/record', base + '/receipt'].includes(path))
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    try {
      const command = path === base + '/record';
      const receipt = path === base + '/receipt';
      const expectedMethod = command ? 'POST' : 'GET';
      response.setHeader('Allow', expectedMethod);
      consentCheck(
        request.method === expectedMethod,
        'CONSENT_METHOD_NOT_ALLOWED',
        405
      );
      const mayRecord = deps.canRecord(request);
      if (command || receipt)
        consentCheck(mayRecord, 'CONSENT_PERMISSION_REQUIRED', 403);
      consentCheck(deps.service, 'CONSENT_UNAVAILABLE', 503);
      const actor = deps.getAdminAuditActor(request);
      if (command) {
        consentCheck(!url.search, 'CONSENT_INVALID_REQUEST', 400);
        consentCheck(
          isJsonContentType(request.headers['content-type']),
          'CONSENT_JSON_REQUIRED',
          415
        );
        const input: unknown = JSON.parse(await deps.readBody(request, 8192));
        deps.writeJson(
          request,
          response,
          200,
          await deps.service.record(input, actor, mayRecord)
        );
      } else {
        const allowed = receipt
          ? ['sponsorshipId', 'requestId']
          : ['sponsorshipId'];
        consentCheck(
          [...url.searchParams.keys()].length === allowed.length &&
            allowed.every((key) => url.searchParams.getAll(key).length === 1) &&
            [...url.searchParams.keys()].every((key) => allowed.includes(key)),
          'CONSENT_INVALID_REQUEST',
          400
        );
        const id = url.searchParams.get('sponsorshipId');
        consentCheck(consentUuid(id), 'CONSENT_INVALID_REQUEST', 400);
        const requestId = url.searchParams.get('requestId');
        if (receipt)
          consentCheck(consentUuid(requestId), 'CONSENT_INVALID_REQUEST', 400);
        deps.writeJson(
          request,
          response,
          200,
          receipt
            ? await deps.service.receipt(id, requestId!, actor, mayRecord)
            : await deps.service.read(id, actor, mayRecord)
        );
      }
    } catch (error) {
      const known = error instanceof SponsorshipConsentError;
      deps.writeJson(
        request,
        response,
        known ? error.status : error instanceof SyntaxError ? 400 : 503,
        {
          code: known
            ? error.code
            : error instanceof SyntaxError
              ? 'CONSENT_INVALID_REQUEST'
              : 'CONSENT_UNAVAILABLE'
        }
      );
    }
    return true;
  };
}
