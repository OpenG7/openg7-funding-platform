import type {
  AdminSponsorshipCreditNoteResendRequest,
  AdminSponsorshipCreditNoteResendResult,
  AdminSponsorshipInvoiceBackfillRequest,
  AdminSponsorshipInvoiceBackfillResult,
  AdminSponsorshipInvoiceResendRequest,
  AdminSponsorshipInvoiceResendResult,
  AdminSponsorshipInvoicesResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorMessageFromResponse } from './funding-admin-response.js';

/** Funding admin invoice and credit-note endpoints. Authentication belongs to the shared session. */
export class FundingAdminDocumentsClient {
  constructor(private readonly session: FundingAdminSession) {}

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
}
