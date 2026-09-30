import type { CockpitSystem, CockpitSystemState } from '@openg7/funding-core';

/** A failed refresh or expired observation cannot keep an operational badge. */
export function systemExpired(
  system: CockpitSystem,
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
  system: CockpitSystem,
  now: number,
  failed = false
): CockpitSystemState {
  return systemExpired(system, now, failed) ? 'unknown' : system.state;
}
