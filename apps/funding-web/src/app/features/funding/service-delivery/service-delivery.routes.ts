import { Component, inject } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';
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

@Component({
  selector: 'openg7-service-demo-missing',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `<section class="empty-state" data-og7="service-demo-missing">
    <p>{{ 'serviceDemo.missingHint' | translate }}</p>
    <a class="button primary" routerLink="/demo/prestations">{{
      'serviceDemo.backList' | translate
    }}</a>
  </section>`
})
class ServiceDemoMissingComponent {}

const steps: Routes = ['contenu', 'autorisation', 'publication'].map(
  (page) => ({
    path: page,
    component: ServiceDemoWorkspaceComponent,
    data: {
      page,
      titleKey: `serviceDemo.tasks.${page}.title`,
      parent: '',
      icon: page === 'autorisation' ? 'audit' : 'publications'
    }
  })
);

export const serviceDeliveryRoutes: Routes = [
  {
    path: '',
    component: ServiceDemoShellComponent,
    providers: [ServiceDemoState],
    canDeactivate: [
      (component: ServiceDemoShellComponent) => component.canLeave()
    ],
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: ServiceDemoListComponent,
        data: { list: true, titleKey: 'serviceDemo.title' }
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
            data: { page: '', titleKey: 'serviceDemo.summary.title' }
          },
          ...steps,
          { path: 'corriger', pathMatch: 'full', redirectTo: 'corriger/texte' },
          {
            path: 'corriger/:tab',
            canMatch: [
              (_route, segments) =>
                ['texte', 'image', 'liens', 'mentions', 'options'].includes(
                  segments[1]?.path ?? ''
                )
            ],
            component: ServiceDemoEditorComponent,
            data: {
              page: 'corriger',
              titleKey: 'serviceDemoEditor.title',
              parent: 'contenu',
              icon: 'settings'
            }
          },
          {
            path: 'historique',
            component: ServiceDemoHistoryComponent,
            data: {
              page: 'historique',
              titleKey: 'serviceDemo.history',
              parent: '',
              icon: 'clock'
            }
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
        data: { missing: true, titleKey: 'serviceDemo.missingTitle' }
      }
    ]
  }
];
