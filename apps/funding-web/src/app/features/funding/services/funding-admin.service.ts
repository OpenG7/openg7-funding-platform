import type { AdminWorkQueueQuery, AdminWorkQueueResponse, PublicationAutomationState, PublicationAutomationCommand, PilotState, PilotCommand, PilotReceipt } from '@openg7/funding-core';
import type { ProgrammeState, ProgrammePlan, PublicationFeedId, EditorialIntent } from '@openg7/funding-core';
import { Injectable, signal } from '@angular/core';
import type {
  AdminSearchRequest,
  AdminSponsorshipDetailsRequest,
  AdminSponsorshipDetailsResult,
  AdminSearchResponse,
  AdminStripeEventResponse,
  AdminCockpitMetrics,
  AdminCockpitActivity,
  AdminCockpitSystems,
  AdminAssistantContextResponse,
  AdminSponsorshipProgressResponse,
  AdminInformationRequest,
  AdminInformationRequestResult,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryRequest,
  AdminAssistantQueryResponse,
  AdminAssistantSummary,
  AdminAuditLogResponse,
  AdminContributionsResponse,
  AdminContributionsExportRequest,
  AdminDashboardResponse,
  AdminEmailQueueResponse,
  AdminEmailQueueRetryRequest,
  AdminEmailQueueRetryResult,
  AdminEmailTestRequest,
  AdminEmailTestResult,
  AdminExpenseCreateRequest,
  AdminExpenseMutationResult,
  AdminExpenseUpdateRequest,
  AdminExpensesResponse,
  AdminSponsorshipCreditNoteResendRequest,
  AdminSponsorshipCreditNoteResendResult,
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
  AdminPublicationSlotAssignBatchRequest,
  AdminPublicationSlotAssignDraftRequest,
  AdminPublicationSlotCreateRequest,
  AdminPublicationSlotLifecycleRequest,
  AdminPublicationSlotMutationResult,
  AdminPublicationSlotsResponse,
  AdminPublicationSlotUpdateRequest,
  AdminSessionResponse,
  AdminSocialPublicationBatchPublishRequest,
  AdminSocialPublicationBatchPublishResult,
  AdminSocialPublicationJobsResponse,
  AdminSetupStatusResponse,
  AdminSponsorMediaDeleteRequest,
  AdminSponsorMediaReviewRequest,
  AdminSponsorMediaReviewResult,
  AdminSponsorLogoDeleteResult,
  AdminSponsorLogoUploadResult,
  AdminSponsorshipInvoiceBackfillRequest,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceResendRequest,
  AdminSponsorshipInvoiceResendResult,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipPublicationResult,
  AdminSponsorshipRefundRequest,
  AdminSponsorshipRefundResult,
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse,
  AdminTransparencyResponse,
  SponsorMediaDeleteResult,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

const sessionTokenStorageKey = 'openg7-admin-session-token';
const sessionExpiresAtStorageKey = 'openg7-admin-session-expires-at';
const legacyTokenStorageKey = 'openg7-admin-token';
const adminSessionTokenPrefix = 'openg7-admin-session.';
const selectedSponsorshipStorageKey = 'openg7-admin-selected-sponsorship';
const cookieSessionMarker = 'openg7-admin-session.cookie';
export interface AdminIdentityProfile {
  id: string;
  sessionId: string;
  displayName: string;
  role: 'reader' | 'operator' | 'owner';
  expiresAt: string;
}
export interface AdminAccessAccount {
  id: string;
  subject: string;
  displayName: string;
  role: 'reader' | 'operator' | 'owner';
  disabled: boolean;
}
export interface AdminAccessResponse {
  accounts: AdminAccessAccount[];
  sessions: { id: string; accountId: string; createdAt: string; expiresAt: string }[];
}

export class AdminDashboardRequestError extends Error {
  constructor(readonly status: number, message = 'Admin dashboard could not be loaded.') {
    super(message);
    this.name = 'AdminDashboardRequestError';
  }
}

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
  readonly sessionGeneration = signal(0);
  async contributionActivity(
    query: { before?: string; after?: string; id?: string } = {}
  ): Promise<import('@openg7/funding-core').ContributionActivityResponse> {
    return this.activityRequest('?' + new URLSearchParams(query));
  }
  async claimContributionToasts(ids: string[]): Promise<{ ids: string[] }> {
    return this.activityRequest('/present', { ids });
  }
  private async activityRequest<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/contribution-activity${path}`,
      {
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: {
          ...(await this.createHeaders(this.getSavedAdminToken())),
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      throw new AdminDashboardRequestError(response.status, 'ACTIVITY_UNAVAILABLE');
    }
    return response.json() as Promise<T>;
  }
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
  private async pilotageRequest<T>(
    path: string,
    command?: object
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}/admin/pilotage${path}`, {
      method: command ? 'POST' : 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(await this.createHeaders(this.getSavedAdminToken())),
        'Content-Type': 'application/json'
      },
      ...(command ? { body: JSON.stringify(command) } : {})
    });
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
  async publicationAutomation(command?: PublicationAutomationCommand): Promise<PublicationAutomationState | { id?: string }> {
    const response = await fetch(`${this.apiBaseUrl}/admin/publication-automation`, {
      method: command ? 'POST' : 'GET', cache: 'no-store',
      headers: { ...(await this.createHeaders(this.getSavedAdminToken())), 'Content-Type': 'application/json' },
      ...(command ? { body: JSON.stringify(command) } : {})
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { code?: string };
      throw new Error(data.code ?? 'AUTOMATION_UNAVAILABLE');
    }
    return response.json() as Promise<PublicationAutomationState | { id?: string }>;
  }
  async publicationMedia(): Promise<{ id: string; url: string; alt: string; company: string }[]> {
    const response = await fetch(`${this.apiBaseUrl}/admin/publication-automation/media`, { cache: 'no-store', headers: await this.createHeaders(this.getSavedAdminToken()) });
    if (!response.ok) throw new Error('AUTOMATION_UNAVAILABLE');
    return response.json() as Promise<{ id: string; url: string; alt: string; company: string }[]>;
  }
  readonly identity = signal<AdminIdentityProfile | null>(null);
  private usesCookieSession = false;
  async authMode(): Promise<'oidc' | 'token'> {
    const response = await fetch(`${this.apiBaseUrl}/admin/auth/config`, {
      cache: 'no-store'
    });
    if (!response.ok)
      throw new Error('Authentication configuration unavailable.');
    return (await response.json()).mode;
  }
  identitySignInUrl(returnUrl: string): string {
    return `${this.apiBaseUrl}/admin/auth/start?returnUrl=${encodeURIComponent(returnUrl)}`;
  }
  async restoreSession(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const saved = this.getSavedAdminToken();
    if (saved && saved !== cookieSessionMarker) return true;
    try {
      const response = await fetch(`${this.apiBaseUrl}/admin/auth/current`, {
        cache: 'no-store'
      });
      if (!response.ok) {
        this.clearAdminSession();
        return false;
      }
      const identity = (await response.json()) as AdminIdentityProfile;
      this.usesCookieSession = true;
      this.identity.set(identity);
      window.sessionStorage.setItem(
        sessionTokenStorageKey,
        cookieSessionMarker
      );
      window.sessionStorage.setItem(
        sessionExpiresAtStorageKey,
        identity.expiresAt
      );
      return true;
    } catch {
      this.clearAdminSession();
      return false;
    }
  }
  async signOut(): Promise<void> {
    if (
      this.usesCookieSession ||
      (typeof window !== 'undefined' &&
        window.sessionStorage.getItem(sessionTokenStorageKey) ===
          cookieSessionMarker)
    ) {
      const response = await fetch(`${this.apiBaseUrl}/admin/auth/logout`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Sign-out unavailable.');
    }
    this.usesCookieSession = false;
    this.clearAdminSession();
  }
  async accessAccounts(): Promise<AdminAccessResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/access`, {
      cache: 'no-store'
    });
    if (!response.ok) await this.accessError(response);
    return response.json();
  }
  async updateAccess(
    input: (AdminAccessAccount | { sessionId: string }) & { confirmation: string }
  ): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/admin/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!response.ok) await this.accessError(response);
  }
  private async accessError(response: Response): Promise<never> {
    if (response.status === 401) this.clearAdminSession();
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new AdminDashboardRequestError(
      response.status,
      body.code ?? 'ACCESS_UNAVAILABLE'
    );
  }
  private readonly apiBaseUrl = this.resolveApiBaseUrl();
  readonly workQueue = signal<AdminWorkQueueResponse | null>(null);
  private queueGeneration = 0;

  getSelectedSponsorship(): string | undefined {
    if (typeof window === "undefined" || !this.hasValidAdminSession())
      return undefined;
    const id = window.sessionStorage.getItem(selectedSponsorshipStorageKey);
    return id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : undefined;
  }

  selectSponsorship(id: string | null): void {
    if (typeof window === "undefined") return;
    if (id) window.sessionStorage.setItem(selectedSponsorshipStorageKey, id);
    else window.sessionStorage.removeItem(selectedSponsorshipStorageKey);
  }

  async refreshWorkQueue(): Promise<void> {
    const token = this.getSavedAdminToken();
    if (!token) return;
    try {
      await this.getWorkQueue(token, { pageSize: 1 });
    } catch {
      /* Count is unknown after a failed refresh. */
    }
  }

  async getSponsorshipProgress(
    token: string,
    sponsorshipId?: string,
  ): Promise<AdminSponsorshipProgressResponse> {
    const params = new URLSearchParams(sponsorshipId ? { sponsorshipId } : {});
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/progress?${params}`,
      {
        cache: "no-store",
        headers: await this.createHeaders(token),
      },
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminSponsorshipProgressResponse;
  }

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
    this.sessionGeneration.update((value) => value + 1);
    this.identity.set(null);
    this.queueGeneration++;
    this.workQueue.set(null);
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.removeItem(sessionTokenStorageKey);
    window.sessionStorage.removeItem(selectedSponsorshipStorageKey);
    window.sessionStorage.removeItem(sessionExpiresAtStorageKey);
    window.sessionStorage.removeItem(legacyTokenStorageKey);
    window.localStorage.removeItem(legacyTokenStorageKey);
  }

  hasValidAdminSession(): boolean {
    return Boolean(this.getSavedAdminToken());
  }

  async signIn(token: string): Promise<AdminSessionResponse> {
    this.usesCookieSession = false;
    this.identity.set(null);
    const session = await this.createAdminSession(token);
    this.saveAdminSession(session);
    return session;
  }

  async getWorkQueue(
    token: string,
    query: AdminWorkQueueQuery = {},
  ): Promise<AdminWorkQueueResponse> {
    const generation = ++this.queueGeneration;
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      const response = await fetch(
        `${this.apiBaseUrl}/admin/attention?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          headers: await this.createHeaders(token),
        },
      );
      if (!response.ok) throw new AdminDashboardRequestError(response.status);
      const data = (await response.json()) as AdminWorkQueueResponse;
      if (generation === this.queueGeneration)
        this.workQueue.set(data.available ? data : null);
      return data;
    } catch (error) {
      if (generation === this.queueGeneration) this.workQueue.set(null);
      throw error;
    }
  }

  async getDashboard(token: string): Promise<AdminDashboardResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/dashboard`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return (await response.json()) as AdminDashboardResponse;
  }

  async getCockpit<T extends 'metrics' | 'activity' | 'systems'>(
    block: T,
    token: string
  ): Promise<{
    metrics: AdminCockpitMetrics;
    activity: AdminCockpitActivity;
    systems: AdminCockpitSystems;
  }[T]> {
    const response = await fetch(`${this.apiBaseUrl}/admin/cockpit/${block}`, {
      headers: await this.createHeaders(token)
    });
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json();
  }

  async getAssistantSummary(token: string): Promise<AdminAssistantSummary> {
    const response = await fetch(`${this.apiBaseUrl}/admin/assistant/summary`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
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
    const response = await fetch(
      `${this.apiBaseUrl}/admin/assistant/context?${params}`,
      {
        cache: 'no-store',
        headers: await this.createHeaders(token)
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminAssistantContextResponse;
  }

  async requestSponsorshipInformation(
    token: string,
    payload: AdminInformationRequest
  ): Promise<AdminInformationRequestResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/request-information`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminInformationRequestResult;
  }

  async getSponsorshipAccessRecipient(
    token: string,
    contributionId: string
  ): Promise<{ recipient: string | null }> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/followup-access?${new URLSearchParams({ contributionId })}`,
      {
        headers: await this.createHeaders(token),
        cache: 'no-store'
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json();
  }

  async resendSponsorshipAccess(
    token: string,
    payload: import('@openg7/funding-core').AdminSponsorshipAccessRequest
  ): Promise<import('@openg7/funding-core').AdminSponsorshipAccessResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/followup-access`,
      {
        method: 'POST',
        headers: {
          ...(await this.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json();
  }

  async queryAssistant(
    token: string,
    payload: AdminAssistantQueryRequest
  ): Promise<AdminAssistantQueryResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/assistant/query`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return (await response.json()) as AdminAssistantQueryResponse;
  }

  async prepareAssistantDraft(
    token: string,
    payload: AdminAssistantPrepareRequest
  ): Promise<AdminAssistantPrepareResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/assistant/prepare`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return (await response.json()) as AdminAssistantPrepareResponse;
  }

  async getSetupStatus(token: string): Promise<AdminSetupStatusResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/setup-status`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin setup status could not be loaded.');
    }

    return (await response.json()) as AdminSetupStatusResponse;
  }

  async sendEmailTest(
    token: string,
    payload: AdminEmailTestRequest
  ): Promise<AdminEmailTestResult> {
    const response = await fetch(`${this.apiBaseUrl}/admin/email/test`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
          response,
          'Admin email test could not be sent.'
        )
      );
    }

    return (await response.json()) as AdminEmailTestResult;
  }

  async getEmailQueue(token: string, id?: string): Promise<AdminEmailQueueResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/email-queue${id ? "?messageId=" + encodeURIComponent(id) : ""}`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
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
    const response = await fetch(`${this.apiBaseUrl}/admin/email-queue/retry`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
          response,
          'Email queue message could not be retried.'
        )
      );
    }

    return (await response.json()) as AdminEmailQueueRetryResult;
  }

  async getSponsorshipInvoices(
    token: string, contributionId?: string
  ): Promise<AdminSponsorshipInvoicesResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorship-invoices${contributionId ? "?contributionId=" + encodeURIComponent(contributionId) : ""}`,
      {
        method: 'GET',
        headers: await this.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status,
        await this.errorMessageFromResponse(
          response,
          'Admin sponsorship invoices could not be loaded.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipInvoicesResponse;
  }

  async backfillSponsorshipInvoices(
    token: string,
    payload: AdminSponsorshipInvoiceBackfillRequest
  ): Promise<AdminSponsorshipInvoiceBackfillResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorship-invoices/backfill`,
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
          'Sponsorship invoices could not be backfilled.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipInvoiceBackfillResult;
  }

  async resendSponsorshipInvoice(
    token: string,
    payload: AdminSponsorshipInvoiceResendRequest
  ): Promise<AdminSponsorshipInvoiceResendResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorship-invoices/resend`,
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
          'Sponsorship invoice could not be resent.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipInvoiceResendResult;
  }

  async getSponsorshipInvoicePdf(
    token: string,
    invoiceId: string
  ): Promise<Blob> {
    const params = new URLSearchParams({ invoiceId });
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorship-invoices/pdf?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          ...(await this.createHeaders(token)),
          Accept: 'application/pdf'
        }
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status,
        await this.errorMessageFromResponse(
          response,
          'Sponsorship invoice PDF could not be downloaded.'
        )
      );
    }

    return response.blob();
  }

  async resendSponsorshipCreditNote(
    token: string,
    payload: AdminSponsorshipCreditNoteResendRequest
  ): Promise<AdminSponsorshipCreditNoteResendResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorship-credit-notes/resend`,
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
          'Sponsorship credit note could not be resent.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipCreditNoteResendResult;
  }

  async getSponsorshipCreditNotePdf(
    token: string,
    creditNoteId: string
  ): Promise<Blob> {
    const params = new URLSearchParams({ creditNoteId });
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorship-credit-notes/pdf?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          ...(await this.createHeaders(token)),
          Accept: 'application/pdf'
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        await this.errorMessageFromResponse(
          response,
          'Sponsorship credit note PDF could not be downloaded.'
        )
      );
    }

    return response.blob();
  }

  async getStripeEvent(token: string, eventId: string): Promise<AdminStripeEventResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/stripe-event?${new URLSearchParams({ eventId })}`, {
      headers: await this.createHeaders(token), cache: 'no-store'
    });
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json() as Promise<AdminStripeEventResponse>;
  }

  async search(token: string, query: AdminSearchRequest, signal: AbortSignal): Promise<AdminSearchResponse> {
    const headers = await this.createHeaders(token);
    signal.throwIfAborted();
    const response = await fetch(`${this.apiBaseUrl}/admin/search`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal,
      cache: 'no-store'
    });
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminSearchResponse;
  }

  async getContributions(token: string, contributionId?: string): Promise<AdminContributionsResponse> {
    const params = contributionId ? '?' + new URLSearchParams({ contributionId }) : '';
    const response = await fetch(`${this.apiBaseUrl}/admin/contributions${params}`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin contributions could not be loaded.');
    }

    return (await response.json()) as AdminContributionsResponse;
  }

  async getContributionsCsv(
    token: string,
    selection: AdminContributionsExportRequest
  ): Promise<string> {
    const response = await fetch(`${this.apiBaseUrl}/admin/contributions.csv`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        ...(await this.createHeaders(token)),
        Accept: 'text/csv',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(selection)
    });

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return response.text();
  }

  async getExpenses(token: string, expenseId?: string): Promise<AdminExpensesResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/expenses${expenseId ? '?expenseId=' + encodeURIComponent(expenseId) : ''}`, {
      method: 'GET',
      cache: 'no-store',
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
      if (response.status === 409) throw new Error('version_conflict');
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
    token: string, id?: string
  ): Promise<AdminPublicationDraftsResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-drafts${id ? "?draftId=" + encodeURIComponent(id) : ""}`,
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
    token: string, id?: string
  ): Promise<AdminPublicationBatchesResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches${id ? "?batchId=" + encodeURIComponent(id) : ""}`,
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

  async getPublicationSlots(
    token: string, id?: string
  ): Promise<AdminPublicationSlotsResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/publication-slots${id ? "?slotId=" + encodeURIComponent(id) : ""}`, {
      method: 'GET',
      headers: await this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin publication slots could not be loaded.');
    }

    return (await response.json()) as AdminPublicationSlotsResponse;
  }

  async createPublicationSlot(
    token: string,
    payload: AdminPublicationSlotCreateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(`${this.apiBaseUrl}/admin/publication-slots`, {
      method: 'POST',
      headers: {
        ...(await this.createHeaders(token)),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Admin publication slot could not be created.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async updatePublicationSlot(
    token: string,
    payload: AdminPublicationSlotUpdateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-slots/update`,
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
      throw new Error('Admin publication slot could not be updated.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async assignBatchToPublicationSlot(
    token: string,
    payload: AdminPublicationSlotAssignBatchRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-slots/assign-batch`,
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
      throw new Error('Batch could not be assigned to the publication slot.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async assignDraftToPublicationSlot(
    token: string,
    payload: AdminPublicationSlotAssignDraftRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-slots/assign-draft`,
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
      throw new Error('Draft could not be assigned to the publication slot.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async publishPublicationSlot(
    token: string,
    payload: AdminPublicationSlotLifecycleRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-slots/publish`,
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
      throw new Error('Publication slot could not be published.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
  }

  async cancelPublicationSlot(
    token: string,
    payload: AdminPublicationSlotLifecycleRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-slots/cancel`,
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
      throw new Error('Publication slot could not be cancelled.');
    }

    return (await response.json()) as AdminPublicationSlotMutationResult;
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
      throw new Error('Draft could not be removed from the publication batch.');
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

  async getSocialPublicationJobs(
    token: string
  ): Promise<AdminSocialPublicationJobsResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/social-publication-jobs`,
      {
        method: 'GET',
        headers: await this.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin social publication jobs could not be loaded.');
    }

    return (await response.json()) as AdminSocialPublicationJobsResponse;
  }

  async publishSocialPublicationBatch(
    token: string,
    payload: AdminSocialPublicationBatchPublishRequest
  ): Promise<AdminSocialPublicationBatchPublishResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/publication-batches/publish-social`,
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
          'Publication batch could not be sent to the social provider.'
        )
      );
    }

    return (await response.json()) as AdminSocialPublicationBatchPublishResult;
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

  async getAuditLog(token: string, entryId?: string): Promise<AdminAuditLogResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/audit-log${entryId ? '?entryId=' + encodeURIComponent(entryId) : ''}`, {
      method: 'GET',
      cache: 'no-store',
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
      throw new AdminDashboardRequestError(
        response.status,
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
      throw new AdminDashboardRequestError(
        response.status,
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
      throw new AdminDashboardRequestError(
        response.status,
        await this.errorMessageFromResponse(
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
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/media?${params.toString()}`,
      { headers: await this.createHeaders(token) }
    );
    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await this.errorMessageFromResponse(
          response,
          'Sponsor media could not be loaded.'
        )
      );
    }
    return (await response.json()) as SponsorshipMediaResponse;
  }

  async getSponsorMediaPreview(token: string, assetId: string): Promise<Blob> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/media/content/${encodeURIComponent(assetId)}`,
      {
        headers: {
          ...(await this.createHeaders(token)),
          Accept: 'image/*'
        }
      }
    );
    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status, 'Sponsor media preview could not be loaded.');
    }
    return response.blob();
  }

  async reviewSponsorMedia(
    token: string,
    payload: AdminSponsorMediaReviewRequest
  ): Promise<AdminSponsorMediaReviewResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/media/review`,
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
      throw new AdminDashboardRequestError(
        response.status,
        await this.errorMessageFromResponse(
          response,
          'Sponsor media review could not be completed.'
        )
      );
    }
    return (await response.json()) as AdminSponsorMediaReviewResult;
  }

  async deleteSponsorMedia(
    token: string,
    payload: AdminSponsorMediaDeleteRequest
  ): Promise<SponsorMediaDeleteResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/media/delete`,
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
      throw new AdminDashboardRequestError(
        response.status,
        await this.errorMessageFromResponse(
          response,
          'Sponsor media could not be deleted.'
        )
      );
    }
    return (await response.json()) as SponsorMediaDeleteResult;
  }

  async updateSponsorshipDetails(
    token: string,
    payload: AdminSponsorshipDetailsRequest
  ): Promise<AdminSponsorshipDetailsResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/details`,
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
      throw new AdminDashboardRequestError(response.status);
    }
    return (await response.json()) as AdminSponsorshipDetailsResult;
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
      throw new AdminDashboardRequestError(
        response.status,
        await this.errorMessageFromResponse(
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
    const response = await fetch(
      `${this.apiBaseUrl}/admin/sponsorships/refund`,
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
      throw new AdminDashboardRequestError(
        response.status,
        await this.errorMessageFromResponse(
          response,
          'Sponsorship refund could not be created.'
        )
      );
    }

    return (await response.json()) as AdminSponsorshipRefundResult;
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
      throw new AdminDashboardRequestError(
        response.status,
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
      ...(sessionToken && sessionToken !== cookieSessionMarker
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

    this.selectSponsorship(null);
    this.workQueue.set(null);
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
