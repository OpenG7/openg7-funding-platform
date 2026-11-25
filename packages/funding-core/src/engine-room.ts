import type {
  PublicationAutomationFilter,
  PublicationDelivery,
  PublicationFeed
} from './publication-automation.js';
import type { SponsorshipGoldenPathObservation } from './sponsorship-golden-path.js';

/** A read projection, never a command or evidence of provider delivery. */
export type EngineRoomScope = Pick<
  PublicationAutomationFilter,
  'sponsorshipId' | 'deliveryId'
>;
export interface EngineRoomSnapshot {
  /** Absent on older APIs; null outside an exact dossier scope. */
  readonly goldenPath?: SponsorshipGoldenPathObservation | null;
  readonly observedAt: string;
  readonly scope: EngineRoomScope;
  readonly publications: {
    readonly available: boolean;
    readonly workerEnabled: boolean | null;
    readonly feeds: readonly PublicationFeed[];
    readonly deliveries: readonly PublicationDelivery[];
    readonly partial: boolean;
  };
  readonly preflight: {
    readonly connectorEnabled: boolean;
    readonly localPreparationEnabled: boolean;
    readonly available: boolean;
    /** Connection to the remote Preflight service is not tested by this read. */
    readonly connection: 'disabled' | 'not_verified' | 'unavailable';
    readonly lastWorkerSeenAt: string | null;
    /** These counts describe the connector tenant globally, not a selected dossier. */
    readonly pending: number | null;
    readonly quarantined: number | null;
  };
}
