import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { FundingModerationActionsComponent } from '../admin-moderation/funding-moderation-actions.component.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';

import type { PublicationDeliveryController } from './publication-delivery-controller.js';

/** Delivery review organism; its controller retains the exact displayed decision. */
@Component({
  selector: 'openg7-publication-delivery-drawer',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    TranslatePipe,
    AdminDrawerComponent,
    AdminAutomaticPreparationDirective,
    FundingModerationActionsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publication-delivery-drawer.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './publication-delivery-drawer.component.css'
  ]
})
export class PublicationDeliveryDrawerComponent {
  readonly controller = input.required<PublicationDeliveryController>();
  readonly automaticFor = input<string | null>(null);
  readonly automaticTarget = computed(() => {
    const job = this.controller().selected();
    const contributionId = this.automaticFor();
    if (
      contributionId &&
      job?.sponsors.some((sponsor) => sponsor.id === contributionId)
    )
      return contributionId;
    return job?.sponsors.length === 1 ? job.sponsors[0].id : null;
  });
}
