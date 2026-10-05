import type { WritableSignal } from '@angular/core';
import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../../services/funding-admin.service.js';
import {
  publicationDateTimeLocal,
  publicationDateTimeUtc,
  updatedPublicationDateTime
} from '../publication-panels.helpers.js';

export interface PublicationSlotEdit {
  readonly startsAt: string;
  readonly timezone: string;
  readonly capacity: string;
  readonly notes: string;
}

export interface AdminPublicationSlotsWorkflowPorts {
  readonly api: Pick<
    FundingAdminService,
    | 'createPublicationSlot'
    | 'updatePublicationSlot'
    | 'assignBatchToPublicationSlot'
    | 'assignDraftToPublicationSlot'
    | 'publishPublicationSlot'
    | 'cancelPublicationSlot'
  >;
  readonly state: {
    readonly slotActionState: WritableSignal<string | null>;
    readonly slotEdits: WritableSignal<Record<string, PublicationSlotEdit>>;
    readonly dirtySlotIds: WritableSignal<ReadonlySet<string>>;
    readonly newSlotFeedTarget: WritableSignal<SponsorFeedTarget>;
    readonly newSlotChannel: WritableSignal<SponsorFeedChannel>;
    readonly newSlotStartsAt: WritableSignal<string>;
    readonly newSlotTimezone: WritableSignal<string>;
    readonly newSlotCapacity: WritableSignal<string>;
    readonly newSlotNotes: WritableSignal<string>;
    readonly newSlotOpen: WritableSignal<boolean>;
    readonly selectedSlotId: WritableSignal<string | null>;
  };
  token(): string;
  reload(): Promise<void>;
  confirm(
    action: 'publish' | 'cancelPublication',
    target: string
  ): Promise<boolean>;
  failed(): void;
  invalidDateTime?(): void;
  focusRequested(id: string): void;
  batchSelection(id: string): string;
  draftSelection(id: string): string;
  batches(): readonly AdminPublicationBatchRecord[];
  drafts(): readonly AdminPublicationDraftRecord[];
}

/** Manual slot mutations and reconciliation; the panel owns presentation signals. */
export class AdminPublicationSlotsWorkflow {
  constructor(private readonly ports: AdminPublicationSlotsWorkflowPorts) {}

  reconcileSlots(slots: readonly AdminPublicationSlotRecord[]): void {
    const { slotEdits, dirtySlotIds } = this.ports.state;
    const previous = slotEdits();
    const dirty = dirtySlotIds();
    const next: Record<string, PublicationSlotEdit> = {};
    for (const id of dirty) {
      if (previous[id]) next[id] = previous[id];
    }
    for (const slot of slots) {
      next[slot.id] = dirty.has(slot.id)
        ? (previous[slot.id] ?? this.toEdit(slot))
        : this.toEdit(slot);
    }
    slotEdits.set(next);
  }

  async createSlot(): Promise<void> {
    const state = this.ports.state;
    if (state.slotActionState()) return;
    const capacity = Number.parseInt(state.newSlotCapacity(), 10);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 50 ||
      !state.newSlotStartsAt()
    ) {
      this.ports.failed();
      return;
    }

