import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab,
  SponsorshipMilestoneId,
  SponsorshipProgressState
} from '@openg7/funding-core';

import {
  nextDossierSection,
  type DossierSection
} from '../../models/admin-sponsorship-navigation.js';

interface GuideStep {
  readonly id: string;
  readonly topic:
    | SponsorshipMilestoneId
    | 'identitySubmission'
    | 'refund'
    | 'stripe'
    | 'email'
    | 'incident';
  readonly title: string;
  readonly reason: string;
  readonly state: SponsorshipProgressState;
  readonly tab: SponsorshipDossierTab;
  readonly section: DossierSection;
}

/** Funding presentation molecule: explains API milestones and opens existing controls. */
@Component({
  selector: 'openg7-admin-sponsorship-guide',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-guide.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-guide.component.css'
  ]
})
export class AdminSponsorshipGuideComponent {
  readonly expanded = input(false);
  readonly expandedChange = output<boolean>();
  readonly dossier = input.required<AdminSponsorshipProgress>();
  readonly canManage = input(false);
  readonly canUseOwnerActions = input(false);
  readonly disabled = input(false);
  readonly editIdentity = output<void>();
  readonly openAccess = output<void>();
  private readonly selected = signal<{
    dossierId: string;
    stepId: string;
  } | null>(null);

  onToggle(event: Event): void {
    this.expandedChange.emit((event.target as HTMLDetailsElement).open);
  }

  readonly steps = computed<readonly GuideStep[]>(() => {
    const d = this.dossier();
    const steps: GuideStep[] = d.milestones.map((step) => ({
      ...step,
      topic:
        step.reason === 'identity_submission_pending'
          ? 'identitySubmission'
          : step.id,
      title: 'admin.dossier.steps.' + step.id,
      section: step.id
    }));
    if (
      d.next.reason !== 'complete' &&
      !steps.some(
        (step) => step.reason === d.next.reason && step.tab === d.next.tab
      )
    ) {
      const topic =
        d.next.reason === 'refund_check'
          ? 'refund'
          : d.next.reason === 'stripe_failed'
            ? 'stripe'
            : d.next.reason === 'email_failed'
              ? 'email'
              : 'incident';
      steps.unshift({
        id: 'incident',
        topic,
        title: 'admin.dossier.guide.topics.' + topic + '.title',
        reason: d.next.reason,
        state:
          topic === 'refund'
            ? d.refund.state
            : topic === 'incident'
              ? 'pending'
              : 'error',
        tab: d.next.tab,
        section: nextDossierSection(d.next) ?? 'audit'
      });
    }
    return steps;
  });
  readonly recommendedIndex = computed(() => {
    const next = this.dossier().next;
    return Math.max(
      0,
      this.steps().findIndex(
        (step) => step.reason === next.reason && step.tab === next.tab
      )
    );
  });
  readonly index = computed(() => {
    const selected = this.selected();
    const index =
      selected?.dossierId === this.dossier().contributionId
        ? this.steps().findIndex((step) => step.id === selected.stepId)
        : -1;
    return index < 0 ? this.recommendedIndex() : index;
  });
  readonly current = computed(() => this.steps()[this.index()]);
  readonly complete = computed(() => this.dossier().next.reason === 'complete');
  readonly instructionNumbers = [1, 2, 3] as const;

  move(offset: number): void {
    const step = this.steps()[this.index() + offset];
    if (step)
      this.selected.set({
        dossierId: this.dossier().contributionId,
        stepId: step.id
      });
  }
  recommend(): void {
    this.selected.set(null);
  }
}
