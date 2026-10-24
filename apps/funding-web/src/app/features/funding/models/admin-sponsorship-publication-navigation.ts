import type { AdminSponsorshipProgress } from '@openg7/funding-core';

export interface PublicationJourneyTarget {
  readonly key: string;
  readonly channel: string;
  readonly target: string;
  readonly draftId: string | null;
  readonly deliveryId: string | null;
  readonly obligationId: string | null;
}

export type PublicationJourneySelection =
  | { readonly state: 'selected'; readonly target: PublicationJourneyTarget }
  | { readonly state: 'choose' | 'unavailable' };

/** Navigation can name only recorded objects, never the first matching destination. */
export function publicationJourneySelection(
  targets: readonly PublicationJourneyTarget[],
  params: { getAll(name: string): readonly string[] }
): PublicationJourneySelection {
  const names = ['draftId', 'deliveryId', 'obligationId'] as const;
  const requested = names.flatMap((name) =>
    params.getAll(name).map((value) => ({ name, value }))
  );
  if (
    requested.some(
      ({ value }) => !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
    ) ||
    names.some((name) => params.getAll(name).length > 1)
  )
    return { state: 'unavailable' };
  if (!requested.length)
    return targets.length === 1
      ? { state: 'selected', target: targets[0]! }
      : { state: 'choose' };
  const matches = targets.filter((target) =>
    requested.every(
      ({ name, value }) => target[name]?.toLowerCase() === value.toLowerCase()
    )
  );
  if (matches.length === 1) return { state: 'selected', target: matches[0]! };
  return { state: matches.length ? 'choose' : 'unavailable' };
}

/** An exact delivery relationship can resolve a passage; a shared channel cannot. */
export function publicationJourneyObligation(
  dossier: AdminSponsorshipProgress,
  target: Pick<PublicationJourneyTarget, 'channel' | 'target' | 'deliveryId'>,
  recordedId: string | null | undefined
): string | null {
  const obligations = dossier.commitment?.obligations ?? [];
  const matches = obligations.filter(
    (obligation) =>
      obligation.channel === target.channel &&
      obligation.target === target.target &&
      (recordedId
        ? obligation.id === recordedId
        : !!target.deliveryId &&
          dossier.publicationWorkflow?.obligations.some(
            (step) =>
              step.obligationId === obligation.id &&
              step.deliveryId === target.deliveryId
          ))
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

/** Only routing identifiers leave the dossier; editorial text and filters stay local. */
export function publicationJourneyParams(
  sponsorshipId: string,
  target: PublicationJourneyTarget
): Record<string, string> {
  return {
    sponsorshipId,
    ...(target.draftId ? { draftId: target.draftId } : {}),
    ...(target.deliveryId ? { deliveryId: target.deliveryId } : {}),
    ...(target.obligationId ? { obligationId: target.obligationId } : {})
  };
}
