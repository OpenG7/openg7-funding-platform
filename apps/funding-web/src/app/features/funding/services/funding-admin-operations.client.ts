import type {
  AdminEmailQueueResponse,
  AdminEmailQueueMessageRecord,
  AdminEmailDeliveryReconcileRequest,
  AdminEmailQueueRetryRequest,
  AdminEmailQueueRetryResult,
  AdminEmailTestRequest,
  AdminEmailTestResult,
  AdminSetupStatusResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorMessageFromResponse } from './funding-admin-response.js';

/** Funding admin setup, mail operations, backup and backfill endpoints. Authentication belongs to the shared session. */
export class FundingAdminOperationsClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearAdminSession: () => void
  ) {}

  async stripeBackfill(
    payload?: import('@openg7/funding-core').AdminStripeBackfillRequest,
    id?: string
  ): Promise<{
    run: import('@openg7/funding-core').AdminStripeBackfillRun | null;
  }> {
    const response = await this.session.requestAdminJson(
      `/admin/stripe-backfill${id ? '?' + new URLSearchParams({ id }) : ''}`,
      {
        auth: 'saved',
        method: payload ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(payload ? { body: payload } : {}),
        signal: AbortSignal.timeout(90000)
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new AdminDashboardRequestError(
        response.status,
        body.code ?? 'BACKFILL_UNAVAILABLE'
      );
    }
    return response.json();
  }

  async databaseBackups(
    requestId?: string,
    payload?: import('@openg7/funding-core').AdminBackupRequest
  ): Promise<
    | import('@openg7/funding-core').AdminBackupsResponse
    | import('@openg7/funding-core').AdminDatabaseBackup
  > {
    const response = await this.session.requestAdminJson(
      `/admin/backups${requestId ? '?requestId=' + encodeURIComponent(requestId) : ''}`,
      {
        auth: 'saved',
        method: payload ? 'POST' : 'GET',
        ...(payload
          ? { headers: { 'Content-Type': 'application/json' }, body: payload }
          : {})
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new AdminDashboardRequestError(
        response.status,
        'Database backup request failed.',
        body.code
      );
    }
    return response.json();
  }

  async getSetupStatus(token: string): Promise<AdminSetupStatusResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/setup-status',
      {
        auth: { token },
        method: 'GET'
      }
    );

    if (!response.ok) {
      await this.session.accessError(response);
    }

    return (await response.json()) as AdminSetupStatusResponse;
  }

  async sendEmailTest(
    token: string,
    payload: AdminEmailTestRequest
  ): Promise<AdminEmailTestResult> {
    const response = await this.session.requestAdminJson('/admin/email/test', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });

    if (!response.ok) {
      await this.session.accessError(response);
    }

    return (await response.json()) as AdminEmailTestResult;
  }

  async getEmailTest(
    token: string,
    requestId: string
  ): Promise<AdminEmailTestResult> {
    const response = await this.session.requestAdminJson(
      `/admin/email/test?requestId=${encodeURIComponent(requestId)}`,
      {
        auth: { token }
      }
    );
    if (!response.ok) await this.session.accessError(response);
    return response.json();
  }

  async getEmailQueue(
    token: string,
    id?: string
  ): Promise<AdminEmailQueueResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/email-queue${id ? '?messageId=' + encodeURIComponent(id) : ''}`,
      {
        auth: { token },
        method: 'GET'
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
          response,
          'Admin email queue could not be loaded.'
        )
      );
    }

    return (await response.json()) as AdminEmailQueueResponse;
  }

  async retryEmailQueueMessage(
    token: string,
    payload: AdminEmailQueueRetryRequest
  ): Promise<AdminEmailQueueRetryResult> {
    const response = await this.session.requestAdminJson(
      '/admin/email-queue/retry',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
          response,
          'Email queue message could not be retried.'
        )
      );
    }

    return (await response.json()) as AdminEmailQueueRetryResult;
  }
  async reconcileEmailDelivery(
    token: string,
    payload: AdminEmailDeliveryReconcileRequest
  ): Promise<{
    updated: boolean;
    message: AdminEmailQueueMessageRecord | null;
  }> {
    const response = await this.session.requestAdminJson(
      '/admin/email-queue/reconcile',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) await this.session.accessError(response);
    return response.json();
  }
}
