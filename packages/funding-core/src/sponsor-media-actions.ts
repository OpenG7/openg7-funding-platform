export type SponsorMediaActionId =
  | 'preview'
  | 'approve'
  | 'reject'
  | 'permissions'
  | 'analyze'
  | 'delete'
  | 'metadata'
  | 'history';
export interface SponsorMediaContextAction {
  readonly id: SponsorMediaActionId;
  readonly enabled: boolean;
  readonly requiresConfirmation: boolean;
  readonly scope: 'single' | 'selection';
}
/** One semantic projection for buttons, keyboard and controller. The API remains authoritative. */
export function getSponsorMediaActions(input: {
  readonly selectionCount: number;
  readonly readyCount: number;
  readonly reviewableCount?: number;
  readonly canReview: boolean;
  readonly canDelete?: boolean;
  readonly busy: boolean;
}): readonly SponsorMediaContextAction[] {
  const selected =
    Number.isSafeInteger(input.selectionCount) &&
    input.selectionCount > 0 &&
    input.selectionCount <= 100;
  const writable = selected && input.canReview && !input.busy;
  const single = input.selectionCount === 1 && !input.busy;
  return [
    {
      id: 'preview',
      enabled: single,
      requiresConfirmation: false,
      scope: 'single'
    },
    {
      id: 'approve',
      enabled:
        writable &&
        (input.readyCount === input.selectionCount ||
          input.reviewableCount === input.selectionCount),
      requiresConfirmation: true,
      scope: 'selection'
    },
    {
      id: 'reject',
      enabled: writable,
      requiresConfirmation: true,
      scope: 'selection'
    },
    {
      id: 'permissions',
      enabled: writable,
      requiresConfirmation: false,
      scope: 'selection'
    },
    {
      id: 'analyze',
      enabled: writable,
      requiresConfirmation: false,
      scope: 'selection'
    },
    {
      id: 'delete',
      enabled: writable && input.canDelete !== false,
      requiresConfirmation: true,
      scope: 'selection'
    },
    {
      id: 'metadata',
      enabled: single && input.canReview,
      requiresConfirmation: false,
      scope: 'single'
    },
    {
      id: 'history',
      enabled: single,
      requiresConfirmation: false,
      scope: 'single'
    }
  ];
}
