import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipInvoiceRecord } from '@openg7/funding-core';

import {
  AdminInspectionService,
  type InspectionField
} from '../../services/admin-inspection.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

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
  readonly state = signal<
    | 'idle'
    | 'loading'
    | 'ready'
    | 'error'
    | 'missing'
    | 'unavailable'
    | 'forbidden'
  >('idle');
  readonly fields = signal<readonly InspectionField[]>([]);
  readonly invoice = signal<AdminSponsorshipInvoiceRecord | null>(null);
  readonly resourceUrl = signal<string | null>(null);
  readonly processingFailed = signal(false);
  private generation = 0;

  constructor() {
    effect(() => {
      const context = this.inspection.current();
      untracked(() => {
        this.clear();
        if (context) void this.load(context);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.clear();
      this.inspection.close();
    });
  }

  async load(context = this.inspection.current()): Promise<void> {
    if (!context) return;
    this.clear();
    const generation = this.generation;
    this.state.set('loading');
    const token = this.admin.getSavedAdminToken();
    try {
      if (!token) throw new AdminDashboardRequestError(401);
      if (context.kind === 'stripe') {
        const response = await this.admin.getStripeEvent(token, context.id);
        if (generation !== this.generation) return;
        if (!response.available) {
          this.state.set('unavailable');
          return;
        }
        if (!response.event) {
          this.state.set('missing');
          return;
        }
        const event = response.event;
        this.fields.set([
          { label: 'id', value: event.id },
          { label: 'type', value: event.type },
          { label: 'status', value: event.status },
          { label: 'receivedAt', value: event.receivedAt },
          { label: 'processedAt', value: event.processedAt }
        ]);
        this.processingFailed.set(event.error === 'processing_failed');
      } else if (context.kind === 'invoice') {
        const response = await this.admin.getSponsorshipInvoices(
          token,
          context.contributionId
        );
        if (generation !== this.generation) return;
        const invoice = response.invoices.find(
          (item) => item.id === context.id || (context.id === context.contributionId && item.contribution_id === context.contributionId)
        );
        if (!invoice) {
          this.state.set('missing');
          return;
        }
        this.invoice.set(invoice);
        this.fields.set([
          { label: 'number', value: invoice.invoice_number },
          { label: 'company', value: invoice.sponsor_name },
          { label: 'issuer', value: invoice.issuer_name },
          { label: 'reference', value: invoice.public_reference },
          { label: 'issuedAt', value: invoice.issued_at },
          { label: 'amount', value: invoice.total, currency: invoice.currency },
          { label: 'currency', value: invoice.currency }
        ]);
        const blob = await this.admin.getSponsorshipInvoicePdf(
          token,
          invoice.id
        );
        if (generation !== this.generation) return;
        if (blob.type !== 'application/pdf')
          throw new Error('Invalid PDF response');
        this.resourceUrl.set(URL.createObjectURL(blob));
      } else if (context.kind === 'media') {
        const blob = await this.admin.getSponsorMediaPreview(token, context.id);
        if (generation !== this.generation) return;
        if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type))
          throw new Error('Invalid image response');
        this.resourceUrl.set(URL.createObjectURL(blob));
      } else {
        this.fields.set(context.fields ?? []);
      }
      if (generation !== this.generation) return;
      if (!this.admin.getSavedAdminToken())
        throw new AdminDashboardRequestError(401);
      this.state.set('ready');
    } catch (error) {
      if (generation !== this.generation) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.releaseResource();
      if (status === 401 || status === 403) {
        this.fields.set([]);
        this.invoice.set(null);
        if (status === 401) {
          this.inspection.close();
          this.admin.clearAdminSession();
          await this.router.navigate(['/admin/login'], {
            queryParams: { returnUrl: this.router.url }
          });
          return;
        }
      }
      this.state.set(
        status === 403 ? 'forbidden' : status === 404 ? 'missing' : 'error'
      );
    }
  }

  private releaseResource(): void {
    const url = this.resourceUrl();
    if (url) URL.revokeObjectURL(url);
    this.resourceUrl.set(null);
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
  private clear(): void {
    this.generation++;
    this.releaseResource();
    this.fields.set([]);
    this.invoice.set(null);
    this.processingFailed.set(false);
    this.state.set('idle');
  }
}
