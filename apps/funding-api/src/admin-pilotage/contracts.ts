import type { PilotCommand } from '../../../../packages/funding-core/src/index.js';
import type { EditorialProgrammeService } from '../editorial-programme.service.js';
import type { PublicationAutomationService } from '../publication-automation/service.js';

export type PilotCommandExecutor = (
  command: PilotCommand,
  actor: string
) => Promise<string>;

export interface PilotExecutionPorts {
  readonly editorial: Pick<
    EditorialProgrammeService,
    'apply' | 'preferences' | 'editWithIntent'
  >;
  readonly publications: Pick<
    PublicationAutomationService,
    'repair' | 'command' | 'state'
  >;
}
