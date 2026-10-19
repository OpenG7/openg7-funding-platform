import { UrlTree } from '@angular/router';
import type { Router } from '@angular/router';

import { dossierSectionTab } from './admin-sponsorship-navigation.js';
import { workspaceTab } from './admin-sponsorship-workspace.js';

const dossierPath = '/admin/fundraiser/sponsors';
const tabs = [
  'overview',
  'identity',
  'media',
  'billing',
  'refund',
  'publication',
  'audit'
] as const;

/** Transient focus intent for the two known Assistant links; never persisted. */
export class AssistantDossierNavigation {
  constructor(
    readonly sponsorshipId: string,
    readonly source: 'dossier' | 'shell'
  ) {}
}

/** Rebuild only a same-dossier location, excluding private and nested query data. */
export function assistantDossierReturn(
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

export function assistantDossierQuery(
  router: Pick<Router, 'parseUrl' | 'serializeUrl'>,
  currentUrl: string,
  sponsorshipId: string | null | undefined
): { sponsorshipId?: string; returnTo?: string } {
  if (!sponsorshipId) return {};
  const origin = assistantDossierReturn(router, currentUrl, sponsorshipId);
  return {
    sponsorshipId,
    ...(origin ? { returnTo: router.serializeUrl(origin) } : {})
  };
}
