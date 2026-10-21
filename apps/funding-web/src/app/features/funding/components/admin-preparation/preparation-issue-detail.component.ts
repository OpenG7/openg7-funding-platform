import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import type { PreparationAssistanceSummary } from '@openg7/funding-core';

import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import type { PreparationPilotIssue } from './preparation-pilot.models.js';

@Component({
  selector: 'openg7-preparation-issue-detail',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-guided]': 'guided()' },
  template: `
    <section
      data-og7="preparation-issue-detail"
      aria-live="polite"
      aria-atomic="true"
    >
      @if (issue(); as current) {
        <div class="detail-heading">
          <h5>{{ t(current.titleKey) }}</h5>
          @if (guided()) {
            <span class="detail-state" [class.is-complete]="current.completed">
              {{ t(current.completed ? 'pilot.complete' : 'pilot.required') }}
            </span>
          }
        </div>
        <div
          [attr.data-og7]="assisted() ? 'preparation-assistance-summary' : null"
          [attr.aria-busy]="assisted() ? assistanceBusy() : null"
        >
          <div
            data-og7="preparation-issue-attention"
            [class.needs-attention]="!current.completed"
          >
            @if (assisted() && !current.completed) {
              <p
                role="status"
                data-og7="preparation-assistance-summary-state"
                [attr.data-og7-state]="
                  assistanceSummary()?.run?.state ?? 'none'
                "
              >
                <openg7-admin-icon
                  name="settings"
                  [class.processing]="
                    !assistanceError() &&
                    assistanceSummary()?.run?.state === 'processing'
                  "
                />
                {{ t(assistanceStateKey()) }}
              </p>
            } @else {
              <p>
                {{
                  t(
                    current.completed
                      ? 'pilot.completeHelp'
                      : 'pilot.summaries.' + current.actionKind
                  )
                }}
              </p>
            }
          </div>
          @if (current.summaryCodes.length) {
            <details>
              <summary>{{ t('pilot.why') }}</summary>
              @for (code of current.summaryCodes; track code) {
                <p>{{ blocker(code) }}</p>
              }
            </details>
          }
          @if (assisted()) {
            @if (current.completed) {
              <p
                role="status"
                data-og7="preparation-assistance-summary-state"
                [attr.data-og7-state]="
                  assistanceSummary()?.run?.state ?? 'none'
                "
              >
                {{ t(assistanceStateKey()) }}
              </p>
            }
            <details>
              <summary>{{ t('pilot.assistance.title') }}</summary>
              <p>{{ t('pilot.assistance.local') }}</p>
              @if (assistanceSummary(); as summary) {
                @if (summary.stale && assistanceError()) {
                  <p>{{ t('pilot.assistance.stale') }}</p>
                }
                @if (summary.run; as run) {
                  @if (
                    run.reviewDecision && (summary.stale || assistanceError())
                  ) {
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
            </details>
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
          }
        </div>
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
    :host(.is-guided) section {
      padding: 0;
      background: transparent;
    }
    :host(.is-guided) .detail-heading {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.5rem 0.8rem;
      flex-wrap: wrap;
      margin-block-end: 0.4rem;
    }
    :host(.is-guided) h5 {
      margin: 0;
      color: var(--admin-text);
      font-size: 1rem;
      line-height: 1.4;
    }
    .detail-state {
      color: var(--admin-muted);
      font-size: 0.75rem;
      font-weight: 600;
    }
    .detail-state.is-complete {
      color: var(--admin-success);
    }
    .needs-attention {
      border-inline-start: 3px solid var(--admin-warning);
      padding: 0.4rem 0.55rem;
      background: var(--admin-warning-bg);
    }
    .needs-attention p {
      color: var(--admin-text);
    }
    :host(.is-guided) .needs-attention {
      padding: 0;
      border: 0;
      background: transparent;
    }
    :host(.is-guided) [data-og7='preparation-issue-attention'] p {
      margin-block: 0.35rem 0.5rem;
      font-size: 0.85rem;
      line-height: 1.6;
    }
    :host(.is-guided) details {
      display: inline-block;
      max-width: 100%;
      margin-inline-end: 1rem;
      vertical-align: top;
    }
    :host(.is-guided) details[open] {
      display: block;
      margin-inline-end: 0;
    }
    :host(.is-guided) summary {
      box-sizing: border-box;
      min-height: 2.75rem;
      padding-block: 0.7rem;
      color: var(--admin-accent);
      line-height: 1.4;
    }
    :host(.is-guided) button {
      min-height: 2.75rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--admin-control-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-panel);
      color: var(--admin-text);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }
    :host(.is-guided) button:focus-visible {
      outline: 3px solid var(--admin-focus);
      outline-offset: 2px;
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
  readonly guided = input(false);
  readonly ready = input(false);
  readonly canAssist = input(false);
  readonly assistanceSummary = input<PreparationAssistanceSummary | null>(null);
  readonly assistanceBusy = input(false);
  readonly assistanceError = input('');
  readonly refreshRequested = output<void>();
  readonly assisted = computed(
    () =>
      this.issue()?.checkCode === 'accepted_offer' &&
      this.canAssist() &&
      !!(
        this.assistanceSummary() ||
        this.assistanceError() ||
        this.assistanceBusy()
      )
  );
  readonly assistanceStateKey = computed(() => {
    const summary = this.assistanceSummary();
    const error = this.assistanceError();
    const state = error
      ? 'errors.' + error
      : summary?.stale
        ? 'stale'
        : summary?.run?.reviewDecision
          ? 'reviews.' + summary.run.reviewDecision
          : summary?.run
            ? 'states.' + summary.run.state
            : summary?.sourceVersion
              ? 'noRun'
              : this.assistanceBusy()
                ? 'loading'
                : 'noSource';
    return 'pilot.assistance.' + state;
  });
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
