import type {
  AdminAssistantContextResponse,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryRequest,
  AdminAssistantQueryResponse,
  AdminAssistantSummary
} from '@openg7/funding-core';

import type { FundingAdminSession } from './funding-admin-session.js';
import { errorMessageFromResponse } from './funding-admin-response.js';

/** Funding admin assistant consultation and draft preparation. Authentication belongs to the shared session. */
export class FundingAdminAssistantClient {
  constructor(private readonly session: FundingAdminSession) {}

  async getAssistantSummary(token: string): Promise<AdminAssistantSummary> {
    const response = await this.session.requestAdminJson(
      '/admin/assistant/summary',
      {
        auth: { token },
        method: 'GET'
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
          response,
          'Admin assistant summary could not be loaded.'
        )
      );
    }

    return (await response.json()) as AdminAssistantSummary;
  }

  async getAssistantContext(
    token: string,
    sponsorshipId?: string
  ): Promise<AdminAssistantContextResponse> {
    const params = new URLSearchParams(sponsorshipId ? { sponsorshipId } : {});
    return this.session.requestAdminData(`/admin/assistant/context?${params}`, {
      auth: { token },
      cache: 'no-store'
    });
  }

  async queryAssistant(
    token: string,
    payload: AdminAssistantQueryRequest
  ): Promise<AdminAssistantQueryResponse> {
    return this.session.requestAdminData('/admin/assistant/query', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  }

  async prepareAssistantDraft(
    token: string,
    payload: AdminAssistantPrepareRequest
  ): Promise<AdminAssistantPrepareResponse> {
    return this.session.requestAdminData('/admin/assistant/prepare', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  }
}
