import type {
  AdminCampaignItem,
  AdminCampaignsQuery,
  AdminCampaignsResponse,
  AdminPreparationReceiptData,
  AdminSponsorshipProgress,
  SponsorshipCommitmentRecord,
  SponsorshipObligation
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { loadSponsorshipAssistantDataset } from './admin-assistant/context.repository.js';
import {
  projectPreparation,
  type PreparationSource
} from './admin-preparation.projection.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { sponsorshipCommitmentProjectionSql } from './sponsorship-commitments/projection.js';
import { loadSponsorshipProgressFacts } from './sponsorship-progress.repository.js';
import { buildSponsorshipProgress } from './sponsorship-progress.service.js';
import {
  AdminCampaignsError,
  campaignProof,
  compareAdminCampaigns
} from './admin-campaigns-query.js';

export interface AdminCampaignSource extends PreparationSource {
  readonly companyName: string | null;
  readonly paidAt: string;
  readonly commitment: SponsorshipCommitmentRecord;
  readonly approval: {
    readonly version: string;
    readonly approvedAt: string;
  } | null;
}

export interface AdminCampaignsReadPorts {
  sources(
    db: PoolClient,
    query: AdminCampaignsQuery
  ): Promise<readonly AdminCampaignSource[]>;
  preparation(
    db: PoolClient,
    source: AdminCampaignSource
  ): Promise<Omit<AdminPreparationReceiptData, 'approval' | 'approvalHistory'>>;
  progress(
    db: PoolClient,
    source: AdminCampaignSource,
    now: Date
  ): Promise<AdminSponsorshipProgress>;
}

const defaultPorts: AdminCampaignsReadPorts = {
  async sources(db, query) {
    const result = await db.query<AdminCampaignSource>(
      `SELECT c.id AS contribution_id,COALESCE(c.public_reference,c.id::text) AS reference,
        c.amount_cents::text AS amount_minor,upper(c.currency) AS currency,
        c.sponsor_company_name AS "companyName",c.paid_at::text AS "paidAt",
        ${sponsorshipCommitmentProjectionSql('c.id')} AS commitment,
        (SELECT jsonb_build_object('version',a.preparation_version,'approvedAt',
          to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         FROM admin_preparation_approvals a WHERE a.contribution_id=c.id
         ORDER BY a.approved_at DESC,a.id DESC LIMIT 1) AS approval
       FROM fund_contributions c
       WHERE c.contribution_type='sponsorship_interest' AND c.paid_at IS NOT NULL
         AND EXISTS(SELECT 1 FROM sponsorship_obligations ob
           JOIN sponsorship_commitments m ON m.id=ob.commitment_id
           WHERE ob.contribution_id=c.id AND m.state='active' AND m.offer_id IS NOT NULL
             AND ($1::text IS NULL OR ob.channel=$1) AND ($2::text IS NULL OR ob.target=$2))
         AND ($3::text IS NULL OR position(lower($3) in lower(COALESCE(c.sponsor_company_name,'')||' '||COALESCE(c.public_reference,c.id::text)))>0)
       ORDER BY c.id`,
      [query.channel ?? null, query.target ?? null, query.search ?? null]
    );
    return result.rows;
  },
  preparation: projectPreparation,
  async progress(db, source, now) {
    const dataset = await loadSponsorshipAssistantDataset(
      db,
      source.contribution_id,
      now
    );
    if (!dataset) throw new AdminCampaignsError('CAMPAIGNS_UNAVAILABLE', 503);
    return buildSponsorshipProgress(
      dataset,
      await loadSponsorshipProgressFacts(db, source.contribution_id)
    );
  }
};

interface Candidate {
  readonly source: AdminCampaignSource;
  readonly obligation: SponsorshipObligation;
  readonly quantity: number;
  approved: boolean;
}

const preparationFor = (
  source: AdminCampaignSource,
  receipt: Omit<AdminPreparationReceiptData, 'approval' | 'approvalHistory'>
): AdminCampaignItem['preparation'] => {
  // Same latest-approval rule as AdminPreparationService.receipt: an older digest
  // never silently reinstates approval after an intervening human decision.
  const current =
    source.approval?.version === receipt.version ? source.approval : null;
  return {
    status: current
      ? 'approved'
      : source.approval
        ? 'review_required'
        : receipt.status,
    version: receipt.version,
    approvedAt: current?.approvedAt ?? null,
    blockers: receipt.blockers.map((blocker) => blocker.code)
  };
};

function contentFor(
  candidate: Candidate,
  preparation: Omit<
    AdminPreparationReceiptData,
    'approval' | 'approvalHistory'
  >,
  progress: AdminSponsorshipProgress
): AdminCampaignItem['content'] {
  const obligation = candidate.obligation;
  const firstOpen = candidate.source.commitment.obligations
    .filter(
      (other) =>
        other.channel === obligation.channel &&
        other.target === obligation.target &&
        !['fulfilled', 'adjusted'].includes(other.state)
    )
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))[0];
  const draft = preparation.drafts.find(
    (item) =>
      item.channel === obligation.channel &&
      item.target === obligation.target &&
      (item.kind === 'website'
        ? firstOpen?.id === obligation.id
        : progress.publications.some(
            (publication) =>
              publication.id === item.id &&
              publication.obligationId === obligation.id
          ))
  );
  return draft ? { title: draft.title, body: draft.body } : null;
}

