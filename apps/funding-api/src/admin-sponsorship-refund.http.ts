import type { IncomingMessage, ServerResponse } from 'node:http';

import Stripe from 'stripe';
import type {
  AdminSponsorshipRefundRequest,
  AdminSponsorshipRefundResult,
  AdminSponsorshipStripeRefundReason
} from '@openg7/funding-core';

import type {
  queueSponsorshipCreditNoteEmail,
  queueSponsorshipRefundEmail
} from './email-notification.service.js';
import type { AdminAuditLogInput } from './fund-admin.repository.js';
import type {
  getAdminSponsorshipById,
  getSponsorshipRefundTarget,
  updateContributionStatusByPaymentIntent
} from './fund-contributions.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type {
  createSponsorshipCreditNoteForRefund,
  getAdminSponsorshipCreditNoteById
} from './sponsorship-invoices.repository.js';
import {
  SponsorshipRefundOperationError,
  type beginSponsorshipRefundOperation,
  type failSponsorshipRefundOperation,
  type settleSponsorshipRefundOperation
} from './sponsorship-refund-operations.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Refund ports retain the durable claim before any provider call. */
export interface AdminSponsorshipRefundHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly isProduction: boolean;
  readonly stripe: Pick<Stripe, 'refunds'> | null;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (
    request: ApiRequest,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidUuid: (value: unknown) => value is string;
  readonly isValidAdminExpectedVersion: (value: unknown) => value is string;
  readonly isAllowedSponsorshipStripeRefundReason: (
    value: unknown
  ) => value is AdminSponsorshipStripeRefundReason;
  readonly isValidOptionalBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly isValidSponsorEmail: (value: unknown) => value is string;
  readonly adminReviewNoteMaxLength: number;
  readonly sponsorMessageMaxLength: number;
  readonly amountToCents: (amount: number) => number;
  readonly sponsorshipRefundConfirmationText: (input: {
    readonly publicReference: string | null;
    readonly id: string;
  }) => string;
  readonly writeSponsorshipRefundIneligible: (
    request: ApiRequest,
    response: ApiResponse,
    paymentStatus: string | null
  ) => void;
  readonly createDevelopmentRefundResult: (input: {
    readonly amountCents: number;
    readonly currency: string;
    readonly paymentIntentId: string;
  }) => Stripe.Refund;
  readonly getSponsorshipRefundTarget: (
    contributionId: string
  ) => ReturnType<typeof getSponsorshipRefundTarget>;
  readonly beginSponsorshipRefundOperation: (
    input: Parameters<typeof beginSponsorshipRefundOperation>[1]
  ) => ReturnType<typeof beginSponsorshipRefundOperation>;
  readonly settleSponsorshipRefundOperation: (
    refund: Parameters<typeof settleSponsorshipRefundOperation>[1],
    operationId: string
  ) => ReturnType<typeof settleSponsorshipRefundOperation>;
  readonly failSponsorshipRefundOperation: (
    operationId: string,
    definitive: Parameters<typeof failSponsorshipRefundOperation>[2]
  ) => ReturnType<typeof failSponsorshipRefundOperation>;
  readonly updateContributionStatusByPaymentIntent: (
    input: Parameters<typeof updateContributionStatusByPaymentIntent>[1]
  ) => ReturnType<typeof updateContributionStatusByPaymentIntent>;
  readonly createSponsorshipCreditNoteForRefund: (
    input: Parameters<typeof createSponsorshipCreditNoteForRefund>[1]
  ) => ReturnType<typeof createSponsorshipCreditNoteForRefund>;
  readonly getAdminSponsorshipCreditNoteById: (
    creditNoteId: string
  ) => ReturnType<typeof getAdminSponsorshipCreditNoteById>;
  readonly queueSponsorshipCreditNoteEmail: (
    input: Parameters<typeof queueSponsorshipCreditNoteEmail>[1]
  ) => ReturnType<typeof queueSponsorshipCreditNoteEmail>;
  readonly queueSponsorshipRefundEmail: (
    input: Parameters<typeof queueSponsorshipRefundEmail>[1]
  ) => ReturnType<typeof queueSponsorshipRefundEmail>;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<boolean>;
  readonly getAdminSponsorshipById: (
    contributionId: string
  ) => ReturnType<typeof getAdminSponsorshipById>;
  readonly reportFailure: (message: string, ...details: unknown[]) => void;
}

