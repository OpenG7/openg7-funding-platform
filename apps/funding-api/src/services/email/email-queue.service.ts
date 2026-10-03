import type { Pool, PoolClient } from 'pg';

import {
  claimAdminEmailQueueRetry,
  claimQueuedEmailMessages,
  insertEmailQueueMessage,
  markEmailFailed,
  markEmailSent,
  type ClaimedEmailMessage,
  type EmailQueueInsertResult
} from '../../email-queue.repository.js';

import { loadTransactionalEmailConfig } from './email.config.js';
import { sendTransactionalEmail } from './email.service.js';
import {
  TransactionalEmailError,
  type EmailDeliveryMode,
  type EmailServiceDependencies
} from './email.types.js';
import type { RenderedEmail } from './email-notification.types.js';

export interface EmailSendResult {
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly error: string | null;
  readonly deliveryMode?: EmailDeliveryMode;
}

export interface EmailQueueResult extends EmailSendResult {
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

export const snapshotEmailDependencies = (
  dependencies: EmailServiceDependencies = {}
): EmailServiceDependencies & { readonly env: NodeJS.ProcessEnv } => ({
  ...dependencies,
  env: { ...(dependencies.env ?? process.env) }
});

export const sendEmailPayload = async (
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

export const enqueueEmailMessage = async (
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

export const queueAndProcessEmail = async (
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
