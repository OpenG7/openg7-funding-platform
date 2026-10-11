import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  SponsorshipCorrectionRequest,
  SponsorshipReconsiderationRequest
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { CheckoutOperationError } from '../checkout-operations.service.js';
import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport, readBody } from '../http-transport.js';
import { SponsorshipAccessError } from '../sponsorship-access.service.js';

import { getPublicSponsorshipCharter } from './charter.js';
import {
  getSponsorshipModeration,
  requestSponsorshipReconsideration,
  submitSponsorshipCorrection
} from './followup.js';
import { ModerationError } from './policy.js';

export interface PublicModerationHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly pool: Pool | null;
  readonly ttlDays: number;
  readonly readBody: typeof readBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
}
export function createPublicModerationHttpHandler(
  deps: PublicModerationHttpDependencies
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (
      ![
        '/sponsorship-charter',
        '/sponsorship-followup/moderation',
        '/sponsorship-followup/reconsideration',
        '/sponsorship-followup/correction'
      ].includes(path)
    )
      return false;
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (!deps.pool) throw new ModerationError('MODERATION_UNAVAILABLE', 503);
      if (request.method === 'GET' && path === '/sponsorship-charter') {
        deps.writeJson(
          request,
          response,
          200,
          await getPublicSponsorshipCharter(deps.pool)
        );
      } else if (
        request.method === 'GET' &&
        path === '/sponsorship-followup/moderation'
      ) {
        deps.writeJson(
          request,
          response,
          200,
          await getSponsorshipModeration(
            deps.pool,
            url.searchParams.get('token') ?? '',
            deps.ttlDays
          )
        );
      } else if (
        request.method === 'POST' &&
        [
          '/sponsorship-followup/reconsideration',
          '/sponsorship-followup/correction'
        ].includes(path)
      ) {
        if (!isJsonContentType(request.headers['content-type']))
          throw new ModerationError('JSON_REQUIRED', 415);
        const input = JSON.parse(await deps.readBody(request, 16 * 1024));
        const keys =
          path === '/sponsorship-followup/correction'
            ? [
                'token',
                'decisionId',
                'requestId',
                'expectedRevision',
                'data',
                'locale'
              ]
            : ['token', 'decisionId', 'requestId', 'explanation', 'locale'];
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).some((key) => !keys.includes(key)) ||
          typeof input.token !== 'string'
        )
          throw new ModerationError('INVALID_MODERATION_REQUEST', 400);
        if (
          input.locale !== undefined &&
          !['fr-CA', 'en'].includes(input.locale)
        )
          throw new ModerationError('INVALID_MODERATION_REQUEST', 400);
        const result =
          path === '/sponsorship-followup/correction'
            ? await submitSponsorshipCorrection(
                deps.pool,
                deps.ttlDays,
                input as SponsorshipCorrectionRequest
              )
            : await requestSponsorshipReconsideration(
                deps.pool,
                deps.ttlDays,
                input as SponsorshipReconsiderationRequest
              );
        deps.writeJson(
          request,
          response,
          path === '/sponsorship-followup/correction' ? 200 : 202,
          result
        );
      } else {
        deps.writeJson(request, response, 405, {
          code: 'METHOD_NOT_ALLOWED',
          error: 'Method is not allowed.'
        });
      }
    } catch (error) {
      const known =
        error instanceof ModerationError ||
        error instanceof SponsorshipAccessError ||
        error instanceof CheckoutOperationError;
      deps.writeJson(
        request,
        response,
        known ? error.status : error instanceof SyntaxError ? 400 : 503,
        {
          code: known
            ? error.code
            : error instanceof SyntaxError
              ? 'INVALID_MODERATION_REQUEST'
              : 'MODERATION_UNAVAILABLE',
          error: 'The private review operation could not be completed.'
        }
      );
    }
    return true;
  };
}
