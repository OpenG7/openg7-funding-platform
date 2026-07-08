import { CanMatchFn, Routes } from '@angular/router';

import { AdminSponsorsPageComponent } from './features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.js';
import { ApiKeysPageComponent } from './features/funding/pages/api-keys-page/api-keys-page.component.js';
import { BuildersPageComponent } from './features/funding/pages/builders-page/builders-page.component.js';
import { BoutiquePageComponent } from './features/funding/pages/boutique-page/boutique-page.component.js';
import { EcosystemPageComponent } from './features/funding/pages/ecosystem-page/ecosystem-page.component.js';
import { FundingAboutPageComponent } from './features/funding/pages/funding-about-page/funding-about-page.component.js';
import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';
import { FundingTransparencyPageComponent } from './features/funding/pages/funding-transparency-page/funding-transparency-page.component.js';
import { MusicPageComponent } from './features/funding/pages/music-page/music-page.component.js';
import { SponsorshipFollowupPageComponent } from './features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.js';
import { StripeSetupPageComponent } from './features/funding/pages/stripe-setup-page/stripe-setup-page.component.js';
import { SupportPageComponent } from './features/funding/pages/support-page/support-page.component.js';
import { WebhooksPageComponent } from './features/funding/pages/webhooks-page/webhooks-page.component.js';

const localDevelopmentOnly: CanMatchFn = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

const publicRoutes: Routes = [
  {
    path: '',
    component: FundingPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'fonds-des-batisseurs',
    component: FundingPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'fonds-des-batisseurs/a-propos',
    component: FundingAboutPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'ecosystem',
    component: EcosystemPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'music',
    component: MusicPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'boutique',
    component: BoutiquePageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'batisseurs',
    component: BuildersPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'fonds-des-batisseurs/transparence',
    component: FundingTransparencyPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'fonds-des-batisseurs/suivi-commandite',
    component: SponsorshipFollowupPageComponent,
    data: { language: 'fr-CA' }
  },
  {
    path: 'support',
    component: SupportPageComponent,
    data: { language: 'fr-CA' }
  }
];

const englishPublicRoutes: Routes = publicRoutes.map((route) => ({
  ...route,
  path: route.path ? `en/${route.path}` : 'en',
  data: { ...route.data, language: 'en' }
}));

export const appRoutes: Routes = [
  ...publicRoutes,
  ...englishPublicRoutes,
  {
    path: 'admin/fundraiser/sponsors',
    component: AdminSponsorsPageComponent
  },
  {
    path: 'en/**',
    redirectTo: 'en'
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
