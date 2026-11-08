import type {
  PublicationWorkshopAdoptRequest,
  PublicationWorkshopPrepareRequest,
  PublicationWorkshopState
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorDetailsFromResponse } from './funding-admin-response.js';

/** Funding owns authentication, source versions and every business decision. */
export class FundingAdminPublicationWorkshopClient {
  constructor(private readonly session: FundingAdminSession) {}

  read(
    contributionId: string,
    signal?: AbortSignal
  ): Promise<PublicationWorkshopState> {
    return this.request(contributionId, '', undefined, signal);
  }

  prepare(
    request: PublicationWorkshopPrepareRequest
  ): Promise<PublicationWorkshopState> {
    return this.request(request.contributionId, '/prepare', request);
  }

  adopt(
    request: PublicationWorkshopAdoptRequest
  ): Promise<PublicationWorkshopState> {
    return this.request(request.contributionId, '/adopt', request);
  }

  private async request(
    contributionId: string,
    action: string,
    body?: PublicationWorkshopPrepareRequest | PublicationWorkshopAdoptRequest,
    signal?: AbortSignal
  ): Promise<PublicationWorkshopState> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/publication-workshop' +
        (body ? action : '?' + new URLSearchParams({ contributionId })),
      {
        auth: 'saved',
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        signal: signal ?? AbortSignal.timeout(15000),
        abortBeforeFetch: !body,
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body }
          : {})
      }
    );
    if (!response.ok) {
      const details = await errorDetailsFromResponse(response);
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        details.code
      );
    }
    const result = (await response.json()) as PublicationWorkshopState | null;
    if (
      !result ||
      result.contributionId !== contributionId ||
      typeof result.enabled !== 'boolean' ||
      typeof result.canPrepare !== 'boolean' ||
      typeof result.canAdopt !== 'boolean' ||
      !(
        result.sourceVersion === null ||
        Number.isSafeInteger(result.sourceVersion)
      ) ||
      !Array.isArray(result.history) ||
      (result.proposal &&
        result.proposal.editorialPreparation.publicationAuthorized !== false)
    )
      throw new AdminDashboardRequestError(
        502,
        undefined,
        'WORKSHOP_RESPONSE_MISMATCH'
      );
    return result;
  }
}
