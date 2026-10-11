import type { ModerationDecisionRecord } from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { escapeHtml } from '../services/email/email-rendering.js';
import { enqueueEmailMessage } from '../services/email/email-queue.service.js';

/** Only the sponsor-facing explanation crosses the notification boundary. */
export function renderModerationNotification(
  decision: Pick<
    ModerationDecisionRecord,
    'id' | 'policyVersion' | 'level' | 'sponsorExplanation'
  >,
  locale: 'fr-CA' | 'en'
) {
  const english = locale === 'en';
  const subject = english
    ? 'OpenG7 sponsorship review'
    : 'Revue de votre commandite OpenG7';
  const text = [
    english
      ? 'A human reviewer has made a decision about your submitted content.'
      : 'Une personne autorisée a examiné le contenu que vous avez soumis.',
    decision.sponsorExplanation ?? '',
    english
      ? `Policy: ${decision.policyVersion}. Decision: ${decision.level}.`
      : `Politique : ${decision.policyVersion}. Décision : ${decision.level}.`,
    english
      ? 'You may request reconsideration through your private sponsorship follow-up. A request does not restore publication authorization.'
      : 'Vous pouvez demander un réexamen dans votre suivi privé de commandite. Cette demande ne rétablit pas une autorisation de publication.',
    english
      ? 'Any financial consequences are assessed separately. This message does not confirm a refund.'
      : 'Les conséquences financières sont examinées séparément. Ce message ne confirme aucun remboursement.'
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    templateKey: 'moderation_decision' as const,
    subject,
    text,
    html: `<p>${escapeHtml(text).replaceAll('\n\n', '</p><p>').replaceAll('\n', '<br />')}</p>`,
    metadata: {
      decisionId: decision.id,
      policyVersion: decision.policyVersion,
      locale
    }
  };
}

/** Caller owns the decision transaction; the existing email worker sends after commit. */
export async function enqueueModerationNotification(
  db: Pick<PoolClient, 'query'>,
  decision: ModerationDecisionRecord
): Promise<string | null> {
  if (
    !decision.contributionId ||
    decision.state !== 'active' ||
    decision.level === 'N0'
  )
    return null;
  const recipient = (
    await db.query<{ email: string | null; locale: string | null }>(
      `SELECT c.email_private AS email, COALESCE(s.metadata->>'charterLocale',s.metadata->>'sponsorshipLocale') AS locale
     FROM fund_contributions c LEFT JOIN stripe_checkout_sessions s ON s.stripe_session_id=c.stripe_session_id
     WHERE c.id=$1 AND c.status IN ('paid','refunded','disputed')`,
      [decision.contributionId]
    )
  ).rows[0];
  if (!recipient?.email) return null;
  const locale = recipient.locale === 'en' ? 'en' : 'fr-CA';
  const queued = await enqueueEmailMessage(db as PoolClient, {
    ...renderModerationNotification(decision, locale),
    to: recipient.email,
    idempotencyKey: `moderation-decision:${decision.id}:${locale}`
  });
  if (!queued.messageId || queued.error)
    throw new Error('MODERATION_NOTIFICATION_UNAVAILABLE');
  return queued.messageId;
}

/** Receipt confirms private submission, never publication or a financial outcome. */
export async function enqueueModerationFollowupReceipt(
  db: Pick<PoolClient, 'query'>,
  input: {
    contributionId: string;
    eventId: string;
    kind: 'correction' | 'reconsideration';
    locale?: 'fr-CA' | 'en';
  }
): Promise<void> {
  const recipient = (
    await db.query<{ email: string | null }>(
      "SELECT email_private AS email FROM fund_contributions WHERE id=$1 AND status IN ('paid','refunded','disputed')",
      [input.contributionId]
    )
  ).rows[0];
  if (!recipient?.email) return;
  const english = input.locale === 'en';
  const subject = english
    ? 'OpenG7: submission received'
    : 'OpenG7 : demande reçue';
  const text = english
    ? `Your ${input.kind === 'correction' ? 'correction' : 'request for reconsideration'} has been received for human review. Publication authorization remains suspended until an authorized new decision. Financial consequences are assessed separately.`
    : `Votre ${input.kind === 'correction' ? 'correction' : 'demande de réexamen'} a été reçue pour une revue humaine. L’autorisation de publication reste suspendue jusqu’à une nouvelle décision autorisée. Les conséquences financières sont examinées séparément.`;
  const queued = await enqueueEmailMessage(db as PoolClient, {
    templateKey: 'moderation_submission',
    to: recipient.email,
    subject,
    text,
    html: `<p>${escapeHtml(text)}</p>`,
    metadata: {
      contributionId: input.contributionId,
      eventId: input.eventId,
      kind: input.kind
    },
    idempotencyKey: `moderation-${input.kind}:${input.eventId}:receipt`
  });
  if (!queued.messageId || queued.error)
    throw new Error('MODERATION_NOTIFICATION_UNAVAILABLE');
}
