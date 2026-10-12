import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { PublicationReliability } from '@openg7/funding-core';

/** Read-only molecule: complete aggregate scope and safe internal correlations. */
@Component({
  selector: 'openg7-publication-reliability-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (reliability(); as r) {
    <details data-og7="publication-reliability">
      <summary>{{ 'admin.publicationReliability.title' | translate }}</summary>
      <p>{{ 'admin.publicationReliability.scope' | translate }}</p>
      <p>
        {{ 'admin.publicationReliability.evaluated' | translate }}
        {{ dateLabel()(r.evaluatedAt) }}
      </p>
      <dl>
        @for (row of rows(); track row.key) {
          <div>
            <dt>
              {{
                'admin.publicationReliability.metrics.' + row.key | translate
              }}
            </dt>
            <dd>{{ row.value }}</dd>
          </div>
        }
      </dl>
      <p>{{ 'admin.publicationReliability.limits' | translate }}</p>
      @if (r.incidentTotal) {
        <h3>
          {{
            'admin.publicationReliability.incidents'
              | translate: { shown: r.incidents.length, total: r.incidentTotal }
          }}
        </h3>
        <ul>
          @for (
            incident of r.incidents;
            track incident.code + incident.subjectId
          ) {
            <li>
              {{
                'admin.publicationReliability.codes.' + incident.code
                  | translate
              }}
              <code>{{ incident.subjectId }}</code>
            </li>
          }
        </ul>
      } @else {
        <p>{{ 'admin.publicationReliability.noIncident' | translate }}</p>
      }
    </details>
  }`,
  styles: [
    `
      details {
        padding: 1rem;
        border: 1px solid var(--admin-border);
        border-radius: 0.75rem;
        color: var(--admin-text);
        background: var(--admin-surface);
      }
      summary {
        cursor: pointer;
        font-weight: 650;
      }
      summary:focus-visible {
        outline: 2px solid var(--admin-accent);
        outline-offset: 3px;
      }
      dl {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
        gap: 0.75rem;
      }
      dl div {
        min-width: 0;
      }
      dt {
        font-size: 0.86rem;
        color: var(--admin-muted);
      }
      dd {
        margin: 0;
        font-weight: 650;
      }
      ul {
        padding-left: 1.1rem;
      }
      li {
        margin: 0.4rem 0;
      }
      code {
        display: block;
        overflow-wrap: anywhere;
      }
      p {
        font-size: 0.86rem;
        line-height: 1.5;
      }
    `
  ]
})
export class PublicationReliabilityPanelComponent {
  readonly reliability = input<PublicationReliability | undefined>();
  readonly dateLabel = input<(value: string) => string>((value) => value);
  readonly rows = computed(() => {
    const r = this.reliability();
    if (!r) return [];
    const rows = [
      { key: 'open', value: r.obligations.open },
      { key: 'undated', value: r.obligations.undatedSocial },
      { key: 'fulfilled', value: r.obligations.fulfilledWithEvidence },
      { key: 'waived', value: r.obligations.waived },
      { key: 'unqualified', value: r.obligations.unqualifiedDossiers },
      { key: 'batches', value: r.capacity.saturatedBatches },
      { key: 'slots', value: r.capacity.saturatedSlots },
      { key: 'conflicts', value: r.capacity.accountConflicts },
      { key: 'publishing', value: r.deliveries.publishing },
      { key: 'uncertain', value: r.deliveries.uncertain },
      { key: 'uncertainAccounts', value: r.deliveries.uncertainAccounts },
      { key: 'overdue', value: r.deliveries.overdueApproved },
      {
        key: 'proofMismatch',
        value: r.discrepancies.proof + r.discrepancies.orphanProof
      },
      {
        key: 'obligationMismatch',
        value: r.discrepancies.obligationReservation
      },
      {
        key: 'accountMismatch',
        value: r.discrepancies.accountReservation + r.discrepancies.accountLease
      }
    ];
    for (const [key, oldest] of [
      ['oldestOpenHours', r.obligations.oldestOpenAt],
      ['oldestUndatedHours', r.obligations.oldestUndatedAt],
      ['oldestUncertainHours', r.deliveries.oldestUncertainAccountAt]
    ] as const)
      if (oldest)
        rows.push({
          key,
          value: Math.max(
            0,
            Math.floor(
              (Date.parse(r.evaluatedAt) - Date.parse(oldest)) / 3_600_000
            )
          )
        });
    return rows;
  });
}
