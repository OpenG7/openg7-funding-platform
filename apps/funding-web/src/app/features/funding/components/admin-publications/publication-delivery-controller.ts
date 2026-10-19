import {
  computed,
  signal,
  type Signal,
  type WritableSignal
} from '@angular/core';
import type {
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId,
  PublicationPhotoSelection,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import type { FundingI18nService } from '../../services/funding-i18n.service.js';
import type { FundingModerationService } from '../../services/funding-moderation.service.js';

import type {
  PublicationAutomationCommandRunner,
  PublicationAutomationMedia
} from './publication-automation.ports.js';
import { PublicationDeliveryMediaController } from './publication-delivery-media-controller.js';

export interface PublicationDeliveryPorts {
  refresh(): Promise<boolean>;
  moderate: FundingModerationService['requestDecision'];
  readonly state: Signal<PublicationAutomationState | null>;
  readonly busy: Signal<boolean>;
  readonly error: Signal<string>;
  readonly commands: PublicationAutomationCommandRunner;
  readonly admin: Pick<
    FundingAdminService,
    | 'publicationMedia'
    | 'publicationImagePreview'
    | 'getSponsorMediaPreview'
    | 'getSavedAdminToken'
  >;
  readonly i18n: Pick<FundingI18nService, 't' | 'currentLanguage'>;
  confirm(message: string, title: string): Promise<boolean>;
  showError(error: unknown): void;
  clearError(): void;
}

/** Local delivery review and drafts; the page owns loading and lifecycle cleanup. */
export class PublicationDeliveryController {
  async refreshModeration(): Promise<void> {
    await this.ports.refresh();
  }
  readonly selected = signal<PublicationDelivery | null>(null);
  readonly composing = signal(false);
  readonly editing = signal(false);
  readonly media: WritableSignal<PublicationAutomationMedia[]>;
  private readonly mediaController: PublicationDeliveryMediaController;
  readonly previewUrl: Signal<string>;
  readonly previewExact: WritableSignal<boolean>;
  readonly collectionPreviews: Signal<readonly { url: string; alt: string }[]>;
  readonly pendingSponsors = computed(() =>
    (this.selected()?.sponsors ?? []).filter(
      (sponsor) => sponsor.reviewStatus === 'pending_review'
    )
  );
  readonly missingPresentation = computed(() =>
    this.pendingSponsors().some((sponsor) => !sponsor.presentationApproved)
  );
  readonly kinds: PublicationDelivery['kind'][] = [
    'news',
    'achievement',
    'campaign'
  ];
  readonly state: PublicationDeliveryPorts['state'];
  readonly busy: PublicationDeliveryPorts['busy'];
  readonly error: PublicationDeliveryPorts['error'];
  edit: {
    message: string;
    scheduledAt: string;
    mediaId: string;
    publicationFormat: SponsorshipPublicationFormat;
    photoSelections: readonly PublicationPhotoSelection[];
  } = {
    message: '',
    scheduledAt: '',
    mediaId: '',
    publicationFormat: 'collective_text',
    photoSelections: []
  };
  readonly formats: readonly SponsorshipPublicationFormat[];
  composeFeed: PublicationFeedId = 'openg7:facebook';
  composeKind: PublicationDelivery['kind'] = 'news';
  approved = false;
  externalPostId = '';
  absenceReason = '';
  absenceChecked = false;
  browserTimezone = '';
  private generation = 0;
  private disposed = false;
  private readonly visibilityRequests = new Map<string, string>();
  private readonly activeVisibility = new Set<string>();

  constructor(private readonly ports: PublicationDeliveryPorts) {
    this.state = ports.state;
    this.busy = ports.busy;
    this.error = ports.error;
    this.mediaController = new PublicationDeliveryMediaController({
      admin: ports.admin,
      selected: this.selected,
      edit: () => this.edit,
      composeFeed: () => this.composeFeed,
      generation: () => this.generation,
      isDisposed: () => this.disposed,
      selectionChanged: () => {
        this.approved = false;
      },
      showError: (error) => this.ports.showError(error)
    });
    this.media = this.mediaController.media;
    this.previewUrl = this.mediaController.previewUrl;
    this.previewExact = this.mediaController.previewExact;
    this.collectionPreviews = this.mediaController.collectionPreviews;
    this.formats = this.mediaController.formats;
  }

  open(job: PublicationDelivery): void {
    if (this.disposed) return;
    this.generation++;
    this.absenceChecked = false;
    this.absenceReason = '';
    this.selected.set(job);
    this.editing.set(false);
    this.composing.set(false);
    this.approved = false;
    this.externalPostId = '';
    this.edit = {
      message: job.message,
      scheduledAt: this.localDate(job.scheduledAt),
      mediaId: this.derived(job.publicationFormat) ? '' : (job.mediaId ?? ''),
      publicationFormat: job.publicationFormat ?? 'collective_text',
      photoSelections: structuredClone(job.photoSelections ?? [])
    };
    if (this.mediaBlocked(job)) this.clearPreview();
    else void this.loadPreview(job.mediaId ?? '');
    void this.loadMedia(job.id);
  }

  create(): void {
    if (this.disposed) return;
    this.clear();
    this.composing.set(true);
    this.editing.set(true);
    this.edit = {
      message: '',
      scheduledAt: this.localDate(
        new Date(Date.now() + 86400000).toISOString()
      ),
      mediaId: '',
      publicationFormat: 'collective_text',
      photoSelections: []
    };
    void this.loadMedia();
  }

  close(): void {
    this.clear();
    this.ports.clearError();
  }

  clear(): void {
    this.generation++;
    this.mediaController.clear();
    this.selected.set(null);
    this.composing.set(false);
    this.editing.set(false);
    this.approved = false;
    this.externalPostId = '';
    this.absenceChecked = false;
    this.absenceReason = '';
  }

  clearPreview(): void {
    this.mediaController.clearPreview();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.mediaController.dispose();
  }

  mediaBlocked(job: PublicationDelivery): boolean {
    return this.mediaController.mediaBlocked(job);
  }

  loadMedia(
    deliveryId: string | undefined = this.selected()?.id
  ): Promise<void> {
    return this.mediaController.loadMedia(deliveryId);
  }

  loadPreview(id: string): Promise<void> {
    return this.mediaController.loadPreview(id);
  }

  mediaPreview(): { url: string; alt: string } | undefined {
    return this.mediaController.mediaPreview();
  }

  editable(): boolean {
    return (
      this.composing() ||
      ['draft', 'approved', 'blocked'].includes(this.selected()?.status ?? '')
    );
  }

  dirty(): boolean {
    const selected = this.selected();
    return (
      !!selected &&
      (this.edit.message !== selected.message ||
        this.edit.scheduledAt !== this.localDate(selected.scheduledAt) ||
        this.edit.mediaId !==
          (this.derived(selected.publicationFormat)
            ? ''
            : (selected.mediaId ?? '')) ||
        this.edit.publicationFormat !==
          (selected.publicationFormat ?? 'collective_text') ||
        JSON.stringify(this.edit.photoSelections) !==
          JSON.stringify(selected.photoSelections ?? []))
    );
  }

  mediaSelectionValid(): boolean {
    return this.mediaController.mediaSelectionValid();
  }

  changeEdit(
    field: 'message' | 'scheduledAt' | 'mediaId',
    value: string
  ): void {
    this.approved = false;
    this.edit[field] = value;
    if (field === 'mediaId') {
      if (this.mediaSelectionValid()) void this.loadPreview(value);
      else this.clearPreview();
    }
  }

  async save(): Promise<void> {
    if (
      this.disposed ||
      this.busy() ||
      !this.editable() ||
      !this.mediaSelectionValid()
    )
      return;
    const timestamp = new Date(this.edit.scheduledAt);
    if (!Number.isFinite(timestamp.getTime())) return;
    if (this.composing())
      await this.ports.commands.run(
        {
          action: 'compose',
          feedId: this.composeFeed,
          kind: this.composeKind,
          message: this.edit.message,
          scheduledAt: timestamp.toISOString(),
          mediaId: this.edit.mediaId || null
        },
        true
      );
    else {
      const selected = this.selected();
      if (selected)
        await this.ports.commands.run({
          action: 'edit',
          id: selected.id,
          version: selected.version,
          message: this.edit.message,
          scheduledAt: timestamp.toISOString(),
          mediaId: this.edit.mediaId || null,
          ...(selected.publicationFormat ||
          this.derived(this.edit.publicationFormat)
            ? {
                publicationFormat: this.edit.publicationFormat,
                photoSelections: this.edit.photoSelections
              }
            : {})
        });
    }
  }

  async approve(): Promise<void> {
    const selected = this.selected();
    const generation = this.generation;
    if (
      !this.disposed &&
      !this.busy() &&
      selected?.status === 'draft' &&
      this.approved &&
      !this.dirty() &&
      !this.missingPresentation() &&
      ((!selected.mediaId && !this.derived(selected.publicationFormat)) ||
        ((selected.publicationFormat === 'image_collection'
          ? this.collectionPreviews().length === selected.mediaImages?.length &&
            this.collectionPreviews().length >= 2
          : !!this.previewUrl()) &&
          this.previewExact()))
    ) {
      const approveSponsors: {
        id: string;
        version: string;
        moderationDecision: import('@openg7/funding-core').ModerationDecisionInput;
      }[] = [];
      for (const sponsor of this.pendingSponsors()) {
        const decision = await this.ports.moderate(
          { type: 'sponsorship', id: sponsor.id },
          'N0'
        );
        if (
          !decision ||
          !this.currentSelection(selected, generation) ||
          this.busy()
        )
          return;
        approveSponsors.push({
          id: sponsor.id,
          version: sponsor.version,
          moderationDecision: decision
        });
      }
      const moderationDecision = await this.ports.moderate(
        { type: 'publication_delivery', id: selected.id },
        'N0'
      );
      if (
        !moderationDecision ||
        !this.currentSelection(selected, generation) ||
        this.busy() ||
        this.dirty()
      )
        return;
      await this.ports.commands.run({
        action: 'approve',
        id: selected.id,
        version: selected.version,
        confirmation: selected.id,
        moderationDecision,
        ...(approveSponsors.length
          ? {
              approveSponsors
            }
          : {})
      });
    }
  }

  async reject(): Promise<void> {
    const selected = this.selected();
    const generation = this.generation;
    if (
      !selected ||
      this.disposed ||
      this.busy() ||
      !this.editable() ||
      !this.currentSelection(selected, generation)
    )
      return;
    const moderationDecision = await this.ports.moderate(
      { type: 'publication_delivery', id: selected.id },
      'N3'
    );
    if (
      !moderationDecision ||
      !this.currentSelection(selected, generation) ||
      this.busy()
    )
      return;
    await this.ports.commands.run({
      action: 'reject',
      id: selected.id,
      version: selected.version,
      confirmation: selected.id,
      moderationDecision
    });
  }

  async cancel(): Promise<void> {
    const selected = this.selected();
    const generation = this.generation;
    if (
      selected?.status !== 'approved' ||
      this.disposed ||
      this.busy() ||
      !(await this.ports.confirm(
        this.ports.i18n.t('admin.publicationAutomation.cancelConfirm'),
        selected.feedId
      )) ||
      !this.currentSelection(selected, generation)
    )
      return;
    await this.ports.commands.run({
      action: 'cancel',
      id: selected.id,
      version: selected.version,
      confirmation: selected.id
    });
  }

  reconcile(): void {
    const selected = this.selected();
    if (
      !this.disposed &&
      !this.busy() &&
      selected?.status === 'uncertain' &&
      !selected.mediaId &&
      this.externalPostId.trim()
    )
      void this.ports.commands.run({
        action: 'reconcile',
        id: selected.id,
        version: selected.version,
        confirmation: selected.id,
        externalPostId: this.externalPostId
      });
  }

  confirmAbsent(): void {
    const selected = this.selected();
    if (
      !this.disposed &&
      !this.busy() &&
      selected &&
      (selected.status === 'uncertain' ||
        selected.accountRecoveryRequired === true) &&
      this.absenceChecked &&
      this.absenceReason.trim().length >= 20
    )
      void this.ports.commands.run({
        action: 'confirm-absent',
        id: selected.id,
        version: selected.version,
        confirmation: selected.id,
        reason: this.absenceReason
      });
  }
  derived(format: SponsorshipPublicationFormat | undefined): boolean {
    return this.mediaController.derived(format);
  }
  formatAvailable(format: SponsorshipPublicationFormat): boolean {
    return this.mediaController.formatAvailable(format);
  }
  changeFormat(value: string): void {
    this.mediaController.changeFormat(value);
  }
  photoOptions(contributionId: string): PublicationAutomationMedia[] {
    return this.mediaController.photoOptions(contributionId);
  }
  photoSelection(contributionId: string): string {
    return this.mediaController.photoSelection(contributionId);
  }
  selectPhoto(contributionId: string, assetId: string): void {
    this.mediaController.selectPhoto(contributionId, assetId);
  }

  async checkVisibility(): Promise<void> {
    const selected = this.selected();
    const generation = this.generation;
    if (
      !selected ||
      selected.status !== 'published' ||
      selected.mode !== 'live' ||
      !this.currentSelection(selected, generation)
    )
      return;
    const key = `${selected.id}:${selected.version}`;
    if (this.activeVisibility.has(key)) return;
    this.activeVisibility.add(key);
    try {
      if (
        !(await this.ports.confirm(
          this.ports.i18n.t(
            'admin.publicationAutomation.checkVisibilityConfirm'
          ),
          selected.feedId
        )) ||
        !this.currentSelection(selected, generation)
      )
        return;
      const requestId = this.visibilityRequests.get(key) ?? crypto.randomUUID();
      this.visibilityRequests.set(key, requestId);
      const confirmed = await this.ports.commands.run({
        action: 'check-visibility',
        id: selected.id,
        version: selected.version,
        confirmation: selected.id,
        requestId
      });
      // A confirmed refresh may reopen this drawer and advance its generation.
      if (confirmed) this.visibilityRequests.delete(key);
    } finally {
      this.activeVisibility.delete(key);
    }
  }

  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.ports.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : '';
  }

  private currentSelection(
    selected: PublicationDelivery,
    generation: number
  ): boolean {
    return (
      !this.disposed &&
      !this.busy() &&
      generation === this.generation &&
      this.selected()?.id === selected.id &&
      this.selected()?.version === selected.version
    );
  }

  private localDate(date: string): string {
    const value = new Date(date);
    return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
}
