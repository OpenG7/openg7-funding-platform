import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminSponsorshipAdoptionComponent } from '../../components/admin-sponsors/admin-sponsorship-adoption.component.js';
import { AdminSponsorshipHistoricalAuditComponent } from '../../components/admin-sponsors/admin-sponsorship-historical-audit.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminSponsorsQualityI18nService } from '../../services/admin-sponsors-quality-i18n.service.js';

/** Portfolio page: owner inventory and historical audit, without editing commercial terms. */
@Component({
  selector: 'openg7-admin-sponsors-quality-page',
  standalone: true,
  imports: [
    RouterLink,
    AdminLayoutComponent,
    AdminSponsorshipAdoptionComponent,
    AdminSponsorshipHistoricalAuditComponent
  ],
  template: `
    <openg7-admin-layout>
      <section
        class="quality-page"
        data-og7="sponsors-quality-page"
        aria-labelledby="sponsors-quality-title"
      >
        <header>
          <h1 id="sponsors-quality-title">{{ labels.t('title') }}</h1>
          <p>{{ labels.t('description') }}</p>
          @if (returnSponsorshipId(); as id) {
            <a
              class="admin-link"
              routerLink="/admin/fundraiser/sponsors"
              [queryParams]="{ sponsorshipId: id, tab: 'publication' }"
              fragment="dossier-agreement"
            >
              {{ labels.t('backToDossier') }}
            </a>
          } @else {
            <a class="admin-link" routerLink="/admin/fundraiser/sponsors">{{
              labels.t('back')
            }}</a>
          }
        </header>
        @if (canOwn()) {
          <openg7-admin-sponsorship-adoption [canOwn]="canOwn()" />
          <openg7-admin-sponsorship-historical-audit
            scope="portfolio"
            [canOwn]="canOwn()"
          />
        } @else {
          <p role="status" data-og7="sponsors-quality-owner-required">
            {{ labels.t('ownerRequired') }}
          </p>
        }
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-sponsors-quality-page.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminSponsorsQualityPageComponent {
  readonly labels = inject(AdminSponsorsQualityI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
  readonly canOwn = computed(
    () =>
      this.admin.hasValidAdminSession() &&
      (!this.admin.identity() || this.admin.identity()?.role === 'owner')
  );
  readonly returnSponsorshipId = computed(() => {
    const values = this.params().getAll('returnSponsorshipId');
    return values.length === 1 &&
      /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(values[0]!)
      ? values[0]!
      : null;
  });
}
