import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminAssistantQueryResponse } from '@openg7/funding-core';

/** Presentation molecule: keeps facts, interpretation, recommendation and limits separate. */
@Component({
  selector: 'openg7-admin-assistant-answer',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <article
    class="inset"
    data-og7="assistant-answer"
    aria-live="polite"
  >
    <p>{{ 'admin.context.queryStatus.' + answer().status | translate }}</p>
    @for (block of answer().answer; track $index) {
      <section [attr.data-og7]="'assistant-' + block.kind">
        <h3>{{ 'admin.context.blocks.' + block.kind | translate }}</h3>
        <p>{{ block.title }}</p>
        <ul>
          @for (line of block.lines; track $index) {
            <li>{{ line }}</li>
          }
        </ul>
      </section>
    }
    <nav class="actions" [attr.aria-label]="'admin.context.links' | translate">
      @for (link of answer().links; track $index) {
        <a class="admin-link" [routerLink]="router.parseUrl(link.adminUrl)">{{
          link.label
        }}</a>
      }
    </nav>
    <h3>{{ 'admin.context.limits' | translate }}</h3>
    <ul>
      @for (limit of answer().limitations; track $index) {
        <li>{{ limit }}</li>
      }
    </ul>
  </article>`,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-assistant.css'
  ]
})
export class AdminAssistantAnswerComponent {
  readonly answer = input.required<AdminAssistantQueryResponse>();
  readonly router = inject(Router);
}
