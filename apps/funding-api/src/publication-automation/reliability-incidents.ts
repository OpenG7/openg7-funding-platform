import type { PoolClient } from 'pg';

import {
  PUBLICATION_RELIABILITY_INCIDENT_CODES,
  type PublicationReliabilityIncident,
  type PublicationReliabilityIncidentFilter,
  type PublicationReliabilityIncidentPage
} from '../../../../packages/funding-core/src/index.js';

import { assert, validId } from './policy.js';
import { reliabilityFactsSql } from './reliability-facts.js';

export const RELIABILITY_INCIDENT_LIMIT = 50;
const subjects = ['obligation', 'delivery', 'batch', 'slot'] as const;

/** Correlate persisted identifiers only; never include source text, contacts or account credentials. */
export const reliabilityIncidentLinksSql = `, incident_links AS (
  SELECT i.*,o.contribution_id AS sponsorship_id,
    COALESCE(d.id,proof.delivery_id,reservation.delivery_id) AS delivery_id,
    COALESCE(b.id,d.batch_id) AS batch_id,COALESCE(s.id,b.slot_id) AS slot_id
  FROM incidents i
  LEFT JOIN sponsorship_obligations o ON i.subject_type='obligation' AND o.id=i.subject_id
  LEFT JOIN sponsorship_fulfilment_evidence proof ON proof.id=o.fulfilment_evidence_id
  LEFT JOIN LATERAL (SELECT r.delivery_id FROM sponsorship_obligation_reservations r
    WHERE r.obligation_id=o.id AND r.released_at IS NULL ORDER BY r.delivery_id LIMIT 1) reservation ON TRUE
  LEFT JOIN publication_deliveries d ON d.id=CASE WHEN i.subject_type='delivery' THEN i.subject_id
    ELSE COALESCE(proof.delivery_id,reservation.delivery_id) END
  LEFT JOIN sponsor_publication_batches b ON b.id=CASE WHEN i.subject_type='batch' THEN i.subject_id ELSE d.batch_id END
  LEFT JOIN publication_slots s ON i.subject_type='slot' AND s.id=i.subject_id
)`;

export const reliabilityIncidentJsonSql = `jsonb_strip_nulls(jsonb_build_object(
  'code',code,'subjectType',subject_type,'subjectId',subject_id,
  'sponsorshipId',sponsorship_id,'deliveryId',delivery_id,'batchId',batch_id,'slotId',slot_id))`;

type Cursor = {
  version: 1;
  snapshot: string;
  code: string | null;
  subjectType: string | null;
  after: [string, string, string];
};

const count = (value: unknown): number => {
  assert(
    typeof value === 'string' && /^\d+$/.test(value),
    'RELIABILITY_UNAVAILABLE',
    503
  );
  const number = Number(value);
  assert(Number.isSafeInteger(number), 'RELIABILITY_UNAVAILABLE', 503);
  return number;
};

export function validateReliabilityIncidentFilter(
  filter: PublicationReliabilityIncidentFilter
): Cursor | undefined {
  assert(filter && typeof filter === 'object', 'INVALID_FILTER', 400);
  assert(
    filter.code === undefined ||
      PUBLICATION_RELIABILITY_INCIDENT_CODES.includes(filter.code),
    'INVALID_FILTER',
    400
  );
  assert(
    filter.subjectType === undefined || subjects.includes(filter.subjectType),
    'INVALID_FILTER',
    400
  );
  if (filter.cursor === undefined) return undefined;
  assert(
    typeof filter.cursor === 'string' &&
      filter.cursor.length <= 1024 &&
      /^[a-zA-Z0-9_-]+$/.test(filter.cursor),
    'INVALID_FILTER',
    400
  );
  let cursor: Cursor;
  try {
    cursor = JSON.parse(
      Buffer.from(filter.cursor, 'base64url').toString('utf8')
    ) as Cursor;
  } catch {
    assert(false, 'INVALID_FILTER', 400);
  }
  assert(
    cursor &&
      cursor.version === 1 &&
      typeof cursor.snapshot === 'string' &&
      /^[a-f0-9]{32}$/.test(cursor.snapshot) &&
      cursor.code === (filter.code ?? null) &&
      cursor.subjectType === (filter.subjectType ?? null) &&
      Array.isArray(cursor.after) &&
      cursor.after.length === 3 &&
      PUBLICATION_RELIABILITY_INCIDENT_CODES.includes(
        cursor.after[0] as PublicationReliabilityIncident['code']
      ) &&
      subjects.includes(
        cursor.after[1] as PublicationReliabilityIncident['subjectType']
      ) &&
      validId(cursor.after[2]),
    'INVALID_FILTER',
    400
  );
  return cursor;
}

