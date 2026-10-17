import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  PUBLICATION_RELIABILITY_INCIDENT_CODES,
  type PublicationReliability
} from '@openg7/funding-core';

import type { PublicationReliabilityController } from './publication-reliability-controller.js';

/** Existing admin organism: global facts, read-only incident examination and contextual links. */
@Component({
  selector: 'openg7-publication-reliability-panel',
  standalone: true,
  imports: [TranslatePipe, RouterLink, FormsModule],
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
      @if (controller(); as c) {
        <div
          class="incident-filters"
          data-og7="publication-reliability-filters"
        >
          <label>
            {{ 'admin.publicationReliability.codeFilter' | translate }}
            <select
              name="reliabilityCode"
              [ngModel]="c.code()"
              (ngModelChange)="c.setCode($event)"
              [disabled]="c.busy()"
            >
              <option value="">
                {{ 'admin.publicationReliability.allCodes' | translate }}
              </option>
              @for (code of codes; track code) {
                <option [value]="code">
                  {{ 'admin.publicationReliability.codes.' + code | translate }}
                </option>
              }
            </select>
          </label>
          <label>
            {{ 'admin.publicationReliability.subjectFilter' | translate }}
            <select
              name="reliabilitySubject"
              [ngModel]="c.subjectType()"
              (ngModelChange)="c.setSubjectType($event)"
              [disabled]="c.busy()"
            >
              <option value="">
                {{ 'admin.publicationReliability.allSubjects' | translate }}
              </option>
              @for (type of subjects; track type) {
                <option [value]="type">
                  {{
                    'admin.publicationReliability.subjects.' + type | translate
                  }}
                </option>
              }
            </select>
          </label>
          <button
            class="admin-button"
            type="button"
            (click)="c.refresh()"
            [disabled]="c.busy()"
          >
            {{ 'admin.publicationReliability.refreshIncidents' | translate }}
          </button>
        </div>
        @if (c.busy()) {
          <p role="status">
            {{ 'admin.publicationReliability.loading' | translate }}
          </p>
        }
        @if (c.error()) {
          <p role="alert">{{ c.error() | translate }}</p>
        }
        @if (c.page(); as page) {
          <p role="status" data-og7="publication-reliability-page-status">
            {{
              'admin.publicationReliability.pageScope'
                | translate
                  : { filtered: page.filteredTotal, total: page.globalTotal }
            }}
            {{ 'admin.publicationReliability.evaluated' | translate }}
            {{ dateLabel()(page.evaluatedAt) }}
          </p>
        }
      }
      @if (incidents().length) {
        <h3>
          {{
            'admin.publicationReliability.incidents'
              | translate
                : {
                    shown: incidents().length,
                    total:
                      controller()?.page()?.filteredTotal ?? r.incidentTotal
                  }
          }}
        </h3>
        <ul>
          @for (
            incident of incidents();
            track incident.code + incident.subjectId
          ) {
            <li
              data-og7="publication-reliability-incident"
              [attr.data-og7-id]="incident.code + ':' + incident.subjectId"
            >
              {{
                'admin.publicationReliability.codes.' + incident.code
                  | translate
              }}
              <code>{{ incident.subjectId }}</code>
              <p>
                {{
                  'admin.publicationReliability.reasons.' + incident.code
                    | translate
                }}
              </p>
              <p>
                <strong>{{
                  'admin.publicationReliability.action' | translate
                }}</strong>
                {{
                  'admin.publicationReliability.actions.' + incident.code
                    | translate
                }}
              </p>
              <div class="incident-links">
                @if (incident.sponsorshipId; as id) {
                  <a
                    routerLink="/admin/fundraiser/sponsors"
                    [queryParams]="{ sponsorshipId: id, tab: 'publication' }"
                  >
                    {{
                      'admin.publicationReliability.openDossier'
                        | translate: { id }
                    }}
                  </a>
                }
                @if (incident.deliveryId; as id) {
                  <a
                    routerLink="/admin/fundraiser/publications/automation"
                    [queryParams]="{ deliveryId: id }"
                  >
                    {{
                      'admin.publicationReliability.openDelivery'
                        | translate: { id }
                    }}
                  </a>
                }
                @if (incident.batchId; as id) {
                  <a
                    routerLink="/admin/fundraiser/publications/batches"
                    [queryParams]="{ batchId: id }"
                  >
                    {{
                      'admin.publicationReliability.openBatch'
                        | translate: { id }
                    }}
                  </a>
                }
                @if (incident.slotId; as id) {
                  <a
                    routerLink="/admin/fundraiser/publications/calendar"
                    [queryParams]="{ slotId: id }"
                  >
                    {{
                      'admin.publicationReliability.openSlot'
                        | translate: { id }
                    }}
                  </a>
                }
              </div>
            </li>
          }
        </ul>
      } @else if (!controller()?.busy() && !controller()?.error()) {
        <p>
          {{
            (controller()?.page()
              ? 'admin.publicationReliability.emptyFiltered'
              : 'admin.publicationReliability.noIncident'
            ) | translate
          }}
        </p>
      }
      @if (controller(); as c) {
        @if (c.page(); as page) {
          <nav
            class="incident-pages"
            [attr.aria-label]="'admin.publicationReliability.pages' | translate"
          >
            <button
              type="button"
              class="admin-button"
              [disabled]="c.busy() || !c.canPrevious()"
              (click)="c.previous()"
            >
              {{ 'admin.publicationReliability.previous' | translate }}
            </button>
            <span>{{
              'admin.publicationReliability.position'
                | translate
                  : {
                      start: page.filteredTotal ? c.offset() + 1 : 0,
                      end: c.offset() + page.incidents.length,
                      total: page.filteredTotal
                    }
            }}</span>
            <button
              type="button"
              class="admin-button"
              [disabled]="c.busy() || !page.nextCursor || !!c.error()"
              (click)="c.next()"
            >
              {{ 'admin.publicationReliability.next' | translate }}
            </button>
          </nav>
        }
      }
    </details>
  }`,
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    './publication-reliability-panel.component.css'
  ]
})
export class PublicationReliabilityPanelComponent {
  readonly reliability = input<PublicationReliability | undefined>();
  readonly controller = input<PublicationReliabilityController | undefined>();
  readonly codes = PUBLICATION_RELIABILITY_INCIDENT_CODES;
  readonly subjects = ['obligation', 'delivery', 'batch', 'slot'] as const;
  readonly incidents = computed(
    () =>
      this.controller()?.page()?.incidents ??
      (this.controller()?.started()
        ? []
        : (this.reliability()?.incidents ?? []))
  );
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
    if (r.obligations.overdue !== undefined)
      rows.push({ key: 'overdueObligations', value: r.obligations.overdue });
    if (r.obligations.missingDeadlineOrigin !== undefined)
      rows.push({
        key: 'missingDeadlineOrigin',
        value: r.obligations.missingDeadlineOrigin
      });
    if (r.obligations.awaitingDuration !== undefined)
      rows.push({
        key: 'awaitingDuration',
        value: r.obligations.awaitingDuration
      });
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
