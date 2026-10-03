import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest
} from '@openg7/funding-core';

import type {
  listAdminPublicationBatches,
  createAdminPublicationBatch,
  assignDraftToPublicationBatch,
  unassignDraftFromPublicationBatch,
  scheduleAdminPublicationBatch,
  publishAdminPublicationBatch,
  cancelAdminPublicationBatch,
  listAdminSocialPublicationJobs,
  getPublicationBatchById,
  insertAdminAuditLog
} from './fund-admin.repository.js';
import type { queuePublicationBatchFullNotification } from './email-notification.service.js';
import { createRouteMatcher } from './http-routing.js';
import type { AdminPublicationHttpDependencies } from './admin-publication-http.shared.js';
import {
  PUBLICATION_BATCH_MIN_CAPACITY,
  PUBLICATION_BATCH_MAX_CAPACITY,
  PUBLICATION_BATCH_NOTES_MAX_LENGTH,
  isValidPublicationBatchCapacity,
  isFutureDateString,
  channelLabel
} from './admin-publication-http.shared.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Publication ports preserve domain transitions, persistent snapshots and audit. */
export interface AdminPublicationBatchesHttpDependencies extends AdminPublicationHttpDependencies {
  readonly socialPublicationRuntime: () => Parameters<
    typeof listAdminSocialPublicationJobs
  >[1];
  readonly reportWarning: (message: string, error: unknown) => void;
  readonly listAdminPublicationBatches: (
    input?: Parameters<typeof listAdminPublicationBatches>[1]
  ) => ReturnType<typeof listAdminPublicationBatches>;
  readonly createAdminPublicationBatch: (
    input: Parameters<typeof createAdminPublicationBatch>[1]
  ) => ReturnType<typeof createAdminPublicationBatch>;
  readonly assignDraftToPublicationBatch: (
    input: Parameters<typeof assignDraftToPublicationBatch>[1]
  ) => ReturnType<typeof assignDraftToPublicationBatch>;
  readonly unassignDraftFromPublicationBatch: (
    input: Parameters<typeof unassignDraftFromPublicationBatch>[1]
  ) => ReturnType<typeof unassignDraftFromPublicationBatch>;
  readonly scheduleAdminPublicationBatch: (
    input: Parameters<typeof scheduleAdminPublicationBatch>[1]
  ) => ReturnType<typeof scheduleAdminPublicationBatch>;
  readonly publishAdminPublicationBatch: (
    input: Parameters<typeof publishAdminPublicationBatch>[1]
  ) => ReturnType<typeof publishAdminPublicationBatch>;
  readonly cancelAdminPublicationBatch: (
    input: Parameters<typeof cancelAdminPublicationBatch>[1]
  ) => ReturnType<typeof cancelAdminPublicationBatch>;
  readonly listAdminSocialPublicationJobs: (
    input: Parameters<typeof listAdminSocialPublicationJobs>[1]
  ) => ReturnType<typeof listAdminSocialPublicationJobs>;
  readonly getPublicationBatchById: (
    input: Parameters<typeof getPublicationBatchById>[1]
  ) => ReturnType<typeof getPublicationBatchById>;
  readonly insertAdminAuditLog: (
    input: Parameters<typeof insertAdminAuditLog>[1]
  ) => ReturnType<typeof insertAdminAuditLog>;
  readonly queuePublicationBatchFullNotification: (
    input: Parameters<typeof queuePublicationBatchFullNotification>[1]
  ) => ReturnType<typeof queuePublicationBatchFullNotification>;
}

