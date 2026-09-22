import type {
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity
} from './index.js';

export type AdminAttentionDueFilter =
  'all' | 'today' | 'overdue' | 'this_week' | 'undated';

export interface AdminWorkQueueQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly type?: AdminAttentionItemType;
  readonly priority?: AdminAttentionSeverity;
  readonly due?: AdminAttentionDueFilter;
  readonly itemId?: string;
  /** Optional assistant overview, computed before pagination. */
  readonly overview?: boolean;
  readonly emailTemplate?: string;
  readonly emailError?: string;
}

export interface AdminWorkQueueOverview {
  /** One actionable item per type, in the existing priority order (maximum three). */
  readonly recommendations: readonly AdminAttentionItem[];
  readonly emailGroups: readonly {
    readonly template: string;
    readonly error: string;
    readonly count: number;
  }[];
}

export interface AdminWorkQueueResponse {
  readonly available: boolean;
  readonly coverage: 'complete' | 'unavailable';
  readonly missingSources: readonly string[];
  readonly generatedAt: string;
  readonly timezone: 'America/Toronto';
  readonly total: number;
  readonly filteredTotal: number;
  readonly todayTotal: number;
  readonly counts: Readonly<Record<AdminAttentionSeverity, number>>;
  readonly typeCounts: Readonly<Record<AdminAttentionItemType, number>>;
  /** Counts of required actions only, excluding informational entries. */
  readonly actionCounts?: Readonly<
    Partial<Record<AdminAttentionItemType, number>>
  >;
  readonly page: number;
  readonly pageSize: number;
  readonly items: readonly AdminAttentionItem[];
  /** First actionable sponsorship across the complete queue, before filters/pagination. */
  readonly firstSponsorshipId?: string | null;
  readonly overview?: AdminWorkQueueOverview;
}
