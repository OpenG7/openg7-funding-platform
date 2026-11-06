import type { FundingAdminSession } from './funding-admin-session.js';

/** Cookie restoration can change identity without replacing the local session generation. */
export function fundingAdminIdentityKey(
  session: Pick<FundingAdminSession, 'identity' | 'sessionGeneration'>
): string {
  const identity = session.identity();
  return `${session.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
}
