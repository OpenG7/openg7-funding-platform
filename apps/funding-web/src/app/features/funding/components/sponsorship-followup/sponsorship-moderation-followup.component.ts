import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  MODERATION_REASONS,
  type ModerationReasonCode,
  type SponsorshipModerationResponse
} from '@openg7/funding-core';

import { FundingService } from '../../services/funding.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { followupAccessExpired } from '../../models/sponsorship-followup-ui.js';

/** Token-scoped explanations and reconsideration. Never renders an administrative decision DTO. */
@Component({
  selector: 'openg7-sponsorship-moderation-followup',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-moderation-followup.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipModerationFollowupComponent {
  readonly token = input.required<string>();
  readonly refreshKey = input(0);
  readonly correctionRequested = output<string>();
  readonly accessLost = output<void>();
  private readonly funding = inject(FundingService);
  private readonly i18n = inject(FundingI18nService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly data = signal<SponsorshipModerationResponse | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly notice = signal(false);
  readonly activeDecision = signal<string | null>(null);
  readonly explanation = signal('');
  readonly confirmed = signal(false);
  private generation = 0;
  private attempt: {
    decisionId: string;
    explanation: string;
    requestId: string;
  } | null = null;
  constructor() {
    effect(() => {
      this.token();
      this.refreshKey();
      void this.load();
    });
    inject(DestroyRef).onDestroy(() => this.generation++);
  }
  async load(): Promise<void> {
    const token = this.token();
    const generation = ++this.generation;
    this.data.set(null);
    this.error.set(false);
    this.notice.set(false);
    this.activeDecision.set(null);
    this.explanation.set('');
    this.confirmed.set(false);
    this.attempt = null;
    if (!this.browser || !token) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const data = await this.funding.getSponsorshipModeration(token);
      if (generation === this.generation) this.data.set(data);
    } catch (error) {
      if (generation === this.generation) {
        this.error.set(true);
        if (followupAccessExpired(error)) this.accessLost.emit();
      }
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  reason(code: ModerationReasonCode | null): string {
    const reason = MODERATION_REASONS.find((item) => item.code === code);
    return (
      reason?.label[this.i18n.currentLanguage() === 'en' ? 'en' : 'fr'] ?? ''
    );
  }
  edit(event: Event): void {
    this.explanation.set((event.target as HTMLTextAreaElement).value);
    this.confirmed.set(false);
  }
  check(event: Event): void {
    this.confirmed.set((event.target as HTMLInputElement).checked);
  }
  hasOpenRequest(id: string): boolean {
    return !!this.data()?.reconsiderations.some(
      (request) => request.decisionId === id && request.state === 'open'
    );
  }
  async reconsider(): Promise<void> {
    const decisionId = this.activeDecision();
    const explanation = this.explanation().trim();
    const generation = this.generation;
    const token = this.token();
    if (
      !decisionId ||
      !explanation ||
      explanation.length > 2000 ||
      !this.confirmed() ||
      this.busy() ||
      !this.data()?.items.some(
        (item) =>
          item.decision.id === decisionId && item.canRequestReconsideration
      ) ||
      this.hasOpenRequest(decisionId)
    )
      return;
    if (
      !this.attempt ||
      this.attempt.decisionId !== decisionId ||
      this.attempt.explanation !== explanation
    )
      this.attempt = {
        decisionId,
        explanation,
        requestId: globalThis.crypto.randomUUID()
      };
    this.busy.set(true);
    this.error.set(false);
    try {
      await this.funding.requestSponsorshipReconsideration({
        token,
        ...this.attempt
      });
      if (generation !== this.generation) return;
      const nextGeneration = this.generation + 1;
      await this.load();
      if (this.generation === nextGeneration && this.token() === token)
        this.notice.set(true);
    } catch (error) {
      if (generation === this.generation) {
        this.error.set(true);
        if (followupAccessExpired(error)) this.accessLost.emit();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
