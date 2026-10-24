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
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorshipHistoricalAuditConclusion,
  SponsorshipHistoricalAuditFilter
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminSponsorsQualityI18nService } from '../../services/admin-sponsors-quality-i18n.service.js';

import { AdminSponsorshipHistoricalAuditController } from './admin-sponsorship-historical-audit-controller.js';

/** Funding organism: historical proof inventory and owner acknowledgement only. */
@Component({
  selector: 'openg7-admin-sponsorship-historical-audit',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
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
  constructor() {
    let previousIdentity = '';
    effect(() => {
      this.contributionId();
      this.scope();
      const owner = this.canOwn(),
        identity = this.identityKey();
      if (isPlatformBrowser(this.platform))
        untracked(() => {
          if (identity !== previousIdentity || !owner) this.c.reset();
          previousIdentity = identity;
          this.c.select();
        });
    });
  }
  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'owner'}`;
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
