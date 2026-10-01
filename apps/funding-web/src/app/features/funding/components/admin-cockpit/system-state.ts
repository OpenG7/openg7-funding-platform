import type {
  CockpitSystem,
  CockpitSystemCheck,
  CockpitSystemState
} from '@openg7/funding-core';

/** A failed refresh or expired observation cannot keep an operational badge. */
export function systemExpired(
  system: CockpitSystemCheck,
  now: number,
  failed = false
): boolean {
  return (
    failed ||
    !Number.isFinite(Date.parse(system.validUntil)) ||
    now >= Date.parse(system.validUntil)
  );
}

export function systemState(
  system: CockpitSystemCheck,
  now: number,
  failed = false
): CockpitSystemState {
  return systemExpired(system, now, failed) ? 'unknown' : system.state;
}

/** A legacy webhook observation never proves a connection to the Stripe API. */
export function serviceState(
  system: CockpitSystem,
  now: number,
  failed = false
): CockpitSystemState {
  if (system.id === 'stripe' && !system.connection) return 'unknown';
  return systemState(system.connection ?? system, now, failed);
}
