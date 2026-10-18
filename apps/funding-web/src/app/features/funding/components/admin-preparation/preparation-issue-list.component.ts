import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  viewChildren
} from '@angular/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import type { PreparationPilotIssue } from './preparation-pilot.models.js';

/** Selection only: no command is executed by choosing or moving between issues. */
@Component({
  selector: 'openg7-preparation-issue-list',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="issues" [attr.aria-label]="t('pilot.choose')" role="group">
      @for (issue of issues(); track issue.id) {
        <button
          #issueButton
          type="button"
          data-og7="preparation-issue"
          [attr.data-og7-id]="issue.id"
          [attr.aria-pressed]="selectedId() === issue.id"
          (click)="selected.emit(issue.id)"
          (keydown)="keydown($event, issue.id)"
        >
          <openg7-admin-icon [name]="issue.completed ? 'check' : 'warning'" />
          <span>{{ t(issue.titleKey) }}</span>
          <small>{{
            t(issue.completed ? 'pilot.complete' : 'pilot.required')
          }}</small>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .issues {
      display: grid;
      gap: 0.35rem;
    }
    button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.6rem;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-panel);
      color: var(--admin-text);
      text-align: start;
      cursor: pointer;
      font: inherit;
    }
    button[aria-pressed='true'] {
      border-color: var(--admin-gold);
      background: var(--admin-panel-raised);
      box-shadow: inset 3px 0 var(--admin-gold);
    }
    button:focus-visible {
      outline: 3px solid var(--admin-focus);
      outline-offset: 2px;
    }
    span {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    small {
      flex: 0 0 auto;
      color: var(--admin-muted);
      font-size: 0.7rem;
    }
  `
})
export class PreparationIssueListComponent {
  readonly issues = input.required<readonly PreparationPilotIssue[]>();
  readonly selectedId = input<string | null>(null);
  readonly selected = output<string>();
  private readonly i18n = inject(FundingI18nService);
  private readonly buttons =
    viewChildren<ElementRef<HTMLButtonElement>>('issueButton');

  t(key: string): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key);
  }

  move(offset: number, from = this.selectedId()): void {
    const issues = this.issues();
    if (!issues.length) return;
    const index = issues.findIndex((issue) => issue.id === from);
    const next = (Math.max(0, index) + offset + issues.length) % issues.length;
    this.selected.emit(issues[next]!.id);
    const button = this.buttons()[next]?.nativeElement;
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest' });
  }

  keydown(event: KeyboardEvent, id: string): void {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = this.issues().findIndex((issue) => issue.id === id);
    const offset =
      event.key === 'Home'
        ? -index
        : event.key === 'End'
          ? this.issues().length - 1 - index
          : event.key === 'ArrowUp'
            ? -1
            : 1;
    this.move(offset, id);
  }
}
