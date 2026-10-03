import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminAssistantMode,
  AdminAssistantQueryResponse
} from '@openg7/funding-core';

import { AdminAssistantAnswerComponent } from '../../components/admin-assistant/admin-assistant-answer.component.js';

import type { AssistantLoadState } from './admin-assistant.contracts.js';

/** Local presentation surface; the routed page owns HTTP and navigation. */
@Component({
  selector: 'openg7-admin-assistant-question',
  standalone: true,
  imports: [TranslatePipe, AdminAssistantAnswerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-question.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-surface.css',
    './admin-assistant-question.component.css'
  ]
})
export class AdminAssistantQuestionComponent {
  readonly conversationState = input.required<AssistantLoadState>();
  readonly conversationMode = input.required<AdminAssistantMode | null>();
  readonly question = input.required<string>();
  readonly answerState = input.required<AssistantLoadState>();
  readonly answer = input.required<AdminAssistantQueryResponse | null>();
  readonly returnTo = input.required<string>();
  readonly opened = output<boolean>();
  readonly questionChanged = output<string>();
  readonly submitted = output<void>();
  toggle(event: Event): void {
    this.opened.emit((event.target as HTMLDetailsElement).open);
  }
  changeQuestion(event: Event): void {
    this.questionChanged.emit((event.target as HTMLInputElement).value);
  }
  submit(event: Event): void {
    event.preventDefault();
    this.submitted.emit();
  }
}
