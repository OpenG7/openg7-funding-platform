import type {
  SponsorshipWebsiteVisibilityRequest,
  SponsorshipIntervention,
  SponsorshipInterventionRequest,
  SponsorshipInterventionsResponse,
  AdminSponsorshipDetailsRequest,
  AdminSponsorshipDetailsResult,
  AdminSponsorshipProgressResponse,
  AdminInformationRequest,
  AdminInformationRequestResult,
  AdminInformationRequestReceiptRequest,
  AdminInformationRequestReceipt,
  AdminSponsorMediaDeleteRequest,
  AdminSponsorMediaReviewRequest,
  AdminSponsorMediaReviewResult,
  AdminSponsorLogoDeleteResult,
  AdminSponsorLogoUploadResult,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipRefundRequest,
  AdminSponsorshipRefundResult,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse,
  SponsorMediaDeleteResult,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorMessageFromResponse } from './funding-admin-response.js';

export interface AdminSponsorshipListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly reviewStatus?: string;
  readonly feedStatus?: string;
  readonly paymentStatus?: string;
  readonly sort?: string;
  readonly direction?: 'asc' | 'desc';
}

/** Funding admin dossiers, media and review endpoints; authentication belongs to the shared session. */
export class FundingAdminSponsorshipsClient {
  async updateSponsorMediaUsage(
    payload: import('@openg7/funding-core').AdminSponsorMediaUsageRequest
  ): Promise<{
    updated: true;
    asset: import('@openg7/funding-core').SponsorMediaAsset;
  }> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/usage',
      {
        auth: 'saved',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok)
      throw await this.mediaMutationError(response, 'MEDIA_USAGE_UNAVAILABLE');
    return response.json();
  }
  async decideSponsorMediaPreference(
    payload: import('@openg7/funding-core').AdminSponsorMediaPreferenceDecisionRequest
  ): Promise<{
    updated: true;
    preference: import('@openg7/funding-core').SponsorMediaPreference;
  }> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/preference-review',
      {
        auth: 'saved',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok)
      throw await this.mediaMutationError(
        response,
        'MEDIA_PREFERENCE_UNAVAILABLE'
      );
    return response.json();
  }
  private async mediaMutationError(
    response: Response,
    fallback: string
  ): Promise<AdminDashboardRequestError> {
    const payload = (await response.json().catch(() => null)) as {
      code?: unknown;
      message?: unknown;
      error?: unknown;
    } | null;
    return new AdminDashboardRequestError(
      response.status,
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.error === 'string'
          ? payload.error
          : fallback,
      typeof payload?.code === 'string' ? payload.code : undefined
    );
  }
  constructor(private readonly session: FundingAdminSession) {}

  async getSponsorshipPreparation(
    contributionId: string
  ): Promise<import('@openg7/funding-core').AdminDossierPreparationReceipt> {
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/preparation?${new URLSearchParams({ sponsorshipId: contributionId })}`,
      { auth: 'saved', cache: 'no-store' }
    );
    return this.preparationResponse(response);
  }

  async approveSponsorshipPreparation(
    payload: import('@openg7/funding-core').AdminDossierPreparationApproveRequest
  ): Promise<import('@openg7/funding-core').AdminDossierPreparationReceipt> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/preparation/approve',
      {
        auth: 'saved',
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    return this.preparationResponse(response);
  }

  private async preparationResponse(
    response: Response
  ): Promise<import('@openg7/funding-core').AdminDossierPreparationReceipt> {
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        typeof payload?.code === 'string' ? payload.code : undefined
      );
    }
    return response.json();
  }

  async getSponsorshipProgress(
    token: string,
    sponsorshipId?: string
  ): Promise<AdminSponsorshipProgressResponse> {
    const params = new URLSearchParams(sponsorshipId ? { sponsorshipId } : {});
    return this.session.requestAdminData(
      `/admin/sponsorships/progress?${params}`,
      {
        auth: { token },
        cache: 'no-store'
      }
    );
  }

  async requestSponsorshipInformation(
    token: string,
    payload: AdminInformationRequest
  ): Promise<AdminInformationRequestResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/request-information',
      {
        auth: { token },
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) {
      const body: unknown =
        response.status === 409
          ? await response.json().catch(() => null)
          : null;
      const code =
        body &&
        typeof body === 'object' &&
        'code' in body &&
        body.code === 'INFORMATION_REQUEST_ID_CONFLICT'
          ? body.code
          : undefined;
      throw new AdminDashboardRequestError(response.status, undefined, code);
    }
    return response.json() as Promise<AdminInformationRequestResult>;
  }

  getInformationRequestReceipt(
    token: string,
    input: AdminInformationRequestReceiptRequest
  ): Promise<AdminInformationRequestReceipt> {
    return this.session.requestAdminData(
      `/admin/sponsorships/information-request-receipt?${new URLSearchParams({ requestId: input.requestId, contributionId: input.contributionId })}`,
      {
        auth: { token },
        cache: 'no-store'
      }
    );
  }

  async getSponsorshipAccessRecipient(
    token: string,
    contributionId: string
  ): Promise<{ recipient: string | null }> {
    return this.session.requestAdminData(
      `/admin/sponsorships/followup-access?${new URLSearchParams({ contributionId })}`,
      {
        auth: { token },
        cache: 'no-store'
      }
    );
  }

  async resendSponsorshipAccess(
    token: string,
    payload: import('@openg7/funding-core').AdminSponsorshipAccessRequest
  ): Promise<import('@openg7/funding-core').AdminSponsorshipAccessResult> {
    return this.session.requestAdminData(
      '/admin/sponsorships/followup-access',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
  }

  async getSponsorships(
    token: string,
    query?: AdminSponsorshipListQuery
  ): Promise<AdminSponsorshipsResponse> {
    const params = new URLSearchParams();
    if (query) {
      params.set('page', String(query.page));
      params.set('pageSize', String(query.pageSize));
      if (query.search?.trim()) {
        params.set('search', query.search.trim());
      }
      if (query.reviewStatus && query.reviewStatus !== 'all') {
        params.set('reviewStatus', query.reviewStatus);
      }
      if (query.feedStatus && query.feedStatus !== 'all') {
        params.set('feedStatus', query.feedStatus);
      }
      if (query.paymentStatus && query.paymentStatus !== 'all') {
        params.set('paymentStatus', query.paymentStatus);
      }
      if (query.sort) {
        params.set('sort', query.sort);
      }
      if (query.direction) {
        params.set('direction', query.direction);
      }
    }

    const url = `/admin/sponsorships${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    const response = await this.session.requestAdminJson(url, {
      auth: { token },
      method: 'GET'
    });

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Admin sponsorships could not be loaded.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipsResponse;
  }

  async uploadSponsorLogo(
    token: string,
    contributionId: string,
    expectedVersion: string,
    logo: File
  ): Promise<AdminSponsorLogoUploadResult> {
    const body = new FormData();
    body.set('contributionId', contributionId);
    body.set('expectedVersion', expectedVersion);
    body.set('logo', logo);

    const response = await this.session.requestAdmin(
      '/admin/sponsorships/logo',
      { auth: { token }, method: 'POST', body }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsor logo could not be uploaded.'
        )
      );
    }

    return (await response.json()) as AdminSponsorLogoUploadResult;
  }

  async getSponsorLogoPreview(
    token: string,
    contributionId: string
  ): Promise<Blob> {
    const params = new URLSearchParams({ contributionId });
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/logo?${params.toString()}`,
      { auth: { token }, method: 'GET', headers: { Accept: 'image/*' } }
    );

    if (!response.ok) {
      throw new Error('Sponsor logo preview could not be loaded.');
    }

    return response.blob();
  }

  async deleteSponsorLogo(
    token: string,
    contributionId: string,
    expectedVersion: string,
    confirmation: string
  ): Promise<AdminSponsorLogoDeleteResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/logo/delete',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { contributionId, expectedVersion, confirmation }
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsor logo could not be deleted.'
        )
      );
    }

    return (await response.json()) as AdminSponsorLogoDeleteResult;
  }

  async getSponsorMedia(
    token: string,
    contributionId: string
  ): Promise<SponsorshipMediaResponse> {
    const params = new URLSearchParams({ contributionId });
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/media?${params.toString()}`,
      { auth: { token } }
    );
    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsor media could not be loaded.'
        )
      );
    }
    return (await response.json()) as SponsorshipMediaResponse;
  }

  async getSponsorMediaPreview(token: string, assetId: string): Promise<Blob> {
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/media/content/${encodeURIComponent(assetId)}`,
      { auth: { token }, headers: { Accept: 'image/*' } }
    );
    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        'Sponsor media preview could not be loaded.'
      );
    }
    return response.blob();
  }

  async reviewSponsorMedia(
    token: string,
    payload: AdminSponsorMediaReviewRequest
  ): Promise<AdminSponsorMediaReviewResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/review',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsor media review could not be completed.'
        )
      );
    }
    return (await response.json()) as AdminSponsorMediaReviewResult;
  }
  async updateSponsorMediaMetadata(
    token: string,
    payload: import('@openg7/funding-core').AdminSponsorMediaMetadataRequest
  ): Promise<AdminSponsorMediaReviewResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/metadata',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok)
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsor media metadata could not be saved.'
        )
      );
    return response.json() as Promise<AdminSponsorMediaReviewResult>;
  }

  async deleteSponsorMedia(
    token: string,
    payload: AdminSponsorMediaDeleteRequest
  ): Promise<SponsorMediaDeleteResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/delete',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsor media could not be deleted.'
        )
      );
    }
    return (await response.json()) as SponsorMediaDeleteResult;
  }

  async getSponsorshipInterventions(
    token: string,
    sponsorshipId: string,
    before?: string
  ): Promise<SponsorshipInterventionsResponse> {
    const params = new URLSearchParams({
      sponsorshipId,
      ...(before ? { before } : {})
    });
    return this.session.requestAdminData(
      `/admin/sponsorships/interventions?${params}`,
      { auth: { token }, cache: 'no-store' }
    );
  }

  async recordSponsorshipIntervention(
    token: string,
    payload: SponsorshipInterventionRequest
  ): Promise<SponsorshipIntervention> {
    return this.session.requestAdminData('/admin/sponsorships/interventions', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  }

  async updateSponsorshipDetails(
    token: string,
    payload: AdminSponsorshipDetailsRequest
  ): Promise<AdminSponsorshipDetailsResult> {
    return this.session.requestAdminData('/admin/sponsorships/details', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  }

  async reviewSponsorship(
    token: string,
    payload: AdminSponsorshipReviewRequest
  ): Promise<AdminSponsorshipReviewResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/review',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsorship review could not be updated.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipReviewResult;
  }

  async refundSponsorship(
    token: string,
    payload: AdminSponsorshipRefundRequest
  ): Promise<AdminSponsorshipRefundResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/refund',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        error?.error ?? 'Sponsorship refund could not be created.',
        error?.code
      );
    }

    return (await response.json()) as AdminSponsorshipRefundResult;
  }

  async updateSponsorshipPublication(
    token: string,
    payload: AdminSponsorshipPublicationRequest
  ): Promise<AdminSponsorshipPublicationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/publication',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
          response,
          'Sponsorship publication could not be updated.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipPublicationResult;
  }

  async setSponsorshipWebsiteVisibility(
    token: string,
    payload: SponsorshipWebsiteVisibilityRequest
  ): Promise<void> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/website-visibility',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok)
      throw new AdminDashboardRequestError(
        response.status,
        'Website visibility could not be updated.'
      );
  }
}
