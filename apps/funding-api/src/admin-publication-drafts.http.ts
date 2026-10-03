import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftUpdateRequest
} from '@openg7/funding-core';

import type {
  listAdminPublicationDrafts,
  createAdminPublicationDraft,
  updateAdminPublicationDraft,
  insertAdminAuditLog
} from './fund-admin.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { AdminPublicationHttpDependencies } from './admin-publication-http.shared.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

const PUBLICATION_DRAFT_TITLE_MAX_LENGTH = 160;
const PUBLICATION_DRAFT_BODY_MAX_LENGTH = 2500;
const PUBLICATION_DRAFT_DISCLOSURE_MAX_LENGTH = 300;
const ADMIN_REVIEW_NOTE_MAX_LENGTH = 1000;

/** Publication ports preserve domain transitions, persistent snapshots and audit. */
export interface AdminPublicationDraftsHttpDependencies extends AdminPublicationHttpDependencies {
  readonly allowedPublicationDraftStatuses: ReadonlySet<
    NonNullable<AdminPublicationDraftUpdateRequest['status']>
  >;
  readonly isValidOptionalNonEmptyBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly isValidOptionalHttpsUrl: (value: unknown) => boolean;
  readonly isValidOptionalIsoDate: (value: unknown) => boolean;
  readonly listAdminPublicationDrafts: (
    input?: Parameters<typeof listAdminPublicationDrafts>[1]
  ) => ReturnType<typeof listAdminPublicationDrafts>;
  readonly createAdminPublicationDraft: (
    input: Parameters<typeof createAdminPublicationDraft>[1]
  ) => ReturnType<typeof createAdminPublicationDraft>;
  readonly updateAdminPublicationDraft: (
    input: Parameters<typeof updateAdminPublicationDraft>[1]
  ) => ReturnType<typeof updateAdminPublicationDraft>;
  readonly insertAdminAuditLog: (
    input: Parameters<typeof insertAdminAuditLog>[1]
  ) => ReturnType<typeof insertAdminAuditLog>;
}

/** Owned routes check API access before reading a body or invoking a domain port. */
export const createAdminPublicationDraftsHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  isValidUuid,
  isAllowedSponsorFeedChannel,
  isValidOptionalBoundedText,
  reportFailure,
  allowedPublicationDraftStatuses,
  isValidOptionalNonEmptyBoundedText,
  isValidOptionalHttpsUrl,
  isValidOptionalIsoDate,
  listAdminPublicationDrafts,
  createAdminPublicationDraft,
  updateAdminPublicationDraft,
  insertAdminAuditLog
}: AdminPublicationDraftsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  const isAllowedPublicationDraftStatus = (
    value: unknown
  ): value is NonNullable<AdminPublicationDraftUpdateRequest['status']> =>
    typeof value === 'string' &&
    allowedPublicationDraftStatuses.has(
      value as NonNullable<AdminPublicationDraftUpdateRequest['status']>
    );

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/publication-drafts',
        '/api/admin/publication-drafts'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const result = await listAdminPublicationDrafts({
          id:
            new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
              'draftId'
            ) ?? undefined
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load publication drafts.', error);
        writeJson(request, response, 502, {
          error: 'Publication drafts could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-drafts',
        '/api/admin/publication-drafts'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationDraftCreateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationDraftCreateRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.contributionId)) {
        writeJson(request, response, 400, {
          error: 'Invalid contribution id.'
        });
        return true;
      }

      if (parsed.feedTarget !== 'openg7' && parsed.feedTarget !== 'openg20') {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft feed target.'
        });
        return true;
      }

      if (!isAllowedSponsorFeedChannel(parsed.channel)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft channel.'
        });
        return true;
      }

      try {
        const result = await createAdminPublicationDraft(parsed);
        if (!result.updated || !result.draft) {
          writeJson(request, response, 404, {
            error:
              'Approved sponsorship was not found or publication drafts migration is missing.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_draft.create',
          entityType: 'publication_draft',
          entityId: result.draft.id,
          summary: `Publication draft created for ${result.draft.sponsor_company_name}.`,
          metadata: {
            contributionId: result.draft.contribution_id,
            feedTarget: result.draft.feed_target,
            channel: result.draft.channel
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to create publication draft.', error);
        writeJson(request, response, 502, {
          error: 'Publication draft could not be created.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-drafts/update',
        '/api/admin/publication-drafts/update'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationDraftUpdateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationDraftUpdateRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft update request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.draftId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft id.'
        });
        return true;
      }

      if (
        !isValidOptionalNonEmptyBoundedText(
          parsed.title,
          PUBLICATION_DRAFT_TITLE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Publication draft title is invalid.'
        });
        return true;
      }

      if (
        !isValidOptionalNonEmptyBoundedText(
          parsed.body,
          PUBLICATION_DRAFT_BODY_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Publication draft body is invalid.'
        });
        return true;
      }

      if (
        !isValidOptionalNonEmptyBoundedText(
          parsed.disclosureText,
          PUBLICATION_DRAFT_DISCLOSURE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Publication draft disclosure is invalid.'
        });
        return true;
      }

      if (
        parsed.status !== undefined &&
        !isAllowedPublicationDraftStatus(parsed.status)
      ) {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft status.'
        });
        return true;
      }

      if (!isValidOptionalHttpsUrl(parsed.publicUrl)) {
        writeJson(request, response, 400, {
          error: 'Publication public URL must be a valid https link.'
        });
        return true;
      }

      if (!isValidOptionalIsoDate(parsed.scheduledAt)) {
        writeJson(request, response, 400, {
          error: 'Publication scheduled date is invalid.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.reviewNote,
          ADMIN_REVIEW_NOTE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Publication draft review note is too long.'
        });
        return true;
      }

      try {
        const result = await updateAdminPublicationDraft(parsed);
        if (!result.updated || !result.draft) {
          writeJson(request, response, 404, {
            error: 'Publication draft was not found.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: parsed.status
            ? `publication_draft.${parsed.status}`
            : 'publication_draft.update',
          entityType: 'publication_draft',
          entityId: result.draft.id,
          summary: `Publication draft updated for ${result.draft.sponsor_company_name}.`,
          metadata: {
            status: result.draft.status,
            contributionId: result.draft.contribution_id,
            feedTarget: result.draft.feed_target,
            channel: result.draft.channel
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to update publication draft.', error);
        writeJson(request, response, 502, {
          error: 'Publication draft could not be updated.'
        });
      }
      return true;
    }

    return false;
  };
};
