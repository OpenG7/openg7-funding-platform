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
  publicationFeedTargetName,
  publicationValueFromEvent
} from '../publication-panels.helpers.js';

import {
  AdminPublicationSlotsWorkflow,
  type PublicationSlotEdit
} from './admin-publication-slots-workflow.js';

/** Funding organism: slot presentation, using the page's shared load. */
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

  private readonly workflow = new AdminPublicationSlotsWorkflow({
    api: this.admin,
    state: {
      slotActionState: this.slotActionState,
      slotEdits: this.slotEdits,
      dirtySlotIds: this.dirtySlotIds,
      newSlotFeedTarget: this.newSlotFeedTarget,
      newSlotChannel: this.newSlotChannel,
      newSlotStartsAt: this.newSlotStartsAt,
      newSlotTimezone: this.newSlotTimezone,
      newSlotCapacity: this.newSlotCapacity,
      newSlotNotes: this.newSlotNotes,
      newSlotOpen: this.newSlotOpen,
      selectedSlotId: this.selectedSlotId
    },
    token: () => this.adminToken(),
    reload: () => this.reload()(),
    confirm: (action, target) =>
      this.confirmation.confirm(
        this.i18n.t(`admin.confirmation.${action}`),
        target
      ),
    failed: () => this.failed.emit(),
    focusRequested: (id) => this.focusRequested.emit(id),
    batchSelection: (id) => this.slotBatchSelection(id),
    draftSelection: (id) => this.slotDraftSelection(id),
    batches: () => this.batches(),
    drafts: () => this.drafts()
  });

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
      untracked(() => this.workflow.reconcileSlots(slots));
    });
  }

  createSlot(): Promise<void> {
    return this.workflow.createSlot();
  }

  updateSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    return this.workflow.updateSlot(slot);
  }

  assignBatchToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    return this.workflow.assignBatchToSlot(slot);
  }

  assignDraftToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    return this.workflow.assignDraftToSlot(slot);
  }

  publishSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    return this.workflow.publishSlot(slot);
  }

  cancelSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    return this.workflow.cancelSlot(slot);
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
    return this.workflow.editFor(slotId);
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
        ...(edits[slotId] ?? this.workflow.emptyEdit()),
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
    return this.workflow.assignableBatchesForSlot(slot);
  }

  assignableDraftsForSlot(
    slot: AdminPublicationSlotRecord
  ): readonly AdminPublicationDraftRecord[] {
    return this.workflow.assignableDraftsForSlot(slot);
  }

  hasAssignableBatchSelection(slot: AdminPublicationSlotRecord): boolean {
    return this.workflow.hasAssignableBatchSelection(slot);
  }

  hasAssignableDraftSelection(slot: AdminPublicationSlotRecord): boolean {
    return this.workflow.hasAssignableDraftSelection(slot);
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
}
