import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab,
  SponsorshipProgressState
} from '@openg7/funding-core';

import {
  nextDossierSection,
  type DossierSection
} from '../../models/admin-sponsorship-navigation.js';
import {
  isDossierPublicationComplete,
  publicationBlockerSection,
  publicationBlockerTab
} from '../../models/admin-sponsorship-workspace.js';
import { ContributionActivityService } from '../../services/contribution-activity.service.js';

type BlockerFamilyId =
  'identity' | 'review' | 'media' | 'preparation' | 'publication' | 'finance';

interface BlockerFact {
  readonly reasonKey: string;
  readonly state?: SponsorshipProgressState;
  readonly tab: SponsorshipDossierTab;
  readonly section: DossierSection;
}

interface BlockerFamily {
  readonly id: BlockerFamilyId;
  readonly facts: readonly BlockerFact[];
}

/** Funding molecule: present the server's next step and navigate to existing actions. */
@Component({
  selector: 'openg7-admin-sponsorship-next-step',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-next-step.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-next-step.component.css'
  ]
})
export class AdminSponsorshipNextStepComponent {
  readonly dossier = input.required<AdminSponsorshipProgress>();
  readonly embedded = input(false);
  readonly compact = input(false);
  readonly workspace = input(false);
  private readonly expandedBlockersFor = signal<string | null>(null);
  readonly allBlockersVisible = computed(
    () => this.expandedBlockersFor() === this.dossier().contributionId
  );
  readonly publicationComplete = computed(() =>
    isDossierPublicationComplete(this.dossier())
  );
  readonly activity = inject(ContributionActivityService);
  readonly nextSection = computed(() =>
    nextDossierSection(this.dossier().next)
  );
  readonly nextResponsibility = computed(() =>
    this.dossier().next.tab === 'publication'
      ? this.dossier().publicationWorkflow?.responsibility
      : undefined
  );
  readonly params = computed(() => ({
    sponsorshipId: this.dossier().contributionId,
    tab: this.dossier().next.tab
  }));

  /** Domain order is explicit: this view neither scores nor reprioritizes work. */
  readonly blockerFamilies = computed<readonly BlockerFamily[]>(() => {
    const dossier = this.dossier();
    const groups = new Map<BlockerFamilyId, BlockerFact[]>();
    const add = (id: BlockerFamilyId, fact: BlockerFact) => {
      const facts = groups.get(id) ?? [];
      if (!facts.some((item) => item.reasonKey === fact.reasonKey))
        facts.push(fact);
      groups.set(id, facts);
    };
    const familyForReason = (reason: string): BlockerFamilyId | undefined =>
      reason.startsWith('commitment_') ? 'preparation' : undefined;
    for (const step of dossier.milestones) {
      if (step.state === 'complete' || step.state === 'not_required') continue;
      const id =
        familyForReason(step.reason) ??
        (step.id === 'payment' || step.id === 'billing' ? 'finance' : step.id);
      const section = nextDossierSection({
        ...dossier.next,
        reason: step.reason,
        tab: step.tab
      });
      if (section)
        add(id, {
          reasonKey: 'admin.dossier.reasons.' + step.reason,
          state: step.state,
          tab: step.tab,
          section
        });
    }
    if (!this.publicationComplete()) {
      for (const reason of dossier.publicationBlockers ?? []) {
        const id =
          familyForReason(reason) ??
          (reason === 'identity' || reason === 'consent'
            ? 'identity'
            : reason === 'review'
              ? 'review'
              : reason === 'media'
                ? 'media'
                : reason === 'payment' || reason === 'refund'
                  ? 'finance'
                  : 'publication');
        add(id, {
          reasonKey: 'admin.dossier.publicationBridge.blocker.' + reason,
          state: 'blocked',
          tab:
            reason === 'consent' ? 'identity' : publicationBlockerTab(reason),
          section:
            reason === 'consent'
              ? 'identity'
              : publicationBlockerSection(reason)
        });
      }
    }
    if (dossier.failedStripeEvents.length)
      add('finance', {
        reasonKey: 'admin.dossier.reasons.stripe_failed',
        tab: 'overview',
        section: 'stripe'
      });
    for (const email of dossier.failedEmails)
      add('finance', {
        reasonKey:
          'admin.dossier.reasons.' +
          (email.status === 'uncertain' ? 'email_uncertain' : 'email_failed'),
        tab: 'billing',
        section: 'billing'
      });
    if (dossier.refund.creditMissing)
      add('finance', {
        reasonKey: 'admin.dossier.reasons.credit_missing',
        tab: 'billing',
        section: 'billing'
      });
    if (
      dossier.refund.hasError ||
      (dossier.refund.workflow !== 'none' &&
        dossier.refund.state !== 'complete' &&
        dossier.refund.state !== 'not_required')
    )
      add('finance', {
        reasonKey: 'admin.dossier.reasons.refund_check',
        state:
          dossier.refund.state === 'complete' ||
          dossier.refund.state === 'not_required'
            ? undefined
            : dossier.refund.state,
        tab: 'refund',
        section: 'refund'
      });
    return (
      [
        'identity',
        'review',
        'media',
        'preparation',
        'publication',
        'finance'
      ] as const
    ).flatMap((id) => {
      const facts = groups.get(id);
      return facts?.length ? [{ id, facts }] : [];
    });
  });

  toggleBlockers(): void {
    this.expandedBlockersFor.set(
      this.allBlockersVisible() ? null : this.dossier().contributionId
    );
  }
}
