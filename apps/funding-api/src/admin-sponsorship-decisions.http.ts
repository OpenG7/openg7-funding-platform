import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipRejectionRefundHandling,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipReviewStatus,
  SponsorshipWebsiteVisibilityRequest
} from '@openg7/funding-core';

import type { queueSponsorshipRejectionEmail } from './email-notification.service.js';
import type { AdminAuditLogInput } from './fund-admin.repository.js';
import type {
  getAdminSponsorshipById,
  SponsorshipMutationStatus,
  updateSponsorshipPublication,
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipReview
} from './fund-contributions.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type {
  isSponsorshipWebsiteVisibilityRequest,
  setSponsorshipWebsiteVisibility
} from './sponsorship-website.service.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Decision ports preserve payment, review, visibility and publication as distinct states. */
export interface AdminSponsorshipDecisionsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly databaseAvailable: () => boolean;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (
    request: ApiRequest,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writeSponsorshipMutationFailure: (
    request: ApiRequest,
    response: ApiResponse,
    status: SponsorshipMutationStatus,
    details?: {
      readonly currentVersion?: string | null;
      readonly paymentStatus?: string | null;
    }
  ) => void;
  readonly adminReviewNoteMaxLength: number;
  readonly sponsorMessageMaxLength: number;
  readonly isValidOptionalBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly isValidSponsorEmail: (value: unknown) => value is string;
  readonly isValidAdminExpectedVersion: (value: unknown) => value is string;
  readonly isValidOptionalHttpsUrl: (value: unknown) => boolean;
  readonly isAllowedSponsorFeedTarget: (
    value: unknown
  ) => value is SponsorFeedTarget | null;
  readonly allowedSponsorshipReviewStatuses: ReadonlySet<SponsorshipReviewStatus>;
  readonly allowedSponsorFeedStatuses: ReadonlySet<SponsorFeedStatus>;
  readonly allowedSponsorFeedChannels: ReadonlySet<SponsorFeedChannel>;
  readonly isSponsorshipWebsiteVisibilityRequest: typeof isSponsorshipWebsiteVisibilityRequest;
  readonly updateSponsorshipReview: (
    input: Parameters<typeof updateSponsorshipReview>[1]
  ) => ReturnType<typeof updateSponsorshipReview>;
  readonly updateSponsorshipRefundWorkflowStatus: (
    input: Parameters<typeof updateSponsorshipRefundWorkflowStatus>[1]
  ) => ReturnType<typeof updateSponsorshipRefundWorkflowStatus>;
  readonly getAdminSponsorshipById: (
    contributionId: string
  ) => ReturnType<typeof getAdminSponsorshipById>;
  readonly queueSponsorshipRejectionEmail: (
    input: Parameters<typeof queueSponsorshipRejectionEmail>[1]
  ) => ReturnType<typeof queueSponsorshipRejectionEmail>;
  readonly setSponsorshipWebsiteVisibility: (
    input: SponsorshipWebsiteVisibilityRequest,
    actor: string
  ) => ReturnType<typeof setSponsorshipWebsiteVisibility>;
  readonly updateSponsorshipPublication: (
    input: Parameters<typeof updateSponsorshipPublication>[1]
  ) => ReturnType<typeof updateSponsorshipPublication>;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<unknown>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

const SPONSOR_PUBLIC_SLUG_MAX_LENGTH = 120;
const SPONSOR_PUBLIC_SUMMARY_MAX_LENGTH = 500;
const SPONSOR_FEED_NOTES_MAX_LENGTH = 1000;
const allowedSponsorshipRejectionRefundHandling =
  new Set<AdminSponsorshipRejectionRefundHandling>([
    'none',
    'manual_required',
    'manual_completed'
  ]);

const isAllowedSponsorshipRejectionRefundHandling = (
  value: unknown
): value is AdminSponsorshipRejectionRefundHandling =>
  typeof value === 'string' &&
  allowedSponsorshipRejectionRefundHandling.has(
    value as AdminSponsorshipRejectionRefundHandling
  );

const isValidOptionalPublicSlug = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    value.trim().length <= SPONSOR_PUBLIC_SLUG_MAX_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim()));

