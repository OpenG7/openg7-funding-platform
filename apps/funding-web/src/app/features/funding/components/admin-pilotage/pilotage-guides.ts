import type { AdminGuideStep } from '../admin-guide/admin-guide.component.js';

export const PILOTAGE_GUIDE: readonly AdminGuideStep[] = [
  { id: 'automation', target: 'pilot-automation' },
  { id: 'domains', target: 'pilot-domains' },
  { id: 'decision', target: 'pilot-decision' },
  { id: 'summary', target: 'pilot-summary' },
  { id: 'details', target: 'pilot-details' },
  { id: 'actions', target: 'pilot-actions' },
  { id: 'queue', target: 'pilot-queue' },
  { id: 'week', target: 'open-programme' },
  { id: 'calendar', target: 'pilot-calendar' },
  { id: 'controller', target: 'pilot-controller' }
];

export const PROGRAMME_GUIDE: readonly AdminGuideStep[] = [
  { id: 'brief', target: 'programme-brief' },
  { id: 'calendar', target: 'programme-compose' },
  { id: 'rehearsal', target: 'programme-rehearsal-title' },
  { id: 'editorial', target: 'programme-instruction' },
  { id: 'memory', target: 'programme-memory' },
  { id: 'incidents', target: 'programme-incidents' }
];
