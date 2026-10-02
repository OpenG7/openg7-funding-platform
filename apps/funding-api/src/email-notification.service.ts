import type { Pool, PoolClient } from 'pg';
import type {
  AdminEmailTestResult,
  AdminSponsorshipAccessResult
} from '@openg7/funding-core';

import {
  loadTransactionalEmailConfig,
  sendTransactionalEmail,
  renderContributionReferenceRecoveryEmail,
  renderPublicationBatchFullNotification,
  renderSponsorshipReviewReminderNotification,
  renderEmailConfigurationTest,
  renderAdminContributionReceivedEmail,
  renderSponsorshipFollowupEmail,
  renderSponsorshipConfirmationEmail,
  renderSponsorshipRejectionEmail,
  renderSponsorshipRefundEmail,
  renderSponsorshipAccessEmail,
  renderSponsorshipInformationRequestEmail,
  renderSponsorshipInvoiceEmail,
  renderSponsorshipCreditNoteEmail,
  TransactionalEmailError,
  type EmailDeliveryMode,
  type EmailServiceDependencies,
  type SponsorshipFollowupEmailInput,
  type ContributionReferenceRecoveryEmailInput,
  type SponsorshipConfirmationEmailInput,
  type SponsorshipInvoiceEmailInput,
  type SponsorshipCreditNoteEmailInput,
  type SponsorshipRejectionEmailInput,
  type SponsorshipRefundEmailInput,
  type PublicationBatchFullEmailInput,
  type SponsorshipReviewReminderEmailInput,
  type RenderedEmail,
  type SponsorshipAccessEmailInput,
  type AdminContributionReceivedEmailInput,
  type SponsorshipInformationRequestEmailInput
} from './services/email/index.js';
import {
  claimAdminEmailQueueRetry,
  claimQueuedEmailMessages,
  findEmailConfigurationTestBinding,
  findEmailConfigurationTestMessage,
  insertEmailQueueMessage,
  markEmailFailed,
  markEmailSent,
  recordEmailConfigurationTestQueuedAudit,
  type ClaimedEmailMessage,
  type EmailQueueInsertResult
} from './email-queue.repository.js';

export {
  getAdminEmailQueueMessageById,
  getEmailQueueStatus,
  listAdminEmailQueue
} from './email-queue.repository.js';
export type { EmailQueueStatus } from './email-queue.repository.js';
export type { SponsorshipReviewReminderEmailItem } from './services/email/index.js';

/** Project an existing queued message without retrying or creating another one. */
export const projectExistingSponsorshipEmailStatus = (
  status: string
): Exclude<AdminSponsorshipAccessResult['status'], 'queued'> =>
  status === 'sent'
    ? 'already_sent'
    : status === 'failed'
      ? 'delivery_failed'
      : 'already_queued';

interface EmailSendResult {
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly error: string | null;
  readonly deliveryMode?: EmailDeliveryMode;
}

interface EmailQueueResult extends EmailSendResult {
  readonly queued: boolean;
  readonly duplicate: boolean;
  readonly messageId: string | null;
}

interface QueueEmailInput extends RenderedEmail {
  readonly to: string;
  readonly idempotencyKey?: string;
  readonly maxAttempts?: number;
}

interface EmailQueueProcessOptions {
  readonly limit?: number;
  readonly messageIds?: readonly string[];
  readonly emailDependencies?: EmailServiceDependencies;
}

export interface EmailQueueProcessResult {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
  readonly messageIds: readonly string[];
  readonly sentMessageIds: readonly string[];
  readonly failedMessageIds: readonly string[];
}

const defaultMaxAttempts = 5;

const snapshotEmailDependencies = (
  dependencies: EmailServiceDependencies = {}
): EmailServiceDependencies & { readonly env: NodeJS.ProcessEnv } => ({
  ...dependencies,
  env: { ...(dependencies.env ?? process.env) }
});

