import { UrlTree } from '@angular/router';
import type { Router } from '@angular/router';

import { dossierSectionTab } from './admin-sponsorship-navigation.js';
import { workspaceTab } from './admin-sponsorship-workspace.js';

const dossierPath = '/admin/fundraiser/sponsors';
const tabs = [
  'overview',
  'identity',
  'media',
  'publication',
  'billing',
  'refund',
  'audit'
] as const;
const workspaceHooks = [
  'publication-chain-link',
  'publication-campaign-benefits',
  'publication-engine',
  'publication-details',
  'commitments-evidence'
] as const;

/** Known dossier links only. This intent travels in NavigationExtras.info, not storage. */
export class DossierWorkspaceNavigation {
  constructor(
    readonly sponsorshipId: string,
    readonly hook: (typeof workspaceHooks)[number],
    readonly id?: string
  ) {}
}

export function dossierWorkspaceFocus(
  value: unknown,
  sponsorshipId: string | null | undefined
): DossierWorkspaceNavigation | undefined {
  return value instanceof DossierWorkspaceNavigation &&
    value.sponsorshipId === sponsorshipId &&
    workspaceHooks.includes(value.hook)
    ? value
    : undefined;
}

/** Rebuild a same-dossier location without private or nested query values. */
export function dossierReturn(
  router: Pick<Router, 'parseUrl'>,
  value: string | null | undefined,
  sponsorshipId: string | null | undefined
): UrlTree | null {
  if (
    !value ||
    !sponsorshipId ||
    value.length > 2048 ||
    !(
      value === dossierPath ||
      value.startsWith(dossierPath + '?') ||
      value.startsWith(dossierPath + '#')
    )
  )
    return null;
  let tree: UrlTree;
  try {
    tree = router.parseUrl(value);
  } catch {
    return null;
  }
  if (
    new UrlTree(tree.root).toString() !== dossierPath ||
    tree.queryParams['sponsorshipId'] !== sponsorshipId
  )
    return null;
  const tab = tree.queryParams['tab'] ?? 'overview';
  if (!tabs.includes(tab)) return null;
  const sectionTab = dossierSectionTab(tree.fragment);
  const fragment =
    sectionTab && workspaceTab(sectionTab) === workspaceTab(tab)
      ? tree.fragment
      : null;
  return new UrlTree(tree.root, { sponsorshipId, tab }, fragment);
}

export function dossierReturnQuery(
  router: Pick<Router, 'parseUrl' | 'serializeUrl'>,
  currentUrl: string,
  sponsorshipId: string | null | undefined
): { sponsorshipId?: string; returnTo?: string } {
  if (!sponsorshipId) return {};
  const origin = dossierReturn(router, currentUrl, sponsorshipId);
  return {
    sponsorshipId,
    ...(origin ? { returnTo: router.serializeUrl(origin) } : {})
  };
}
