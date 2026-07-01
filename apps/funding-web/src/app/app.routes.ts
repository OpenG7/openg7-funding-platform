import { Routes } from '@angular/router';

import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';
import { FundingTransparencyPageComponent } from './features/funding/pages/funding-transparency-page/funding-transparency-page.component.js';

export const appRoutes: Routes = [
  {
    path: '',
    component: FundingPageComponent
  },
  {
    path: 'fonds-des-batisseurs/transparence',
    component: FundingTransparencyPageComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];