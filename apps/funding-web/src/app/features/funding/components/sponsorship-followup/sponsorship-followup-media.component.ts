import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  type SimpleChanges,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  afterRenderEffect,
  viewChild,
  viewChildren
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaTermsAcceptance
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingService } from '../../services/funding.service.js';
import { SponsorshipMediaUsageController } from '../../services/sponsorship-media-usage-controller.js';
import { SponsorMediaUsageEditorComponent } from '../sponsor-media-usage/sponsor-media-usage-editor.component.js';
import {
  SponsorshipFollowupMediaController,
  type SponsorshipMediaUploadAttempt
} from '../../services/sponsorship-followup-media-controller.js';

@Component({
  selector: 'openg7-sponsorship-followup-media',
  standalone: true,
  imports: [CommonModule, TranslatePipe, SponsorMediaUsageEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-media.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipFollowupMediaComponent implements OnInit, OnChanges {
  readonly token = input.required<string>();
  readonly canUploadMedia = input(false);
  readonly mediaConsentRequested = input(false);
  readonly refreshKey = input(0);
  readonly busyChange = output<boolean>();
  readonly i18n = inject(FundingI18nService);
  private readonly service = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  readonly uploadUsage = signal<
    import('@openg7/funding-core').SponsorMediaUsageRights | null
  >(null);
  readonly uploadAcceptance = signal<SponsorMediaTermsAcceptance | null>(null);
  readonly selectedUpload = signal<{
    kind: SponsorMediaKind;
    files: readonly File[];
  } | null>(null);
  private readonly controller = new SponsorshipFollowupMediaController({
    service: this.service,
    token: () => this.token(),
    canUploadMedia: () => this.canUploadMedia(),
    isBrowser: () => isPlatformBrowser(this.platformId),
    busyChange: (value) =>
      this.busyChange.emit(value || this.usageController.busy()),
    confirmDelete: () =>
      window.confirm(this.i18n.t('funding.followup.media.deleteConfirm'))
  });
  readonly assets = this.controller.assets;
  readonly attempts = this.controller.attempts;
  readonly hasUnresolvedUpload = this.controller.hasUnresolvedUpload;
  readonly previews = this.controller.previews;
  readonly limits = this.controller.limits;
  readonly usageController = new SponsorshipMediaUsageController({
    service: this.service,
    token: () => this.token(),
    assets: () => this.assets(),
    preference: () => this.controller.preference(),
    isBrowser: () => isPlatformBrowser(this.platformId),
    refresh: () => this.controller.refresh(),
    busyChange: (busy) => this.busyChange.emit(busy || this.controller.busy()),
    confirmWithdrawal: () =>
      window.confirm(
        this.i18n.t('funding.followup.media.usage.withdrawConfirm')
      )
  });
  readonly preference = this.controller.preference;
  readonly busy = computed(
    () => this.controller.busy() || this.usageController.busy()
  );
  readonly loadError = this.controller.loadError;
  readonly loaded = this.controller.loaded;
  readonly message = this.controller.message;
  readonly altText = this.controller.altText;
  readonly hasActiveLogo = this.controller.hasActiveLogo;
  readonly hasApprovedLogo = this.controller.hasApprovedLogo;
  readonly photoCount = this.controller.photoCount;
  readonly canAddSupportingImage = this.controller.canAddSupportingImage;
  private readonly mediaSection =
    viewChild<ElementRef<HTMLElement>>('mediaSection');
  private readonly mediaRights =
    viewChildren<ElementRef<HTMLDetailsElement>>('mediaRights');
  private focusedMediaConsentToken: string | null = null;
  private readonly refreshPending = signal(false);

  constructor() {
    effect(() => {
      if (!this.refreshPending() || this.busy()) return;
      this.refreshPending.set(false);
      untracked(() => void this.refresh());
    });
    afterRenderEffect(() => {
      if (
        !isPlatformBrowser(this.platformId) ||
        !this.mediaConsentRequested() ||
        !this.loaded() ||
        this.loadError() ||
        this.busy()
      )
        return;
      const token = this.token();
      const section = this.mediaSection()?.nativeElement;
      const rights = this.mediaRights();
      if (
        this.focusedMediaConsentToken === token ||
        !section ||
        rights.length !== this.assets().length
      )
        return;
      this.focusedMediaConsentToken = token;
      for (const panel of rights) panel.nativeElement.open = true;
      section.focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start' });
    });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.controller.dispose();
      this.usageController.dispose();
    });
    void this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const tokenChanged = changes['token'] && !changes['token'].firstChange;
    if (tokenChanged) {
      this.refreshPending.set(false);
      this.usageController.reset();
      this.uploadUsage.set(null);
      this.uploadAcceptance.set(null);
      this.selectedUpload.set(null);
      void this.refresh();
    } else if (changes['refreshKey'] && !changes['refreshKey'].firstChange)
      this.refreshPending.set(true);
  }

  refresh(): Promise<void> {
    return this.controller.refresh();
  }

  selectMedia(kind: SponsorMediaKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || this.busy() || this.hasUnresolvedUpload()) return;
    this.uploadUsage.set(null);
    this.uploadAcceptance.set(null);
    this.selectedUpload.set({ kind, files });
  }

  async sendMedia(): Promise<void> {
    const selected = this.selectedUpload();
    const usage = this.uploadUsage();
    const acceptance = this.uploadAcceptance();
    if (
      !selected ||
      !usage ||
      !acceptance ||
      !this.canUploadMedia() ||
      this.busy() ||
      !this.loaded() ||
      this.loadError() ||
      (selected.kind === 'logo' && this.hasApprovedLogo()) ||
      this.hasUnresolvedUpload()
    )
      return;
    try {
      await this.controller.uploadMedia(
        selected.kind,
        selected.files,
        usage,
        acceptance
      );
    } finally {
      this.cancelSelection();
    }
  }

  cancelSelection(): void {
    this.selectedUpload.set(null);
    this.uploadUsage.set(null);
    this.uploadAcceptance.set(null);
  }

  retryUpload(attempt: SponsorshipMediaUploadAttempt): Promise<void> {
    return this.controller.retryUpload(attempt);
  }

  deleteMedia(asset: SponsorMediaAsset): Promise<boolean> {
    return this.controller.deleteMedia(asset);
  }

  dismiss(attempt: SponsorshipMediaUploadAttempt): Promise<void> {
    return this.controller.dismiss(attempt);
  }

  setAltText(event: Event): void {
    this.controller.setAltText((event.target as HTMLInputElement).value);
  }

  size(bytes: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      maximumFractionDigits: 1
    }).format(bytes / (1024 * 1024));
  }
}