/** One immutable database snapshot, with work cached per dossier rather than per passage.
 * Only historically approved dossiers need preparation revalidation for global
 * priority. Other preparations are computed on the selected page. A workflow
 * filter examines its complete scope before pagination; no scan cap hides work.
 */
export async function loadAdminCampaignsOnClient(
  db: PoolClient,
  query: AdminCampaignsQuery,
  now = new Date(),
  ports: AdminCampaignsReadPorts = defaultPorts
): Promise<AdminCampaignsResponse> {
  const sources = await ports.sources(db, query);
  const preparations = new Map<
    string,
    ReturnType<AdminCampaignsReadPorts['preparation']>
  >();
  const progresses = new Map<
    string,
    ReturnType<AdminCampaignsReadPorts['progress']>
  >();
  const preparation = (source: AdminCampaignSource) => {
    if (!preparations.has(source.contribution_id))
      preparations.set(source.contribution_id, ports.preparation(db, source));
    return preparations.get(source.contribution_id)!;
  };
  const progress = (source: AdminCampaignSource) => {
    if (!progresses.has(source.contribution_id))
      progresses.set(source.contribution_id, ports.progress(db, source, now));
    return progresses.get(source.contribution_id)!;
  };
  const candidates: Candidate[] = [];
  for (const source of sources) {
    const commitment = source.commitment;
    if (commitment.state !== 'active' || !commitment.offer) continue;
    for (const obligation of commitment.obligations) {
      const benefit = commitment.offer.benefits.find(
        (item) => item.id === obligation.benefitId
      );
      if (
        !benefit ||
        obligation.ordinal < 1 ||
        obligation.ordinal > benefit.quantity ||
        (query.channel && obligation.channel !== query.channel) ||
        (query.target && obligation.target !== query.target)
      )
        continue;
      candidates.push({
        source,
        obligation,
        quantity: benefit.quantity,
        approved: false
      });
    }
  }
  if (query.sort === 'preparation') {
    const approvedContributions = new Set<string>();
    for (const source of sources) {
      if (!source.approval) continue;
      const approved =
        preparationFor(source, await preparation(source)).status === 'approved';
      if (approved) approvedContributions.add(source.contribution_id);
    }
    for (const candidate of candidates)
      candidate.approved = approvedContributions.has(
        candidate.source.contribution_id
      );
  }
  const filtered: Candidate[] = [];
  for (const candidate of candidates) {
    if (query.state) {
      const dossier = await progress(candidate.source);
      if (
        !dossier.publicationWorkflow?.obligations.some(
          (item) =>
            item.obligationId === candidate.obligation.id &&
            item.state === query.state
        )
      )
        continue;
    }
    filtered.push(candidate);
  }
  filtered.sort((a, b) =>
    compareAdminCampaigns(
      {
        ...a.obligation,
        contributionId: a.source.contribution_id,
        paidAt: a.source.paidAt,
        dueAt: a.obligation.timing?.dueAt ?? null,
        approved: a.approved
      },
      {
        ...b.obligation,
        contributionId: b.source.contribution_id,
        paidAt: b.source.paidAt,
        dueAt: b.obligation.timing?.dueAt ?? null,
        approved: b.approved
      },
      query
    )
  );
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / query.pageSize);
  const selected = filtered.slice(
    (query.page - 1) * query.pageSize,
    query.page * query.pageSize
  );
  const items: AdminCampaignItem[] = [];
  for (const candidate of selected) {
    const { source } = candidate;
    const receipt = await preparation(source);
    const dossier = await progress(source);
    const obligation = dossier.commitment?.obligations.find(
      (item) => item.id === candidate.obligation.id
    );
    const workflow = dossier.publicationWorkflow?.obligations.find(
      (item) => item.obligationId === candidate.obligation.id
    );
    if (!obligation || !workflow)
      throw new AdminCampaignsError('CAMPAIGNS_UNAVAILABLE', 503);
    items.push({
      id: obligation.id,
      contributionId: source.contribution_id,
      reference: source.reference,
      companyName: source.companyName,
      paidAt: new Date(source.paidAt).toISOString(),
      channel: obligation.channel,
      target: obligation.target,
      ordinal: obligation.ordinal,
      quantity: candidate.quantity,
      format: obligation.format ?? null,
      obligationState: obligation.state,
      timing: obligation.timing ?? null,
      preparation: preparationFor(source, receipt),
      workflow,
      content: contentFor(candidate, receipt, dossier),
      proof: campaignProof(obligation, dossier),
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${source.contribution_id}&tab=publication`
    });
  }
  return {
    generatedAt: now.toISOString(),
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages,
      hasPreviousPage: query.page > 1,
      hasNextPage: query.page < totalPages
    }
  };
}

export class AdminCampaignsService {
  constructor(private readonly pool: Pool) {}

  async list(
    query: AdminCampaignsQuery,
    now = new Date()
  ): Promise<AdminCampaignsResponse> {
    return withPostgresTransaction(
      this.pool,
      (db) => loadAdminCampaignsOnClient(db, query, now),
      { readOnlySnapshot: true }
    );
  }
}
