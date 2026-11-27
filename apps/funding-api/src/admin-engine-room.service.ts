import type {
  EngineRoomScope,
  EngineRoomSnapshot,
  SponsorshipGoldenPathObservation,
  PublicationAutomationState
} from '@openg7/funding-core';

export interface EngineRoomReadPorts {
  readonly goldenPath?: (
    id: string
  ) => Promise<SponsorshipGoldenPathObservation>;
  readonly publications:
    ((scope: EngineRoomScope) => Promise<PublicationAutomationState>) | null;
  readonly connectorEnabled: boolean;
  readonly localPreparationEnabled: boolean;
  readonly connector: () => Promise<{
    lastWorkerSeenAt: string | null;
    pending: number;
    quarantined: number;
    quarantinedImports: number;
  }>;
}

/** Aggregates existing owner reads; no external check, command or environment access. */
export async function readEngineRoom(
  ports: EngineRoomReadPorts,
  inputScope: EngineRoomScope,
  now: () => Date = () => new Date()
): Promise<EngineRoomSnapshot> {
  const scope: EngineRoomScope = {
    ...(inputScope.sponsorshipId
      ? { sponsorshipId: inputScope.sponsorshipId.toLowerCase() }
      : {}),
    ...(inputScope.deliveryId
      ? { deliveryId: inputScope.deliveryId.toLowerCase() }
      : {})
  };
  const observedAt = now().toISOString();
  const [publication, connector, goldenPath] = await Promise.allSettled([
    ports.publications
      ? ports.publications(scope)
      : Promise.reject(new Error('UNAVAILABLE')),
    ports.connectorEnabled ? ports.connector() : Promise.resolve(null),
    scope.sponsorshipId && !scope.deliveryId && ports.goldenPath
      ? ports.goldenPath(scope.sponsorshipId)
      : Promise.resolve(null)
  ]);
  const data = publication.status === 'fulfilled' ? publication.value : null;
  const scoped = !!(scope.sponsorshipId || scope.deliveryId);
  // Retain only records matching the explicit scope, even if an upstream read widens.
  const deliveries =
    data?.deliveries.filter(
      (item) =>
        (!scope.deliveryId || item.id.toLowerCase() === scope.deliveryId) &&
        (!scope.sponsorshipId ||
          item.sponsors.some((s) => s.id.toLowerCase() === scope.sponsorshipId))
    ) ?? [];
  const feedIds = new Set(deliveries.map((item) => item.feedId));
  for (const item of data?.queue?.entries ?? [])
    if (
      scope.sponsorshipId &&
      item.sponsorshipId.toLowerCase() === scope.sponsorshipId &&
      !scope.deliveryId
    )
      feedIds.add(item.feedId);
  for (const item of data?.preparationCandidates ?? [])
    if (
      scope.sponsorshipId &&
      item.sponsorshipId.toLowerCase() === scope.sponsorshipId &&
      !scope.deliveryId
    )
      feedIds.add(item.feedId);
  const status = connector.status === 'fulfilled' ? connector.value : null;
  return {
    observedAt,
    scope,
    goldenPath:
      goldenPath.status === 'fulfilled'
        ? goldenPath.value
        : { status: 'unavailable', path: null },
    publications: {
      available: data !== null,
      workerEnabled: data?.workerEnabled ?? null,
      feeds:
        data?.feeds.filter((feed) => !scoped || feedIds.has(feed.id)) ?? [],
      deliveries,
      partial:
        data !== null &&
        (data.deliveries.length >= 200 || !!data.queue?.hasMore)
    },
    preflight: {
      connectorEnabled: ports.connectorEnabled,
      localPreparationEnabled: ports.localPreparationEnabled,
      available: !ports.connectorEnabled || status !== null,
      connection: !ports.connectorEnabled
        ? 'disabled'
        : status
          ? 'not_verified'
          : 'unavailable',
      lastWorkerSeenAt: status?.lastWorkerSeenAt ?? null,
      pending: status?.pending ?? null,
      quarantined: status
        ? status.quarantined + status.quarantinedImports
        : null
    }
  };
}
