import type { EnabledPreflightConfig } from './config.js';
import {
  parseRehearsalMissionDetail,
  type RehearsalMissionDetail
} from './rehearsal-contracts.js';
import {
  integer,
  parseRemoteMission,
  parseRemoteMissionDetail,
  parseRemoteProposal,
  parseRemoteInboxProposal,
  record,
  text,
  uuid,
  type PreflightMission,
  type PreflightSourceUpdate,
  type RemoteMissionDetail,
  type RemoteProposalPage,
  type RemoteInboxProposalPage
} from './contracts.js';

export class PreflightClientError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    readonly status?: number
  ) {
    super(code);
    this.name = 'PreflightClientError';
  }
}
interface Token {
  value: string;
  usableUntil: number;
}
interface ClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Authenticated wire-v1 client. Retries are owned by the durable source worker. */
export class PreflightClient {
  private token?: Token;
  private tokenFlight?: Promise<string>;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(
    readonly config: EnabledPreflightConfig,
    options: ClientOptions = {}
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  private async request(
    url: string,
    init: RequestInit
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    let rejectTimeout: (reason: unknown) => void = () => undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
      controller.abort();
      rejectTimeout(new PreflightClientError('preflight_timeout', true));
    }, this.config.requestTimeoutMs);
    const perform = async () => {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          signal: controller.signal,
          redirect: 'error'
        });
      } catch {
        throw new PreflightClientError(
          controller.signal.aborted
            ? 'preflight_timeout'
            : 'preflight_unavailable',
          true
        );
      }
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .includes('application/json')
      )
        throw new PreflightClientError(
          'preflight_response_invalid',
          response.status >= 500,
          response.status
        );
      if (
        Number(response.headers.get('content-length') ?? '0') >
        MAX_RESPONSE_BYTES
      )
        throw new PreflightClientError('preflight_response_too_large');
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new PreflightClientError('preflight_response_too_large');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      try {
        return {
          status: response.status,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        };
      } catch {
        throw new PreflightClientError(
          'preflight_response_invalid',
          response.status >= 500,
          response.status
        );
      }
    };
    try {
      return await Promise.race([perform(), timeout]);
    } catch (error) {
      if (error instanceof PreflightClientError) throw error;
      throw new PreflightClientError('preflight_unavailable', true);
    } finally {
      clearTimeout(timer);
    }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.usableUntil > this.now())
      return this.token.value;
    if (this.tokenFlight) return this.tokenFlight;
    this.tokenFlight = (async () => {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      });
      if (this.config.scope) params.set('scope', this.config.scope);
      const response = await this.request(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json'
        },
        body: params
      });
      if (response.status !== 200)
        throw new PreflightClientError(
          'preflight_token_rejected',
          response.status === 429 || response.status >= 500,
          response.status
        );
      const body = record(response.body);
      const value = text(body.access_token, 16000);
      const expires = integer(body.expires_in);
      if (
        expires > 86400 ||
        typeof body.token_type !== 'string' ||
        body.token_type.toLowerCase() !== 'bearer' ||
        /\s/.test(value)
      )
        throw new PreflightClientError('preflight_token_response_invalid');
      this.token = {
        value,
        usableUntil:
          this.now() + expires * 1000 - Math.min(30000, expires * 100)
      };
      return value;
    })();
    try {
      return await this.tokenFlight;
    } finally {
      this.tokenFlight = undefined;
    }
  }
  private async api(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      const response = await this.request(this.config.baseUrl + '/api' + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (response.status === 401 && attempt === 0) {
        if (this.token?.value === token) this.token = undefined;
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new PreflightClientError(
          'preflight_http_error',
          response.status === 429 || response.status >= 500,
          response.status
        );
      return response.body;
    }
    throw new PreflightClientError('preflight_authentication_failed');
  }
  async submit(mission: PreflightMission) {
    if (
      mission.tenantId !== this.config.tenantId ||
      mission.schemaVersion !== '1.0' ||
      mission.source.application !== 'funding-platform' ||
      mission.source.subjectType !== 'sponsorship-commitment'
    )
      throw new PreflightClientError('preflight_scope_mismatch');
    const body = record(await this.api('POST', '/missions', mission));
    if (typeof body.duplicate !== 'boolean')
      throw new PreflightClientError('preflight_response_invalid');
    const remote = parseRemoteMission(body.mission, this.config.tenantId);
    if (
      remote.source.subjectId !== mission.source.subjectId ||
      remote.source.version !== mission.source.version ||
      (mission.missionId && remote.id !== mission.missionId)
    )
      throw new PreflightClientError('preflight_submission_mismatch');
    return { mission: remote, duplicate: body.duplicate };
  }
  async getMission(id: string): Promise<RemoteMissionDetail> {
    const detail = parseRemoteMissionDetail(
      await this.api('GET', `/missions/${uuid(id)}`),
      this.config.tenantId
    );
    if (detail.mission.id !== id)
      throw new PreflightClientError('preflight_mission_mismatch');
    return detail;
  }
  async getRehearsalMission(id: string): Promise<RehearsalMissionDetail> {
    const detail = parseRehearsalMissionDetail(
      await this.api('GET', `/missions/${uuid(id)}`),
      this.config.tenantId
    );
    if (detail.mission.id !== id)
      throw new PreflightClientError('preflight_mission_mismatch');
    return detail;
  }
  async listProposals(page = 1, pageSize = 50): Promise<RemoteProposalPage> {
    integer(page);
    integer(pageSize);
    if (pageSize > 100)
      throw new PreflightClientError('preflight_page_size_invalid');
    const body = record(
      await this.api(
        'GET',
        `/proposals?application=funding-platform&status=prepared&page=${page}&pageSize=${pageSize}`
      )
    );
    if (!Array.isArray(body.items) || body.items.length > pageSize)
      throw new PreflightClientError('preflight_response_invalid');
    return {
      items: body.items.map((item) =>
        parseRemoteProposal(item, this.config.tenantId)
      ),
      total: integer(body.total, 0),
      page: integer(body.page),
      pageSize: integer(body.pageSize)
    };
  }
  /** Remote inbox inspection only; no import or source validation is implied. */
  async listInboxProposals(
    page = 1,
    pageSize = 20
  ): Promise<RemoteInboxProposalPage> {
    integer(page);
    integer(pageSize);
    if (page > 100000 || pageSize > 100)
      throw new PreflightClientError('preflight_page_size_invalid');
    const body = record(
      await this.api(
        'GET',
        `/proposals?application=funding-platform&status=prepared&page=${page}&pageSize=${pageSize}`
      )
    );
    if (
      !Array.isArray(body.items) ||
      body.items.length > pageSize ||
      body.page !== page ||
      body.pageSize !== pageSize
    )
      throw new PreflightClientError('preflight_response_invalid');
    const total = integer(body.total, 0);
    if (total < body.items.length)
      throw new PreflightClientError('preflight_response_invalid');
    return {
      items: body.items.map((item) =>
        parseRemoteInboxProposal(item, this.config.tenantId)
      ),
      total,
      page,
      pageSize
    };
  }
  async notifySourceUpdate(
    event: PreflightSourceUpdate
  ): Promise<{ duplicate: boolean; invalidated: number }> {
    if (
      event.tenantId !== this.config.tenantId ||
      event.source.application !== 'funding-platform'
    )
      throw new PreflightClientError('preflight_scope_mismatch');
    const body = record(await this.api('POST', '/events', event));
    if (typeof body.duplicate !== 'boolean')
      throw new PreflightClientError('preflight_response_invalid');
    return {
      duplicate: body.duplicate,
      invalidated: integer(body.invalidated, 0)
    };
  }
  async cancelMission(
    id: string,
    sourceVersion: number,
    eventId: string
  ): Promise<RemoteMissionDetail> {
    const raw = await this.api('POST', `/missions/${uuid(id)}/cancel`, {
      sourceVersion: integer(sourceVersion),
      eventId: text(eventId)
    });
    const detail = parseRemoteMissionDetail(raw, this.config.tenantId);
    if (
      detail.mission.id !== id ||
      detail.mission.source.version !== sourceVersion ||
      !['cancelled', 'superseded'].includes(detail.mission.status)
    )
      throw new PreflightClientError('preflight_cancellation_mismatch');
    return detail;
  }
  async recordSourceDecision(
    id: string,
    decision: { sourceVersion: number; decision: string; eventId: string }
  ): Promise<RemoteMissionDetail> {
    integer(decision.sourceVersion);
    text(decision.decision, 200);
    text(decision.eventId);
    const detail = parseRemoteMissionDetail(
      await this.api('POST', `/missions/${uuid(id)}/source-decision`, decision),
      this.config.tenantId
    );
    if (
      detail.mission.id !== id ||
      detail.mission.source.version !== decision.sourceVersion ||
      !['completed', 'superseded'].includes(detail.mission.status)
    )
      throw new PreflightClientError('preflight_decision_mismatch');
    return detail;
  }
}
