import type { PoolClient } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { escapeHtml } from '../services/email/email-rendering.js';
import { enqueueEmailMessage } from '../services/email/email-queue.service.js';

export interface SponsorshipObligationNotificationInput {
  readonly event: 'terms_changed' | 'date_approved' | 'fulfilled';
  /** The exact administrative request, approval revision or immutable evidence ID. */
  readonly eventId: string;
  readonly obligationId: string;
  readonly obligationVersion: number;
  readonly scheduledAt?: string;
}
interface NotificationRow {
  readonly contributionId: string;
  readonly email: string | null;
  readonly locale: string | null;
  readonly channel: string;
  readonly target: string;
  readonly version: number;
  readonly evidenceId: string | null;
  readonly deliveredAt: Date | null;
  readonly externalPostUrl: string | null;
}

/** Caller owns the exact event transaction; the queue worker alone may contact SMTP after commit. */
export const enqueueSponsorshipObligationNotification = async (
  db: Pick<PoolClient, 'query'>,
  input: SponsorshipObligationNotificationInput
): Promise<string | null> => {
  if (
    !isValidUuid(input.obligationId) ||
    !Number.isSafeInteger(input.obligationVersion) ||
    input.obligationVersion < 1 ||
    !['terms_changed', 'date_approved', 'fulfilled'].includes(input.event) ||
    typeof input.eventId !== 'string' ||
    !/^[A-Za-z0-9:_-]{1,160}$/.test(input.eventId)
  )
    throw new Error('SPONSORSHIP_NOTIFICATION_INVALID');
  if (
    input.event === 'date_approved' &&
    (!input.scheduledAt || !Number.isFinite(Date.parse(input.scheduledAt)))
  )
    throw new Error('SPONSORSHIP_NOTIFICATION_INVALID');
  const eventId = input.eventId.toLowerCase();
  const result = await db.query<NotificationRow>(
    `SELECT ob.contribution_id AS "contributionId",c.email_private AS email,
    COALESCE(s.metadata->>'charterLocale',s.metadata->>'sponsorshipLocale') AS locale,ob.channel,ob.target,ob.version,
    e.id AS "evidenceId",e.delivered_at AS "deliveredAt",e.external_post_url AS "externalPostUrl"
    FROM sponsorship_obligations ob JOIN fund_contributions c ON c.id=ob.contribution_id
    LEFT JOIN stripe_checkout_sessions s ON s.stripe_session_id=c.stripe_session_id
    LEFT JOIN sponsorship_fulfilment_evidence e ON e.id=ob.fulfilment_evidence_id AND e.obligation_id=ob.id
    WHERE ob.id=$1::uuid AND c.status IN ('paid','refunded','disputed') AND ob.version=$2 AND (
      ($3='fulfilled' AND ob.state='fulfilled' AND e.id::text=$4) OR
      ($3='terms_changed' AND EXISTS(SELECT 1 FROM sponsorship_commitment_changes change WHERE change.request_id::text=$4
        AND change.obligation_id=ob.id AND change.resulting_value->>'version'=ob.version::text)) OR
      ($3='date_approved' AND ob.state='pending' AND EXISTS(SELECT 1 FROM publication_deliveries delivery
        WHERE delivery.id::text || ':' || delivery.version::text=$4 AND delivery.status='approved' AND delivery.mode='live' AND delivery.approved_at IS NOT NULL
          AND EXISTS(SELECT 1 FROM sponsorship_obligation_reservations reservation WHERE reservation.obligation_id=ob.id
            AND reservation.delivery_id=delivery.id AND reservation.obligation_version=ob.version AND reservation.released_at IS NULL)
          AND delivery.scheduled_at=$5::timestamptz AND EXISTS(SELECT 1 FROM jsonb_array_elements(delivery.obligation_snapshot) captured
            WHERE captured->>'id'=ob.id::text AND captured->>'version'=ob.version::text))))`,
    [
      input.obligationId,
      input.obligationVersion,
      input.event,
      eventId,
      input.event === 'date_approved' ? input.scheduledAt : null
    ]
  );
  const row = result.rows[0];
  if (!row?.email) return null;
  if (input.event === 'fulfilled' && row.evidenceId !== eventId)
    throw new Error('SPONSORSHIP_NOTIFICATION_EVIDENCE_MISMATCH');
  const english = row.locale === 'en';
  const locale = english ? 'en' : 'fr-CA';
  const channel =
    row.channel === 'website'
      ? english
        ? 'website'
        : 'site Web'
      : row.channel === 'linkedin'
        ? 'LinkedIn'
        : 'Facebook';
  const destination = `${row.target === 'openg7' ? 'OpenG7' : 'OpenG20'} / ${channel}`;
  const opening =
    input.event === 'terms_changed'
      ? english
        ? 'Your recorded sponsorship terms have been updated.'
        : 'Les engagements enregistrés de votre commandite ont été ajustés.'
      : input.event === 'date_approved'
        ? english
          ? 'A publication date has been authorized. This is a schedule, not confirmation of delivery.'
          : 'Une date de publication a été autorisée. Cet horaire ne confirme pas une diffusion.'
        : english
          ? 'A recorded sponsorship obligation has been fulfilled with qualified evidence.'
          : 'Une obligation enregistrée de votre commandite a été réalisée avec une preuve qualifiée.';
  const text = [
    opening,
    destination,
    input.event === 'date_approved'
      ? input.scheduledAt!
      : input.event === 'fulfilled'
        ? (row.deliveredAt?.toISOString() ?? '')
        : '',
    input.event === 'fulfilled' ? (row.externalPostUrl ?? '') : '',
    english
      ? 'See your private sponsorship follow-up for the current status. Financial and moderation decisions remain separate.'
      : 'Consultez votre suivi privé de commandite pour l’état actuel. Les décisions financières et de modération restent distinctes.'
  ]
    .filter(Boolean)
    .join('\n\n');
  const queued = await enqueueEmailMessage(db as PoolClient, {
    templateKey: 'sponsorship_obligation',
    to: row.email,
    subject: english
      ? 'OpenG7 sponsorship update'
      : 'Mise à jour de votre commandite OpenG7',
    text,
    html: `<p>${escapeHtml(text).replaceAll('\n\n', '</p><p>')}</p>`,
    metadata: {
      contributionId: row.contributionId,
      event: input.event,
      eventId,
      obligationId: input.obligationId,
      obligationVersion: input.obligationVersion,
      locale
    },
    idempotencyKey: `sponsorship-obligation:${input.event}:${eventId}:${input.obligationId.toLowerCase()}:${input.obligationVersion}`
  });
  if (!queued.messageId || queued.error)
    throw new Error('SPONSORSHIP_NOTIFICATION_UNAVAILABLE');
  return queued.messageId;
};
