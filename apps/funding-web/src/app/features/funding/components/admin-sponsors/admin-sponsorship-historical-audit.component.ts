import { NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorshipHistoricalAuditConclusion,
  SponsorshipHistoricalAuditFilter,
  SponsorshipHistoricalAuditItem
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminSponsorsQualityI18nService } from '../../services/admin-sponsors-quality-i18n.service.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';
import { revealControllerFocus } from '../admin-controller/admin-controller-navigation.js';

import { AdminSponsorshipHistoricalAuditController } from './admin-sponsorship-historical-audit-controller.js';

/** Funding organism: historical proof inventory and owner acknowledgement only. */
@Component({
  selector: 'openg7-admin-sponsorship-historical-audit',
  standalone: true,
  imports: [TranslatePipe, RouterLink, AdminIconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-historical-audit.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-historical-audit.component.css'
  ]
})
export class AdminSponsorshipHistoricalAuditComponent {
  readonly contributionId = input('');
  readonly scope = input<'dossier' | 'portfolio'>('dossier');
  readonly canOwn = input.required<boolean>();
  readonly labels = inject(AdminSponsorsQualityI18nService);
  private readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly reviewPanel =
    viewChild<ElementRef<HTMLElement>>('reviewPanel');
  private reviewReturnTarget: HTMLElement | null = null;
  private reviewNavigation = 0;
  readonly c = new AdminSponsorshipHistoricalAuditController({
    contributionId: () => this.contributionId(),
    scope: () => this.scope(),
    identity: () => this.identityKey(),
    canOwn: () => this.canOwn(),
    destroyed: () => this.destroy.destroyed,
    requestId: () => crypto.randomUUID(),
    preview: (query) => this.admin.historicalSponsorshipAudit(query),
    review: (input) => this.admin.reviewHistoricalSponsorshipEvidence(input),
    unauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly filters = [
    'duration_unverified',
    'required_element_missing',
    'snapshot_incomplete',
    'no_issue_detected'
  ] as const;
  readonly conclusions = [
    'confirmed',
    'follow_up_required',
    'inconclusive'
  ] as const;
  readonly busy = computed(() => this.c.saving() || !!this.c.pending());
  readonly selectedEvidenceId = computed(
    () => this.c.selected()?.evidenceId ?? this.c.pending()?.evidenceId ?? ''
  );
  readonly panelCurrentRecord = computed(() => {
    const selected = this.c.selected();
    if (!selected) return null;
    return (
      this.c
        .data()
        ?.items.find(
          (item) =>
            item.evidenceId === selected.evidenceId &&
            item.contributionId === selected.contributionId &&
            item.obligationId === selected.obligationId
        ) ?? selected
    );
  });
  constructor() {
    let previousIdentity = '';
    let previousContext = '';
    effect(() => {
      this.contributionId();
      this.scope();
      const owner = this.canOwn(),
        identity = this.identityKey(),
        context = this.reviewContext();
      if (isPlatformBrowser(this.platform))
        untracked(() => {
          if (context !== previousContext || !owner) {
            this.reviewReturnTarget = null;
            this.reviewNavigation++;
          }
          if (identity !== previousIdentity || !owner) this.c.reset();
          previousIdentity = identity;
          previousContext = context;
          this.c.select();
        });
    });
    let previousEvidence = '';
    let previousSelectionContext = '';
    effect(() => {
      const evidenceId = this.selectedEvidenceId();
      const context = this.reviewContext();
      const saved = this.c.saved();
      const conflict = this.c.error() === 'conflict';
      if (
        previousEvidence &&
        !evidenceId &&
        (saved || conflict) &&
        previousSelectionContext === context
      )
        untracked(() => this.restoreReviewFocus(previousEvidence, context));
      previousEvidence = evidenceId;
      previousSelectionContext = context;
    });
  }
  private reviewContext(): string {
    return `${this.identityKey()}:${this.scope()}:${this.contributionId()}`;
  }
  openReview(item: SponsorshipHistoricalAuditItem, event: Event): void {
    if (
      !isPlatformBrowser(this.platform) ||
      !this.canOwn() ||
      this.destroy.destroyed ||
      this.c.loading() ||
      this.busy()
    )
      return;
    const source = this.c
      .data()
      ?.items.find(
        (record) =>
          record.evidenceId === item.evidenceId &&
          record.contributionId === item.contributionId &&
          record.obligationId === item.obligationId
      );
    if (!source) return;
    if (this.c.selected()?.evidenceId !== source.evidenceId)
      this.c.choose(source);
    if (this.c.selected()?.evidenceId !== source.evidenceId) return;
    this.reviewReturnTarget = event.currentTarget as HTMLElement | null;
    const context = this.reviewContext();
    const navigation = ++this.reviewNavigation;
    afterNextRender(
      () => {
        if (
          this.destroy.destroyed ||
          context !== this.reviewContext() ||
          navigation !== this.reviewNavigation ||
          this.selectedEvidenceId() !== source.evidenceId ||
          !this.canOwn() ||
          !this.element.nativeElement.getClientRects().length
        )
          return;
        const panel = this.reviewPanel()?.nativeElement;
        if (panel) revealControllerFocus(panel);
      },
      { injector: this.injector }
    );
  }
  closeReview(event?: Event): void {
    event?.stopPropagation();
    const evidenceId = this.selectedEvidenceId();
    const context = this.reviewContext();
    if (!this.c.close()) return;
    this.restoreReviewFocus(evidenceId, context);
  }
  private restoreReviewFocus(evidenceId: string, context: string): void {
    if (!isPlatformBrowser(this.platform)) return;
    const navigation = ++this.reviewNavigation;
    const previous = this.reviewReturnTarget;
    afterNextRender(
      () => {
        if (
          this.destroy.destroyed ||
          context !== this.reviewContext() ||
          navigation !== this.reviewNavigation ||
          this.selectedEvidenceId() ||
          !this.canOwn() ||
          !this.element.nativeElement.getClientRects().length
        )
          return;
        const target =
          previous?.isConnected &&
          previous.dataset['evidenceId'] === evidenceId &&
          previous.getClientRects().length
            ? previous
            : Array.from(
                this.element.nativeElement.querySelectorAll<HTMLElement>(
                  '[data-og7="historical-audit-examine"]'
                )
              ).find((button) => button.dataset['evidenceId'] === evidenceId);
        const focusTarget =
          target ??
          this.element.nativeElement.querySelector<HTMLElement>(
            '[data-og7-id="historical-audit-load"]'
          );
        if (focusTarget) revealControllerFocus(focusTarget);
      },
      { injector: this.injector }
    );
  }
  reviewLabel(item: SponsorshipHistoricalAuditItem): string {
    return `${this.i18n.t('admin.historicalAudit.review')} : ${this.i18n.t('admin.commitments.channels.' + item.channel)} · ${item.target === 'openg20' ? 'OpenG20' : 'OpenG7'}`;
  }
  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'owner'}`;
  }
  channelIcon(
    channel: SponsorshipHistoricalAuditItem['channel']
  ): AdminIconName {
    return channel === 'website' ? 'globe' : channel;
  }
  findingIcon(finding: SponsorshipHistoricalAuditFilter): AdminIconName {
    return finding === 'duration_unverified'
      ? 'clock'
      : finding === 'required_element_missing'
        ? 'warning'
        : 'info';
  }
  requirementIcon(
    element: SponsorshipHistoricalAuditItem['requirements'][number]['element']
  ): AdminIconName {
    return element === 'company_name'
      ? 'building'
      : element === 'approved_logo'
        ? 'image'
        : 'publications';
  }
  observationIcon(
    observation: SponsorshipHistoricalAuditItem['requirements'][number]['observation']
  ): AdminIconName {
    return observation === 'satisfied'
      ? 'database'
      : observation === 'missing'
        ? 'warning'
        : 'info';
  }
  requirementLabel(
    requirement: SponsorshipHistoricalAuditItem['requirements'][number]
  ): string {
    return (
      this.i18n.t('admin.historicalAudit.elements.' + requirement.element) +
      ': ' +
      this.i18n.t(
        'admin.historicalAudit.observations.' + requirement.observation
      )
    );
  }
  conclusionIcon(
    conclusion: SponsorshipHistoricalAuditConclusion
  ): AdminIconName {
    return conclusion === 'follow_up_required' ? 'warning' : 'info';
  }
  date(value: string): string | null {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return null;
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto'
    }).format(instant);
  }
  setFilter(event: Event): void {
    this.c.filter.set(
      (event.target as HTMLSelectElement).value as
        SponsorshipHistoricalAuditFilter | ''
    );
    void this.c.load();
  }
  setConclusion(event: Event): void {
    this.c.conclusion.set(
      (event.target as HTMLSelectElement)
        .value as SponsorshipHistoricalAuditConclusion
    );
  }
  setReason(event: Event): void {
    this.c.reason.set((event.target as HTMLTextAreaElement).value);
  }
  setConfirmation(event: Event): void {
    this.c.confirmation.set((event.target as HTMLInputElement).checked);
  }
}
