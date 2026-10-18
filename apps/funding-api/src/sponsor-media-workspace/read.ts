import type { PoolClient } from 'pg';

import {
  classifySponsorMedia,
  normalizeSponsorMediaUsage,
  type SponsorMediaWorkspace,
  type SponsorMediaWorkspaceAsset,
  type SponsorMediaRule
} from '../../../../packages/funding-core/src/index.js';
import { mapAsset } from '../sponsor-media/persistence-mappers.js';
import { selectAssetColumns } from '../sponsor-media/persistence-queries.js';
import type { SponsorMediaAssetRow } from '../sponsor-media/persistence-contracts.js';

import { ensure } from './policy.js';

export async function readWorkspace(
  db: PoolClient,
  contributionId: string,
  writable = true
): Promise<SponsorMediaWorkspace> {
  const dossier = await db.query(
    `SELECT id FROM fund_contributions WHERE id=$1 AND contribution_type='sponsorship_interest'`,
    [contributionId]
  );
  ensure(dossier.rowCount, 'SPONSORSHIP_NOT_FOUND', 404);
  const revision =
    (
      await db.query(
        'SELECT revision::text AS revision FROM sponsor_media_workspaces WHERE contribution_id=$1',
        [contributionId]
      )
    ).rows[0]?.revision ?? '1';
  const rows = await db.query<
    SponsorMediaAssetRow & {
      media_batch_id: string | null;
      website_selected: boolean;
      effective_rule: {
        id: string;
        scope: 'dossier' | 'batch' | 'media';
      } | null;
      state: SponsorMediaWorkspaceAsset['moderation']['state'];
      level: SponsorMediaWorkspaceAsset['moderation']['level'];
      content_version: number | null;
      fingerprint: string;
      current_decision_id: string | null;
      has_open_appeal: boolean;
    }
  >(
    `SELECT a.*,a.updated_at::text AS version,a.created_at::text AS created_at,a.reviewed_at::text AS reviewed_at,
      sponsor_media_effective_usage(a.id) AS usage_rights,sponsor_media_effective_rule(a.id) AS effective_rule,
      CASE WHEN c.current_fingerprint=encode(digest(moderation_snapshot('media',a.id)::text,'sha256'),'hex') THEN c.state ELSE 'unreviewed' END AS state,
      d.level,c.current_content_version AS content_version,c.current_decision_id,
      encode(digest(moderation_snapshot('media',a.id)::text,'sha256'),'hex') AS fingerprint,
      EXISTS(SELECT 1 FROM moderation_appeals ap JOIN moderation_decisions ad ON ad.id=ap.decision_id WHERE ad.case_id=c.id AND ap.state='open') AS has_open_appeal
      FROM sponsor_media_assets a LEFT JOIN moderation_cases c ON c.subject_type='media' AND c.subject_id=a.id
      LEFT JOIN moderation_decisions d ON d.id=c.current_decision_id
      WHERE a.contribution_id=$1 AND a.deleted_at IS NULL ORDER BY a.kind,a.sort_order,a.created_at,a.id`,
    [contributionId]
  );
  const assets: SponsorMediaWorkspaceAsset[] = rows.rows.map((row) => {
    const asset = mapAsset(row);
    const current = row.state === 'approved';
    return {
      ...asset,
      batchId: row.media_batch_id,
      usageSource: row.effective_rule?.scope ?? 'media',
      ruleId: row.effective_rule?.id ?? null,
      websiteSelected: row.website_selected,
      moderation: {
        state: row.state,
        level: row.level,
        contentVersion: row.content_version ?? 0,
        fingerprint: row.fingerprint,
        currentDecisionId: row.current_decision_id
      },
      readiness: row.has_open_appeal
        ? { state: 'blocked', reasons: ['MODERATION_RECONSIDERATION_OPEN'] }
        : classifySponsorMedia({
            usage: asset.usage,
            restrictionsReviewed: asset.usageRestrictionsReviewed,
            reviewStatus: asset.reviewStatus,
            altText: asset.altText,
            moderationState: row.state,
            moderationLevel: row.level,
            technicalValid:
              row.width > 0 && row.height > 0 && row.processed_size_bytes > 0,
            humanReviewed: current,
            analysis: 'unavailable'
          })
    };
  });
  const rules = (
    await db.query(
      `SELECT DISTINCT ON(scope_type,scope_id) id,scope_type AS scope,scope_id AS "scopeId",revision,
    usage_rights AS usage,evidence_reference AS "evidenceReference",covered_asset_ids AS "coveredAssetIds",(authorization_scope='scope') AS "includesFutureUploads"
    FROM sponsor_media_rule_versions WHERE contribution_id=$1 ORDER BY scope_type,scope_id,revision DESC`,
      [contributionId]
    )
  ).rows
    .filter((row) => row.usage !== null)
    .map((row) => ({
      ...row,
      usage: normalizeSponsorMediaUsage(row.usage),
      ...(!writable ? { evidenceReference: undefined } : {})
    })) as SponsorMediaRule[];
  const batches = (
    await db.query(
      'SELECT id,name,created_at::text AS version FROM sponsor_media_batches WHERE contribution_id=$1 ORDER BY created_at,id',
      [contributionId]
    )
  ).rows;
  return { contributionId, revision, assets, rules, batches, writable };
}

/** Use the same stable selected columns in individual and batch mutations. */
export { selectAssetColumns };
