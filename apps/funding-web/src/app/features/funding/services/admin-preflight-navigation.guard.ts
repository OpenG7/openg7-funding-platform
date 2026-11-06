import type { CanDeactivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

export interface PreflightDepartureOwner {
  canLeave(): boolean | Promise<boolean>;
}

/** Query-only next/back transitions still protect the exact preparation's unsaved entries. */
export const adminPreflightNavigationGuard: CanDeactivateFn<
  PreflightDepartureOwner
> = (component, current, state, next) => {
  const router = inject(Router);
  const target = router.parseUrl(next.url);
  const path = (value: string) => value.split('?')[0]?.split('#')[0];
  if (
    path(state.url) === path(next.url) &&
    ['sponsorshipId', 'obligationId', 'view', 'workSession'].every(
      (key) =>
        (current.queryParams[key] ?? '') === (target.queryParams[key] ?? '')
    )
  )
    return true; // Recording an accepted version/session id does not leave this preparation.
  return component.canLeave();
};