const sendEmailPayload = async (
  input: {
    readonly to: string;
    readonly replyTo: string | null;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
  },
  dependencies: EmailServiceDependencies = {}
): Promise<EmailSendResult> => {
  try {
    const result = await sendTransactionalEmail(
      {
        to: input.to,
        replyTo: input.replyTo ?? undefined,
        subject: input.subject,
        text: input.text,
        html: input.html
      },
      dependencies
    );

    if (result.deliveryMode === 'disabled') {
      return {
        attempted: false,
        sent: false,
        deliveryMode: result.deliveryMode,
        error: 'EMAIL_DISABLED'
      };
    }

    if (result.accepted.length === 0 && result.rejected.length > 0) {
      return {
        attempted: true,
        sent: false,
        deliveryMode: result.deliveryMode,
        error: 'EMAIL_RECIPIENT_REJECTED'
      };
    }

    return {
      attempted: true,
      sent: result.rejected.length === 0,
      deliveryMode: result.deliveryMode,
      error: null
    };
  } catch (error) {
    const emailError =
      error instanceof TransactionalEmailError
        ? error
        : new TransactionalEmailError(
            'EMAIL_SEND_ERROR',
            'Transactional email request failed.',
            { cause: error }
          );

    return {
      attempted: true,
      sent: false,
      error: emailError.code
    };
  }
};

const enqueueEmailMessage = async (
  pool: Pool | PoolClient | null,
  input: QueueEmailInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<EmailQueueInsertResult> => {
  const emailConfig = loadTransactionalEmailConfig(env);
  return insertEmailQueueMessage(pool, {
    ...input,
    fromEmail: emailConfig.from.formatted,
    replyToEmail: emailConfig.replyTo.address,
    maxAttempts: input.maxAttempts ?? defaultMaxAttempts
  });
};

const nextRetryDate = (attempts: number, maxAttempts: number): Date | null => {
  if (attempts >= maxAttempts) {
    return null;
  }

  const delayMs = Math.min(
    60 * 60 * 1000,
    2 ** Math.max(0, attempts - 1) * 60 * 1000
  );
  return new Date(Date.now() + delayMs);
};

export const processQueuedEmailMessages = async (
  pool: Pool | null,
  options: EmailQueueProcessOptions = {}
): Promise<EmailQueueProcessResult> => {
  if (!pool) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      messageIds: [],
      sentMessageIds: [],
      failedMessageIds: []
    };
  }

  const dependencies = snapshotEmailDependencies(options.emailDependencies);
  const rows = await claimQueuedEmailMessages(pool, {
    limit: options.limit ?? 10,
    messageIds: options.messageIds
  });
  return deliverClaimedEmailMessages(pool, rows, dependencies);
};

const deliverClaimedEmailMessages = async (
  pool: Pool,
  rows: readonly ClaimedEmailMessage[],
  dependencies: EmailServiceDependencies = {}
): Promise<EmailQueueProcessResult> => {
  const sentMessageIds: string[] = [];
  const failedMessageIds: string[] = [];

  for (const row of rows) {
    const result = await sendEmailPayload(
      {
        to: row.to,
        replyTo: null,
        subject: row.subject,
        text: row.text,
        html: row.html
      },
      dependencies
    );

    if (result.sent) {
      await markEmailSent(pool, row.id);
      sentMessageIds.push(row.id);
    } else {
      await markEmailFailed(
        pool,
        row.id,
        nextRetryDate(row.attempts, row.maxAttempts),
        result.error
      );
      failedMessageIds.push(row.id);
    }
  }

  return {
    attempted: rows.length,
    sent: sentMessageIds.length,
    failed: failedMessageIds.length,
    messageIds: rows.map((row) => row.id),
    sentMessageIds,
    failedMessageIds
  };
};

export const retryAdminEmailQueueMessage = async (
  pool: Pool | null,
  messageId: string
): Promise<EmailQueueProcessResult> => {
  if (!pool) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      messageIds: [],
      sentMessageIds: [],
      failedMessageIds: []
    };
  }

  const rows = await claimAdminEmailQueueRetry(pool, messageId);
  return deliverClaimedEmailMessages(pool, rows);
};

