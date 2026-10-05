import { isDeepStrictEqual } from 'node:util';

import type { Pool } from 'pg';

import {
  privateDataEncryptionKey,
  protectEmailMetadata,
  protectPrivateJson,
  protectPrivateText,
  revealEmailMetadata,
  revealPrivateJson,
  revealPrivateText
} from './private-data-protection.js';
import {
  projectStoredStripeEvent,
  projectStoredCheckoutMetadata
} from './stripe-event-projection.js';

export interface PrivateDataBackfillOptions {
  readonly kind: 'email' | 'checkout' | 'stripe' | 'sessions';
  readonly before: string;
  readonly limit: number;
  readonly afterId?: string;
  readonly apply: boolean;
  readonly actor?: string;
  readonly requestId?: string;
}

const tables = {
  email: 'email_messages',
  checkout: 'checkout_operations',
  stripe: 'stripe_events',
  sessions: 'stripe_checkout_sessions'
} as const;

/** Explicit maintenance only: no provider calls, automatic startup migration or financial rewrite. */
export const protectHistoricalPrivateData = async (
  pool: Pool,
  options: PrivateDataBackfillOptions
): Promise<{
  scanned: number;
  changed: number;
  nextCursor: string | null;
  applied: boolean;
}> => {
  if (
    !Object.hasOwn(tables, options.kind) ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 500 ||
    !Number.isFinite(Date.parse(options.before)) ||
    (options.afterId &&
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        options.afterId
      )) ||
    (options.apply &&
      (!options.actor ||
        !/^[A-Za-z0-9_.:@-]{1,100}$/.test(options.actor) ||
        !options.requestId ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
          options.requestId
        )))
  )
    throw new Error('PRIVATE_DATA_BACKFILL_SCOPE_INVALID');
  if (!privateDataEncryptionKey())
    throw new Error('PRIVATE_DATA_ENCRYPTION_KEY_REQUIRED');
  const db = await pool.connect();
  let scanned = 0;
  let changed = 0;
  let nextCursor: string | null = null;
  try {
    await db.query('BEGIN');
    const createdColumn =
      options.kind === 'stripe' ? 'received_at' : 'created_at';
    const rows = await db.query(
      `SELECT * FROM ${tables[options.kind]} WHERE ${createdColumn} < $1::timestamptz
       AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3
       ${options.apply ? 'FOR UPDATE' : ''}`,
      [options.before, options.afterId ?? null, options.limit]
    );
    for (const row of rows.rows) {
      scanned++;
      nextCursor = String(row.id);
      if (options.kind === 'email') {
        const context = `email:${row.id}:`;
        const legacy =
          [row.subject, row.text_body, row.html_body].some(
            (value: string) => !value.startsWith('og7enc:v1:')
          ) || !row.metadata?.__openg7Encrypted;
        // Validate existing ciphertext too; a missing/wrong key must stop the batch.
        const subject = revealPrivateText(row.subject, context + 'subject');
        const text = revealPrivateText(row.text_body, context + 'text');
        const html = revealPrivateText(row.html_body, context + 'html');
        const metadata = revealEmailMetadata(row.metadata, row.id);
        if (!legacy) continue;
        changed++;
        if (options.apply)
          await db.query(
            `UPDATE email_messages SET subject=$2,text_body=$3,html_body=$4,metadata=$5::jsonb WHERE id=$1`,
            [
              row.id,
              protectPrivateText(subject, context + 'subject'),
              protectPrivateText(text, context + 'text'),
              protectPrivateText(html, context + 'html'),
              JSON.stringify(protectEmailMetadata(metadata, row.id))
            ]
          );
      } else if (options.kind === 'checkout') {
        const params = revealPrivateJson(
          row.params,
          `checkout:${row.id}:params`
        );
        const record = revealPrivateJson(
          row.contribution_input,
          `checkout:${row.id}:contribution`
        );
        const result =
          row.provider_result === null
            ? null
            : revealPrivateJson(
                row.provider_result,
                `checkout:${row.id}:result`
              );
        const legacy =
          !row.params?.__openg7Encrypted ||
          !row.contribution_input?.__openg7Encrypted ||
          (row.provider_result !== null &&
            !row.provider_result?.__openg7Encrypted);
        if (!legacy) continue;
        changed++;
        if (options.apply)
          await db.query(
            `UPDATE checkout_operations SET params=$2::jsonb,contribution_input=$3::jsonb,provider_result=$4::jsonb WHERE id=$1`,
            [
              row.id,
              JSON.stringify(
                protectPrivateJson(params, `checkout:${row.id}:params`)
              ),
              JSON.stringify(
                protectPrivateJson(record, `checkout:${row.id}:contribution`)
              ),
              result === null
                ? null
                : JSON.stringify(
                    protectPrivateJson(result, `checkout:${row.id}:result`)
                  )
            ]
          );
      } else if (options.kind === 'sessions') {
        const projected = projectStoredCheckoutMetadata(row.metadata);
        if (isDeepStrictEqual(projected, row.metadata)) continue;
        changed++;
        if (options.apply)
          await db.query(
            'UPDATE stripe_checkout_sessions SET metadata=$2::jsonb WHERE id=$1',
            [row.id, JSON.stringify(projected)]
          );
      } else {
        const projected = projectStoredStripeEvent(row.payload);
        if (isDeepStrictEqual(projected, row.payload)) continue;
        changed++;
        if (options.apply)
          await db.query(
            'UPDATE stripe_events SET payload=$2::jsonb WHERE id=$1',
            [row.id, JSON.stringify(projected)]
          );
      }
    }
    if (options.apply) {
      const audit = await db.query(
        `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
       VALUES($1,'private_data.protected',$2,$3,'Bounded historical private data protection.',$4::jsonb)`,
        [
          options.actor,
          tables[options.kind],
          options.requestId,
          JSON.stringify({
            requestId: options.requestId,
            result: 'applied',
            before: options.before,
            limit: options.limit,
            afterId: options.afterId ?? null,
            scanned,
            changed,
            nextCursor
          })
        ]
      );
      if (audit.rowCount !== 1)
        throw new Error('PRIVATE_DATA_BACKFILL_AUDIT_REQUIRED');
    }
    await db.query(options.apply ? 'COMMIT' : 'ROLLBACK');
    return { scanned, changed, nextCursor, applied: options.apply };
  } catch {
    await db.query('ROLLBACK').catch(() => undefined);
    throw new Error('PRIVATE_DATA_BACKFILL_FAILED');
  } finally {
    db.release();
  }
};
