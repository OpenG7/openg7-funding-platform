import type { WritableSignal } from '@angular/core';
import type { PilotCommand, PilotReceipt } from '@openg7/funding-core';

export type PilotageCommandDraft = Pick<
  PilotCommand,
  'action' | 'targetId' | 'version' | 'payload'
>;

export interface PilotageCommandPorts {
  admin: {
    pilotageCommand(command: PilotCommand): Promise<PilotReceipt>;
    pilotageReceipt(requestId: string): Promise<PilotReceipt>;
    acknowledgePilotReceipt(
      requestId: string,
      reason: string
    ): Promise<PilotReceipt>;
  };
  state: {
    busy: WritableSignal<boolean>;
    error: WritableSignal<string>;
    receipt: WritableSignal<PilotReceipt | null>;
    unresolved: WritableSignal<string>;
  };
  actorId(): string;
  storage(): Pick<Storage, 'setItem' | 'removeItem'> | null;
  requestId(): string;
  resetInput(): void;
  settleCommand(): void;
  closeIncident(): void;
  confirmed(): void;
  denyWrites(): void;
  refresh(): Promise<void>;
}

/** Page-local command/receipt lifecycle; panels, inputs and counters belong to the page. */
export class AdminPilotageCommandWorkflow {
  constructor(private readonly ports: PilotageCommandPorts) {}

  receiptStorageKey(): string {
    return 'og7-pilot-receipt:' + this.ports.actorId();
  }

  async send(command: PilotageCommandDraft): Promise<void> {
    const { state } = this.ports;
    if (state.busy() || state.unresolved()) return;
    const requestId = this.ports.requestId();
    const storageKey = this.receiptStorageKey();
    state.busy.set(true);
    state.error.set('');
    this.ports.resetInput();
    state.unresolved.set(requestId);
    try {
      this.ports.storage()?.setItem(storageKey, requestId);
    } catch {
      /* Receipt still retained in memory. */
    }
    try {
      await this.receive(
        await this.ports.admin.pilotageCommand({
          action: command.action,
          targetId: command.targetId,
          version: command.version,
          payload: command.payload,
          requestId,
          confirmation: command.targetId
        }),
        storageKey
      );
    } catch (error) {
      state.error.set(
        error instanceof Error ? error.message : 'RESULT_UNKNOWN'
      );
      const status = (error as { status?: number })?.status;
      if (status && [400, 401, 403, 409].includes(status)) {
        this.clearUnresolved(storageKey);
        if (status === 401 || status === 403) this.ports.denyWrites();
      }
    } finally {
      state.busy.set(false);
      this.ports.settleCommand();
      this.ports.resetInput();
    }
  }

  async recover(): Promise<void> {
    const { state } = this.ports;
    if (!state.unresolved() || state.busy()) return;
    const storageKey = this.receiptStorageKey();
    state.busy.set(true);
    this.ports.resetInput();
    try {
      await this.receive(
        await this.ports.admin.pilotageReceipt(state.unresolved()),
        storageKey
      );
    } catch {
      state.error.set('RESULT_UNKNOWN');
    } finally {
      state.busy.set(false);
      this.ports.resetInput();
    }
  }

  async acknowledgeIncident(reason: string): Promise<void> {
    const { state } = this.ports;
    if (
      state.busy() ||
      !state.unresolved() ||
      state.receipt()?.status !== 'uncertain' ||
      reason.trim().length < 10
    )
      return;
    const storageKey = this.receiptStorageKey();
    state.busy.set(true);
    this.ports.resetInput();
    try {
      await this.receive(
        await this.ports.admin.acknowledgePilotReceipt(
          state.unresolved(),
          reason
        ),
        storageKey
      );
      this.ports.closeIncident();
      state.error.set('');
    } catch (error) {
      state.error.set(
        error instanceof Error ? error.message : 'RESULT_UNKNOWN'
      );
    } finally {
      state.busy.set(false);
      this.ports.resetInput();
    }
  }

  private async receive(
    receipt: PilotReceipt,
    storageKey: string
  ): Promise<void> {
    const { state } = this.ports;
    state.receipt.set(receipt);
    if (
      receipt.status === 'completed' ||
      receipt.status === 'failed' ||
      receipt.reviewedAt
    ) {
      this.clearUnresolved(storageKey);
      if (receipt.status === 'completed') this.ports.confirmed();
      await this.ports.refresh();
      if (receipt.status !== 'completed' && !receipt.reviewedAt)
        state.error.set(receipt.code ?? 'generic');
    }
  }

  private clearUnresolved(storageKey: string): void {
    this.ports.state.unresolved.set('');
    try {
      this.ports.storage()?.removeItem(storageKey);
    } catch {
      /* Optional storage. */
    }
  }
}
