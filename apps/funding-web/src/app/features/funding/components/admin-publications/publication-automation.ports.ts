import type { WritableSignal } from '@angular/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationFilter,
  PublicationAutomationState,
  PublicationMediaOption
} from '@openg7/funding-core';

export interface PublicationAutomationCommandRunner {
  run(command: PublicationAutomationCommand, open?: boolean): Promise<void>;
}

export type PublicationAutomationMedia = PublicationMediaOption;

export interface PublicationAutomationCommandResult {
  id?: string;
}

/** A page navigation snapshot; it contains no receipt or browser storage. */
export interface PublicationAutomationCommandContext {
  revision: number;
  filter: PublicationAutomationFilter;
}

export interface PublicationAutomationCommandPorts {
  api: {
    execute(
      command: PublicationAutomationCommand
    ): Promise<PublicationAutomationCommandResult>;
    read(
      filter: PublicationAutomationFilter
    ): Promise<PublicationAutomationState>;
  };
  state: {
    busy: WritableSignal<boolean>;
    error: WritableSignal<string>;
    notice: WritableSignal<string>;
  };
  capture(): PublicationAutomationCommandContext;
  isCurrent(context: PublicationAutomationCommandContext): boolean;
  applyState(next: PublicationAutomationState): void;
  showError(error: unknown): void;
  confirmed(
    command: PublicationAutomationCommand,
    result: PublicationAutomationCommandResult,
    next: PublicationAutomationState,
    open: boolean
  ): void;
}
