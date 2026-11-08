import type {
  PreflightRehearsalResponse,
  PreflightRehearsalScenario
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

export class PreflightRehearsalRequestError extends AdminDashboardRequestError {
  constructor(status: number, code?: string) {
    super(status, undefined, code);
  }
}

/** Funding owns the session and test command; technical service tokens stay server-side. */
export class FundingAdminPreflightRehearsalClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearSession: () => void
  ) {}

  read(id?: string, signal?: AbortSignal): Promise<PreflightRehearsalResponse> {
    return this.request(
      id ? `/${encodeURIComponent(id)}` : '',
      undefined,
      signal
    );
  }

  start(
    requestId: string,
    scenario: PreflightRehearsalScenario,
    signal?: AbortSignal
  ): Promise<PreflightRehearsalResponse> {
    return this.request('', { requestId, scenario }, signal);
  }

  resume(
    id: string,
    signal?: AbortSignal
  ): Promise<PreflightRehearsalResponse> {
    return this.request(`/${encodeURIComponent(id)}/resume`, {}, signal);
  }

  private async request(
    suffix: string,
    body?: object,
    signal?: AbortSignal
  ): Promise<PreflightRehearsalResponse> {
    const generation = this.session.sessionGeneration();
    const deadline = AbortSignal.timeout(15000);
    const cancellation = signal
      ? AbortSignal.any([signal, deadline])
      : deadline;
    const response = await this.session.requestAdminJson(
      '/admin/preflight/rehearsals' + suffix,
      {
        auth: 'saved',
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        signal: cancellation,
        abortBeforeFetch: true,
        ...(body === undefined
          ? {}
          : {
              body,
              headers: { 'Content-Type': 'application/json' }
            })
      }
    );
    if (!response.ok) {
      if (
        response.status === 401 &&
        !cancellation.aborted &&
        generation === this.session.sessionGeneration()
      )
        this.clearSession();
      const error: unknown = await response.json().catch(() => null);
      const code =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : undefined;
      throw new PreflightRehearsalRequestError(response.status, code);
    }
    const value = (await response.json()) as PreflightRehearsalResponse | null;
    if (
      !value ||
      typeof value.enabled !== 'boolean' ||
      typeof value.canLaunch !== 'boolean' ||
      !(value.consoleUrl === null || typeof value.consoleUrl === 'string') ||
      !Array.isArray(value.runs) ||
      !(
        value.run === null ||
        (typeof value.run === 'object' &&
          typeof value.run.id === 'string' &&
          Array.isArray(value.run.steps))
      )
    )
      throw new PreflightRehearsalRequestError(
        502,
        'PREFLIGHT_REHEARSAL_RESPONSE_INVALID'
      );
    return value;
  }
}