/** Owned POST routes authorize before reading decisions; unrelated routes fall through. */
export const createAdminSponsorshipDecisionsHttpHandler = ({
  publicBaseOrigin,
  databaseAvailable,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  writeSponsorshipMutationFailure,
  adminReviewNoteMaxLength: ADMIN_REVIEW_NOTE_MAX_LENGTH,
  sponsorMessageMaxLength: SPONSOR_MESSAGE_MAX_LENGTH,
  isValidOptionalBoundedText,
  isValidSponsorEmail,
  isValidAdminExpectedVersion,
  isValidOptionalHttpsUrl,
  isAllowedSponsorFeedTarget,
  allowedSponsorshipReviewStatuses,
  allowedSponsorFeedStatuses,
  allowedSponsorFeedChannels,
  isSponsorshipWebsiteVisibilityRequest,
  updateSponsorshipReview,
  updateSponsorshipRefundWorkflowStatus,
  getAdminSponsorshipById,
  queueSponsorshipRejectionEmail,
  setSponsorshipWebsiteVisibility,
  updateSponsorshipPublication,
  insertAdminAuditLog,
  reportFailure
}: AdminSponsorshipDecisionsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  const isAllowedSponsorshipReviewStatus = (
    value: unknown
  ): value is SponsorshipReviewStatus =>
    typeof value === 'string' &&
    allowedSponsorshipReviewStatuses.has(value as SponsorshipReviewStatus);

  const isAllowedSponsorFeedStatus = (
    value: unknown
  ): value is SponsorFeedStatus =>
    typeof value === 'string' &&
    allowedSponsorFeedStatuses.has(value as SponsorFeedStatus);

  const parseSponsorFeedChannelsFromRequest = (
    value: unknown
  ): readonly SponsorFeedChannel[] | null => {
    if (!Array.isArray(value)) return null;
    const uniqueChannels = [...new Set(value)];
    if (
      uniqueChannels.some(
        (channel) =>
          typeof channel !== 'string' ||
          !allowedSponsorFeedChannels.has(channel as SponsorFeedChannel)
      )
    )
      return null;
    return uniqueChannels as readonly SponsorFeedChannel[];
  };

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/review',
        '/api/admin/sponsorships/review'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminSponsorshipReviewRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminSponsorshipReviewRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship review request body.'
        });
        return true;
      }

      if (
        typeof parsed.contributionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          parsed.contributionId
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Invalid contribution id.'
        });
        return true;
      }

      if (!isAllowedSponsorshipReviewStatus(parsed.reviewStatus)) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship review status.'
        });
        return true;
      }

      const reviewNote =
        typeof parsed.reviewNote === 'string' ? parsed.reviewNote.trim() : '';
      const isRejection = parsed.reviewStatus === 'rejected';
      const notifySponsor = isRejection && parsed.notifySponsor !== false;
      const notificationEmail =
        typeof parsed.notificationEmail === 'string'
          ? parsed.notificationEmail.trim()
          : '';
      const sponsorMessage =
        typeof parsed.sponsorMessage === 'string'
          ? parsed.sponsorMessage.trim()
          : '';
      const refundHandling: AdminSponsorshipRejectionRefundHandling =
        isRejection ? (parsed.refundHandling ?? 'none') : 'none';
      const refundNote =
        typeof parsed.refundNote === 'string' ? parsed.refundNote.trim() : '';

      if (
        !isValidOptionalBoundedText(
          parsed.reviewNote,
          ADMIN_REVIEW_NOTE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Review note is too long.'
        });
        return true;
      }

      if (isRejection && !reviewNote) {
        writeJson(request, response, 400, {
          error: 'A rejection reason is required.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.sponsorMessage,
          SPONSOR_MESSAGE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Sponsor notification message is too long.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.refundNote,
          ADMIN_REVIEW_NOTE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Refund note is too long.'
        });
        return true;
      }

      if (
        isRejection &&
        !isAllowedSponsorshipRejectionRefundHandling(refundHandling)
      ) {
        writeJson(request, response, 400, {
          error: 'Invalid rejection refund handling.'
        });
        return true;
      }

      if (notifySponsor && !isValidSponsorEmail(notificationEmail)) {
        writeJson(request, response, 400, {
          error: 'A valid sponsor notification email is required.'
        });
        return true;
      }

      if (notifySponsor && !sponsorMessage) {
        writeJson(request, response, 400, {
          error: 'A sponsor-facing rejection message is required.'
        });
        return true;
      }

      if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
        writeJson(request, response, 400, {
          error: 'Sponsorship version is required.'
        });
        return true;
      }

      try {
        const updated = await updateSponsorshipReview({
          contributionId: parsed.contributionId,
          reviewStatus: parsed.reviewStatus,
          reviewNote: reviewNote || null,
          expectedVersion: parsed.expectedVersion
        });

        if (!updated.updated) {
          writeSponsorshipMutationFailure(request, response, updated.status, {
            currentVersion: updated.currentVersion,
            paymentStatus: updated.paymentStatus
          });
          return true;
        }

        const refundWorkflowStatus =
          isRejection && refundHandling === 'manual_required'
            ? 'requested'
            : isRejection && refundHandling === 'manual_completed'
              ? 'completed'
              : undefined;
        if (refundWorkflowStatus) {
          await updateSponsorshipRefundWorkflowStatus({
            contributionId: parsed.contributionId,
            refundStatus: refundWorkflowStatus,
            refundNote: refundNote || null
          });
        }

        const updatedSponsorship = isRejection
          ? await getAdminSponsorshipById(parsed.contributionId)
          : null;
        const notificationResult =
          notifySponsor && updatedSponsorship
            ? await queueSponsorshipRejectionEmail({
                to: notificationEmail,
                contributionId: parsed.contributionId,
                publicReference: updatedSponsorship.public_reference,
                sponsorName:
                  updatedSponsorship.sponsor_company_name ??
                  updatedSponsorship.public_name ??
                  'commanditaire',
                amount: updatedSponsorship.amount,
                currency: updatedSponsorship.currency,
                reviewReason: reviewNote,
                sponsorMessage,
                refundHandling,
                refundNote: refundNote || undefined,
                idempotencyKey: `sponsorship-rejection:${parsed.contributionId}:${updated.currentVersion}`
              })
            : null;

        const result: AdminSponsorshipReviewResult = {
          updated: updated.updated,
          reviewStatus: parsed.reviewStatus,
          ...(isRejection ? { refundHandling } : {}),
          ...(refundWorkflowStatus ? { refundWorkflowStatus } : {}),
          ...(notificationResult
            ? {
                notification: {
                  queued: notificationResult.queued,
                  attempted: notificationResult.attempted,
                  sent: notificationResult.sent,
                  messageId: notificationResult.messageId,
                  error: notificationResult.error
                }
              }
            : {})
        };
        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: `sponsorship_review.${parsed.reviewStatus}`,
          entityType: 'sponsorship',
          entityId: parsed.contributionId,
          summary: `Sponsorship review set to ${parsed.reviewStatus}.`,
          metadata: {
            reviewStatus: parsed.reviewStatus,
            hasReviewNote: Boolean(reviewNote),
            ...(isRejection
              ? {
                  notifySponsor,
                  notificationEmail: notifySponsor ? notificationEmail : null,
                  notificationMessageId: notificationResult?.messageId ?? null,
                  notificationSent: notificationResult?.sent ?? false,
                  notificationError: notificationResult?.error ?? null,
                  refundHandling,
                  refundWorkflowStatus: refundWorkflowStatus ?? null,
                  hasRefundNote: Boolean(refundNote)
                }
              : {})
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to update sponsorship review.', error);
        writeJson(request, response, 502, {
          error: 'Sponsorship review could not be updated.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/website-visibility',
        '/api/admin/sponsorships/website-visibility'
      )
    ) {
      if (!ensureAdminAccess(request, response) || !databaseAvailable())
        return true;
      if (
        request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      ) {
        writeJson(request, response, 415, {
          code: 'WEBSITE_VISIBILITY_CONTENT_TYPE',
          error: 'JSON content type required.'
        });
        return true;
      }
      let input: unknown;
      try {
        input = JSON.parse(await readBody(request));
      } catch {
        input = null;
      }
      if (!isSponsorshipWebsiteVisibilityRequest(input)) {
        writeJson(request, response, 400, {
          error: 'Invalid or unconfirmed website visibility decision.',
          code: 'WEBSITE_VISIBILITY_INVALID'
        });
        return true;
      }
      try {
        const outcome = await setSponsorshipWebsiteVisibility(
          input,
          getAdminAuditActor(request)
        );
        const status =
          outcome === 'not_found'
            ? 404
            : ['conflict', 'blocked'].includes(outcome)
              ? 409
              : 200;
        writeJson(request, response, status, {
          outcome,
          code: `WEBSITE_VISIBILITY_${outcome.toUpperCase()}`
        });
      } catch {
        writeJson(request, response, 503, {
          error: 'Website visibility could not be updated.',
          code: 'WEBSITE_VISIBILITY_UNAVAILABLE'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/publication',
        '/api/admin/sponsorships/publication'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminSponsorshipPublicationRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminSponsorshipPublicationRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship publication request body.'
        });
        return true;
      }

      if (
        typeof parsed.contributionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          parsed.contributionId
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Invalid contribution id.'
        });
        return true;
      }

      if (!isValidOptionalPublicSlug(parsed.publicSlug)) {
        writeJson(request, response, 400, {
          error: 'Public slug must use lowercase letters, numbers, and hyphens.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.publicSummary,
          SPONSOR_PUBLIC_SUMMARY_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Public summary is too long.'
        });
        return true;
      }

      if (!isAllowedSponsorFeedTarget(parsed.feedTarget)) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship feed target.'
        });
        return true;
      }

      const feedChannels = parseSponsorFeedChannelsFromRequest(
        parsed.feedChannels
      );
      if (!feedChannels) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship feed channels.'
        });
        return true;
      }

      if (!isAllowedSponsorFeedStatus(parsed.feedStatus)) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship feed status.'
        });
        return true;
      }

      if (!isValidOptionalHttpsUrl(parsed.feedPublicUrl)) {
        writeJson(request, response, 400, {
          error: 'Feed public URL must be a valid https link.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.feedNotes,
          SPONSOR_FEED_NOTES_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Feed notes are too long.'
        });
        return true;
      }

      if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
        writeJson(request, response, 400, {
          error: 'Sponsorship version is required.'
        });
        return true;
      }

      try {
        const publicationUpdate = await updateSponsorshipPublication({
          contributionId: parsed.contributionId,
          expectedVersion: parsed.expectedVersion,
          publicSlug:
            typeof parsed.publicSlug === 'string' &&
            parsed.publicSlug.trim().length > 0
              ? parsed.publicSlug.trim()
              : undefined,
          publicSummary:
            typeof parsed.publicSummary === 'string' &&
            parsed.publicSummary.trim().length > 0
              ? parsed.publicSummary.trim()
              : undefined,
          feedTarget:
            typeof parsed.feedTarget === 'string' &&
            parsed.feedTarget.trim().length > 0
              ? parsed.feedTarget
              : null,
          feedChannels,
          feedStatus: parsed.feedStatus,
          feedPublicUrl:
            typeof parsed.feedPublicUrl === 'string' &&
            parsed.feedPublicUrl.trim().length > 0
              ? parsed.feedPublicUrl.trim()
              : undefined,
          feedNotes:
            typeof parsed.feedNotes === 'string' &&
            parsed.feedNotes.trim().length > 0
              ? parsed.feedNotes.trim()
              : undefined
        });

        if (!publicationUpdate.updated) {
          writeSponsorshipMutationFailure(
            request,
            response,
            publicationUpdate.status,
            {
              currentVersion: publicationUpdate.currentVersion,
              paymentStatus: publicationUpdate.paymentStatus
            }
          );
          return true;
        }

        const result: AdminSponsorshipPublicationResult = {
          updated: publicationUpdate.updated,
          feedStatus: parsed.feedStatus
        };
        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'sponsorship_publication.update',
          entityType: 'sponsorship',
          entityId: parsed.contributionId,
          summary: `Sponsorship publication metadata updated to ${parsed.feedStatus}.`,
          metadata: {
            feedTarget: parsed.feedTarget ?? null,
            feedChannels: publicationUpdate.feedChannels,
            feedStatus: parsed.feedStatus,
            hasPublicUrl: Boolean(parsed.feedPublicUrl?.trim())
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to update sponsorship publication.', error);
        writeJson(request, response, 502, {
          error: 'Sponsorship publication could not be updated.'
        });
      }
      return true;
    }

    return false;
  };
};
