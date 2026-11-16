import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild
} from '@angular/core';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-publication-decision.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-publication-decision.fr-CA.json' with { type: 'json' };
import type { AdminSponsorApprovalState } from '../../models/admin-sponsor-dossier-panels.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Publication-only review presentation; the dossier keeps permissions, drafts and commands. */
@Component({
  selector: 'openg7-admin-sponsor-publication-decision',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    AdminAutomaticPreparationDirective,
    AdminIconComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-og7': 'publication-decision' },
  templateUrl: './admin-sponsor-publication-decision.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-sponsor-publication-decision.component.css'
  ]
})
export class AdminSponsorPublicationDecisionComponent {
  readonly sponsorship = input.required<AdminSponsorshipRecord>();
  readonly canReview = input.required<boolean>();
  readonly actionsDisabled = input.required<boolean>();
  readonly canApprove = input.required<boolean>();
  readonly approvalState = input.required<AdminSponsorApprovalState>();
  readonly reviewMessage = input.required<string>();
  readonly unavailableReason = input('');

  readonly approve = output<void>();
  readonly openRejection = output<void>();
  readonly returnPending = output<void>();

  private readonly i18n = inject(FundingI18nService);
  private readonly region = viewChild<ElementRef<HTMLElement>>('region');
  private readonly otherDecisions =
    viewChild<ElementRef<HTMLDetailsElement>>('otherDecisions');
  private readonly rejectButton =
    viewChild<ElementRef<HTMLButtonElement>>('rejectButton');
  private readonly approvalButton =
    viewChild<ElementRef<HTMLButtonElement>>('approvalButton');
  readonly reviewedAt = computed(() => {
    const value = this.sponsorship().sponsor_reviewed_at;
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.valueOf())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Toronto'
        }).format(date)
      : null;
  });
  private feedbackDossier = '';
  private pendingFeedback = false;

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { publicationDecision: language === 'en' ? en : fr }
        })
      );
    });
    afterRenderEffect(() => {
      const id = this.sponsorship().id;
      const phase = this.approvalState();
      if (id !== this.feedbackDossier) {
        this.feedbackDossier = id;
        this.pendingFeedback = false;
      }
      if (phase === 'pending') this.pendingFeedback = true;
      else if (this.pendingFeedback && ['success', 'error'].includes(phase)) {
        this.pendingFeedback = false;
        const region = this.region()?.nativeElement;
        const active = region?.ownerDocument.activeElement;
        if (region && (!active || active === region.ownerDocument.body)) {
          if (phase === 'error') this.focusApprovalButton();
          else region.focus({ preventScroll: true });
        }
      }
    });
  }

  t(key: string): string {
    return this.i18n.t('admin.publicationDecision.' + key);
  }

  focusRejectButton(): void {
    this.focusDecision(this.rejectButton()?.nativeElement);
  }

  focusApprovalButton(): void {
    this.focusDecision(this.approvalButton()?.nativeElement);
  }

  private focusDecision(button: HTMLButtonElement | undefined): void {
    if (!button || button.disabled) return;
    const details = this.otherDecisions()?.nativeElement;
    if (details?.contains(button)) details.open = true;
    button.focus({ preventScroll: true });
  }
}
