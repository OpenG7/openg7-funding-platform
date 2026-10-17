import type { PilotDecision } from '@openg7/funding-core';

import type { ControllerProfile } from '../../components/admin-pilotage/controller-input.js';
import type {
  ControllerAction,
  ControllerContext
} from '../../models/context-controller.models.js';

type DecisionAction = PilotDecision['actions'][number];
export interface PilotageControllerActionsInput {
  readonly decision: PilotDecision | null;
  readonly primary: DecisionAction | undefined;
  readonly reject: DecisionAction | undefined;
  readonly editable: DecisionAction | undefined;
  readonly blocked: boolean;
  readonly busy: boolean;
  readonly bindings: ControllerProfile['bindings'] | null;
  readonly labels: Record<
    'accept' | 'reject' | 'edit' | 'details' | 'unavailable',
    string
  >;
  readonly blockedReason: string;
  readonly explain: (code: string) => string;
}

/** Projects existing availability; it neither creates commands nor grants permission. */
export function pilotageControllerActions(
  input: PilotageControllerActionsInput
): readonly ControllerAction[] {
  const shortcut = (intent: keyof ControllerProfile['bindings']) => {
    const index = input.bindings?.[intent];
    return index === undefined
      ? undefined
      : {
          label: ['A', 'B', 'X', 'Y'][index]!,
          tone: (['a', 'b', 'x', 'y'] as const)[index]!
        };
  };
  const decisionAction = (
    id: string,
    label: string,
    icon: ControllerAction['icon'],
    tone: ControllerAction['tone'],
    intent: keyof ControllerProfile['bindings'],
    available: DecisionAction | undefined,
    requiresConfirmation = false
  ): ControllerAction => {
    const enabled =
      !!input.decision &&
      !input.blocked &&
      !input.busy &&
      !!available &&
      !available.blocked;
    return {
      id,
      label,
      icon,
      zone: 'radial',
      scope: 'selection',
      tone,
      enabled,
      visible: true,
      busy: input.busy,
      requiresConfirmation,
      disabledReason: enabled
        ? undefined
        : available?.blocked
          ? input.explain(available.blocked)
          : input.blocked
            ? input.blockedReason
            : input.labels.unavailable,
      shortcut: shortcut(intent)
    };
  };
  return [
    decisionAction(
      'pilot-accept',
      input.labels.accept,
      'check',
      'success',
      'primary',
      input.primary,
      true
    ),
    decisionAction(
      'pilot-reject',
      input.labels.reject,
      'close',
      'danger',
      'secondary',
      input.reject,
      true
    ),
    decisionAction(
      'pilot-edit',
      input.labels.edit,
      'settings',
      'info',
      'edit',
      input.editable
    ),
    {
      id: 'pilot-details',
      label: input.labels.details,
      icon: 'publications',
      zone: 'radial',
      scope: 'selection',
      tone: 'warning',
      enabled: !!input.decision && !input.busy,
      visible: true,
      busy: input.busy,
      shortcut: shortcut('details')
    }
  ];
}

export interface PilotageDeckActionsInput {
  readonly decision: PilotDecision | null;
  readonly busy: boolean;
  readonly canNavigate: boolean;
  readonly hasFollowing: boolean;
  readonly labels: Record<
    'home' | 'previous' | 'next' | 'record' | 'queue' | 'diagnostics',
    string
  >;
}

/** Navigation intentions reuse the same native control as the decision rail. */
export function pilotageDeckActions(
  input: PilotageDeckActionsInput
): readonly ControllerAction[] {
  const action = (
    id: string,
    label: string,
    icon: ControllerAction['icon'],
    scope: ControllerAction['scope'],
    enabled: boolean,
    shortcut?: string
  ): ControllerAction => ({
    id,
    label,
    icon,
    scope,
    zone: 'bottom',
    tone: 'default',
    enabled: enabled && !input.busy,
    visible: true,
    busy: input.busy,
    shortcut: shortcut ? { label: shortcut } : undefined
  });
  return [
    action('pilot-home', input.labels.home, 'dashboard', 'workspace', true),
    action(
      'pilot-previous',
      input.labels.previous,
      'arrow',
      'selection',
      input.canNavigate,
      'LB'
    ),
    action(
      'pilot-next',
      input.labels.next,
      'arrow',
      'selection',
      input.canNavigate,
      'RB'
    ),
    action(
      'pilot-open-record',
      input.labels.record,
      'publications',
      'selection',
      !!input.decision?.detailsUrl
    ),
    action(
      'pilot-queue',
      input.labels.queue,
      'menu',
      'workspace',
      input.hasFollowing
    ),
    action(
      'pilot-diagnostics',
      input.labels.diagnostics,
      'settings',
      'workspace',
      true
    )
  ];
}

export function pilotageControllerContext(
  decision: PilotDecision | null
): ControllerContext | null {
  return decision
    ? {
        key: decision.id,
        targetId: decision.targetId,
        revision: decision.version
      }
    : null;
}

/** A delayed intention must still belong to the exact decision that produced it. */
export function matchesControllerContext(
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
