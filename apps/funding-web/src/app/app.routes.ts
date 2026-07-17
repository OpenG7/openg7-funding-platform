import { inject } from '@angular/core';
import { CanMatchFn, Router, Routes } from '@angular/router';

import { AdminAuditPageComponent } from './features/funding/pages/admin-audit-page/admin-audit-page.component.js';
import { AdminContributionsPageComponent } from './features/funding/pages/admin-contributions-page/admin-contributions-page.component.js';
import { AdminDashboardPageComponent } from './features/funding/pages/admin-dashboard-page/admin-dashboard-page.component.js';
import { AdminExpensesPageComponent } from './features/funding/pages/admin-expenses-page/admin-expenses-page.component.js';
import { AdminLoginPageComponent } from './features/funding/pages/admin-login-page/admin-login-page.component.js';
import { AdminPublicationsPageComponent } from './features/funding/pages/admin-publications-page/admin-publications-page.component.js';
import { AdminSetupPageComponent } from './features/funding/pages/admin-setup-page/admin-setup-page.component.js';
import { AdminSponsorsPageComponent } from './features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.js';
import { AdminTransparencyPageComponent } from './features/funding/pages/admin-transparency-page/admin-transparency-page.component.js';
import { ApiKeysPageComponent } from './features/funding/pages/api-keys-page/api-keys-page.component.js';
import { BuildersPageComponent } from './features/funding/pages/builders-page/builders-page.component.js';
import { BoutiquePageComponent } from './features/funding/pages/boutique-page/boutique-page.component.js';
import { EcosystemPageComponent } from './features/funding/pages/ecosystem-page/ecosystem-page.component.js';
import { FundingAboutPageComponent } from './features/funding/pages/funding-about-page/funding-about-page.component.js';
import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';
import { FundingTransparencyPageComponent } from './features/funding/pages/funding-transparency-page/funding-transparency-page.component.js';
import { MusicPageComponent } from './features/funding/pages/music-page/music-page.component.js';
import { SponsorshipFollowupPageComponent } from './features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.js';
import { SponsorsPageComponent } from './features/funding/pages/sponsors-page/sponsors-page.component.js';
import { StripeSetupPageComponent } from './features/funding/pages/stripe-setup-page/stripe-setup-page.component.js';
import { SupportPageComponent } from './features/funding/pages/support-page/support-page.component.js';
import { UsageRefundPolicyPageComponent } from './features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.js';
import { WebhooksPageComponent } from './features/funding/pages/webhooks-page/webhooks-page.component.js';
import { FundingAdminService } from './features/funding/services/funding-admin.service.js';

const localDevelopmentOnly: CanMatchFn = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

const adminSessionRequired: CanMatchFn = (_route, segments) => {
  const admin = inject(FundingAdminService);
  if (admin.hasValidAdminSession()) {
    return true;
  }

  const returnUrl = `/${segments.map((segment) => segment.path).join('/')}`;
  return inject(Router).createUrlTree(['/admin/login'], {
    queryParams: {
      returnUrl: returnUrl || '/admin/fundraiser'
    }
  });
};

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
    path: 'commanditaires',
    component: SponsorsPageComponent,
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
  },
  {
    path: 'politique-utilisation-remboursement',
    component: UsageRefundPolicyPageComponent,
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
    path: 'admin/login',
    component: AdminLoginPageComponent
  },
  {
    path: 'admin/fundraiser',
    canMatch: [adminSessionRequired],
    component: AdminDashboardPageComponent
  },
  {
    path: 'admin/fundraiser/contributions',
    canMatch: [adminSessionRequired],
    component: AdminContributionsPageComponent
  },
  {
    path: 'admin/fundraiser/sponsors',
    canMatch: [adminSessionRequired],
    component: AdminSponsorsPageComponent
  },
  {
    path: 'admin/fundraiser/publications',
    canMatch: [adminSessionRequired],
    component: AdminPublicationsPageComponent
  },
  {
    path: 'admin/fundraiser/expenses',
    canMatch: [adminSessionRequired],
    component: AdminExpensesPageComponent
  },
  {
    path: 'admin/fundraiser/transparency',
    canMatch: [adminSessionRequired],
    component: AdminTransparencyPageComponent
  },
  {
    path: 'admin/fundraiser/audit',
    canMatch: [adminSessionRequired],
    component: AdminAuditPageComponent
  },
  {
    path: 'admin/fundraiser/setup',
    canMatch: [adminSessionRequired],
    component: AdminSetupPageComponent
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
