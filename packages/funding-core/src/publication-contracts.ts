export type SponsorFeedTarget = 'openg7' | 'openg20';

export type SponsorFeedChannel = 'facebook' | 'linkedin';

export type SponsorFeedStatus =
  'not_planned' | 'planned' | 'drafted' | 'published';

export type PublicationDraftStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected'
  | 'cancelled';

/**
 * Indicative next collective-post date per channel, derived from the
 * earliest scheduled (not open, not published) publication batch. No
 * sponsor-identifying data: just a date, or null if none is scheduled yet.
 */
export interface PublicSponsorshipBatchAvailability {
  readonly channel: SponsorFeedChannel;
  readonly nextAvailableAt: string | null;
}

export interface PublicSponsorshipPublicationSlot {
  readonly feedTarget: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly startsAt: string;
  readonly timezone: string;
}

export interface PublicSponsorshipBatchAvailabilityResponse {
  readonly data_source: 'database' | 'empty';
  readonly availability: readonly PublicSponsorshipBatchAvailability[];
  readonly slots: readonly PublicSponsorshipPublicationSlot[];
}

export interface AdminPublicationDraftRecord {
  readonly id: string;
  readonly contribution_id: string;
  readonly sponsor_company_name: string;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_public_summary: string | null;
  readonly feed_target: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly title: string;
  readonly body: string;
  readonly disclosure_text: string;
  readonly status: PublicationDraftStatus;
  readonly public_url: string | null;
  readonly scheduled_at: string | null;
  readonly approved_at: string | null;
  readonly published_at: string | null;
  readonly review_note: string | null;
  readonly batch_id: string | null;
  readonly slot_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminPublicationDraftsResponse {
  readonly data_source: 'database';
  readonly drafts: readonly AdminPublicationDraftRecord[];
  readonly last_updated_at: string;
}

export interface AdminPublicationDraftCreateRequest {
  readonly contributionId: string;
  readonly feedTarget: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
}

export interface AdminPublicationDraftUpdateRequest {
  readonly draftId: string;
  readonly title?: string;
  readonly body?: string;
  readonly disclosureText?: string;
  readonly status?: PublicationDraftStatus;
  readonly publicUrl?: string;
  readonly scheduledAt?: string | null;
  readonly reviewNote?: string;
}

export interface AdminPublicationDraftMutationResult {
  readonly updated: boolean;
  readonly draft: AdminPublicationDraftRecord | null;
}

/**
 * A "lot": a capacity-bounded group of approved sponsorship drafts that go
 * out together as a single collective Facebook/LinkedIn post. Scheduling or
 * publishing a batch cascades to every draft assigned to it; publishing is
 * always an explicit admin action, never automatic on payment or approval.
 */
export type PublicationBatchStatus =
  'open' | 'scheduled' | 'published' | 'cancelled';

export type PublicationSlotStatus =
  'open' | 'scheduled' | 'published' | 'cancelled';

export interface AdminPublicationBatchRecord {
  readonly id: string;
  readonly channel: SponsorFeedChannel;
  readonly capacity: number;
  readonly status: PublicationBatchStatus;
  readonly slotId: string | null;
  readonly scheduledAt: string | null;
  readonly publishedAt: string | null;
  readonly notes: string | null;
  readonly assignedDraftIds: readonly string[];
  readonly capacityUsed: number;
  readonly capacityAvailable: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminPublicationBatchesResponse {
  readonly data_source: 'database';
  readonly batches: readonly AdminPublicationBatchRecord[];
  readonly last_updated_at: string;
}

export interface AdminPublicationBatchCreateRequest {
  readonly channel: SponsorFeedChannel;
  readonly capacity: number;
  readonly notes?: string;
}

export interface AdminPublicationBatchAssignRequest {
  readonly batchId: string;
  readonly draftId: string;
}

export interface AdminPublicationBatchUnassignRequest {
  readonly draftId: string;
}

export interface AdminPublicationBatchScheduleRequest {
  readonly batchId: string;
  readonly scheduledAt: string;
}

export interface AdminPublicationBatchLifecycleRequest {
  readonly batchId: string;
}

export interface AdminPublicationBatchMutationResult {
  readonly updated: boolean;
  readonly batch: AdminPublicationBatchRecord | null;
}

export interface AdminPublicationSlotRecord {
  readonly id: string;
  readonly feedTarget: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly startsAt: string;
  readonly timezone: string;
  readonly capacity: number;
  readonly status: PublicationSlotStatus;
  readonly notes: string | null;
  readonly assignedBatchIds: readonly string[];
  readonly assignedDraftIds: readonly string[];
  readonly capacityUsed: number;
  readonly capacityAvailable: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminPublicationSlotsResponse {
  readonly data_source: 'database';
  readonly slots: readonly AdminPublicationSlotRecord[];
  readonly last_updated_at: string;
}

export interface AdminPublicationSlotCreateRequest {
  readonly feedTarget: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly startsAt: string;
  readonly timezone?: string;
  readonly capacity: number;
  readonly notes?: string;
}

export interface AdminPublicationSlotUpdateRequest {
  readonly slotId: string;
  readonly startsAt?: string;
  readonly timezone?: string;
  readonly capacity?: number;
  readonly notes?: string | null;
}

export interface AdminPublicationSlotAssignBatchRequest {
  readonly slotId: string;
  readonly batchId: string;
}

export interface AdminPublicationSlotAssignDraftRequest {
  readonly slotId: string;
  readonly draftId: string;
}

export interface AdminPublicationSlotLifecycleRequest {
  readonly slotId: string;
}

export interface AdminPublicationSlotMutationResult {
  readonly updated: boolean;
  readonly slot: AdminPublicationSlotRecord | null;
}

export type SocialPublicationMode = 'disabled' | 'mock' | 'live';

export type SocialPublicationStatus =
  'pending' | 'publishing' | 'published' | 'failed';

export interface AdminSocialPublicationJobRecord {
  readonly id: string;
  readonly batchId: string;
  readonly channel: SponsorFeedChannel;
  readonly provider: 'facebook' | 'linkedin';
  readonly mode: SocialPublicationMode;
  readonly status: SocialPublicationStatus;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly draftIds: readonly string[];
  readonly externalPostId: string | null;
  readonly externalPostUrl: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly attemptedAt: string | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminSocialPublicationJobsResponse {
  readonly data_source: 'database';
  readonly mode: SocialPublicationMode;
  readonly configuredChannels: readonly SponsorFeedChannel[];
  readonly jobs: readonly AdminSocialPublicationJobRecord[];
  readonly last_updated_at: string;
}

export interface AdminSocialPublicationBatchPublishRequest {
  readonly batchId: string;
  readonly confirmationText: string;
}

export interface AdminSocialPublicationBatchPublishResult {
  readonly published: boolean;
  readonly mode: SocialPublicationMode;
  readonly job: AdminSocialPublicationJobRecord | null;
  readonly batch: AdminPublicationBatchRecord | null;
}
