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
  viewChild
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminSponsorshipAccessController } from './admin-sponsorship-access-controller.js';

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
  private readonly api = inject(FundingAdminService);
  readonly allowed = computed(
    () => !this.api.identity() || this.api.identity()?.role === 'owner'
  );
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly controller = new AdminSponsorshipAccessController({
    contributionId: () => this.contributionId(),
    token: () => this.token(),
    disabled: () => this.disabled(),
    allowed: () => this.allowed(),
    isDestroyed: () => this.destroyRef.destroyed,
    language: () => this.i18n.currentLanguage(),
    newRequestId: () => crypto.randomUUID(),
    getSponsorshipAccessRecipient: (token, contributionId) =>
      this.api.getSponsorshipAccessRecipient(token, contributionId),
    confirm: (recipient) =>
      this.confirmation.confirm(
        this.i18n.t('admin.followupAccess.confirm'),
        recipient
      ),
    resendSponsorshipAccess: (token, request) =>
      this.api.resendSponsorshipAccess(token, request),
    queued: () => this.queued.emit()
  });
  readonly busy = this.controller.busy;
  readonly state = this.controller.state;

  constructor() {
    effect(() => {
      this.contributionId();
      this.controller.targetChanged();
    });
  }

  focus(): void {
    const panel = this.accessPanel()?.nativeElement;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  resend(): Promise<void> {
    return this.controller.resend();
  }
}
