import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminEmailQueueMessageRecord,
  AdminEmailQueueResponse,
  AdminEmailQueueRetryRequest,
  AdminEmailQueueRetryResult,
  AdminEmailTestRequest,
  AdminEmailTestResult
} from '@openg7/funding-core';

import type { AdminAuditLogInput } from './fund-admin.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;
type AdminAuthorizationCheck = (
  request: ApiRequest,
  response: ApiResponse
) => boolean;

/** Domain-specific ports: transport owns no database, SMTP or session lifecycle. */
export interface AdminEmailHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly databaseAvailable: () => boolean;
  readonly ensureAdminAuthorization: AdminAuthorizationCheck;
  readonly ensureAdminAccess: AdminAuthorizationCheck;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly getTransactionalEmailConfigStatus: () => {
    readonly configured: boolean;
  };
  readonly adminNotificationRecipient: () => string;
  readonly isValidSponsorEmail: (value: unknown) => value is string;
  readonly isEmailTestRequestId: (value: unknown) => value is string;
  readonly isValidUuid: (value: unknown) => value is string;
  readonly EmailConfigurationTestError: new (
    status: number,
    code: string
  ) => Error & {
    readonly status: number;
    readonly code: string;
  };
  readonly getEmailConfigurationTest: (
    requestId: string,
    actor: string
  ) => Promise<AdminEmailTestResult>;
  readonly queueEmailConfigurationTest: (input: {
    readonly to: string;
    readonly requestId: string;
    readonly actor: string;
  }) => Promise<AdminEmailTestResult>;
  readonly listAdminEmailQueue: (scope: {
    readonly id: string | undefined;
  }) => Promise<AdminEmailQueueResponse>;
  readonly getAdminEmailQueueMessageById: (
    messageId: string
  ) => Promise<AdminEmailQueueMessageRecord | null>;
  readonly retryAdminEmailQueueMessage: (
    messageId: string
  ) => Promise<Omit<AdminEmailQueueRetryResult, 'message'>>;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<unknown>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Return false for routes owned elsewhere; every handled route checks API rights. */
