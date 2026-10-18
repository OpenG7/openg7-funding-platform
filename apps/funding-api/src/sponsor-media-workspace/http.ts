import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool } from 'pg';
import type {
  SponsorMediaBatchExecuteRequest,
  SponsorMediaBatchPlanRequest,
  SponsorMediaBatchRequest,
  SponsorMediaRuleRequest
} from '@openg7/funding-core';

import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport, readBody } from '../http-transport.js';
import { ModerationError } from '../moderation/policy.js';

import { MediaWorkspaceError } from './policy.js';
import { MediaHistoryError, readMediaHistory } from './history.js';
import type { SponsorMediaWorkspaceService } from './service.js';

interface Dependencies {
  publicBaseOrigin: string;
  pool: Pool | null;
  service: SponsorMediaWorkspaceService | null;
  ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ) => boolean;
  canReview: (request: IncomingMessage) => boolean;
  getAdminAuditActor: (request: IncomingMessage) => string;
  readBody: typeof readBody;
  writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
}
const allowed: Record<string, readonly string[]> = {
  rules: [
    'requestId',
    'contributionId',
    'expectedRevision',
    'scope',
    'scopeId',
    'usage',
    'evidenceReference',
    'coveredAssetIds',
    'includesFutureUploads',
    'confirmation'
  ],
  batches: [
    'requestId',
    'contributionId',
    'expectedRevision',
    'name',
    'confirmation'
  ],
  'batch/plan': [
    'requestId',
    'contributionId',
    'expectedRevision',
    'action',
    'assets',
    'targetBatchId',
    'ruleId',
    'reason',
    'internalReason',
    'sponsorExplanation'
  ],
  'batch/execute': ['requestId', 'planId', 'confirmation', 'humanReviewed']
};
export function createSponsorMediaWorkspaceHttpHandler(deps: Dependencies) {
  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    const prefix = '/admin/sponsorships/media/';
    if (!path.startsWith(prefix)) return false;
    const action = path.slice(prefix.length);
    if (
      ![
        'workspace',
        'workspace/history',
        'receipt',
        ...Object.keys(allowed)
      ].includes(action)
    )
      return false;
    response.setHeader('Cache-Control', 'no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    try {
      if (!deps.service || !deps.pool)
        throw new MediaWorkspaceError('MEDIA_WORKSPACE_UNAVAILABLE', 503);
      const writable = deps.canReview(request);
      if ((request.method !== 'GET' || action !== 'workspace') && !writable)
        throw new MediaWorkspaceError('MEDIA_REVIEWER_REQUIRED', 403);
      let result: unknown;
      if (request.method === 'GET' && action === 'workspace')
        result = await deps.service.workspace(
          url.searchParams.get('contributionId') ?? '',
          writable
        );
      else if (request.method === 'GET' && action === 'receipt')
        result = await deps.service.receipt(
          url.searchParams.get('contributionId') ?? '',
          url.searchParams.get('requestId') ?? '',
          deps.getAdminAuditActor(request)
        );
      else if (request.method === 'GET' && action === 'workspace/history')
        result = await readMediaHistory(
          deps.pool,
          url.searchParams.get('contributionId') ?? '',
          url.searchParams.get('assetId') ?? undefined,
          url.searchParams.get('cursor') ?? undefined
        );
      else if (request.method === 'POST' && allowed[action]) {
        if (!isJsonContentType(request.headers['content-type']))
          throw new MediaWorkspaceError('JSON_REQUIRED', 415);
        const parsed: unknown = JSON.parse(
          await deps.readBody(request, 256 * 1024)
        );
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          Object.keys(parsed).some((k) => !allowed[action].includes(k))
        )
          throw new MediaWorkspaceError('INVALID_MEDIA_COMMAND', 400);
        const actor = deps.getAdminAuditActor(request);
        if (action === 'rules')
          result = await deps.service.rules(
            parsed as SponsorMediaRuleRequest,
            actor
          );
        else if (action === 'batches')
          result = await deps.service.batch(
            parsed as SponsorMediaBatchRequest,
            actor
          );
        else if (action === 'batch/plan')
          result = await deps.service.plan(
            parsed as SponsorMediaBatchPlanRequest,
            actor
          );
        else
          result = await deps.service.execute(
            parsed as SponsorMediaBatchExecuteRequest,
            actor
          );
      } else throw new MediaWorkspaceError('METHOD_NOT_ALLOWED', 405);
      deps.writeJson(request, response, 200, result);
    } catch (error) {
      const known =
        error instanceof MediaWorkspaceError ||
        error instanceof ModerationError ||
        error instanceof MediaHistoryError;
      deps.writeJson(
        request,
        response,
        known ? error.status : error instanceof SyntaxError ? 400 : 503,
        {
          code: known
            ? error.code
            : error instanceof SyntaxError
              ? 'INVALID_MEDIA_COMMAND'
              : 'MEDIA_WORKSPACE_UNAVAILABLE',
          error:
            'Media command could not be confirmed. Reload the workspace and check its receipt before retrying.'
        }
      );
    }
    return true;
  };
}
