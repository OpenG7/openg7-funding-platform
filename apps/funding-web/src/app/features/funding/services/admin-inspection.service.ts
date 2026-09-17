import { Injectable, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import type {
  AdminAuditLogEntry,
  AdminEmailQueueMessageRecord,
  AdminExpenseRecord,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

export interface InspectionField {
  readonly label: string;
  readonly value: string | number | null;
  readonly currency?: string;
}
export interface AdminInspection {
  readonly kind:
    'invoice' | 'email' | 'audit' | 'proof' | 'media' | 'history' | 'stripe';
  readonly id: string;
  readonly fullUrl: string;
  readonly fields?: readonly InspectionField[];
  readonly history?: readonly AdminAuditLogEntry[];
  readonly externalUrl?: string | null;
  readonly alt?: string;
  readonly contributionId?: string;
}

/** Transient admin inspection context; never stored in a URL or browser storage. */
@Injectable({ providedIn: 'root' })
export class AdminInspectionService {
  private readonly router = inject(Router);
  readonly current = signal<AdminInspection | null>(null);
  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) this.close();
    });
  }
  close(): void {
    this.current.set(null);
  }
  invoice(id: string, contributionId: string): void {
    this.current.set({
      kind: 'invoice',
      id,
      contributionId,
      fullUrl: '/admin/fundraiser/invoices?contributionId=' + contributionId
    });
  }
  stripe(id: string, fullUrl: string): void {
    this.current.set({ kind: 'stripe', id, fullUrl });
  }
  email(message: AdminEmailQueueMessageRecord): void {
    this.current.set({
      kind: 'email',
      id: message.id,
      fullUrl: '/admin/fundraiser/email-queue?messageId=' + message.id,
      fields: [
        { label: 'recipient', value: message.recipient_email },
        { label: 'subject', value: message.subject },
        { label: 'status', value: message.status },
        { label: 'template', value: message.template_key },
        {
          label: 'attempts',
          value: message.attempts + ' / ' + message.max_attempts
        },
        { label: 'nextAttempt', value: message.next_attempt_at },
        { label: 'error', value: message.last_error }
      ]
    });
  }
  audit(entry: AdminAuditLogEntry): void {
    this.current.set({
      kind: 'audit',
      id: entry.id,
      fullUrl: '/admin/fundraiser/audit?entryId=' + entry.id,
      history: [entry]
    });
  }
  history(sponsorship: AdminSponsorshipRecord): void {
    this.current.set({
      kind: 'history',
      id: sponsorship.id,
      fullUrl:
        '/admin/fundraiser/sponsors?sponsorshipId=' +
        sponsorship.id +
        '&tab=audit',
      history: sponsorship.admin_audit_entries
    });
  }
  proof(expense: AdminExpenseRecord): void {
    this.current.set({
      kind: 'proof',
      id: expense.id,
      fullUrl: '/admin/fundraiser/expenses?expenseId=' + expense.id,
      externalUrl: this.safeExternalUrl(expense.proof_url),
      fields: [
        { label: 'project', value: expense.project_name },
        { label: 'description', value: expense.public_description },
        { label: 'source', value: expense.proof_source },
        { label: 'publishedAt', value: expense.proof_published_at },
        {
          label: 'amount',
          value: expense.amount_allocated,
          currency: expense.currency
        },
        { label: 'currency', value: expense.currency }
      ]
    });
  }
  media(id: string, contributionId: string, alt: string): void {
    this.current.set({
      kind: 'media',
      id,
      contributionId,
      alt,
      fullUrl:
        '/admin/fundraiser/sponsors?sponsorshipId=' +
        contributionId +
        '&tab=media'
    });
  }
  private safeExternalUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
}
