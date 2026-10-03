import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord,
  PublicationSlotStatus,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

import { AdminDrawerComponent } from '../../../components/admin-ui/admin-drawer.component.js';
import { AdminPublicationCalendarComponent } from '../../../components/admin-publications/admin-publication-calendar.component.js';
import type { PublicationCalendarEntry } from '../../../components/admin-publications/publication-calendar.js';
import { AdminConfirmationService } from '../../../services/admin-confirmation.service.js';
import { FundingAdminService } from '../../../services/funding-admin.service.js';
import { FundingI18nService } from '../../../services/funding-i18n.service.js';
import type { PublicationLoadState } from '../publication-panels.contracts.js';
import {
  publicationBatchStatusLabel,
  publicationChannelLabel,
  publicationDateLabel,
  publicationDateTimeLocal,
  publicationFeedTargetName,
  publicationValueFromEvent
} from '../publication-panels.helpers.js';

interface PublicationSlotEdit {
  readonly startsAt: string;
  readonly timezone: string;
  readonly capacity: string;
  readonly notes: string;
}

/** Funding organism: slot editing and mutations, using the page's shared load. */
@Component({
  selector: 'openg7-admin-publication-slots-panel',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    AdminPublicationCalendarComponent,
    AdminDrawerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-slots-panel.component.html',
  styleUrls: [
    '../../../components/admin-ui/admin-theme.css',
    '../../../components/admin-ui/admin-controls.css',
    '../../../components/admin-ui/admin-forms.css',
    '../admin-publications-panels.css'
  ]
})
export class AdminPublicationSlotsPanelComponent {
  readonly active = input(false);
  readonly state = input.required<PublicationLoadState>();
  readonly adminToken = input.required<string>();
  readonly slots = input.required<readonly AdminPublicationSlotRecord[]>();
  readonly drafts = input.required<readonly AdminPublicationDraftRecord[]>();
  readonly batches = input.required<readonly AdminPublicationBatchRecord[]>();
  readonly reload = input.required<() => Promise<void>>();
  readonly selectedSlotId = model<string | null>(null);
  readonly newSlotOpen = model(false);
  readonly failed = output<void>();
  readonly focusRequested = output<string>();

  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly showSlotHistory = signal(false);
  readonly dirtySlotIds = signal<ReadonlySet<string>>(new Set());
  readonly slotEdits = signal<Record<string, PublicationSlotEdit>>({});
  readonly slotActionState = signal<string | null>(null);
  readonly newSlotFeedTarget = signal<SponsorFeedTarget>('openg7');
  readonly newSlotChannel = signal<SponsorFeedChannel>('facebook');
  readonly newSlotStartsAt = signal('');
  readonly newSlotTimezone = signal('America/Toronto');
  readonly newSlotCapacity = signal('5');
  readonly newSlotNotes = signal('');
  readonly slotBatchSelections = signal<Record<string, string>>({});
  readonly slotDraftSelections = signal<Record<string, string>>({});

  readonly selectedSlot = computed(
    () => this.slots().find((slot) => slot.id === this.selectedSlotId()) ?? null
  );
  readonly visibleSlots = computed(() =>
    this.slots().filter(
      (slot) =>
        this.showSlotHistory() ||
        slot.status === 'open' ||
        slot.status === 'scheduled' ||
        slot.id === this.selectedSlotId()
    )
  );
  readonly slotCalendarEntries = computed<readonly PublicationCalendarEntry[]>(
    () =>
      this.visibleSlots().map((slot) => ({
        id: slot.id,
        channel: slot.channel,
        status: slot.status,
        startsAt: slot.startsAt,
        capacity: slot.capacity,
        capacityUsed: slot.capacityUsed,
        target: this.feedTargetName(slot.feedTarget)
      }))
  );

