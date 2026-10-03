import type {
  AdminEmailQueueMessageRecord,
  AdminEmailQueueMessageStatus
} from '@openg7/funding-core';

export type EmailQueueLoadState = 'idle' | 'loading' | 'ready' | 'error';
export type EmailQueueRetryState =
  'idle' | 'confirming' | 'sending' | 'sent' | 'error';
export type EmailQueueStatusFilter = 'all' | AdminEmailQueueMessageStatus;

/** Page-owned labels and retry results, projected for the message list. */
export interface EmailQueueMessageView {
  readonly message: AdminEmailQueueMessageRecord;
  readonly updatedAtLabel: string;
  readonly statusLabel: string;
  readonly templateLabel: string;
  readonly nextAttemptAtLabel: string;
  readonly retryState: EmailQueueRetryState;
  readonly retryMessage: string;
}

export function normalizeEmailQueueStatusFilter(
  value: string
): EmailQueueStatusFilter {
  switch (value) {
    case 'queued':
    case 'sending':
    case 'sent':
    case 'failed':
      return value;
    default:
      return 'all';
  }
}

export function filterEmailQueueMessages(
  messages: readonly AdminEmailQueueMessageRecord[],
  status: EmailQueueStatusFilter,
  query: string
): readonly AdminEmailQueueMessageRecord[] {
  const search = query.trim().toLowerCase();

  return messages.filter((message) => {
    if (status !== 'all' && message.status !== status) return false;
    if (!search) return true;

    return [
      message.template_key,
      message.recipient_email,
      message.subject,
      message.status,
      message.last_error
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search);
  });
}
