import { createHash, randomBytes } from 'node:crypto';

import type {
  AdminSponsorshipAccessResult,
  SponsorshipDraftSnapshot,
  SponsorshipDraftValues
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { enqueueSponsorshipAccessEmail } from './email-notification.service.js';
import { insertAdminAuditLog } from './fund-admin.repository.js';
import { recordSponsorshipDetailsForContribution } from './fund-contributions.repository.js';

export class SponsorshipAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code = 'unavailable'
  ) {
    super('Sponsorship access operation failed.');
  }
}

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeRecoveryEmail = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !emailPattern.test(value.trim())
  )
    throw new SponsorshipAccessError(400, 'validation');
  return value.trim().toLowerCase();
};
const fields = {
  companyName: 200,
  contactName: 200,
  contactEmail: 200,
  websiteUrl: 2048,
  logoUrl: 2048,
  message: 1000
} as const;
export const validateSponsorshipDraft = (
  value: unknown
): SponsorshipDraftValues | null => {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SponsorshipAccessError(400, 'validation');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !Object.hasOwn(fields, key)))
    throw new SponsorshipAccessError(400, 'validation');
  const result: Record<string, string> = {};
  for (const [key, limit] of Object.entries(fields)) {
    const text = raw[key];
    if (typeof text !== 'string' || text.length > limit || text.includes('\0'))
      throw new SponsorshipAccessError(400, 'validation');
    result[key] = text;
  }
  return result as unknown as SponsorshipDraftValues;
};
const revisionValid = (revision: unknown): revision is number =>
  Number.isSafeInteger(revision) && Number(revision) >= 0;

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface Dossier {
  id: string;
  status: string;
  sponsor_review_status: string;
  email_private: string | null;
  public_reference: string | null;
  sponsor_company_name: string | null;
  sponsor_contact_name: string | null;
  sponsor_contact_email: string | null;
  sponsor_website_url: string | null;
  sponsor_logo_url: string | null;
  sponsor_message: string | null;
  sponsor_details_submitted_at: string | null;
}
async function authorizedDossier(
  client: PoolClient,
  token: string,
  ttlDays: number
): Promise<Dossier> {
  if (!tokenPattern.test(token))
    throw new SponsorshipAccessError(404, 'access');
  const result = await client.query<Dossier>(
    `SELECT c.* FROM fund_contributions c
    WHERE c.contribution_type = 'sponsorship_interest' AND (
      (c.sponsorship_followup_token_hash = $1 AND c.sponsorship_followup_token_created_at >= NOW() - $2 * INTERVAL '1 day')
      OR EXISTS (SELECT 1 FROM sponsorship_access_tokens t WHERE t.contribution_id = c.id AND t.token_hash = $1 AND t.expires_at > NOW()))
    FOR UPDATE OF c`,
    [hash(token), ttlDays]
  );
  const row = result.rows[0];
  if (!row) throw new SponsorshipAccessError(404, 'access');
  return row;
}
function ensureEditable(row: Dossier): void {
  if (
    !['paid', 'refunded', 'disputed'].includes(row.status) ||
    row.sponsor_review_status === 'rejected'
  )
    throw new SponsorshipAccessError(409, 'not_editable');
}
async function readDraft(
  client: PoolClient,
  id: string
): Promise<SponsorshipDraftSnapshot> {
  const result = await client.query<{
    revision: number;
    data: SponsorshipDraftValues | null;
    updatedAt: string;
  }>(
    'SELECT revision, data, updated_at::text AS "updatedAt" FROM sponsorship_followup_drafts WHERE contribution_id = $1',
    [id]
  );
  return result.rows[0] ?? { revision: 0, data: null, updatedAt: null };
}
async function writeDraft(
  client: PoolClient,
  id: string,
  data: SponsorshipDraftValues | null
): Promise<SponsorshipDraftSnapshot> {
  const result = await client.query<SponsorshipDraftSnapshot>(
    `INSERT INTO sponsorship_followup_drafts (contribution_id, revision, data)
    VALUES ($1, 1, $2::jsonb) ON CONFLICT (contribution_id) DO UPDATE
    SET revision = sponsorship_followup_drafts.revision + 1, data = EXCLUDED.data, updated_at = NOW()
    RETURNING revision, data, updated_at::text AS "updatedAt"`,
    [id, data === null ? null : JSON.stringify(data)]
  );
  return result.rows[0]!;
}
const sameDraft = (
  a: SponsorshipDraftValues | null,
  b: SponsorshipDraftValues | null
) =>
  a === null || b === null
    ? a === b
    : Object.keys(fields).every(
        (key) => a[key as keyof typeof fields] === b[key as keyof typeof fields]
      );

