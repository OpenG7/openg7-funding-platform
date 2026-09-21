import { inject } from '@angular/core';
import { CanMatchFn, Router, Routes } from '@angular/router';

import { FundingAdminService } from './features/funding/services/funding-admin.service.js';

const adminSessionRequired: CanMatchFn = async (_route, segments) => {
  const admin = inject(FundingAdminService);
  const router = inject(Router);
  if (await admin.restoreSession()) {
    return true;
  }

  const destination = router.currentNavigation()?.extractedUrl;
  const returnUrl = destination
    ? router.serializeUrl(destination)
    : `/admin/${segments.map((segment) => segment.path).join('/')}`;
  return router.createUrlTree(['/admin/login'], {
    queryParams: {
      returnUrl: returnUrl || '/admin/fundraiser'
    }
  });
};

export const adminRoutes: Routes = [
  {
    path: 'fundraiser/access',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-access-page/admin-access-page.component.js').then(
        (m) => m.AdminAccessPageComponent
      )
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/funding/pages/admin-login-page/admin-login-page.component.js').then(
        (m) => m.AdminLoginPageComponent
      )
  },
  {
    path: 'fundraiser',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-dashboard-page/admin-dashboard-page.component.js').then(
        (m) => m.AdminDashboardPageComponent
      )
  },
  {
    path: 'fundraiser/attention',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-attention-page/admin-attention-page.component.js').then(
        (m) => m.AdminAttentionPageComponent
      )
  },
  {
    path: 'fundraiser/assistant',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-assistant-page/admin-assistant-page.component.js').then(
        (m) => m.AdminAssistantPageComponent
      )
  },
  {
    path: 'fundraiser/contributions',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-contributions-page/admin-contributions-page.component.js').then(
        (m) => m.AdminContributionsPageComponent
      )
  },
  {
    path: 'fundraiser/sponsors',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.js').then(
        (m) => m.AdminSponsorsPageComponent
      )
  },
  {
    path: 'fundraiser/invoices',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-invoices-page/admin-invoices-page.component.js').then(
        (m) => m.AdminInvoicesPageComponent
      )
  },
  {
    path: 'fundraiser/publications',
    canMatch: [adminSessionRequired],
    children: [
      {
        // One route configuration preserves local edits between these pages.
        // Match only declared spaces so unknown admin URLs remain 404s.
        matcher: (segments) => {
          if (segments.length === 0) return { consumed: [] };
          if (
            segments.length === 1 &&
            ['drafts', 'batches', 'calendar'].includes(segments[0]!.path)
          ) {
            return {
              consumed: segments,
              posParams: { workspace: segments[0]! }
            };
          }
          return null;
        },
        loadComponent: () =>
          import('./features/funding/pages/admin-publications-page/admin-publications-page.component.js').then(
            (m) => m.AdminPublicationsPageComponent
          )
      }
    ]
  },
  {
    path: 'fundraiser/expenses',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-expenses-page/admin-expenses-page.component.js').then(
        (m) => m.AdminExpensesPageComponent
      )
  },
  {
    path: 'fundraiser/transparency',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-transparency-page/admin-transparency-page.component.js').then(
        (m) => m.AdminTransparencyPageComponent
      )
  },
  {
    path: 'fundraiser/audit',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-audit-page/admin-audit-page.component.js').then(
        (m) => m.AdminAuditPageComponent
      )
  },
  {
    path: 'fundraiser/email-queue',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-email-queue-page/admin-email-queue-page.component.js').then(
        (m) => m.AdminEmailQueuePageComponent
      )
  },
  {
    path: 'fundraiser/setup',
    canMatch: [adminSessionRequired],
    loadComponent: () =>
      import('./features/funding/pages/admin-setup-page/admin-setup-page.component.js').then(
        (m) => m.AdminSetupPageComponent
      )
  }
];
