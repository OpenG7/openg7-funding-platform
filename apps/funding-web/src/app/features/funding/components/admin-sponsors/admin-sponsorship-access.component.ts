import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-admin-sponsorship-access',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin-ui/admin-controls.css'],
  styles: [
    `
      :host {
        display: block;
        margin: 1rem 0;
        padding: 1rem;
        border: 1px solid var(--admin-border);
        border-radius: 1rem;
      }
      button {
        padding: 0.7rem 1rem;
        border: 1px solid var(--admin-border);
        border-radius: 0.7rem;
      }
      button:focus-visible {
        outline: 2px solid var(--admin-focus);
        outline-offset: 3px;
      }
      button:disabled {
        opacity: 0.6;
      }
      p {
        margin: 0.6rem 0;
      }
    `
  ],
  template: `@if (allowed()) {
    <section
      #accessPanel
      data-og7="admin-followup-access"
      class="admin-focus-target"
      tabindex="-1"
      aria-labelledby="dossier-followup-access-title"
    >
      <h3 id="dossier-followup-access-title">
        {{ 'admin.followupAccess.title' | translate }}
      </h3>
      <p>{{ 'admin.followupAccess.copy' | translate }}</p>
      <button
        type="button"
        [disabled]="busy() || disabled()"
        (click)="resend()"
      >
        {{
          'admin.followupAccess.' + (busy() ? 'working' : 'send') | translate
        }}
      </button>
      <p role="status">{{ 'admin.followupAccess.' + state() | translate }}</p>
    </section>
  }`
})
export class AdminSponsorshipAccessComponent {
  private readonly accessPanel =
    viewChild<ElementRef<HTMLElement>>('accessPanel');
  readonly contributionId = input.required<string>();
  readonly token = input.required<string>();
  readonly disabled = input(false);
  readonly queued = output<void>();
  readonly busy = signal(false);
  readonly state = signal('idle');
  private readonly api = inject(FundingAdminService);
  readonly allowed = computed(
    () => !this.api.identity() || this.api.identity()?.role === 'owner'
  );
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private requestId?: string;
  private generation = 0;
  constructor() {
    effect(() => {
      this.contributionId();
      this.generation++;
      this.requestId = undefined;
      this.busy.set(false);
      this.state.set('idle');
    });
  }
  focus(): void {
    const panel = this.accessPanel()?.nativeElement;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  async resend(): Promise<void> {
    if (this.busy() || this.disabled() || !this.allowed()) return;
    const id = this.contributionId();
    const generation = this.generation;
    const current = () =>
      !this.destroyRef.destroyed &&
      generation === this.generation &&
      this.allowed();
    this.busy.set(true);
    this.state.set('idle');
    try {
      const { recipient } = await this.api.getSponsorshipAccessRecipient(
        this.token(),
        id
      );
      if (!current()) return;
      if (!recipient) {
        this.state.set('missing');
        return;
      }
      if (
        !(await this.confirmation.confirm(
          this.i18n.t('admin.followupAccess.confirm'),
          recipient
        )) ||
        !current()
      )
        return;
      this.requestId ??= crypto.randomUUID();
      const result = await this.api.resendSponsorshipAccess(this.token(), {
        contributionId: id,
        recipient,
        confirmed: true,
        requestId: this.requestId,
        locale: this.i18n.currentLanguage()
      });
      if (!current()) return;
      this.state.set(result.status);
      this.requestId = undefined;
      this.queued.emit();
    } catch (error) {
      if (current())
        this.state.set(
          error instanceof AdminDashboardRequestError &&
            [401, 403].includes(error.status)
            ? 'unauthorized'
            : 'error'
        );
    } finally {
      if (current()) this.busy.set(false);
    }
  }
}
