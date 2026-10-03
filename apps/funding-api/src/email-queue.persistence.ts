import type { Pool } from 'pg';

export const hasEmailMessagesTable = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ readonly has_email_messages: boolean }>(`
    SELECT to_regclass('public.email_messages') IS NOT NULL AS has_email_messages
  `);

  return result.rows[0]?.has_email_messages ?? false;
};