export const getSponsorshipDraft = (
  pool: Pool,
  token: string,
  ttlDays: number
): Promise<SponsorshipDraftSnapshot> =>
  transaction(pool, async (client) =>
    readDraft(client, (await authorizedDossier(client, token, ttlDays)).id)
  );

export const saveSponsorshipDraft = (
  pool: Pool,
  token: string,
  ttlDays: number,
  expectedRevision: number,
  input: unknown
): Promise<SponsorshipDraftSnapshot> => {
  if (!revisionValid(expectedRevision))
    throw new SponsorshipAccessError(400, 'validation');
  const data = validateSponsorshipDraft(input);
  return transaction(pool, async (client) => {
    const row = await authorizedDossier(client, token, ttlDays);
    ensureEditable(row);
    const current = await readDraft(client, row.id);
    // Same-body retry after a lost acknowledgement is harmless.
    if (expectedRevision <= current.revision && sameDraft(current.data, data))
      return current;
    if (current.revision !== expectedRevision)
      throw new SponsorshipAccessError(409, 'draft_conflict');
    return writeDraft(client, row.id, data);
  });
};

export const submitSponsorshipDraft = (
  pool: Pool,
  token: string,
  ttlDays: number,
  expectedRevision: number | undefined,
  data: SponsorshipDraftValues
): Promise<boolean> =>
  transaction(pool, async (client) => {
    const row = await authorizedDossier(client, token, ttlDays);
    ensureEditable(row);
    const current = await readDraft(client, row.id);
    const previous = {
      companyName: row.sponsor_company_name ?? '',
      contactName: row.sponsor_contact_name ?? '',
      contactEmail: row.sponsor_contact_email ?? '',
      websiteUrl: row.sponsor_website_url ?? '',
      logoUrl: row.sponsor_logo_url ?? '',
      message: row.sponsor_message ?? ''
    };
    const sameSubmission =
      Boolean(row.sponsor_details_submitted_at) && sameDraft(previous, data);
    // A repeated confirmed submission must neither reopen review nor erase a newer draft.
    if (sameSubmission && expectedRevision !== current.revision) return true;
    if (
      expectedRevision !== undefined
        ? !revisionValid(expectedRevision) ||
          expectedRevision !== current.revision
        : current.data !== null
    )
      throw new SponsorshipAccessError(409, 'draft_conflict');
    if (!sameSubmission) {
      const recorded = await recordSponsorshipDetailsForContribution(client, {
        contributionId: row.id,
        ...data,
        websiteUrl: data.websiteUrl || null,
        logoUrl: data.logoUrl || null,
        message: data.message || null
      });
      if (!recorded) throw new SponsorshipAccessError(409, 'not_editable');
      const audited = await insertAdminAuditLog(client, {
        actor: 'sponsor',
        action: 'sponsorship.details_submitted',
        entityType: 'sponsorship',
        entityId: row.id,
        summary: 'Sponsor submitted details for review.',
        metadata: {}
      });
      if (!audited) throw new SponsorshipAccessError(503);
    }
    await writeDraft(client, row.id, null);
    return true;
  });

