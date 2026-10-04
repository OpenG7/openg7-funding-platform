import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminPublicationSlotAssignBatchRequest,
  AdminPublicationSlotAssignDraftRequest,
  AdminPublicationSlotCreateRequest,
  AdminPublicationSlotLifecycleRequest,
  AdminPublicationSlotUpdateRequest,
  SponsorFeedTarget
} from '@openg7/funding-core';

import type {
  listAdminPublicationSlots,
  createAdminPublicationSlot,
  updateAdminPublicationSlot,
  assignBatchToPublicationSlot,
  assignDraftToPublicationSlot,
  publishAdminPublicationSlot,
  cancelAdminPublicationSlot,
  insertAdminAuditLog
} from './fund-admin.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { AdminPublicationHttpDependencies } from './admin-publication-http.shared.js';
import {
  PUBLICATION_BATCH_MIN_CAPACITY,
  PUBLICATION_BATCH_MAX_CAPACITY,
  PUBLICATION_BATCH_NOTES_MAX_LENGTH,
  isValidPublicationBatchCapacity,
  isFutureDateString,
  isValidPublicationSlotTimezone,
  normalizePublicationSlotTimezone,
  channelLabel
} from './admin-publication-http.shared.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Publication ports preserve domain transitions, persistent snapshots and audit. */
export interface AdminPublicationSlotsHttpDependencies extends AdminPublicationHttpDependencies {
  readonly isAllowedSponsorFeedTarget: (
    value: unknown
  ) => value is SponsorFeedTarget | null;
  readonly listAdminPublicationSlots: (
    input?: Parameters<typeof listAdminPublicationSlots>[1]
  ) => ReturnType<typeof listAdminPublicationSlots>;
  readonly createAdminPublicationSlot: (
    input: Parameters<typeof createAdminPublicationSlot>[1]
  ) => ReturnType<typeof createAdminPublicationSlot>;
  readonly updateAdminPublicationSlot: (
    input: Parameters<typeof updateAdminPublicationSlot>[1]
  ) => ReturnType<typeof updateAdminPublicationSlot>;
  readonly assignBatchToPublicationSlot: (
    input: Parameters<typeof assignBatchToPublicationSlot>[1]
  ) => ReturnType<typeof assignBatchToPublicationSlot>;
  readonly assignDraftToPublicationSlot: (
    input: Parameters<typeof assignDraftToPublicationSlot>[1]
  ) => ReturnType<typeof assignDraftToPublicationSlot>;
  readonly publishAdminPublicationSlot: (
    input: Parameters<typeof publishAdminPublicationSlot>[1]
  ) => ReturnType<typeof publishAdminPublicationSlot>;
  readonly cancelAdminPublicationSlot: (
    input: Parameters<typeof cancelAdminPublicationSlot>[1]
  ) => ReturnType<typeof cancelAdminPublicationSlot>;
  readonly insertAdminAuditLog: (
    input: Parameters<typeof insertAdminAuditLog>[1]
  ) => ReturnType<typeof insertAdminAuditLog>;
}

