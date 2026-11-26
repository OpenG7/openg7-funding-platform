import type {
  AdminFlowMeasurement,
  AdminFlowCounters,
  AdminFlowCohort,
  EngineRoomScope,
  SponsorshipObligation
} from '@openg7/funding-core';

export interface FlowObligationFact {
  readonly obligation: SponsorshipObligation;
  readonly createdAt: string | null;
  readonly qualifiedDeliveredAt: string | null;
  readonly mode: AdminFlowCohort['mode'];
}
const second = 1000;
const day = 86400000;
const timestamp = (date: string | null | undefined): number | null => {
  const value = date ? Date.parse(date) : NaN;
  return Number.isFinite(value) ? value : null;
};
const percentile = (values: number[], fraction: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
};
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
export const flowWindow = (now: Date) => ({
  from: new Date(now.getTime() - 7 * day).toISOString(),
  to: now.toISOString(),
  timezone: 'UTC' as const
});
export const unavailableFlowMeasurement = (
  scope: EngineRoomScope,
  now: Date
): AdminFlowMeasurement => ({
  definition: 'sponsorship-obligation-flow/v1',
  observedAt: now.toISOString(),
  window: flowWindow(now),
  scope,
  status: 'unavailable',
  sources: [],
  excludedDossiers: null,
  totals: null,
  cohorts: [],
  humanActiveSeconds: null,
  autonomyRate: null
});

/** Deduplicate exact obligations; no financial, publication or approval mutation. */
export function projectFlowMeasurement(
  facts: readonly FlowObligationFact[],
  excludedDossiers: number,
  scope: EngineRoomScope,
  now: Date
): AdminFlowMeasurement {
  const end = now.getTime();
  const start = end - 7 * day;
  const unique = [
    ...new Map(facts.map((fact) => [fact.obligation.id, fact])).values()
  ];
  const counters = (rows: readonly FlowObligationFact[]): AdminFlowCounters => {
    let entries = 0,
      qualifiedExits = 0,
      open = 0,
      qualified = 0,
      adjusted = 0,
      overdue = 0,
      undated = 0,
      unknownAge = 0;
    const ages: number[] = [];
    const cycles: number[] = [];
    for (const fact of rows) {
      const created = timestamp(fact.createdAt);
      const delivered = timestamp(fact.qualifiedDeliveredAt);
      if (created !== null && created >= start && created < end) entries++;
      if (fact.obligation.state === 'adjusted') {
        adjusted++;
        continue;
      }
      // Never treat a future, malformed or unqualified evidence timestamp as an exit.
      if (delivered !== null && delivered <= end) {
        qualified++;
        if (delivered >= start && delivered < end) {
          qualifiedExits++;
          if (created !== null && created <= delivered)
            cycles.push(Math.floor((delivered - created) / second));
        }
        continue;
      }
      open++;
      const due = timestamp(fact.obligation.timing?.dueAt);
      if (due === null) undated++;
      else if (due < end) overdue++;
      if (created !== null && created <= end)
        ages.push(Math.floor((end - created) / second));
      else unknownAge++;
    }
    return {
      population: rows.length,
      entries,
      qualifiedExits,
      open,
      qualified,
      adjusted,
      overdue,
      undated,
      ageSamples: ages.length,
      unknownAge,
      oldestAgeSeconds: ages.length
        ? ages.reduce((oldest, age) => Math.max(oldest, age), 0)
        : null,
      medianAgeSeconds: median(ages),
      p95AgeSeconds: percentile(ages, 0.95),
      cycleSamples: cycles.length,
      medianCycleSeconds: median(cycles),
      p95CycleSeconds: percentile(cycles, 0.95)
    };
  };
  const groups = new Map<
    string,
    {
      dimensions: Pick<
        AdminFlowCohort,
        'channel' | 'target' | 'format' | 'mode' | 'deadline'
      >;
      facts: FlowObligationFact[];
    }
  >();
  for (const fact of unique) {
    const o = fact.obligation;
    const dimensions = {
      channel: o.channel,
      target: o.target,
      format: o.format ?? 'unknown',
      mode: fact.mode,
      deadline:
        timestamp(o.timing?.dueAt) === null
          ? ('undated' as const)
          : ('dated' as const)
    };
    const key = JSON.stringify(dimensions);
    const group = groups.get(key) ?? { dimensions, facts: [] };
    group.facts.push(fact);
    groups.set(key, group);
  }
  return {
    ...unavailableFlowMeasurement(scope, now),
    status: 'available',
    excludedDossiers,
    sources: [
      'sponsorship_commitments',
      'sponsorship_obligations.created_at',
      'sponsorship_obligation_timing',
      'qualifiedSponsorshipEvidenceIds',
      'sponsorship_fulfilment_evidence.delivered_at',
      'publication_deliveries.mode'
    ],
    totals: counters(unique),
    cohorts: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => ({ ...group.dimensions, ...counters(group.facts) }))
  };
}
