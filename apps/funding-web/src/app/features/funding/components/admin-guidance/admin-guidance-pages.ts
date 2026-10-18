export interface AdminGuidanceStep {
  readonly id: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** Existing, fixed data-og7 hook. Showing it must never activate a control. */
  readonly target?: string;
}

export interface AdminGuidancePage {
  readonly id: string;
  readonly path: string;
  readonly titleKey: string;
  readonly steps: readonly AdminGuidanceStep[];
}

function page(
  id: string,
  suffix: string,
  titleKey: string,
  targets: readonly (string | undefined)[] = []
): AdminGuidancePage {
  return {
    id,
    path: '/admin/fundraiser' + suffix,
    titleKey,
    steps: ['read', 'choose', 'verify'].map((step, index) => ({
      id: step,
      titleKey: `admin.guidance.pages.${id}.${step}.title`,
      bodyKey: `admin.guidance.pages.${id}.${step}.body`,
      ...(targets[index] ? { target: targets[index] } : {})
    }))
  };
}

/** Public route and presentation metadata only; never dossier identifiers or commands. */
export const ADMIN_GUIDANCE_PAGES: readonly AdminGuidancePage[] = [
  page('dashboard', '', 'admin.nav.dashboard', [
    'cockpit-metrics',
    'cockpit-systems',
    'cockpit-activity'
  ]),
  page('pilotage', '/pilotage', 'admin.nav.pilotage', [
    'pilot-summary',
    'pilot-details',
    'pilot-receipt'
  ]),
  page('access', '/access', 'admin.access.title', ['admin-access']),
  page('attention', '/attention', 'admin.nav.attention', [
    'attention-panel',
    'attention-items'
  ]),
  page('assistant', '/assistant', 'admin.nav.assistant', [
    'assistant-summary',
    'assistant-recommendations',
    'assistant-state'
  ]),
  page('contributions', '/contributions', 'admin.nav.contributions', [
    'contributions-list',
    'contribution-row'
  ]),
  page('sponsors', '/sponsors', 'admin.nav.sponsors', [
    undefined,
    'sponsorship-dossier'
  ]),
  page('campaigns', '/campaigns', 'admin.nav.campaigns', [
    'campaigns-page',
    'campaigns-filters',
    'campaigns-list'
  ]),
  page('invoices', '/invoices', 'admin.nav.invoices', ['invoice-selection']),
  page('publications', '/publications', 'admin.nav.publications', [
    'publications-page',
    'publication-space'
  ]),
  page(
    'drafts',
    '/publications/drafts',
    'admin.publications.spaces.drafts.title',
    ['publications-page', 'publication-draft']
  ),
  page(
    'batches',
    '/publications/batches',
    'admin.publications.spaces.batches.title',
    ['publications-page', 'publication-batch']
  ),
  page(
    'calendar',
    '/publications/calendar',
    'admin.publications.spaces.calendar.title',
    ['publications-page', 'publication-slot']
  ),
  page(
    'automation',
    '/publications/automation',
    'admin.publicationAutomation.title',
    ['publication-automation', 'publication-feed-settings']
  ),
  page('expenses', '/expenses', 'admin.nav.expenses', [
    'allocation-filters',
    'allocation-card'
  ]),
  page('transparency', '/transparency', 'admin.nav.transparency', [
    'transparency-summary',
    'transparency-allocations',
    'transparency-snapshot'
  ]),
  page('audit', '/audit', 'admin.nav.audit', ['admin-audit', 'audit-entry']),
  page('email', '/email-queue', 'admin.nav.email'),
  page('setup', '/setup', 'admin.nav.settings', [
    'admin-setup',
    'setup-checklist'
  ])
];

/** Match only declared local routes; private query strings and fragments are discarded. */
export function adminGuidancePage(url: string): AdminGuidancePage | undefined {
  const path = url.split(/[?#]/, 1)[0];
  return ADMIN_GUIDANCE_PAGES.find((entry) => entry.path === path);
}
