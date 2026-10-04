import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import {
  AdminInspectionService,
  type InspectionField
} from '../../services/admin-inspection.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

import { AdminInspectionController } from './admin-inspection-controller.js';

/** Funding organism: reads protected resources and presents minimal inspection facts. */
@Component({
  selector: 'openg7-admin-inspector',
  standalone: true,
  imports: [AdminDrawerComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-inspector.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-inspector.component.css'
  ]
})
export class AdminInspectorComponent {
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly controller = new AdminInspectionController({
    admin: {
      getStripeEvent: (token, id) => this.admin.getStripeEvent(token, id),
      getSponsorshipInvoices: (token, contributionId) =>
        this.admin.getSponsorshipInvoices(token, contributionId),
      getSponsorshipInvoicePdf: (token, invoiceId) =>
        this.admin.getSponsorshipInvoicePdf(token, invoiceId),
      getSponsorMediaPreview: (token, id) =>
        this.admin.getSponsorMediaPreview(token, id)
    },
    token: () => this.admin.getSavedAdminToken(),
    onSessionExpired: async () => {
      this.inspection.close();
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly state = this.controller.state;
  readonly fields = this.controller.fields;
  readonly invoice = this.controller.invoice;
  readonly resourceUrl = this.controller.resourceUrl;
  readonly processingFailed = this.controller.processingFailed;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.controller.dispose();
      this.inspection.close();
    });
    if (!this.browser) return;
    effect(() => {
      const context = this.inspection.current();
      untracked(() => void this.controller.load(context));
    });
  }

  load(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    return this.controller.load(this.inspection.current());
  }

  money(value: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(value);
  }
  fieldValue(field: InspectionField): string | number {
    if (field.value == null) return this.i18n.t('admin.inspector.absent');
    if (field.currency && typeof field.value === 'number')
      return this.money(field.value, field.currency);
    return field.value;
  }
}
