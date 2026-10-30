import type { HubActivityKind } from './activity-hub-activity.js';

export const HUB_DATA_SCENARIOS = [
  'normal',
  'empty',
  'loading',
  'partial',
  'unavailable'
] as const;
export type HubDataScenario = (typeof HUB_DATA_SCENARIOS)[number];

/** A missing operational source has no numeric value; zero means a known empty set. */
export interface HubMetricValue {
  readonly kind: HubActivityKind;
  readonly value: number | null;
}