const queueAndProcessEmail = async (
  pool: Pool | null,
  input: QueueEmailInput,
  deferDelivery = false,
  emailDependencies: EmailServiceDependencies = {}
): Promise<EmailQueueResult> => {
  const dependencies = snapshotEmailDependencies(emailDependencies);
  const deliveryMode: EmailDeliveryMode = loadTransactionalEmailConfig(
    dependencies.env
  ).enabled
    ? 'smtp'
    : 'disabled';
  const queued = await enqueueEmailMessage(pool, input, dependencies.env);
  if (!queued.messageId || queued.error) {
    return {
      queued: queued.queued,
      duplicate: queued.duplicate,
      messageId: queued.messageId,
      attempted: false,
      sent: false,
      error: queued.error,
      deliveryMode
    };
  }

  if (queued.status === 'sent') {
    return {
      queued: false,
      duplicate: queued.duplicate,
      messageId: queued.messageId,
      attempted: false,
      sent: true,
      error: null,
      deliveryMode
    };
  }

  if (deferDelivery) {
    return {
      queued: queued.queued,
      duplicate: queued.duplicate,
      messageId: queued.messageId,
      attempted: false,
      sent: false,
      error: null,
      deliveryMode
    };
  }

  const processed = await processQueuedEmailMessages(pool, {
    limit: 1,
    messageIds: [queued.messageId],
    emailDependencies: dependencies
  });
  const sent = processed.sentMessageIds.includes(queued.messageId);

  return {
    queued: true,
    duplicate: queued.duplicate,
    messageId: queued.messageId,
    attempted: processed.messageIds.includes(queued.messageId),
    sent,
    deliveryMode,
    error:
      !sent && processed.failedMessageIds.includes(queued.messageId)
        ? 'Email delivery failed and will be retried.'
        : null
  };
};

export const sendSponsorshipFollowupEmail = async (
  input: SponsorshipFollowupEmailInput
): Promise<EmailSendResult> => {
  const rendered = renderSponsorshipFollowupEmail(input);
  return sendEmailPayload({
    to: input.to,
    replyTo: null,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html
  });
};

export const queueSponsorshipFollowupEmail = async (
  pool: Pool | null,
  input: SponsorshipFollowupEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipFollowupEmail(input);
  return queueAndProcessEmail(
    pool,
    {
      ...rendered,
      to: input.to,
      idempotencyKey: input.idempotencyKey
    },
    input.deferDelivery
  );
};