export const createAdminSponsorshipRefundHttpHandler = (
  dependencies: AdminSponsorshipRefundHttpDependencies
) => {
  const {
    isProduction,
    stripe,
    ensureAdminAccess,
    getAdminAuditActor,
    readBody,
    writeJson,
    isValidUuid,
    isValidAdminExpectedVersion,
    isAllowedSponsorshipStripeRefundReason,
    isValidOptionalBoundedText,
    isValidSponsorEmail,
    adminReviewNoteMaxLength: ADMIN_REVIEW_NOTE_MAX_LENGTH,
    sponsorMessageMaxLength: SPONSOR_MESSAGE_MAX_LENGTH,
    amountToCents,
    sponsorshipRefundConfirmationText,
    writeSponsorshipRefundIneligible,
    createDevelopmentRefundResult,
    getSponsorshipRefundTarget,
    beginSponsorshipRefundOperation,
    settleSponsorshipRefundOperation,
    failSponsorshipRefundOperation,
    updateContributionStatusByPaymentIntent,
    createSponsorshipCreditNoteForRefund,
    getAdminSponsorshipCreditNoteById,
    queueSponsorshipCreditNoteEmail,
    queueSponsorshipRefundEmail,
    insertAdminAuditLog,
    getAdminSponsorshipById,
    reportFailure
  } = dependencies;
  const { routeMatches } = createRouteMatcher(dependencies.publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/refund',
        '/api/admin/sponsorships/refund'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!stripe && isProduction) {
        writeJson(request, response, 503, {
          error: 'Stripe is not configured.'
        });
        return true;
      }

      let parsed: Partial<AdminSponsorshipRefundRequest>;
      try {
        const body = await readBody(request);
        const candidate = JSON.parse(body) as unknown;
        if (!candidate || typeof candidate !== 'object') {
          throw new Error('Invalid sponsorship refund request body.');
        }
        parsed = candidate as Partial<AdminSponsorshipRefundRequest>;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship refund request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.contributionId)) {
        writeJson(request, response, 400, {
          error: 'Invalid contribution id.'
        });
        return true;
      }

      if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
        writeJson(request, response, 400, {
          error: 'Sponsorship version is required.'
        });
        return true;
      }

      if (
        typeof parsed.confirmationText !== 'string' ||
        parsed.confirmationText.trim().length === 0
      ) {
        writeJson(request, response, 400, {
          error: 'Confirmation text is required.'
        });
        return true;
      }

      const notifySponsor = parsed.notifySponsor === true;
      const notificationEmail =
        typeof parsed.notificationEmail === 'string'
          ? parsed.notificationEmail.trim()
          : '';
      const sponsorMessage =
        typeof parsed.sponsorMessage === 'string'
          ? parsed.sponsorMessage.trim()
          : '';
      const refundNote =
        typeof parsed.refundNote === 'string' ? parsed.refundNote.trim() : '';
      const refundReason =
        parsed.refundReason === undefined
          ? 'requested_by_customer'
          : parsed.refundReason;

      if (!isAllowedSponsorshipStripeRefundReason(refundReason)) {
        writeJson(request, response, 400, {
          error: 'Invalid Stripe refund reason.'
        });
        return true;
      }

      if (
        parsed.amount !== undefined &&
        (typeof parsed.amount !== 'number' || !Number.isFinite(parsed.amount))
      ) {
        writeJson(request, response, 400, {
          error: 'Refund amount must be a number.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.refundNote,
          ADMIN_REVIEW_NOTE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Refund note is too long.'
        });
        return true;
      }

      if (
        !isValidOptionalBoundedText(
          parsed.sponsorMessage,
          SPONSOR_MESSAGE_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Sponsor notification message is too long.'
        });
        return true;
      }

      if (notifySponsor && !isValidSponsorEmail(notificationEmail)) {
        writeJson(request, response, 400, {
          error: 'A valid sponsor notification email is required.'
        });
        return true;
      }

      if (notifySponsor && !sponsorMessage) {
        writeJson(request, response, 400, {
          error: 'A sponsor-facing refund message is required.'
        });
        return true;
      }

      let refundOperationId: string | null = null;
      let stripeRefundCreated = false;
      const refundWorkflowNote = refundNote || null;

      try {
        const target = await getSponsorshipRefundTarget(parsed.contributionId);
        if (!target) {
          writeJson(request, response, 404, {
            error: 'Sponsorship contribution was not found.'
          });
          return true;
        }

        if (target.version !== parsed.expectedVersion) {
          writeJson(request, response, 409, {
            code: 'SPONSORSHIP_CONCURRENT_UPDATE',
            message:
              'Cette commandite a ete modifiee par un autre administrateur.',
            currentVersion: target.version
          });
          return true;
        }

        if (target.paymentStatus !== 'paid') {
          writeSponsorshipRefundIneligible(
            request,
            response,
            target.paymentStatus
          );
          return true;
        }

        if (
          target.refundWorkflowStatus === 'processing' ||
          (target.refundWorkflowStatus === 'completed' && !target.refundId)
        ) {
          writeJson(request, response, 409, {
            code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
            message:
              target.refundWorkflowStatus === 'completed'
                ? 'Cette commandite a deja un remboursement manuel marque comme complete.'
                : 'Un remboursement est deja en cours pour cette commandite.',
            paymentStatus: target.paymentStatus,
            refundWorkflowStatus: target.refundWorkflowStatus
          });
          return true;
        }

        const requestedRefundAmountCents =
          parsed.amount === undefined
            ? target.amountCents
            : amountToCents(parsed.amount);
        const isFullRefund = requestedRefundAmountCents === target.amountCents;
        const hasValidCentPrecision =
          parsed.amount === undefined ||
          Math.abs(parsed.amount * 100 - requestedRefundAmountCents) < 0.000001;

        if (
          requestedRefundAmountCents <= 0 ||
          requestedRefundAmountCents > target.amountCents ||
          !hasValidCentPrecision
        ) {
          writeJson(request, response, 400, {
            error: `Refund amount must be between 0.01 and ${target.amount.toFixed(
              2
            )} ${target.currency}.`
          });
          return true;
        }

        if (!target.stripePaymentIntentId) {
          writeJson(request, response, 409, {
            code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
            message:
              'Aucun Payment Intent Stripe n est lie a cette commandite.',
            paymentStatus: target.paymentStatus
          });
          return true;
        }

        const expectedConfirmation = sponsorshipRefundConfirmationText(target);
        if (parsed.confirmationText?.trim() !== expectedConfirmation) {
          writeJson(request, response, 400, {
            error: `Confirmation text must match ${expectedConfirmation}.`
          });
          return true;
        }

        refundOperationId = await beginSponsorshipRefundOperation({
          contributionId: target.id,
          expectedVersion: parsed.expectedVersion,
          paymentIntentId: target.stripePaymentIntentId,
          amountMinor: requestedRefundAmountCents,
          currency: target.currency,
          reason: refundReason,
          note: refundWorkflowNote,
          actor: getAdminAuditActor(request)
        });

        const refund = stripe
          ? await stripe.refunds.create(
              {
                amount: requestedRefundAmountCents,
                payment_intent: target.stripePaymentIntentId,
                reason: refundReason,
                metadata: {
                  contributionId: target.id,
                  refundType: isFullRefund ? 'full' : 'partial',
                  refundAmountCents: String(requestedRefundAmountCents),
                  refundReason,
                  publicReference: target.publicReference ?? '',
                  source: 'openg7_admin_sponsorship_refund',
                  openg7RefundOperationId: refundOperationId
                }
              },
              {
                idempotencyKey: `sponsorship-refund:${refundOperationId}`
              }
            )
          : createDevelopmentRefundResult({
              amountCents: requestedRefundAmountCents,
              currency: target.currency,
              paymentIntentId: target.stripePaymentIntentId
            });
        stripeRefundCreated = true;
        await settleSponsorshipRefundOperation(refund, refundOperationId);
        const refundWorkflowStatus =
          refund.status === 'succeeded'
            ? 'completed'
            : refund.status === 'failed' || refund.status === 'canceled'
              ? 'failed'
              : 'processing';
        const refundAttemptAccepted = refundWorkflowStatus !== 'failed';
        const refundCompleted = refundWorkflowStatus === 'completed';
        const paymentStatusUpdated = refundCompleted
          ? isFullRefund
            ? await updateContributionStatusByPaymentIntent({
                stripePaymentIntentId: target.stripePaymentIntentId,
                status: 'refunded'
              })
            : false
          : false;
        const refundAmount = Number((refund.amount / 100).toFixed(2));
        const refundCurrency = refund.currency.toUpperCase();
        let creditNote: Awaited<
          ReturnType<typeof createSponsorshipCreditNoteForRefund>
        > = null;
        let adminCreditNote: Awaited<
          ReturnType<typeof getAdminSponsorshipCreditNoteById>
        > = null;
        let creditNoteError: string | null = null;

        if (refundAttemptAccepted) {
          try {
            creditNote = await createSponsorshipCreditNoteForRefund({
              contributionId: target.id,
              stripeRefundId: refund.id,
              refundAmountCents: refund.amount
            });
            adminCreditNote = creditNote
              ? await getAdminSponsorshipCreditNoteById(creditNote.id)
              : null;
          } catch (error) {
            creditNoteError =
              error instanceof Error
                ? error.message
                : 'Credit note could not be created.';
            reportFailure('Failed to create sponsorship credit note.', error);
          }
        }

        const notificationResult =
          refundAttemptAccepted && notifySponsor
            ? creditNote
              ? await queueSponsorshipCreditNoteEmail({
                  to: notificationEmail,
                  creditNote,
                  sponsorMessage,
                  idempotencyKey: `sponsorship-credit-note:${creditNote.id}:${refund.id}`
                })
              : await queueSponsorshipRefundEmail({
                  to: notificationEmail,
                  contributionId: target.id,
                  publicReference: target.publicReference,
                  sponsorName: target.sponsorName,
                  amount: refundAmount,
                  currency: refundCurrency,
                  refundId: refund.id,
                  refundStatus: refund.status,
                  sponsorMessage,
                  refundNote: refundNote || undefined,
                  idempotencyKey: `sponsorship-refund-email:${target.id}:${refund.id}`
                })
            : null;

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: isFullRefund
            ? 'sponsorship_refund.stripe_full'
            : 'sponsorship_refund.stripe_partial',
          entityType: 'sponsorship',
          entityId: target.id,
          summary: `Stripe ${isFullRefund ? 'full' : 'partial'} refund ${
            refund.id
          } created for ${target.sponsorName}.`,
          metadata: {
            amount: refund.amount,
            currency: refund.currency,
            requestedAmount: requestedRefundAmountCents,
            fullRefund: isFullRefund,
            paymentIntentId: target.stripePaymentIntentId,
            publicReference: target.publicReference,
            refundId: refund.id,
            refundReason,
            refundNote: refundNote || null,
            refundStatus: refund.status,
            refundWorkflowStatus,
            paymentStatusUpdated,
            creditNoteId: creditNote?.id ?? null,
            creditNoteNumber: creditNote?.creditNoteNumber ?? null,
            creditNoteError,
            notifySponsor,
            notificationEmail: notifySponsor ? notificationEmail : null,
            notificationMessageId: notificationResult?.messageId ?? null,
            notificationSent: notificationResult?.sent ?? false,
            notificationError: notificationResult?.error ?? null
          }
        });

        const result: AdminSponsorshipRefundResult = {
          refunded: refundCompleted,
          refundId: refund.id,
          refundStatus: refund.status,
          refundWorkflowStatus,
          refundReason,
          fullRefund: isFullRefund,
          amount: refundAmount,
          currency: refundCurrency,
          contributionId: target.id,
          paymentStatusUpdated,
          sponsorship: await getAdminSponsorshipById(target.id),
          creditNote: adminCreditNote,
          ...(notificationResult
            ? {
                notification: {
                  queued: notificationResult.queued,
                  attempted: notificationResult.attempted,
                  sent: notificationResult.sent,
                  messageId: notificationResult.messageId,
                  error: notificationResult.error
                }
              }
            : {})
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        const errorMessage =
          error instanceof Error && error.message
            ? error.message
            : 'Sponsorship refund could not be created.';
        if (error instanceof SponsorshipRefundOperationError) {
          writeJson(request, response, 409, {
            code: error.code,
            error: 'Refund claim refused; refresh the sponsorship.'
          });
          return true;
        }
        const definitive =
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.statusCode === 400 &&
          error.code !== 'idempotency_key_in_use';
        if (refundOperationId && !stripeRefundCreated) {
          try {
            await failSponsorshipRefundOperation(refundOperationId, definitive);
          } catch {
            reportFailure(
              'Failed to record Stripe refund outcome; operation remains blocked.'
            );
          }
        }
        const uncertain =
          refundOperationId && !stripeRefundCreated && !definitive;
        reportFailure('Sponsorship refund interrupted.', {
          operationId: refundOperationId,
          uncertain: Boolean(uncertain)
        });
        writeJson(request, response, 502, {
          ...(uncertain ? { code: 'SPONSORSHIP_REFUND_UNCERTAIN' } : {}),
          error: uncertain
            ? 'Resultat Stripe incertain. Ne relancez pas le remboursement; verifiez son etat avec Stripe.'
            : errorMessage
        });
      }
      return true;
    }
    return false;
  };
};
