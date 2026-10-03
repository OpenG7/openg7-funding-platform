import type {
  PilotState,
  PilotCommand,
  PilotReceipt,
  ProgrammeState,
  ProgrammePlan,
  PublicationFeedId,
  EditorialIntent
} from '@openg7/funding-core';

import type { FundingAdminSession } from './funding-admin-session.js';

/** Funding admin pilotage, editorial proposals and command receipts. Authentication belongs to the shared session. */
export class FundingAdminPilotageClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearAdminSession: () => void
  ) {}

  pilotageProgramme(): Promise<ProgrammeState> {
    return this.pilotageRequest('/programme');
  }

  proposeProgramme(
    feedId: PublicationFeedId,
    cadence: number,
    includeApproved: boolean
  ): Promise<{ version: string; plan: ProgrammePlan }> {
    return this.pilotageRequest('/programme', {
      feedId,
      cadence,
      includeApproved
    });
  }

  editorialVariant(
    id: string,
    version: number,
    instruction: string
  ): Promise<{
    intent: EditorialIntent;
    before: string;
    after: string;
    deliveryId: string;
    version: number;
    feedId: PublicationFeedId;
  }> {
    return this.pilotageRequest('/variant', { id, version, instruction });
  }

  async pilotage(
    query: { page?: number; domain?: string; id?: string } = {}
  ): Promise<PilotState> {
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    );
    return this.pilotageRequest<PilotState>(`?${params}`);
  }

  async pilotageCommand(command: PilotCommand): Promise<PilotReceipt> {
    return this.pilotageRequest<PilotReceipt>('/command', command);
  }

  async pilotageReceipt(id: string): Promise<PilotReceipt> {
    return this.pilotageRequest<PilotReceipt>(
      `/receipt?id=${encodeURIComponent(id)}`
    );
  }

  async acknowledgePilotReceipt(
    requestId: string,
    reason: string
  ): Promise<PilotReceipt> {
    return this.pilotageRequest<PilotReceipt>('/receipt', {
      requestId,
      confirmation: requestId,
      reason
    });
  }

  private async pilotageRequest<T>(path: string, command?: object): Promise<T> {
    const response = await this.session.requestAdminJson(
      `/admin/pilotage${path}`,
      {
        auth: 'saved',
        method: command ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(command ? { body: command } : {}),
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (response.status === 401) this.clearAdminSession();
      throw Object.assign(
        new Error(
          response.status === 401
            ? 'SESSION_EXPIRED'
            : response.status === 403
              ? 'READ_ONLY'
              : (data.code ?? 'PILOTAGE_UNAVAILABLE')
        ),
        { status: response.status }
      );
    }
    return response.json() as Promise<T>;
  }
}
