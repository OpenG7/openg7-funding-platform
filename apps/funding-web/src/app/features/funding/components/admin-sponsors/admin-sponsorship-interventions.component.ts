import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  SimpleChanges,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SPONSORSHIP_FOLLOWUP_DAYS } from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminSponsorshipInterventionsController } from './admin-sponsorship-interventions-controller.js';

/** Funding organism: private append-only intervention journal and follow-up guidance. */
@Component({
  selector: 'openg7-admin-sponsorship-interventions',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-interventions.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-interventions.component.css'
  ]
})
export class AdminSponsorshipInterventionsComponent
  implements OnInit, OnChanges
{
  readonly contributionId = input.required<string>();
  readonly canManage = input(false);
  readonly disabled = input(false);
  readonly refreshKey = input<unknown>(0);
  readonly autoOpen = input(false);
  readonly saved = output<void>();
  readonly accessRequested = output<void>();
  readonly canResendAccess = input(false);
  readonly expanded = signal(false);
  readonly days = SPONSORSHIP_FOLLOWUP_DAYS;
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  private initialized = false;
  private readonly controller = new AdminSponsorshipInterventionsController({
    contributionId: () => this.contributionId(),
    canManage: () => this.canManage(),
    disabled: () => this.disabled(),
    isDestroyed: () => this.destroy.destroyed,
    token: () => this.admin.getSavedAdminToken(),
    newRequestId: () => crypto.randomUUID(),
    getSponsorshipInterventions: (token, id, before) =>
      this.admin.getSponsorshipInterventions(token, id, before),
    recordSponsorshipIntervention: (token, payload) =>
      this.admin.recordSponsorshipIntervention(token, payload),
    saved: () => this.saved.emit(),
    onUnauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly data = this.controller.data;
  readonly loading = this.controller.loading;
  readonly saving = this.controller.saving;
  readonly error = this.controller.error;
  readonly success = this.controller.success;
  readonly note = this.controller.note;
  readonly kind = this.controller.kind;
  readonly nextReviewOn = this.controller.nextReviewOn;
  readonly kinds = this.controller.kinds;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platform)) {
      this.initialized = true;
      void this.load();
    }
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['autoOpen'] && this.autoOpen()) this.expanded.set(true);
    if (changes['contributionId']) this.controller.resetDossier();
    if (
      this.initialized &&
      !this.saving() &&
      (changes['contributionId'] || changes['refreshKey'])
    )
      void this.load();
  }
  load(more = false): Promise<void> {
    return this.controller.load(more);
  }
  setKind(value: string): void {
    this.controller.setKind(value);
  }
  formatDate(value: string, dateOnly = false): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: dateOnly ? undefined : 'short',
      timeZone: dateOnly ? 'UTC' : undefined
    }).format(date);
  }
  save(): Promise<void> {
    return this.controller.save();
  }
}
