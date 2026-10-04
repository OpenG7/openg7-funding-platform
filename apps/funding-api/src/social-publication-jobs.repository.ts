import type {
  AdminPublicationDraftRecord,
  AdminSocialPublicationBatchPublishResult,
  AdminSocialPublicationJobRecord,
  AdminSocialPublicationJobsResponse,
  SocialPublicationMode,
  SponsorFeedChannel
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  mapPublicationDraftRow,
  mapSocialPublicationJobRow,
  type PublicationDraftRow,
  type SocialPublicationJobRow
} from './fund-publication.mapping.js';
import { getAdminBackofficePresence } from './fund-admin.persistence.js';
import { getPublicationBatchById } from './fund-publication-batches.repository.js';
import {
  buildSocialPublicationText,
  truncatePublicationText
} from './fund-publication-content.js';

const socialPublicationJobSelect = `
  SELECT
    id::text AS id,
    batch_id::text AS batch_id,
    channel,
    provider,
    mode,
    status,
    idempotency_key,
    title,
    body,
    disclosure_text,
    array(SELECT draft_id::text FROM unnest(draft_ids) AS draft_id) AS draft_ids,
    external_post_id,
    external_post_url,
    error_code,
    error_message,
    attempted_at::text AS attempted_at,
    published_at::text AS published_at,
    created_at::text AS created_at,
    updated_at::text AS updated_at
  FROM social_publication_jobs
`;

const getSocialPublicationJobById = async (
  pool: Pool,
  jobId: string
): Promise<AdminSocialPublicationJobRecord | null> => {
  const query = await pool.query<SocialPublicationJobRow>(
    `
      ${socialPublicationJobSelect}
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [jobId]
  );
  const row = query.rows[0];
  return row ? mapSocialPublicationJobRow(row) : null;
};

export const listAdminSocialPublicationJobs = async (
  pool: Pool | null,
  runtime: {
    readonly mode: SocialPublicationMode;
    readonly configuredChannels: readonly SponsorFeedChannel[];
  }
): Promise<AdminSocialPublicationJobsResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      mode: runtime.mode,
      configuredChannels: runtime.configuredChannels,
      jobs: [],
      last_updated_at: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_social_publication_jobs) {
    return {
      data_source: 'database',
      mode: runtime.mode,
      configuredChannels: runtime.configuredChannels,
      jobs: [],
      last_updated_at: now
    };
  }

  const query = await pool.query<SocialPublicationJobRow>(`
    ${socialPublicationJobSelect}
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return {
    data_source: 'database',
    mode: runtime.mode,
    configuredChannels: runtime.configuredChannels,
    jobs: query.rows.map(mapSocialPublicationJobRow),
    last_updated_at:
      query.rows.reduce<string | null>((latest, row) => {
        if (!latest) {
          return row.updated_at;
        }

        return new Date(row.updated_at).getTime() > new Date(latest).getTime()
          ? row.updated_at
          : latest;
      }, null) ?? now
  };
};

const listDraftsForPublicationBatch = async (
  pool: Pool,
  batchId: string
): Promise<readonly AdminPublicationDraftRecord[]> => {
  const query = await pool.query<PublicationDraftRow>(
    `
      SELECT
        draft.id::text AS id,
        draft.contribution_id::text AS contribution_id,
        contribution.sponsor_company_name,
        contribution.sponsor_website_url,
        contribution.sponsor_logo_url,
        contribution.sponsor_public_summary,
        draft.feed_target,
        draft.channel,
        draft.title,
        draft.body,
        draft.disclosure_text,
        draft.status,
        draft.public_url,
        draft.scheduled_at::text AS scheduled_at,
        draft.approved_at::text AS approved_at,
        draft.published_at::text AS published_at,
        draft.review_note,
        draft.batch_id::text AS batch_id,
        draft.created_at::text AS created_at,
        draft.updated_at::text AS updated_at
      FROM sponsor_publication_drafts draft
      INNER JOIN fund_contributions contribution
        ON contribution.id = draft.contribution_id
      WHERE draft.batch_id = $1::uuid
        AND draft.status IN ('approved', 'scheduled')
      ORDER BY draft.created_at ASC
    `,
    [batchId]
  );

  return query.rows.map(mapPublicationDraftRow);
};

export const createSocialPublicationJobForBatch = async (
  pool: Pool | null,
  input: {
    readonly batchId: string;
    readonly mode: Exclude<SocialPublicationMode, 'disabled'>;
    readonly provider: 'facebook' | 'linkedin';
  }
): Promise<AdminSocialPublicationJobRecord | null> => {
  if (!pool) {
    return null;
  }

  const presence = await getAdminBackofficePresence(pool);
  if (
    !presence.has_publication_drafts ||
    !presence.has_publication_batches ||
    !presence.has_social_publication_jobs
  ) {
    return null;
  }

  const batch = await getPublicationBatchById(pool, input.batchId);
  if (!batch || batch.status !== 'scheduled' || batch.capacityUsed <= 0) {
    return null;
  }

  const drafts = await listDraftsForPublicationBatch(pool, input.batchId);
  if (drafts.length === 0) {
    return null;
  }

  const text = buildSocialPublicationText(batch, drafts);
  const idempotencyKey = `social-publication-batch:${batch.id}:${batch.channel}`;
  const insertResult = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO social_publication_jobs (
        batch_id,
        channel,
        provider,
        mode,
        status,
        idempotency_key,
        title,
        body,
        disclosure_text,
        draft_ids
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        'pending',
        $5,
        $6,
        $7,
        $8,
        $9::uuid[]
      )
      ON CONFLICT (idempotency_key)
      DO UPDATE SET
        provider = EXCLUDED.provider,
        mode = EXCLUDED.mode,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        disclosure_text = EXCLUDED.disclosure_text,
        draft_ids = EXCLUDED.draft_ids,
        status = CASE
          WHEN social_publication_jobs.status = 'failed' THEN 'pending'
          ELSE social_publication_jobs.status
        END,
        error_code = CASE
          WHEN social_publication_jobs.status = 'failed' THEN NULL
          ELSE social_publication_jobs.error_code
        END,
        error_message = CASE
          WHEN social_publication_jobs.status = 'failed' THEN NULL
          ELSE social_publication_jobs.error_message
        END,
        updated_at = NOW()
      RETURNING id::text AS id
    `,
    [
      batch.id,
      batch.channel,
      input.provider,
      input.mode,
      idempotencyKey,
      text.title,
      text.body,
      text.disclosureText,
      text.draftIds
    ]
  );

  const jobId = insertResult.rows[0]?.id;
  return jobId ? getSocialPublicationJobById(pool, jobId) : null;
};

export const markSocialPublicationJobPublishing = async (
  pool: Pool | null,
  jobId: string
): Promise<AdminSocialPublicationJobRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      UPDATE social_publication_jobs
      SET
        status = 'publishing',
        attempted_at = NOW(),
        error_code = NULL,
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND status IN ('pending', 'failed')
      RETURNING id::text AS id
    `,
    [jobId]
  );
  const updatedJobId = result.rows[0]?.id;
  return updatedJobId ? getSocialPublicationJobById(pool, updatedJobId) : null;
};

