import type { AdminPreparationReceiptData } from '@openg7/funding-core';

import type {
  ControllerAction,
  ControllerContext
} from '../../models/context-controller.models.js';
import { automaticAdminUrl } from '../admin-automatic/admin-automatic-run.js';

import type { PreparationContextActionsInput } from './preparation-pilot.models.js';

/** Intentions open existing forms or confirmations; this module has no mutation port. */
export function preparationContextActions(
  input: PreparationContextActionsInput
): readonly ControllerAction[] {
  const { receipt, issue, t } = input;
  const available = !!receipt && !input.busy;
  const action = (
    id: string,
    label: string,
    icon: ControllerAction['icon'],
    enabled: boolean,
    shortcut: 'a' | 'b' | 'x' | 'y',
    requiresConfirmation = false
  ): ControllerAction => ({
    id,
    label,
    icon,
    zone: 'radial',
    scope: 'selection',
    tone: requiresConfirmation ? 'success' : 'default',
    enabled: available && enabled,
    visible: true,
    busy: input.busy,
    requiresConfirmation,
    disabledReason: available && enabled ? undefined : t('pilot.unavailable'),
    shortcut: { label: shortcut.toUpperCase(), tone: shortcut }
  });
  const primary = issue
    ? action(
        'preparation-open',
        t('pilot.actions.' + issue.actionKind),
        issue.actionKind === 'moderation' ? 'audit' : 'publications',
        !!issue.adminUrl && !!automaticAdminUrl(issue.adminUrl),
        'a'
      )
    : receipt && receipt.status !== 'approved'
      ? action(
          'preparation-approve',
          t('pilot.actions.approve'),
          'check',
          input.canApprove && receipt.canApprove,
          'a',
          true
        )
      : null;
  return [
    ...(primary ? [primary] : []),
    action(
      'preparation-details',
      t('pilot.actions.details'),
      'search',
      true,
      'x'
    ),
    action(
      'preparation-history',
      t('pilot.actions.history'),
      'clock',
      true,
      'y'
    ),
    action('preparation-back', t('pilot.actions.back'), 'close', true, 'b')
  ];
}

export function preparationControllerContext(
  receipt: AdminPreparationReceiptData | null,
  issueId: string | null
): ControllerContext | null {
  return receipt
    ? {
        key: issueId ?? 'preparation',
        targetId: receipt.contributionId,
        revision: receipt.version
      }
    : null;
}

/** Delayed gestures cannot act on a different issue, dossier or receipt version. */
export function matchesPreparationControllerContext(
  current: ControllerContext | null,
  requested: ControllerContext
): boolean {
  return (
    !!current &&
    current.key === requested.key &&
    current.targetId === requested.targetId &&
    current.revision === requested.revision
  );
}
