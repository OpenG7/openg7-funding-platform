import type { Pool } from 'pg';

import { SponsorshipConsentError } from './admin-sponsorship-consent-policy.js';

/** Check the active role before exposing private references or writing a command. */
export async function assertSponsorshipConsentReadiness(
  db: Pick<Pool, 'query'>,
  write = false
): Promise<void> {
  try {
    const row = (
      await db.query<{
        compatible: boolean;
        can_read: boolean;
        can_insert: boolean;
      }>(`WITH relation AS (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='admin_sponsorship_consent_records'
          AND c.relkind IN ('r','p')
      ) SELECT EXISTS(SELECT 1 FROM relation) AND EXISTS(
        SELECT 1 FROM relation r JOIN pg_trigger t ON t.tgrelid=r.oid
        WHERE t.tgname='admin_sponsorship_consent_records_immutable' AND t.tgenabled IN ('O','A')
      ) AND EXISTS(
        SELECT 1 FROM relation r JOIN pg_index i ON i.indrelid=r.oid
        WHERE i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts=1
          AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=r.oid AND attname='request_id')
      ) AS compatible,
      COALESCE((SELECT has_table_privilege(current_user,r.oid,'SELECT') FROM relation r),false) AS can_read,
      COALESCE((SELECT has_table_privilege(current_user,r.oid,'INSERT') FROM relation r),false) AS can_insert`)
    ).rows[0];
    if (!row?.compatible)
      throw new SponsorshipConsentError('CONSENT_SCHEMA_UNAVAILABLE', 503);
    if (!row.can_read || (write && !row.can_insert))
      throw new SponsorshipConsentError('CONSENT_DATABASE_ACCESS_DENIED', 503);
  } catch (error) {
    if (error instanceof SponsorshipConsentError) throw error;
    throw new SponsorshipConsentError('CONSENT_UNAVAILABLE', 503);
  }
}
