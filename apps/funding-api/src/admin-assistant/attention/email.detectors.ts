import type { AdminAttentionItem } from '@openg7/funding-core';

import type { AttentionDataset } from './contracts.js';
import { ADMIN_URLS } from './shared.js';

const categorizeEmailError = (raw: string | null): string => {
  const text = (raw ?? '').toLowerCase();
  if (!text) {
    return 'inconnue';
  }
  if (
    text.includes('auth') ||
    text.includes('535') ||
    text.includes('credential') ||
    text.includes('password')
  ) {
    return 'authentification';
  }
  if (
    text.includes('550') ||
    text.includes('reject') ||
    text.includes('recipient') ||
    text.includes('mailbox') ||
    text.includes('no such user')
  ) {
    return 'destinataire_rejeté';
  }
  if (
    text.includes('timeout') ||
    text.includes('etimedout') ||
    text.includes('econn') ||
    text.includes('network')
  ) {
    return 'connexion';
  }
  return 'autre';
};

const recipientDomain = (email: string): string | null => {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : null;
};

/** Only safe locators and error categories leave the transactional email queue. */
export const detectFailedEmailItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.emailMessages
    .filter((message) => message.status === 'failed')
    .map((message) => {
      const exhausted = message.attempts >= message.max_attempts;
      return {
        id: `email_delivery_failed:${message.id}`,
        type: 'email_delivery_failed',
        severity: exhausted ? 'urgent' : 'today',
        title: `Courriel transactionnel en échec (${message.template_key})`,
        explanation:
          `L'envoi du courriel « ${message.template_key} » a échoué ` +
          `(${message.attempts}/${message.max_attempts} tentatives, ` +
          `cause : ${categorizeEmailError(message.last_error)})` +
          `${exhausted ? '. Les tentatives automatiques sont épuisées.' : '.'}`,
        emailQueueId: message.id,
        detectedAt: dataset.now.toISOString(),
        adminUrl: ADMIN_URLS.emailQueue,
        facts: {
          templateKey: message.template_key,
          recipientDomain: recipientDomain(message.recipient_email),
          attempts: message.attempts,
          maxAttempts: message.max_attempts,
          attemptsExhausted: exhausted,
          errorCategory: categorizeEmailError(message.last_error)
        },
        suggestedActions: [
          {
            actionType: 'retry_email',
            label: 'Revoir la file de courriels',
            executionMode: 'navigate'
          }
        ]
      } satisfies AdminAttentionItem;
    });
