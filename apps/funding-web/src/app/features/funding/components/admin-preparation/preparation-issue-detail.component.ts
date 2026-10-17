import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import type { PreparationPilotIssue } from './preparation-pilot.models.js';

@Component({
  selector: 'openg7-preparation-issue-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      data-og7="preparation-issue-detail"
      aria-live="polite"
      aria-atomic="true"
    >
      @if (issue(); as current) {
        <h5>{{ t(current.titleKey) }}</h5>
        <p>
          {{
            t(
              current.completed
                ? 'pilot.completeHelp'
                : 'pilot.summaries.' + current.actionKind
            )
          }}
        </p>
        @if (current.summaryCodes.length) {
          <details>
            <summary>{{ t('pilot.why') }}</summary>
            @for (code of current.summaryCodes; track code) {
              <p>{{ blocker(code) }}</p>
            }
          </details>
        }
      } @else {
        <h5>{{ t(ready() ? 'pilot.ready' : 'pilot.waiting') }}</h5>
        <p>{{ t(ready() ? 'pilot.readyHelp' : 'pilot.waitingHelp') }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    section {
      padding: 0.65rem;
      border-radius: var(--admin-radius-control);
      background: var(--admin-panel-raised);
    }
    h5 {
      margin: 0 0 0.35rem;
      font-size: 0.85rem;
    }
    p {
      margin: 0.3rem 0;
      color: var(--admin-muted);
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    summary {
      cursor: pointer;
      font-size: 0.8rem;
    }
    summary:focus-visible {
      outline: 3px solid var(--admin-focus);
      outline-offset: 2px;
    }
  `
})
export class PreparationIssueDetailComponent {
  readonly issue = input<PreparationPilotIssue | null>(null);
  readonly ready = input(false);
  private readonly i18n = inject(FundingI18nService);

  t(key: string): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key);
  }

  blocker(code: string): string {
    const key = 'blockers.' + code;
    const value = this.t(key);
    return value === 'admin.automatic.portfolio.receipt.' + key
      ? this.t('unknownFact')
      : value;
  }
}
