import { computed, signal } from '@angular/core';
import {
  SPONSORSHIP_PUBLIC_CONSENT_SCOPE,
  type AdminSponsorshipConsent,
  type AdminSponsorshipConsentRecordRequest,
  type AdminSponsorshipConsentRecordReceipt
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from './funding-admin-session.js';
import type { FundingAdminSponsorshipConsentClient } from './funding-admin-sponsorship-consent.client.js';

export type SponsorshipConsentIntent = Pick<
  AdminSponsorshipConsentRecordRequest,
  'agreedOn' | 'evidenceReference' | 'agreementReceived'
>;
export type SponsorshipConsentNotice =
  | 'loadFailed'
  | 'conflict'
  | 'uncertain'
  | 'notFound'
  | 'receiptMismatch'
  | 'recorded'
  | 'refreshRequired'
  | 'invalid'
  | 'retainedRequest';
interface ConsentPorts {
  client: Pick<
    FundingAdminSponsorshipConsentClient,
    'read' | 'record' | 'receipt'
  >;
  permitted(): boolean;
  confirm(
    input: SponsorshipConsentIntent,
    summary: AdminSponsorshipConsent
  ): Promise<boolean>;
  refreshPreparation(): Promise<void>;
  accessLost(status: 401 | 403): void;
  storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}
interface ConsentRequestReference {
  requestId: string;
  contributionId: string;
  actor: string;
}

export function consentBusinessDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value ?? '')
    .join('-');
}
export function consentAgreementDateIsValid(
  value: string,
  today: string
): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) > 0 &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value &&
    value <= today
  );
}

/** Exact documented-consent command and read-only reconciliation, scoped to one identity and dossier. */
export class AdminSponsorshipConsentController {
  readonly summary = signal<AdminSponsorshipConsent | null>(null);
  readonly result = signal<AdminSponsorshipConsentRecordReceipt | null>(null);
  readonly busy = signal(false);
  readonly reading = signal(false);
  readonly uncertain = signal(false);
  readonly notice = signal<SponsorshipConsentNotice | null>(null);
  readonly needsRefresh = signal(false);
  readonly retryAllowed = signal(false);
  readonly canRecord = computed(
    () =>
      !!this.summary()?.canRecord &&
      this.ports.permitted() &&
      !this.busy() &&
      !this.reading() &&
      !this.uncertain() &&
      !this.needsRefresh() &&
      !this.result()
  );
  private contributionId = '';
  private identity = '';
  private generation = 0;
  private readSerial = 0;
  private disposed = false;
  private pending: AdminSponsorshipConsentRecordRequest | null = null;
  private reference: ConsentRequestReference | null = null;
  private acknowledged = false;
  private acknowledgedReceipt: AdminSponsorshipConsentRecordReceipt | null =
    null;
  constructor(private readonly ports: ConsentPorts) {}