/** Queue inside the caller's transaction; delivery happens after commit. */
export const enqueueSponsorshipAccessEmail = async (
  client: PoolClient,
  input: SponsorshipAccessEmailInput
): Promise<string> => {
  const result = await enqueueEmailMessage(client, {
    ...renderSponsorshipAccessEmail(input),
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
  if (!result.messageId || result.error)
    throw new Error('Access email could not be queued.');
  return result.messageId;
};

export const queueContributionReferenceRecoveryEmail = async (
  pool: Pool | null,
  input: ContributionReferenceRecoveryEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderContributionReferenceRecoveryEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipConfirmationEmail = async (
  pool: Pool | null,
  input: SponsorshipConfirmationEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipConfirmationEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipRejectionEmail = async (
  pool: Pool | null,
  input: SponsorshipRejectionEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipRejectionEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipRefundEmail = async (
  pool: Pool | null,
  input: SponsorshipRefundEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipRefundEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipInvoiceEmail = async (
  pool: Pool | null,
  input: SponsorshipInvoiceEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipInvoiceEmail(input);
  return queueAndProcessEmail(
    pool,
    {
      ...rendered,
      to: input.to,
      idempotencyKey: input.idempotencyKey
    },
    input.deferDelivery
  );
};

/** Persist a document resend inside the audit transaction; the worker sends later. */
export const enqueueSponsorshipDocumentEmail = async (
  client: PoolClient,
  input: (SponsorshipInvoiceEmailInput | SponsorshipCreditNoteEmailInput) & {
    idempotencyKey: string;
  }
): Promise<string> => {
  const rendered =
    'invoice' in input
      ? renderSponsorshipInvoiceEmail(input)
      : renderSponsorshipCreditNoteEmail(input);
  const result = await enqueueEmailMessage(client, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
  if (!result.messageId || result.error)
    throw new Error('Document email could not be queued.');
  return result.messageId;
};

export const queueSponsorshipCreditNoteEmail = async (
  pool: Pool | null,
  input: SponsorshipCreditNoteEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipCreditNoteEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

const queueAdminNotification = async (
  pool: Pool | null,
  render: () => RenderedEmail,
  idempotencyKey: string | undefined,
  emailDependencies: EmailServiceDependencies
): Promise<EmailQueueResult> => {
  const dependencies = snapshotEmailDependencies(emailDependencies);
  const adminNotificationEmail =
    dependencies.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ?? '';
  if (!adminNotificationEmail) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      attempted: false,
      sent: false,
      error: 'Admin notification address is not configured.'
    };
  }

  return queueAndProcessEmail(
    pool,
    { ...render(), to: adminNotificationEmail, idempotencyKey },
    false,
    dependencies
  );
};

/**
 * Notifies the configured admin address when a publication batch reaches
 * capacity, so it gets scheduled or published instead of sitting full and
 * unnoticed. Purely informational: it never schedules or publishes anything
 * itself.
 */
export const queuePublicationBatchFullNotification = async (
  pool: Pool | null,
  input: PublicationBatchFullEmailInput,
  dependencies: EmailServiceDependencies = {}
): Promise<EmailQueueResult> =>
  queueAdminNotification(
    pool,
    () => renderPublicationBatchFullNotification(input),
    input.idempotencyKey,
    dependencies
  );

/**
 * Sends a privacy-preserving daily nudge when paid sponsorships with complete
 * fiches are still awaiting an explicit admin approval/refusal decision.
 */
export const queueSponsorshipReviewReminderNotification = async (
  pool: Pool | null,
  input: SponsorshipReviewReminderEmailInput,
  dependencies: EmailServiceDependencies = {}
): Promise<EmailQueueResult> =>
  queueAdminNotification(
    pool,
    () => renderSponsorshipReviewReminderNotification(input),
    input.idempotencyKey,
    dependencies
  );

export class EmailConfigurationTestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export const isEmailTestRequestId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

export const getEmailConfigurationTest = async (
  pool: Pool,
  requestId: string,
  actor: string
): Promise<AdminEmailTestResult> => {
  const row = await findEmailConfigurationTestMessage(pool, requestId, actor);
  if (!row) throw new EmailConfigurationTestError(404, 'EMAIL_TEST_NOT_FOUND');
  return {
    requestId,
    messageId: row.id,
    status: row.status,
    to: row.to,
    queued: row.status !== 'sent',
    attempted: row.attempts > 0,
    sent: row.status === 'sent',
    error: row.error,
    deliveryMode: loadTransactionalEmailConfig().enabled ? 'smtp' : 'disabled'
  };
};

/** Persist the request and audit atomically; only its first insertion attempts SMTP. */
export const queueEmailConfigurationTest = async (
  pool: Pool,
  input: { to: string; requestId: string; actor: string }
): Promise<AdminEmailTestResult> => {
  const db = await pool.connect();
  let inserted = false;
  let messageId: string | null = null;
  try {
    await db.query('BEGIN');
    const rendered = renderEmailConfigurationTest(input);
    const result = await enqueueEmailMessage(db, {
      ...rendered,
      to: input.to,
      idempotencyKey: 'admin-email-test:' + input.requestId.toLowerCase(),
      metadata: { ...rendered.metadata, actor: input.actor }
    });
    messageId = result.messageId;
    if (!messageId) throw new Error('EMAIL_TEST_UNAVAILABLE');
    const row = await findEmailConfigurationTestBinding(db, messageId);
    if (!row) throw new Error('EMAIL_TEST_UNAVAILABLE');
    if (row.to !== input.to || row.actor !== input.actor)
      throw new EmailConfigurationTestError(409, 'EMAIL_TEST_CONFLICT');
    inserted = !result.duplicate;
    if (inserted)
      await recordEmailConfigurationTestQueuedAudit(db, messageId, input);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  if (inserted)
    await processQueuedEmailMessages(pool, {
      limit: 1,
      messageIds: [messageId!]
    });
  return getEmailConfigurationTest(pool, input.requestId, input.actor);
};

/** Enqueue only; delivery is owned by the existing worker after commit. */
export const queueAdminContributionReceived = async (
  pool: Pool | PoolClient,
  input: AdminContributionReceivedEmailInput
) =>
  enqueueEmailMessage(pool, {
    ...renderAdminContributionReceivedEmail(input),
    to: input.to,
    idempotencyKey: `contribution:${input.activityId}:admin-email`
  });

/** Enqueue only; delivery is owned by the existing worker after commit. */
export const queueSponsorshipInformationRequest = async (
  pool: Pool | PoolClient,
  input: SponsorshipInformationRequestEmailInput
) =>
  enqueueEmailMessage(pool, {
    ...renderSponsorshipInformationRequestEmail(input),
    to: input.recipient,
    idempotencyKey: input.idempotencyKey
  });
