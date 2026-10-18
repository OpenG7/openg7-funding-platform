import type {
  PreparationAssistanceRun,
  PreparationAssistanceState
} from '@openg7/funding-core';

export function assistanceIsStale(
  sourceVersion: number | null,
  commitmentVersion: number,
  run: {
    readonly sourceVersion: number;
    readonly commitmentVersion: number;
    readonly appliedCommitmentVersion: number | null;
  } | null
): boolean {
  return (
    !!run &&
    (run.sourceVersion !== sourceVersion ||
      (run.appliedCommitmentVersion ?? run.commitmentVersion) !==
        commitmentVersion)
  );
}

/** Permissions to open/review remain independent of whether a draft is complete. */
export function assistanceCapabilities(
  hasSource: boolean,
  pending: boolean,
  stale: boolean,
  runState: PreparationAssistanceRun['state'] | null,
  reviewDecision:
    NonNullable<PreparationAssistanceRun['review']>['decision'] | null
): PreparationAssistanceState['capabilities'] {
  const terminal =
    reviewDecision === 'rejected' || reviewDecision === 'accepted';
  return {
    canManageSource: true,
    canRun: hasSource && pending,
    canReview: runState === 'succeeded' && !stale && !terminal,
    canApply: runState === 'succeeded' && !stale && pending && !terminal
  };
}