  constructor() {
    effect(() => {
      const slots = this.slots();
      untracked(() => {
        const previous = this.slotEdits();
        const dirty = this.dirtySlotIds();
        const next: Record<string, PublicationSlotEdit> = {};
        for (const id of dirty) {
          if (previous[id]) next[id] = previous[id];
        }
        for (const slot of slots) {
          next[slot.id] = dirty.has(slot.id)
            ? (previous[slot.id] ?? this.toSlotEdit(slot))
            : this.toSlotEdit(slot);
        }
        this.slotEdits.set(next);
      });
    });
  }

  async createSlot(): Promise<void> {
    if (this.slotActionState()) return;
    const capacity = Number.parseInt(this.newSlotCapacity(), 10);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 50 ||
      !this.newSlotStartsAt()
    ) {
      this.failed.emit();
      return;
    }

    const notes = this.newSlotNotes();
    this.slotActionState.set('create');
    try {
      const result = await this.admin.createPublicationSlot(this.adminToken(), {
        feedTarget: this.newSlotFeedTarget(),
        channel: this.newSlotChannel(),
        startsAt: new Date(this.newSlotStartsAt()).toISOString(),
        timezone: this.newSlotTimezone().trim() || 'America/Toronto',
        capacity,
        notes
      });
      if (this.newSlotNotes() === notes) this.newSlotNotes.set('');
      this.newSlotOpen.set(false);
      this.selectedSlotId.set(result.slot?.id ?? null);
      await this.reload()();
      if (result.slot) this.focusRequested.emit(result.slot.id);
    } catch {
      this.failed.emit();
    } finally {
      this.slotActionState.set(null);
    }
  }

  async updateSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    if (this.slotActionState()) return;
    const edit = this.slotEditFor(slot.id);
    const capacity = Number.parseInt(edit.capacity, 10);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 50 ||
      !edit.startsAt
    ) {
      this.failed.emit();
      return;
    }

    this.slotActionState.set(slot.id);
    try {
      const result = await this.admin.updatePublicationSlot(this.adminToken(), {
        slotId: slot.id,
        startsAt: new Date(edit.startsAt).toISOString(),
        timezone: edit.timezone.trim() || 'America/Toronto',
        capacity,
        notes: edit.notes
      });
      if (!result.updated) throw new Error('Slot was not saved.');
      if (this.slotEdits()[slot.id] === edit)
        this.dirtySlotIds.update((ids) => {
          const next = new Set(ids);
          next.delete(slot.id);
          return next;
        });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.slotActionState.set(null);
    }
  }

  async assignBatchToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    if (this.slotActionState() || !this.hasAssignableBatchSelection(slot))
      return;
    const batchId = this.slotBatchSelection(slot.id);
    this.slotActionState.set(slot.id);
    try {
      await this.admin.assignBatchToPublicationSlot(this.adminToken(), {
        slotId: slot.id,
        batchId
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.slotActionState.set(null);
    }
  }

  async assignDraftToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    if (this.slotActionState() || !this.hasAssignableDraftSelection(slot))
      return;
    const draftId = this.slotDraftSelection(slot.id);
    this.slotActionState.set(slot.id);
    try {
      await this.admin.assignDraftToPublicationSlot(this.adminToken(), {
        slotId: slot.id,
        draftId
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.slotActionState.set(null);
    }
  }

  async publishSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    if (this.slotActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.publish'),
        slot.id
      ))
    )
      return;
    this.slotActionState.set(slot.id);
    try {
      await this.admin.publishPublicationSlot(this.adminToken(), {
        slotId: slot.id
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.slotActionState.set(null);
    }
  }

  async cancelSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    if (this.slotActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.cancelPublication'),
        slot.id
      ))
    )
      return;
    this.slotActionState.set(slot.id);
    try {
      await this.admin.cancelPublicationSlot(this.adminToken(), {
        slotId: slot.id
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.slotActionState.set(null);
    }
  }

  setNewSlotFeedTarget(event: Event): void {
    const value = publicationValueFromEvent(event);
    this.newSlotFeedTarget.set(value === 'openg20' ? 'openg20' : 'openg7');
  }

  setNewSlotChannel(event: Event): void {
    const value = publicationValueFromEvent(event);
    this.newSlotChannel.set(value === 'linkedin' ? 'linkedin' : 'facebook');
  }

  setNewSlotStartsAt(event: Event): void {
    this.newSlotStartsAt.set(publicationValueFromEvent(event));
  }

  setNewSlotTimezone(event: Event): void {
    this.newSlotTimezone.set(publicationValueFromEvent(event));
  }

  setNewSlotCapacity(event: Event): void {
    this.newSlotCapacity.set(publicationValueFromEvent(event));
  }

  setNewSlotNotes(event: Event): void {
    this.newSlotNotes.set(publicationValueFromEvent(event));
  }

  slotEditFor(slotId: string): PublicationSlotEdit {
    return this.slotEdits()[slotId] ?? this.emptySlotEdit();
  }

  setSlotEditField(
    slotId: string,
    field: keyof PublicationSlotEdit,
    event: Event
  ): void {
    this.dirtySlotIds.update((ids) => new Set([...ids, slotId]));
    const value = publicationValueFromEvent(event);
    this.slotEdits.update((edits) => ({
      ...edits,
      [slotId]: {
        ...(edits[slotId] ?? this.emptySlotEdit()),
        [field]: value
      }
    }));
  }

  slotBatchSelection(slotId: string): string {
    return this.slotBatchSelections()[slotId] ?? '';
  }

  setSlotBatchSelection(slotId: string, event: Event): void {
    const value = publicationValueFromEvent(event);
    this.slotBatchSelections.update((selections) => ({
      ...selections,
      [slotId]: value
    }));
  }

  slotDraftSelection(slotId: string): string {
    return this.slotDraftSelections()[slotId] ?? '';
  }

  setSlotDraftSelection(slotId: string, event: Event): void {
    const value = publicationValueFromEvent(event);
    this.slotDraftSelections.update((selections) => ({
      ...selections,
      [slotId]: value
    }));
  }

  assignableBatchesForSlot(
    slot: AdminPublicationSlotRecord
  ): readonly AdminPublicationBatchRecord[] {
    return this.batches().filter(
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
    return this.drafts().filter(
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
    const id = this.slotBatchSelection(slot.id);
    return this.assignableBatchesForSlot(slot).some((batch) => batch.id === id);
  }

  hasAssignableDraftSelection(slot: AdminPublicationSlotRecord): boolean {
    const id = this.slotDraftSelection(slot.id);
    return this.assignableDraftsForSlot(slot).some((draft) => draft.id === id);
  }

  slotStatusLabel(status: PublicationSlotStatus): string {
    return publicationBatchStatusLabel(this.i18n, status);
  }

  channelLabel(channel: SponsorFeedChannel): string {
    return publicationChannelLabel(this.i18n, channel);
  }

  feedTargetName(target: SponsorFeedTarget): string {
    return publicationFeedTargetName(target);
  }

  dateLabel(value: string | null, timezone = 'America/Toronto'): string {
    return publicationDateLabel(this.i18n, value, timezone);
  }

  private toSlotEdit(slot: AdminPublicationSlotRecord): PublicationSlotEdit {
    return {
      startsAt: publicationDateTimeLocal(slot.startsAt),
      timezone: slot.timezone,
      capacity: String(slot.capacity),
      notes: slot.notes ?? ''
    };
  }

  private emptySlotEdit(): PublicationSlotEdit {
    return {
      startsAt: '',
      timezone: 'America/Toronto',
      capacity: '5',
      notes: ''
    };
  }

  private batchDraftsMatchSlot(
    batch: AdminPublicationBatchRecord,
    slot: AdminPublicationSlotRecord
  ): boolean {
    const assignedDrafts = this.drafts().filter(
      (draft) => draft.batch_id === batch.id
    );
    return assignedDrafts.every(
      (draft) => draft.feed_target === slot.feedTarget
    );
  }
}
