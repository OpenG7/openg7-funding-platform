import { computed, signal, type Signal } from '@angular/core';
import type {
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId
} from '@openg7/funding-core';

import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';
import type { FundingI18nService } from '../../services/funding-i18n.service.js';

import type {
  PublicationAutomationCommandRunner,
  PublicationAutomationMedia
} from './publication-automation.ports.js';

export interface PublicationDeliveryPorts {
  readonly state: Signal<PublicationAutomationState | null>;
  readonly busy: Signal<boolean>;
  readonly error: Signal<string>;
  readonly commands: PublicationAutomationCommandRunner;
  readonly admin: Pick<
    FundingAdminService,
    'publicationMedia' | 'getSponsorMediaPreview' | 'getSavedAdminToken'
  >;
  readonly i18n: Pick<FundingI18nService, 't' | 'currentLanguage'>;
  confirm(message: string, title: string): Promise<boolean>;
  showError(error: unknown): void;
  clearError(): void;
}

/** Local delivery review and drafts; the page owns loading and lifecycle cleanup. */
export class PublicationDeliveryController {
  readonly selected = signal<PublicationDelivery | null>(null);
  readonly composing = signal(false);
  readonly editing = signal(false);
  readonly media = signal<PublicationAutomationMedia[]>([]);
  private readonly previewResource = new BlobPreviewResource();
  readonly previewUrl = this.previewResource.url;
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
  edit = { message: '', scheduledAt: '', mediaId: '' };
  composeFeed: PublicationFeedId = 'openg7:facebook';
  composeKind: PublicationDelivery['kind'] = 'news';
  approved = false;
  externalPostId = '';
  absenceReason = '';
  absenceChecked = false;
  browserTimezone = '';
  private generation = 0;
  private mediaGeneration = 0;
  private disposed = false;

  constructor(private readonly ports: PublicationDeliveryPorts) {
    this.state = ports.state;
    this.busy = ports.busy;
    this.error = ports.error;
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
      mediaId: job.mediaId ?? ''
    };
    if (this.mediaBlocked(job)) this.clearPreview();
    else void this.loadPreview(this.edit.mediaId);
    void this.loadMedia();
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
      mediaId: ''
    };
    void this.loadMedia();
  }

  close(): void {
    this.clear();
    this.ports.clearError();
  }

  clear(): void {
    this.generation++;
    this.mediaGeneration++;
    this.clearPreview();
    this.selected.set(null);
    this.composing.set(false);
    this.editing.set(false);
    this.approved = false;
    this.externalPostId = '';
    this.absenceChecked = false;
    this.absenceReason = '';
  }

  clearPreview(): void {
    this.previewResource.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.mediaGeneration++;
    this.previewResource.dispose();
  }

  mediaBlocked(job: PublicationDelivery): boolean {
    return (
      job.status === 'blocked' &&
      ['MEDIA_CHANGED', 'MEDIA_NOT_APPROVED', 'MEDIA_UNAVAILABLE'].includes(
        job.errorCode ?? ''
      )
    );
  }

  async loadMedia(): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    const mediaGeneration = ++this.mediaGeneration;
    try {
      const media = await this.ports.admin.publicationMedia();
      if (
        !this.disposed &&
        generation === this.generation &&
        mediaGeneration === this.mediaGeneration
      )
        this.media.set(media);
    } catch (error) {
      if (
        !this.disposed &&
        generation === this.generation &&
        mediaGeneration === this.mediaGeneration
      )
        this.ports.showError(error);
    }
  }

  async loadPreview(id: string): Promise<void> {
    await this.previewResource.load(
      id
        ? () =>
            this.ports.admin.getSponsorMediaPreview(
              this.ports.admin.getSavedAdminToken(),
              id
            )
        : null,
      (error) => this.ports.showError(error)
    );
  }

  mediaPreview(): { url: string; alt: string } | undefined {
    return this.previewUrl()
      ? {
          url: this.previewUrl(),
          alt:
            this.media().find((media) => media.id === this.edit.mediaId)?.alt ??
            this.selected()?.mediaAlt ??
            ''
        }
      : undefined;
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
        this.edit.mediaId !== (selected.mediaId ?? ''))
    );
  }

  changeEdit(
    field: 'message' | 'scheduledAt' | 'mediaId',
    value: string
  ): void {
    this.approved = false;
    this.edit[field] = value;
    if (field === 'mediaId') void this.loadPreview(value);
  }

  async save(): Promise<void> {
    if (this.disposed || this.busy() || !this.editable()) return;
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
          mediaId: this.edit.mediaId || null
        });
    }
  }

  async approve(): Promise<void> {
    const selected = this.selected();
    if (
      !this.disposed &&
      !this.busy() &&
      selected?.status === 'draft' &&
      this.approved &&
      !this.dirty() &&
      !this.missingPresentation() &&
      (!selected.mediaId || this.previewUrl())
    )
      await this.ports.commands.run({
        action: 'approve',
        id: selected.id,
        version: selected.version,
        confirmation: selected.id,
        ...(this.pendingSponsors().length
          ? {
              approveSponsors: this.pendingSponsors().map(
                ({ id, version }) => ({
                  id,
                  version
                })
              )
            }
          : {})
      });
  }

  async reject(): Promise<void> {
    const selected = this.selected();
    const generation = this.generation;
    if (
      !selected ||
      this.disposed ||
      this.busy() ||
      !this.editable() ||
      !(await this.ports.confirm(
        this.ports.i18n.t('admin.publicationAutomation.rejectConfirm'),
        selected.feedId
      )) ||
      !this.currentSelection(selected, generation)
    )
      return;
    await this.ports.commands.run({
      action: 'reject',
      id: selected.id,
      version: selected.version,
      confirmation: selected.id
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
      selected?.status === 'uncertain' &&
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