  setScope(contributionId: string, identity: string): void {
    if (this.contributionId === contributionId && this.identity === identity)
      return;
    if (this.identity && this.identity !== identity) this.clearReference();
    this.generation++;
    this.readSerial++;
    this.contributionId = contributionId;
    this.identity = identity;
    this.summary.set(null);
    this.result.set(null);
    this.busy.set(false);
    this.reading.set(false);
    this.uncertain.set(false);
    this.notice.set(null);
    this.needsRefresh.set(false);
    this.retryAllowed.set(false);
    this.pending = null;
    this.reference = null;
    this.acknowledged = false;
    this.acknowledgedReceipt = null;
  }
  async read(resolveConflict = false): Promise<void> {
    if (!this.contributionId || this.disposed || this.busy()) return;
    const generation = this.generation,
      read = ++this.readSerial;
    this.reading.set(true);
    try {
      const summary = await this.ports.client.read(this.contributionId);
      if (!this.current(generation) || read !== this.readSerial) return;
      this.summary.set(summary);
      this.restoreReference(summary.recordingActor);
      if (resolveConflict && !this.uncertain()) {
        this.needsRefresh.set(false);
        this.notice.set(this.result() ? 'recorded' : null);
      }
    } catch (error) {
      if (!this.current(generation) || read !== this.readSerial) return;
      if (!this.deny(error)) this.notice.set('loadFailed');
    } finally {
      if (this.current(generation) && read === this.readSerial)
        this.reading.set(false);
    }
  }
  async record(intent: SponsorshipConsentIntent): Promise<void> {
    const summary = this.summary();
    if (
      !summary ||
      !this.canRecord() ||
      this.reference ||
      intent.agreementReceived !== true ||
      !intent.evidenceReference.trim() ||
      intent.evidenceReference.trim().length > 1000 ||
      !consentAgreementDateIsValid(
        intent.agreedOn,
        consentBusinessDate(new Date())
      )
    )
      return;
    const generation = this.generation;
    this.busy.set(true);
    try {
      if (
        !(await this.ports.confirm(intent, summary)) ||
        !this.current(generation) ||
        !this.ports.permitted()
      )
        return;
      const request: AdminSponsorshipConsentRecordRequest = {
        contributionId: summary.contributionId,
        expectedVersion: summary.version,
        requestId: crypto.randomUUID(),
        agreementReceived: true,
        scope: SPONSORSHIP_PUBLIC_CONSENT_SCOPE,
        agreedOn: intent.agreedOn,
        evidenceReference: intent.evidenceReference.trim(),
        confirmed: true
      };
      this.pending = request;
      this.reference = {
        requestId: request.requestId,
        contributionId: request.contributionId,
        actor: summary.recordingActor!
      };
      this.persistReference();
      this.notice.set(null);
      this.retryAllowed.set(false);
      await this.send(request, generation);
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }
  async reconcile(): Promise<void> {
    const reference = this.reference;
    if (!reference || this.busy() || this.disposed) return;
    const generation = this.generation;
    this.busy.set(true);
    this.retryAllowed.set(false);
    try {
      const response = await this.ports.client.receipt(
        reference.contributionId,
        reference.requestId
      );
      if (!this.current(generation)) return;
      if (response.state === 'recorded')
        await this.accept(response.receipt, generation);
      else if (this.acknowledged) {
        this.uncertain.set(true);
        this.notice.set('receiptMismatch');
      } else if (this.pending) {
        this.uncertain.set(true);
        this.retryAllowed.set(true);
        this.notice.set('notFound');
      } else {
        // A request can still be committing when its receipt is not found.
        // Reopening retained no command body, so only the same receipt is read.
        this.uncertain.set(true);
        this.notice.set('retainedRequest');
      }
    } catch (error) {
      if (this.current(generation) && !this.deny(error)) {
        this.uncertain.set(true);
        this.notice.set('uncertain');
      }
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }
  async retry(): Promise<void> {
    const request = this.pending,
      summary = this.summary();
    if (
      !request ||
      !summary ||
      !this.retryAllowed() ||
      this.busy() ||
      !this.ports.permitted()
    )
      return;
    const generation = this.generation;
    this.busy.set(true);
    try {
      if (
        !(await this.ports.confirm(request, summary)) ||
        !this.current(generation) ||
        !this.ports.permitted()
      )
        return;
      this.retryAllowed.set(false);
      await this.send(request, generation);
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }
  private async send(
    request: AdminSponsorshipConsentRecordRequest,
    generation: number
  ): Promise<void> {
    try {
      const acknowledged = await this.ports.client.record(request);
      if (!this.current(generation)) return;
      this.acknowledged = true;
      this.acknowledgedReceipt = acknowledged;
      const checked = await this.ports.client.receipt(
        request.contributionId,
        request.requestId
      );
      if (!this.current(generation)) return;
      if (checked.state !== 'recorded') {
        this.uncertain.set(true);
        this.notice.set('receiptMismatch');
        return;
      }
      await this.accept(checked.receipt, generation);
    } catch (error) {
      if (!this.current(generation) || this.deny(error)) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (!this.acknowledged && status >= 400 && status < 500) {
        this.clearReference();
        this.reference = null;
        this.pending = null;
        this.uncertain.set(false);
        this.needsRefresh.set(status === 409);
        this.notice.set(status === 409 ? 'conflict' : 'invalid');
      } else {
        this.uncertain.set(true);
        this.notice.set('uncertain');
      }
    }
  }
  private async accept(
    receipt: AdminSponsorshipConsentRecordReceipt,
    generation: number
  ): Promise<void> {
    if (
      !this.reference ||
      receipt.requestId !== this.reference.requestId ||
      receipt.actor !== this.reference.actor ||
      receipt.contributionId !== this.contributionId ||
      (this.acknowledgedReceipt &&
        (receipt.recordId !== this.acknowledgedReceipt.recordId ||
          receipt.version !== this.acknowledgedReceipt.version ||
          receipt.actor !== this.acknowledgedReceipt.actor))
    ) {
      this.uncertain.set(true);
      this.notice.set('receiptMismatch');
      return;
    }
    this.clearReference();
    this.reference = null;
    this.pending = null;
    this.acknowledged = true;
    this.result.set(receipt);
    this.uncertain.set(false);
    this.retryAllowed.set(false);
    this.needsRefresh.set(false);
    try {
      await this.ports.refreshPreparation();
      if (!this.current(generation)) return;
      const summary = await this.ports.client.read(this.contributionId);
      if (this.current(generation)) {
        this.summary.set(summary);
        this.notice.set('recorded');
      }
    } catch (error) {
      if (this.current(generation) && !this.deny(error))
        this.notice.set('refreshRequired');
    }
  }
  private deny(error: unknown): boolean {
    if (
      !(error instanceof AdminDashboardRequestError) ||
      (error.status !== 401 && error.status !== 403)
    )
      return false;
    const status = error.status;
    this.clearReference();
    this.generation++;
    this.readSerial++;
    this.summary.set(null);
    this.result.set(null);
    this.pending = null;
    this.reference = null;
    this.busy.set(false);
    this.reading.set(false);
    this.uncertain.set(false);
    this.retryAllowed.set(false);
    this.notice.set(null);
    this.ports.accessLost(status);
    return true;
  }
  private referenceKey(): string {
    return 'openg7.admin.consent.pending.v1.' + this.contributionId;
  }
  private persistReference(): void {
    try {
      this.ports
        .storage()
        ?.setItem(this.referenceKey(), JSON.stringify(this.reference));
    } catch {
      /* No proof or form is persisted; storage can be unavailable. */
    }
  }
  private clearReference(): void {
    try {
      if (this.contributionId)
        this.ports.storage()?.removeItem(this.referenceKey());
    } catch {
      /* Revocation must not depend on browser storage. */
    }
  }
  private restoreReference(actor: string | undefined): void {
    if (this.reference || !actor) return;
    try {
      const value = JSON.parse(
        this.ports.storage()?.getItem(this.referenceKey()) ?? 'null'
      ) as ConsentRequestReference | null;
      if (!value) return;
      if (
        value.contributionId !== this.contributionId ||
        value.actor !== actor ||
        !/^[a-f0-9-]{36}$/i.test(value.requestId)
      ) {
        this.clearReference();
        return;
      }
      this.reference = value;
      this.uncertain.set(true);
      this.notice.set('retainedRequest');
    } catch {
      this.clearReference();
    }
  }
  private current(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }
  clearAccess(): void {
    this.clearReference();
    this.setScope('', '');
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
  }
}
