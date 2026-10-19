import type { AdminPreparationReceiptData } from '@openg7/funding-core';
import {
  preparationAssistanceActions,
  type PreparationAssistanceSummary
} from '@openg7/funding-core';

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
    shortcut: 'a' | 'b' | 'x' | 'y' | undefined
  ): ControllerAction => ({
    id,
    label,
    icon,
    zone: 'radial',
    scope: 'selection',
    tone: 'default',
    enabled: available && enabled,
    visible: true,
    busy: input.busy,
    requiresConfirmation: false,
    disabledReason: available && enabled ? undefined : t('pilot.unavailable'),
    shortcut: shortcut
      ? { label: shortcut.toUpperCase(), tone: shortcut }
      : undefined
  });
  const assisted =
    !!input.canAssist &&
    issue?.checkCode === 'accepted_offer' &&
    input.assistanceSummary?.contributionId === receipt?.contributionId;
  const assistanceActions = assisted
    ? preparationAssistanceActions(input.assistanceSummary ?? null, {
        permitted: !!input.canAssist,
        busy: input.busy || !!input.assistanceBusy
      }).map((descriptor) => ({
        ...action(
          'preparation-assistance-' + descriptor.id,
          t('pilot.assistance.actions.' + descriptor.id),
          descriptor.id === 'rerun' ? 'refresh' : 'search',
          descriptor.enabled,
          descriptor.id === 'review'
            ? 'a'
            : descriptor.id === 'source'
              ? 'x'
              : 'y'
        ),
        busy: input.busy || input.assistanceBusy,
        disabledReason: descriptor.disabledReason
          ? t('pilot.assistance.disabled.' + descriptor.disabledReason)
          : undefined
      }))
    : [];
  const review = assistanceActions.find(
    (entry) => entry.id === 'preparation-assistance-review' && entry.enabled
  );
  const primary =
    review ??
    (issue
      ? action(
          'preparation-open',
          t('pilot.actions.' + issue.actionKind),
          issue.actionKind === 'moderation' ? 'audit' : 'publications',
          !!issue.adminUrl && !!automaticAdminUrl(issue.adminUrl),
          'a'
        )
      : null);
  return [
    ...(primary ? [primary] : []),
    ...assistanceActions
      .filter((entry) => entry !== review)
      .map((entry) =>
        entry.id === 'preparation-assistance-review'
          ? { ...entry, shortcut: undefined }
          : entry
      ),
    ...(input.detailsMode === 'hidden'
      ? []
      : [
          action(
            input.detailsMode === 'campaigns'
              ? 'preparation-campaigns'
              : 'preparation-details',
            t(
              input.detailsMode === 'campaigns'
                ? 'pilot.actions.campaigns'
                : 'pilot.actions.details'
            ),
            'search',
            true,
            assisted ? undefined : 'x'
          )
        ]),
    action(
      'preparation-history',
      t('pilot.actions.history'),
      'clock',
      true,
      assisted ? undefined : 'y'
    ),
    action('preparation-back', t('pilot.actions.back'), 'close', true, 'b')
  ];
}

export function preparationControllerContext(
  receipt: AdminPreparationReceiptData | null,
  issueId: string | null,
  summary: PreparationAssistanceSummary | null = null
): ControllerContext | null {
  return receipt
    ? {
        key: issueId ?? 'preparation',
        targetId: receipt.contributionId,
        revision:
          summary?.contributionId === receipt.contributionId &&
          issueId === 'check:' + summary.controlCode
            ? receipt.version + ':' + summary.revision
            : receipt.version
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