export const createAdminEmailHttpHandler = ({
  publicBaseOrigin,
  databaseAvailable,
  ensureAdminAuthorization,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  getTransactionalEmailConfigStatus,
  adminNotificationRecipient,
  isValidSponsorEmail,
  isEmailTestRequestId,
  isValidUuid,
  EmailConfigurationTestError,
  getEmailConfigurationTest,
  queueEmailConfigurationTest,
  listAdminEmailQueue,
  getAdminEmailQueueMessageById,
  retryAdminEmailQueueMessage,
  insertAdminAuditLog,
  reportFailure
}: AdminEmailHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      (request.method === 'POST' || request.method === 'GET') &&
      routeMatches(request.url, '/admin/email/test', '/api/admin/email/test')
    ) {
      response.setHeader('Cache-Control', 'private, no-store');
      if (!ensureAdminAuthorization(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Email test requires DATABASE_URL and migration 010.'
        });
        return true;
      }

      if (request.method === 'GET') {
        const requestId = new URL(
          request.url ?? '/',
          publicBaseOrigin
        ).searchParams.get('requestId');
        if (!isEmailTestRequestId(requestId)) {
          writeJson(request, response, 400, { code: 'INVALID_EMAIL_TEST' });
          return true;
        }
        try {
          writeJson(
            request,
            response,
            200,
            await getEmailConfigurationTest(
              requestId,
              getAdminAuditActor(request)
            )
          );
        } catch (error) {
          writeJson(
            request,
            response,
            error instanceof EmailConfigurationTestError ? error.status : 503,
            {
              code:
                error instanceof EmailConfigurationTestError
                  ? error.code
                  : 'EMAIL_TEST_UNAVAILABLE'
            }
          );
        }
        return true;
      }

      if (!getTransactionalEmailConfigStatus().configured) {
        writeJson(request, response, 400, {
          code: 'SMTP_NOT_CONFIGURED',
          error: 'SMTP email provider is not configured.'
        });
        return true;
      }

      if (
        request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
        'application/json'
      ) {
        writeJson(request, response, 415, { code: 'INVALID_EMAIL_TEST' });
        return true;
      }
      let parsed: AdminEmailTestRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = JSON.parse(body) as AdminEmailTestRequest;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !isEmailTestRequestId(parsed.requestId) ||
          Object.keys(parsed).some(
            (key) => !['requestId', 'to'].includes(key)
          ) ||
          (parsed.to !== undefined && typeof parsed.to !== 'string')
        )
          throw new Error('INVALID_EMAIL_TEST');
      } catch {
        writeJson(request, response, 400, {
          code: 'INVALID_EMAIL_TEST',
          error: 'Invalid email test request body.'
        });
        return true;
      }

      const recipient =
        typeof parsed.to === 'string' && parsed.to.trim()
          ? parsed.to.trim()
          : adminNotificationRecipient();

      if (!isValidSponsorEmail(recipient)) {
        writeJson(request, response, 400, {
          code: 'INVALID_RECIPIENT',
          error: 'A valid test email is required.'
        });
        return true;
      }

      try {
        const result = await queueEmailConfigurationTest({
          to: recipient,
          requestId: parsed.requestId,
          actor: getAdminAuditActor(request)
        });
        const payload: AdminEmailTestResult = result;
        writeJson(request, response, 200, payload);
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof EmailConfigurationTestError ? error.status : 503,
          {
            code:
              error instanceof EmailConfigurationTestError
                ? error.code
                : 'EMAIL_TEST_UNAVAILABLE'
          }
        );
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(request.url, '/admin/email-queue', '/api/admin/email-queue')
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const result = await listAdminEmailQueue({
          id:
            new URL(request.url ?? '/', publicBaseOrigin).searchParams.get(
              'messageId'
            ) ?? undefined
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin email queue.', error);
        writeJson(request, response, 502, {
          error: 'Admin email queue could not be loaded. Apply migration 010.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/email-queue/retry',
        '/api/admin/email-queue/retry'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Email queue retry requires DATABASE_URL and migration 010.'
        });
        return true;
      }

      let parsed: AdminEmailQueueRetryRequest;
      try {
        const body = await readBody(request, 16 * 1024);
        const raw = JSON.parse(
          body
        ) as Partial<AdminEmailQueueRetryRequest> | null;
        parsed = {
          messageId: typeof raw?.messageId === 'string' ? raw.messageId : ''
        };
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid email queue retry request body.'
        });
        return true;
      }

      if (!isValidUuid(parsed.messageId)) {
        writeJson(request, response, 400, {
          error: 'Email message id is invalid.'
        });
        return true;
      }

      try {
        const existing = await getAdminEmailQueueMessageById(parsed.messageId);
        if (!existing) {
          writeJson(request, response, 404, {
            error: 'Email queue message was not found.'
          });
          return true;
        }

        if (existing.status === 'sent') {
          writeJson(request, response, 409, {
            error: 'Sent email messages cannot be retried.'
          });
          return true;
        }

        const retry = await retryAdminEmailQueueMessage(parsed.messageId);
        const message = await getAdminEmailQueueMessageById(parsed.messageId);
        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'email_queue.retry',
          entityType: 'email_message',
          entityId: parsed.messageId,
          summary: `Email queue message ${parsed.messageId} retried manually.`,
          metadata: {
            templateKey: existing.template_key,
            recipientEmail: existing.recipient_email,
            attempted: retry.attempted,
            sent: retry.sent,
            failed: retry.failed
          }
        });

        const payload: AdminEmailQueueRetryResult = {
          attempted: retry.attempted,
          sent: retry.sent,
          failed: retry.failed,
          messageIds: retry.messageIds,
          sentMessageIds: retry.sentMessageIds,
          failedMessageIds: retry.failedMessageIds,
          message
        };
        writeJson(request, response, 200, payload);
      } catch (error) {
        reportFailure('Failed to retry email queue message.', error);
        writeJson(request, response, 502, {
          error: 'Email queue message could not be retried.'
        });
      }
      return true;
    }

    return false;
  };
};
