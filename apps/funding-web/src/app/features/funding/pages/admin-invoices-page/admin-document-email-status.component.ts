import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Admin molecule: translates the last server-confirmed email status. */
@Component({
  selector: 'openg7-admin-document-email-status',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="email-status"
      [class.status-sent]="status() === 'sent'"
      [class.status-failed]="status() === 'failed'"
      [class.status-queued]="status() === 'queued' || status() === 'sending'"
    >
      {{ labelKey() | translate }}
    </span>
  `,
  styleUrl: './admin-document-email-status.component.css'
})
export class AdminDocumentEmailStatusComponent {
  readonly status = input.required<string | null>();
  readonly labelKey = computed(() => {
    switch (this.status()) {
      case 'sent':
        return 'admin.messages.envoye';
      case 'failed':
        return 'admin.messages.echec';
      case 'sending':
        return 'admin.legacy.envoi';
      case 'queued':
        return 'admin.legacy.en_file';
      default:
        return 'admin.messages.jamais_envoye';
    }
  });
}
