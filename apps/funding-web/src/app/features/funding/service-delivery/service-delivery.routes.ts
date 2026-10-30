import { Component, inject } from '@angular/core';
import { Routes } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DEMO_DETAIL_PAGES,
  ServiceDemoDetailComponent
} from './service-demo-detail.component.js';
import { ServiceDemoEditorComponent } from './service-demo-editor.component.js';
import { ServiceDemoHistoryComponent } from './service-demo-history.component.js';
import { ServiceDemoListComponent } from './service-demo-list.component.js';
import { ServiceDemoShellComponent } from './service-demo-shell.component.js';
import { DEMO_DOSSIERS, ServiceDemoState } from './service-demo-state.js';
import { ServiceDemoWorkspaceComponent } from './service-demo-workspace.component.js';
import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';
import { ServiceDemoNavigation } from './service-demo-navigation.js';
import {
  SERVICE_DEMO_STEPS,
  SERVICE_DEMO_EDITOR_TABS,
  SERVICE_DEMO_LIST_DATA,
  SERVICE_DEMO_SUMMARY_DATA,
  SERVICE_DEMO_EDITOR_DATA,
  SERVICE_DEMO_HISTORY_DATA,
  SERVICE_DEMO_MISSING_DATA,
  serviceDemoStepData
} from './service-demo-pages.js';

@Component({
  selector: 'openg7-service-demo-missing',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `<section class="empty-state" data-og7="service-demo-missing">
    <p>{{ 'serviceDemo.missingHint' | translate }}</p>
    <a
      class="button primary"
      routerLink="/demo/prestations"
      queryParamsHandling="preserve"
      >{{ 'serviceDemo.backList' | translate }}</a
    >
  </section>`
})
class ServiceDemoMissingComponent {}

const steps: Routes = SERVICE_DEMO_STEPS.map((page) => ({
  path: page,
  component: ServiceDemoWorkspaceComponent,
  data: serviceDemoStepData(page)
}));

export const serviceDeliveryRoutes: Routes = [
  {
    path: '',
    component: ServiceDemoShellComponent,
    providers: [ServiceDemoState, ServiceDemoNavigation],
    canDeactivate: [
      (component: ServiceDemoShellComponent) => component.canLeave()
    ],
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: ServiceDemoListComponent,
        data: SERVICE_DEMO_LIST_DATA
      },
      {
        path: 'dossier/:id',
        canMatch: [
          (_route, segments) =>
            DEMO_DOSSIERS.some((item) => item.id === segments[1]?.path)
        ],
        canActivate: [
          (route) => {
            inject(ServiceDemoState).selectDossier(
              route.paramMap.get('id') ?? ''
            );
            return true;
          }
        ],
        children: [
          {
            path: '',
            pathMatch: 'full',
            component: ServiceDemoWorkspaceComponent,
            data: SERVICE_DEMO_SUMMARY_DATA
          },
          ...steps,
          { path: 'corriger', pathMatch: 'full', redirectTo: 'corriger/texte' },
          {
            path: 'corriger/:tab',
            canMatch: [
              (_route, segments) =>
                SERVICE_DEMO_EDITOR_TABS.some(
                  (tab) => tab === segments[1]?.path
                )
            ],
            component: ServiceDemoEditorComponent,
            data: SERVICE_DEMO_EDITOR_DATA
          },
          {
            path: 'historique',
            component: ServiceDemoHistoryComponent,
            data: SERVICE_DEMO_HISTORY_DATA
          },
          ...DEMO_DETAIL_PAGES.map((detail) => ({
            path: detail.path,
            component: ServiceDemoDetailComponent,
            data: {
              detail: detail.path,
              titleKey: detail.titleKey,
              parent: detail.parent
            }
          }))
        ]
      },
      {
        path: '**',
        component: ServiceDemoMissingComponent,
        data: SERVICE_DEMO_MISSING_DATA
      }
    ]
  }
];
