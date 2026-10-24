import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';

import type { PublicationDeliveryController } from './publication-delivery-controller.js';

/** Contextual disclosure; decisions remain in the delivery controller. */
@Component({
  selector: 'openg7-publication-delivery-secondary-actions',
  standalone: true,
  imports: [FormsModule, TranslatePipe, AdminAutomaticPreparationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publication-delivery-secondary-actions.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './publication-delivery-secondary-actions.component.css'
  ]
})
export class PublicationDeliverySecondaryActionsComponent {
  readonly controller = input.required<PublicationDeliveryController>();
  readonly automaticFor = input<string | null>(null);
  readonly opened = signal(false);

  constructor() {
    effect(() => {
      this.controller().selected();
      this.opened.set(false);
    });
  }

  syncOpened(event: Event): void {
    this.opened.set((event.target as HTMLDetailsElement).open);
  }

  closeDisclosure(event: Event, disclosure: HTMLDetailsElement): void {
    if (!disclosure.open) return;
    event.preventDefault();
    event.stopPropagation();
    this.opened.set(false);
    disclosure.querySelector('summary')?.focus();
  }
}
