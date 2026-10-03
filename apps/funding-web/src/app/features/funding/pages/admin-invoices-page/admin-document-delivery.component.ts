import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminDocumentDeliveryView } from './admin-invoice.models.js';

/** Admin molecule: recipient draft and resend feedback, without request state. */
@Component({
  selector: 'openg7-admin-document-delivery',
  standalone: true,
  imports: [CommonModule, TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label>
      {{ recipientLabelKey() | translate }}
      <input
        type="email"
        autocomplete="email"
        [value]="delivery().email"
        (input)="changeEmail($event)"
      />
    </label>
    <div class="resend-actions">
      <button
        type="button"
        class="primary-action"
        [disabled]="delivery().state === 'sending' || !delivery().email.trim()"
        (click)="resend.emit()"
      >
        {{
          (delivery().state === 'sending'
            ? 'admin.legacy.envoi_195'
            : resendLabelKey()
          ) | translate
        }}
      </button>
      <span
        class="resend-message"
        [class.error]="delivery().state === 'error'"
        [class.success]="delivery().state === 'sent'"
        *ngIf="delivery().message"
        aria-live="polite"
      >
        {{ delivery().message }}
      </span>
      <a
        *ngIf="delivery().messageId as messageId"
        routerLink="/admin/fundraiser/email-queue"
        [queryParams]="{ messageId }"
        data-og7="document-email-status"
        [attr.data-og7-id]="delivery().id"
        >{{ 'admin.messages.suivre_courriel' | translate }}</a
      >
    </div>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-document-delivery.component.css'
  ]
})
export class AdminDocumentDeliveryComponent {
  readonly delivery = input.required<AdminDocumentDeliveryView>();
  readonly recipientLabelKey = input.required<string>();
  readonly resendLabelKey = input.required<string>();
  readonly emailChange = output<string>();
  readonly resend = output<void>();

  changeEmail(event: Event): void {
    this.emailChange.emit((event.target as HTMLInputElement).value);
  }
}
