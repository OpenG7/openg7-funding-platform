import { computed, signal } from '@angular/core';
import type {
  AdminCampaignItem,
  AdminCampaignsQuery,
  AdminCampaignsResponse
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export const DEFAULT_CAMPAIGNS_QUERY: AdminCampaignsQuery = {
  page: 1,
  pageSize: 25,
  sort: 'preparation',
  direction: 'desc'
};

export interface AdminCampaignsPorts {
  list(
    query: AdminCampaignsQuery,
    signal: AbortSignal
  ): Promise<AdminCampaignsResponse>;
  unauthorized(): void | Promise<void>;
}

/** Contiguous groups preserve every server sort, including interleaved due dates. */
export function groupCampaignRows(
  rows: readonly AdminCampaignItem[],
  grouped: boolean
): readonly {
  readonly id: string;
  readonly rows: readonly AdminCampaignItem[];
}[] {
  if (!grouped) return [{ id: '', rows }];
  const groups: { id: string; rows: AdminCampaignItem[] }[] = [];
  for (const row of rows) {
    const previous = groups.at(-1);
    if (previous?.rows[0].contributionId === row.contributionId)
      previous.rows.push(row);
    else groups.push({ id: `${row.contributionId}:${row.id}`, rows: [row] });
  }
  return groups;
}

/** Page reads are replaceable; a late response never restores a private snapshot. */
export class AdminCampaignsController {
  readonly query = signal<AdminCampaignsQuery>({ ...DEFAULT_CAMPAIGNS_QUERY });
  readonly data = signal<AdminCampaignsResponse | null>(null);
  readonly state = signal<
    'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable'
  >('loading');
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(
    () => this.data()?.items.find((row) => row.id === this.selectedId()) ?? null
  );
  private generation = 0;
  private request: AbortController | null = null;
  private disposed = false;

  constructor(private readonly ports: AdminCampaignsPorts) {}

  select(row: AdminCampaignItem): void {
    if (this.state() === 'ready' && this.data()?.items.includes(row))
      this.selectedId.set(row.id);
  }

  async load(query = this.query()): Promise<void> {
    if (this.disposed) return;
    this.request?.abort();
    const generation = ++this.generation;
    const request = new AbortController();
    this.request = request;
    this.query.set({ ...query });
    this.data.set(null);
    this.state.set('loading');
    try {
      const result = await this.ports.list({ ...query }, request.signal);
      if (!this.current(generation)) return;
      this.data.set(result);
      if (!result.items.some((row) => row.id === this.selectedId()))
        this.selectedId.set(null);
      this.state.set('ready');
    } catch (error) {
      if (!this.current(generation)) return;
      this.selectedId.set(null);
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.state.set(
        status === 401 || status === 403
          ? 'forbidden'
          : status === 503
            ? 'unavailable'
            : 'error'
      );
      if (status === 401) await this.ports.unauthorized();
    }
  }

  invalidate(): void {
    ++this.generation;
    this.request?.abort();
    this.request = null;
    this.data.set(null);
    this.selectedId.set(null);
    this.state.set('forbidden');
  }

  dispose(): void {
    this.invalidate();
    this.disposed = true;
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}
