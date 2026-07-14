import { Injectable } from '@angular/core';
import type {
  AdminAuditLogResponse,
  AdminContributionsResponse,
  AdminDashboardResponse,
  AdminExpenseCreateRequest,
  AdminExpenseMutationResult,
  AdminExpenseUpdateRequest,
  AdminExpensesResponse,
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchMutationResult,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest,
  AdminPublicationBatchesResponse,
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftMutationResult,
  AdminPublicationDraftUpdateRequest,
  AdminPublicationDraftsResponse,
  AdminSessionResponse,
  AdminSponsorLogoDeleteResult,
  AdminSponsorLogoUploadResult,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse,
  AdminTransparencyResponse
} from '@openg7/funding-core';

const sessionTokenStorageKey = 'openg7-admin-session-token';
const sessionExpiresAtStorageKey = 'openg7-admin-session-expires-at';
const legacyTokenStorageKey = 'openg7-admin-token';
const adminSessionTokenPrefix = 'openg7-admin-session.';

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

@Injectable({ providedIn: 'root' })
export class FundingAdminService {
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

  getSavedAdminToken(): string {
    if (typeof window === 'undefined') {
      return '';
    }

    window.sessionStorage.removeItem(legacyTokenStorageKey);
    window.localStorage.removeItem(legacyTokenStorageKey);

    const sessionToken =
      window.sessionStorage.getItem(sessionTokenStorageKey) ?? '';
    const expiresAt =
      window.sessionStorage.getItem(sessionExpiresAtStorageKey) ?? '';

    if (!sessionToken || !this.isAdminSessionToken(sessionToken)) {
      this.clearAdminSession();
      return '';
    }

    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
      this.clearAdminSession();
      return '';
    }

