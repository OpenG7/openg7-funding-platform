import type { AdminIdentityProfile } from './funding-admin-session.js';

/** Presentation only: callers supply the session returned by getSavedAdminToken.
 * That transport checks its stored expiry; the API still verifies every request.
 */
export function adminFinancialCapabilities(
  identity: Pick<AdminIdentityProfile, 'role' | 'expiresAt'> | null,
  savedSessionToken: string,
  now = Date.now()
): {
  readonly canBackfillInvoices: boolean;
  readonly canManageExpenses: boolean;
  readonly canResendDocuments: boolean;
} {
  const cookieSession = savedSessionToken === 'openg7-admin-session.cookie';
  const authenticatedIdentity =
    cookieSession && identity !== null && Date.parse(identity.expiresAt) > now;
  // Local token sessions have no OIDC identity, but an absent identity by itself
  // never grants presentation capabilities. Use the validated saved session.
  const localSession =
    !identity &&
    !cookieSession &&
    savedSessionToken.startsWith('openg7-admin-session.') &&
    savedSessionToken.length > 'openg7-admin-session.'.length;
  const owner =
    localSession || (authenticatedIdentity && identity.role === 'owner');
  return {
    canBackfillInvoices: owner,
    canManageExpenses: owner,
    canResendDocuments:
      owner || (authenticatedIdentity && identity.role === 'operator')
  };
}
