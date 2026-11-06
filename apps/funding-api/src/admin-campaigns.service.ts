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
import {
  loadServicePreparationFacts,
  servicePreparationScope
} from './admin-service-preparation-scope.js';
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
  servicePreparationFacts?: typeof loadServicePreparationFacts;
  serviceDecisions?(
    db: PoolClient,
    obligationIds: readonly string[]
  ): Promise<
    readonly {
      id: string;
      obligation_id: string;
      content_version: string;
      decision: 'approved' | 'correction_requested' | 'rejected';
      created_at: Date;
    }[]
  >;
  sources(
    db: PoolClient,
    query: AdminCampaignsQuery,
    contributionIds?: readonly string[]
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
  servicePreparationFacts: loadServicePreparationFacts,
  async serviceDecisions(db, obligationIds) {
    if (!obligationIds.length) return [];
    const available = (
      await db.query<{ present: string | null }>(
        "SELECT to_regclass('public.admin_service_preparation_decisions')::text AS present"
      )
    ).rows[0]?.present;
    if (!available) return [];
    return (
      await db.query<{
        id: string;
        obligation_id: string;
        content_version: string;
        decision: 'approved' | 'correction_requested' | 'rejected';
        created_at: Date;
      }>(
        `SELECT DISTINCT ON (obligation_id) id,obligation_id,content_version,decision,created_at
       FROM admin_service_preparation_decisions WHERE obligation_id=ANY($1::uuid[])
       ORDER BY obligation_id,created_at DESC,id DESC`,
        [obligationIds]
      )
    ).rows;
  },
  async sources(db, query, contributionIds) {
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
             AND ($1::text IS NULL OR ob.channel=$1) AND ($2::text IS NULL OR ob.target=$2)
             AND ($5::uuid IS NULL OR ob.id=$5::uuid))
         AND ($4::uuid IS NULL OR c.id=$4::uuid)
         ${contributionIds === undefined ? '' : 'AND c.id=ANY($6::uuid[])'}
         AND ($3::text IS NULL OR position(lower($3) in lower(COALESCE(c.sponsor_company_name,'')||' '||COALESCE(c.public_reference,c.id::text)))>0)
       ORDER BY c.id`,
      [
        query.channel ?? null,
        query.target ?? null,
        query.search ?? null,
        query.sponsorshipId ?? null,
        query.obligationId ?? null,
        ...(contributionIds === undefined ? [] : [contributionIds])
      ]
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
  ports: AdminCampaignsReadPorts = defaultPorts,
  scope: 'page' | 'snapshot' = 'page'
): Promise<AdminCampaignsResponse> {
  const sponsorshipId = query.sponsorshipId?.toLowerCase();
  const obligationId = query.obligationId?.toLowerCase();
  if (obligationId && !sponsorshipId)
    throw new AdminCampaignsError('CAMPAIGNS_INVALID_REQUEST', 400);
  const sources = (await ports.sources(db, query)).filter(
    (source) =>
      (!sponsorshipId ||
        source.contribution_id.toLowerCase() === sponsorshipId) &&
      (!obligationId ||
        source.commitment.obligations.some(
          (obligation) => obligation.id.toLowerCase() === obligationId
        ))
  );
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
        (obligationId && obligation.id.toLowerCase() !== obligationId) ||
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
  const selected =
    scope === 'snapshot'
      ? filtered
      : filtered.slice(
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
  if (ports.serviceDecisions && items.length) {
    const decisions = await ports.serviceDecisions(
      db,
      items.map((item) => item.id)
    );
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      const row = decisions.find((entry) => entry.obligation_id === item.id);
      if (!row) continue;
      const source = sources.find(
        (entry) => entry.contribution_id === item.contributionId
      )!;
      const receipt = await preparation(source);
      if (!ports.servicePreparationFacts) continue;
      const matchingDraft = receipt.drafts.find(
        (draft) =>
          draft.channel === item.channel &&
          draft.target === item.target &&
          draft.title === item.content?.title &&
          draft.body === item.content?.body
      );
      const facts = await ports.servicePreparationFacts(
        db,
        item.contributionId,
        item,
        matchingDraft?.id ?? null
      );
      const scope = servicePreparationScope(receipt, item, facts);
      if (row.content_version !== scope.contentVersion) continue;
      items[index] = {
        ...item,
        preparation: {
          ...item.preparation,
          blockers: scope.blockers,
          serviceDecision: {
            id: row.id,
            decision: row.decision,
            createdAt: row.created_at.toISOString(),
            contentVersion: row.content_version
          }
        }
      };
    }
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

export interface AdminCampaignDeskRow {
  readonly campaign: AdminCampaignItem;
  readonly amountMinor: string;
  readonly currency: string;
  readonly commitmentId: string;
  readonly commitmentVersion: number;
  readonly authorizedDelivery: boolean;
}

/** Reuses the campaign snapshot and its per-dossier caches; no second workflow is evaluated. */
export async function loadAdminCampaignDeskSnapshot(
  db: PoolClient,
  search: string | undefined,
  now = new Date(),
  ports: AdminCampaignsReadPorts = defaultPorts,
  contributionIds?: readonly string[]
): Promise<{ generatedAt: string; rows: readonly AdminCampaignDeskRow[] }> {
  const sources = new Map<string, AdminCampaignSource>();
  const progress = new Map<string, AdminSponsorshipProgress>();
  const result = await loadAdminCampaignsOnClient(
    db,
    {
      page: 1,
      pageSize: 100,
      sort: 'paid_at',
      direction: 'desc',
      ...(search ? { search } : {})
    },
    now,
    {
      sources: async (client, query) => {
        const rows =
          contributionIds === undefined
            ? await ports.sources(client, query)
            : await ports.sources(client, query, contributionIds);
        for (const row of rows) sources.set(row.contribution_id, row);
        return rows;
      },
      preparation: ports.preparation,
      serviceDecisions: ports.serviceDecisions,
      servicePreparationFacts: ports.servicePreparationFacts,
      progress: async (client, source, date) => {
        const value = await ports.progress(client, source, date);
        progress.set(source.contribution_id, value);
        return value;
      }
    },
    'snapshot'
  );
  const authorizedReasons = new Set([
    'publication_scheduled',
    'publication_retry_pending',
    'publication_publishing',
    'publication_paused',
    'publication_worker_disabled'
  ]);
  return {
    generatedAt: result.generatedAt,
    rows: result.items.map((campaign) => {
      const source = sources.get(campaign.contributionId)!;
      const facts = progress.get(campaign.contributionId)!;
      const exactDelivery = facts.publications.find(
        (publication) =>
          publication.obligationId === campaign.id &&
          publication.deliveryId === campaign.workflow.deliveryId &&
          publication.channel === campaign.channel &&
          publication.target === campaign.target &&
          publication.deliveryMode === 'live' &&
          ['approved', 'publishing'].includes(publication.deliveryStatus ?? '')
      );
      const websiteDuration =
        campaign.channel === 'website' &&
        campaign.workflow.reason === 'duration_in_progress' &&
        !!campaign.timing?.startObservation &&
        campaign.timing.durationState === 'awaiting_review';
      return {
        campaign,
        amountMinor: source.amount_minor,
        currency: source.currency,
        commitmentId: source.commitment.id,
        commitmentVersion: source.commitment.version,
        authorizedDelivery:
          websiteDuration ||
          (!!exactDelivery &&
            !!campaign.workflow.deliveryId &&
            authorizedReasons.has(campaign.workflow.reason))
      };
    })
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
