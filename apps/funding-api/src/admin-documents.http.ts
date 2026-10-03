import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminSponsorshipCreditNoteResendRequest,
  AdminSponsorshipCreditNoteResendResult,
  AdminSponsorshipInvoiceBackfillRequest,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceResendRequest,
  AdminSponsorshipInvoiceResendResult
} from '@openg7/funding-core';

import { SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION } from '../../../packages/funding-core/src/index.js';

import type { queueAdminDocumentResend } from './admin-document-resend.service.js';
import type { AdminAuditLogInput } from './fund-admin.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type {
  renderSponsorshipCreditNotePdf,
  renderSponsorshipInvoicePdf,
  sponsorshipCreditNotePdfFilename,
  sponsorshipInvoicePdfFilename
} from './sponsorship-document-pdf.service.js';
import type {
  backfillMissingSponsorshipInvoices,
  getAdminSponsorshipCreditNoteById,
  getAdminSponsorshipInvoiceById,
  getSponsorshipCreditNoteById,
  getSponsorshipInvoiceById,
  listAdminSponsorshipInvoices
} from './sponsorship-invoices.repository.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Document ports retain snapshots, accounting and idempotent resend in services. */
export interface AdminDocumentsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly databaseAvailable: () => boolean;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writePdf: ReturnType<typeof createHttpTransport>['writePdf'];
  readonly getTransactionalEmailConfigStatus: () => {
    readonly configured: boolean;
  };
  readonly isValidUuid: (value: unknown) => value is string;
  readonly isValidSponsorEmail: (value: unknown) => value is string;
  readonly listAdminSponsorshipInvoices: (
    contributionId?: string
  ) => ReturnType<typeof listAdminSponsorshipInvoices>;
  readonly backfillMissingSponsorshipInvoices: (
    input: AdminSponsorshipInvoiceBackfillRequest
  ) => ReturnType<typeof backfillMissingSponsorshipInvoices>;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<unknown>;
  readonly getSponsorshipInvoiceById: (
    invoiceId: string
  ) => ReturnType<typeof getSponsorshipInvoiceById>;
  readonly getAdminSponsorshipInvoiceById: (
    invoiceId: string
  ) => ReturnType<typeof getAdminSponsorshipInvoiceById>;
  readonly getSponsorshipCreditNoteById: (
    creditNoteId: string
  ) => ReturnType<typeof getSponsorshipCreditNoteById>;
  readonly getAdminSponsorshipCreditNoteById: (
    creditNoteId: string
  ) => ReturnType<typeof getAdminSponsorshipCreditNoteById>;
  readonly renderSponsorshipInvoicePdf: typeof renderSponsorshipInvoicePdf;
  readonly renderSponsorshipCreditNotePdf: typeof renderSponsorshipCreditNotePdf;
  readonly sponsorshipInvoicePdfFilename: typeof sponsorshipInvoicePdfFilename;
  readonly sponsorshipCreditNotePdfFilename: typeof sponsorshipCreditNotePdfFilename;
  readonly queueAdminDocumentResend: (
    input: Parameters<typeof queueAdminDocumentResend>[1],
    actor: string
  ) => ReturnType<typeof queueAdminDocumentResend>;
  readonly DocumentResendConflict: new (
    message?: string
  ) => Error & { readonly code: string };
  readonly reportFailure: (message: string, error?: unknown) => void;
}

