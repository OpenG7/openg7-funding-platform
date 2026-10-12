import type {
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftMutationResult,
  AdminPublicationDraftRecord,
  AdminPublicationDraftUpdateRequest,
  AdminPublicationDraftsResponse,
  PublicationDraftStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  approveModeratedSubject,
  auditModeratedMutation,
  recordAdverseModeration
} from './moderation-legacy.js';
import { ModerationError } from './moderation/policy.js';
import { assertModerationApproved } from './moderation/repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { lockModerationDependencies } from './moderation/content.js';
import {
  mapPublicationDraftRow,
  type PublicationDraftRow
} from './fund-publication.mapping.js';
import { getAdminBackofficePresence } from './fund-admin.persistence.js';
import { nextPublicationDraftObligation } from './fund-publication-draft-obligations.persistence.js';
import {
  createDefaultDraftText,
  type SponsorDraftSourceRow
} from './fund-publication-content.js';

export const allowedPublicationDraftStatuses = new Set<PublicationDraftStatus>([
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'cancelled'
]);

export const getPublicationDraftById = async (
  pool: Pool | PoolClient,
  draftId: string
): Promise<AdminPublicationDraftRecord | null> => {
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
        draft.slot_id::text AS slot_id,
        draft.created_at::text AS created_at,
        draft.updated_at::text AS updated_at
      FROM sponsor_publication_drafts draft
      INNER JOIN fund_contributions contribution
        ON contribution.id = draft.contribution_id
      WHERE draft.id = $1::uuid
      LIMIT 1
    `,
    [draftId]
  );

  const row = query.rows[0];
  return row ? mapPublicationDraftRow(row) : null;
};

export const listAdminPublicationDrafts = async (
  pool: Pool | PoolClient | null,
  options: {
    readonly all?: boolean;
    readonly id?: string;
    readonly contributionId?: string;
  } = {}
): Promise<AdminPublicationDraftsResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      drafts: [],
      last_updated_at: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return {
      data_source: 'database',
      drafts: [],
      last_updated_at: now
    };
  }

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
      draft.slot_id::text AS slot_id,
      draft.created_at::text AS created_at,
      draft.updated_at::text AS updated_at
    FROM sponsor_publication_drafts draft
    INNER JOIN fund_contributions contribution
      ON contribution.id = draft.contribution_id
    WHERE ($1::text IS NULL OR draft.id::text = $1)
      AND ($3::text IS NULL OR draft.contribution_id::text = $3)
    ORDER BY
      CASE draft.status
        WHEN 'pending_review' THEN 0
        WHEN 'draft' THEN 1
        WHEN 'approved' THEN 2
        WHEN 'scheduled' THEN 3
        WHEN 'published' THEN 4
        ELSE 5
      END,
      draft.updated_at DESC
    LIMIT $2
  `,
    [
      options.id ?? null,
      options.all ? null : 100,
      options.contributionId ?? null
    ]
  );

  return {
    data_source: 'database',
    drafts: query.rows.map(mapPublicationDraftRow),
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

export const createAdminPublicationDraft = async (
  pool: Pool | null,
  input: AdminPublicationDraftCreateRequest
): Promise<AdminPublicationDraftMutationResult> => {
  if (!pool) {
    return { updated: false, draft: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return { updated: false, draft: null };
  }

  const sponsorQuery = await pool.query<SponsorDraftSourceRow>(
    `
      SELECT
        id::text AS id,
        sponsor_company_name,
        sponsor_website_url,
        sponsor_logo_url,
        sponsor_public_summary,
        sponsor_message
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
        AND public_display_consent IS TRUE
        AND sponsor_review_status = 'approved'
        AND sponsor_company_name IS NOT NULL
        AND btrim(sponsor_company_name) <> ''
      LIMIT 1
    `,
    [input.contributionId]
  );
  const sponsor = sponsorQuery.rows[0];
  if (!sponsor) {
    return { updated: false, draft: null };
  }

  const draftText = createDefaultDraftText(
    sponsor,
    input.feedTarget,
    input.channel
  );
  const obligationId = await nextPublicationDraftObligation(
    pool,
    input.contributionId,
    input.feedTarget,
    input.channel
  );
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sponsor_publication_drafts
    WHERE contribution_id=$1::uuid AND feed_target=$2 AND channel=$3 AND status NOT IN ('published','cancelled','rejected')
      AND (obligation_id=$4::uuid OR obligation_id IS NULL) ORDER BY created_at,id LIMIT 1`,
    [input.contributionId, input.feedTarget, input.channel, obligationId]
  );
  if (existing.rows[0])
    return {
      updated: true,
      draft: await getPublicationDraftById(pool, existing.rows[0].id)
    };

  const insertResult = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO sponsor_publication_drafts (
        contribution_id,
        feed_target,
        channel,
        title,
        body,
        disclosure_text,
        status,
        obligation_id
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, 'draft', $7::uuid)
      ON CONFLICT ${
        obligationId
          ? "(obligation_id) WHERE obligation_id IS NOT NULL AND status NOT IN ('published','cancelled','rejected')"
          : '(contribution_id, feed_target, channel) WHERE obligation_id IS NULL'
      }
      DO UPDATE SET updated_at = sponsor_publication_drafts.updated_at
      RETURNING id::text AS id
    `,
    [
      input.contributionId,
      input.feedTarget,
      input.channel,
      draftText.title,
      draftText.body,
      draftText.disclosureText,
      obligationId
    ]
  );

  const draftId = insertResult.rows[0]?.id;
  return {
    updated: Boolean(draftId),
    draft: draftId ? await getPublicationDraftById(pool, draftId) : null
  };
};

export const updateAdminPublicationDraft = async (
  pool: Pool | null,
  input: AdminPublicationDraftUpdateRequest,
  actor = ''
): Promise<AdminPublicationDraftMutationResult> => {
  if (!pool) {
    return { updated: false, draft: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return { updated: false, draft: null };
  }

  return withPostgresTransaction(
    pool,
    async (db) => {
      if (input.status === 'rejected')
        await lockModerationDependencies(db, {
          type: 'publication_draft',
          id: input.draftId
        });
      const current = (
        await db.query<{
          id: string;
          contribution_id: string;
          title: string;
          body: string;
          disclosure_text: string;
          public_url: string | null;
          scheduled_at: Date | null;
        }>(
          'SELECT id,contribution_id,title,body,disclosure_text,public_url,scheduled_at FROM sponsor_publication_drafts WHERE id=$1 FOR UPDATE',
          [input.draftId]
        )
      ).rows[0];
      if (!current) return { updated: false, draft: null };
      if (
        [
          'approved',
          'scheduled',
          'published',
          'rejected',
          'cancelled'
        ].includes(input.status ?? '') &&
        (input.confirmation ?? input.moderationDecision?.confirmation) !==
          input.draftId
      )
        throw new ModerationError('CONFIRMATION_REQUIRED', 400);
      if (input.status === 'rejected') {
        if (
          (input.title !== undefined && input.title.trim() !== current.title) ||
          (input.body !== undefined && input.body.trim() !== current.body) ||
          (input.disclosureText !== undefined &&
            input.disclosureText.trim() !== current.disclosure_text) ||
          (input.publicUrl !== undefined &&
            (input.publicUrl.trim() || null) !== current.public_url) ||
          (input.scheduledAt !== undefined &&
            (input.scheduledAt === null
              ? null
              : Date.parse(input.scheduledAt)) !==
              (current.scheduled_at?.getTime() ?? null))
        )
          throw new ModerationError('MODERATION_CONTENT_CHANGED');
        // The structured decision owns the refusal and its confidential reason.
        // Revoke dependent claims before projecting status; do not rewrite the
        // legacy reviewNote or any source metadata underneath an in-flight claim.
        await recordAdverseModeration(
          db,
          { type: 'publication_draft', id: input.draftId },
          actor,
          input.moderationDecision,
          ['N3']
        );
        return {
          updated: true,
          draft: await getPublicationDraftById(db, input.draftId)
        };
      }
      const assignments: string[] = [];
      const values: unknown[] = [input.draftId];

      const addAssignment = (sql: string, value: unknown): void => {
        values.push(value);
        assignments.push(sql.replace('?', `$${values.length}`));
      };

      if (input.title !== undefined) {
        addAssignment('title = ?', input.title.trim());
      }

      if (input.body !== undefined) {
        addAssignment('body = ?', input.body.trim());
      }

      if (input.disclosureText !== undefined) {
        addAssignment('disclosure_text = ?', input.disclosureText.trim());
      }

      if (input.status !== undefined) {
        addAssignment('status = ?', input.status);
        if (input.status === 'approved') {
          assignments.push('approved_at = COALESCE(approved_at, NOW())');
        }
        if (input.status === 'published') {
          assignments.push('published_at = COALESCE(published_at, NOW())');
        }
      }

      if (input.publicUrl !== undefined) {
        addAssignment("public_url = NULLIF(?, '')", input.publicUrl.trim());
      }

      if (input.scheduledAt !== undefined) {
        addAssignment('scheduled_at = ?::timestamptz', input.scheduledAt);
      }

      if (input.reviewNote !== undefined) {
        addAssignment("review_note = NULLIF(?, '')", input.reviewNote.trim());
      }

      if (assignments.length === 0) {
        return {
          updated: false,
          draft: await getPublicationDraftById(db, input.draftId)
        };
      }

      assignments.push('updated_at = NOW()');
      const result = await db.query(
        `
      UPDATE sponsor_publication_drafts
      SET ${assignments.join(', ')}
      WHERE id = $1::uuid
    `,
        values
      );

      const subject = { type: 'publication_draft', id: input.draftId } as const;
      if (['approved', 'scheduled', 'published'].includes(input.status ?? '')) {
        await assertModerationApproved(db, {
          type: 'sponsorship',
          id: current.contribution_id
        });
        await approveModeratedSubject(
          db,
          subject,
          actor,
          input.moderationDecision
        );
        await auditModeratedMutation(
          db,
          subject,
          actor,
          `publication_draft.${input.status}`
        );
      }
      return {
        updated: (result.rowCount ?? 0) > 0,
        draft: await getPublicationDraftById(db, input.draftId)
      };
    },
    { shouldCommit: (result) => result.updated }
  );
};
