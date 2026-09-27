import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
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
  template: `
    <section aria-labelledby="stripe-backfill-title" data-og7="stripe-backfill">
      <h2 id="stripe-backfill-title">
        {{ 'admin.stripeBackfill.title' | translate }}
      </h2>
      <p>{{ 'admin.stripeBackfill.description' | translate }}</p>
      @if (!canRun()) {
        <p>{{ 'admin.stripeBackfill.forbidden' | translate }}</p>
      } @else {
        <form (submit)="$event.preventDefault(); preview()">
          <fieldset
            [disabled]="
              busy() ||
              confirming() ||
              uncertain() ||
              run()?.status === 'running'
            "
          >
            <legend>{{ 'admin.stripeBackfill.scope' | translate }}</legend>
            <label
              >{{ 'admin.stripeBackfill.from' | translate }}
              <input
                type="date"
                required
                [max]="today()"
                [value]="from()"
                (input)="change('from', $event)"
              />
            </label>
            <label
              >{{ 'admin.stripeBackfill.to' | translate }}
              <input
                type="date"
                required
                [max]="today()"
                [min]="from()"
                [value]="to()"
                (input)="change('to', $event)"
              />
            </label>
            <label
              >{{ 'admin.stripeBackfill.limit' | translate }}
              <input
                type="number"
                required
                min="1"
                max="100"
                step="1"
                [value]="limit()"
                (input)="change('limit', $event)"
              />
            </label>
            <button type="submit" data-og7="stripe-backfill-preview">
              {{ 'admin.stripeBackfill.preview' | translate }}
            </button>
          </fieldset>
        </form>
        @if (busy()) {
          <p role="status">{{ 'admin.stripeBackfill.loading' | translate }}</p>
        }
        @if (error()) {
          <p role="alert" data-og7="stripe-backfill-error">
            {{ error() | translate }}
          </p>
        }
        @if (run(); as result) {
          <div
            #resultPanel
            tabindex="-1"
            aria-live="polite"
            data-og7="stripe-backfill-result"
          >
            <strong>{{
              'admin.stripeBackfill.' + result.mode | translate
            }}</strong>
            <p>
              {{
                'admin.stripeBackfill.target'
                  | translate
                    : { account: result.accountId, project: result.projectId }
              }}
            </p>
            <p>
              {{ result.scope.from }} — {{ result.scope.to }} (UTC) ·
              {{ result.scope.limit }}
            </p>
            <p>
              {{ 'admin.stripeBackfill.status.' + result.status | translate }}
            </p>
            @if (result.status === 'preview' || result.status === 'completed') {
              <p>
                {{ 'admin.stripeBackfill.counts' | translate: result.counts }}
              </p>
              @if (result.counts.scanned >= result.scope.limit) {
                <p>{{ 'admin.stripeBackfill.capped' | translate }}</p>
              }
              @if (result.counts.missingFees) {
                <p>{{ 'admin.stripeBackfill.missingFees' | translate }}</p>
              }
            }
            @if (result.status === 'preview' && !uncertain()) {
              <button
                type="button"
                [disabled]="
                  busy() ||
                  expired() ||
                  (!result.counts.matched && !result.counts.disputes)
                "
                (click)="execute()"
                data-og7="stripe-backfill-execute"
              >
                {{ 'admin.stripeBackfill.execute' | translate }}
              </button>
              @if (expired()) {
                <p>{{ 'admin.stripeBackfill.expired' | translate }}</p>
              }
            }
          </div>
        }
        <button
          type="button"
          class="secondary"
          [disabled]="busy()"
          (click)="refresh()"
          data-og7="stripe-backfill-refresh"
        >
          {{ 'admin.stripeBackfill.refresh' | translate }}
        </button>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        margin: 1rem 0;
      }
      section {
        padding: 1.25rem;
        border: 1px solid #cbd5e1;
        border-radius: 1rem;
        background: #fff;
        color: #17243a;
      }
      h2 {
        margin: 0;
        font-size: 1.2rem;
      }
      p {
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
      fieldset {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 1rem;
        border: 0;
        padding: 0;
        margin: 1rem 0;
      }
      legend {
        padding: 0;
        margin-bottom: 0.6rem;
      }
      label {
        display: grid;
        gap: 0.4rem;
      }
      input,
      button {
        font: inherit;
        padding: 0.65rem 0.8rem;
        border: 1px solid #64748b;
        border-radius: 0.5rem;
        max-width: 100%;
      }
      button {
        background: #173c59;
        color: #fff;
        cursor: pointer;
      }
      .secondary {
        background: #fff;
        color: #173c59;
        margin-top: 1rem;
      }
      button:disabled {
        opacity: 0.55;
        cursor: default;
      }
      :focus-visible {
        outline: 3px solid #186eac;
        outline-offset: 3px;
      }
      [role='alert'] {
        color: #a3122d;
      }
      @media (max-width: 540px) {
        label,
        fieldset button {
          width: 100%;
        }
      }
    `
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
  private readonly resultPanel =
    viewChild<ElementRef<HTMLElement>>('resultPanel');
  readonly canRun = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
  readonly today = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly limit = signal(100);
  readonly busy = signal(false);
  readonly confirming = signal(false);
  readonly uncertain = signal(false);
  readonly error = signal('');
  readonly run = signal<AdminStripeBackfillRun | null>(null);
  readonly expired = computed(
    () => !!this.run() && Date.parse(this.run()!.expiresAt) <= Date.now()
  );
  private session = 0;

  ngOnInit(): void {
    const now = new Date();
    this.today.set(now.toISOString().slice(0, 10));
    this.to.set(this.today());
    this.from.set(
      new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10)
    );
    this.session = this.admin.sessionGeneration();
    if (this.canRun()) void this.refresh();
  }
  private active(): boolean {
    return (
      !this.destroy.destroyed && this.session === this.admin.sessionGeneration()
    );
  }
  change(field: 'from' | 'to' | 'limit', event: Event): void {
    if (this.busy() || this.uncertain()) return;
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
    if (this.busy() || !this.canRun() || this.uncertain()) return;
    this.busy.set(true);
    this.error.set('');
    this.run.set(null);
    try {
      const response = await this.admin.stripeBackfill({
        action: 'preview',
        scope: { from: this.from(), to: this.to(), limit: this.limit() }
      });
      if (this.active()) this.run.set(response.run);
    } catch (error) {
      if (!this.destroy.destroyed) this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async execute(): Promise<void> {
    const run = this.run();
    if (
      !run ||
      run.status !== 'preview' ||
      this.busy() ||
      this.confirming() ||
      this.uncertain() ||
      !this.canRun()
    )
      return;
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
      if (!accepted || !this.active()) return;
      this.busy.set(true);
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
      this.busy.set(false);
      this.confirming.set(false);
    }
  }
  async refresh(): Promise<void> {
    if (this.busy() || !this.canRun()) return;
    this.busy.set(true);
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
      }
      if (response.run?.status === 'completed') this.completed.emit();
    } catch (error) {
      if (!this.destroy.destroyed) this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
