import type {
  AdminPlatformJourney,
  AdminPlatformJourneyDiagnostic,
  AdminPlatformJourneyId,
  AdminPlatformJourneyStep,
  AdminPlatformJourneyStepId,
  AdminPlatformJourneys
} from '@openg7/funding-core';

export const JOURNEY_OBSERVATION_MAX_AGE_MS = 15 * 60_000;
export const JOURNEY_CACHE_MS = 60_000;

export interface JourneyFacts {
  readonly source: 'available' | 'missing' | 'unavailable';
  readonly observedAt?: string | null;
  readonly environment?: 'live' | 'test' | 'unknown';
  /** All completed stages must belong to the same logical business operation. */
  readonly complete?: boolean;
  readonly steps?: Partial<Record<AdminPlatformJourneyStepId, string | null>>;
  readonly waiting?: 'awaiting_review' | 'awaiting_authorization';
  readonly issue?: {
    readonly diagnostic:
      'processing_failed' | 'processing_delayed' | 'delivery_uncertain';
    readonly stepId: AdminPlatformJourneyStepId;
    readonly observedAt: string | null;
    readonly environment?: 'live' | 'test' | 'unknown';
  };
}

const definitions: readonly {
  readonly id: AdminPlatformJourneyId;
  readonly steps: readonly AdminPlatformJourneyStepId[];
  readonly adminUrl: string;
}[] = [
  {
    id: 'contribution',
    steps: ['checkout', 'payment', 'confirmation', 'followup'],
    adminUrl: '/admin/fundraiser/contributions'
  },
  {
    id: 'invoicing',
    steps: ['payment', 'invoice', 'email'],
    adminUrl: '/admin/fundraiser/invoices'
  },
  {
    id: 'sponsorship',
    steps: ['dossier', 'media', 'review', 'visibility'],
    adminUrl: '/admin/fundraiser/sponsors'
  },
  {
    id: 'publication',
    steps: ['authorization', 'scheduling', 'delivery'],
    adminUrl: '/admin/fundraiser/publications'
  },
  {
    id: 'transparency',
    steps: ['transactions', 'calculation', 'public_display'],
    adminUrl: '/admin/fundraiser/attention'
  },
  {
    id: 'administration',
    steps: ['login', 'session', 'api_access'],
    adminUrl: '/admin/fundraiser'
  }
];

const timestamp = (
  value: string | null | undefined,
  now: Date
): string | null => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed <= now.getTime()
    ? new Date(parsed).toISOString()
    : null;
};

/** Correlation precedes aggregation: unrelated recent successes never make a journey green. */
export const buildPlatformJourneys = (
  facts: Partial<Record<AdminPlatformJourneyId, JourneyFacts>>,
  now = new Date(),
  authenticatedRequest = false
): AdminPlatformJourneys => ({
  generatedAt: now.toISOString(),
  journeys: definitions.map((definition): AdminPlatformJourney => {
    const fact = facts[definition.id] ?? { source: 'missing' };
    const authenticated =
      definition.id === 'administration' && authenticatedRequest;
    const observedAt = authenticated
      ? now.toISOString()
      : timestamp(fact.observedAt, now);
    const fresh =
      observedAt !== null &&
      now.getTime() - Date.parse(observedAt) < JOURNEY_OBSERVATION_MAX_AGE_MS;
    const validUntil = new Date(
      Math.min(
        now.getTime() + JOURNEY_CACHE_MS,
        fresh && !authenticated
          ? Date.parse(observedAt!) + JOURNEY_OBSERVATION_MAX_AGE_MS
          : Infinity
      )
    ).toISOString();
    const complete =
      fact.source === 'available' &&
      fact.complete === true &&
      definition.steps.every((id) => timestamp(fact.steps?.[id], now) !== null);
    const issue = fact.source === 'available' ? fact.issue : undefined;
    const scope = issue
      ? 'partial_records'
      : authenticated
        ? 'authenticated_request'
        : complete
          ? 'correlated_records'
          : definition.steps.some(
                (id) => timestamp(fact.steps?.[id], now) !== null
              )
            ? 'partial_records'
            : 'none';
    const sourceDiagnostic: AdminPlatformJourneyDiagnostic =
      fact.source === 'missing'
        ? 'source_missing'
        : fact.source === 'unavailable'
          ? 'source_unavailable'
          : 'no_recent_observation';
    const diagnostic: AdminPlatformJourneyDiagnostic = issue
      ? issue.diagnostic
      : authenticated
        ? 'partial_observation'
        : complete && fresh
          ? 'correlated_chain'
          : (fact.waiting ??
            (fresh ? 'partial_observation' : sourceDiagnostic));
    const issueState =
      issue?.diagnostic === 'processing_failed' ? 'unavailable' : 'degraded';
    const state = issue
      ? issueState
      : complete && fresh
        ? 'operational'
        : 'unknown';
    const base = {
      checkedAt: now.toISOString(),
      observedAt: issue ? timestamp(issue.observedAt, now) : observedAt,
      validUntil,
      environment: issue
        ? (issue.environment ?? 'unknown')
        : (fact.environment ?? 'unknown'),
      adminUrl: definition.adminUrl
    } as const;
    const steps = definition.steps.map((id): AdminPlatformJourneyStep => {
      const authenticatedStep = authenticated && id !== 'login';
      const stepAt = authenticatedStep
        ? observedAt
        : timestamp(fact.steps?.[id], now);
      const stepFresh =
        (complete && fresh) ||
        (stepAt !== null &&
          now.getTime() - Date.parse(stepAt) < JOURNEY_OBSERVATION_MAX_AGE_MS);
      const affected = issue?.stepId === id;
      return {
        ...base,
        id,
        environment: affected
          ? (issue.environment ?? 'unknown')
          : (fact.environment ?? 'unknown'),
        validUntil: new Date(
          Math.min(
            Date.parse(validUntil),
            !complete && stepAt && stepFresh
              ? Date.parse(stepAt) + JOURNEY_OBSERVATION_MAX_AGE_MS
              : Infinity
          )
        ).toISOString(),
        observedAt: affected ? timestamp(issue.observedAt, now) : stepAt,
        state: affected
          ? issueState
          : stepAt && stepFresh
            ? 'operational'
            : 'unknown',
        evidenceScope: affected
          ? 'partial_records'
          : authenticatedStep
            ? 'authenticated_request'
            : stepAt
              ? scope === 'correlated_records'
                ? scope
                : 'partial_records'
              : 'none',
        diagnostic: affected
          ? issue.diagnostic
          : authenticatedStep
            ? 'authenticated_request'
            : stepAt && stepFresh
              ? id === 'email'
                ? 'smtp_accepted'
                : 'correlated_step'
              : id === 'public_display'
                ? 'public_observation_missing'
                : fact.waiting && (id === 'review' || id === 'authorization')
                  ? fact.waiting
                  : sourceDiagnostic
      };
    });
    return {
      ...base,
      id: definition.id,
      state,
      diagnostic,
      evidenceScope: scope,
      steps
    };
  })
});
