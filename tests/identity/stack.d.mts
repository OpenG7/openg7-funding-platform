import type { Pool } from 'pg';

import type {
  SocialFixtureOptions,
  SocialFixtureAccounts
} from './social-provider.mjs';
export function startIdentityStack(options?: {
  smtpPort?: number;
  stripe?: { origin: string };
  assistant?: { enabled: boolean; maxToolCalls?: number };
  social?: SocialFixtureOptions;
}): Promise<{
  origin: string;
  apiOrigin: string;
  pool: Pool;
  mediaDirectory: string;
  dumpDatabase(): Promise<string>;
  provider: { issuer: string; setTokenAvailable(value: boolean): void };
  restartSocial(accounts: SocialFixtureAccounts): Promise<void>;
  restartAssistant(settings: {
    enabled: boolean;
    maxToolCalls?: number;
  }): Promise<void>;
  stop(): Promise<void>;
}>;
