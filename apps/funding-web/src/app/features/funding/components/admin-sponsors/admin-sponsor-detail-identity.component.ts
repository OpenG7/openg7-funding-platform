import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import type { AdminSponsorDetailOverviewView } from '../../models/admin-sponsors-ui.models.js';

/** Dossier identity presentation; media moderation lives in its dedicated tab. */
@Component({
  selector: 'openg7-admin-sponsor-detail-identity',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      data-og7="dossier-identity"
      id="dossier-identity"
      class="admin-focus-target"
      tabindex="-1"
      aria-labelledby="dossier-identity-title"
    >
      <header class="identity-heading">
        <h3 id="dossier-identity-title">
          {{ 'admin.dossier.identityHelp.coordinates' | translate }}
        </h3>
        @if (canEdit()) {
          <button
            type="button"
            class="admin-button"
            data-og7="identity-edit"
            [disabled]="disabled()"
            (click)="editRequested.emit()"
          >
            {{ 'admin.dossier.identityHelp.edit' | translate }}
          </button>
        }
      </header>
      <p data-og7="identity-coordinates-status">
        {{
          'admin.dossier.identityHelp.' +
            (coordinatesComplete()
              ? 'coordinatesComplete'
              : 'coordinatesMissing') | translate
        }}
      </p>
      <dl class="identity-coordinates">
        <div>
          <dt>{{ 'admin.dossier.company' | translate }}</dt>
          <dd>
            {{
              sponsorship().sponsor_company_name ||
                ('admin.dossier.notProvided' | translate)
            }}
          </dd>
        </div>
        <div>
          <dt>{{ 'admin.dossier.publicName' | translate }}</dt>
          <dd>{{ identity().publicNameLabel }}</dd>
        </div>
        <div>
          <dt>{{ 'admin.dossier.contact' | translate }}</dt>
          <dd>{{ identity().contactName }}</dd>
        </div>
        <div>
          <dt>{{ 'admin.dossier.email' | translate }}</dt>
          <dd>
            {{
              identity().contactEmail ||
                ('admin.dossier.notProvided' | translate)
            }}
          </dd>
        </div>
        <div>
          <dt>{{ 'admin.dossier.website' | translate }}</dt>
          <dd>
            {{
              identity().websiteUrl || ('admin.dossier.notProvided' | translate)
            }}
          </dd>
        </div>
      </dl>
      @if (!canEdit()) {
        <p>{{ 'admin.dossier.identityHelp.readonly' | translate }}</p>
      }
      <h4>{{ 'admin.dossier.identityHelp.submission' | translate }}</h4>
      <p data-og7="identity-submission-status">
        {{
          'admin.dossier.identityHelp.' +
            (sponsorship().sponsor_details_submitted_at
              ? 'submitted'
              : 'submissionPending') | translate
        }}
      </p>
      @if (!sponsorship().sponsor_details_submitted_at) {
        <p data-og7="identity-submission-required" class="submission-required">
          {{ 'admin.dossier.identityHelp.submissionRequired' | translate }}
        </p>
        <p>{{ 'admin.dossier.identityHelp.submissionHelp' | translate }}</p>
        @if (canResendAccess()) {
          <button
            type="button"
            class="admin-button"
            data-og7="identity-followup-access"
            (click)="accessRequested.emit()"
          >
            {{ 'admin.dossier.identityHelp.access' | translate }}
          </button>
        } @else {
          <p>{{ 'admin.dossier.identityHelp.ownerHelp' | translate }}</p>
        }
      }
      <aside
        class="identity-explanation"
        aria-labelledby="identity-explanation-title"
      >
        <details>
          <summary id="identity-explanation-title">
            {{ 'admin.dossier.identityHelp.differenceTitle' | translate }}
          </summary>
          <dl>
            <div>
              <dt>{{ 'admin.dossier.identityHelp.adminEntry' | translate }}</dt>
              <dd>
                {{ 'admin.dossier.identityHelp.adminEntryMeaning' | translate }}
              </dd>
            </div>
            <div>
              <dt>
                {{ 'admin.dossier.identityHelp.sponsorEntry' | translate }}
              </dt>
              <dd>
                {{
                  'admin.dossier.identityHelp.sponsorEntryMeaning' | translate
                }}
              </dd>
            </div>
          </dl>
        </details>
      </aside>
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-identity.component.css'
  ]
})
export class AdminSponsorDetailIdentityComponent {
  readonly identity = input.required<AdminSponsorDetailOverviewView>();
  readonly sponsorship =
    input.required<
      Pick<
        AdminSponsorshipRecord,
        | 'sponsor_company_name'
        | 'sponsor_contact_email'
        | 'sponsor_details_submitted_at'
      >
    >();
  readonly canEdit = input(false);
  readonly canResendAccess = input(false);
  readonly disabled = input(false);
  readonly editRequested = output<void>();
  readonly accessRequested = output<void>();
  readonly coordinatesComplete = computed(() =>
    Boolean(
      this.sponsorship().sponsor_company_name?.trim() &&
      this.sponsorship().sponsor_contact_email?.trim()
    )
  );
}
