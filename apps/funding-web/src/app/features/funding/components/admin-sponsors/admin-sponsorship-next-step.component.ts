import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import { nextDossierSection } from '../../models/admin-sponsorship-navigation.js';
import { ContributionActivityService } from '../../services/contribution-activity.service.js';

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
  readonly activity = inject(ContributionActivityService);
  readonly nextSection = computed(() =>
    nextDossierSection(this.dossier().next)
  );
  readonly params = computed(() => ({
    sponsorshipId: this.dossier().contributionId,
    tab: this.dossier().next.tab
  }));
}
