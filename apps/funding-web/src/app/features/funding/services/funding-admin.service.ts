import type {
  AdminWorkQueueQuery,
  AdminWorkQueueResponse,
  PublicationAutomationState,
  PublicationAutomationCommand,
  PilotState,
  PilotCommand,
  PilotReceipt
} from '@openg7/funding-core';
import type {
  ProgrammeState,
  ProgrammePlan,
  PublicationFeedId,
  EditorialIntent
} from '@openg7/funding-core';
import { Injectable, signal } from '@angular/core';
import type {
  AdminSearchRequest,
  SponsorshipWebsiteVisibilityRequest,
  SponsorshipIntervention,
  SponsorshipInterventionRequest,
  SponsorshipInterventionsResponse,
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

import {
  AdminDashboardRequestError,
  FundingAdminSession
} from './funding-admin-session.js';
import type {
  AdminAccessAccount,
  AdminAccessResponse
} from './funding-admin-session.js';
export { AdminDashboardRequestError } from './funding-admin-session.js';
export type {
  AdminIdentityProfile,
  AdminAccessAccount,
  AdminAccessResponse
} from './funding-admin-session.js';
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
  readonly workQueue = signal<AdminWorkQueueResponse | null>(null);
  private queueGeneration = 0;
  private readonly session = new FundingAdminSession(
    () => {
      this.queueGeneration++;
      this.workQueue.set(null);
    },
    () => this.workQueue.set(null)
  );
  readonly sessionGeneration = this.session.sessionGeneration;
  readonly identity = this.session.identity;
  async stripeBackfill(
    payload?: import('@openg7/funding-core').AdminStripeBackfillRequest,
    id?: string
  ): Promise<{
    run: import('@openg7/funding-core').AdminStripeBackfillRun | null;
  }> {
    const response = await this.session.requestAdminJson(
      `/admin/stripe-backfill${id ? '?' + new URLSearchParams({ id }) : ''}`,
      {
        auth: 'saved',
        method: payload ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(payload ? { body: payload } : {}),
        signal: AbortSignal.timeout(90000)
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new AdminDashboardRequestError(
        response.status,
        body.code ?? 'BACKFILL_UNAVAILABLE'
      );
    }
    return response.json();
  }
  async contributionActivity(
    query: { before?: string; after?: string; id?: string } = {}
  ): Promise<import('@openg7/funding-core').ContributionActivityResponse> {
    return this.activityRequest('?' + new URLSearchParams(query));
  }
  async claimContributionToasts(ids: string[]): Promise<{ ids: string[] }> {
    return this.activityRequest('/present', { ids });
  }
  private async activityRequest<T>(path: string, body?: object): Promise<T> {
    const response = await this.session.requestAdminJson(
      `/admin/contribution-activity${path}`,
      {
        auth: 'saved',
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      throw new AdminDashboardRequestError(
        response.status,
        'ACTIVITY_UNAVAILABLE'
      );
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
  async publicationAutomation(
    command?: PublicationAutomationCommand,
    filter: import('@openg7/funding-core').PublicationAutomationFilter = {}
  ): Promise<PublicationAutomationState | { id?: string }> {
    const query = new URLSearchParams();
    if (!command && filter.sponsorshipId)
      query.set('sponsorshipId', filter.sponsorshipId);
    if (!command && filter.deliveryId)
      query.set('deliveryId', filter.deliveryId);
    const response = await this.session.requestAdminJson(
      `/admin/publication-automation${query.size ? `?${query}` : ''}`,
      {
        auth: 'saved',
        method: command ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(command ? { body: command } : {})
      }
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new Error(data.code ?? 'AUTOMATION_UNAVAILABLE');
    }
    return response.json() as Promise<
      PublicationAutomationState | { id?: string }
    >;
  }
  async publicationMedia(): Promise<
    { id: string; url: string; alt: string; company: string }[]
  > {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/publication-automation/media`,
      {
        cache: 'no-store',
        headers: await this.session.createHeaders(this.getSavedAdminToken())
      }
    );
    if (!response.ok) throw new Error('AUTOMATION_UNAVAILABLE');
    return response.json() as Promise<
      { id: string; url: string; alt: string; company: string }[]
    >;
  }
  authMode(): Promise<'oidc' | 'token'> {
    return this.session.authMode();
  }

  identitySignInUrl(returnUrl: string): string {
    return this.session.identitySignInUrl(returnUrl);
  }

  restoreSession(): Promise<boolean> {
    return this.session.restoreSession();
  }

  signOut(): Promise<void> {
    return this.session.signOut();
  }

  accessAccounts(): Promise<AdminAccessResponse> {
    return this.session.accessAccounts();
  }

  updateAccess(
    input: (AdminAccessAccount | { sessionId: string }) & {
      confirmation: string;
    }
  ): Promise<void> {
    return this.session.updateAccess(input);
  }

  getSelectedSponsorship(): string | undefined {
    return this.session.getSelectedSponsorship();
  }

  selectSponsorship(id: string | null): void {
    this.session.selectSponsorship(id);
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
    sponsorshipId?: string
  ): Promise<AdminSponsorshipProgressResponse> {
    const params = new URLSearchParams(sponsorshipId ? { sponsorshipId } : {});
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/progress?${params}`,
      {
        auth: { token },
        cache: 'no-store'
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminSponsorshipProgressResponse;
  }

  getSavedAdminToken(): string {
    return this.session.getSavedAdminToken();
  }

  saveAdminToken(token: string): void {
    this.session.saveAdminToken(token);
  }

  clearAdminSession(): void {
    this.session.clearAdminSession();
  }

  hasValidAdminSession(): boolean {
    return this.session.hasValidAdminSession();
  }

  signIn(token: string): Promise<AdminSessionResponse> {
    return this.session.signIn(token);
  }
  async getWorkQueue(
    token: string,
    query: AdminWorkQueueQuery = {}
  ): Promise<AdminWorkQueueResponse> {
    const generation = ++this.queueGeneration;
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const response = await fetch(
        `${this.session.apiBaseUrl}/admin/attention?${params.toString()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: await this.session.createHeaders(token)
        }
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
    const response = await fetch(`${this.session.apiBaseUrl}/admin/dashboard`, {
      method: 'GET',
      headers: await this.session.createHeaders(token)
    });

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return (await response.json()) as AdminDashboardResponse;
  }

  async getCockpit<T extends 'metrics' | 'activity' | 'systems'>(
    block: T,
    token: string
  ): Promise<
    {
      metrics: AdminCockpitMetrics;
      activity: AdminCockpitActivity;
      systems: AdminCockpitSystems;
    }[T]
  > {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/cockpit/${block}`,
      {
        headers: await this.session.createHeaders(token)
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json();
  }

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
    const response = await this.session.requestAdminJson(
      `/admin/assistant/context?${params}`,
      {
        auth: { token },
        cache: 'no-store'
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminAssistantContextResponse;
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
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminInformationRequestResult;
  }

  async getSponsorshipAccessRecipient(
    token: string,
    contributionId: string
  ): Promise<{ recipient: string | null }> {
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/followup-access?${new URLSearchParams({ contributionId })}`,
      {
        auth: { token },
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
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/followup-access',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json();
  }

  async queryAssistant(
    token: string,
    payload: AdminAssistantQueryRequest
  ): Promise<AdminAssistantQueryResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/assistant/query',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return (await response.json()) as AdminAssistantQueryResponse;
  }

  async prepareAssistantDraft(
    token: string,
    payload: AdminAssistantPrepareRequest
  ): Promise<AdminAssistantPrepareResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/assistant/prepare',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return (await response.json()) as AdminAssistantPrepareResponse;
  }

  async databaseBackups(
    requestId?: string,
    payload?: import('@openg7/funding-core').AdminBackupRequest
  ): Promise<
    | import('@openg7/funding-core').AdminBackupsResponse
    | import('@openg7/funding-core').AdminDatabaseBackup
  > {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/backups${requestId ? '?requestId=' + encodeURIComponent(requestId) : ''}`,
      {
        method: payload ? 'POST' : 'GET',
        headers: {
          ...(await this.session.createHeaders(this.getSavedAdminToken())),
          ...(payload ? { 'Content-Type': 'application/json' } : {})
        },
        ...(payload ? { body: JSON.stringify(payload) } : {})
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new AdminDashboardRequestError(
        response.status,
        'Database backup request failed.',
        body.code
      );
    }
    return response.json();
  }

  async getSetupStatus(token: string): Promise<AdminSetupStatusResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/setup-status`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
      }
    );

    if (!response.ok) {
      await this.session.accessError(response);
    }

    return (await response.json()) as AdminSetupStatusResponse;
  }

  async sendEmailTest(
    token: string,
    payload: AdminEmailTestRequest
  ): Promise<AdminEmailTestResult> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/email/test`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      await this.session.accessError(response);
    }

    return (await response.json()) as AdminEmailTestResult;
  }

  async getEmailTest(
    token: string,
    requestId: string
  ): Promise<AdminEmailTestResult> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/email/test?requestId=${encodeURIComponent(requestId)}`,
      {
        headers: await this.session.createHeaders(token)
      }
    );
    if (!response.ok) await this.session.accessError(response);
    return response.json();
  }

  async getEmailQueue(
    token: string,
    id?: string
  ): Promise<AdminEmailQueueResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/email-queue${id ? '?messageId=' + encodeURIComponent(id) : ''}`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
      }
    );

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
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/email-queue/retry`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

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
    token: string,
    contributionId?: string
  ): Promise<AdminSponsorshipInvoicesResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/sponsorship-invoices${contributionId ? '?contributionId=' + encodeURIComponent(contributionId) : ''}`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
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
      `${this.session.apiBaseUrl}/admin/sponsorship-invoices/backfill`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorship-invoices/resend`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorship-invoices/pdf?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          ...(await this.session.createHeaders(token)),
          Accept: 'application/pdf'
        }
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
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
      `${this.session.apiBaseUrl}/admin/sponsorship-credit-notes/resend`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorship-credit-notes/pdf?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          ...(await this.session.createHeaders(token)),
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

  async getStripeEvent(
    token: string,
    eventId: string
  ): Promise<AdminStripeEventResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/stripe-event?${new URLSearchParams({ eventId })}`,
      {
        headers: await this.session.createHeaders(token),
        cache: 'no-store'
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.json() as Promise<AdminStripeEventResponse>;
  }

  async search(
    token: string,
    query: AdminSearchRequest,
    signal: AbortSignal
  ): Promise<AdminSearchResponse> {
    const headers = await this.session.createHeaders(token);
    signal.throwIfAborted();
    const response = await fetch(`${this.session.apiBaseUrl}/admin/search`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal,
      cache: 'no-store'
    });
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminSearchResponse;
  }

  async getContributions(
    token: string,
    contributionId?: string
  ): Promise<AdminContributionsResponse> {
    const params = contributionId
      ? '?' + new URLSearchParams({ contributionId })
      : '';
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/contributions${params}`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin contributions could not be loaded.');
    }

    return (await response.json()) as AdminContributionsResponse;
  }

  async getContributionsCsv(
    token: string,
    selection: AdminContributionsExportRequest
  ): Promise<string> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/contributions.csv`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...(await this.session.createHeaders(token)),
          Accept: 'text/csv',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(selection)
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return response.text();
  }

  async getExpenses(
    token: string,
    expenseId?: string
  ): Promise<AdminExpensesResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/expenses${expenseId ? '?expenseId=' + encodeURIComponent(expenseId) : ''}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: await this.session.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin expenses could not be loaded.');
    }

    return (await response.json()) as AdminExpensesResponse;
  }

  async createExpense(
    token: string,
    payload: AdminExpenseCreateRequest
  ): Promise<AdminExpenseMutationResult> {
    const response = await fetch(`${this.session.apiBaseUrl}/admin/expenses`, {
      method: 'POST',
      headers: {
        ...(await this.session.createHeaders(token)),
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
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/expenses/update`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      if (response.status === 409) throw new Error('version_conflict');
      throw new Error('Admin expense could not be updated.');
    }

    return (await response.json()) as AdminExpenseMutationResult;
  }

  async getTransparency(token: string): Promise<AdminTransparencyResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/transparency`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin transparency could not be loaded.');
    }

    return (await response.json()) as AdminTransparencyResponse;
  }

  async getPublicationDrafts(
    token: string,
    id?: string
  ): Promise<AdminPublicationDraftsResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/publication-drafts${id ? '?draftId=' + encodeURIComponent(id) : ''}`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
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
      `${this.session.apiBaseUrl}/admin/publication-drafts`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-drafts/update`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
    token: string,
    id?: string
  ): Promise<AdminPublicationBatchesResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/publication-batches${id ? '?batchId=' + encodeURIComponent(id) : ''}`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
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
      `${this.session.apiBaseUrl}/admin/publication-batches`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
    token: string,
    id?: string
  ): Promise<AdminPublicationSlotsResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/publication-slots${id ? '?slotId=' + encodeURIComponent(id) : ''}`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
      }
    );

    if (!response.ok) {
      throw new Error('Admin publication slots could not be loaded.');
    }

    return (await response.json()) as AdminPublicationSlotsResponse;
  }

  async createPublicationSlot(
    token: string,
    payload: AdminPublicationSlotCreateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/publication-slots`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

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
      `${this.session.apiBaseUrl}/admin/publication-slots/update`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-slots/assign-batch`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-slots/assign-draft`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-slots/publish`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-slots/cancel`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-batches/assign`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-batches/unassign`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-batches/schedule`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-batches/publish`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/social-publication-jobs`,
      {
        method: 'GET',
        headers: await this.session.createHeaders(token)
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
      `${this.session.apiBaseUrl}/admin/publication-batches/publish-social`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/publication-batches/cancel`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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

  async getAuditLog(
    token: string,
    entryId?: string
  ): Promise<AdminAuditLogResponse> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/audit-log${entryId ? '?entryId=' + encodeURIComponent(entryId) : ''}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: await this.session.createHeaders(token)
      }
    );

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

    const url = `${this.session.apiBaseUrl}/admin/sponsorships${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.session.createHeaders(token)
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

    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/sponsorships/logo`,
      {
        method: 'POST',
        headers: await this.session.createHeaders(token),
        body
      }
    );

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
      `${this.session.apiBaseUrl}/admin/sponsorships/logo?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorships/logo/delete`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorships/media?${params.toString()}`,
      { headers: await this.session.createHeaders(token) }
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
      `${this.session.apiBaseUrl}/admin/sponsorships/media/content/${encodeURIComponent(assetId)}`,
      {
        headers: {
          ...(await this.session.createHeaders(token)),
          Accept: 'image/*'
        }
      }
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
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/sponsorships/media/review`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorships/media/delete`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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

  async getSponsorshipInterventions(
    token: string,
    sponsorshipId: string,
    before?: string
  ): Promise<SponsorshipInterventionsResponse> {
    const params = new URLSearchParams({
      sponsorshipId,
      ...(before ? { before } : {})
    });
    const response = await this.session.requestAdminJson(
      `/admin/sponsorships/interventions?${params}`,
      { auth: { token }, cache: 'no-store' }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as SponsorshipInterventionsResponse;
  }

  async recordSponsorshipIntervention(
    token: string,
    payload: SponsorshipInterventionRequest
  ): Promise<SponsorshipIntervention> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/interventions',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as SponsorshipIntervention;
  }

  async updateSponsorshipDetails(
    token: string,
    payload: AdminSponsorshipDetailsRequest
  ): Promise<AdminSponsorshipDetailsResult> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/sponsorships/details`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorships/review`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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
      `${this.session.apiBaseUrl}/admin/sponsorships/refund`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
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
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/sponsorships/publication`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
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

  async setSponsorshipWebsiteVisibility(
    token: string,
    payload: SponsorshipWebsiteVisibilityRequest
  ): Promise<void> {
    const response = await fetch(
      `${this.session.apiBaseUrl}/admin/sponsorships/website-visibility`,
      {
        method: 'POST',
        headers: {
          ...(await this.session.createHeaders(token)),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok)
      throw new AdminDashboardRequestError(
        response.status,
        'Website visibility could not be updated.'
      );
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
}
