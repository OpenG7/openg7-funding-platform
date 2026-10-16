import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  MODERATION_POLICY_VERSION,
  MODERATION_REASONS,
  MODERATION_EDITORIAL_PROVISIONS,
  requiresIndependentModerationReview,
  type ModerationReasonCode
} from '@openg7/funding-core';

import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  FundingModerationService,
  type ModerationRequest
} from '../../services/funding-moderation.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import type { ModerationContent } from '../../services/funding-admin-moderation.client.js';

/** Funding decision form: exact content, contextual reason and separate private/public explanations. */
@Component({
  selector: 'openg7-funding-moderation-panel',
  standalone: true,
  imports: [AdminDrawerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-moderation-panel.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './funding-moderation-panel.component.css'
  ]
})
export class FundingModerationPanelComponent {
  readonly moderation = inject(FundingModerationService);
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  readonly content = signal<ModerationContent | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly primaryReason = signal<ModerationReasonCode | ''>('');
  readonly secondaryReasons = signal<ModerationReasonCode[]>([]);
  readonly internalReason = signal('');
  readonly sponsorExplanation = signal('');
  readonly editorialProvision = signal('');
  readonly confirmed = signal(false);
  readonly policyVersion = MODERATION_POLICY_VERSION;
  readonly provisions = MODERATION_EDITORIAL_PROVISIONS;
  private generation = 0;
  readonly adverse = computed(() => this.moderation.pending()?.level !== 'N0');
  readonly explanationRequired = computed(
    () =>
      this.adverse() ||
      this.moderation.pending()?.initial?.requireExplanation === true
  );
  readonly independent = computed(() =>
    requiresIndependentModerationReview({
      level: this.moderation.pending()?.level ?? 'N0',
      primaryReason: this.primaryReason() || null,
      secondaryReasons: this.secondaryReasons()
    })
  );
  readonly reasons = computed(() =>
    MODERATION_REASONS.filter((reason) =>
      reason.allowedLevels.includes(this.moderation.pending()?.level ?? 'N0')
    )
  );
  readonly valid = computed(
    () =>
      !this.loading() &&
      !!this.content() &&
      this.confirmed() &&
      (!this.explanationRequired() || !!this.sponsorExplanation().trim()) &&
      (!this.adverse() ||
        (!!this.primaryReason() &&
          !!this.internalReason().trim() &&
          !!this.sponsorExplanation().trim())) &&
      ((this.primaryReason() !== 'EDITORIAL_INCOMPATIBILITY' &&
        !this.secondaryReasons().includes('EDITORIAL_INCOMPATIBILITY')) ||
        !!this.editorialProvision().trim())
  );

  constructor() {
    let sessionGeneration = this.admin.sessionGeneration();
    effect(() => {
      const next = this.admin.sessionGeneration();
      if (sessionGeneration === next) return;
      sessionGeneration = next;
      untracked(() => {
        this.generation++;
        this.content.set(null);
        this.confirmed.set(false);
        this.moderation.answer(null);
      });
    });
    effect(() => {
      const request = this.moderation.pending();
      this.generation++;
      this.content.set(null);
      this.error.set('');
      this.confirmed.set(false);
      this.primaryReason.set('');
      this.secondaryReasons.set([]);
      this.editorialProvision.set('');
      this.internalReason.set(request?.initial?.internalReason ?? '');
      this.sponsorExplanation.set(request?.initial?.sponsorExplanation ?? '');
      this.loading.set(!!request);
      if (request) void this.loadContent(request);
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation++;
      this.moderation.answer(null);
    });
  }

  retry(): void {
    const request = this.moderation.pending();
    if (request && !this.loading()) void this.loadContent(request);
  }

  private async loadContent(request: ModerationRequest): Promise<void> {
    const generation = ++this.generation;
    this.content.set(null);
    this.confirmed.set(false);
    this.error.set('');
    this.loading.set(true);
    try {
      const content = await this.admin.moderationContent(request.subject);
      if (
        generation !== this.generation ||
        request !== this.moderation.pending()
      )
        return;
      this.content.set(content);
      this.loading.set(false);
    } catch (error) {
      if (
        generation !== this.generation ||
        request !== this.moderation.pending()
      )
        return;
      this.loading.set(false);
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.error.set(
        status === 401
          ? 'admin.access.sessionExpired'
          : status === 403
            ? 'admin.moderation.forbidden'
            : status === 404
              ? 'admin.moderation.notFound'
              : status === 409
                ? 'admin.moderation.changed'
                : 'admin.moderation.unavailable'
      );
      if (status === 401) {
        this.moderation.answer(null);
        this.admin.clearAdminSession();
        void this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
        });
      }
    }
  }

  reasonChanged(event: Event): void {
    this.primaryReason.set(
      (event.target as HTMLSelectElement).value as ModerationReasonCode | ''
    );
    this.secondaryReasons.update((codes) =>
      codes.filter((code) => code !== this.primaryReason())
    );
    this.confirmed.set(false);
  }

  secondaryChanged(code: ModerationReasonCode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.secondaryReasons.update((codes) =>
      checked
        ? [...codes.filter((item) => item !== code), code]
        : codes.filter((item) => item !== code)
    );
    this.confirmed.set(false);
  }

  label(reason: (typeof MODERATION_REASONS)[number]): string {
    return reason.label[this.i18n.currentLanguage() === 'en' ? 'en' : 'fr'];
  }
  definition(reason: (typeof MODERATION_REASONS)[number]): string {
    return reason.definition[
      this.i18n.currentLanguage() === 'en' ? 'en' : 'fr'
    ];
  }
  snapshot(): string {
    return JSON.stringify(this.content()?.snapshot, null, 2);
  }
  value(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }
  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  accept(): void {
    const request = this.moderation.pending();
    const content = this.content();
    if (!request || !content || !this.valid()) return;
    this.moderation.answer({
      requestId: globalThis.crypto.randomUUID(),
      policyVersion: this.policyVersion,
      contentFingerprint: content.fingerprint,
      contentVersion: content.contentVersion,
      level: request.level,
      confirmation: request.subject.id,
      ...(content.currentDecisionId
        ? { expectedDecisionId: content.currentDecisionId }
        : {}),
      ...(!this.adverse() && this.explanationRequired()
        ? { sponsorExplanation: this.sponsorExplanation().trim() }
        : {}),
      ...(this.adverse()
        ? {
            primaryReason: this.primaryReason() as ModerationReasonCode,
            secondaryReasons: this.secondaryReasons(),
            internalReason: this.internalReason().trim(),
            sponsorExplanation: this.sponsorExplanation().trim(),
            ...(this.editorialProvision().trim()
              ? { editorialProvision: this.editorialProvision().trim() }
              : {})
          }
        : {})
    });
  }
}
