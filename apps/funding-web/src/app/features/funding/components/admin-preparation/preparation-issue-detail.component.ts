import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output
} from '@angular/core';
import type { PreparationAssistanceSummary } from '@openg7/funding-core';

import type {
  ControllerAction,
  ControllerActionRequest,
  ControllerContext
} from '../../models/context-controller.models.js';
import { ContextControllerActionComponent } from '../admin-context-controller/context-controller-action.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import type { PreparationPilotIssue } from './preparation-pilot.models.js';

@Component({
  selector: 'openg7-preparation-issue-detail',
  standalone: true,
  imports: [ContextControllerActionComponent, AdminIconComponent],
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
        @if (
          current.checkCode === 'accepted_offer' &&
          canAssist() &&
          (assistanceSummary() || assistanceError() || assistanceBusy())
        ) {
          <div
            data-og7="preparation-assistance-summary"
            [attr.aria-busy]="assistanceBusy()"
          >
            <h6>{{ t('pilot.assistance.title') }}</h6>
            <p>{{ t('pilot.assistance.local') }}</p>
            <p
              role="status"
              data-og7="preparation-assistance-summary-state"
              [attr.data-og7-state]="assistanceSummary()?.run?.state ?? 'none'"
            >
              <openg7-admin-icon
                name="settings"
                [class.processing]="
                  !assistanceError() &&
                  assistanceSummary()?.run?.state === 'processing'
                "
              />
              {{
                t(
                  'pilot.assistance.' +
                    (assistanceError()
                      ? 'errors.' + assistanceError()
                      : assistanceSummary()?.run
                        ? 'states.' + assistanceSummary()!.run!.state
                        : assistanceSummary()?.sourceVersion
                          ? 'noRun'
                          : assistanceBusy()
                            ? 'loading'
                            : 'noSource')
                )
              }}
            </p>
            @if (assistanceSummary(); as summary) {
              @if (summary.stale) {
                <p>{{ t('pilot.assistance.stale') }}</p>
              }
              @if (summary.run; as run) {
                @if (run.reviewDecision) {
                  <p>
                    {{ t('pilot.assistance.reviews.' + run.reviewDecision) }}
                  </p>
                }
                @if (run.state === 'succeeded') {
                  <p>
                    {{
                      t('pilot.assistance.counts', {
                        clauses: run.clauseCount,
                        unsupported: run.unsupportedCount,
                        unresolved: run.unresolvedCount
                      })
                    }}
                  </p>
                }
              }
            }
            <p>{{ t('pilot.assistance.separation') }}</p>
            <div class="assistance-actions">
              @for (action of assistanceActions(); track action.id) {
                <button
                  openg7-context-controller-action
                  data-og7="preparation-assistance-action"
                  [attr.data-og7-id]="'inline-' + action.id"
                  [action]="action"
                  [context]="context()"
                  (actionRequested)="assistanceRequested.emit($event)"
                ></button>
              }
              @if (assistanceError()) {
                <button
                  type="button"
                  data-og7="preparation-assistance-summary-refresh"
                  [disabled]="assistanceBusy()"
                  (click)="refreshRequested.emit()"
                >
                  {{ t('refresh') }}
                </button>
              }
            </div>
          </div>
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
    h6 {
      margin: 0.65rem 0 0.25rem;
      font-size: 0.8rem;
    }
    .assistance-actions {
      display: grid;
      gap: 0.35rem;
    }
    .processing {
      animation: preparation-assistance-turn 4s linear infinite;
    }
    @keyframes preparation-assistance-turn {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .processing {
        animation: none;
      }
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
  readonly canAssist = input(false);
  readonly assistanceSummary = input<PreparationAssistanceSummary | null>(null);
  readonly assistanceBusy = input(false);
  readonly assistanceError = input('');
  readonly assistanceActions = input<readonly ControllerAction[]>([]);
  readonly context = input<ControllerContext | null>(null);
  readonly assistanceRequested = output<ControllerActionRequest>();
  readonly refreshRequested = output<void>();
  private readonly i18n = inject(FundingI18nService);

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key, params);
  }

  blocker(code: string): string {
    const key = 'blockers.' + code;
    const value = this.t(key);
    return value === 'admin.automatic.portfolio.receipt.' + key
      ? this.t('unknownFact')
      : value;
  }
}
