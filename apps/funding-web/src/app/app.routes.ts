import { CanMatchFn, Routes } from '@angular/router';

import { ApiKeysPageComponent } from './features/funding/pages/api-keys-page/api-keys-page.component.js';
import { EcosystemPageComponent } from './features/funding/pages/ecosystem-page/ecosystem-page.component.js';
import { FundingAboutPageComponent } from './features/funding/pages/funding-about-page/funding-about-page.component.js';
import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';
import { FundingTransparencyPageComponent } from './features/funding/pages/funding-transparency-page/funding-transparency-page.component.js';
import { MusicPageComponent } from './features/funding/pages/music-page/music-page.component.js';
import { StripeSetupPageComponent } from './features/funding/pages/stripe-setup-page/stripe-setup-page.component.js';
import { SupportPageComponent } from './features/funding/pages/support-page/support-page.component.js';
import { WebhooksPageComponent } from './features/funding/pages/webhooks-page/webhooks-page.component.js';

const localDevelopmentOnly: CanMatchFn = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const appRoutes: Routes = [
  {
    path: '',
    component: FundingPageComponent
  },
  {
    path: 'fonds-des-batisseurs/a-propos',
    component: FundingAboutPageComponent
  },
  {
    path: 'ecosystem',
    component: EcosystemPageComponent
  },
  {
    path: 'music',
    component: MusicPageComponent
  },
  {
    path: 'fonds-des-batisseurs/transparence',
    component: FundingTransparencyPageComponent
  },
  {
    path: 'support',
    component: SupportPageComponent
  },
  {
    path: 'dev/stripe-setup',
    canMatch: [localDevelopmentOnly],
    component: StripeSetupPageComponent
  },
  {
    path: 'dev/webhooks',
    canMatch: [localDevelopmentOnly],
    component: WebhooksPageComponent
  },
  {
    path: 'dev/api-keys',
    canMatch: [localDevelopmentOnly],
    component: ApiKeysPageComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];