/** Owned routes check API access before reading a body or invoking a domain port. */
export const createAdminPublicationBatchesHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  isValidUuid,
  isAllowedSponsorFeedChannel,
  isValidOptionalBoundedText,
  reportFailure,
  socialPublicationRuntime,
  reportWarning,
  listAdminPublicationBatches,
  createAdminPublicationBatch,
  assignDraftToPublicationBatch,
  unassignDraftFromPublicationBatch,
  scheduleAdminPublicationBatch,
  publishAdminPublicationBatch,
  cancelAdminPublicationBatch,
  listAdminSocialPublicationJobs,
  getPublicationBatchById,
  insertAdminAuditLog,
  queuePublicationBatchFullNotification
}: AdminPublicationBatchesHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/publication-batches',
        '/api/admin/publication-batches'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const result = await listAdminPublicationBatches({
          id:
            new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
              'batchId'
            ) ?? undefined
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load publication batches.', error);
        writeJson(request, response, 502, {
          error: 'Publication batches could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches',
        '/api/admin/publication-batches'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationBatchCreateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationBatchCreateRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch request body.'
        });
        return true;
      }

      if (!isAllowedSponsorFeedChannel(parsed.channel)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch channel.'
        });
        return true;
      }

      if (!isValidPublicationBatchCapacity(parsed.capacity)) {
        writeJson(request, response, 400, {
          error: `Publication batch capacity must be an integer between ${PUBLICATION_BATCH_MIN_CAPACITY} and ${PUBLICATION_BATCH_MAX_CAPACITY}.`
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.notes,
          PUBLICATION_BATCH_NOTES_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Publication batch notes are too long.'
        });
        return true;
      }

      try {
        const result = await createAdminPublicationBatch(parsed);
        if (!result.updated || !result.batch) {
          writeJson(request, response, 404, {
            error: 'Publication batches migration is missing.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_batch.create',
          entityType: 'publication_batch',
          entityId: result.batch.id,
          summary: `Publication batch created for ${channelLabel(result.batch.channel)} (capacity ${result.batch.capacity}).`,
          metadata: {
            channel: result.batch.channel,
            capacity: result.batch.capacity
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to create publication batch.', error);
        writeJson(request, response, 502, {
          error: 'Publication batch could not be created.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches/assign',
        '/api/admin/publication-batches/assign'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationBatchAssignRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationBatchAssignRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch assignment request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.batchId) || !isValidUuid(parsed.draftId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch or draft id.'
        });
        return true;
      }

      try {
        const result = await assignDraftToPublicationBatch(parsed);
        if (!result.updated || !result.draft) {
          writeJson(request, response, 409, {
            error:
              'Draft could not be assigned: it must be approved, match the batch channel, and the batch must be open with available capacity.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_batch.assign',
          entityType: 'publication_batch',
          entityId: parsed.batchId,
          summary: `Draft for ${result.draft.sponsor_company_name} assigned to batch.`,
          metadata: { draftId: parsed.draftId, batchId: parsed.batchId }
        });

        const batch = await getPublicationBatchById(parsed.batchId);
        if (batch && batch.status === 'open' && batch.capacityAvailable === 0) {
          const notificationResult =
            await queuePublicationBatchFullNotification({
              batchId: batch.id,
              idempotencyKey: `publication-batch:${batch.id}:full`,
              channel: batch.channel,
              capacity: batch.capacity
            });
          if (!notificationResult.queued && !notificationResult.sent) {
            reportWarning(
              'Publication batch is full but the admin notification could not be sent.',
              notificationResult.error
            );
          }
        }

        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to assign draft to publication batch.', error);
        writeJson(request, response, 502, {
          error: 'Draft could not be assigned to the publication batch.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches/unassign',
        '/api/admin/publication-batches/unassign'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationBatchUnassignRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationBatchUnassignRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch unassignment request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.draftId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication draft id.'
        });
        return true;
      }

      try {
        const result = await unassignDraftFromPublicationBatch(parsed);
        if (!result.updated || !result.draft) {
          writeJson(request, response, 404, {
            error: 'Draft is not assigned to a batch, or is already published.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_batch.unassign',
          entityType: 'publication_draft',
          entityId: result.draft.id,
          summary: `Draft for ${result.draft.sponsor_company_name} removed from batch.`,
          metadata: { draftId: parsed.draftId }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure(
          'Failed to unassign draft from publication batch.',
          error
        );
        writeJson(request, response, 502, {
          error: 'Draft could not be removed from the publication batch.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches/schedule',
        '/api/admin/publication-batches/schedule'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationBatchScheduleRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationBatchScheduleRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch schedule request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.batchId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch id.'
        });
        return true;
      }

      if (
        typeof parsed.scheduledAt !== 'string' ||
        !isFutureDateString(parsed.scheduledAt)
      ) {
        writeJson(request, response, 400, {
          error: 'Publication batch scheduled date must be a future date.'
        });
        return true;
      }

      try {
        const result = await scheduleAdminPublicationBatch(parsed);
        if (!result.updated || !result.batch) {
          writeJson(request, response, 409, {
            error: 'Publication batch was not found or cannot be scheduled.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_batch.schedule',
          entityType: 'publication_batch',
          entityId: result.batch.id,
          summary: `Publication batch scheduled for ${result.batch.scheduledAt}.`,
          metadata: {
            channel: result.batch.channel,
            scheduledAt: result.batch.scheduledAt
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to schedule publication batch.', error);
        writeJson(request, response, 502, {
          error: 'Publication batch could not be scheduled.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches/publish',
        '/api/admin/publication-batches/publish'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationBatchLifecycleRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationBatchLifecycleRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.batchId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch id.'
        });
        return true;
      }

      try {
        const result = await publishAdminPublicationBatch(parsed);
        if (!result.updated || !result.batch) {
          writeJson(request, response, 409, {
            error:
              'Publication batch was not found or must be scheduled before it can be published.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_batch.publish',
          entityType: 'publication_batch',
          entityId: result.batch.id,
          summary: `Publication batch published (${result.batch.assignedDraftIds.length} sponsor(s)).`,
          metadata: {
            channel: result.batch.channel,
            assignedDraftIds: result.batch.assignedDraftIds
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to publish publication batch.', error);
        writeJson(request, response, 502, {
          error: 'Publication batch could not be published.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/social-publication-jobs',
        '/api/admin/social-publication-jobs'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const result = await listAdminSocialPublicationJobs(
          socialPublicationRuntime()
        );
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load social publication jobs.', error);
        writeJson(request, response, 502, {
          error: 'Social publication jobs could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches/publish-social',
        '/api/admin/publication-batches/publish-social'
      )
    ) {
      if (!ensureAdminAccess(request, response)) return true;
      writeJson(request, response, 409, {
        code: 'FINAL_APPROVAL_REQUIRED',
        error:
          'Prepare and approve the exact publication in /admin/fundraiser/publications/automation.'
      });
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-batches/cancel',
        '/api/admin/publication-batches/cancel'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationBatchLifecycleRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationBatchLifecycleRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.batchId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication batch id.'
        });
        return true;
      }

      try {
        const result = await cancelAdminPublicationBatch(parsed);
        if (!result.updated || !result.batch) {
          writeJson(request, response, 409, {
            error: 'Publication batch was not found or is already final.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_batch.cancel',
          entityType: 'publication_batch',
          entityId: result.batch.id,
          summary: `Publication batch cancelled (${channelLabel(result.batch.channel)}).`,
          metadata: { channel: result.batch.channel }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to cancel publication batch.', error);
        writeJson(request, response, 502, {
          error: 'Publication batch could not be cancelled.'
        });
      }
      return true;
    }

    return false;
  };
};
