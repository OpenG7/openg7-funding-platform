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
  readonly page: number;
  readonly pageSize: number;
  readonly items: readonly AdminAttentionItem[];
}