/** Owned routes check API access before reading a body or invoking a domain port. */
export const createAdminPublicationSlotsHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  isValidUuid,
  isAllowedSponsorFeedChannel,
  isValidOptionalBoundedText,
  reportFailure,
  isAllowedSponsorFeedTarget,
  listAdminPublicationSlots,
  createAdminPublicationSlot,
  updateAdminPublicationSlot,
  assignBatchToPublicationSlot,
  assignDraftToPublicationSlot,
  publishAdminPublicationSlot,
  cancelAdminPublicationSlot,
  insertAdminAuditLog
}: AdminPublicationSlotsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/publication-slots',
        '/api/admin/publication-slots'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const result = await listAdminPublicationSlots({
          id:
            new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
              'slotId'
            ) ?? undefined
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load publication slots.', error);
        writeJson(request, response, 502, {
          error: 'Publication slots could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-slots',
        '/api/admin/publication-slots'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationSlotCreateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationSlotCreateRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot request body.'
        });
        return true;
      }

      if (!isAllowedSponsorFeedTarget(parsed.feedTarget)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot target.'
        });
        return true;
      }

      if (!isAllowedSponsorFeedChannel(parsed.channel)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot channel.'
        });
        return true;
      }

      if (!isFutureDateString(parsed.startsAt)) {
        writeJson(request, response, 400, {
          error: 'Publication slot date must be a future date.'
        });
        return true;
      }

      if (
        parsed.timezone !== undefined &&
        !isValidPublicationSlotTimezone(parsed.timezone)
      ) {
        writeJson(request, response, 400, {
          error: 'Publication slot timezone is invalid.'
        });
        return true;
      }

      if (!isValidPublicationBatchCapacity(parsed.capacity)) {
        writeJson(request, response, 400, {
          error: `Publication slot capacity must be an integer between ${PUBLICATION_BATCH_MIN_CAPACITY} and ${PUBLICATION_BATCH_MAX_CAPACITY}.`
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
          error: 'Publication slot notes are too long.'
        });
        return true;
      }

      try {
        const result = await createAdminPublicationSlot({
          ...parsed,
          startsAt: new Date(parsed.startsAt).toISOString(),
          timezone: normalizePublicationSlotTimezone(parsed.timezone)
        });
        if (!result.updated || !result.slot) {
          writeJson(request, response, 404, {
            error: 'Publication slots migration is missing.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_slot.create',
          entityType: 'publication_slot',
          entityId: result.slot.id,
          summary: `Publication slot created for ${channelLabel(result.slot.channel)} at ${result.slot.startsAt}.`,
          metadata: {
            feedTarget: result.slot.feedTarget,
            channel: result.slot.channel,
            startsAt: result.slot.startsAt,
            timezone: result.slot.timezone,
            capacity: result.slot.capacity
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to create publication slot.', error);
        writeJson(request, response, 502, {
          error: 'Publication slot could not be created.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-slots/update',
        '/api/admin/publication-slots/update'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationSlotUpdateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationSlotUpdateRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot update request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.slotId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot id.'
        });
        return true;
      }

      if (
        parsed.startsAt !== undefined &&
        !isFutureDateString(parsed.startsAt)
      ) {
        writeJson(request, response, 400, {
          error: 'Publication slot date must be a future date.'
        });
        return true;
      }

      if (
        parsed.timezone !== undefined &&
        !isValidPublicationSlotTimezone(parsed.timezone)
      ) {
        writeJson(request, response, 400, {
          error: 'Publication slot timezone is invalid.'
        });
        return true;
      }

      if (
        parsed.capacity !== undefined &&
        !isValidPublicationBatchCapacity(parsed.capacity)
      ) {
        writeJson(request, response, 400, {
          error: `Publication slot capacity must be an integer between ${PUBLICATION_BATCH_MIN_CAPACITY} and ${PUBLICATION_BATCH_MAX_CAPACITY}.`
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
          error: 'Publication slot notes are too long.'
        });
        return true;
      }

      try {
        const result = await updateAdminPublicationSlot({
          ...parsed,
          startsAt:
            parsed.startsAt !== undefined
              ? new Date(parsed.startsAt).toISOString()
              : undefined,
          timezone:
            parsed.timezone !== undefined
              ? normalizePublicationSlotTimezone(parsed.timezone)
              : undefined
        });
        if (!result.updated || !result.slot) {
          writeJson(request, response, 409, {
            error:
              'Publication slot was not found, is final, is in the past, or capacity would be exceeded.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_slot.update',
          entityType: 'publication_slot',
          entityId: result.slot.id,
          summary: `Publication slot updated for ${channelLabel(result.slot.channel)} at ${result.slot.startsAt}.`,
          metadata: {
            startsAt: result.slot.startsAt,
            timezone: result.slot.timezone,
            capacity: result.slot.capacity,
            capacityUsed: result.slot.capacityUsed
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to update publication slot.', error);
        writeJson(request, response, 502, {
          error: 'Publication slot could not be updated.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-slots/assign-batch',
        '/api/admin/publication-slots/assign-batch'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationSlotAssignBatchRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationSlotAssignBatchRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot batch assignment request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.slotId) || !isValidUuid(parsed.batchId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot or batch id.'
        });
        return true;
      }

      try {
        const result = await assignBatchToPublicationSlot(parsed);
        if (!result.updated || !result.slot) {
          writeJson(request, response, 409, {
            error:
              'Batch could not be assigned: it must match the slot channel and target, stay within capacity, and not already belong to another slot.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_slot.assign_batch',
          entityType: 'publication_slot',
          entityId: result.slot.id,
          summary: `Batch assigned to publication slot ${result.slot.startsAt}.`,
          metadata: { slotId: parsed.slotId, batchId: parsed.batchId }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to assign batch to publication slot.', error);
        writeJson(request, response, 502, {
          error: 'Batch could not be assigned to the publication slot.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-slots/assign-draft',
        '/api/admin/publication-slots/assign-draft'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationSlotAssignDraftRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationSlotAssignDraftRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot draft assignment request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.slotId) || !isValidUuid(parsed.draftId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot or draft id.'
        });
        return true;
      }

      try {
        const result = await assignDraftToPublicationSlot(parsed);
        if (!result.updated || !result.slot) {
          writeJson(request, response, 409, {
            error:
              'Draft could not be assigned: it must be approved, unbatched, match the slot target/channel, and fit remaining capacity.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_slot.assign_draft',
          entityType: 'publication_slot',
          entityId: result.slot.id,
          summary: `Draft assigned directly to publication slot ${result.slot.startsAt}.`,
          metadata: { slotId: parsed.slotId, draftId: parsed.draftId }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to assign draft to publication slot.', error);
        writeJson(request, response, 502, {
          error: 'Draft could not be assigned to the publication slot.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-slots/publish',
        '/api/admin/publication-slots/publish'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationSlotLifecycleRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationSlotLifecycleRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.slotId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot id.'
        });
        return true;
      }

      try {
        const result = await publishAdminPublicationSlot(parsed);
        if (!result.updated || !result.slot) {
          writeJson(request, response, 409, {
            error:
              'Publication slot was not found, is not scheduled, or has no assigned drafts.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_slot.publish',
          entityType: 'publication_slot',
          entityId: result.slot.id,
          summary: `Publication slot published (${result.slot.assignedDraftIds.length} draft(s)).`,
          metadata: {
            channel: result.slot.channel,
            feedTarget: result.slot.feedTarget,
            assignedDraftIds: result.slot.assignedDraftIds
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to publish publication slot.', error);
        writeJson(request, response, 502, {
          error: 'Publication slot could not be published.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/publication-slots/cancel',
        '/api/admin/publication-slots/cancel'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminPublicationSlotLifecycleRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminPublicationSlotLifecycleRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid request object.');
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.slotId)) {
        writeJson(request, response, 400, {
          error: 'Invalid publication slot id.'
        });
        return true;
      }

      try {
        const result = await cancelAdminPublicationSlot(parsed);
        if (!result.updated || !result.slot) {
          writeJson(request, response, 409, {
            error: 'Publication slot was not found or is already final.'
          });
          return true;
        }

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'publication_slot.cancel',
          entityType: 'publication_slot',
          entityId: result.slot.id,
          summary: `Publication slot cancelled (${channelLabel(result.slot.channel)}).`,
          metadata: {
            channel: result.slot.channel,
            feedTarget: result.slot.feedTarget
          }
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to cancel publication slot.', error);
        writeJson(request, response, 502, {
          error: 'Publication slot could not be cancelled.'
        });
      }
      return true;
    }

    return false;
  };
};
