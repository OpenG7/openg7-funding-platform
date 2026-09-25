import { createHash, randomUUID } from 'node:crypto';

import type {
  AdminContributionRecord,
  AdminContributionsExportRequest
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { listAdminContributionSelection } from './fund-contributions.repository.js';
import { insertAdminAuditLog } from './fund-admin.repository.js';

export class ContributionExportError extends Error {
  constructor(
    readonly status: 400 | 409 | 503,
    readonly code: string
  ) {
    super(code);
  }
}

export const parseContributionExport = (
  input: unknown
): AdminContributionsExportRequest => {
  const invalid = () =>
    new ContributionExportError(400, 'invalid_export_selection');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw invalid();
  const body = input as Record<string, unknown>;
  if (
    body.confirmation !== 'export_private_contributions' ||
    Object.keys(body).some(
      (key) => !['confirmation', 'contributions'].includes(key)
    ) ||
    !Array.isArray(body.contributions) ||
    body.contributions.length < 1 ||
    body.contributions.length > 250
  )
    throw invalid();
  const ids = new Set<string>();
  const contributions = body.contributions.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw invalid();
    const row = item as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) => !['id', 'expectedVersion'].includes(key)
      ) ||
      typeof row.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        row.id
      ) ||
      typeof row.expectedVersion !== 'string' ||
      row.expectedVersion.length > 64 ||
      !Number.isFinite(Date.parse(row.expectedVersion))
    )
      throw invalid();
    const id = row.id.toLowerCase();
    if (ids.has(id)) throw invalid();
    ids.add(id);
    return { id, expectedVersion: row.expectedVersion };
  });
  return { confirmation: 'export_private_contributions', contributions };
};

const columns = [
  'id',
  'public_reference',
  'contribution_type',
  'payment_status',
  'amount',
  'currency',
  'paid_at',
  'public_name',
  'email_private',
  'public_display_consent',
  'display_amount_consent',
  'sponsor_company_name',
  'sponsor_contact_name',
  'sponsor_contact_email',
  'sponsor_review_status',
  'sponsor_feed_status',
  'stripe_session_id',
  'stripe_payment_intent_id',
  'created_at',
  'updated_at'
] as const satisfies readonly (keyof AdminContributionRecord)[];

const csvCell = (
  value: AdminContributionRecord[keyof AdminContributionRecord]
): string => {
  let text = value === null ? '' : String(value);
  // Quote fields and neutralize textual formula prefixes, including whitespace
  // and full-width variants. Stored contribution values remain unchanged.
  if (
    typeof value === 'string' &&
    (/^[\s\u0000-\u001f\u007f]*[=+@\-＝＋＠－]/u.test(text) ||
      /^[\t\r\n]/.test(text))
  )
    text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
};

export const buildAdminContributionsCsv = (
  rows: readonly AdminContributionRecord[]
): string =>
  [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(',')
    )
  ].join('\r\n');

export const exportAdminContributions = async (
  pool: Pool,
  input: unknown,
  actor: string
): Promise<{ csv: string; requestId: string }> => {
  const selection = parseContributionExport(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const rows = await listAdminContributionSelection(
      db,
      selection.contributions.map((row) => row.id)
    );
    const versions = new Map(
      selection.contributions.map((row) => [row.id, row.expectedVersion])
    );
    if (
      rows.length !== versions.size ||
      rows.some((row) => row.updated_at !== versions.get(row.id))
    ) {
      throw new ContributionExportError(409, 'export_selection_changed');
    }
    const csv = buildAdminContributionsCsv(rows);
    const requestId = randomUUID();
    const recorded = await insertAdminAuditLog(db, {
      actor,
      action: 'contributions.export',
      entityType: 'contributions',
      entityId: null,
      summary: 'Private contribution CSV generated.',
      metadata: {
        requestId,
        result: 'generated',
        count: rows.length,
        scope: 'displayed_selection',
        selectionHash: createHash('sha256')
          .update(
            JSON.stringify([...versions].sort(([a], [b]) => a.localeCompare(b)))
          )
          .digest('hex')
      }
    });
    if (!recorded)
      throw new ContributionExportError(503, 'export_audit_unavailable');
    await db.query('COMMIT');
    return { csv, requestId };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
};
