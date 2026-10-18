import type {
  PreparationAssistanceRun,
  PreparationAssistanceState
} from './preparation-assistance.js';

/** A private owner-only read model. Agreement text and review contents stay in the owning form. */
export interface PreparationAssistanceSummary {
  readonly contributionId: string;
  readonly controlCode: 'accepted_offer';
  readonly revision: string;
  readonly sourceVersion: number | null;
  readonly commitmentVersion: number;
  readonly run: {
    readonly id: string;
    readonly sourceVersion: number;
    readonly commitmentVersion: number;
    readonly adapter: PreparationAssistanceRun['adapter'];
    readonly state: PreparationAssistanceRun['state'];
    readonly phase: PreparationAssistanceRun['phase'];
    readonly errorCode: string | null;
    readonly reviewVersion: number;
    readonly reviewDecision: 'saved' | 'rejected' | 'accepted' | null;
    readonly clauseCount: number;
    readonly unsupportedCount: number;
    readonly unresolvedCount: number;
    readonly appliedCommitmentVersion: number | null;
  } | null;
  readonly stale: boolean;
  readonly capabilities: PreparationAssistanceState['capabilities'];
}

export type PreparationAssistanceActionId = 'review' | 'source' | 'rerun';
export interface PreparationAssistanceAction {
  readonly id: PreparationAssistanceActionId;
  readonly enabled: boolean;
  readonly disabledReason:
    | 'unavailable'
    | 'no_source'
    | 'no_result'
    | 'running'
    | 'not_eligible'
    | null;
}

/** Semantic action projection shared by native controls and controller bindings; it never executes commands. */
export function preparationAssistanceActions(
  summary: PreparationAssistanceSummary | null,
  options: { readonly permitted: boolean; readonly busy: boolean }
): readonly PreparationAssistanceAction[] {
  const available = !!summary && options.permitted && !options.busy;
  const running =
    !!summary?.run && ['queued', 'processing'].includes(summary.run.state);
  const source =
    summary?.sourceVersion !== null && summary?.sourceVersion !== undefined;
  const review = summary?.run?.state === 'succeeded';
  const enabled = (
    id: PreparationAssistanceActionId,
    ready: boolean,
    reason: PreparationAssistanceAction['disabledReason']
  ): PreparationAssistanceAction => ({
    id,
    enabled: available && ready,
    disabledReason: !available ? 'unavailable' : ready ? null : reason
  });
  return [
    enabled('review', review, 'no_result'),
    enabled('source', source, 'no_source'),
    enabled(
      'rerun',
      source && !!summary?.capabilities.canRun && !running,
      !source ? 'no_source' : running ? 'running' : 'not_eligible'
    )
  ];
}
