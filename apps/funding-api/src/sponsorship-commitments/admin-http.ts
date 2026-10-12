import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport, readBody } from '../http-transport.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  adjustSponsorshipObligation,
  qualifySponsorshipCommitment,
  SponsorshipCommitmentError
} from './changes.js';
import { loadSponsorshipCommitment } from './repository.js';

export interface SponsorshipCommitmentHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly pool: Pool | null;
  readonly readBody: typeof readBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ) => boolean;
  readonly canOwn: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
}
export const createSponsorshipCommitmentsHttpHandler =
  (deps: SponsorshipCommitmentHttpDependencies) =>
  async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (
      ![
        '/admin/sponsorship-commitments',
        '/admin/sponsorship-commitments/qualify',
        '/admin/sponsorship-commitments/adjust'
      ].includes(path)
    )
      return false;
    response.setHeader('Cache-Control', 'no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (request.method !== 'GET' && !deps.canOwn(request)) {
      deps.writeJson(request, response, 403, {
        code: 'COMMITMENT_OWNER_REQUIRED',
        error: 'The account owner is required.'
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
    try {
      if (
        path === '/admin/sponsorship-commitments' &&
        request.method === 'GET'
      ) {
        const contributionId = url.searchParams.get('contributionId');
        if (
          !isValidUuid(contributionId) ||
          url.searchParams.getAll('contributionId').length !== 1
        )
          throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
        const commitment = await withPostgresTransaction(
          deps.pool,
          (db) => loadSponsorshipCommitment(db, contributionId),
          { readOnlySnapshot: true }
        );
        deps.writeJson(request, response, 200, { commitment });
        return true;
      }
      if (
        request.method !== 'POST' ||
        path === '/admin/sponsorship-commitments'
      ) {
        deps.writeJson(request, response, 405, {
          error: 'Method not allowed.'
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
      let input: unknown;
      try {
        input = JSON.parse(await deps.readBody(request, 24 * 1024));
      } catch {
        throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
      }
      const actor = deps.getAdminAuditActor(request);
      const commitment = await withPostgresTransaction(deps.pool, (db) =>
        path.endsWith('/qualify')
          ? qualifySponsorshipCommitment(db, input, actor)
          : adjustSponsorshipObligation(db, input, actor)
      );
      deps.writeJson(request, response, 200, { commitment });
    } catch (error) {
      const failure =
        error instanceof SponsorshipCommitmentError
          ? error
          : new SponsorshipCommitmentError('COMMITMENT_UNAVAILABLE', 503);
      deps.writeJson(request, response, failure.status, {
        code: failure.code,
        error: 'The commercial record could not be updated.'
      });
    }
    return true;
  };
