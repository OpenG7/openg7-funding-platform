import type {
  AdminCampaignItem,
  AdminCampaignsQuery
} from '@openg7/funding-core';

export class AdminCampaignsError extends Error {
  constructor(
    readonly code: 'CAMPAIGNS_INVALID_REQUEST' | 'CAMPAIGNS_UNAVAILABLE',
    readonly status: 400 | 503
  ) {
    super(code);
  }
}

/** Validate the complete query before reading any private dossier. */
export function parseAdminCampaignsQuery(
  params: URLSearchParams
): AdminCampaignsQuery {
  const allowed = [
    'page',
    'pageSize',
    'channel',
    'target',
    'state',
    'search',
    'sort',
    'direction'
  ];
  const invalid = () => {
    throw new AdminCampaignsError('CAMPAIGNS_INVALID_REQUEST', 400);
  };
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid();
  const page = params.get('page') ?? '1';
  const pageSize = params.get('pageSize') ?? '25';
  const channel = params.get('channel');
  const target = params.get('target');
  const state = params.get('state');
  const search = params.get('search');
  const sort = params.get('sort') ?? 'preparation';
  const direction = params.get('direction') ?? 'desc';
  if (
    !/^[1-9]\d*$/.test(page) ||
    !Number.isSafeInteger(Number(page)) ||
    !Number.isSafeInteger((Number(page) - 1) * Number(pageSize)) ||
    !Number.isSafeInteger(Number(page) * Number(pageSize)) ||
    !['25', '50', '100'].includes(pageSize) ||
    (channel !== null &&
      !['website', 'facebook', 'linkedin'].includes(channel)) ||
    (target !== null && !['openg7', 'openg20'].includes(target)) ||
    (state !== null &&
      ![
        'waiting',
        'action_required',
        'blocked',
        'error',
        'uncertain',
        'complete'
      ].includes(state)) ||
    (search !== null &&
      (search.trim().length > 120 || /[\x00-\x1f\x7f]/.test(search))) ||
    !['preparation', 'paid_at', 'due_at'].includes(sort) ||
    !['asc', 'desc'].includes(direction)
  )
    invalid();
  return {
    page: Number(page),
    pageSize: Number(pageSize) as AdminCampaignsQuery['pageSize'],
    ...(channel ? { channel: channel as AdminCampaignsQuery['channel'] } : {}),
    ...(target ? { target: target as AdminCampaignsQuery['target'] } : {}),
    ...(state ? { state: state as AdminCampaignsQuery['state'] } : {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
    sort: sort as AdminCampaignsQuery['sort'],
    direction: direction as AdminCampaignsQuery['direction']
  };
}

export interface CampaignSortRow {
  readonly id: string;
  readonly contributionId: string;
  readonly channel: string;
  readonly target: string;
  readonly ordinal: number;
  readonly paidAt: string;
  readonly dueAt: string | null;
  readonly approved: boolean;
}

/** Sort globally before pagination; missing contractual dates always come last. */
export function compareAdminCampaigns(
  a: CampaignSortRow,
  b: CampaignSortRow,
  query: Pick<AdminCampaignsQuery, 'sort' | 'direction'>
): number {
  const direction = query.direction === 'asc' ? 1 : -1;
  let primary = 0;
  if (query.sort === 'preparation')
    primary = Number(a.approved) - Number(b.approved);
  else if (query.sort === 'paid_at')
    primary = Date.parse(a.paidAt) - Date.parse(b.paidAt);
  else {
    if (a.dueAt === null && b.dueAt !== null) return 1;
    if (b.dueAt === null && a.dueAt !== null) return -1;
    if (a.dueAt !== null && b.dueAt !== null)
      primary = Date.parse(a.dueAt) - Date.parse(b.dueAt);
  }
  return (
    primary * direction ||
    Date.parse(b.paidAt) - Date.parse(a.paidAt) ||
    a.contributionId.localeCompare(b.contributionId) ||
    a.channel.localeCompare(b.channel) ||
    a.target.localeCompare(b.target) ||
    a.ordinal - b.ordinal ||
    a.id.localeCompare(b.id)
  );
}

/** Evidence qualification is established by the shared server projection, never a URL. */
export function campaignProof(
  obligation: Pick<AdminCampaignItem, 'id' | 'channel' | 'target'>,
  progress: Pick<
    import('@openg7/funding-core').AdminSponsorshipProgress,
    'qualifiedFulfilmentEvidenceIds' | 'fulfilmentEvidence'
  >
): AdminCampaignItem['proof'] {
  const qualified = new Set(progress.qualifiedFulfilmentEvidenceIds ?? []);
  return (
    progress.fulfilmentEvidence?.find(
      (evidence) =>
        qualified.has(evidence.id) &&
        evidence.obligationId === obligation.id &&
        evidence.channel === obligation.channel &&
        evidence.target === obligation.target
    ) ?? null
  );
}
