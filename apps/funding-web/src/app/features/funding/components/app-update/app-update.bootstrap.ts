import { ApplicationRef, ViewContainerRef, isDevMode } from '@angular/core';

import { AppUpdateComponent } from './app-update.component.js';

/** Loaded after browser bootstrap, keeping the optional notice out of SSR. */
export function mountAppUpdate(app: ApplicationRef): void {
  if (isDevMode() || app.destroyed) return;
  const host = app.components[0].injector.get(ViewContainerRef);
  const component = host.createComponent(AppUpdateComponent);
  component.changeDetectorRef.markForCheck();
  app.onDestroy(() => {
    component.destroy();
  });
}
