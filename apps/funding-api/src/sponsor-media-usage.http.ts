import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool } from 'pg';
import type {
  AdminSponsorMediaPreferenceDecisionRequest,
  AdminSponsorMediaUsageRequest,
  SponsorMediaPreferenceRequest,
  SponsorMediaUsageRequest
} from '@openg7/funding-core';

import { createRouteMatcher, isJsonContentType } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type { SponsorshipFollowupLookup } from './fund-contributions.repository.js';
import { getSponsorMediaStorageRecord } from './sponsor-media.repository.js';
import {
  updateSponsorMediaUsage,
  requestSponsorMediaPreference,
  decideSponsorMediaPreference,
  SponsorMediaUsageError
} from './sponsor-media-usage.repository.js';

interface Dependencies {
  readonly mode: 'private' | 'admin';
  readonly pool: Pool | null;
  readonly publicBaseOrigin: string;
  readonly readBody: (
    request: IncomingMessage,
    maxBytes: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidFollowupToken?: (value: unknown) => value is string;
  readonly getFreshSponsorshipFollowupByToken?: (
    token: string
  ) => Promise<SponsorshipFollowupLookup | null>;
  readonly ensureAdminAccess?: (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ) => boolean;
  readonly getAdminAuditActor?: (request: IncomingMessage) => string;
  readonly reportFailure: (message: string, error: unknown) => void;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const onlyKeys = (
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

/** Owned private requests and separately authorized admin decisions; no bytes or public URLs. */
export function createSponsorMediaUsageHttpHandler(deps: Dependencies) {
  const { routeMatches } = createRouteMatcher(deps.publicBaseOrigin);
  const base =
    deps.mode === 'private'
      ? '/sponsorship-followup/media'
      : '/admin/sponsorships/media';
  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    const usage = routeMatches(
      request.url,
      base + '/usage',
      '/api' + base + '/usage'
    );
    const preference = routeMatches(
      request.url,
      base + (deps.mode === 'private' ? '/preference' : '/preference-review'),
      '/api' +
        base +
        (deps.mode === 'private' ? '/preference' : '/preference-review')
    );
    if (!usage && !preference) return false;
    if (deps.mode === 'admin' && !deps.ensureAdminAccess?.(request, response))
      return true;
    if (!deps.pool) {
      deps.writeJson(request, response, 503, {
        code: 'MEDIA_USAGE_UNAVAILABLE',
        error: 'Image usage requires PostgreSQL.'
      });
      return true;
    }
    if (request.method !== 'POST') {
      deps.writeJson(request, response, 405, {
        code: 'METHOD_NOT_ALLOWED',
        error: 'This action requires POST.'
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
      const parsed: unknown = JSON.parse(
        await deps.readBody(request, 16 * 1024)
      );
      const keys =
        deps.mode === 'private'
          ? usage
            ? [
                'token',
                'requestId',
                'assetId',
                'expectedVersion',
                'confirmed',
                'usage'
              ]
            : [
                'token',
                'requestId',
                'expectedRevision',
                'assetId',
                'correction',
                'confirmed'
              ]
          : usage
            ? [
                'requestId',
                'assetId',
                'expectedVersion',
                'confirmation',
                'usage',
                'evidenceReference'
              ]
            : [
                'requestId',
                'contributionId',
                'expectedRevision',
                'state',
                'sponsorExplanation',
                'confirmation'
              ];
      if (
        !onlyKeys(parsed, keys) ||
        typeof parsed.requestId !== 'string' ||
        !uuid.test(parsed.requestId)
      )
        throw new SponsorMediaUsageError('INVALID_MEDIA_USAGE_REQUEST', 400);
      let contributionId: string;
      let actor: string;
      if (deps.mode === 'private') {
        if (
          !deps.isValidFollowupToken?.(parsed.token) ||
          parsed.confirmed !== true
        )
          throw new SponsorMediaUsageError('CONFIRMATION_REQUIRED', 400);
        const followup = await deps.getFreshSponsorshipFollowupByToken?.(
          parsed.token
        );
        if (!followup)
          throw new SponsorMediaUsageError('SPONSORSHIP_NOT_FOUND', 404);
        contributionId = followup.contributionId;
        actor = 'sponsor-followup';
      } else {
        actor = deps.getAdminAuditActor?.(request) ?? 'unauthenticated';
        if (usage) {
          if (
            typeof parsed.assetId !== 'string' ||
            !uuid.test(parsed.assetId) ||
            parsed.confirmation !== parsed.assetId ||
            typeof parsed.evidenceReference !== 'string'
          )
            throw new SponsorMediaUsageError('CONFIRMATION_REQUIRED', 400);
          const asset = await getSponsorMediaStorageRecord(
            deps.pool,
            parsed.assetId
          );
          if (!asset) throw new SponsorMediaUsageError('MEDIA_NOT_FOUND', 404);
          contributionId = asset.contributionId;
        } else {
          if (
            typeof parsed.contributionId !== 'string' ||
            !uuid.test(parsed.contributionId) ||
            parsed.confirmation !== parsed.contributionId
          )
            throw new SponsorMediaUsageError('CONFIRMATION_REQUIRED', 400);
          contributionId = parsed.contributionId;
        }
      }
      let result: object;
      if (usage) {
        const input = parsed as unknown as
          SponsorMediaUsageRequest | AdminSponsorMediaUsageRequest;
        if (
          typeof input.assetId !== 'string' ||
          !uuid.test(input.assetId) ||
          typeof input.expectedVersion !== 'string' ||
          !input.expectedVersion.trim() ||
          input.expectedVersion.length > 128
        )
          throw new SponsorMediaUsageError('INVALID_MEDIA_USAGE_REQUEST', 400);
        result = await updateSponsorMediaUsage(deps.pool, {
          ...input,
          contributionId,
          actor,
          ...(deps.mode === 'admin'
            ? {
                evidenceReference: (input as AdminSponsorMediaUsageRequest)
                  .evidenceReference
              }
            : {})
        });
      } else if (deps.mode === 'private') {
        result = await requestSponsorMediaPreference(deps.pool, {
          ...(parsed as unknown as SponsorMediaPreferenceRequest),
          contributionId,
          actor
        });
      } else {
        result = await decideSponsorMediaPreference(deps.pool, {
          ...(parsed as unknown as AdminSponsorMediaPreferenceDecisionRequest),
          contributionId,
          actor
        });
      }
      deps.writeJson(request, response, 200, result);
    } catch (error) {
      if (error instanceof SponsorMediaUsageError)
        deps.writeJson(request, response, error.status, {
          code: error.code,
          error: error.code
        });
      else if (error instanceof SyntaxError)
        deps.writeJson(request, response, 400, {
          code: 'INVALID_MEDIA_USAGE_REQUEST',
          error: 'Invalid image usage request.'
        });
      else {
        deps.reportFailure(
          'Sponsor image usage command could not be confirmed.',
          { code: 'MEDIA_USAGE_UNAVAILABLE' }
        );
        deps.writeJson(request, response, 503, {
          code: 'MEDIA_USAGE_UNAVAILABLE',
          error: 'Reload image usage before retrying the same request.'
        });
      }
    }
    return true;
  };
}
