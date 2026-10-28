import { DEMO_DOSSIERS } from './service-demo-fixtures.js';

/** Shared presentation metadata for the public routes and the embedded workspace. */
export const DEMO_DETAIL_PAGES = [
  {
    path: 'apercu',
    titleKey: 'serviceDemoDetail.titles.preview',
    parent: 'contenu'
  },
  {
    path: 'preuves',
    titleKey: 'serviceDemoDetail.titles.evidence',
    parent: ''
  },
  {
    path: 'accord',
    titleKey: 'serviceDemoDetail.titles.agreement',
    parent: ''
  },
  { path: 'controle', titleKey: 'serviceDemoDetail.titles.check', parent: '' },
  {
    path: 'proposition',
    titleKey: 'serviceDemoDetail.titles.proposal',
    parent: 'corriger/texte'
  },
  {
    path: 'comparer',
    titleKey: 'serviceDemoDetail.titles.compare',
    parent: 'historique'
  },
  {
    path: 'commentaire',
    titleKey: 'serviceDemoDetail.titles.comment',
    parent: 'historique'
  },
  {
    path: 'demander-correction',
    titleKey: 'serviceDemoDetail.titles.requestCorrection',
    parent: 'contenu'
  },
  {
    path: 'demander-accord',
    titleKey: 'serviceDemoDetail.titles.requestAgreement',
    parent: 'autorisation'
  },
  {
    path: 'preuve',
    titleKey: 'serviceDemoDetail.titles.attachment',
    parent: 'autorisation'
  },
  {
    path: 'accord-recu',
    titleKey: 'serviceDemoDetail.titles.receivedAgreement',
    parent: 'autorisation'
  },
  {
    path: 'conditions',
    titleKey: 'serviceDemoDetail.titles.conditions',
    parent: 'autorisation'
  },
  {
    path: 'contact',
    titleKey: 'serviceDemoDetail.titles.contact',
    parent: 'autorisation'
  },
  {
    path: 'planifier',
    titleKey: 'serviceDemoDetail.titles.schedule',
    parent: 'publication'
  },
  {
    path: 'confirmer-envoi',
    titleKey: 'serviceDemoDetail.titles.confirmDelivery',
    parent: 'publication'
  },
  {
    path: 'resultat',
    titleKey: 'serviceDemoDetail.titles.result',
    parent: 'publication'
  },
  {
    path: 'reconcilier',
    titleKey: 'serviceDemoDetail.titles.reconcile',
    parent: 'resultat'
  },
  {
    path: 'attester',
    titleKey: 'serviceDemoDetail.titles.attest',
    parent: 'reconcilier'
  },
  { path: 'web', titleKey: 'serviceDemoDetail.titles.web', parent: '' },
  {
    path: 'confirmer-visibilite',
    titleKey: 'serviceDemoDetail.titles.confirmVisibility',
    parent: 'web'
  },
  {
    path: 'approuver-preparation',
    titleKey: 'serviceDemoDetail.titles.approvePreparation',
    parent: ''
  },
  {
    path: 'autres-actions',
    titleKey: 'serviceDemoDetail.titles.more',
    parent: ''
  },
  {
    path: 'quitter',
    titleKey: 'serviceDemoDetail.titles.leave',
    parent: 'corriger/texte'
  },
  {
    path: 'conflit',
    titleKey: 'serviceDemoDetail.titles.conflict',
    parent: 'corriger/texte'
  },
  {
    path: 'indisponible',
    titleKey: 'serviceDemoDetail.titles.unavailable',
    parent: ''
  },
  {
    path: 'medias',
    titleKey: 'serviceDemoDetail.titles.media',
    parent: 'corriger/image'
  },
  { path: 'guide', titleKey: 'serviceDemoDetail.titles.guide', parent: '' },
  {
    path: 'destinations',
    titleKey: 'serviceDemoDetail.titles.destinations',
    parent: ''
  },
  { path: 'filtres', titleKey: 'serviceDemoDetail.titles.filters', parent: '' },
  {
    path: 'retablir',
    titleKey: 'serviceDemoDetail.titles.restore',
    parent: 'historique'
  },
  {
    path: 'annuler-autorisation',
    titleKey: 'serviceDemoDetail.titles.revoke',
    parent: 'publication'
  },
  {
    path: 'apercu-envoi',
    titleKey: 'serviceDemoDetail.titles.messagePreview',
    parent: 'demander-accord'
  },
  {
    path: 'confirmer-autorisation',
    titleKey: 'serviceDemoDetail.titles.confirmAgreement',
    parent: 'autorisation'
  }
] as const;

