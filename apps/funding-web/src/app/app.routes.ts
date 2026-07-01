import { CanMatchFn, Routes } from '@angular/router';

import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';
import { FundingTransparencyPageComponent } from './features/funding/pages/funding-transparency-page/funding-transparency-page.component.js';
import { StripeSetupPageComponent } from './features/funding/pages/stripe-setup-page/stripe-setup-page.component.js';

const localDevelopmentOnly: CanMatchFn = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

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
    path: 'dev/stripe-setup',
    canMatch: [localDevelopmentOnly],
    component: StripeSetupPageComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];