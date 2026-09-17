import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorDetailOverviewView } from '../../models/admin-sponsors-ui.models.js';

/** Dossier identity presentation; media moderation lives in its dedicated tab. */
@Component({
  selector: 'openg7-admin-sponsor-detail-identity',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-og7="dossier-identity">
      <h3>{{ 'admin.dossier.tabs.identity' | translate }}</h3>
      <dl>
        <div>
          <dt>{{ 'admin.dossier.company' | translate }}</dt>
          <dd>{{ identity().companyName }}</dd>
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
    </section>
  `,
  styles: [
    `
      section {
        padding: 1rem;
      }
      dl {
        display: grid;
        gap: 1rem;
      }
      dt {
        color: #4a5670;
      }
      dd {
        margin: 0.3rem 0 0;
        overflow-wrap: anywhere;
        font-weight: 600;
      }
    `
  ]
})
export class AdminSponsorDetailIdentityComponent {
  readonly identity = input.required<AdminSponsorDetailOverviewView>();
}
