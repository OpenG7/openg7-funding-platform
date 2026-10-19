import type { AdminRole } from './contracts.js';

export const roles: readonly string[] = ['reader', 'operator', 'owner'];
const operatorActions = new Set([
  '/admin/moderation/decisions',
  '/admin/moderation/independent-review',
  '/admin/moderation/reconsiderations/resolve',
  '/admin/pilotage/command',
  '/admin/pilotage/receipt',
  '/admin/pilotage/programme',
  '/admin/pilotage/variant',
  '/admin/automatic-runs',
  '/admin/automatic-runs/advance',
  '/admin/automatic-runs/control',
  '/admin/automatic-runs/preparation/approve',
  '/admin/sponsorships/preparation/approve',
  '/admin/sponsorships/details',
  '/admin/sponsorships/interventions',
  '/admin/sponsorships/review',
  '/admin/sponsorships/request-information',
  '/admin/sponsorships/publication',
  '/admin/sponsorships/website-visibility',
  '/admin/sponsorships/media',
  '/admin/sponsorships/media/delete',
  '/admin/sponsorships/media/review',
  '/admin/sponsorships/media/metadata',
  '/admin/sponsorships/media/usage',
  '/admin/sponsorships/media/preference-review',
  '/admin/sponsorships/media/rules',
  '/admin/sponsorships/media/batches',
  '/admin/sponsorships/media/batch/plan',
  '/admin/sponsorships/media/batch/execute',
  '/admin/sponsorships/media/analyses',
  '/admin/sponsorships/media/analyses/review',
  '/admin/sponsorships/media/upload',
  '/admin/sponsorships/logo',
  '/admin/sponsorships/logo/delete',
  '/admin/email-queue/retry',
  '/admin/email-queue/reconcile',
  '/admin/sponsorship-invoices/resend',
  '/admin/sponsorship-credit-notes/resend',
  '/admin/publication-drafts',
  '/admin/publication-drafts/update',
  '/admin/publication-batches',
  '/admin/publication-batches/assign',
  '/admin/publication-batches/unassign',
  '/admin/publication-batches/schedule',
  '/admin/publication-batches/cancel',
  '/admin/publication-batches/publish',
  '/admin/publication-batches/publish-social',
  '/admin/publication-slots',
  '/admin/publication-slots/update',
  '/admin/publication-slots/assign-batch',
  '/admin/publication-slots/assign-draft',
  '/admin/publication-slots/cancel',
  '/admin/publication-slots/publish',
  '/admin/assistant/query',
  '/admin/assistant/prepare'
]);

export const adminRoleAllows = (
  role: AdminRole,
  method: string,
  pathname: string
): boolean => {
  const path = pathname.replace(/^\/api(?=\/)/, '');
  if (role === 'owner') return true;
  if (path === '/admin/expenses/create-receipt') return false;
  if (
    path === '/admin/sponsorship-documents/resend-receipt' ||
    path === '/admin/sponsorships/information-request-receipt'
  )
    return role === 'operator' && method === 'GET';
  if (
    [
      '/admin/sponsorships/media/workspace/history',
      '/admin/sponsorships/media/receipt',
      '/admin/sponsorships/media/analyses',
      '/admin/sponsorships/media/analyses/review'
    ].includes(path)
  )
    return (
      role === 'operator' &&
      (method === 'GET' || (method === 'POST' && operatorActions.has(path)))
    );
  if (
    path === '/admin/preparation-assistance' ||
    path.startsWith('/admin/preparation-assistance/')
  )
    return false;
  if (
    [
      '/admin/moderation/adoption-preview',
      '/admin/moderation/retention-preview',
      '/admin/moderation/charter-preview',
      '/admin/moderation/assignment'
    ].includes(path)
  )
    return false;
  if (path.startsWith('/admin/moderation/'))
    return (
      role === 'operator' &&
      (method === 'GET' || (method === 'POST' && operatorActions.has(path)))
    );
  if (
    path.startsWith('/admin/access') ||
    path === '/admin/contributions.csv' ||
    path === '/admin/stripe-backfill' ||
    path === '/admin/setup-status' ||
    path === '/admin/backups' ||
    path === '/admin/email/test' ||
    path === '/admin/sponsorships/followup-access'
  )
    return false;
  if (method === 'GET') return true;
  // Read-only queries and the caller's own toast markers are allowed for all admins.
  if (
    method === 'POST' &&
    [
      '/admin/search',
      '/admin/assistant/query',
      '/admin/contribution-activity/present'
    ].includes(path)
  )
    return true;
  return role === 'operator' && method === 'POST' && operatorActions.has(path);
};

export const safeAdminReturnPath = (candidate: string | null): string => {
  if (!candidate || candidate.includes('\\')) return '/admin/fundraiser';
  const url = new URL(candidate, 'https://admin.invalid');
  return url.origin === 'https://admin.invalid' &&
    /^\/admin\/fundraiser(?:\/|$)/.test(url.pathname)
    ? url.pathname + url.search
    : '/admin/fundraiser';
};

export const satisfiesMfa = (
  claims: Record<string, unknown>,
  acceptedAcr: readonly string[]
): boolean =>
  (Array.isArray(claims.amr) && claims.amr.includes('mfa')) ||
  (typeof claims.acr === 'string' && acceptedAcr.includes(claims.acr));
