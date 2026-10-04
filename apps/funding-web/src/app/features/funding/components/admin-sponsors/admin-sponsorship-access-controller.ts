import { signal } from '@angular/core';
import type {
  AdminSponsorshipAccessRequest,
  AdminSponsorshipAccessResult
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminSponsorshipAccessPorts {
  contributionId(): string;
  token(): string;
  disabled(): boolean;
  allowed(): boolean;
  isDestroyed(): boolean;
  language(): AdminSponsorshipAccessRequest['locale'];
  newRequestId(): string;
  getSponsorshipAccessRecipient(
    token: string,
    contributionId: string
  ): Promise<{ recipient: string | null }>;
  confirm(recipient: string): Promise<boolean>;
  resendSponsorshipAccess(
    token: string,
    request: AdminSponsorshipAccessRequest
  ): Promise<AdminSponsorshipAccessResult>;
  queued(): void;
}

/** Owns recipient confirmation and the pending access request for one dossier. */
export class AdminSponsorshipAccessController {
  readonly busy = signal(false);
  readonly state = signal('idle');
  private requestId?: string;
  private generation = 0;

  constructor(private readonly ports: AdminSponsorshipAccessPorts) {}

  targetChanged(): void {
    this.generation++;
    this.requestId = undefined;
    this.busy.set(false);
    this.state.set('idle');
  }

  async resend(): Promise<void> {
    if (
      this.ports.isDestroyed() ||
      this.busy() ||
      this.ports.disabled() ||
      !this.ports.allowed()
    )
      return;
    const id = this.ports.contributionId();
    const generation = this.generation;
    const current = () =>
      !this.ports.isDestroyed() &&
      generation === this.generation &&
      this.ports.contributionId() === id &&
      this.ports.allowed();
    this.busy.set(true);
    this.state.set('idle');
    try {
      const { recipient } = await this.ports.getSponsorshipAccessRecipient(
        this.ports.token(),
        id
      );
      if (!current()) return;
      if (!recipient) {
        this.state.set('missing');
        return;
      }
      if (!(await this.ports.confirm(recipient)) || !current()) return;
      this.requestId ??= this.ports.newRequestId();
      const result = await this.ports.resendSponsorshipAccess(
        this.ports.token(),
        {
          contributionId: id,
          recipient,
          confirmed: true,
          requestId: this.requestId,
          locale: this.ports.language()
        }
      );
      if (!current()) return;
      this.state.set(result.status);
      this.requestId = undefined;
      this.ports.queued();
    } catch (error) {
      if (current())
        this.state.set(
          error instanceof AdminDashboardRequestError &&
            [401, 403].includes(error.status)
            ? 'unauthorized'
            : 'error'
        );
    } finally {
      if (current()) this.busy.set(false);
    }
  }
}