export const markSocialPublicationJobPublished = async (
  pool: Pool | null,
  input: {
    readonly jobId: string;
    readonly externalPostId: string;
    readonly externalPostUrl: string | null;
  }
): Promise<AdminSocialPublicationBatchPublishResult> => {
  if (!pool) {
    return { published: false, mode: 'disabled', job: null, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const jobResult = await client.query<SocialPublicationJobRow>(
      `
        UPDATE social_publication_jobs
        SET
          status = 'published',
          external_post_id = $2,
          external_post_url = $3,
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING
          id::text AS id,
          batch_id::text AS batch_id,
          channel,
          provider,
          mode,
          status,
          idempotency_key,
          title,
          body,
          disclosure_text,
          array(SELECT draft_id::text FROM unnest(draft_ids) AS draft_id) AS draft_ids,
          external_post_id,
          external_post_url,
          error_code,
          error_message,
          attempted_at::text AS attempted_at,
          published_at::text AS published_at,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [input.jobId, input.externalPostId, input.externalPostUrl]
    );
    const job = jobResult.rows[0]
      ? mapSocialPublicationJobRow(jobResult.rows[0])
      : null;

    if (job) {
      await client.query(
        `
          UPDATE sponsor_publication_batches
          SET
            status = 'published',
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
          WHERE id = $1::uuid
            AND status = 'scheduled'
        `,
        [job.batchId]
      );
      await client.query(
        `
          UPDATE sponsor_publication_drafts
          SET
            status = 'published',
            public_url = COALESCE($2, public_url),
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
          WHERE batch_id = $1::uuid
            AND status IN ('approved', 'scheduled')
        `,
        [job.batchId, input.externalPostUrl]
      );
      if (presence.has_publication_slots) {
        await client.query(
          `
            UPDATE publication_slots slot
            SET status = 'published', updated_at = NOW()
            WHERE slot.id IN (
                SELECT slot_id
                FROM sponsor_publication_batches
                WHERE id = $1::uuid
                  AND slot_id IS NOT NULL
              )
              AND EXISTS (
                SELECT 1
                FROM sponsor_publication_drafts draft
                LEFT JOIN sponsor_publication_batches batch
                  ON batch.id = draft.batch_id
                WHERE (draft.slot_id = slot.id OR batch.slot_id = slot.id)
                  AND draft.status = 'published'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM sponsor_publication_drafts draft
                LEFT JOIN sponsor_publication_batches batch
                  ON batch.id = draft.batch_id
                WHERE (draft.slot_id = slot.id OR batch.slot_id = slot.id)
                  AND draft.status <> 'published'
              )
          `,
          [job.batchId]
        );
      }
    }

    await client.query('COMMIT');

    return {
      published: Boolean(job),
      mode: job?.mode ?? 'disabled',
      job,
      batch: job ? await getPublicationBatchById(pool, job.batchId) : null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const markSocialPublicationJobFailed = async (
  pool: Pool | null,
  input: {
    readonly jobId: string;
    readonly errorCode: string;
    readonly errorMessage: string;
  }
): Promise<AdminSocialPublicationJobRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      UPDATE social_publication_jobs
      SET
        status = 'failed',
        error_code = $2,
        error_message = $3,
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id::text AS id
    `,
    [
      input.jobId,
      truncatePublicationText(input.errorCode, 160),
      truncatePublicationText(input.errorMessage, 1000)
    ]
  );
  const jobId = result.rows[0]?.id;
  return jobId ? getSocialPublicationJobById(pool, jobId) : null;
};
