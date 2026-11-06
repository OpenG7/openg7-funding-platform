import type {
  AdminServicePreparationDecisionRequest,
  AdminServicePreparationReceipt
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { fundingAdminIdentityKey } from './funding-admin-identity-key.js';

/** The existing preparation owner records private, versioned service decisions. */
export class FundingAdminPreflightExaminationClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearSession: () => void
  ) {}

  async read(
    contributionId: string,
    obligationId: string,
    signal?: AbortSignal
  ): Promise<AdminServicePreparationReceipt> {
    const params = new URLSearchParams({
      sponsorshipId: contributionId,
      obligationId
    });
    return this.request(
      `/admin/sponsorships/preparation/service?${params}`,
      contributionId,
      obligationId,
      undefined,
      signal
    );
  }

  async decide(
    payload: AdminServicePreparationDecisionRequest
  ): Promise<AdminServicePreparationReceipt> {
    return this.request(
      '/admin/sponsorships/preparation/service/decision',
      payload.contributionId,
      payload.obligationId,
      payload
    );
  }

  private async request(
    path: string,
    contributionId: string,
    obligationId: string,
    payload?: AdminServicePreparationDecisionRequest,
    signal?: AbortSignal
  ): Promise<AdminServicePreparationReceipt> {
    const identity = fundingAdminIdentityKey(this.session);
    const cancellation = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    const response = await this.session.requestAdminJson(path, {
      auth: 'saved',
      cache: 'no-store',
      signal: cancellation,
      ...(payload
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
          }
        : { abortBeforeFetch: true })
    });
    if (!response.ok) {
      if (
        response.status === 401 &&
        identity === fundingAdminIdentityKey(this.session)
      )
        this.clearSession();
      const error = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        typeof error?.code === 'string' ? error.code : undefined
      );
    }
    const receipt = (await response.json()) as AdminServicePreparationReceipt;
    if (
      receipt?.context !== 'service' ||
      receipt.contributionId !== contributionId ||
      receipt.service?.id !== obligationId ||
      receipt.service.contributionId !== contributionId ||
      !/^[a-f0-9]{64}$/.test(receipt.version) ||
      !Array.isArray(receipt.siblings) ||
      receipt.siblings.some(
        (service) => service.contributionId !== contributionId
      ) ||
      !receipt.siblings.some((service) => service.id === obligationId) ||
      !Array.isArray(receipt.checks) ||
      !Array.isArray(receipt.history) ||
      !Array.isArray(receipt.blockers) ||
      !Number.isFinite(Date.parse(receipt.generatedAt))
    )
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'PREPARATION_RESPONSE_MISMATCH'
      );
    return receipt;
  }
}
