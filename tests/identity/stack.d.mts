import type { Pool } from 'pg';
export function startIdentityStack(options?: { smtpPort?: number }): Promise<{
  origin: string;
  apiOrigin: string;
  pool: Pool;
  provider: { issuer: string; setTokenAvailable(value: boolean): void };
  stop(): Promise<void>;
}>;
