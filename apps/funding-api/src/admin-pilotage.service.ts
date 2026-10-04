import type { Pool } from 'pg';

import type {
  PilotReceipt,
  PilotState
} from '../../../packages/funding-core/src/index.js';

import { loadAdminPilotageState } from './admin-pilotage.read-model.js';
import { AdminPilotageExecution } from './admin-pilotage/execution.js';
import { AdminPilotageReceipts } from './admin-pilotage/receipts.js';
import { EditorialProgrammeService } from './editorial-programme.service.js';
import type { PublicationAutomationService } from './publication-automation/service.js';

export { parsePilotCommand } from './admin-pilotage/command-policy.js';
export { PilotError } from './admin-pilotage/errors.js';

export class AdminPilotageService {
  readonly editorial: EditorialProgrammeService;
  private readonly receipts: AdminPilotageReceipts;

  constructor(
    private readonly pool: Pool,
    private readonly publications: PublicationAutomationService
  ) {
    this.editorial = new EditorialProgrammeService(pool, publications);
    const execution = new AdminPilotageExecution(pool, {
      editorial: this.editorial,
      publications
    });
    this.receipts = new AdminPilotageReceipts(pool, (command, actor) =>
      execution.execute(command, actor)
    );
  }

  async state(
    query: { page?: number; domain?: string; id?: string } = {},
    writable = true,
    owner = true
  ): Promise<PilotState> {
    return loadAdminPilotageState(
      this.pool,
      this.publications,
      query,
      writable,
      owner
    );
  }

  async readReceipt(id: string, actor: string): Promise<PilotReceipt | null> {
    return this.receipts.readReceipt(id, actor);
  }

  async acknowledgeReceipt(
    value: unknown,
    actor: string
  ): Promise<PilotReceipt> {
    return this.receipts.acknowledgeReceipt(value, actor);
  }

  async command(
    value: unknown,
    actor: string,
    writable = true,
    owner = true
  ): Promise<PilotReceipt> {
    return this.receipts.command(value, actor, writable, owner);
  }
}
