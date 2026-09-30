import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  NgZone,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminStripeBackfillRun } from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-admin-stripe-backfill',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-stripe-backfill.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-stripe-backfill.component.css'
  ]
})
export class AdminStripeBackfillComponent implements OnInit {
  readonly completed = output<void>();
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);
  private readonly destroy = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly zone = inject(NgZone);
  private readonly resultPanel =
    viewChild<ElementRef<HTMLElement>>('resultPanel');
  private readonly executeButton =
    viewChild<ElementRef<HTMLButtonElement>>('executeButton');
  readonly canRun = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
  readonly today = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly limit = signal(100);
  readonly operation = signal<'preview' | 'execute' | 'refresh' | null>(null);
  readonly busy = computed(() => this.operation() !== null);
  readonly confirming = signal(false);
  readonly uncertain = signal(false);
  readonly error = signal('');
  readonly run = signal<AdminStripeBackfillRun | null>(null);
  readonly expired = signal(false);
  readonly scopeExpanded = signal(true);
  readonly periods = [7, 31] as const;
  readonly metrics = [
    'scanned',
    'matched',
    'payments',
    'refunds',
    'disputes'
  ] as const;
  readonly scopeLocked = computed(
    () =>
      this.busy() ||
      this.confirming() ||
      this.uncertain() ||
      this.run()?.status === 'running'
  );
  readonly dateError = computed(() => {
    const from = Date.parse(this.from() + 'T00:00:00Z');
    const to = Date.parse(this.to() + 'T00:00:00Z');
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 'datesRequired';
    if (from > to) return 'datesOrder';
    if (to > Date.parse(this.today() + 'T00:00:00Z')) return 'datesFuture';
    return to - from >= 31 * 86400000 ? 'datesRange' : '';
  });
  readonly limitInvalid = computed(
    () =>
      !Number.isInteger(this.limit()) || this.limit() < 1 || this.limit() > 100
  );
  readonly emptyPreview = computed(() => {
    const result = this.run();
    return (
      result?.status === 'preview' &&
      !result.counts.matched &&
      !result.counts.payments &&
      !result.counts.refunds &&
      !result.counts.disputes
    );
  });
  readonly canExecute = computed(
    () =>
      this.canRun() &&
      !this.scopeLocked() &&
      !this.expired() &&
      this.run()?.status === 'preview' &&
      !!(this.run()?.counts.matched || this.run()?.counts.disputes)
  );
  private session = 0;

  constructor() {
    effect((onCleanup) => {
      const run = this.run();
      this.expired.set(!!run && this.previewExpired(run));
      if (run?.status !== 'preview' || !isPlatformBrowser(this.platformId))
        return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const update = () => {
        this.expired.set(this.previewExpired(run));
        const remaining = Date.parse(run.expiresAt) - Date.now();
        if (remaining > 0)
          timer = setTimeout(update, Math.min(remaining, 2147483647));
      };
      this.zone.runOutsideAngular(update);
      onCleanup(() => clearTimeout(timer));
    });
  }

  ngOnInit(): void {
    this.setPeriod(7);
    this.session = this.admin.sessionGeneration();
    if (this.canRun()) void this.refresh();
  }
  private active(): boolean {
    return (
      !this.destroy.destroyed && this.session === this.admin.sessionGeneration()
    );
  }
  private previewExpired(run: AdminStripeBackfillRun): boolean {
    return (
      run.status === 'preview' &&
      (!Number.isFinite(Date.parse(run.expiresAt)) ||
        Date.parse(run.expiresAt) <= Date.now())
    );
  }
  setPeriod(days: 7 | 31): void {
    if (this.scopeLocked()) return;
    const now = new Date();
    this.today.set(now.toISOString().slice(0, 10));
    this.to.set(this.today());
    this.from.set(
      new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10)
    );
    this.run.set(null);
    this.error.set('');
    this.scopeExpanded.set(true);
  }
  change(field: 'from' | 'to' | 'limit', event: Event): void {
    if (this.scopeLocked()) return;
    const value = (event.target as HTMLInputElement).value;
    if (field === 'limit') this.limit.set(Number(value));
    else this[field].set(value);
    this.run.set(null);
    this.error.set('');
  }
  private showError(error: unknown): void {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : 0;
    const key =
      status === 401
        ? 'sessionExpired'
        : status === 403
          ? error instanceof AdminDashboardRequestError &&
            error.message === 'ORIGIN_FORBIDDEN'
            ? 'originForbidden'
            : 'forbidden'
          : status === 400
            ? 'invalid'
            : status === 409
              ? 'changed'
              : 'unavailable';
    this.error.set('admin.stripeBackfill.' + key);
    if (status === 401 || status === 403) {
      this.run.set(null);
      this.scopeExpanded.set(true);
      this.uncertain.set(false);
    }
    if (status === 401)
      void this.router.navigate(['/admin/login'], {
        queryParams: {
          returnUrl: '/admin/fundraiser/contributions',
          sessionExpired: '1'
        }
      });
  }
  async preview(): Promise<void> {
    if (
      this.scopeLocked() ||
      !this.canRun() ||
      this.dateError() ||
      this.limitInvalid()
    )
      return;
    this.operation.set('preview');
    this.scopeExpanded.set(true);
    this.error.set('');
    this.run.set(null);
    try {
      const response = await this.admin.stripeBackfill({
        action: 'preview',
        scope: { from: this.from(), to: this.to(), limit: this.limit() }
      });
      if (this.active()) {
        this.run.set(response.run);
        afterNextRender(() => this.resultPanel()?.nativeElement.focus(), {
          injector: this.injector
        });
      }
    } catch (error) {
      if (!this.destroy.destroyed) this.showError(error);
    } finally {
      this.operation.set(null);
    }
  }
  async execute(): Promise<void> {
    const run = this.run();
    if (!run || !this.canExecute() || this.previewExpired(run)) return;
    this.confirming.set(true);
    this.error.set('');
    try {
      const accepted = await this.confirmation.confirm(
        this.i18n.t('admin.stripeBackfill.confirm', {
          mode: this.i18n.t('admin.stripeBackfill.' + run.mode),
          account: run.accountId,
          project: run.projectId,
          from: run.scope.from,
          to: run.scope.to,
          limit: run.scope.limit
        })
      );
      if (!this.active()) return;
      if (!accepted) {
        afterNextRender(
          () => {
            const target = this.previewExpired(run)
              ? this.resultPanel()
              : this.executeButton();
            target?.nativeElement.focus();
          },
          { injector: this.injector }
        );
        return;
      }
      if (this.previewExpired(run) || this.run()?.id !== run.id) {
        this.expired.set(this.previewExpired(run));
        afterNextRender(() => this.resultPanel()?.nativeElement.focus(), {
          injector: this.injector
        });
        return;
      }
      this.operation.set('execute');
      this.uncertain.set(true);
      const response = await this.admin.stripeBackfill({
        action: 'execute',
        id: run.id,
        confirmation: run.mode + ':' + run.id
      });
      if (!this.active()) return;
      this.run.set(response.run);
      this.uncertain.set(false);
      if (response.run?.status === 'completed') this.completed.emit();
      afterNextRender(() => this.resultPanel()?.nativeElement.focus(), {
        injector: this.injector
      });
    } catch (error) {
      if (!this.destroy.destroyed) {
        this.showError(error);
        if (this.uncertain()) this.error.set('admin.stripeBackfill.uncertain');
      }
    } finally {
      this.operation.set(null);
      this.confirming.set(false);
    }
  }
  async refresh(): Promise<void> {
    if (this.busy() || this.confirming() || !this.canRun()) return;
    this.operation.set('refresh');
    this.error.set('');
    try {
      const response = await this.admin.stripeBackfill(
        undefined,
        this.run()?.id
      );
      if (!this.active()) return;
      this.run.set(response.run);
      this.uncertain.set(false);
      if (response.run) {
        this.from.set(response.run.scope.from);
        this.to.set(response.run.scope.to);
        this.limit.set(response.run.scope.limit);
      } else {
        this.scopeExpanded.set(true);
      }
      if (response.run?.status === 'completed') this.completed.emit();
    } catch (error) {
      if (!this.destroy.destroyed) this.showError(error);
    } finally {
      this.operation.set(null);
    }
  }
}
