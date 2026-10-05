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
  AdminEmailDeliveryReconcileRequest,
  AdminEmailQueueMessageRecord,
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

import { FundingAdminSession } from './funding-admin-session.js';
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
import { FundingAdminDocumentsClient } from './funding-admin-documents.client.js';
import { FundingAdminAccountingClient } from './funding-admin-accounting.client.js';
import { FundingAdminActivityClient } from './funding-admin-activity.client.js';
import { FundingAdminPilotageClient } from './funding-admin-pilotage.client.js';
import { FundingAdminAssistantClient } from './funding-admin-assistant.client.js';
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
  private readonly documentsClient = new FundingAdminDocumentsClient(
    this.session
  );
  private readonly accountingClient = new FundingAdminAccountingClient(
    this.session
  );
  private readonly activityClient = new FundingAdminActivityClient(
    this.session,
    () => this.clearAdminSession()
  );
  private readonly pilotageClient = new FundingAdminPilotageClient(
    this.session,
    () => this.clearAdminSession()
  );
  private readonly assistantClient = new FundingAdminAssistantClient(
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
    return this.activityClient.contributionActivity(query);
  }
  async claimContributionToasts(ids: string[]): Promise<{ ids: string[] }> {
    return this.activityClient.claimContributionToasts(ids);
  }
  pilotageProgramme(): Promise<ProgrammeState> {
    return this.pilotageClient.pilotageProgramme();
  }
  proposeProgramme(
    feedId: PublicationFeedId,
    cadence: number,
    includeApproved: boolean
  ): Promise<{ version: string; plan: ProgrammePlan }> {
    return this.pilotageClient.proposeProgramme(
      feedId,
      cadence,
      includeApproved
    );
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
    return this.pilotageClient.editorialVariant(id, version, instruction);
  }
  async pilotage(
    query: { page?: number; domain?: string; id?: string } = {}
  ): Promise<PilotState> {
    return this.pilotageClient.pilotage(query);
  }
  async pilotageCommand(command: PilotCommand): Promise<PilotReceipt> {
    return this.pilotageClient.pilotageCommand(command);
  }
  async pilotageReceipt(id: string): Promise<PilotReceipt> {
    return this.pilotageClient.pilotageReceipt(id);
  }
  async acknowledgePilotReceipt(
    requestId: string,
    reason: string
  ): Promise<PilotReceipt> {
    return this.pilotageClient.acknowledgePilotReceipt(requestId, reason);
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
    return this.assistantClient.getAssistantSummary(token);
  }

  async getAssistantContext(
    token: string,
    sponsorshipId?: string
  ): Promise<AdminAssistantContextResponse> {
    return this.assistantClient.getAssistantContext(token, sponsorshipId);
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
    return this.assistantClient.queryAssistant(token, payload);
  }

  async prepareAssistantDraft(
    token: string,
    payload: AdminAssistantPrepareRequest
  ): Promise<AdminAssistantPrepareResponse> {
    return this.assistantClient.prepareAssistantDraft(token, payload);
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

  reconcileEmailDelivery(
    token: string,
    payload: AdminEmailDeliveryReconcileRequest
  ): Promise<{
    updated: boolean;
    message: AdminEmailQueueMessageRecord | null;
  }> {
    return this.operationsClient.reconcileEmailDelivery(token, payload);
  }

  async getSponsorshipInvoices(
    token: string,
    contributionId?: string
  ): Promise<AdminSponsorshipInvoicesResponse> {
    return this.documentsClient.getSponsorshipInvoices(token, contributionId);
  }

  async backfillSponsorshipInvoices(
    token: string,
    payload: AdminSponsorshipInvoiceBackfillRequest
  ): Promise<AdminSponsorshipInvoiceBackfillResult> {
    return this.documentsClient.backfillSponsorshipInvoices(token, payload);
  }

  async resendSponsorshipInvoice(
    token: string,
    payload: AdminSponsorshipInvoiceResendRequest
  ): Promise<AdminSponsorshipInvoiceResendResult> {
    return this.documentsClient.resendSponsorshipInvoice(token, payload);
  }

  async getSponsorshipInvoicePdf(
    token: string,
    invoiceId: string
  ): Promise<Blob> {
    return this.documentsClient.getSponsorshipInvoicePdf(token, invoiceId);
  }

  async resendSponsorshipCreditNote(
    token: string,
    payload: AdminSponsorshipCreditNoteResendRequest
  ): Promise<AdminSponsorshipCreditNoteResendResult> {
    return this.documentsClient.resendSponsorshipCreditNote(token, payload);
  }

  async getSponsorshipCreditNotePdf(
    token: string,
    creditNoteId: string
  ): Promise<Blob> {
    return this.documentsClient.getSponsorshipCreditNotePdf(
      token,
      creditNoteId
    );
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
    return this.accountingClient.getContributions(token, contributionId);
  }

  async getContributionsCsv(
    token: string,
    selection: AdminContributionsExportRequest
  ): Promise<string> {
    return this.accountingClient.getContributionsCsv(token, selection);
  }

  async getExpenses(
    token: string,
    expenseId?: string
  ): Promise<AdminExpensesResponse> {
    return this.accountingClient.getExpenses(token, expenseId);
  }

  async createExpense(
    token: string,
    payload: AdminExpenseCreateRequest
  ): Promise<AdminExpenseMutationResult> {
    return this.accountingClient.createExpense(token, payload);
  }

  async updateExpense(
    token: string,
    payload: AdminExpenseUpdateRequest
  ): Promise<AdminExpenseMutationResult> {
    return this.accountingClient.updateExpense(token, payload);
  }

  async getTransparency(token: string): Promise<AdminTransparencyResponse> {
    return this.accountingClient.getTransparency(token);
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
    expectedVersion: string,
    confirmation: string
  ): Promise<AdminSponsorLogoDeleteResult> {
    return this.sponsorshipsClient.deleteSponsorLogo(
      token,
      contributionId,
      expectedVersion,
      confirmation
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
