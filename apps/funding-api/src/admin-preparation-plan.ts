import { createHash } from 'node:crypto';

import type {
  AdminPreparationPlan,
  AdminPreparationPlanItem,
  AdminPreparationSelection
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import {
  createDefaultDraftText,
  type SponsorDraftSourceRow
} from './fund-publication-content.js';
import { moderationApprovedSql } from './moderation/policy.js';
import { publicationSourceUncertainSql } from './fund-publication-draft-retirement.persistence.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { AdminAutomaticRunError } from './admin-automatic-run-error.js';

export interface PreparationPlanFact extends SponsorDraftSourceRow {
  readonly reference: string;
  readonly sourceVersion: string;
  readonly obligationId: string;
  readonly obligationVersion: number;
  readonly ordinal: number;
  readonly channel: 'facebook' | 'linkedin';
  readonly target: 'openg7' | 'openg20';
  readonly eligible: boolean;
  readonly existing: boolean;
  readonly refused: boolean;
  readonly uncertain: boolean;
}
const invalid = () => new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
export function parsePreparationSelection(
  raw: unknown
): readonly AdminPreparationSelection[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw invalid();
  const seen = new Set<string>();
  return raw
    .map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
          (k) => !['contributionId', 'version'].includes(k)
        ) ||
        !isValidUuid(value.contributionId) ||
        typeof value.version !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.version)
      )
        throw invalid();
      const id = value.contributionId.toLowerCase();
      if (seen.has(id)) throw invalid();
      seen.add(id);
      return { contributionId: id, version: value.version };
    })
    .sort((a, b) => a.contributionId.localeCompare(b.contributionId));
}
export function projectPreparationPlan(
  facts: readonly PreparationPlanFact[],
  now = new Date()
): AdminPreparationPlan {
  const groups = new Map<string, PreparationPlanFact[]>();
  let missing = 0,
    preserved = 0,
    blocked = 0;
  for (const fact of [
    ...new Map(facts.map((f) => [f.obligationId, f])).values()
  ]) {
    const group = groups.get(fact.id) ?? [];
    group.push(fact);
    groups.set(fact.id, group);
    if (fact.existing) preserved++;
    else if (fact.eligible && !fact.refused && !fact.uncertain) missing++;
    else blocked++;
  }
  const candidates: AdminPreparationPlanItem[] = [];
  for (const [id, group] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const ordered = group.sort((a, b) =>
      a.obligationId.localeCompare(b.obligationId)
    );
    const drafts = ordered
      .filter((f) => f.eligible && !f.existing && !f.refused && !f.uncertain)
      .map((f) => ({
        obligationId: f.obligationId,
        ordinal: f.ordinal,
        channel: f.channel,
        target: f.target,
        ...createDefaultDraftText(f, f.target, f.channel)
      }));
    if (!drafts.length) continue;
    const version = createHash('sha256')
      .update(JSON.stringify(ordered))
      .digest('hex');
    candidates.push({
      contributionId: id,
      reference: ordered[0]!.reference,
      version,
      drafts
    });
  }
  return {
    definition: 'missing-private-preparations/v1',
    observedAt: now.toISOString(),
    limit: 20,
    candidateDossiers: candidates.length,
    missingPassages: missing,
    preservedPassages: preserved,
    blockedPassages: blocked,
    hasMore: candidates.length > 20,
    items: candidates.slice(0, 20),
    minutesSaved: null
  };
}

/** Same next recorded passage and native draft factory as the portfolio. Never writes. */
export async function loadPreparationPlan(
  db: PoolClient,
  selection?: readonly string[]
): Promise<AdminPreparationPlan> {
  const rows = await db.query<PreparationPlanFact>(
    `SELECT c.id::text AS id,COALESCE(c.public_reference,c.id::text) AS reference,
    c.updated_at::text || ':' || s.version::text AS "sourceVersion",
    c.sponsor_company_name,c.sponsor_website_url,c.sponsor_logo_url,c.sponsor_public_summary,c.sponsor_message,
    ob.id::text AS "obligationId",ob.version AS "obligationVersion",ob.ordinal,ob.channel,ob.target,
    (c.status='paid' AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved'
      AND c.sponsor_feed_status<>'hidden' AND c.sponsorship_refund_status='not_requested'
      AND NULLIF(btrim(c.sponsor_company_name),'') IS NOT NULL AND ob.state='pending'
      AND ${moderationApprovedSql('sponsorship', 'c.id')}) AS eligible,
    EXISTS(SELECT 1 FROM sponsor_publication_drafts d WHERE d.contribution_id=c.id AND d.channel=ob.channel AND d.feed_target=ob.target
      AND (d.obligation_id=ob.id OR d.obligation_id IS NULL) AND d.status NOT IN ('published','cancelled','rejected')) AS existing,
    EXISTS(SELECT 1 FROM sponsor_publication_drafts d WHERE d.contribution_id=c.id AND d.channel=ob.channel AND d.feed_target=ob.target
      AND (d.obligation_id=ob.id OR d.obligation_id IS NULL) AND d.status='rejected') AS refused,
    ${publicationSourceUncertainSql('c.id', 'ob.channel')} AS uncertain
    FROM fund_contributions c JOIN sponsorship_commitments s ON s.contribution_id=c.id AND s.state='active'
    JOIN LATERAL(SELECT DISTINCT ON(o.benefit_id,o.channel,o.target) o.* FROM sponsorship_obligations o
      WHERE o.commitment_id=s.id AND o.state IN ('pending','blocked') AND o.channel IN ('facebook','linkedin')
      ORDER BY o.benefit_id,o.channel,o.target,o.ordinal,o.id) ob ON TRUE
    WHERE c.contribution_type='sponsorship_interest' AND ($1::uuid[] IS NULL OR c.id=ANY($1::uuid[]))
    ORDER BY c.id,ob.id`,
    [selection ?? null]
  );
  return projectPreparationPlan(rows.rows);
}
