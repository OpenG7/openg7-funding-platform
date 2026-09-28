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
import type {
  SponsorshipInterventionKind,
  SponsorshipInterventionRequest,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

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
  readonly data = signal<SponsorshipInterventionsResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal(false);
  readonly note = signal('');
  readonly kind = signal<SponsorshipInterventionKind>('internal');
  readonly nextReviewOn = signal('');
  readonly days = SPONSORSHIP_FOLLOWUP_DAYS;
  readonly kinds: readonly SponsorshipInterventionKind[] = [
    'email',
    'phone',
    'internal',
    'extension',
    'refund_review'
  ];
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  private initialized = false;
  private generation = 0;
  private pending: {
    signature: string;
    request: SponsorshipInterventionRequest;
  } | null = null;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platform)) {
      this.initialized = true;
      void this.load();
    }
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['autoOpen'] && this.autoOpen()) this.expanded.set(true);
    if (changes['contributionId']) {
      this.generation++;
      this.note.set('');
      this.kind.set('internal');
      this.nextReviewOn.set('');
      this.pending = null;
      this.success.set(false);
      this.saving.set(false);
      this.data.set(null);
    }
    if (
      this.initialized &&
      !this.saving() &&
      (changes['contributionId'] || changes['refreshKey'])
    )
      void this.load();
  }
  private current(generation: number): boolean {
    return generation === this.generation && !this.destroy.destroyed;
  }
  async load(more = false): Promise<void> {
    const generation = ++this.generation;
    const previous = more ? this.data() : null;
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.admin.getSponsorshipInterventions(
        this.admin.getSavedAdminToken(),
        this.contributionId(),
        previous?.nextCursor ?? undefined
      );
      if (!this.current(generation)) return;
      if (!data.followup || !Array.isArray(data.entries))
        throw new Error('Invalid intervention response.');
      this.data.set({
        ...data,
        entries: previous
          ? [
              ...previous.entries,
              ...data.entries.filter(
                (entry) => !previous.entries.some((old) => old.id === entry.id)
              )
            ]
          : data.entries
      });
    } catch (error) {
      if (this.current(generation)) await this.handleError(error, 'loadError');
    } finally {
      if (this.current(generation)) this.loading.set(false);
    }
  }
  setKind(value: string): void {
    if (this.kinds.includes(value as SponsorshipInterventionKind))
      this.kind.set(value as SponsorshipInterventionKind);
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
  async save(): Promise<void> {
    if (
      !this.canManage() ||
      this.disabled() ||
      this.saving() ||
      this.loading() ||
      !this.data()
    )
      return;
    if (
      !this.note().trim() ||
      this.note().length > 2000 ||
      (this.kind() === 'extension' && !this.nextReviewOn())
    ) {
      this.error.set('invalid');
      return;
    }
    const payload = {
      contributionId: this.contributionId(),
      kind: this.kind(),
      note: this.note().trim(),
      nextReviewOn: this.kind() === 'extension' ? this.nextReviewOn() : null
    };
    const signature = JSON.stringify(payload);
    if (this.pending?.signature !== signature)
      this.pending = {
        signature,
        request: { ...payload, requestId: crypto.randomUUID() }
      };
    const generation = this.generation;
    this.saving.set(true);
    this.error.set('');
    this.success.set(false);
    try {
      await this.admin.recordSponsorshipIntervention(
        this.admin.getSavedAdminToken(),
        this.pending.request
      );
      if (!this.current(generation)) return;
      this.note.set('');
      this.nextReviewOn.set('');
      this.kind.set('internal');
      this.pending = null;
      this.success.set(true);
      this.saving.set(false);
      await this.load();
      if (
        !this.destroy.destroyed &&
        this.contributionId() === payload.contributionId
      )
        this.saved.emit();
    } catch (error) {
      if (this.current(generation)) await this.handleError(error, 'saveError');
    } finally {
      if (this.current(generation)) this.saving.set(false);
    }
  }
  private async handleError(error: unknown, fallback: string): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : 0;
    this.error.set(
      status === 400
        ? 'invalid'
        : status === 403
          ? 'forbidden'
          : status === 409
            ? 'conflict'
            : fallback
    );
    if (status === 401 || status === 403) {
      this.data.set(null);
      this.note.set('');
      this.pending = null;
    }
    if (status === 401) {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  }
}
