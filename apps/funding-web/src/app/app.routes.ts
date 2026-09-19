import { CanMatchFn, Routes } from '@angular/router';

import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';

const localDevelopmentOnly: CanMatchFn = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

const publicRoutes: Routes = [
  {
    path: '404',
    loadComponent: () =>
      import('./features/funding/pages/not-found-page/not-found-page.component.js').then(
        (m) => m.NotFoundPageComponent
      ),
    data: { language: 'fr-CA' }
  },
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
    loadComponent: () =>
      import('./features/funding/pages/funding-about-page/funding-about-page.component.js').then(
        (m) => m.FundingAboutPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'ecosystem',
    loadComponent: () =>
      import('./features/funding/pages/ecosystem-page/ecosystem-page.component.js').then(
        (m) => m.EcosystemPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'music',
    loadComponent: () =>
      import('./features/funding/pages/music-page/music-page.component.js').then(
        (m) => m.MusicPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'boutique',
    loadComponent: () =>
      import('./features/funding/pages/boutique-page/boutique-page.component.js').then(
        (m) => m.BoutiquePageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'batisseurs',
    loadComponent: () =>
      import('./features/funding/pages/builders-page/builders-page.component.js').then(
        (m) => m.BuildersPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'commanditaires',
    loadComponent: () =>
      import('./features/funding/pages/sponsors-page/sponsors-page.component.js').then(
        (m) => m.SponsorsPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'fonds-des-batisseurs/transparence',
    loadComponent: () =>
      import('./features/funding/pages/funding-transparency-page/funding-transparency-page.component.js').then(
        (m) => m.FundingTransparencyPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'fonds-des-batisseurs/suivi-commandite',
    loadComponent: () =>
      import('./features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.js').then(
        (m) => m.SponsorshipFollowupPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'support',
    loadComponent: () =>
      import('./features/funding/pages/support-page/support-page.component.js').then(
        (m) => m.SupportPageComponent
      ),
    data: { language: 'fr-CA' }
  },
  {
    path: 'politique-utilisation-remboursement',
    loadComponent: () =>
      import('./features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.js').then(
        (m) => m.UsageRefundPolicyPageComponent
      ),
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
    path: 'admin',
    loadChildren: () => import('./admin.routes.js').then((m) => m.adminRoutes)
  },
  {
    path: 'en/**',
    loadComponent: () =>
      import('./features/funding/pages/not-found-page/not-found-page.component.js').then(
        (m) => m.NotFoundPageComponent
      ),
    data: { language: 'en' }
  },
  {
    path: 'dev/stripe-setup',
    canMatch: [localDevelopmentOnly],
    loadComponent: () =>
      import('./features/funding/pages/stripe-setup-page/stripe-setup-page.component.js').then(
        (m) => m.StripeSetupPageComponent
      )
  },
  {
    path: 'dev/webhooks',
    canMatch: [localDevelopmentOnly],
    loadComponent: () =>
      import('./features/funding/pages/webhooks-page/webhooks-page.component.js').then(
        (m) => m.WebhooksPageComponent
      )
  },
  {
    path: 'dev/api-keys',
    canMatch: [localDevelopmentOnly],
    loadComponent: () =>
      import('./features/funding/pages/api-keys-page/api-keys-page.component.js').then(
        (m) => m.ApiKeysPageComponent
      )
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/funding/pages/not-found-page/not-found-page.component.js').then(
        (m) => m.NotFoundPageComponent
      ),
    data: { language: 'fr-CA' }
  }
];
