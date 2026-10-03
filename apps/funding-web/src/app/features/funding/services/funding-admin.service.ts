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
import {
  FundingAdminSponsorshipsClient,
  type AdminSponsorshipListQuery
} from './funding-admin-sponsorships.client.js';
import { FundingAdminPublicationsClient } from './funding-admin-publications.client.js';
import { FundingAdminOperationsClient } from './funding-admin-operations.client.js';
import { FundingAdminDiagnosticsClient } from './funding-admin-diagnostics.client.js';
import { errorMessageFromResponse } from './funding-admin-response.js';
export type { AdminSponsorshipListQuery } from './funding-admin-sponsorships.client.js';
export { AdminDashboardRequestError } from './funding-admin-session.js';
export type {
  AdminIdentityProfile,
  AdminAccessAccount,
  AdminAccessResponse
} from './funding-admin-session.js';

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
  private readonly sponsorshipsClient = new FundingAdminSponsorshipsClient(
    this.session
  );
  private readonly publicationsClient = new FundingAdminPublicationsClient(
    this.session
  );
  private readonly operationsClient = new FundingAdminOperationsClient(
    this.session,
    () => this.clearAdminSession()
  );
  private readonly diagnosticsClient = new FundingAdminDiagnosticsClient(
    this.session
  );
  readonly sessionGeneration = this.session.sessionGeneration;
  readonly identity = this.session.identity;
  stripeBackfill(
    payload?: import('@openg7/funding-core').AdminStripeBackfillRequest,
    id?: string
  ): Promise<{
    run: import('@openg7/funding-core').AdminStripeBackfillRun | null;
  }> {
    return this.operationsClient.stripeBackfill(payload, id);
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
  publicationAutomation(
    command?: PublicationAutomationCommand,
    filter: import('@openg7/funding-core').PublicationAutomationFilter = {}
  ): Promise<PublicationAutomationState | { id?: string }> {
    return this.publicationsClient.publicationAutomation(command, filter);
  }
  publicationMedia(): Promise<
    { id: string; url: string; alt: string; company: string }[]
  > {
    return this.publicationsClient.publicationMedia();
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

  getSponsorshipProgress(
    token: string,
    sponsorshipId?: string
  ): Promise<AdminSponsorshipProgressResponse> {
    return this.sponsorshipsClient.getSponsorshipProgress(token, sponsorshipId);
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
      const data = await this.session.requestAdminData<AdminWorkQueueResponse>(
        `/admin/attention?${params.toString()}`,
        {
          auth: { token },
          method: 'GET',
          cache: 'no-store'
        }
      );
      if (generation === this.queueGeneration)
        this.workQueue.set(data.available ? data : null);
      return data;
    } catch (error) {
      if (generation === this.queueGeneration) this.workQueue.set(null);
      throw error;
    }
  }

  getDashboard(token: string): Promise<AdminDashboardResponse> {
    return this.diagnosticsClient.getDashboard(token);
  }

  getCockpit<T extends 'metrics' | 'activity' | 'systems'>(
    block: T,
    token: string
  ): Promise<
    {
      metrics: AdminCockpitMetrics;
      activity: AdminCockpitActivity;
      systems: AdminCockpitSystems;
    }[T]
  > {
    return this.diagnosticsClient.getCockpit(block, token);
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

  requestSponsorshipInformation(
    token: string,
    payload: AdminInformationRequest
  ): Promise<AdminInformationRequestResult> {
    return this.sponsorshipsClient.requestSponsorshipInformation(
      token,
      payload
    );
  }

  getSponsorshipAccessRecipient(
    token: string,
    contributionId: string
  ): Promise<{ recipient: string | null }> {
    return this.sponsorshipsClient.getSponsorshipAccessRecipient(
      token,
      contributionId
    );
  }

  resendSponsorshipAccess(
    token: string,
    payload: import('@openg7/funding-core').AdminSponsorshipAccessRequest
  ): Promise<import('@openg7/funding-core').AdminSponsorshipAccessResult> {
    return this.sponsorshipsClient.resendSponsorshipAccess(token, payload);
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

  databaseBackups(
    requestId?: string,
    payload?: import('@openg7/funding-core').AdminBackupRequest
  ): Promise<
    | import('@openg7/funding-core').AdminBackupsResponse
    | import('@openg7/funding-core').AdminDatabaseBackup
  > {
    return this.operationsClient.databaseBackups(requestId, payload);
  }

  getSetupStatus(token: string): Promise<AdminSetupStatusResponse> {
    return this.operationsClient.getSetupStatus(token);
  }

  sendEmailTest(
    token: string,
    payload: AdminEmailTestRequest
  ): Promise<AdminEmailTestResult> {
    return this.operationsClient.sendEmailTest(token, payload);
  }

  getEmailTest(
    token: string,
    requestId: string
  ): Promise<AdminEmailTestResult> {
    return this.operationsClient.getEmailTest(token, requestId);
  }

  getEmailQueue(token: string, id?: string): Promise<AdminEmailQueueResponse> {
    return this.operationsClient.getEmailQueue(token, id);
  }

  retryEmailQueueMessage(
    token: string,
    payload: AdminEmailQueueRetryRequest
  ): Promise<AdminEmailQueueRetryResult> {
    return this.operationsClient.retryEmailQueueMessage(token, payload);
  }

  async getSponsorshipInvoices(
    token: string,
    contributionId?: string
  ): Promise<AdminSponsorshipInvoicesResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/sponsorship-invoices${contributionId ? '?contributionId=' + encodeURIComponent(contributionId) : ''}`,
      {
        auth: { token },
        method: 'GET'
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
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
    const response = await this.session.requestAdminJson(
      '/admin/sponsorship-invoices/backfill',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
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
    const response = await this.session.requestAdminJson(
      '/admin/sponsorship-invoices/resend',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
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
    const response = await this.session.requestAdminJson(
      `/admin/sponsorship-invoices/pdf?${params.toString()}`,
      {
        auth: { token },
        method: 'GET',
        headers: { Accept: 'application/pdf' }
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(
        response.status,
        await errorMessageFromResponse(
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
    const response = await this.session.requestAdminJson(
      '/admin/sponsorship-credit-notes/resend',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
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
    const response = await this.session.requestAdminJson(
      `/admin/sponsorship-credit-notes/pdf?${params.toString()}`,
      {
        auth: { token },
        method: 'GET',
        headers: { Accept: 'application/pdf' }
      }
    );

    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(
          response,
          'Sponsorship credit note PDF could not be downloaded.'
        )
      );
    }

    return response.blob();
  }

  getStripeEvent(
    token: string,
    eventId: string
  ): Promise<AdminStripeEventResponse> {
    return this.diagnosticsClient.getStripeEvent(token, eventId);
  }

  search(
    token: string,
    query: AdminSearchRequest,
    signal: AbortSignal
  ): Promise<AdminSearchResponse> {
    return this.diagnosticsClient.search(token, query, signal);
  }

  async getContributions(
    token: string,
    contributionId?: string
  ): Promise<AdminContributionsResponse> {
    const params = contributionId
      ? '?' + new URLSearchParams({ contributionId })
      : '';
    const response = await this.session.requestAdminJson(
      `/admin/contributions${params}`,
      { auth: { token }, method: 'GET' }
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
    const response = await this.session.requestAdminJson(
      '/admin/contributions.csv',
      {
        auth: { token },
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'text/csv', 'Content-Type': 'application/json' },
        body: selection
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
    const response = await this.session.requestAdminJson(
      `/admin/expenses${expenseId ? '?expenseId=' + encodeURIComponent(expenseId) : ''}`,
      { auth: { token }, method: 'GET', cache: 'no-store' }
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
    const response = await this.session.requestAdminJson('/admin/expenses', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
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
    const response = await this.session.requestAdminJson(
      '/admin/expenses/update',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      if (response.status === 409) throw new Error('version_conflict');
      throw new Error('Admin expense could not be updated.');
    }

    return (await response.json()) as AdminExpenseMutationResult;
  }

  async getTransparency(token: string): Promise<AdminTransparencyResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/transparency',
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin transparency could not be loaded.');
    }

    return (await response.json()) as AdminTransparencyResponse;
  }

  getPublicationDrafts(
    token: string,
    id?: string
  ): Promise<AdminPublicationDraftsResponse> {
    return this.publicationsClient.getPublicationDrafts(token, id);
  }

  createPublicationDraft(
    token: string,
    payload: AdminPublicationDraftCreateRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    return this.publicationsClient.createPublicationDraft(token, payload);
  }

  updatePublicationDraft(
    token: string,
    payload: AdminPublicationDraftUpdateRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    return this.publicationsClient.updatePublicationDraft(token, payload);
  }

  getPublicationBatches(
    token: string,
    id?: string
  ): Promise<AdminPublicationBatchesResponse> {
    return this.publicationsClient.getPublicationBatches(token, id);
  }

  createPublicationBatch(
    token: string,
    payload: AdminPublicationBatchCreateRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    return this.publicationsClient.createPublicationBatch(token, payload);
  }

  getPublicationSlots(
    token: string,
    id?: string
  ): Promise<AdminPublicationSlotsResponse> {
    return this.publicationsClient.getPublicationSlots(token, id);
  }

  createPublicationSlot(
    token: string,
    payload: AdminPublicationSlotCreateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    return this.publicationsClient.createPublicationSlot(token, payload);
  }

  updatePublicationSlot(
    token: string,
    payload: AdminPublicationSlotUpdateRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    return this.publicationsClient.updatePublicationSlot(token, payload);
  }

  assignBatchToPublicationSlot(
    token: string,
    payload: AdminPublicationSlotAssignBatchRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    return this.publicationsClient.assignBatchToPublicationSlot(token, payload);
  }

  assignDraftToPublicationSlot(
    token: string,
    payload: AdminPublicationSlotAssignDraftRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    return this.publicationsClient.assignDraftToPublicationSlot(token, payload);
  }

  publishPublicationSlot(
    token: string,
    payload: AdminPublicationSlotLifecycleRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    return this.publicationsClient.publishPublicationSlot(token, payload);
  }

  cancelPublicationSlot(
    token: string,
    payload: AdminPublicationSlotLifecycleRequest
  ): Promise<AdminPublicationSlotMutationResult> {
    return this.publicationsClient.cancelPublicationSlot(token, payload);
  }

  assignDraftToBatch(
    token: string,
    payload: AdminPublicationBatchAssignRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    return this.publicationsClient.assignDraftToBatch(token, payload);
  }

  unassignDraftFromBatch(
    token: string,
    payload: AdminPublicationBatchUnassignRequest
  ): Promise<AdminPublicationDraftMutationResult> {
    return this.publicationsClient.unassignDraftFromBatch(token, payload);
  }

  schedulePublicationBatch(
    token: string,
    payload: AdminPublicationBatchScheduleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    return this.publicationsClient.schedulePublicationBatch(token, payload);
  }

  publishPublicationBatch(
    token: string,
    payload: AdminPublicationBatchLifecycleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    return this.publicationsClient.publishPublicationBatch(token, payload);
  }

  getSocialPublicationJobs(
    token: string
  ): Promise<AdminSocialPublicationJobsResponse> {
    return this.publicationsClient.getSocialPublicationJobs(token);
  }

  publishSocialPublicationBatch(
    token: string,
    payload: AdminSocialPublicationBatchPublishRequest
  ): Promise<AdminSocialPublicationBatchPublishResult> {
    return this.publicationsClient.publishSocialPublicationBatch(
      token,
      payload
    );
  }

  cancelPublicationBatch(
    token: string,
    payload: AdminPublicationBatchLifecycleRequest
  ): Promise<AdminPublicationBatchMutationResult> {
    return this.publicationsClient.cancelPublicationBatch(token, payload);
  }

  getAuditLog(token: string, entryId?: string): Promise<AdminAuditLogResponse> {
    return this.diagnosticsClient.getAuditLog(token, entryId);
  }

  getSponsorships(
    token: string,
    query?: AdminSponsorshipListQuery
  ): Promise<AdminSponsorshipsResponse> {
    return this.sponsorshipsClient.getSponsorships(token, query);
  }

  uploadSponsorLogo(
    token: string,
    contributionId: string,
    expectedVersion: string,
    logo: File
  ): Promise<AdminSponsorLogoUploadResult> {
    return this.sponsorshipsClient.uploadSponsorLogo(
      token,
      contributionId,
      expectedVersion,
      logo
    );
  }

  getSponsorLogoPreview(token: string, contributionId: string): Promise<Blob> {
    return this.sponsorshipsClient.getSponsorLogoPreview(token, contributionId);
  }

  deleteSponsorLogo(
    token: string,
    contributionId: string,
    expectedVersion: string
  ): Promise<AdminSponsorLogoDeleteResult> {
    return this.sponsorshipsClient.deleteSponsorLogo(
      token,
      contributionId,
      expectedVersion
    );
  }

  getSponsorMedia(
    token: string,
    contributionId: string
  ): Promise<SponsorshipMediaResponse> {
    return this.sponsorshipsClient.getSponsorMedia(token, contributionId);
  }

  getSponsorMediaPreview(token: string, assetId: string): Promise<Blob> {
    return this.sponsorshipsClient.getSponsorMediaPreview(token, assetId);
  }

  reviewSponsorMedia(
    token: string,
    payload: AdminSponsorMediaReviewRequest
  ): Promise<AdminSponsorMediaReviewResult> {
    return this.sponsorshipsClient.reviewSponsorMedia(token, payload);
  }

  deleteSponsorMedia(
    token: string,
    payload: AdminSponsorMediaDeleteRequest
  ): Promise<SponsorMediaDeleteResult> {
    return this.sponsorshipsClient.deleteSponsorMedia(token, payload);
  }

  getSponsorshipInterventions(
    token: string,
    sponsorshipId: string,
    before?: string
  ): Promise<SponsorshipInterventionsResponse> {
    return this.sponsorshipsClient.getSponsorshipInterventions(
      token,
      sponsorshipId,
      before
    );
  }

  recordSponsorshipIntervention(
    token: string,
    payload: SponsorshipInterventionRequest
  ): Promise<SponsorshipIntervention> {
    return this.sponsorshipsClient.recordSponsorshipIntervention(
      token,
      payload
    );
  }

  updateSponsorshipDetails(
    token: string,
    payload: AdminSponsorshipDetailsRequest
  ): Promise<AdminSponsorshipDetailsResult> {
    return this.sponsorshipsClient.updateSponsorshipDetails(token, payload);
  }

  reviewSponsorship(
    token: string,
    payload: AdminSponsorshipReviewRequest
  ): Promise<AdminSponsorshipReviewResult> {
    return this.sponsorshipsClient.reviewSponsorship(token, payload);
  }

  refundSponsorship(
    token: string,
    payload: AdminSponsorshipRefundRequest
  ): Promise<AdminSponsorshipRefundResult> {
    return this.sponsorshipsClient.refundSponsorship(token, payload);
  }

  updateSponsorshipPublication(
    token: string,
    payload: AdminSponsorshipPublicationRequest
  ): Promise<AdminSponsorshipPublicationResult> {
    return this.sponsorshipsClient.updateSponsorshipPublication(token, payload);
  }

  setSponsorshipWebsiteVisibility(
    token: string,
    payload: SponsorshipWebsiteVisibilityRequest
  ): Promise<void> {
    return this.sponsorshipsClient.setSponsorshipWebsiteVisibility(
      token,
      payload
    );
  }
}
