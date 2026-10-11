import type {
  PublicationAutomationState,
  PublicationAutomationCommand,
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchMutationResult,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest,
  AdminPublicationBatchesResponse,
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftMutationResult,
  AdminPublicationDraftUpdateRequest,
  AdminPublicationDraftsResponse,
  AdminPublicationSlotAssignBatchRequest,
  AdminPublicationSlotAssignDraftRequest,
  AdminPublicationSlotCreateRequest,
  AdminPublicationSlotLifecycleRequest,
  AdminPublicationSlotMutationResult,
  AdminPublicationSlotsResponse,
  AdminPublicationSlotUpdateRequest,
  AdminSocialPublicationBatchPublishRequest,
  AdminSocialPublicationBatchPublishResult,
  AdminSocialPublicationJobsResponse
} from '@openg7/funding-core';

import type { FundingAdminSession } from './funding-admin-session.js';
import { errorMessageFromResponse } from './funding-admin-response.js';

/** Funding admin publication preparation and delivery endpoints; authentication belongs to the shared session. */
export class FundingAdminPublicationsClient {
  constructor(private readonly session: FundingAdminSession) {}

  async publicationAutomation(
    command?: PublicationAutomationCommand,
    filter: import('@openg7/funding-core').PublicationAutomationFilter = {}
  ): Promise<PublicationAutomationState | { id?: string }> {
    const query = new URLSearchParams();
    if (!command && filter.sponsorshipId)
      query.set('sponsorshipId', filter.sponsorshipId);
    if (!command && filter.deliveryId)
      query.set('deliveryId', filter.deliveryId);
    const response = await this.session.requestAdminJson(
      `/admin/publication-automation${query.size ? `?${query}` : ''}`,
      {
        auth: 'saved',
        method: command ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(command ? { body: command } : {})
      }
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new Error(data.code ?? 'AUTOMATION_UNAVAILABLE');
    }
    return response.json() as Promise<
      PublicationAutomationState | { id?: string }
    >;
  }

  async publicationMedia(
    deliveryId?: string
  ): Promise<{ id: string; url: string; alt: string; company: string }[]> {
    const query = new URLSearchParams();
    if (deliveryId !== undefined) query.set('deliveryId', deliveryId);
    const response = await this.session.requestAdminJson(
      `/admin/publication-automation/media${query.size ? `?${query}` : ''}`,
      { auth: 'saved', cache: 'no-store' }
    );
    if (!response.ok) throw new Error('AUTOMATION_UNAVAILABLE');
    return response.json() as Promise<
      { id: string; url: string; alt: string; company: string }[]
    >;
  }

  async getPublicationDrafts(
    token: string,
    id?: string
  ): Promise<AdminPublicationDraftsResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/publication-drafts${id ? '?draftId=' + encodeURIComponent(id) : ''}`,
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin publication drafts could not be loaded.');
    }

    return (await response.json()) as AdminPublicationDraftsResponse;
  }

  async createPublicationDraft(
    token: string,
    payload: AdminPublicationDraftCreateRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-drafts',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication draft could not be created.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async updatePublicationDraft(
    token: string,
    payload: AdminPublicationDraftUpdateRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-drafts/update',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication draft could not be updated.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async getPublicationBatches(
    token: string,
    id?: string
  ): Promise<AdminPublicationBatchesResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/publication-batches${id ? '?batchId=' + encodeURIComponent(id) : ''}`,
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin publication batches could not be loaded.');
    }

    return (await response.json()) as AdminPublicationBatchesResponse;
  }

  async createPublicationBatch(
    token: string,
    payload: AdminPublicationBatchCreateRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication batch could not be created.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async getPublicationSlots(
    token: string,
    id?: string
  ): Promise<AdminPublicationSlotsResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/publication-slots${id ? '?slotId=' + encodeURIComponent(id) : ''}`,
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin publication slots could not be loaded.');
    }

    return (await response.json()) as AdminPublicationSlotsResponse;
  }

  async createPublicationSlot(
    token: string,
    payload: AdminPublicationSlotCreateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-slots',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication slot could not be created.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async updatePublicationSlot(
    token: string,
    payload: AdminPublicationSlotUpdateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-slots/update',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication slot could not be updated.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async assignBatchToPublicationSlot(
    token: string,
    payload: AdminPublicationSlotAssignBatchRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-slots/assign-batch',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Batch could not be assigned to the publication slot.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async assignDraftToPublicationSlot(
    token: string,
    payload: AdminPublicationSlotAssignDraftRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-slots/assign-draft',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Draft could not be assigned to the publication slot.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async publishPublicationSlot(
    token: string,
    payload: AdminPublicationSlotLifecycleRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-slots/publish',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Publication slot could not be published.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async cancelPublicationSlot(
    token: string,
    payload: AdminPublicationSlotLifecycleRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-slots/cancel',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Publication slot could not be cancelled.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async assignDraftToBatch(
    token: string,
    payload: AdminPublicationBatchAssignRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches/assign',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Draft could not be assigned to the publication batch.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async unassignDraftFromBatch(
    token: string,
    payload: AdminPublicationBatchUnassignRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches/unassign',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Draft could not be removed from the publication batch.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async schedulePublicationBatch(
    token: string,
    payload: AdminPublicationBatchScheduleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches/schedule',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Publication batch could not be scheduled.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async publishPublicationBatch(
    token: string,
    payload: AdminPublicationBatchLifecycleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches/publish',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Publication batch could not be published.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async getSocialPublicationJobs(
    token: string
  ): Promise<AdminSocialPublicationJobsResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/social-publication-jobs',
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin social publication jobs could not be loaded.');
    }

    return (await response.json()) as AdminSocialPublicationJobsResponse;
  }

  async publishSocialPublicationBatch(
    token: string,
    payload: AdminSocialPublicationBatchPublishRequest
  ): Promise<AdminSocialPublicationBatchPublishResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches/publish-social',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
          response,
          'Publication batch could not be sent to the social provider.'
        )
      );
    }

    return (await response.json()) as AdminSocialPublicationBatchPublishResult;
  }

  async cancelPublicationBatch(
    token: string,
    payload: AdminPublicationBatchLifecycleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/publication-batches/cancel',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error('Publication batch could not be cancelled.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }
}
