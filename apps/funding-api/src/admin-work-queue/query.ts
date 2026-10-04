import type {
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery
} from '@openg7/funding-core';

import { WORK_QUEUE_PRIORITIES, WORK_QUEUE_TYPES } from './contracts.js';

export const parseWorkQueueQuery = (
  params: URLSearchParams
): AdminWorkQueueQuery => {
  const integer = (key: string, fallback: number, max: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)
      throw new Error('Invalid queue query');
    return Number(raw);
  };
  const type = params.get('type') || undefined;
  const priority = params.get('priority') || undefined;
  const due = params.get('due') || 'all';
  const itemId = params.get('itemId') || undefined;
  const emailTemplate = params.get('emailTemplate') || undefined;
  const emailError = params.get('emailError') || undefined;
  const overview = params.get('overview');
  if (
    (type && !WORK_QUEUE_TYPES.includes(type as AdminAttentionItemType)) ||
    (priority &&
      !WORK_QUEUE_PRIORITIES.includes(priority as AdminAttentionSeverity)) ||
    !['all', 'today', 'overdue', 'this_week', 'undated'].includes(due) ||
    (itemId && itemId.length > 200) ||
    (emailTemplate && !/^[a-zA-Z0-9_-]{1,100}$/.test(emailTemplate)) ||
    (emailError &&
      ![
        'inconnue',
        'authentification',
        'destinataire_rejeté',
        'connexion',
        'autre'
      ].includes(emailError)) ||
    (overview !== null && overview !== 'true' && overview !== 'false')
  ) {
    throw new Error('Invalid queue query');
  }
  return {
    page: integer('page', 1, 1000000),
    pageSize: integer('pageSize', 25, 100),
    type: type as AdminWorkQueueQuery['type'],
    priority: priority as AdminWorkQueueQuery['priority'],
    due: due as AdminWorkQueueQuery['due'],
    itemId,
    ...(overview !== null ? { overview: overview === 'true' } : {}),
    ...(emailTemplate ? { emailTemplate } : {}),
    ...(emailError ? { emailError } : {})
  };
};
