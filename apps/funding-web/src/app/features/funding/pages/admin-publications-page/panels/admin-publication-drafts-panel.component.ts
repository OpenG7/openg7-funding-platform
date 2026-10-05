import { CommonModule, DOCUMENT } from '@angular/common';
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
  AdminSponsorshipRecord,
  PublicationBatchStatus,
  PublicationDraftStatus,
  SponsorFeedChannel
} from '@openg7/funding-core';

import { AdminConfirmationService } from '../../../services/admin-confirmation.service.js';
import { FundingAdminService } from '../../../services/funding-admin.service.js';
import { FundingI18nService } from '../../../services/funding-i18n.service.js';
import type { PublicationLoadState } from '../publication-panels.contracts.js';
import {
  publicationBatchStatusLabel,
  publicationChannelLabel,
  publicationFeedTargetName,
  publicationValueFromEvent
} from '../publication-panels.helpers.js';

import { AdminPublicationDraftsWorkflow } from './admin-publication-drafts-workflow.js';
import type { PublicationDraftEdit } from './admin-publication-drafts-workflow.js';

const publicationStatuses: readonly PublicationDraftStatus[] = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'cancelled'
];

/** Funding organism: draft preparation and editing over the page's shared data. */
@Component({
  selector: 'openg7-admin-publication-drafts-panel',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-drafts-panel.component.html',
  styleUrls: [
    '../../../components/admin-ui/admin-theme.css',
    '../../../components/admin-ui/admin-controls.css',
    '../../../components/admin-ui/admin-forms.css',
    '../admin-publications-panels.css'
  ]
})
export class AdminPublicationDraftsPanelComponent {
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);

  readonly active = input.required<boolean>();
  readonly state = input.required<PublicationLoadState>();
  readonly adminToken = input.required<string>();
  readonly drafts = input.required<readonly AdminPublicationDraftRecord[]>();
  readonly sponsorships = input.required<readonly AdminSponsorshipRecord[]>();
  readonly batches = input.required<readonly AdminPublicationBatchRecord[]>();
  readonly reload = input.required<() => Promise<void>>();
  readonly draftTargetId = input<string | null>(null);
  readonly selectedDraftId = model<string | null>(null);
  readonly showEligible = model(false);
  readonly failed = output<void>();
  readonly notice = output<string>();
  readonly focusRequested = output<string>();
  readonly batchRequested = output<string>();

  readonly publicationStatuses = publicationStatuses;
  readonly draftEdits = signal<Record<string, PublicationDraftEdit>>({});
  readonly dirtyDraftIds = signal<ReadonlySet<string>>(new Set());
  readonly actionState = signal<string | null>(null);
  readonly dateTimeError = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal<'active' | 'all' | PublicationDraftStatus>(
    'active'
  );
  readonly draftBatchSelections = signal<Record<string, string>>({});

  private readonly workflow = new AdminPublicationDraftsWorkflow({
    api: this.admin,
    state: {
      actionState: this.actionState,
      draftEdits: this.draftEdits,
      dirtyDraftIds: this.dirtyDraftIds,
      showEligible: this.showEligible,
      selectedDraftId: this.selectedDraftId,
      statusFilter: this.statusFilter
    },
    token: () => this.adminToken(),
    reload: () => this.reload()(),
    confirm: (action, target) =>
      this.confirmation.confirm(
        this.i18n.t(
          action === 'refuse'
            ? 'admin.confirmation.refuse'
            : 'admin.confirmation.publish'
        ),
        target
      ),
    failed: () => this.failed.emit(),
    invalidDateTime: () => this.dateTimeError.set(true),
    notice: (key) => this.notice.emit(key),
    focusRequested: (id) => this.focusRequested.emit(id),
    batchSelection: (id) => this.draftBatchSelection(id)
  });

  readonly eligibleSponsorships = computed(() =>
    this.sponsorships().filter(
      (sponsorship) =>
        sponsorship.sponsor_review_status === 'approved' &&
        sponsorship.public_display_consent &&
        Boolean(sponsorship.sponsor_feed_target) &&
        sponsorship.sponsor_feed_channels.length > 0
    )
  );
  readonly filteredDrafts = computed(() => {
    const search = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.drafts().filter((draft) => {
      const searchable = [
        draft.sponsor_company_name,
        draft.title,
        draft.body,
        draft.feed_target,
        draft.channel
      ]
        .join(' ')
        .toLowerCase();
      return (
        (!search || searchable.includes(search)) &&
        (status === 'all' ||
          (status === 'active' &&
            draft.status !== 'published' &&
            draft.status !== 'cancelled') ||
          draft.status === status ||
          draft.id === this.selectedDraftId())
      );
    });
  });

  constructor() {
    effect(() => {
      const drafts = this.drafts();
      untracked(() => this.workflow.reconcileDrafts(drafts));
    });
    effect(() => {
      if (this.draftTargetId()) {
        this.search.set('');
        this.statusFilter.set('all');
      }
    });
  }

  closePreparation(): void {
    this.showEligible.set(false);
    this.document.getElementById('publication-prepare')?.focus();
  }

  createDraft(
    sponsorship: AdminSponsorshipRecord,
    channel: SponsorFeedChannel
  ): Promise<void> {
    return this.workflow.createDraft(sponsorship, channel);
  }

  saveDraft(
    draft: AdminPublicationDraftRecord,
    status?: PublicationDraftStatus
  ): Promise<void> {
    this.dateTimeError.set(false);
    return this.workflow.saveDraft(draft, status);
  }

  async copyDraft(draft: AdminPublicationDraftRecord): Promise<void> {
    const edit = this.editFor(draft.id);
    const text = [edit.title, edit.body, edit.disclosureText]
      .filter(Boolean)
      .join('\n\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        this.notice.emit('admin.publications.copied');
      } catch {
        this.notice.emit('admin.publications.copyFailed');
      }
    }
  }

  assignToBatch(draft: AdminPublicationDraftRecord): Promise<void> {
    return this.workflow.assignToBatch(draft);
  }

  unassignFromBatch(draft: AdminPublicationDraftRecord): Promise<void> {
    return this.workflow.unassignFromBatch(draft);
  }

  setSearch(event: Event): void {
    this.search.set(publicationValueFromEvent(event));
  }

  setStatusFilter(event: Event): void {
    const value = publicationValueFromEvent(event);
    this.selectedDraftId.set(null);
    this.statusFilter.set(
      value === 'active'
        ? 'active'
        : publicationStatuses.includes(value as PublicationDraftStatus)
          ? (value as PublicationDraftStatus)
          : 'all'
    );
  }

  draftBatchSelection(draftId: string): string {
    return this.draftBatchSelections()[draftId] ?? '';
  }

  setDraftBatchSelection(draftId: string, event: Event): void {
    const value = publicationValueFromEvent(event);
    this.draftBatchSelections.update((selections) => ({
      ...selections,
      [draftId]: value
    }));
  }

  openBatchesForChannel(
    channel: SponsorFeedChannel
  ): readonly AdminPublicationBatchRecord[] {
    return this.batches().filter(
      (batch) => batch.channel === channel && batch.status === 'open'
    );
  }

  batchStatusById(batchId: string): PublicationBatchStatus | null {
    return this.batches().find((batch) => batch.id === batchId)?.status ?? null;
  }

  setEditField(
    draftId: string,
    field: keyof PublicationDraftEdit,
    event: Event
  ): void {
    this.dirtyDraftIds.update((ids) => new Set([...ids, draftId]));
    const value = publicationValueFromEvent(event);
    this.draftEdits.update((edits) => ({
      ...edits,
      [draftId]: {
        ...(edits[draftId] ?? this.workflow.emptyEdit()),
        [field]: value
      }
    }));
  }

  editFor(draftId: string): PublicationDraftEdit {
    return this.workflow.editFor(draftId);
  }

  trackBySponsor(_: number, sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.id;
  }

  trackByDraft(_: number, draft: AdminPublicationDraftRecord): string {
    return draft.id;
  }

  channelLabel(channel: SponsorFeedChannel): string {
    return publicationChannelLabel(this.i18n, channel);
  }

  feedTargetLabel(sponsorship: AdminSponsorshipRecord): string {
    return publicationFeedTargetName(
      sponsorship.sponsor_feed_target ?? 'openg7'
    );
  }

  batchStatusLabel(status: PublicationBatchStatus | null): string {
    return publicationBatchStatusLabel(this.i18n, status);
  }

  statusLabel(status: PublicationDraftStatus): string {
    const labels: Record<PublicationDraftStatus, string> = {
      draft: this.i18n.t('admin.legacy.brouillon'),
      pending_review: this.i18n.t('admin.legacy.a_approuver'),
      approved: this.i18n.t('admin.messages.approuvee'),
      scheduled: this.i18n.t('admin.messages.planifiee'),
      published: this.i18n.t('admin.legacy.publiee'),
      rejected: this.i18n.t('admin.messages.refusee'),
      cancelled: this.i18n.t('admin.messages.annulee')
    };
    return labels[status];
  }
}
