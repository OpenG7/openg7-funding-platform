import type {
  AdminPlatformJourneyObservation,
  AdminPlatformJourneyState
} from '@openg7/funding-core';

/** Server-relative time; rereading an old snapshot cannot extend its lifetime. */
export function createJourneyClock() {
  let serverAtReceipt = Number.NaN;
  let receivedAt = Number.NaN;
  let usable = false;
  const elapsedTime = (monotonicNow: number): number =>
    Number.isFinite(monotonicNow) && monotonicNow >= receivedAt
      ? serverAtReceipt + monotonicNow - receivedAt
      : Number.NaN;
  return {
    now: (monotonicNow: number): number =>
      usable ? elapsedTime(monotonicNow) : Number.NaN,
    observe: (
      generatedAt: string,
      requestStarted: number,
      responseReceived: number
    ): number => {
      const generated = Date.parse(generatedAt);
      if (
        !Number.isFinite(generated) ||
        !Number.isFinite(requestStarted) ||
        !Number.isFinite(responseReceived) ||
        responseReceived < requestStarted ||
        responseReceived < receivedAt
      ) {
        usable = false;
        return Number.NaN;
      }
      const previous = elapsedTime(responseReceived);
      // Charging the full request duration is conservative: generation happened
      // between dispatch and receipt. An older response must never rewind time.
      serverAtReceipt = Math.max(
        generated + responseReceived - requestStarted,
        Number.isFinite(previous) ? previous : Number.NEGATIVE_INFINITY
      );
      receivedAt = responseReceived;
      usable = true;
      return serverAtReceipt;
    }
  };
}

/** A failed read or expired observation cannot keep a journey light green. */
export function journeyExpired(
  observation: AdminPlatformJourneyObservation,
  now: number,
  failed = false
): boolean {
  const checkedAt = Date.parse(observation.checkedAt);
  const validUntil = Date.parse(observation.validUntil);
  return (
    failed ||
    !Number.isFinite(now) ||
    !Number.isFinite(checkedAt) ||
    !Number.isFinite(validUntil) ||
    checkedAt > now ||
    validUntil <= checkedAt ||
    now >= validUntil
  );
}

export function journeyState(
  observation: AdminPlatformJourneyObservation,
  now: number,
  failed = false
): AdminPlatformJourneyState {
  return journeyExpired(observation, now, failed)
    ? 'unknown'
    : observation.state;
}
