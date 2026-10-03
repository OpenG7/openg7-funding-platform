import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord,
  AdminSocialPublicationJobRecord,
  PublicationBatchStatus,
  PublicationDraftStatus,
  PublicationSlotStatus,
  SocialPublicationMode,
  SocialPublicationStatus,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

export interface PublicationDraftRow {
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

interface PublicationCapacityRow {
  readonly capacity: string;
  readonly capacity_used: string;
}

export interface PublicationBatchRow extends PublicationCapacityRow {
  readonly id: string;
  readonly channel: SponsorFeedChannel;
  readonly status: PublicationBatchStatus;
  readonly slot_id: string | null;
  readonly scheduled_at: string | null;
  readonly published_at: string | null;
  readonly notes: string | null;
  readonly assigned_draft_ids: readonly string[] | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PublicationSlotRow extends PublicationCapacityRow {
  readonly id: string;
  readonly feed_target: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly starts_at: string;
  readonly timezone: string;
  readonly status: PublicationSlotStatus;
  readonly notes: string | null;
  readonly assigned_batch_ids: readonly string[] | null;
  readonly assigned_draft_ids: readonly string[] | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SocialPublicationJobRow {
  readonly id: string;
  readonly batch_id: string;
  readonly channel: SponsorFeedChannel;
  readonly provider: 'facebook' | 'linkedin';
  readonly mode: SocialPublicationMode;
  readonly status: SocialPublicationStatus;
  readonly idempotency_key: string;
  readonly title: string;
  readonly body: string;
  readonly disclosure_text: string;
  readonly draft_ids: readonly string[] | null;
  readonly external_post_id: string | null;
  readonly external_post_url: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly attempted_at: string | null;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const assignedIds = (value: readonly string[] | null): readonly string[] =>
  (value ?? []).filter((id): id is string => Boolean(id));

const publicationCapacity = (
  row: PublicationCapacityRow
): Pick<
  AdminPublicationBatchRecord,
  'capacity' | 'capacityUsed' | 'capacityAvailable'
> => {
  const capacity = Number.parseInt(row.capacity, 10);
  const capacityUsed = Number.parseInt(row.capacity_used, 10);
  return {
    capacity,
    capacityUsed,
    capacityAvailable: Math.max(0, capacity - capacityUsed)
  };
};

export const mapPublicationDraftRow = (
  row: PublicationDraftRow
): AdminPublicationDraftRecord => ({
  id: row.id,
  contribution_id: row.contribution_id,
  sponsor_company_name: row.sponsor_company_name,
  sponsor_website_url: row.sponsor_website_url,
  sponsor_logo_url: row.sponsor_logo_url,
  sponsor_public_summary: row.sponsor_public_summary,
  feed_target: row.feed_target,
  channel: row.channel,
  title: row.title,
  body: row.body,
  disclosure_text: row.disclosure_text,
  status: row.status,
  public_url: row.public_url,
  scheduled_at: row.scheduled_at,
  approved_at: row.approved_at,
  published_at: row.published_at,
  review_note: row.review_note,
  batch_id: row.batch_id,
  slot_id: row.slot_id,
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const mapPublicationBatchRow = (
  row: PublicationBatchRow
): AdminPublicationBatchRecord => {
  const { capacity, capacityUsed, capacityAvailable } =
    publicationCapacity(row);

  return {
    id: row.id,
    channel: row.channel,
    capacity,
    status: row.status,
    slotId: row.slot_id,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    notes: row.notes,
    assignedDraftIds: assignedIds(row.assigned_draft_ids),
    capacityUsed,
    capacityAvailable,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

export const mapPublicationSlotRow = (
  row: PublicationSlotRow
): AdminPublicationSlotRecord => {
  const { capacity, capacityUsed, capacityAvailable } =
    publicationCapacity(row);

  return {
    id: row.id,
    feedTarget: row.feed_target,
    channel: row.channel,
    startsAt: row.starts_at,
    timezone: row.timezone,
    capacity,
    status: row.status,
    notes: row.notes,
    assignedBatchIds: assignedIds(row.assigned_batch_ids),
    assignedDraftIds: assignedIds(row.assigned_draft_ids),
    capacityUsed,
    capacityAvailable,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

export const mapSocialPublicationJobRow = (
  row: SocialPublicationJobRow
): AdminSocialPublicationJobRecord => ({
  id: row.id,
  batchId: row.batch_id,
  channel: row.channel,
  provider: row.provider,
  mode: row.mode,
  status: row.status,
  idempotencyKey: row.idempotency_key,
  title: row.title,
  body: row.body,
  disclosureText: row.disclosure_text,
  draftIds: assignedIds(row.draft_ids),
  externalPostId: row.external_post_id,
  externalPostUrl: row.external_post_url,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  attemptedAt: row.attempted_at,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
