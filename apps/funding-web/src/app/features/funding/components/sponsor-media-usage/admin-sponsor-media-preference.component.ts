import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  PLATFORM_ID,
  signal,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorMediaPreferenceDecisionRequest,
  SponsorMediaPreference
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { sponsorMediaMutationRejection } from '../../models/sponsor-media-mutation-outcome.js';

/** Admin organism: reviews the sponsor's requested choice without publishing or granting usage rights. */
@Component({
  selector: 'openg7-admin-sponsor-media-preference',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="preference-panel"
      data-og7="admin-media-preference"
      [attr.aria-busy]="busy()"
      [attr.aria-labelledby]="
        'admin-media-preference-title-' + contributionId()
      "
    >
      <header>
        <h3 [id]="'admin-media-preference-title-' + contributionId()">
          {{ 'funding.followup.media.usage.preferenceTitle' | translate }}
        </h3>
        <p class="help-copy">
          {{ 'funding.followup.media.usage.preferenceSeparate' | translate }}
        </p>
      </header>
      @if (preference(); as item) {
        @if (item.state !== 'none') {
          <p
            class="preference-state"
            [class.preference-state--accepted]="item.state === 'accepted'"
            [class.preference-state--rejected]="item.state === 'rejected'"
          >
            {{
              'funding.followup.media.usage.preferenceStates.' + item.state
                | translate
            }}
          </p>
        } @else {
          <p class="help-copy" data-og7="admin-media-preference-empty">
            {{ 'admin.dossier.media.preferenceEmpty' | translate }}
          </p>
        }
        @if (item.preferredAssetId) {
          <dl class="preference-photo">
            <div>
              <dt>
                {{ 'funding.followup.media.usage.preferred' | translate }}
              </dt>
              <dd>{{ item.preferredAssetId }}</dd>
            </div>
          </dl>
        }
        @if (item.correction) {
          <p class="request-copy">{{ item.correction }}</p>
        }
        @if (item.state !== 'none' && !item.available) {
          <p class="preference-unavailable">
            {{
              'funding.followup.media.usage.preferenceUnavailable' | translate
            }}
          </p>
        }
        @if (item.sponsorExplanation) {
          <p class="request-copy">{{ item.sponsorExplanation }}</p>
        }
        @if (item.state === 'pending' && canWrite()) {
          <label class="explanation-field"
            >{{ 'funding.followup.media.usage.externalExplanation' | translate
            }}<textarea
              rows="3"
              minlength="10"
              maxlength="1000"
              [value]="explanation()"
              (input)="explanation.set($any($event.target).value)"
              [disabled]="disabled() || busy()"
            ></textarea>
          </label>
          <label class="confirmation-field"
            ><input
              type="checkbox"
              [checked]="confirmed()"
              (change)="confirmed.set($any($event.target).checked)"
              [disabled]="disabled() || busy()"
              data-og7="admin-media-preference-confirmation"
            /><span>{{
              'funding.followup.media.usage.preferenceConfirmation' | translate
            }}</span></label
          >
          <div class="preference-actions">
            <button
              type="button"
              class="admin-button admin-button--primary"
              [disabled]="!canDecide() || !item.available"
              (click)="decide('accepted')"
              data-og7="admin-media-preference-accept"
            >
              {{ 'funding.followup.media.usage.acceptPreference' | translate }}
            </button>
            <button
              type="button"
              class="admin-button preference-reject"
              [disabled]="!canDecide()"
              (click)="decide('rejected')"
              data-og7="admin-media-preference-reject"
            >
              {{ 'funding.followup.media.usage.rejectPreference' | translate }}
            </button>
          </div>
        }
      }
      @if (notice()) {
        <p
          class="preference-notice"
          [attr.role]="notice() === 'preferenceReviewed' ? 'status' : 'alert'"
        >
          {{ 'funding.followup.media.usage.' + notice() | translate }}
        </p>
      }
      @if (pending()) {
        <button
          type="button"
          class="admin-button"
          [disabled]="disabled() || busy()"
          (click)="retry()"
          data-og7="admin-media-preference-retry"
        >
          {{ 'funding.followup.media.usage.retry' | translate }}
        </button>
      }
      @if (loadFailed()) {
        <p role="alert">{{ 'admin.dossier.unavailable' | translate }}</p>
        <button
          type="button"
          class="admin-button"
          [disabled]="disabled() || busy()"
          (click)="refresh()"
        >
          {{ 'funding.followup.retry' | translate }}
        </button>
      }
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-media-preference.component.css'
  ]
})
export class AdminSponsorMediaPreferenceComponent implements OnDestroy {
  readonly contributionId = input.required<string>();
  readonly disabled = input(false);
  readonly changed = output<void>();
  readonly busyChange = output<boolean>();
  readonly preference = signal<SponsorMediaPreference | null>(null);
  readonly busy = signal(false);
  readonly loadFailed = signal(false);
  readonly notice = signal('');
  readonly explanation = signal('');
  readonly confirmed = signal(false);
  readonly pending = signal<AdminSponsorMediaPreferenceDecisionRequest | null>(
    null
  );
  private readonly admin = inject(FundingAdminService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly canWrite = computed(() => this.admin.identity()?.role !== 'reader');
  readonly canDecide = computed(
    () =>
      this.canWrite() &&
      !this.disabled() &&
      !this.busy() &&
      this.confirmed() &&
      this.explanation().trim().length >= 10
  );
  private generation = 0;
  private disposed = false;
  constructor() {
    effect(() => {
      this.contributionId();
      untracked(() => {
        this.generation++;
        this.preference.set(null);
        this.pending.set(null);
        this.explanation.set('');
        this.confirmed.set(false);
        this.setBusy(false);
        void this.refresh();
      });
    });
  }
  async refresh(): Promise<void> {
    if (!this.browser || this.disposed) return;
    const generation = this.generation,
      contributionId = this.contributionId();
    this.loadFailed.set(false);
    try {
      const result = await this.admin.getSponsorMedia(
        this.admin.getSavedAdminToken(),
        contributionId
      );
      if (!this.disposed && generation === this.generation)
        this.preference.set(result.preference ?? null);
    } catch {
      if (!this.disposed && generation === this.generation)
        this.loadFailed.set(true);
    }
  }
  async decide(state: 'accepted' | 'rejected'): Promise<void> {
    const preference = this.preference();
    if (!preference || preference.state !== 'pending' || !this.canDecide())
      return;
    const payload: AdminSponsorMediaPreferenceDecisionRequest = {
      requestId: crypto.randomUUID(),
      contributionId: this.contributionId(),
      expectedRevision: preference.revision,
      state,
      sponsorExplanation: this.explanation().trim(),
      confirmation: this.contributionId()
    };
    const existing = this.pending();
    if (
      existing &&
      JSON.stringify({ ...payload, requestId: existing.requestId }) !==
        JSON.stringify(existing)
    ) {
      this.notice.set('verificationRequired');
      return;
    }
    this.pending.set(existing ?? payload);
    await this.send(existing ?? payload);
  }
  async retry(): Promise<void> {
    const pending = this.pending();
    if (pending) await this.send(pending);
  }
  ngOnDestroy(): void {
    this.disposed = true;
    this.generation++;
  }
  private async send(
    payload: AdminSponsorMediaPreferenceDecisionRequest
  ): Promise<void> {
    if (
      this.disposed ||
      this.busy() ||
      this.disabled() ||
      !this.canWrite() ||
      payload.contributionId !== this.contributionId()
    )
      return;
    const generation = this.generation;
    this.setBusy(true);
    this.notice.set('');
    try {
      const result = await this.admin.decideSponsorMediaPreference(payload);
      if (this.disposed || generation !== this.generation) return;
      if (!result.updated)
        throw new Error('Preference decision is unconfirmed.');
      this.pending.set(null);
      this.preference.set(result.preference);
      this.confirmed.set(false);
      this.notice.set('preferenceReviewed');
      this.changed.emit();
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        const rejection =
          error instanceof AdminDashboardRequestError
            ? sponsorMediaMutationRejection(error.status, error.code)
            : null;
        if (rejection) {
          this.pending.set(null);
          this.notice.set(rejection);
          this.confirmed.set(false);
          await this.refresh();
        } else this.notice.set('mutationUnavailable');
      }
    } finally {
      if (!this.disposed && generation === this.generation) this.setBusy(false);
    }
  }
  private setBusy(value: boolean): void {
    this.busy.set(value);
    this.busyChange.emit(value);
  }
}
