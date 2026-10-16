import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { ContributionType } from '@openg7/funding-core';

import { AdminSandboxService } from '../../services/admin-sandbox.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { SponsorshipOfferSummaryComponent } from '../sponsorship-offer-summary/sponsorship-offer-summary.component.js';

/** Synthetic scenario controls, available only through the isolated sandbox capability. */
@Component({
  selector: 'openg7-admin-sandbox-scenarios',
  standalone: true,
  imports: [SponsorshipOfferSummaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin-ui/admin-controls.css'],
  template: `
    <details data-og7="sandbox-payments">
      <summary data-og7="sandbox-payments-open">{{ t('title') }}</summary>
      <p>{{ t('intro') }}</p>
      <fieldset [disabled]="sandbox.busy() || !!sandbox.pending()">
        <label
          >{{ t('kind') }}
          <select
            data-og7="sandbox-payment-kind"
            [value]="sandbox.kind()"
            (change)="kind($event)"
          >
            <option value="personal_support">{{ t('personal') }}</option>
            <option value="sponsorship_interest">{{ t('company') }}</option>
          </select>
        </label>
        <label
          >{{ t('amount') }}
          <select
            data-og7="sandbox-payment-amount"
            [value]="sandbox.amount()"
            (change)="amount($event)"
          >
            @for (value of sandbox.amounts(); track value) {
              <option [value]="value" [selected]="value === sandbox.amount()">
                {{ value }} CAD
              </option>
            }
          </select>
        </label>
        <label
          ><input
            type="checkbox"
            data-og7="sandbox-payment-public-consent"
            [checked]="sandbox.publicConsent()"
            (change)="consent($event)"
          />
          {{ t('consent') }}</label
        >
      </fieldset>
      @if (sandbox.offer(); as offer) {
        <openg7-sponsorship-offer-summary [offer]="offer" />
      }
      @if (sandbox.charter()?.active) {
        <p style="white-space: pre-wrap">{{ charterText() }}</p>
      }
      @if (!sandbox.journey()) {
        <label
          ><input
            type="checkbox"
            data-og7="sandbox-payment-accept"
            [disabled]="sandbox.busy() || sandbox.preparing()"
            [checked]="sandbox.accepted()"
            (change)="accept($event)"
          />
          {{ t('accept') }}</label
        >
        <button
          type="button"
          class="admin-button"
          data-og7="sandbox-payment-create"
          [disabled]="!sandbox.canCreate()"
          (click)="sandbox.create()"
        >
          {{ t(sandbox.pending() ? 'retry' : 'create') }}
        </button>
      }
      <p
        role="status"
        data-og7="sandbox-payment-state"
        [attr.data-state]="sandbox.status()"
        [attr.data-contribution-id]="sandbox.journey()?.contributionId ?? null"
      >
        {{ t(sandbox.status()) }}
      </p>
      @if (sandbox.journey(); as journey) {
        <p>
          {{ journey.reference }} · {{ journey.completed }} /
          {{ journey.total }}
        </p>
        <button
          type="button"
          class="admin-button"
          data-og7="sandbox-payment-open-journey"
          (click)="sandbox.openJourney()"
        >
          {{ t('openJourney') }}
        </button>
        @if (journey.contributionType === 'sponsorship_interest') {
          <p>{{ t('supplierHint') }}</p>
          <a
            class="admin-button"
            data-og7="sandbox-payment-open-supplier"
            [href]="sandbox.providerCheckoutUrl()"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t('openSupplier') }}</a
          >
        }
      }
      @if (sandbox.pending()) {
        <button
          type="button"
          class="admin-button"
          data-og7="sandbox-payment-new"
          [disabled]="sandbox.busy()"
          (click)="sandbox.newPayment()"
        >
          {{ t('newPayment') }}
        </button>
      }
    </details>
  `
})
export class AdminSandboxScenariosComponent {
  readonly sandbox = inject(AdminSandboxService);
  private readonly i18n = inject(FundingI18nService);
  t(key: string): string {
    return this.i18n.t('admin.controller.simulator.' + key);
  }
  kind(event: Event): void {
    void this.sandbox.choose(
      (event.target as HTMLSelectElement).value as ContributionType
    );
  }
  amount(event: Event): void {
    void this.sandbox.choose(
      this.sandbox.kind(),
      Number((event.target as HTMLSelectElement).value)
    );
  }
  consent(event: Event): void {
    this.sandbox.publicConsent.set((event.target as HTMLInputElement).checked);
    this.sandbox.accepted.set(false);
  }
  accept(event: Event): void {
    this.sandbox.accepted.set((event.target as HTMLInputElement).checked);
  }
  charterText(): string {
    const text = this.sandbox.charter()?.text;
    return text ? text[this.i18n.currentLanguage() === 'en' ? 'en' : 'fr'] : '';
  }
}
