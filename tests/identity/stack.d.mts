import type { Pool } from 'pg';

import type {
  SocialFixtureOptions,
  SocialFixtureAccounts
} from './social-provider.mjs';
export function startIdentityStack(options?: {
  smtpPort?: number;
  social?: SocialFixtureOptions;
}): Promise<{
  origin: string;
  apiOrigin: string;
  pool: Pool;
  provider: { issuer: string; setTokenAvailable(value: boolean): void };
  restartSocial(accounts: SocialFixtureAccounts): Promise<void>;
  stop(): Promise<void>;
}>;