export const SERVICE_DEMO_STEPS = [
  'contenu',
  'autorisation',
  'publication'
] as const;
export const SERVICE_DEMO_EDITOR_TABS = [
  'texte',
  'image',
  'liens',
  'mentions',
  'options'
] as const;

export type ServiceDemoPageKind =
  'list' | 'workspace' | 'editor' | 'history' | 'detail' | 'missing';

export const SERVICE_DEMO_LIST_DATA = {
  list: true,
  titleKey: 'serviceDemo.title'
} as const;
export const SERVICE_DEMO_SUMMARY_DATA = {
  page: '',
  titleKey: 'serviceDemo.summary.title'
} as const;
export const SERVICE_DEMO_EDITOR_DATA = {
  page: 'corriger',
  titleKey: 'serviceDemoEditor.title',
  parent: 'contenu',
  icon: 'settings'
} as const;
export const SERVICE_DEMO_HISTORY_DATA = {
  page: 'historique',
  titleKey: 'serviceDemo.history',
  parent: '',
  icon: 'clock'
} as const;
export const SERVICE_DEMO_MISSING_DATA = {
  missing: true,
  titleKey: 'serviceDemo.missingTitle'
} as const;

export function serviceDemoStepData(page: (typeof SERVICE_DEMO_STEPS)[number]) {
  return {
    page,
    titleKey: `serviceDemo.tasks.${page}.title`,
    parent: '',
    icon: page === 'autorisation' ? 'audit' : 'publications'
  };
}

export function serviceDemoPageKind(
  data: Readonly<Record<string, unknown>>
): ServiceDemoPageKind {
  if (data['missing']) return 'missing';
  if (data['list']) return 'list';
  if (data['detail']) return 'detail';
  if (data['page'] === 'corriger') return 'editor';
  if (data['page'] === 'historique') return 'history';
  return 'workspace';
}

/** Resolve only the same synthetic destinations exposed by the standalone feature. */
export function resolveServiceDemoPage(segments: readonly string[]): {
  data: Readonly<Record<string, unknown>>;
  params: Readonly<Record<string, string>>;
} {
  const missing = { data: SERVICE_DEMO_MISSING_DATA, params: {} };
  if (segments[0] !== 'demo' || segments[1] !== 'prestations') return missing;
  const path = segments.slice(2);
  if (!path.length) return { data: SERVICE_DEMO_LIST_DATA, params: {} };
  const id = path[1];
  if (
    path[0] !== 'dossier' ||
    !id ||
    !DEMO_DOSSIERS.some((dossier) => dossier.id === id)
  )
    return missing;
  const params = { id };
  const page = path[2];
  if (path.length === 2) return { data: SERVICE_DEMO_SUMMARY_DATA, params };
  if (path.length === 3) {
    const step = SERVICE_DEMO_STEPS.find((step) => step === page);
    if (step) return { data: serviceDemoStepData(step), params };
    if (page === 'historique')
      return { data: SERVICE_DEMO_HISTORY_DATA, params };
    if (page === 'corriger')
      return {
        data: SERVICE_DEMO_EDITOR_DATA,
        params: { ...params, tab: 'texte' }
      };
    const detail = DEMO_DETAIL_PAGES.find((detail) => detail.path === page);
    if (detail)
      return {
        data: {
          detail: detail.path,
          titleKey: detail.titleKey,
          parent: detail.parent
        },
        params
      };
  }
  if (
    path.length === 4 &&
    page === 'corriger' &&
    SERVICE_DEMO_EDITOR_TABS.some((tab) => tab === path[3])
  )
    return {
      data: SERVICE_DEMO_EDITOR_DATA,
      params: { ...params, tab: path[3]! }
    };
  return missing;
}