    return sessionToken;
  }

  saveAdminToken(token: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const trimmed = token.trim();
    if (!trimmed) {
      this.clearAdminSession();
      return;
    }

    if (this.isAdminSessionToken(trimmed)) {
      window.sessionStorage.setItem(sessionTokenStorageKey, trimmed);
    }
  }

  clearAdminSession(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.removeItem(sessionTokenStorageKey);
    window.sessionStorage.removeItem(sessionExpiresAtStorageKey);
    window.sessionStorage.removeItem(legacyTokenStorageKey);
    window.localStorage.removeItem(legacyTokenStorageKey);
  }

  hasValidAdminSession(): boolean {
    return Boolean(this.getSavedAdminToken());
  }

  async signIn(token: string): Promise<AdminSessionResponse> {
    const session = await this.createAdminSession(token);
    this.saveAdminSession(session);
    return session;
  }

  async getDashboard(token: string): Promise<AdminDashboardResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/dashboard`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin dashboard could not be loaded.');
    }

    return (await response.json()) as AdminDashboardResponse;
  }

  async getContributions(token: string): Promise<AdminContributionsResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/contributions`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin contributions could not be loaded.');
    }

    return (await response.json()) as AdminContributionsResponse;
  }

  async getContributionsCsv(token: string): Promise<string> {
    const response = await fetch(`${this.apiBaseUrl}/admin/contributions.csv`, {
      method: 'GET',
      headers: {
        ...(await this.createHeaders(token)),
        Accept: 'text/csv'
      }
    });

    if (!response.ok) {
      throw new Error('Admin contributions export could not be loaded.');
    }

    return response.text();
  }

  async getExpenses(token: string): Promise<AdminExpensesResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/expenses`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin expenses could not be loaded.');
    }

    return (await response.json()) as AdminExpensesResponse;
  }

  async createExpense(
    token: string,
    payload: AdminExpenseCreateRequest
  ): Promise<AdminExpenseMutationResult> {
    const response = await fetch(`${this.apiBaseUrl}/admin/expenses`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Admin expense could not be created.');
    }

    return (await response.json()) as AdminExpenseMutationResult;
  }

  async updateExpense(
    token: string,
    payload: AdminExpenseUpdateRequest
  ): Promise<AdminExpenseMutationResult> {
    const response = await fetch(`${this.apiBaseUrl}/admin/expenses/update`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Admin expense could not be updated.');
    }

    return (await response.json()) as AdminExpenseMutationResult;
  }

  async getTransparency(token: string): Promise<AdminTransparencyResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/transparency`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin transparency could not be loaded.');
    }

    return (await response.json()) as AdminTransparencyResponse;
  }

  async getPublicationDrafts(
    token: string
  ): Promise<AdminPublicationDraftsResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-drafts`,
      {
        method: 'GET',
        headers: await this.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication drafts could not be loaded.');
    }

    return (await response.json()) as AdminPublicationDraftsResponse;
  }

  async createPublicationDraft(
    token: string,
    payload: AdminPublicationDraftCreateRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-drafts`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication draft could not be created.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async updatePublicationDraft(
    token: string,
    payload: AdminPublicationDraftUpdateRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-drafts/update`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication draft could not be updated.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async getPublicationBatches(
    token: string
  ): Promise<AdminPublicationBatchesResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches`,
      {
        method: 'GET',
        headers: await this.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication batches could not be loaded.');
    }

    return (await response.json()) as AdminPublicationBatchesResponse;
  }

  async createPublicationBatch(
    token: string,
    payload: AdminPublicationBatchCreateRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication batch could not be created.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async assignDraftToBatch(
    token: string,
    payload: AdminPublicationBatchAssignRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches/assign`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Draft could not be assigned to the publication batch.');
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async unassignDraftFromBatch(
    token: string,
    payload: AdminPublicationBatchUnassignRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches/unassign`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error(
        'Draft could not be removed from the publication batch.'
      );
    }

    return (await response.json()) as AdminPublicationDraftMutationResult;
  }

  async schedulePublicationBatch(
    token: string,
    payload: AdminPublicationBatchScheduleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches/schedule`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Publication batch could not be scheduled.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async publishPublicationBatch(
    token: string,
    payload: AdminPublicationBatchLifecycleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches/publish`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Publication batch could not be published.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async cancelPublicationBatch(
    token: string,
    payload: AdminPublicationBatchLifecycleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches/cancel`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Publication batch could not be cancelled.');
    }

    return (await response.json()) as AdminPublicationBatchMutationResult;
  }

  async getAuditLog(token: string): Promise<AdminAuditLogResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/audit-log`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin audit log could not be loaded.');
    }

    return (await response.json()) as AdminAuditLogResponse;
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

    const url = `${this.apiBaseUrl}/admin/sponsorships${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
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

    const response = await fetch(`${this.apiBaseUrl}/admin/sponsorships/logo`, {
      method: 'POST',
      headers: await this.createHeaders(token),
      body
    });

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
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
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/logo?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          ...(await this.createHeaders(token)),
          Accept: 'image/*'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Sponsor logo preview could not be loaded.');
    }

    return response.blob();
  }

  async deleteSponsorLogo(
    token: string,
    contributionId: string,
    expectedVersion: string
  ): Promise<AdminSponsorLogoDeleteResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/logo/delete`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ contributionId, expectedVersion })
      }
    );

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
          response,
          'Sponsor logo could not be deleted.'
        )
      );
    }

    return (await response.json()) as AdminSponsorLogoDeleteResult;
  }

  async reviewSponsorship(
    token: string,
    payload: AdminSponsorshipReviewRequest
  ): Promise<AdminSponsorshipReviewResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/review`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
          response,
          'Sponsorship review could not be updated.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipReviewResult;
  }

  async updateSponsorshipPublication(
    token: string,
    payload: AdminSponsorshipPublicationRequest
  ): Promise<AdminSponsorshipPublicationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/publication`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
          response,
          'Sponsorship publication could not be updated.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipPublicationResult;
  }

  private async createHeaders(token: string): Promise<Record<string, string>> {
    const sessionToken = await this.resolveAdminSessionToken(token);

    return {
      Accept: 'application/json',
      ...(sessionToken
        ? {
            Authorization: `Bearer ${sessionToken}`
          }
        : {})
    };
  }

  private async errorMessageFromResponse(
    response: Response,
    fallback: string
  ): Promise<string> {
    try {
      const payload = (await response.json()) as {
        readonly message?: unknown;
        readonly error?: unknown;
      };
      return typeof payload.message === 'string'
        ? payload.message
        : typeof payload.error === 'string'
          ? payload.error
          : fallback;
    } catch {
      return fallback;
    }
  }

  private async resolveAdminSessionToken(token: string): Promise<string> {
    const trimmed = token.trim();
    if (!trimmed) {
      return '';
    }

    if (this.isAdminSessionToken(trimmed)) {
      this.saveAdminToken(trimmed);
      return trimmed;
    }

    const savedSessionToken = this.getSavedAdminToken();
    if (savedSessionToken) {
      return savedSessionToken;
    }

    const session = await this.createAdminSession(trimmed);
    this.saveAdminSession(session);
    return session.sessionToken;
  }

  private async createAdminSession(
    token: string
  ): Promise<AdminSessionResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/session`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      throw new Error('Admin session could not be created.');
    }

    return (await response.json()) as AdminSessionResponse;
  }

  private saveAdminSession(session: AdminSessionResponse): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(sessionTokenStorageKey, session.sessionToken);
    window.sessionStorage.setItem(
      sessionExpiresAtStorageKey,
      session.expiresAt
    );
  }

  private isAdminSessionToken(token: string): boolean {
    return token.startsWith(adminSessionTokenPrefix);
  }

  private resolveApiBaseUrl(): string {
    const globalApiBaseUrl =
      typeof window !== 'undefined'
        ? (
            window as Window & {
              readonly __OPENG7_FUNDING_API_BASE_URL__?: string;
            }
          ).__OPENG7_FUNDING_API_BASE_URL__
        : undefined;

    return globalApiBaseUrl?.replace(/\/$/, '') ?? '/api';
  }
}