    const notes = state.newSlotNotes();
    state.slotActionState.set('create');
    try {
      const result = await this.ports.api.createPublicationSlot(
        this.ports.token(),
        {
          feedTarget: state.newSlotFeedTarget(),
          channel: state.newSlotChannel(),
          startsAt: publicationDateTimeUtc(
            state.newSlotStartsAt(),
            state.newSlotTimezone().trim() || 'America/Toronto'
          ),
          timezone: state.newSlotTimezone().trim() || 'America/Toronto',
          capacity,
          notes
        }
      );
      if (state.newSlotNotes() === notes) state.newSlotNotes.set('');
      state.newSlotOpen.set(false);
      state.selectedSlotId.set(result.slot?.id ?? null);
      await this.ports.reload();
      if (result.slot) this.ports.focusRequested(result.slot.id);
    } catch (error) {
      if (error instanceof RangeError && this.ports.invalidDateTime)
        this.ports.invalidDateTime();
      else this.ports.failed();
    } finally {
      state.slotActionState.set(null);
    }
  }

  async updateSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const state = this.ports.state;
    if (state.slotActionState()) return;
    const edit = this.editFor(slot.id);
    const capacity = Number.parseInt(edit.capacity, 10);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 50 ||
      !edit.startsAt
    ) {
      this.ports.failed();
      return;
    }

    state.slotActionState.set(slot.id);
    try {
      const result = await this.ports.api.updatePublicationSlot(
        this.ports.token(),
        {
          slotId: slot.id,
          startsAt: updatedPublicationDateTime(
            edit.startsAt,
            slot.startsAt,
            edit.timezone.trim() || 'America/Toronto',
            slot.timezone
          )!,
          timezone: edit.timezone.trim() || 'America/Toronto',
          capacity,
          notes: edit.notes
        }
      );
      if (!result.updated) throw new Error('Slot was not saved.');
      if (state.slotEdits()[slot.id] === edit)
        state.dirtySlotIds.update((ids) => {
          const next = new Set(ids);
          next.delete(slot.id);
          return next;
        });
      await this.ports.reload();
    } catch (error) {
      if (error instanceof RangeError && this.ports.invalidDateTime)
        this.ports.invalidDateTime();
      else this.ports.failed();
    } finally {
      state.slotActionState.set(null);
    }
  }

  async assignBatchToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const state = this.ports.state;
    if (state.slotActionState() || !this.hasAssignableBatchSelection(slot))
      return;
    const batchId = this.ports.batchSelection(slot.id);
    state.slotActionState.set(slot.id);
    try {
      await this.ports.api.assignBatchToPublicationSlot(this.ports.token(), {
        slotId: slot.id,
        batchId
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.slotActionState.set(null);
    }
  }

  async assignDraftToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const state = this.ports.state;
    if (state.slotActionState() || !this.hasAssignableDraftSelection(slot))
      return;
    const draftId = this.ports.draftSelection(slot.id);
    state.slotActionState.set(slot.id);
    try {
      await this.ports.api.assignDraftToPublicationSlot(this.ports.token(), {
        slotId: slot.id,
        draftId
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.slotActionState.set(null);
    }
  }

  async publishSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const state = this.ports.state;
    if (state.slotActionState()) return;
    if (!(await this.ports.confirm('publish', slot.id))) return;
    state.slotActionState.set(slot.id);
    try {
      await this.ports.api.publishPublicationSlot(this.ports.token(), {
        slotId: slot.id
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.slotActionState.set(null);
    }
  }

  async cancelSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const state = this.ports.state;
    if (state.slotActionState()) return;
    if (!(await this.ports.confirm('cancelPublication', slot.id))) return;
    state.slotActionState.set(slot.id);
    try {
      await this.ports.api.cancelPublicationSlot(this.ports.token(), {
        slotId: slot.id
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.slotActionState.set(null);
    }
  }

  editFor(slotId: string): PublicationSlotEdit {
    return this.ports.state.slotEdits()[slotId] ?? this.emptyEdit();
  }

  emptyEdit(): PublicationSlotEdit {
    return {
      startsAt: '',
      timezone: 'America/Toronto',
      capacity: '5',
      notes: ''
    };
  }

  toEdit(slot: AdminPublicationSlotRecord): PublicationSlotEdit {
    return {
      startsAt: publicationDateTimeLocal(slot.startsAt, slot.timezone),
      timezone: slot.timezone,
      capacity: String(slot.capacity),
      notes: slot.notes ?? ''
    };
  }

  assignableBatchesForSlot(
    slot: AdminPublicationSlotRecord
  ): readonly AdminPublicationBatchRecord[] {
    return this.ports
      .batches()
      .filter(
        (batch) =>
          batch.channel === slot.channel &&
          (batch.status === 'open' || batch.status === 'scheduled') &&
          (batch.slotId === null || batch.slotId === slot.id) &&
          (batch.slotId === slot.id ||
            batch.capacityUsed <= slot.capacityAvailable) &&
          this.batchDraftsMatchSlot(batch, slot)
      );
  }

  assignableDraftsForSlot(
    slot: AdminPublicationSlotRecord
  ): readonly AdminPublicationDraftRecord[] {
    return this.ports
      .drafts()
      .filter(
        (draft) =>
          draft.channel === slot.channel &&
          draft.feed_target === slot.feedTarget &&
          draft.batch_id === null &&
          (draft.status === 'approved' ||
            (draft.status === 'scheduled' && draft.slot_id === slot.id)) &&
          (draft.slot_id === null || draft.slot_id === slot.id) &&
          (draft.slot_id === slot.id || slot.capacityAvailable > 0)
      );
  }

  hasAssignableBatchSelection(slot: AdminPublicationSlotRecord): boolean {
    const id = this.ports.batchSelection(slot.id);
    return this.assignableBatchesForSlot(slot).some((batch) => batch.id === id);
  }

  hasAssignableDraftSelection(slot: AdminPublicationSlotRecord): boolean {
    const id = this.ports.draftSelection(slot.id);
    return this.assignableDraftsForSlot(slot).some((draft) => draft.id === id);
  }

  private batchDraftsMatchSlot(
    batch: AdminPublicationBatchRecord,
    slot: AdminPublicationSlotRecord
  ): boolean {
    const assignedDrafts = this.ports
      .drafts()
      .filter((draft) => draft.batch_id === batch.id);
    return assignedDrafts.every(
      (draft) => draft.feed_target === slot.feedTarget
    );
  }
}
