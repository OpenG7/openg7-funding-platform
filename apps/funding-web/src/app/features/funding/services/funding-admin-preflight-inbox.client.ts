import type { PreflightInboxResponse } from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

export class PreflightInboxRequestError extends AdminDashboardRequestError {
  constructor(
    status: number,
    readonly consoleUrl: string | null
  ) {
    super(status);
  }
}

/** Uses the Funding session; service credentials never enter the browser. */
export class FundingAdminPreflightInboxClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearSession: () => void
  ) {}

  async read(
    page: number,
    signal?: AbortSignal
  ): Promise<PreflightInboxResponse> {
    const sessionGeneration = this.session.sessionGeneration();
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    const response = await this.session.requestAdminJson(
      `/admin/preflight/inbox?${query}`,
      { auth: 'saved', cache: 'no-store', signal, abortBeforeFetch: true }
    );
    if (!response.ok) {
      if (
        response.status === 401 &&
        !signal?.aborted &&
        sessionGeneration === this.session.sessionGeneration()
      )
        this.clearSession();
      const body: unknown = await response.json().catch(() => null);
      const consoleUrl =
        body &&
        typeof body === 'object' &&
        'consoleUrl' in body &&
        typeof body.consoleUrl === 'string'
          ? body.consoleUrl
          : null;
      throw new PreflightInboxRequestError(response.status, consoleUrl);
    }
    const body = (await response.json()) as PreflightInboxResponse | null;
    if (
      !body ||
      !['ready', 'disabled'].includes(body.state) ||
      !Array.isArray(body.items) ||
      !Number.isSafeInteger(body.total) ||
      body.total < 0 ||
      !Number.isSafeInteger(body.page) ||
      body.page !== page ||
      body.pageSize !== 20 ||
      body.authority !== 'source_application' ||
      body.businessDecisionExecuted !== false ||
      !(body.consoleUrl === null || typeof body.consoleUrl === 'string')
    )
      throw new PreflightInboxRequestError(502, null);
    return body;
  }
}