/** Private document routes check API rights before parsing or accessing a snapshot. */
export const createAdminDocumentsHttpHandler = ({
  publicBaseOrigin,
  databaseAvailable,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  writePdf,
  getTransactionalEmailConfigStatus,
  isValidUuid,
  isValidSponsorEmail,
  listAdminSponsorshipInvoices,
  backfillMissingSponsorshipInvoices,
  insertAdminAuditLog,
  getSponsorshipInvoiceById,
  getAdminSponsorshipInvoiceById,
  getSponsorshipCreditNoteById,
  getAdminSponsorshipCreditNoteById,
  renderSponsorshipInvoicePdf,
  renderSponsorshipCreditNotePdf,
  sponsorshipInvoicePdfFilename,
  sponsorshipCreditNotePdfFilename,
  queueAdminDocumentResend,
  DocumentResendConflict,
  reportFailure
}: AdminDocumentsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorship-invoices',
        '/api/admin/sponsorship-invoices'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const result = await listAdminSponsorshipInvoices(
          new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
            'contributionId'
          ) ?? undefined
        );
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin sponsorship invoices.', error);
        writeJson(request, response, 502, {
          error:
            'Admin sponsorship invoices could not be loaded. Apply migrations 010, 011 and 012.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorship-invoices/backfill',
        '/api/admin/sponsorship-invoices/backfill'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error:
            'Invoice backfill requires DATABASE_URL and migrations 011/012.'
        });
        return true;
      }

      let parsed: AdminSponsorshipInvoiceBackfillRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        const raw = body.trim()
          ? (JSON.parse(
              body
            ) as Partial<AdminSponsorshipInvoiceBackfillRequest> | null)
          : {};
        if (
          raw &&
          'contributionId' in raw &&
          (typeof raw.contributionId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              raw.contributionId
            ))
        ) {
          throw new Error('Invalid contributionId');
        }
        parsed = {
          contributionId: raw?.contributionId,
          limit: typeof raw?.limit === 'number' ? raw.limit : undefined,
          confirmation:
            typeof raw?.confirmation === 'string' ? raw.confirmation : ''
        };
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid invoice backfill request body.'
        });
        return true;
      }

      if (
        parsed.confirmation !==
        (parsed.contributionId ?? SPONSORSHIP_INVOICE_BACKFILL_CONFIRMATION)
      ) {
        writeJson(request, response, 400, {
          code: 'confirmation_required',
          error: 'Confirm the invoice backfill scope before proceeding.'
        });
        return true;
      }

      if (
        parsed.limit !== undefined &&
        (!Number.isInteger(parsed.limit) ||
          parsed.limit < 1 ||
          parsed.limit > 1000)
      ) {
        writeJson(request, response, 400, {
          error: 'Invoice backfill limit must be an integer between 1 and 1000.'
        });
        return true;
      }

      try {
        const result = await backfillMissingSponsorshipInvoices(parsed);

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'sponsorship_invoice.backfill',
          entityType: 'sponsorship_invoice',
          entityId: null,
          summary: `Sponsorship invoice backfill created ${result.created_count} invoice(s).`,
          metadata: {
            contributionId: parsed.contributionId ?? null,
            eligibleCount: result.eligible_count,
            missingCount: result.missing_count,
            processedCount: result.processed_count,
            createdCount: result.created_count,
            skippedCount: result.skipped_count,
            remainingCount: result.remaining_count,
            failedCount: result.failed_count,
            invoiceIds: result.invoiceIds
          }
        });

        const payload: AdminSponsorshipInvoiceBackfillResult = result;
        writeJson(request, response, 200, payload);
      } catch (error) {
        reportFailure('Failed to backfill sponsorship invoices.', error);
        writeJson(request, response, 502, {
          error:
            'Sponsorship invoices could not be backfilled. Check migrations 011/012 and contribution data.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorship-invoices/pdf',
        '/api/admin/sponsorship-invoices/pdf'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Invoice PDF requires DATABASE_URL and migration 011.'
        });
        return true;
      }

      const invoiceId =
        new URL(request.url ?? '/', publicBaseOrigin).searchParams
          .get('invoiceId')
          ?.trim() ?? '';
      if (!isValidUuid(invoiceId)) {
        writeJson(request, response, 400, {
          error: 'Invoice id is invalid.'
        });
        return true;
      }

      try {
        const invoice = await getSponsorshipInvoiceById(invoiceId);
        if (!invoice) {
          writeJson(request, response, 404, {
            error: 'Sponsorship invoice was not found.'
          });
          return true;
        }

        writePdf(
          request,
          response,
          200,
          await renderSponsorshipInvoicePdf(invoice),
          sponsorshipInvoicePdfFilename(invoice)
        );
      } catch (error) {
        reportFailure('Failed to generate sponsorship invoice PDF.', error);
        writeJson(request, response, 502, {
          error: 'Sponsorship invoice PDF could not be generated.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorship-invoices/resend',
        '/api/admin/sponsorship-invoices/resend'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error:
            'Invoice resend requires DATABASE_URL and migrations 011 and 012.'
        });
        return true;
      }

      if (!getTransactionalEmailConfigStatus().configured) {
        writeJson(request, response, 400, {
          error: 'SMTP email provider is not configured.'
        });
        return true;
      }

      let parsed: AdminSponsorshipInvoiceResendRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = JSON.parse(body) as AdminSponsorshipInvoiceResendRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid invoice resend request body.'
        });
        return true;
      }

      if (!parsed || !isValidUuid(parsed.invoiceId)) {
        writeJson(request, response, 400, {
          error: 'Invoice id is invalid.'
        });
        return true;
      }

      if (
        parsed.confirmation !== parsed.invoiceId ||
        !isValidUuid(parsed.requestId)
      ) {
        writeJson(request, response, 400, {
          code: 'CONFIRMATION_REQUIRED',
          error: 'Confirm this document and provide a request UUID.'
        });
        return true;
      }

      try {
        const invoice = await getSponsorshipInvoiceById(parsed.invoiceId);
        if (!invoice) {
          writeJson(request, response, 404, {
            error: 'Sponsorship invoice was not found.'
          });
          return true;
        }

        const recipient = typeof parsed.to === 'string' ? parsed.to.trim() : '';

        if (!isValidSponsorEmail(recipient)) {
          writeJson(request, response, 400, {
            error: 'A valid invoice recipient email is required.'
          });
          return true;
        }

        const result = await queueAdminDocumentResend(
          { to: recipient, invoice, requestId: parsed.requestId },
          getAdminAuditActor(request)
        );
        const refreshedInvoice = await getAdminSponsorshipInvoiceById(
          invoice.id
        );

        const payload: AdminSponsorshipInvoiceResendResult = {
          queued: result.queued,
          attempted: result.attempted,
          sent: result.sent,
          messageId: result.messageId,
          error: result.error,
          invoice: refreshedInvoice
        };
        writeJson(request, response, 200, payload);
      } catch (error) {
        if (error instanceof DocumentResendConflict) {
          writeJson(request, response, 409, {
            code: error.code,
            error: error.message
          });
          return true;
        }
        reportFailure('Failed to resend sponsorship invoice.');
        writeJson(request, response, 502, {
          error:
            'Sponsorship invoice could not be resent. Check migrations 011 and 012 and email queue configuration.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorship-credit-notes/pdf',
        '/api/admin/sponsorship-credit-notes/pdf'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Credit note PDF requires DATABASE_URL and migration 012.'
        });
        return true;
      }

      const creditNoteId =
        new URL(request.url ?? '/', publicBaseOrigin).searchParams
          .get('creditNoteId')
          ?.trim() ?? '';
      if (!isValidUuid(creditNoteId)) {
        writeJson(request, response, 400, {
          error: 'Credit note id is invalid.'
        });
        return true;
      }

      try {
        const creditNote = await getSponsorshipCreditNoteById(creditNoteId);
        if (!creditNote) {
          writeJson(request, response, 404, {
            error: 'Sponsorship credit note was not found.'
          });
          return true;
        }

        writePdf(
          request,
          response,
          200,
          await renderSponsorshipCreditNotePdf(creditNote),
          sponsorshipCreditNotePdfFilename(creditNote)
        );
      } catch (error) {
        reportFailure('Failed to generate sponsorship credit note PDF.', error);
        writeJson(request, response, 502, {
          error: 'Sponsorship credit note PDF could not be generated.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorship-credit-notes/resend',
        '/api/admin/sponsorship-credit-notes/resend'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Credit note resend requires DATABASE_URL and migration 012.'
        });
        return true;
      }

      if (!getTransactionalEmailConfigStatus().configured) {
        writeJson(request, response, 400, {
          error: 'SMTP email provider is not configured.'
        });
        return true;
      }

      let parsed: AdminSponsorshipCreditNoteResendRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = JSON.parse(body) as AdminSponsorshipCreditNoteResendRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid credit note resend request body.'
        });
        return true;
      }

      if (!parsed || !isValidUuid(parsed.creditNoteId)) {
        writeJson(request, response, 400, {
          error: 'Credit note id is invalid.'
        });
        return true;
      }

      if (
        parsed.confirmation !== parsed.creditNoteId ||
        !isValidUuid(parsed.requestId)
      ) {
        writeJson(request, response, 400, {
          code: 'CONFIRMATION_REQUIRED',
          error: 'Confirm this document and provide a request UUID.'
        });
        return true;
      }

      try {
        const creditNote = await getSponsorshipCreditNoteById(
          parsed.creditNoteId
        );
        if (!creditNote) {
          writeJson(request, response, 404, {
            error: 'Sponsorship credit note was not found.'
          });
          return true;
        }

        const recipient = typeof parsed.to === 'string' ? parsed.to.trim() : '';

        if (!isValidSponsorEmail(recipient)) {
          writeJson(request, response, 400, {
            error: 'A valid credit note recipient email is required.'
          });
          return true;
        }

        const result = await queueAdminDocumentResend(
          { to: recipient, creditNote, requestId: parsed.requestId },
          getAdminAuditActor(request)
        );
        const refreshedCreditNote = await getAdminSponsorshipCreditNoteById(
          creditNote.id
        );

        const payload: AdminSponsorshipCreditNoteResendResult = {
          queued: result.queued,
          attempted: result.attempted,
          sent: result.sent,
          messageId: result.messageId,
          error: result.error,
          creditNote: refreshedCreditNote
        };
        writeJson(request, response, 200, payload);
      } catch (error) {
        if (error instanceof DocumentResendConflict) {
          writeJson(request, response, 409, {
            code: error.code,
            error: error.message
          });
          return true;
        }
        reportFailure('Failed to resend sponsorship credit note.');
        writeJson(request, response, 502, {
          error:
            'Sponsorship credit note could not be resent. Check migration 012 and email queue configuration.'
        });
      }
      return true;
    }

    return false;
  };
};