export async function getSponsorshipAccessRecipient(
  pool: Pool,
  contributionId: string
): Promise<string | null> {
  const result = await pool.query<{ email_private: string | null }>(
    `SELECT email_private FROM fund_contributions
    WHERE id = $1::uuid AND contribution_type = 'sponsorship_interest' AND status IN ('paid','refunded','disputed')`,
    [contributionId]
  );
  const email = result.rows[0]?.email_private;
  return email && emailPattern.test(email.trim())
    ? email.trim().toLowerCase()
    : null;
}

interface RecoveryOptions {
  baseUrl: string;
  ttlDays: number;
  locale: 'fr-CA' | 'en';
}
export async function issueSponsorshipAccess(
  pool: Pool,
  contributionId: string,
  recipient: string,
  options: RecoveryOptions,
  admin?: { actor: string; requestId: string }
): Promise<AdminSponsorshipAccessResult> {
  return transaction(pool, async (client) => {
    const row = (
      await client.query<Dossier>(
        `SELECT * FROM fund_contributions WHERE id = $1::uuid
      AND contribution_type = 'sponsorship_interest' AND status IN ('paid','refunded','disputed') FOR UPDATE`,
        [contributionId]
      )
    ).rows[0];
    if (
      !row ||
      !row.email_private ||
      normalizeRecoveryEmail(row.email_private) !== recipient
    )
      throw new SponsorshipAccessError(409, 'recipient_changed');
    const key = admin
      ? `sponsorship-access:admin:${row.id}:${admin.requestId}`
      : `sponsorship-access:public:${row.id}:${Math.floor(Date.now() / 600000)}`;
    const existing = (
      await client.query<{ status: string; recipient_email: string }>(
        `SELECT e.status, e.recipient_email FROM email_messages e
      WHERE e.idempotency_key = $1 OR e.id IN (SELECT t.email_message_id FROM sponsorship_access_tokens t
        WHERE t.contribution_id = $2 AND t.created_at > NOW() - $3 * INTERVAL '1 second' AND e.recipient_email = $4)
      ORDER BY (e.idempotency_key = $1) DESC, e.created_at DESC LIMIT 1`,
        [key, row.id, admin ? 60 : 600, recipient]
      )
    ).rows[0];
    if (existing && existing.recipient_email !== recipient)
      throw new SponsorshipAccessError(409, 'recipient_changed');
    if (existing)
      return {
        status:
          existing.status === 'sent'
            ? 'already_sent'
            : existing.status === 'failed'
              ? 'delivery_failed'
              : 'already_queued'
      };
    const token = randomBytes(32).toString('base64url');
    const url = new URL(
      `${options.locale === 'en' ? '/en' : ''}/fonds-des-batisseurs/suivi-commandite`,
      options.baseUrl
    );
    url.searchParams.set('token', token);
    const messageId = await enqueueSponsorshipAccessEmail(client, {
      to: recipient,
      url: url.toString(),
      reference: row.public_reference,
      locale: options.locale,
      idempotencyKey: key
    });
    await client.query(
      `INSERT INTO sponsorship_access_tokens (token_hash, contribution_id, expires_at, email_message_id)
      VALUES ($1, $2, NOW() + $3 * INTERVAL '1 day', $4)`,
      [hash(token), row.id, options.ttlDays, messageId]
    );
    const audited = await insertAdminAuditLog(client, {
      actor: admin?.actor ?? 'public-recovery',
      action: 'sponsorship.access_link_requested',
      entityType: 'sponsorship',
      entityId: row.id,
      summary: 'Private access link queued for the payment email.',
      metadata: { messageId }
    });
    if (!audited) throw new SponsorshipAccessError(503);
    return { status: 'queued' };
  });
}

export async function recoverSponsorshipAccess(
  pool: Pool,
  email: string,
  options: RecoveryOptions
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM fund_contributions WHERE contribution_type = 'sponsorship_interest'
    AND status IN ('paid','refunded','disputed') AND lower(btrim(email_private)) = $1 ORDER BY created_at DESC LIMIT 20`,
    [email]
  );
  for (const row of result.rows)
    await issueSponsorshipAccess(pool, row.id, email, options);
}
