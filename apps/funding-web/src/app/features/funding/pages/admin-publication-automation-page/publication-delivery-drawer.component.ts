import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';

import type { PublicationDeliveryController } from './publication-delivery-controller.js';

/** Delivery review organism; its controller retains the exact displayed decision. */
@Component({
  selector: 'openg7-publication-delivery-drawer',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publication-delivery-drawer.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './publication-delivery-drawer.component.css'
  ]
})
export class PublicationDeliveryDrawerComponent {
  readonly controller = input.required<PublicationDeliveryController>();
}