/** One statement per page. The service supplies a REPEATABLE READ READ ONLY transaction. */
export async function publicationReliabilityIncidentPage(
  db: Pick<PoolClient, 'query'>,
  filter: PublicationReliabilityIncidentFilter = {}
): Promise<PublicationReliabilityIncidentPage> {
  const cursor = validateReliabilityIncidentFilter(filter);
  const {
    rows: [row]
  } = await db.query(
    `${reliabilityFactsSql}${reliabilityIncidentLinksSql},
    filtered AS (SELECT * FROM incident_links WHERE ($1::text IS NULL OR code=$1) AND ($2::text IS NULL OR subject_type=$2)),
    page AS (SELECT * FROM filtered WHERE ($3::text IS NULL OR (code,subject_type,subject_id) > ($3::text,$4::text,$5::uuid))
      ORDER BY code,subject_type,subject_id LIMIT ${RELIABILITY_INCIDENT_LIMIT + 1})
    SELECT transaction_timestamp() AS evaluated_at,(SELECT count(*)::text FROM incident_links) AS global_total,
      (SELECT count(*)::text FROM filtered) AS filtered_total,
      (SELECT md5(COALESCE(string_agg(code||':'||subject_type||':'||subject_id||':'||COALESCE(sponsorship_id::text,'')
        ||':'||COALESCE(delivery_id::text,'')||':'||COALESCE(batch_id::text,'')||':'||COALESCE(slot_id::text,''),',' ORDER BY code,subject_type,subject_id),'')) FROM incident_links) AS snapshot,
      COALESCE((SELECT jsonb_agg(${reliabilityIncidentJsonSql} ORDER BY code,subject_type,subject_id) FROM page),'[]'::jsonb) AS incidents`,
    [
      filter.code ?? null,
      filter.subjectType ?? null,
      cursor?.after[0] ?? null,
      cursor?.after[1] ?? null,
      cursor?.after[2] ?? null
    ]
  );
  assert(
    row &&
      typeof row.snapshot === 'string' &&
      /^[a-f0-9]{32}$/.test(row.snapshot) &&
      Array.isArray(row.incidents),
    'RELIABILITY_UNAVAILABLE',
    503
  );
  assert(
    !cursor || cursor.snapshot === row.snapshot,
    'RELIABILITY_SNAPSHOT_CHANGED',
    409
  );
  const incidents = row.incidents.slice(
    0,
    RELIABILITY_INCIDENT_LIMIT
  ) as PublicationReliabilityIncident[];
  const last = incidents.at(-1);
  const nextCursor =
    row.incidents.length > RELIABILITY_INCIDENT_LIMIT && last
      ? Buffer.from(
          JSON.stringify({
            version: 1,
            snapshot: row.snapshot,
            code: filter.code ?? null,
            subjectType: filter.subjectType ?? null,
            after: [last.code, last.subjectType, last.subjectId]
          } satisfies Cursor)
        ).toString('base64url')
      : null;
  return {
    scope: 'global',
    evaluatedAt: row.evaluated_at.toISOString(),
    globalTotal: count(row.global_total),
    filteredTotal: count(row.filtered_total),
    limit: RELIABILITY_INCIDENT_LIMIT,
    incidents,
    nextCursor,
    snapshot: row.snapshot
  };
}
