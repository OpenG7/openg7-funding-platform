import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';

import { ServiceDemoPreviewComponent } from './service-demo-preview.component.js';
import { ServiceDemoActionsDirective } from './service-demo-actions.directive.js';
import { ServiceDemoState } from './service-demo-state.js';

@Component({
  selector: 'openg7-service-demo-workspace',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    ServiceDemoPreviewComponent,
    ServiceDemoActionsDirective
  ],
  templateUrl: './service-demo-workspace.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDemoWorkspaceComponent {
  readonly state = inject(ServiceDemoState);
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data
  });
  readonly page = computed(() => (this.data()['page'] as string) ?? '');
  readonly contentChecks = [
    { key: 'text', target: 'corriger/texte', icon: 'publications' },
    { key: 'image', target: 'corriger/image', icon: 'mountain' },
    { key: 'link', target: 'corriger/liens', icon: 'arrow' },
    { key: 'mentions', target: 'corriger/mentions', icon: 'sponsors' }
  ] as const;
  readonly authorizationChecks = [
    { key: 'consent', target: 'accord-recu', icon: 'email' },
    { key: 'conditions', target: 'conditions', icon: 'publications' },
    { key: 'contact', target: 'contact', icon: 'sponsors' }
  ] as const;
  readonly publicationChecks = [
    { key: 'destination', target: 'destinations', icon: 'cloud' },
    { key: 'version', target: 'apercu', icon: 'publications' },
    { key: 'schedule', target: 'planifier', icon: 'clock' }
  ] as const;
}
