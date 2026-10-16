import type {
  AdminAttentionItem,
  PublicationReliabilityIncident
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { reliabilityFactsSql } from '../publication-automation/reliability-facts.js';
import {
  reliabilityIncidentLinksSql,
  reliabilityIncidentJsonSql
} from '../publication-automation/reliability-incidents.js';
import { sponsorshipAdminUrl } from '../sponsorship-admin-presentation.js';

/** Reuse the global detector without its UI correlation/page limits. No retry is authorized. */
export const buildReliabilityFollowupItems = (
  incidents: readonly PublicationReliabilityIncident[],
  now: Date
): AdminAttentionItem[] =>
  incidents.map((incident) => ({
    id: `publication_reliability_incident:${incident.code}:${incident.subjectId}${incident.sponsorshipId ? `:${incident.sponsorshipId}` : ''}`,
    type: 'publication_reliability_incident',
    severity: [
      'ACCOUNT_RESULT_UNCERTAIN',
      'FULFILMENT_EVIDENCE_MISMATCH',
      'SPONSORSHIP_DEADLINE_EXCEEDED'
    ].includes(incident.code)
      ? 'urgent'
      : 'today',
    title: 'publication_reliability_incident',
    explanation: incident.code,
    detectedAt: now.toISOString(),
    ...(incident.sponsorshipId
      ? {
          sponsorshipId: incident.sponsorshipId,
          contributionId: incident.sponsorshipId
        }
      : {}),
    ...(incident.deliveryId ? { publicationId: incident.deliveryId } : {}),
    adminUrl: incident.sponsorshipId
      ? sponsorshipAdminUrl(incident.sponsorshipId, 'publication')
      : incident.deliveryId
        ? `/admin/fundraiser/publications/automation?deliveryId=${encodeURIComponent(incident.deliveryId)}`
        : `/admin/fundraiser/publications${incident.batchId ? `?batchId=${encodeURIComponent(incident.batchId)}` : incident.slotId ? `?slotId=${encodeURIComponent(incident.slotId)}` : '/automation'}`,
    facts: {
      reason: incident.code,
      subjectType: incident.subjectType,
      subjectId: incident.subjectId
    },
    suggestedActions: [
      {
        actionType: 'open',
        label: 'Examiner les faits',
        executionMode: 'navigate'
      }
    ]
  }));

export const loadReliabilityFollowupItems = async (
  pool: Pick<Pool, 'query'>,
  now: Date,
  contributionId?: string
): Promise<AdminAttentionItem[]> => {
  const result = await pool.query<{ incident: PublicationReliabilityIncident }>(
    `${reliabilityFactsSql}${reliabilityIncidentLinksSql}, payment_links AS (
      SELECT code,subject_type,subject_id,sponsorship_id FROM incident_links WHERE sponsorship_id IS NOT NULL
      UNION
      SELECT i.code,i.subject_type,i.subject_id,draft.contribution_id FROM incident_links i
        JOIN sponsor_publication_drafts draft ON draft.batch_id=i.batch_id OR draft.slot_id=i.slot_id
        WHERE i.subject_type<>'obligation'
      UNION
      SELECT i.code,i.subject_type,i.subject_id,draft.contribution_id FROM incident_links i
        JOIN sponsor_publication_batches batch ON batch.slot_id=i.slot_id
        JOIN sponsor_publication_drafts draft ON draft.batch_id=batch.id WHERE i.subject_type<>'obligation'
      UNION
      SELECT i.code,i.subject_type,i.subject_id,obligation.contribution_id FROM incident_links i
        JOIN sponsorship_obligation_reservations reservation ON reservation.delivery_id=i.delivery_id
        JOIN sponsorship_obligations obligation ON obligation.id=reservation.obligation_id WHERE i.subject_type<>'obligation'
      UNION
      SELECT i.code,i.subject_type,i.subject_id,contribution.id FROM incident_links i
        JOIN publication_deliveries delivery ON delivery.id=i.delivery_id
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(delivery.source_snapshot)='array' THEN delivery.source_snapshot ELSE '[]'::jsonb END) source
        JOIN fund_contributions contribution ON contribution.id::text=source->>'contribution_id' WHERE i.subject_type<>'obligation'
    ), correlated AS (
      SELECT i.code,i.subject_type,i.subject_id,i.delivery_id,i.batch_id,i.slot_id,payment.sponsorship_id
      FROM incident_links i LEFT JOIN payment_links payment USING(code,subject_type,subject_id)
    ) SELECT DISTINCT ${reliabilityIncidentJsonSql} AS incident FROM correlated
      WHERE ($1::uuid IS NULL OR sponsorship_id=$1::uuid)`,
    [contributionId ?? null]
  );
  return buildReliabilityFollowupItems(
    result.rows.map((row) => row.incident),
    now
  );
};
