import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminAssistantDraftProposal } from '@openg7/funding-core';

/** Presentation molecule: a proposal is always unsent, unpublished and unsaved. */
@Component({
  selector: 'openg7-admin-assistant-draft',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <article class="inset" data-og7="assistant-draft">
    <h3>{{ draft().title }}</h3>
    <p class="notice">{{ 'admin.context.draftNotice' | translate }}</p>
    <dl>
      @for (field of draft().fields; track $index) {
        <div>
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value }}</dd>
        </div>
      }
    </dl>
    @if (showBody()) {
      @for (line of draft().bodyLines; track $index) {
        <p class="message">{{ line }}</p>
      }
    }
    <p>{{ draft().notice }}</p>
    <ul>
      @for (limit of draft().limitations; track $index) {
        <li>{{ limit }}</li>
      }
    </ul>
    <a class="admin-link" [routerLink]="router.parseUrl(draft().adminUrl)">{{
      'admin.context.openAction' | translate
    }}</a>
  </article>`,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-assistant.css'
  ]
})
export class AdminAssistantDraftComponent {
  readonly draft = input.required<AdminAssistantDraftProposal>();
  readonly showBody = input(true);
  readonly router = inject(Router);
}
