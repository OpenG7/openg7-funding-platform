import type { IncomingMessage, ServerResponse } from 'node:http';

import type { WebsiteMediaStorage } from '../sponsorship-website-media.js';
import type { SponsorshipCommitmentHttpDependencies } from '../sponsorship-commitments/admin-http.js';
import { isJsonContentType } from '../http-routing.js';
import { executeSponsorshipTimingCommand } from '../sponsorship-obligation-timing.js';
import { SponsorshipCommitmentError } from '../sponsorship-commitments/changes.js';
import { PublicationAutomationError } from '../publication-automation/policy.js';
import { ModerationError } from '../moderation/policy.js';

/** Dedicated owner command endpoint; observation never authorizes public exposure. */
export const createSponsorshipTimingHttpHandler =
  (
    deps: SponsorshipCommitmentHttpDependencies & {
      readonly storage?: WebsiteMediaStorage;
    }
  ) =>
  async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    const path = new URL(
      request.url ?? '/',
      deps.publicBaseOrigin
    ).pathname.replace(/^\/api(?=\/)/, '');
    if (path !== '/admin/sponsorship-commitments/timing') return false;
    response.setHeader('Cache-Control', 'no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (!deps.canOwn(request)) {
      deps.writeJson(request, response, 403, {
        code: 'COMMITMENT_OWNER_REQUIRED',
        error: 'The owner is required.'
      });
      return true;
    }
    if (request.method !== 'POST') {
      deps.writeJson(request, response, 405, {
        code: 'METHOD_NOT_ALLOWED',
        error: 'Method not allowed.'
      });
      return true;
    }
    if (!deps.pool) {
      deps.writeJson(request, response, 503, {
        code: 'COMMITMENT_UNAVAILABLE',
        error: 'Commercial records are unavailable.'
      });
      return true;
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      deps.writeJson(request, response, 415, {
        code: 'JSON_REQUIRED',
        error: 'Content-Type must be application/json.'
      });
      return true;
    }
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await deps.readBody(request, 12 * 1024));
      } catch {
        throw new SponsorshipCommitmentError('TIMING_INVALID', 400);
      }
      const result = await executeSponsorshipTimingCommand(
        deps.pool,
        raw,
        deps.getAdminAuditActor(request),
        deps.storage
      );
      deps.writeJson(request, response, 200, result);
    } catch (error) {
      const e =
        error instanceof SponsorshipCommitmentError ||
        error instanceof PublicationAutomationError ||
        error instanceof ModerationError
          ? error
          : null;
      deps.writeJson(request, response, e?.status ?? 503, {
        code: e?.code ?? 'TIMING_UNAVAILABLE',
        error: 'Timing could not be recorded.'
      });
    }
    return true;
  };
