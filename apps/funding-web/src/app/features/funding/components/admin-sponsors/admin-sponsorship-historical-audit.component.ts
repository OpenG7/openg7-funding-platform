import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  untracked
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorshipHistoricalAuditConclusion,
  SponsorshipHistoricalAuditFilter
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminSponsorshipHistoricalAuditController } from './admin-sponsorship-historical-audit-controller.js';

/** Funding organism: historical proof inventory and owner acknowledgement only. */
@Component({
  selector: 'openg7-admin-sponsorship-historical-audit',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-historical-audit.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-historical-audit.component.css'
  ]
})
export class AdminSponsorshipHistoricalAuditComponent {
  readonly contributionId = input.required<string>();
  readonly canOwn = input.required<boolean>();
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  readonly c = new AdminSponsorshipHistoricalAuditController({
    contributionId: () => this.contributionId(),
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
  constructor() {
    effect(() => {
      const id = this.contributionId(),
        owner = this.canOwn();
      if (isPlatformBrowser(this.platform) && id)
        untracked(() => {
          this.c.select();
          if (!owner) this.c.data.set(null);
        });
    });
  }
  setFilter(event: Event): void {
    this.c.filter.set(
      (event.target as HTMLSelectElement).value as
        SponsorshipHistoricalAuditFilter | ''
    );
    void this.c.load();
  }
  setGlobal(event: Event): void {
    this.c.global.set((event.target as HTMLInputElement).checked);
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
