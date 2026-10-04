import { computed, signal } from '@angular/core';
import type { AdminSponsorshipInvoiceRecord } from '@openg7/funding-core';

import type {
  AdminInspection,
  InspectionField
} from '../../services/admin-inspection.service.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminInspectionPorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'getStripeEvent'
    | 'getSponsorshipInvoices'
    | 'getSponsorshipInvoicePdf'
    | 'getSponsorMediaPreview'
  >;
  token(): string;
  onSessionExpired(): void | Promise<void>;
}

export type AdminInspectionState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'missing'
  | 'unavailable'
  | 'forbidden';

interface InspectionReadScope {
  readonly generation: number;
  readonly token: string;
}

/** Owns protected inspection reads and previews; the component owns the drawer. */
export class AdminInspectionController {
  readonly state = signal<AdminInspectionState>('idle');
  readonly fields = signal<readonly InspectionField[]>([]);
  readonly invoice = signal<AdminSponsorshipInvoiceRecord | null>(null);
  readonly processingFailed = signal(false);
  private readonly preview = new BlobPreviewResource();
  readonly resourceUrl = computed(() => this.preview.url() || null);
  private generation = 0;
  private disposed = false;

  constructor(private readonly ports: AdminInspectionPorts) {}

  async load(context: AdminInspection | null): Promise<void> {
    if (this.disposed) return;
    this.clear();
    if (!context) return;
    const scope: InspectionReadScope = {
      generation: this.generation,
      token: this.ports.token()
    };
    this.state.set('loading');
    try {
      if (!scope.token) throw new AdminDashboardRequestError(401);
      if (context.kind === 'stripe') {
        const response = await this.ports.admin.getStripeEvent(
          scope.token,
          context.id
        );
        if (!this.current(scope)) return;
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
        const response = await this.ports.admin.getSponsorshipInvoices(
          scope.token,
          context.contributionId
        );
        if (!this.current(scope)) return;
        const invoice = response.invoices.find(
          (item) =>
            item.id === context.id ||
            (context.id === context.contributionId &&
              item.contribution_id === context.contributionId)
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
        await this.loadPreview(
          scope,
          () =>
            this.ports.admin.getSponsorshipInvoicePdf(scope.token, invoice.id),
          ['application/pdf']
        );
      } else if (context.kind === 'media') {
        await this.loadPreview(
          scope,
          () =>
            this.ports.admin.getSponsorMediaPreview(scope.token, context.id),
          ['image/webp', 'image/png', 'image/jpeg']
        );
      } else {
        this.fields.set(context.fields ?? []);
      }
      if (this.current(scope)) this.state.set('ready');
    } catch (error) {
      if (!this.currentGeneration(scope.generation)) return;
      const token = this.ports.token();
      if (token && token !== scope.token) {
        this.clear();
        return;
      }
      const status = !token
        ? 401
        : error instanceof AdminDashboardRequestError
          ? error.status
          : 0;
      this.preview.clear();
      if (status === 401 || status === 403) {
        this.clear();
        if (status === 401) {
          await this.ports.onSessionExpired();
          return;
        }
      }
      this.state.set(
        status === 403 ? 'forbidden' : status === 404 ? 'missing' : 'error'
      );
    }
  }

  clear(): void {
    if (!this.disposed) this.clearPrivateState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPrivateState();
    this.preview.dispose();
  }

  private clearPrivateState(): void {
    ++this.generation;
    this.preview.clear();
    this.fields.set([]);
    this.invoice.set(null);
    this.processingFailed.set(false);
    this.state.set('idle');
  }

  private currentGeneration(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private current(scope: InspectionReadScope): boolean {
    if (!this.currentGeneration(scope.generation)) return false;
    const token = this.ports.token();
    if (!token) throw new AdminDashboardRequestError(401);
    if (token !== scope.token) {
      this.clear();
      return false;
    }
    return true;
  }

  private async loadPreview(
    scope: InspectionReadScope,
    source: () => Promise<Blob>,
    acceptedMimeTypes: readonly string[]
  ): Promise<void> {
    let failed = false;
    let failure: unknown;
    await this.preview.load(
      async () => {
        const blob = await source();
        if (!this.current(scope)) throw new Error('Obsolete inspection.');
        if (!acceptedMimeTypes.includes(blob.type))
          throw new Error(
            acceptedMimeTypes.includes('application/pdf')
              ? 'Invalid PDF response'
              : 'Invalid image response'
          );
        return blob;
      },
      (error) => {
        failed = true;
        failure = error;
      }
    );
    if (failed) throw failure;
  }
}
