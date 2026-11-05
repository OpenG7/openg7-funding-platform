import type {
  PreflightDeskOrder,
  PreflightDeskQuery,
  PreflightDeskResponse,
  PreflightDeskService as PreflightDeskServiceItem,
  PreflightDeskStage
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  loadAdminCampaignDeskSnapshot,
  type AdminCampaignDeskRow,
  type AdminCampaignsReadPorts
} from '../admin-campaigns.service.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

export class PreflightDeskError extends Error {
  constructor(
    readonly code:
      'PREFLIGHT_DESK_INVALID_REQUEST' | 'PREFLIGHT_DESK_UNAVAILABLE',
    readonly status: 400 | 503
  ) {
    super(code);
  }
}
const stages = [
  'all',
  'to_prepare',
  'to_review',
  'to_deliver',
  'delivered'
] as const;

export function parsePreflightDeskQuery(
  params: URLSearchParams
): PreflightDeskQuery {
  const invalid = () => {
    throw new PreflightDeskError('PREFLIGHT_DESK_INVALID_REQUEST', 400);
  };
  for (const key of params.keys())
    if (
      !['page', 'pageSize', 'stage', 'search'].includes(key) ||
      params.getAll(key).length !== 1
    )
      invalid();
  const page = params.get('page') ?? '1',
    pageSize = params.get('pageSize') ?? '20',
    stage = params.get('stage') ?? 'all',
    search = params.get('search');
  if (
    !/^[1-9]\d{0,5}$/.test(page) ||
    Number(page) > 100000 ||
    !['10', '20', '50'].includes(pageSize) ||
    !(stages as readonly string[]).includes(stage) ||
    (search !== null &&
      (search.trim().length > 120 || /[\x00-\x1f\x7f]/.test(search)))
  )
    invalid();
  return {
    page: Number(page),
    pageSize: Number(pageSize) as PreflightDeskQuery['pageSize'],
    stage: stage as PreflightDeskQuery['stage'],
    ...(search?.trim() ? { search: search.trim() } : {})
  };
}

/** Exclusive operational categories; Funding's current authorization and proof remain authoritative. */
export function preflightDeskStage(
  row: AdminCampaignDeskRow
): PreflightDeskStage {
  const item = row.campaign;
  if (
    item.obligationState === 'fulfilled' &&
    item.proof &&
    item.workflow.state === 'complete' &&
    item.workflow.reason === 'publication_done'
  )
    return 'delivered';
  if (row.authorizedDelivery) return 'to_deliver';
  if (
    item.content &&
    ['ready', 'review_required', 'approved'].includes(item.preparation.status)
  )
    return 'to_review';
  return 'to_prepare';
}

export function projectPreflightDesk(
  rows: readonly AdminCampaignDeskRow[],
  query: PreflightDeskQuery,
  generatedAt: string
): PreflightDeskResponse {
  const summary = {
    total: 0,
    toPrepare: 0,
    toReview: 0,
    toDeliver: 0,
    delivered: 0,
    excludedAdjusted: 0,
    orders: 0,
    scope: 'recorded_promised_services' as const,
    preflightLink: 'unverified' as const
  };
  const groups = new Map<string, PreflightDeskOrder>();
  const counter = {
    to_prepare: 'toPrepare',
    to_review: 'toReview',
    to_deliver: 'toDeliver',
    delivered: 'delivered'
  } as const;
  for (const row of rows) {
    const item = row.campaign;
    if (item.obligationState === 'adjusted') {
      summary.excludedAdjusted++;
      continue;
    }
    if (
      !/^\d{1,16}$/.test(row.amountMinor) ||
      BigInt(row.amountMinor) > BigInt(Number.MAX_SAFE_INTEGER) ||
      !/^[A-Z]{3}$/.test(row.currency) ||
      !Number.isSafeInteger(row.commitmentVersion) ||
      row.commitmentVersion < 1
    )
      throw new PreflightDeskError('PREFLIGHT_DESK_UNAVAILABLE', 503);
    const stage = preflightDeskStage(row);
    const blocked =
      ['blocked', 'error', 'uncertain'].includes(item.workflow.state) ||
      item.obligationState === 'blocked' ||
      item.preparation.blockers.length > 0;
    const blockers = [
      ...new Set([
        ...item.preparation.blockers,
        ...(['blocked', 'error', 'uncertain'].includes(item.workflow.state)
          ? [item.workflow.reason]
          : [])
      ])
    ];
    const service: PreflightDeskServiceItem = {
      ...item,
      stage,
      blocked,
      blockers,
      preparationOrigin: 'funding',
      preflightLink: 'unverified',
      reviewUrl: `/admin/fundraiser/campaigns?sponsorshipId=${item.contributionId}&obligationId=${item.id}`
    };
    const existing = groups.get(item.contributionId);
    const group: PreflightDeskOrder = existing ?? {
      contributionId: item.contributionId,
      reference: item.reference,
      companyName: item.companyName,
      amountMinor: row.amountMinor,
      currency: row.currency,
      commitmentId: row.commitmentId,
      commitmentVersion: row.commitmentVersion,
      paidAt: item.paidAt,
      services: [],
      total: 0,
      delivered: 0,
      adminUrl: item.adminUrl
    };
    groups.set(item.contributionId, {
      ...group,
      services: [...group.services, service],
      total: group.total + 1,
      delivered: group.delivered + (stage === 'delivered' ? 1 : 0)
    });
    summary.total++;
    summary[counter[stage]]++;
  }
  summary.orders = groups.size;
  const matching = [...groups.values()].filter(
    (group) =>
      query.stage === 'all' ||
      group.services.some((item) => item.stage === query.stage)
  );
  const totalPages = Math.ceil(matching.length / query.pageSize);
  return {
    generatedAt,
    summary,
    orders: matching.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize
    ),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: matching.length,
      totalPages,
      hasPreviousPage: query.page > 1,
      hasNextPage: query.page < totalPages
    }
  };
}

export async function loadPreflightDeskOnClient(
  db: PoolClient,
  query: PreflightDeskQuery,
  now = new Date(),
  ports?: AdminCampaignsReadPorts
): Promise<PreflightDeskResponse> {
  const snapshot = await loadAdminCampaignDeskSnapshot(
    db,
    query.search,
    now,
    ports
  );
  return projectPreflightDesk(snapshot.rows, query, snapshot.generatedAt);
}

export class PreflightDeskService {
  constructor(private readonly pool: Pool) {}
  list(
    query: PreflightDeskQuery,
    now = new Date()
  ): Promise<PreflightDeskResponse> {
    return withPostgresTransaction(
      this.pool,
      (db) => loadPreflightDeskOnClient(db, query, now),
      { readOnlySnapshot: true }
    );
  }
}
