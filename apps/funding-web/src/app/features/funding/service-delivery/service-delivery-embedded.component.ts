import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  viewChild
} from '@angular/core';

import { ServiceDemoShellComponent } from './service-demo-shell.component.js';
import {
  SERVICE_DEMO_EMBEDDED,
  ServiceDemoNavigation
} from './service-demo-navigation.js';
import { DEMO_DOSSIERS, ServiceDemoState } from './service-demo-state.js';

/** Public, browser-local workspace; its navigation never changes the host router. */
@Component({
  selector: 'openg7-service-delivery-embedded',
  standalone: true,
  imports: [ServiceDemoShellComponent],
  providers: [
    ServiceDemoState,
    ServiceDemoNavigation,
    { provide: SERVICE_DEMO_EMBEDDED, useValue: true }
  ],
  host: {
    class: 'service-delivery-embedded',
    'data-og7': 'service-delivery-embedded'
  },
  template:
    '<openg7-service-demo-shell (closeRequested)="closeRequested.emit()" />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDeliveryEmbeddedComponent {
  readonly closeRequested = output<void>();
  readonly hasLocalWork = inject(ServiceDemoState).hasLocalWork;
  private readonly navigation = inject(ServiceDemoNavigation);
  private readonly shell = viewChild(ServiceDemoShellComponent);

  canLeave(): boolean | Promise<boolean> {
    return this.shell()?.canLeave() ?? true;
  }

  cancelLeave(): void {
    this.shell()?.answerExit(false);
  }

  /** Accept only a known synthetic file and keep the host router untouched. */
  openDossier(id: string): boolean {
    if (!DEMO_DOSSIERS.some((dossier) => dossier.id === id)) return false;
    void this.navigation.navigate(['/demo/prestations/dossier', id]);
    return true;
  }
}
