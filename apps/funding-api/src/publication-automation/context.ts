import type { Pool, PoolClient } from 'pg';
import type {
  PublicationAutomationCommand,
  PublicationDelivery,
  PublicationFeed,
  PublicationFeedId
} from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

import type { Media } from './media.js';
import type { Db, Source } from './sources.js';

export interface DeliveryRow {
  id: string;
  feed_id: PublicationFeedId;
  kind: PublicationDelivery['kind'];
  batch_id: string | null;
  message: string;
  scheduled_at: Date;
  media_id: string | null;
  media_snapshot: Media | null;
  source_snapshot: Source[];
  account_id: string;
  mode: PublicationDelivery['mode'];
  auto_managed: boolean;
  sponsors?: PublicationDelivery['sponsors'];
  version: number;
  status: PublicationDelivery['status'];
  attempts: number;
  next_attempt_at: Date | null;
  external_post_id: string | null;
  external_post_url: string | null;
  provider_media_id: string | null;
  error_code: string | null;
  approved_at: Date | null;
  published_at: Date | null;
}

export interface PublicationReadContext {
  readonly pool: Pool;
  readonly env: NodeJS.ProcessEnv;
  feeds(db?: Db): Promise<PublicationFeed[]>;
}

interface PublicationWorkerSettingsReader {
  workerSettings(
    db?: Db,
    lock?: '' | 'FOR SHARE' | 'FOR UPDATE'
  ): Promise<{ enabled: boolean; version: number }>;
}

export type PublicationCommandExecutor = (
  input: PublicationAutomationCommand,
  actor: string,
  automatic?: boolean,
  client?: PoolClient
) => Promise<{ id?: string }>;

export type PublicationPrepare = (
  feedId: PublicationFeedId,
  actor: string,
  now?: Date
) => Promise<void>;

export type PublicationComplete = (
  db: Db,
  row: DeliveryRow,
  postId: string,
  url: string | null,
  actor: string
) => Promise<void>;

export interface PublicationCommandsContext
  extends PublicationReadContext, PublicationWorkerSettingsReader {
  readonly storage: SponsorMediaStorage;
  prepare: PublicationPrepare;
  complete: PublicationComplete;
}

export interface PublicationPlanningContext extends PublicationReadContext {
  command: PublicationCommandExecutor;
}

export interface PublicationDeliveryWorkerContext
  extends PublicationReadContext, PublicationWorkerSettingsReader {
  readonly storage: SponsorMediaStorage;
  command: PublicationCommandExecutor;
  prepare: PublicationPrepare;
  guardEligibility(): Promise<void>;
}

export const publicDelivery = (r: DeliveryRow): PublicationDelivery => ({
  id: r.id,
  feedId: r.feed_id,
  kind: r.kind,
  batchId: r.batch_id,
  message: r.message,
  scheduledAt: r.scheduled_at.toISOString(),
  mediaId: r.media_id,
  mediaUrl: r.media_snapshot?.url ?? null,
  mediaAlt: r.media_snapshot?.alt ?? null,
  accountId: r.account_id,
  mode: r.mode,
  autoManaged: r.auto_managed,
  sponsors: r.sponsors ?? [],
  version: r.version,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at?.toISOString() ?? null,
  externalPostId: r.external_post_id,
  externalPostUrl: r.external_post_url,
  errorCode: r.error_code,
  approvedAt: r.approved_at?.toISOString() ?? null,
  publishedAt: r.published_at?.toISOString() ?? null
});

export async function audit(
  db: Db,
  actor: string,
  action: string,
  id: string,
  metadata: object = {},
  entityType = 'publication_delivery'
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES($1,$2,$5,$3,$2,$4::jsonb)`,
    [
      actor,
      `publication_automation.${action}`,
      id,
      JSON.stringify(metadata),
      entityType
    ]
  );
}
