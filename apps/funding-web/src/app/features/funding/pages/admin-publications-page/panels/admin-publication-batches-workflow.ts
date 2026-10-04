import type { WritableSignal } from '@angular/core';
import type {
  AdminPublicationBatchRecord,
  SponsorFeedChannel
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../../services/funding-admin.service.js';

export interface AdminPublicationBatchesWorkflowPorts {
  readonly api: Pick<
    FundingAdminService,
    | 'createPublicationBatch'
    | 'schedulePublicationBatch'
    | 'publishPublicationBatch'
    | 'cancelPublicationBatch'
  >;
  readonly state: {
    readonly batchActionState: WritableSignal<string | null>;
    readonly newBatchChannel: WritableSignal<SponsorFeedChannel>;
    readonly newBatchCapacity: WritableSignal<string>;
    readonly newBatchOpen: WritableSignal<boolean>;
    readonly selectedBatchId: WritableSignal<string | null>;
  };
  token(): string;
  reload(): Promise<void>;
  confirm(
    action: 'publish' | 'cancelPublication',
    target: string
  ): Promise<boolean>;
  failed(): void;
  focusRequested(id: string): void;
  scheduleFor(id: string): string;
}

/** Local manual batch mutations; rendering and automation navigation stay in the panel. */
export class AdminPublicationBatchesWorkflow {
  constructor(private readonly ports: AdminPublicationBatchesWorkflowPorts) {}

  async createBatch(): Promise<void> {
    const { state } = this.ports;
    if (state.batchActionState()) return;
    const capacity = Number.parseInt(state.newBatchCapacity(), 10);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      this.ports.failed();
      return;
    }

    state.batchActionState.set('create');
    try {
      const result = await this.ports.api.createPublicationBatch(
        this.ports.token(),
        {
          channel: state.newBatchChannel(),
          capacity
        }
      );
      state.newBatchOpen.set(false);
      state.selectedBatchId.set(result.batch?.id ?? null);
      await this.ports.reload();
      if (result.batch) this.ports.focusRequested(result.batch.id);
    } catch {
      this.ports.failed();
    } finally {
      state.batchActionState.set(null);
    }
  }

  async scheduleBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    const { state } = this.ports;
    if (state.batchActionState()) return;
    const scheduledAt = this.ports.scheduleFor(batch.id);
    if (!scheduledAt) return;

    state.batchActionState.set(batch.id);
    try {
      await this.ports.api.schedulePublicationBatch(this.ports.token(), {
        batchId: batch.id,
        scheduledAt: new Date(scheduledAt).toISOString()
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.batchActionState.set(null);
    }
  }

  async publishBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    const { state } = this.ports;
    if (state.batchActionState()) return;
    if (!(await this.ports.confirm('publish', batch.id))) return;
    state.batchActionState.set(batch.id);
    try {
      await this.ports.api.publishPublicationBatch(this.ports.token(), {
        batchId: batch.id
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.batchActionState.set(null);
    }
  }

  async cancelBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    const { state } = this.ports;
    if (state.batchActionState()) return;
    if (!(await this.ports.confirm('cancelPublication', batch.id))) return;
    state.batchActionState.set(batch.id);
    try {
      await this.ports.api.cancelPublicationBatch(this.ports.token(), {
        batchId: batch.id
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.batchActionState.set(null);
    }
  }
}
