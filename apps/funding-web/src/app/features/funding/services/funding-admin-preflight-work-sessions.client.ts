import type {
  AdminPreflightWorkSession,
  AdminPreflightWorkSessionCommandRequest,
  AdminPreflightWorkSessionStartRequest,
  AdminPreflightWorkSessionState,
  AdminServicePreparationSaveDraftRequest,
  AdminServicePreparationSaveDraftResult
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { fundingAdminIdentityKey } from './funding-admin-identity-key.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function validWorkSession(
  value: unknown
): value is AdminPreflightWorkSession {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !['active', 'paused', 'finished'].includes(value.status as string) ||
    !Number.isSafeInteger(value.lastPosition) ||
    !object(value.filters) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !object(value.report)
  )
    return false;
  return (
    value.items.every(
      (item: unknown) =>
        object(item) &&
        typeof item.contributionId === 'string' &&
        uuid.test(item.contributionId) &&
        typeof item.obligationId === 'string' &&
        uuid.test(item.obligationId) &&
        typeof item.observedVersion === 'string' &&
        Number.isSafeInteger(item.position) &&
        ['pending', 'saved', 'deferred'].includes(item.state as string) &&
        object(item.checkpoint) &&
        typeof item.checkpoint.reason === 'string' &&
        [null, 'approved', 'correction_requested', 'rejected'].includes(
          item.checkpoint.pendingDecision as null
        )
    ) &&
    [
      'total',
      'visited',
      'deferred',
      'saved',
      'remaining',
      'readyForDelivery',
      'delivered',
      'unavailable'
    ].every((key) =>
      Number.isSafeInteger((value.report as Record<string, unknown>)[key])
    ) &&
    object(value.report.decisions) &&
    ['total', 'approved', 'correctionRequested', 'rejected'].every((key) =>
      Number.isSafeInteger(
        (value.report as { decisions: Record<string, unknown> }).decisions[key]
      )
    )
  );
}

/** Uses only the human session. Personal checkpoints never authorize a business operation. */
export class FundingAdminPreflightWorkSessionsClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearSession: () => void
  ) {}
  async read(
    sessionId?: string,
    requestId?: string,
    signal?: AbortSignal
  ): Promise<AdminPreflightWorkSessionState> {
    const query = new URLSearchParams({
      ...(sessionId ? { sessionId } : {}),
      ...(requestId ? { requestId } : {})
    });
    const value: unknown = await this.request(
      `/admin/preflight/work-sessions?${query}`,
      undefined,
      signal
    );
    if (
      !object(value) ||
      !(value.current === null || validWorkSession(value.current)) ||
      !Array.isArray(value.recent) ||
      value.recent.some(
        (item) =>
          !object(item) || typeof item.id !== 'string' || !uuid.test(item.id)
      ) ||
      !(
        value.command === null ||
        (object(value.command) &&
          value.command.requestId === requestId &&
          ['applied', 'not_found'].includes(value.command.status as string))
      )
    )
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'WORK_SESSION_RESPONSE_INVALID'
      );
    if (sessionId && value.current && value.current.id !== sessionId)
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'WORK_SESSION_RESPONSE_INVALID'
      );
    return value as unknown as AdminPreflightWorkSessionState;
  }
  async start(
    input: AdminPreflightWorkSessionStartRequest
  ): Promise<AdminPreflightWorkSession> {
    return this.receipt(
      await this.request('/admin/preflight/work-sessions', input)
    );
  }
  async command(
    id: string,
    input: AdminPreflightWorkSessionCommandRequest
  ): Promise<AdminPreflightWorkSession> {
    if (!uuid.test(id)) throw new AdminDashboardRequestError(400);
    const result = this.receipt(
      await this.request(`/admin/preflight/work-sessions/${id}/commands`, input)
    );
    if (result.id !== id)
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'WORK_SESSION_RESPONSE_INVALID'
      );
    return result;
  }
  async saveDraft(
    input: AdminServicePreparationSaveDraftRequest
  ): Promise<AdminServicePreparationSaveDraftResult> {
    const value: unknown = await this.request(
      '/admin/sponsorships/preparation/service/save-draft',
      input
    );
    if (
      !object(value) ||
      !object(value.receipt) ||
      value.receipt.context !== 'service' ||
      value.receipt.contributionId !== input.contributionId ||
      !object(value.receipt.service) ||
      value.receipt.service.id !== input.obligationId ||
      !(value.session === null || validWorkSession(value.session)) ||
      (input.workSessionId &&
        object(value.session) &&
        value.session.id !== input.workSessionId)
    )
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'WORK_SESSION_RESPONSE_INVALID'
      );
    return value as unknown as AdminServicePreparationSaveDraftResult;
  }
  private receipt(value: unknown): AdminPreflightWorkSession {
    if (!validWorkSession(value))
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'WORK_SESSION_RESPONSE_INVALID'
      );
    return value;
  }
  private async request(
    path: string,
    body?: object,
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
    if (!response.ok) {
      if (
        response.status === 401 &&
        identity === fundingAdminIdentityKey(this.session)
      )
        this.clearSession();
      const error = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        error?.code
      );
    }
    return response.json();
  }
}
