import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminAssistantContextResponse,
  AdminAssistantDraftType,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryRequest,
  AdminAssistantQueryResponse,
  AdminAssistantSummary
} from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;
type AdminAuthorizationCheck = (
  request: ApiRequest,
  response: ApiResponse
) => boolean;

/** Assistant ports expose consultation and generation without granting mutation capabilities. */
export interface AdminAssistantHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAuthorization: AdminAuthorizationCheck;
  readonly ensureAdminAccess: AdminAuthorizationCheck;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidUuid: (value: unknown) => value is string;
  readonly adminAssistantConfig: { readonly maxMessageLength: number };
  readonly getAdminAssistantContext: (
    sponsorshipId?: string
  ) => Promise<AdminAssistantContextResponse>;
  readonly buildAdminAssistantSummary: () => Promise<AdminAssistantSummary>;
  readonly runAdminAssistantQuery: (
    input: AdminAssistantQueryRequest
  ) => Promise<AdminAssistantQueryResponse>;
  readonly prepareAdminAssistantDraft: (
    input: AdminAssistantPrepareRequest
  ) => Promise<AdminAssistantPrepareResponse>;
  readonly recordAdminAssistantAudit: (
    request: ApiRequest,
    action: string,
    metadata: Record<string, unknown>
  ) => Promise<void>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Return false for routes owned elsewhere; authorize before reading private data or bodies. */
export const createAdminAssistantHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAuthorization,
  ensureAdminAccess,
  readBody,
  writeJson,
  isValidUuid,
  adminAssistantConfig,
  getAdminAssistantContext,
  buildAdminAssistantSummary,
  runAdminAssistantQuery,
  prepareAdminAssistantDraft,
  recordAdminAssistantAudit,
  reportFailure
}: AdminAssistantHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/assistant/context',
        '/api/admin/assistant/context'
      )
    ) {
      if (!ensureAdminAuthorization(request, response)) return true;
      const id = new URL(request.url!, 'http://localhost').searchParams.get(
        'sponsorshipId'
      );
      if (id !== null && !isValidUuid(id)) {
        writeJson(request, response, 400, { error: 'Invalid sponsorship ID.' });
        return true;
      }
      try {
        const result = await getAdminAssistantContext(id ?? undefined);
        writeJson(request, response, 200, result, {
          'Cache-Control': 'private, no-store'
        });
      } catch {
        writeJson(
          request,
          response,
          503,
          { error: 'Assistant context unavailable.' },
          { 'Cache-Control': 'private, no-store' }
        );
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/assistant/summary',
        '/api/admin/assistant/summary'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      const startedAt = Date.now();
      try {
        const summary = await buildAdminAssistantSummary();
        await recordAdminAssistantAudit(request, 'admin_assistant.summary', {
          urgent: summary.counts.urgent,
          today: summary.counts.today,
          itemCount: summary.attentionItems.length,
          durationMs: Date.now() - startedAt
        });
        writeJson(request, response, 200, summary);
      } catch (error) {
        reportFailure('Failed to build admin assistant summary.', error);
        writeJson(request, response, 502, {
          error: 'Admin assistant summary could not be built.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/assistant/query',
        '/api/admin/assistant/query'
      )
    ) {
      if (!ensureAdminAuthorization(request, response)) {
        return true;
      }

      let parsed: AdminAssistantQueryRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = body.trim()
          ? (JSON.parse(body) as AdminAssistantQueryRequest)
          : ({} as AdminAssistantQueryRequest);
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid assistant query body.'
        });
        return true;
      }

      const message =
        typeof parsed?.message === 'string' ? parsed.message.trim() : '';
      if (
        parsed?.sponsorshipId !== undefined &&
        !isValidUuid(parsed.sponsorshipId)
      ) {
        writeJson(request, response, 400, { error: 'Invalid sponsorship ID.' });
        return true;
      }
      if (!message) {
        writeJson(request, response, 400, {
          error: 'A question is required.'
        });
        return true;
      }
      if (message.length > adminAssistantConfig.maxMessageLength) {
        writeJson(request, response, 400, {
          error: 'The question is too long.'
        });
        return true;
      }

      const startedAt = Date.now();
      try {
        const result = await runAdminAssistantQuery({
          message,
          sponsorshipId: parsed.sponsorshipId
        });
        await recordAdminAssistantAudit(request, 'admin_assistant.query', {
          status: result.status,
          mode: result.mode,
          provider: result.provider.name,
          model: result.provider.model,
          toolCalls: result.toolInvocations.length,
          durationMs: Date.now() - startedAt
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to run admin assistant query.', error);
        writeJson(request, response, 502, {
          error: 'Admin assistant query could not be completed.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/assistant/prepare',
        '/api/admin/assistant/prepare'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminAssistantPrepareRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = body.trim()
          ? (JSON.parse(body) as AdminAssistantPrepareRequest)
          : ({} as AdminAssistantPrepareRequest);
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid assistant prepare body.'
        });
        return true;
      }

      const allowedDraftTypes: readonly AdminAssistantDraftType[] = [
        'sponsorship_reminder',
        'publication_draft',
        'admin_note',
        'slot_proposal'
      ];
      if (
        !allowedDraftTypes.includes(parsed?.type) ||
        (parsed.language !== undefined &&
          parsed.language !== 'fr-CA' &&
          parsed.language !== 'en')
      ) {
        writeJson(request, response, 400, {
          error: 'A valid draft type is required.'
        });
        return true;
      }

      const reference =
        typeof parsed.reference === 'string'
          ? parsed.reference.trim().slice(0, 64)
          : undefined;

      const startedAt = Date.now();
      try {
        const result = await prepareAdminAssistantDraft({
          type: parsed.type,
          reference,
          language: parsed.language
        });
        await recordAdminAssistantAudit(request, 'admin_assistant.prepare', {
          draftType: parsed.type,
          status: result.status,
          durationMs: Date.now() - startedAt
        });
        writeJson(request, response, 200, result, {
          'Cache-Control': 'private, no-store'
        });
      } catch (error) {
        reportFailure('Failed to prepare admin assistant draft.', error);
        writeJson(request, response, 502, {
          error: 'Admin assistant draft could not be prepared.'
        });
      }
      return true;
    }

    return false;
  };
};
