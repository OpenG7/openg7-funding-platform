import type { WritableSignal } from '@angular/core';
import type {
  PilotCommand,
  ProgrammeState,
  PublicationDelivery,
  PublicationFeedId
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';

export type ProgrammeCommand = Pick<
  PilotCommand,
  'action' | 'targetId' | 'version' | 'payload'
>;

/** Shared interaction state; the facade holds one pending intention. */
export interface EditorialInteractionPorts {
  readonly working: WritableSignal<boolean>;
  setPending(command: ProgrammeCommand | null): void;
  contextChanged(): void;
}

export interface EditorialProgrammePorts extends EditorialInteractionPorts {
  readonly api: Pick<
    FundingAdminService,
    'pilotageProgramme' | 'proposeProgramme'
  >;
  disabled(): boolean;
  clearComparison(): void;
  syncPreferences(): void;
}

/** Read through the programme owner rather than retaining another snapshot. */
export interface EditorialRehearsalPorts extends EditorialInteractionPorts {
  readonly api: Pick<FundingAdminService, 'editorialVariant'> & {
    getMediaPreview(mediaId: string): Promise<Blob>;
  };
  readonly error: WritableSignal<string>;
  readonly(): boolean;
  feedId(): PublicationFeedId;
  selected(): PublicationDelivery | null;
  profile(): ProgrammeState['profiles'][number] | undefined;
  originalDate(id: string): string;
  issue(id: string): ProgrammeState['issues'][number] | undefined;
}
