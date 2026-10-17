import type { AdminIconName } from '../components/admin-ui/admin-icon.component.js';

/** Local presentation state; opening the controller never executes an intention. */
export type ControllerMode = 'closed' | 'peek' | 'open';

/** Presentation context only. The page rechecks selection and version before acting. */
export interface ControllerContext {
  readonly key: string;
  readonly targetId: string;
  readonly revision: string;
}

/** An available intention, never an executable business command. */
export interface ControllerAction {
  readonly id: string;
  readonly label: string;
  readonly icon: AdminIconName;
  readonly zone: 'radial' | 'bottom';
  readonly scope: 'selection' | 'workspace';
  readonly tone: 'default' | 'success' | 'info' | 'danger' | 'warning';
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly busy?: boolean;
  readonly disabledReason?: string;
  readonly requiresConfirmation?: boolean;
  readonly shortcut?: {
    readonly label: string;
    readonly tone?: 'a' | 'b' | 'x' | 'y';
  };
}

export interface ControllerActionRequest {
  readonly actionId: string;
  readonly context: ControllerContext;
}
