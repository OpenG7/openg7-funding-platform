import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingService } from '../../services/funding.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-sponsorship-access-recovery',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./sponsorship-followup.css'],
  template: `<section class="state-card" data-og7="followup-recovery">
    <h2>{{ 'funding.followup.recovery.title' | translate }}</h2>
    <p>{{ 'funding.followup.recovery.copy' | translate }}</p>
    <form (submit)="$event.preventDefault(); submit()" novalidate>
      <label for="followup-recovery-email">{{
        'funding.followup.recovery.email' | translate
      }}</label>
      <input
        id="followup-recovery-email"
        type="email"
        autocomplete="email"
        required
        maxlength="254"
        [formControl]="email"
        [attr.aria-invalid]="attempted() && email.invalid"
        aria-describedby="followup-recovery-status"
      />
      <button type="submit" [disabled]="state() === 'sending'">
        {{
          'funding.followup.recovery.' +
            (state() === 'sending' ? 'sending' : 'submit') | translate
        }}
      </button>
      <p id="followup-recovery-status" role="status">
        {{
          'funding.followup.recovery.' +
            (attempted() && email.invalid ? 'invalid' : state()) | translate
        }}
      </p>
    </form>
  </section>`
})
export class SponsorshipAccessRecoveryComponent {
  private readonly api = inject(FundingService);
  private readonly i18n = inject(FundingI18nService);
  private readonly destroyRef = inject(DestroyRef);
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.email,
      Validators.maxLength(254)
    ]
  });
  readonly attempted = signal(false);
  readonly state = signal<'idle' | 'sending' | 'accepted' | 'error'>('idle');
  async submit(): Promise<void> {
    if (this.state() === 'sending') return;
    this.attempted.set(true);
    this.email.setValue(this.email.value.trim());
    if (this.email.invalid) return;
    this.state.set('sending');
    try {
      await this.api.requestSponsorshipAccess(
        this.email.value,
        this.i18n.currentLanguage()
      );
      if (!this.destroyRef.destroyed) this.state.set('accepted');
    } catch {
      if (!this.destroyRef.destroyed) this.state.set('error');
    }
  }
}
