import { isPlatformBrowser } from '@angular/common';
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
  output,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipProgress,
  SponsorshipObligation
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';
import { PreparationAssistanceReviewComponent } from '../admin-preparation/preparation-assistance-review.component.js';
import type { PreparationAssistanceSelection } from '../admin-preparation/preparation-assistance.controller.js';
import { revealControllerFocus } from '../admin-controller/admin-controller-navigation.js';

import { AdminSponsorshipCommitmentsController } from './admin-sponsorship-commitments-controller.js';
import { AdminSponsorshipTimingComponent } from './admin-sponsorship-timing.component.js';
import { AdminSponsorshipHistoricalAuditComponent } from './admin-sponsorship-historical-audit.component.js';

/** Funding organism: explicitly evidenced historical terms and owner-only amendments. */
@Component({
  selector: 'openg7-admin-sponsorship-commitments',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    AdminAutomaticPreparationDirective,
    AdminSponsorshipTimingComponent,
    AdminSponsorshipHistoricalAuditComponent,
    PreparationAssistanceReviewComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-commitments.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsorship-commitments.component.css'
  ]
})
export class AdminSponsorshipCommitmentsComponent {
  readonly dossier = input.required<AdminSponsorshipProgress>();
  readonly changed = output<void>();
  private readonly admin = inject(FundingAdminService);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly canOwn = computed(
    () =>
      this.admin.hasValidAdminSession() &&
      (!this.admin.identity() || this.admin.identity()?.role === 'owner')
  );
  readonly c = new AdminSponsorshipCommitmentsController({
    dossier: () => this.dossier(),
    canOwn: () => this.canOwn(),
    isDestroyed: () => this.destroy.destroyed,
    newRequestId: () => crypto.randomUUID(),
    get: (id) => this.admin.getSponsorshipCommitment(id),
    qualify: (input) => this.admin.qualifySponsorshipCommitment(input),
    applyAssistance: async (input) => {
      await this.admin.applyPreparationAssistance(input);
      return this.admin.getSponsorshipCommitment(input.contributionId);
    },
    adjust: (input) => this.admin.adjustSponsorshipObligation(input),
    adoption: (size, cursor) =>
      this.admin.sponsorshipCommitmentAdoptionPreview(size, cursor),
    changed: () => this.changed.emit(),
    unauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly locked = computed(
    () =>
      this.c.loading() ||
      this.c.saving() ||
      Boolean(this.c.pending()) ||
      !this.canOwn()
  );
  readonly obligation = computed(
    () =>
      this.c
        .data()
        ?.obligations.find((o) => o.id === this.c.selectedObligation()) ?? null
  );
  readonly formatChoices = [
    'collective_text',
    'individual_portrait',
    'collective_composite'
  ] as const;
  constructor() {
    let assistanceIdentity = '';
    effect(() => {
      const key = this.assistanceIdentity();
      untracked(() => {
        if (assistanceIdentity !== key) this.c.invalidateAssistance();
        assistanceIdentity = key;
      });
    });
    effect(() => {
      const id = this.dossier().contributionId,
        owner = this.canOwn();
      if (isPlatformBrowser(this.platform) && id)
        untracked(() => {
          this.c.select();
          if (owner) void this.c.load();
        });
    });
  }
  async useAssistance(
    selection: PreparationAssistanceSelection
  ): Promise<void> {
    if (this.locked() || !this.canOwn()) return;
    const id = this.dossier().contributionId;
    const identity = this.assistanceIdentity();
    if (selection.state.contributionId !== id) return;
    if (
      selection.state.run?.review?.offer &&
      this.c.benefits().length &&
      !(await this.confirmation.confirm(
        this.i18n.t('admin.preparationAssistance.replaceDraft'),
        this.dossier().reference
      ))
    )
      return;
    if (
      this.destroy.destroyed ||
      this.dossier().contributionId !== id ||
      identity !== this.assistanceIdentity() ||
      this.locked()
    )
      return;
    this.c.chooseAssistance(selection);
    this.focusQualification();
  }
  manualQualification(): void {
    this.c.manualQualification();
    this.focusQualification();
  }
  private assistanceIdentity(): string {
    return `${this.admin.sessionGeneration()}:${this.admin.identity()?.id ?? 'token'}:${this.admin.identity()?.sessionId ?? 'token'}:${this.admin.identity()?.role ?? 'owner'}`;
  }
  private focusQualification(): void {
    afterNextRender(
      () => {
        if (this.destroy.destroyed) return;
        const target =
          this.element.nativeElement.querySelector<HTMLElement>(
            '[data-og7="commitments-qualification"] select, [data-og7="commitments-add-benefit"]'
          ) ??
          this.element.nativeElement.querySelector<HTMLElement>(
            '#dossier-agreement'
          );
        if (target) revealControllerFocus(target);
      },
      { injector: this.injector }
    );
  }
  updateText(
    index: number,
    key:
      | 'channel'
      | 'target'
      | 'quantity'
      | 'format'
      | 'deadlineDays'
      | 'durationDays',
    event: Event
  ): void {
    this.c.updateBenefit(index, key, (event.target as HTMLInputElement).value);
  }
  obligationStateLabel(obligation: SponsorshipObligation): string {
    if (
      obligation.state === 'fulfilled' &&
      (!obligation.fulfilmentEvidenceId ||
        !this.dossier().qualifiedFulfilmentEvidenceIds?.includes(
          obligation.fulfilmentEvidenceId
        ))
    )
      return 'admin.dossier.publicationBridge.status.unverified';
    return 'admin.commitments.states.' + obligation.state;
  }
  updateCheck(
    index: number,
    key: 'companyName' | 'presentation' | 'logo',
    event: Event
  ): void {
    this.c.updateBenefit(
      index,
      key,
      (event.target as HTMLInputElement).checked
    );
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  period(value: number | null): string {
    return value === null
      ? this.i18n.t('admin.commitments.unspecified')
      : this.i18n.t('admin.commitments.days', { value });
  }
  money(amountMinor: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(amountMinor / 100);
  }
  setPageSize(event: Event): void {
    this.c.pageSize.set(this.value(event) === '50' ? 50 : 25);
    void this.c.loadPreview();
  }
}
