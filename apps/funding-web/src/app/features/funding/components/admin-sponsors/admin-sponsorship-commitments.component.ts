import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';

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
    AdminSponsorshipHistoricalAuditComponent
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
  readonly canOwn = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
  readonly c = new AdminSponsorshipCommitmentsController({
    dossier: () => this.dossier(),
    canOwn: () => this.canOwn(),
    isDestroyed: () => this.destroy.destroyed,
    newRequestId: () => crypto.randomUUID(),
    get: (id) => this.admin.getSponsorshipCommitment(id),
    qualify: (input) => this.admin.qualifySponsorshipCommitment(input),
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
