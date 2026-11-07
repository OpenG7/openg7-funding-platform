import {
  SPONSORSHIP_PUBLIC_CONSENT_SCOPE,
  type AdminSponsorshipConsent,
  type AdminSponsorshipConsentRecordRequest,
  type AdminSponsorshipConsentRecordReceipt,
  type AdminSponsorshipConsentReceiptResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { fundingAdminIdentityKey } from './funding-admin-identity-key.js';

/** Funding owns documented consent; this transport never retries a command. */
export class FundingAdminSponsorshipConsentClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearSession: () => void
  ) {}

  async read(
    contributionId: string,
    signal?: AbortSignal
  ): Promise<AdminSponsorshipConsent> {
    const value = (await this.request(
      '/admin/sponsorships/consent?' +
        new URLSearchParams({ sponsorshipId: contributionId }),
      undefined,
      signal
    )) as AdminSponsorshipConsent;
    const blockers = [
      'already_granted',
      'permission_required',
      'operation_processing',
      'operation_uncertain'
    ];
    if (
      !value ||
      value.contributionId !== contributionId ||
      !this.version(value.version) ||
      value.scope !== SPONSORSHIP_PUBLIC_CONSENT_SCOPE ||
      typeof value.effectiveConsent !== 'boolean' ||
      typeof value.canRecord !== 'boolean' ||
      !['checkout', 'documented_agreement', 'none'].includes(value.source) ||
      !Array.isArray(value.recordBlockers) ||
      value.recordBlockers.some((item) => !blockers.includes(item)) ||
      (value.canRecord &&
        (typeof value.recordingActor !== 'string' ||
          !value.recordingActor.trim())) ||
      (value.history !== undefined &&
        (!Array.isArray(value.history) ||
          value.history.length > 50 ||
          value.history.some(
            (record) =>
              typeof record.id !== 'string' ||
              typeof record.actor !== 'string' ||
              typeof record.evidenceReference !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}$/.test(record.agreedOn) ||
              !Number.isFinite(Date.parse(record.recordedAt))
          )))
    )
      this.mismatch();
    return value;
  }
  async record(
    input: AdminSponsorshipConsentRecordRequest
  ): Promise<AdminSponsorshipConsentRecordReceipt> {
    const value = await this.request(
      '/admin/sponsorships/consent/record',
      input
    );
    return this.validateReceipt(value, input.contributionId, input.requestId);
  }
  async receipt(
    contributionId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<AdminSponsorshipConsentReceiptResponse> {
    const value = (await this.request(
      '/admin/sponsorships/consent/receipt?' +
        new URLSearchParams({ sponsorshipId: contributionId, requestId }),
      undefined,
      signal
    )) as AdminSponsorshipConsentReceiptResponse;
    if (value?.state === 'not_found') return value;
    if (value?.state !== 'recorded') this.mismatch();
    return {
      state: 'recorded',
      receipt: this.validateReceipt(value.receipt, contributionId, requestId)
    };
  }
  private validateReceipt(
    value: unknown,
    contributionId: string,
    requestId: string
  ): AdminSponsorshipConsentRecordReceipt {
    const receipt = value as AdminSponsorshipConsentRecordReceipt;
    if (
      !receipt ||
      receipt.contributionId !== contributionId ||
      receipt.requestId !== requestId ||
      typeof receipt.recordId !== 'string' ||
      !receipt.recordId ||
      receipt.outcome !== 'recorded' ||
      receipt.effectiveConsent !== true ||
      receipt.publicVisibilityHeld !== true ||
      !this.version(receipt.version) ||
      typeof receipt.actor !== 'string' ||
      !receipt.actor.trim() ||
      !Number.isFinite(Date.parse(receipt.recordedAt)) ||
      !Number.isInteger(receipt.invalidatedDeliveryCount) ||
      receipt.invalidatedDeliveryCount < 0
    )
      this.mismatch();
    return receipt;
  }
  private version(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 300;
  }
  private mismatch(): never {
    throw new AdminDashboardRequestError(
      502,
      undefined,
      'CONSENT_RESPONSE_MISMATCH'
    );
  }
  private async request(
    path: string,
    body?: AdminSponsorshipConsentRecordRequest,
    signal?: AbortSignal
  ): Promise<unknown> {
    const identity = fundingAdminIdentityKey(this.session);
    const response = await this.session.requestAdminJson(path, {
      auth: 'saved',
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          }
        : { abortBeforeFetch: true })
    });
    if (identity !== fundingAdminIdentityKey(this.session))
      throw new AdminDashboardRequestError(401, undefined, 'SESSION_CHANGED');
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      const details = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      if (identity !== fundingAdminIdentityKey(this.session))
        throw new AdminDashboardRequestError(401, undefined, 'SESSION_CHANGED');
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        typeof details?.code === 'string' ? details.code : undefined
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return this.mismatch();
    }
    if (identity !== fundingAdminIdentityKey(this.session))
      throw new AdminDashboardRequestError(401, undefined, 'SESSION_CHANGED');
    return value;
  }
}
