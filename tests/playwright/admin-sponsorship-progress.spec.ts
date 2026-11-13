import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminSponsorshipProgress,
  ContributionActivityItem,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipRecord,
  SponsorMediaAsset,
  SponsorshipCommitmentRecord,
  SponsorshipOfferedBenefit,
  SponsorshipIntervention,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';
import { classifySponsorMedia } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { expectAdminFontsReady } from './support/admin-fonts.js';
import {
  openPublicationSection,
  openSponsorshipWebsiteSettings
} from './support/sponsorship-dossier.js';
import { moderationFixture, completeModeration } from './support/moderation.js';
import { registerSponsorHistoryPanelTests } from './admin-sponsor-history-panels.ui.js';
import { registerSponsorWorkspaceTests } from './admin-sponsor-workspace.ui.js';
import { registerSponsorFinanceTests } from './admin-sponsor-finance.ui.js';
import { registerSponsorInterventionTests } from './admin-sponsor-interventions.ui.js';
import { registerSponsorFiltersTests } from './admin-sponsors-filters.ui.js';
import { registerSponsorResultsTests } from './admin-sponsors-results.ui.js';
import { registerContributionActivityOverlayTests } from './contribution-activity-overlays.ui.js';
import { registerSponsorshipCommitmentTests } from './admin-sponsorship-commitments.ui.js';
import { registerSponsorshipHistoricalAuditTests } from './admin-sponsorship-historical-audit.ui.js';
import { registerSponsorshipTimingTests } from './admin-sponsorship-timing.ui.js';
import { registerDossierPublicationScheduleTests } from './dossier-publication-schedule.ui.js';
import { registerSponsorPublicationCleanupTests } from './admin-sponsors-publication-cleanup.ui.js';
import {
  registerPublicationMonitorTests,
  registerPublicationWorkshopTests
} from './publication-workshop.ui.js';
import { registerSponsorToolTests } from './admin-sponsor-tools.ui.js';
import { registerSponsorIdentityTests } from './admin-sponsor-identity.ui.js';
import { registerSponsorProfileTests } from './admin-sponsor-profile.ui.js';
import { registerAdminMediaUsageTests } from './sponsor-media-usage.ui.js';
import { registerSponsorsQualityTests } from './admin-sponsors-quality.ui.js';
import { registerDossierServiceSummaryTests } from './dossier-service-summary.ui.js';
import { registerMediaReviewWorkspaceTests } from './media-review-workspace.ui.js';

const id = '10000000-0000-4000-8000-000000000401';
const secondId = '10000000-0000-4000-8000-000000000402';
const date = '2026-09-16T14:00:00Z';
const path = (tab = 'overview', value = id) =>
  `/admin/fundraiser/sponsors?sponsorshipId=${value}&tab=${tab}`;
const assistantPath = (value = id) =>
  `/admin/fundraiser/assistant?sponsorshipId=${value}`;
const dossier = (value = id): AdminSponsorshipProgress => ({
  contributionId: value,
  reference: value === id ? 'DEMO-401' : 'DEMO-402',
  companyName: value === id ? 'Atelier Boréal' : 'Atelier Rivage',
  version: 'v1',
  amountMinor: 50000,
  currency: 'CAD',
  paymentStatus: 'paid',
  reviewStatus: 'pending_review',
  publicConsent: true,
  publicEligible: false,
  feedStatus: 'not_planned',
  milestones: [
    {
      id: 'payment',
      state: 'complete',
      reason: 'payment_recorded',
      tab: 'overview'
    },
    {
      id: 'identity',
      state: 'complete',
      reason: 'identity_complete',
      tab: 'identity'
    },
    { id: 'media', state: 'complete', reason: 'media_approved', tab: 'media' },
    {
      id: 'review',
      state: 'pending',
      reason: 'review_pending',
      tab: 'overview'
    },
    {
      id: 'billing',
      state: 'complete',
      reason: 'invoice_issued',
      tab: 'billing'
    },
    {
      id: 'publication',
      state: 'cancelled',
      reason: 'publication_cancelled',
      tab: 'publication'
    }
  ],
  next: { reason: 'review_pending', tab: 'overview', adminUrl: path() },
  documents: [
    {
      id: secondId,
      number: 'FAC-DEMO-401',
      kind: 'invoice',
      amountMinor: 50000,
      currency: 'CAD',
      issuedAt: date
    }
  ],
  publications: [
    {
      id: secondId,
      channel: 'facebook',
      target: 'openg7',
      status: 'approved',
      batchStatus: 'cancelled',
      slotStatus: null,
      deliveryStatus: null,
      deliveryMode: null,
      scheduledAt: null,
      publishedAt: null
    }
  ],
  refund: {
    workflow: 'completed',
    state: 'partial',
    confirmedAmountMinor: 20000,
    creditMissing: true,
    hasError: false
  },
  failedEmails: [{ id: secondId, template: 'invoice' }],
  failedStripeEvents: []
});
const record = (value = id): AdminSponsorshipRecord => ({
  id: value,
  version: 'v1',
  public_reference: dossier(value).reference,
  contribution_type: 'sponsorship_interest',
  amount: 500,
  currency: 'CAD',
  payment_status: 'paid',
  paid_at: date,
  public_name: null,
  public_display_consent: true,
  display_amount_consent: false,
  sponsor_company_name: dossier(value).companyName,
  sponsor_contact_name: 'Contact démo',
  sponsor_contact_email: 'demo@example.invalid',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_message: null,
  sponsor_details_submitted_at: date,
  sponsor_review_status: 'pending_review',
  sponsor_review_note: null,
  sponsor_reviewed_at: null,
  sponsor_public_slug: null,
  sponsor_public_summary: null,
  sponsor_feed_target: null,
  sponsor_feed_channels: [],
  sponsor_feed_status: 'not_planned',
  sponsor_feed_public_url: null,
  sponsor_feed_notes: null,
  sponsor_visibility_updated_at: null,
  sponsorship_refund_status: 'not_requested',
  sponsorship_refund_requested_at: null,
  sponsorship_refund_processed_at: null,
  sponsorship_refund_completed_at: null,
  sponsorship_refund_id: null,
  sponsorship_refund_amount: null,
  sponsorship_refund_reason: null,
  sponsorship_refund_note: null,
  sponsorship_refund_error: null,
  admin_audit_entries: [],
  created_at: date,
  updated_at: date
});
async function fixtures(page: Page, role?: 'reader' | 'operator' | 'owner') {
  await page.addInitScript((oidc) => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      oidc ? 'openg7-admin-session.cookie' : 'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, Boolean(role));
  const calls: {
    url: URL;
    method: string;
    body: Record<string, unknown> | null;
  }[] = [];
  const options = {
    status: 200,
    state: 'ok' as AdminSponsorshipProgressResponse['status'],
    reviewStatus: 409,
    reviewUpdated: true,
    detailsStatus: 200,
    journalReadStatus: 200,
    journalSaveStatus: 200,
    journalGate: null as Promise<void> | null,
    journalReadGate: null as Promise<void> | null,
    journalState:
      'decision_required' as SponsorshipInterventionsResponse['followup']['state'],
    journal: new Map<string, SponsorshipIntervention[]>(),
    detailsGate: null as Promise<void> | null,
    edited: new Map<string, Partial<AdminSponsorshipRecord>>(),
    queueCount: 3,
    version: 'v1',
    listStatus: 200,
    listSize: 2,
    media: [] as SponsorMediaAsset[],
    mutationStatus: 200,
    mutationGate: null as Promise<void> | null,
    reviewGate: null as Promise<void> | null,
    progressGate: null as Promise<void> | null,
    listGate: null as Promise<void> | null,
    next: null as AdminSponsorshipProgress['next'] | null,
    milestones: null as AdminSponsorshipProgress['milestones'] | null,
    progressOverrides: {} as Partial<AdminSponsorshipProgress>
  };
  const mediaPlans = new Map<
    string,
    import('@openg7/funding-core').SponsorMediaBatchPlanRequest
  >();
  const mediaWorkspace = () => ({
    contributionId: id,
    revision:
      'workspace:' + options.media.map((asset) => asset.version).join(':'),
    writable: role !== 'reader',
    rules: [],
    batches: [],
    assets: options.media.map((asset) => ({
      ...asset,
      batchId: null,
      ruleId: null,
      usageSource: 'media',
      readiness: classifySponsorMedia({
        usage: asset.usage,
        reviewStatus: asset.reviewStatus,
        altText: asset.altText,
        restrictionsReviewed: asset.usageRestrictionsReviewed,
        humanReviewed: true
      }),
      moderation: {
        state: null,
        level: null,
        contentVersion: 1,
        fingerprint: asset.id + ':content',
        currentDecisionId: null
      },
      websiteSelected: false
    }))
  });
  await page.route('**/api/**', async (route) => {
    if (
      await moderationFixture(route, [
        { type: 'sponsorship', id },
        { type: 'sponsorship', id: secondId },
        ...options.media.map((asset) => ({
          type: 'media' as const,
          id: asset.id
        }))
      ])
    )
      return;
    const req = route.request(),
      url = new URL(req.url());
    calls.push({
      url,
      method: req.method(),
      body:
        req.postData() &&
        req.headers()['content-type']?.includes('application/json')
          ? (req.postDataJSON() as Record<string, unknown>)
          : null
    });
    if (url.pathname === '/api/admin/auth/current' && role)
      return route.fulfill({
        json: {
          id: 'dossier-fixture',
          sessionId: 'dossier-session',
          displayName: 'Dossier fixture',
          role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (url.pathname === '/api/admin/sponsorships/interventions') {
      const payload = req.method() === 'POST' ? req.postDataJSON() : null;
      const selected =
        payload?.contributionId ?? url.searchParams.get('sponsorshipId') ?? id;
      if (req.method() === 'POST') {
        if (options.journalGate) await options.journalGate;
        if (options.journalSaveStatus !== 200)
          return route.fulfill({
            status: options.journalSaveStatus,
            json: { error: 'Synthetic journal failure' }
          });
        const entries = options.journal.get(selected) ?? [];
        const entry = entries.find((e) => e.id === payload.requestId) ?? {
          id: payload.requestId,
          kind: payload.kind,
          note: payload.note,
          nextReviewOn: payload.nextReviewOn,
          actor: 'Operator fixture',
          recordedAt: date
        };
        if (!entries.some((e) => e.id === entry.id))
          options.journal.set(selected, [entry, ...entries]);
        if (payload.kind === 'extension') options.journalState = 'extended';
        return route.fulfill({ json: entry });
      }
      if (selected === id && options.journalReadGate)
        await options.journalReadGate;
      if (options.journalReadStatus !== 200)
        return route.fulfill({
          status: options.journalReadStatus,
          json: { error: 'Synthetic journal failure' }
        });
      const entries = options.journal.get(selected) ?? [];
      const cursor = url.searchParams.get('before');
      const offset = cursor ? entries.findIndex((e) => e.id === cursor) + 1 : 0;
      return route.fulfill({
        json: {
          entries: entries.slice(offset, offset + 25),
          nextCursor:
            entries.length > offset + 25 ? entries[offset + 24].id : null,
          followup: {
            state: options.journalState,
            ageDays: 35,
            nextReviewOn:
              entries.find((e) => e.kind === 'extension')?.nextReviewOn ?? null,
            lastEmail: { status: 'failed', at: date }
          }
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/progress') {
      const selected = url.searchParams.get('sponsorshipId') || id;
      if (selected === id && options.progressGate) await options.progressGate;
      const current = { ...record(selected), ...options.edited.get(selected) };
      const coordinatesPresent = Boolean(
        current.sponsor_company_name && current.sponsor_contact_email
      );
      const identityStep: AdminSponsorshipProgress['milestones'][number] = {
        id: 'identity',
        tab: 'identity',
        state: !coordinatesPresent
          ? 'blocked'
          : current.sponsor_details_submitted_at ||
              current.sponsor_details_admin_completed_at
            ? 'complete'
            : 'pending',
        reason: !coordinatesPresent
          ? 'identity_missing'
          : current.sponsor_details_submitted_at
            ? 'identity_complete'
            : current.sponsor_details_admin_completed_at
              ? 'identity_admin_completed'
              : 'identity_submission_pending'
      };
      return route.fulfill({
        status: options.status,
        json: {
          status: options.state,
          generatedAt: date,
          dossier:
            options.state === 'ok'
              ? {
                  ...dossier(selected),
                  ...options.progressOverrides,
                  milestones:
                    options.milestones ??
                    dossier(selected).milestones.map((step) =>
                      step.id === 'identity' ? identityStep : step
                    ),
                  next:
                    options.next ??
                    (identityStep.state === 'complete'
                      ? dossier(selected).next
                      : {
                          reason: identityStep.reason,
                          tab: 'identity',
                          adminUrl: path('identity', selected)
                        })
                }
              : null
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/publication-workshop') {
      return route.fulfill({
        json: {
          contributionId: url.searchParams.get('contributionId'),
          enabled: false,
          sourceVersion: null,
          sourceSnapshotDigest: null,
          mission: null,
          proposal: null,
          history: [],
          canPrepare: false,
          canAdopt: false
        }
      });
    }
    if (url.pathname === '/api/admin/preflight/desk')
      return route.fulfill({
        json: {
          generatedAt: date,
          orders: [],
          pagination: {
            page: 1,
            pageSize: 50,
            totalItems: 0,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false
          },
          summary: {
            total: 0,
            toPrepare: 0,
            toReview: 0,
            toDeliver: 0,
            delivered: 0,
            excludedAdjusted: 0,
            orders: 0,
            scope: 'recorded_promised_services',
            preflightLink: 'unverified'
          }
        }
      });
    if (
      url.pathname === '/api/admin/publication-automation' &&
      route.request().method() === 'GET'
    )
      return route.fulfill({
        json: {
          workerEnabled: false,
          workerVersion: 1,
          feeds: [],
          deliveries: [],
          preparationCandidates: [],
          queue: {
            entries: [],
            summary: { retained: 0, deferred: 0, needsCorrection: 0 },
            total: 0,
            offset: 0,
            limit: 200,
            hasMore: false,
            scope: 'filtered',
            evaluatedAt: date
          },
          summary: {
            awaitingApproval: 0,
            scheduled: 0,
            exceptions: 0,
            publishedToday: 0
          }
        }
      });
    if (url.pathname === '/api/admin/sponsorships') {
      if (options.listGate) await options.listGate;
      if (options.listStatus !== 200)
        return route.fulfill({
          status: options.listStatus,
          json: { error: 'Synthetic list failure' }
        });
      const search = url.searchParams.get('search');
      const records = Array.from({ length: options.listSize }, (_, index) =>
        index === 0
          ? id
          : index === 1
            ? secondId
            : `10000000-0000-4000-8000-${String(index + 401).padStart(12, '0')}`
      )
        .filter((value) => !search || !search.includes('-') || search === value)
        .map((value) => ({
          ...record(value),
          version: options.version,
          ...options.edited.get(value)
        }));
      const currentPage = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('pageSize') || 6);
      const items = records.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
      );
      return route.fulfill({
        json: {
          data_source: 'database',
          items,
          sponsorships: items,
          pagination: {
            page: currentPage,
            pageSize,
            totalItems: records.length,
            totalPages: Math.max(1, Math.ceil(records.length / pageSize)),
            hasPreviousPage: currentPage > 1,
            hasNextPage: currentPage * pageSize < records.length
          },
          last_updated_at: date
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/media/batch/plan') {
      if (options.mutationStatus !== 200)
        return route.fulfill({
          status: options.mutationStatus,
          json: { code: 'SYNTHETIC_PLAN_REFUSED' }
        });
      const request =
        req.postDataJSON() as import('@openg7/funding-core').SponsorMediaBatchPlanRequest;
      const planId = 'synthetic-plan-' + mediaPlans.size;
      mediaPlans.set(planId, request);
      return route.fulfill({
        json: {
          id: planId,
          contributionId: id,
          action: request.action,
          revision: mediaWorkspace().revision,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          blocked: [],
          effects: [],
          assets: request.assets.map((item) => ({
            ...mediaWorkspace().assets.find((asset) => asset.id === item.id),
            ...(item.altText === undefined ? {} : { altText: item.altText })
          }))
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/media/batch/execute') {
      if (options.mutationGate) await options.mutationGate;
      if (options.mutationStatus !== 200)
        return route.fulfill({
          status: options.mutationStatus,
          json: { code: 'SYNTHETIC_EXECUTE_REFUSED' }
        });
      const input = req.postDataJSON(),
        plan = mediaPlans.get(input.planId)!;
      options.media = options.media.flatMap((asset) => {
        const item = plan.assets.find((item) => item.id === asset.id);
        if (!item) return [asset];
        if (plan.action === 'delete') return [];
        return [
          {
            ...asset,
            version: asset.version + '-updated',
            ...(plan.action === 'approve'
              ? {
                  reviewStatus: 'approved' as const,
                  altText: item.altText ?? asset.altText
                }
              : plan.action === 'reject'
                ? { reviewStatus: 'rejected' as const }
                : {})
          }
        ];
      });
      return route.fulfill({
        json: {
          requestId: input.requestId,
          planId: input.planId,
          status: 'completed',
          action: plan.action,
          items: plan.assets.map((item) => ({
            id: item.id,
            version: item.version + '-updated',
            result: plan.action
          }))
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/media/rules') {
      const input = req.postDataJSON();
      options.media = options.media.map((asset) =>
        input.coveredAssetIds.includes(asset.id)
          ? {
              ...asset,
              version: asset.version + '-updated',
              usage: input.usage
            }
          : asset
      );
      return route.fulfill({ json: mediaWorkspace() });
    }
    if (url.pathname === '/api/admin/sponsorships/media/upload') {
      if (options.mutationStatus !== 200)
        return route.fulfill({
          status: options.mutationStatus,
          json: { code: 'INVALID_MEDIA_FILE' }
        });
      const asset = { ...mediaAsset(), kind: 'logo' as const };
      options.media = [...options.media, asset];
      return route.fulfill({ json: { uploaded: true, asset } });
    }
    if (url.pathname === '/api/admin/sponsorships/media')
      return route.fulfill({ json: { assets: options.media } });
    if (url.pathname === '/api/admin/sponsorships/media/workspace')
      return route.fulfill({ json: mediaWorkspace() });
    if (url.pathname === '/api/admin/sponsorships/media/analyses')
      return route.fulfill({
        json: {
          contributionId: id,
          capabilities: {
            technical: 'local',
            vision: 'not_configured',
            ocr: 'not_configured'
          },
          runs: []
        }
      });
    if (
      url.pathname === '/api/admin/sponsorship-commitments' &&
      req.method() === 'GET'
    )
      return route.fulfill({
        json: { commitment: options.progressOverrides.commitment ?? null }
      });
    if (
      url.pathname.includes('/sponsorships/media/content/') ||
      (url.pathname === '/api/admin/sponsorships/logo' &&
        req.method() === 'GET')
    )
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
          'base64'
        )
      });
    if (
      url.pathname === '/api/admin/sponsorships/followup-access' &&
      req.method() === 'GET'
    )
      return route.fulfill({ json: { recipient: 'payment@example.invalid' } });
    if (
      req.method() === 'POST' &&
      [
        '/api/admin/sponsorships/media/review',
        '/api/admin/sponsorships/media/metadata',
        '/api/admin/sponsorships/media/delete',
        '/api/admin/sponsorships/logo',
        '/api/admin/sponsorships/logo/delete',
        '/api/admin/sponsorships/publication',
        '/api/admin/sponsorships/website-visibility',
        '/api/admin/sponsorships/refund',
        '/api/admin/sponsorships/followup-access'
      ].includes(url.pathname)
    ) {
      if (options.mutationGate) await options.mutationGate;
      if (options.mutationStatus !== 200)
        return route.fulfill({
          status: options.mutationStatus,
          json: { error: 'Synthetic action failure' }
        });
      const input = req.headers()['content-type']?.includes('application/json')
        ? req.postDataJSON()
        : {};
      if (url.pathname.endsWith('/website-visibility')) {
        options.progressOverrides = {
          ...options.progressOverrides,
          ...(input.visible
            ? qualifiedWebsiteProgress(options.progressOverrides)
            : {}),
          website: {
            visible: input.visible,
            held: !input.visible,
            canPublish: true,
            version: 'v2',
            blockers: []
          },
          publicationCompletion: {
            done: input.visible
              ? 1
              : (options.progressOverrides.publicationCompletion?.done ?? 0),
            total: 1
          }
        };
      }
      if (
        url.pathname.endsWith('/media/review') ||
        url.pathname.endsWith('/media/metadata')
      )
        options.media = options.media.map((asset) =>
          asset.id === input.assetId
            ? {
                ...asset,
                altText: input.altText || null,
                reviewStatus: input.reviewStatus ?? 'pending_review',
                version: asset.version + '-updated'
              }
            : asset
        );
      if (url.pathname.endsWith('/media/metadata'))
        return route.fulfill({
          json: {
            updated: true,
            asset: options.media.find((asset) => asset.id === input.assetId)
          }
        });
      if (url.pathname.endsWith('/media/delete'))
        options.media = options.media.filter(
          (asset) => asset.id !== input.assetId
        );
      if (url.pathname.endsWith('/logo'))
        options.edited.set(id, {
          sponsor_logo_url: `/api/public/sponsor-logos/${id}.webp`
        });
      if (url.pathname.endsWith('/logo/delete'))
        options.edited.set(id, { sponsor_logo_url: null });
      if (url.pathname.endsWith('/publication'))
        options.edited.set(id, {
          ...options.edited.get(id),
          sponsor_public_slug: input.publicSlug,
          sponsor_public_summary: input.publicSummary,
          sponsor_feed_status: input.feedStatus,
          sponsor_feed_target: input.feedTarget,
          sponsor_feed_channels: input.feedChannels,
          sponsor_feed_public_url: input.feedPublicUrl,
          sponsor_feed_notes: input.feedNotes
        });
      return route.fulfill({
        json: {
          updated: true,
          status: 'queued',
          sizeBytes: 68,
          refundWorkflowStatus: 'processing',
          refundStatus: 'pending'
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/details') {
      if (options.detailsGate) await options.detailsGate;
      const input = req.postDataJSON();
      if (options.detailsStatus === 200) {
        const current = {
          ...record(input.contributionId),
          ...options.edited.get(input.contributionId)
        };
        options.edited.set(input.contributionId, {
          ...options.edited.get(input.contributionId),
          sponsor_company_name: input.companyName,
          public_name: input.publicName || null,
          sponsor_contact_name: input.contactName || null,
          sponsor_contact_email: input.contactEmail || null,
          sponsor_website_url: input.websiteUrl || null,
          sponsor_details_admin_completed_at:
            !current.sponsor_details_submitted_at &&
            input.companyName.trim() &&
            input.contactEmail.trim()
              ? current.sponsor_details_admin_completed_at || date
              : current.sponsor_details_admin_completed_at,
          version: 'v2'
        });
      }
      return route.fulfill({
        status: options.detailsStatus,
        json:
          options.detailsStatus === 200
            ? { updated: true, version: 'v2' }
            : { error: 'Synthetic correction failure' }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/review') {
      if (options.reviewGate) await options.reviewGate;
      return route.fulfill({
        status: options.reviewStatus,
        json:
          options.reviewStatus === 200
            ? { updated: options.reviewUpdated }
            : { error: 'Conflict' }
      });
    }
    if (url.pathname === '/api/admin/attention')
      return route.fulfill({
        json: {
          available: true,
          coverage: 'complete',
          missingSources: [],
          generatedAt: date,
          timezone: 'America/Toronto',
          total: options.queueCount,
          filteredTotal: 0,
          todayTotal: options.queueCount,
          counts: {
            urgent: 0,
            today: options.queueCount,
            this_week: 0,
            informational: 2
          },
          typeCounts: {},
          actionCounts: { sponsorship_needs_review: options.queueCount },
          page: 1,
          pageSize: 25,
          items: [],
          firstSponsorshipId: id
        }
      });
    if (url.pathname === '/api/admin/assistant/context')
      return route.fulfill({
        json: {
          status: 'empty',
          generatedAt: date,
          conversationMode: 'disabled',
          context: null
        }
      });
    return route.fulfill({
      status: 503,
      json: { error: 'Synthetic fixture unavailable' }
    });
  });
  return { calls, options };
}
const progress = (page: Page) =>
  page.locator('[data-og7="sponsorship-progress"]');
const tabs = (page: Page) => page.locator('[data-og7="dossier-tabs"]');
const dossierNext = (page: Page) =>
  page
    .locator('[data-og7="sponsorship-dossier"]')
    .locator(
      '[data-og7="overview-priority-action"], [data-og7="dossier-next"]'
    );

registerSponsorHistoryPanelTests({ fixtures, path, tabs });
registerSponsorWorkspaceTests({ fixtures, path });
registerSponsorFinanceTests({ fixtures, path });
// The library reuses the native workspace; the former stacked profile/logo panels stay retired.
registerMediaReviewWorkspaceTests({
  fixtures,
  path,
  asset: () => mediaAsset()
});
registerSponsorInterventionTests({ fixtures, path, id, date });
registerSponsorshipCommitmentTests({ fixtures, path });
registerSponsorshipHistoricalAuditTests({ fixtures, path });
registerSponsorshipTimingTests({ fixtures, path });
registerDossierPublicationScheduleTests({
  fixtures,
  path,
  dossier,
  recordedCommitment
});
registerSponsorFiltersTests({ fixtures, path });
registerSponsorResultsTests({ fixtures });
registerSponsorPublicationCleanupTests({ fixtures, path, recordedCommitment });
registerPublicationWorkshopTests({ fixtures, path, recordedCommitment });
registerPublicationMonitorTests({ fixtures, path, recordedCommitment });
registerSponsorToolTests({ fixtures, path, secondId });
registerSponsorIdentityTests({ fixtures, path, id, date });
registerSponsorProfileTests({ fixtures, path, asset: () => mediaAsset() });
registerAdminMediaUsageTests({ fixtures, path, asset: () => mediaAsset() });
registerSponsorsQualityTests({ fixtures, path });
registerDossierServiceSummaryTests({ fixtures, path, recordedCommitment });
registerContributionActivityOverlayTests({
  setup: async (page) => {
    const { options } = await fixtures(page, 'operator');
    options.reviewStatus = 200;
  },
  sponsorshipId: id
});

const editForm = (page: Page) => page.locator('[data-og7="edit-dossier-form"]');
const guide = (page: Page) => page.locator('[data-og7="dossier-guide"]');
const toolToggle = (page: Page, tool: string) =>
  page.locator(`[data-og7="dossier-tool-toggle"][data-og7-id="${tool}"]`);
async function openDossierHelp(page: Page): Promise<void> {
  if (new URL(page.url()).pathname !== '/admin/fundraiser/assistant')
    await page.locator('[data-og7="dossier-assistant"]').click();
  await expect(guide(page)).toBeVisible();
  if ((await guide(page).getAttribute('open')) === null)
    await guide(page).locator('summary').click();
}

const sponsorStylePalettes = {
  mineral: { panel: 'rgb(255, 255, 255)', text: 'rgb(23, 43, 80)' },
  night: { panel: 'rgb(20, 35, 56)', text: 'rgb(241, 245, 252)' },
  graphite: { panel: 'rgb(37, 41, 47)', text: 'rgb(243, 244, 246)' }
} as const;

async function expectSponsorColorMix(
  element: Locator,
  properties: Record<string, string>
) {
  const colors = await element.evaluate((element, properties) => {
    const reference = document.createElement('span');
    reference.style.position = 'absolute';
    reference.style.visibility = 'hidden';
    for (const [property, value] of Object.entries(properties))
      reference.style.setProperty(property, value);
    element.append(reference);
    try {
      return Object.keys(properties).map((property) => ({
        property,
        actual: getComputedStyle(element).getPropertyValue(property),
        expected: getComputedStyle(reference).getPropertyValue(property)
      }));
    } finally {
      reference.remove();
    }
  }, properties);
  for (const color of colors)
    expect(color.actual, color.property).toBe(color.expected);
}

for (const theme of ['mineral', 'night', 'graphite'] as const)
  for (const { language, width } of [
    { language: 'fr-CA', width: 390 },
    { language: 'en', width: 1440 }
  ]) {
    test(`sponsor list and dossier remain readable with ${theme} in ${language} at ${width}px`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'operator');
      await page.addInitScript(
        ({ theme, language }) => {
          localStorage.setItem('openg7.language', language);
          localStorage.setItem(
            'openg7.pilotage.appearance.v1',
            JSON.stringify({ theme, system: false })
          );
        },
        { theme, language }
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/admin/fundraiser/sponsors');
      const palette = sponsorStylePalettes[theme];
      const list = page.locator('[data-og7="sponsors-list"]');
      await expect(list).toHaveCSS('background-color', palette.panel);
      const selected = list.locator(
        `[data-og7="sponsor-row"][data-og7-id="${id}"]`
      );
      await expect(selected).toContainText('Atelier Boréal');
      await expect(selected).toHaveCSS('background-color', palette.panel);
      await selected.focus();
      await page.keyboard.press('Enter');
      const frame = page.locator('[data-og7="sponsorship-dossier"]');
      await expect(frame).toHaveCSS('background-color', palette.panel);
      await expect(frame).toHaveCSS('color', palette.text);
      await expect(
        frame.getByRole('heading', { name: 'Atelier Boréal', exact: true })
      ).toBeVisible();
      await expect(tabs(page).getByRole('button')).toHaveCount(6);
      const review = frame
        .locator('openg7-admin-sponsor-detail-header')
        .getByRole('group', {
          name: language === 'en' ? 'Review' : 'Revue',
          exact: true
        });
      await expect(review).toHaveAttribute(
        'data-review-state',
        'pending_review'
      );
      expect(
        await page.evaluate(() =>
          CSS.supports('color', 'color-mix(in lab, red, red)')
        )
      ).toBe(true);
      await expectSponsorColorMix(review, { color: 'var(--admin-text)' });
      await expect(review).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(review).toHaveCSS('border-top-width', '0px');
      await expect(review).toHaveCSS('background-image', 'none');

      const profile = tabs(page).getByRole('button', {
        name: language === 'en' ? 'Profile & media' : 'Fiche et médias',
        exact: true
      });
      await profile.focus();
      await page.keyboard.press('Enter');
      await expect(profile).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-og7="dossier-identity"]')).toHaveCount(
        0
      );
      const globalTools = page.locator('[data-og7="dossier-global-tools"]');
      if ((await globalTools.getAttribute('open')) === null) {
        await globalTools.locator(':scope > summary').click();
      }
      const opener = page.getByRole('button', {
        name: language === 'en' ? 'Edit dossier' : 'Modifier le dossier',
        exact: true
      });
      await opener.click();
      const dialog = page.getByRole('dialog').filter({ has: editForm(page) });
      await expect(dialog).toBeVisible();
      const company = editForm(page).getByRole('textbox').first();
      await expect(company).toHaveValue('Atelier Boréal');
      await company.fill('Brouillon synthétique non enregistré');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      await expect(
        frame.getByRole('heading', { name: 'Atelier Boréal', exact: true })
      ).toBeVisible();
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }

test('selected sponsor keeps a usable compact queue on the 1439/1440px boundary and mobile dossier padding', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'operator');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(path());
  const frame = page.locator('[data-og7="sponsorship-dossier"]');
  const list = page.locator('[data-og7="sponsors-list"]');
  await expect(
    frame.getByRole('heading', { name: 'Atelier Boréal', exact: true })
  ).toBeVisible();
  for (const width of [1439, 1440, 1500, 1501]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 1440) await expect(list).toBeHidden();
    else await expect(list).toBeVisible();
    await expect(frame).toBeVisible();
    await expect(
      tabs(page).getByRole('button', { name: 'Aperçu', exact: true })
    ).toHaveAttribute('aria-current', 'page');
  }
  for (const width of [
    419, 420, 421, 599, 600, 601, 699, 700, 701, 719, 720, 721, 759, 760, 761,
    859, 860, 861
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(frame).toHaveCSS('border-radius', '14px');
    await expect(tabs(page).getByRole('button')).toHaveCount(6);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  }
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

for (const language of ['fr-CA', 'en'] as const)
  for (const viewport of [
    { width: 390, height: 1000 },
    // 1920x1080 at 125% supplies 1536x864 CSS pixels, without device scaling.
    { width: 1536, height: 864 }
  ]) {
    test(`dossier composition keeps identity distinct and global tools usable in ${language} at ${viewport.width}px`, async ({
      page
    }, testInfo) => {
      const { calls, options } = await fixtures(page, 'owner');
      // Presentation data is local to this case; no saved dossier is changed.
      options.listSize = 3;
      options.edited.set(secondId, {
        sponsor_company_name: 'Atelier Boréal',
        amount: 250,
        sponsor_review_status: 'approved'
      });
      options.edited.set('10000000-0000-4000-8000-000000000403', {
        sponsor_company_name: 'Rivage Technologies',
        amount: 100
      });
      options.edited.set(id, {
        amount: 500,
        currency: 'CAD',
        sponsor_company_name: 'NordVale Énergie',
        public_name: 'NordVale Énergie',
        sponsor_contact_name: 'Camille Tremblay',
        sponsor_contact_email: 'camille@nordvale.example.invalid',
        sponsor_website_url: 'https://nordvale.example.invalid'
      });
      options.progressOverrides = {
        companyName: 'NordVale Énergie',
        amountMinor: 50000,
        currency: 'CAD',
        commitment: recordedCommitment(50000),
        publicationCompletion: { done: 0, total: 3 }
      };
      const writes: string[] = [];
      await page.route('**/api/**', (route) => {
        if (route.request().method() === 'GET') return route.fallback();
        writes.push(route.request().url());
        return route.fulfill({ status: 405, json: {} });
      });
      await page.addInitScript((language) => {
        localStorage.setItem('openg7.language', language);
        localStorage.setItem(
          'openg7.pilotage.appearance.v1',
          JSON.stringify({ theme: 'mineral', system: false })
        );
      }, language);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path('identity'));
      const frame = page.locator('[data-og7="sponsorship-dossier"]');
      const main = frame.locator('[data-og7="dossier-main"]');
      const context = frame.locator('[data-og7="dossier-tool-panel"]');
      const identity = main.locator('[data-og7="dossier-identity"]');
      await expect(
        frame.getByRole('heading', { name: 'NordVale Énergie', exact: true })
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(identity).toBeVisible();
      await expectAdminFontsReady(page);
      async function revealDesktopQueue() {
        if (viewport.width !== 1536) return;
        const queue = page.locator('[data-og7="sponsors-list"]');
        await queue.getByRole('searchbox').fill('');
        await expect(queue.locator('[data-og7="sponsor-row"]')).toHaveCount(3);
        await queue
          .getByRole('searchbox')
          .evaluate((element) => element.blur());
      }
      await revealDesktopQueue();

      async function expectComposition() {
        await expect(main).toHaveCount(1);
        await expect(context).toBeHidden();
        await expect(frame.locator('[data-og7="dossier-context"]')).toHaveCount(
          0
        );
        const mainBox = (await main.boundingBox())!;
        const gridBox = (await frame
          .locator('[data-og7="dossier-content"]')
          .boundingBox())!;
        expect(mainBox.width).toBeCloseTo(gridBox.width, 0);
        expect(mainBox.x).toBeGreaterThanOrEqual(-1);
        expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(
          viewport.width + 1
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
      }

      await test.step('identity is managed in its own space while global navigation remains available', async () => {
        await expectComposition();
        await expect(identity).toBeVisible();
        await expect(
          frame.locator('[data-og7="media-review-workspace"]')
        ).toHaveCount(0);
        await expect(frame.locator('[data-og7="dossier-actions"]')).toHaveCount(
          0
        );
        await expect(tabs(page).getByRole('button')).toHaveCount(6);
        await page.screenshot({
          path: testInfo.outputPath(
            'identity-' + language + '-' + viewport.width + '.png'
          ),
          animations: 'disabled'
        });
      });

      if (viewport.width === 390 && language === 'en') {
        await test.step('200% text keeps the main content and context within the mobile page', async () => {
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
          });
          await expect(page.locator('html')).toHaveCSS('font-size', '32px');
          await expectComposition();
          await expect(identity).toBeVisible();
          await page.screenshot({
            path: testInfo.outputPath('nordvale-dossier-390-text-200.png'),
            animations: 'disabled',
            fullPage: true
          });
        });
      }

      await test.step('the contextual moderation decision remains an explicit cancellable keyboard action', async () => {
        await toolToggle(page, 'moderation').press('Enter');
        await expect(context).toBeVisible();
        const opener = context.locator('[data-og7="moderation-open"]');
        await opener.focus();
        await expect(opener).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Enter');
        const decision = page.locator('[data-og7="moderation-decision"]');
        const dialog = page.getByRole('dialog').filter({ has: decision });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAccessibleName(/.+/);
        const confirmation = decision.locator(
          '[data-og7="moderation-confirmation"]'
        );
        await expect(confirmation).toBeVisible();
        await expect(confirmation).not.toBeChecked();
        await expect(
          decision.locator('[data-og7="moderation-submit"]')
        ).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await expect(opener).toBeInViewport({ ratio: 1 });
        expect(writes).toEqual([]);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });

      await test.step('publication uses the full dossier width without authorizing a delivery', async () => {
        if (viewport.width === 390 && language === 'en')
          await page.evaluate(() => {
            document.documentElement.style.removeProperty('font-size');
          });
        await page.goto(path('publication'));
        await revealDesktopQueue();
        const journey = main.locator('[data-og7="publication-monitor"]');
        await expect(journey.getByRole('progressbar')).toHaveAttribute(
          'value',
          '0'
        );
        await expect(journey.getByRole('progressbar')).toHaveAttribute(
          'max',
          '3'
        );
        await expectAdminFontsReady(page);
        await expectComposition();
        await expect(
          tabs(page).getByRole('button', { name: 'Publication', exact: true })
        ).toHaveAttribute('aria-current', 'page');
        if (viewport.width === 1536) {
          expect(await page.evaluate(() => scrollY)).toBe(0);
          await expect(
            journey.getByRole('heading', {
              name: 'Publication',
              exact: true
            })
          ).toBeInViewport({
            ratio: 1
          });
        }
        await page.screenshot({
          path: testInfo.outputPath(
            `nordvale-publication-${viewport.width}.png`
          ),
          animations: 'disabled'
        });
        expect(writes).toEqual([]);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    });
  }

for (const [language, width] of [
  ['fr-CA', 1536],
  ['en', 390]
] as const) {
  for (const qualification of ['qualified', 'unqualified', 'stale'] as const) {
    test(`recorded evidence link preserves the exact obligation in ${language} at ${width}px with qualification ${qualification}`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page);
      const commitment = recordedCommitment();
      const obligation = commitment.obligations.find(
        (item) => item.channel === 'facebook'
      )!;
      const evidenceId = '10000000-0000-4000-8000-000000000460';
      options.progressOverrides = {
        commitment: {
          ...commitment,
          obligations: commitment.obligations.map((item) =>
            item.id === obligation.id
              ? {
                  ...item,
                  state: 'fulfilled',
                  fulfilmentEvidenceId: evidenceId
                }
              : item
          )
        },
        qualifiedFulfilmentEvidenceIds:
          qualification !== 'unqualified' ? [evidenceId] : []
      };
      if (qualification === 'stale') {
        await page.route('**/api/admin/sponsorship-commitments?**', (route) =>
          route.fulfill({
            json: {
              commitment: {
                ...options.progressOverrides.commitment!,
                obligations:
                  options.progressOverrides.commitment!.obligations.map(
                    (item) =>
                      item.id === obligation.id
                        ? {
                            ...item,
                            version: item.version + 1,
                            target: 'openg20'
                          }
                        : item
                  )
              }
            }
          })
        );
      }
      await page.setViewportSize({ width, height: 950 });
      await page.goto(path('publication'));
      if (language === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      await openPublicationSection(page, 'contract');
      const panel = page.locator('[data-og7="admin-commitments"]');
      await expect(
        panel.locator('[data-og7="commitments-accepted-offer"]')
      ).toBeVisible();
      const row = panel.locator(
        `[data-og7="commitments-obligations"] [data-og7-id="${obligation.id}"]`
      );
      await expect(row).toContainText(evidenceId);
      const link = row.locator('[data-og7="commitments-evidence"]');
      const qualified = qualification === 'qualified';
      await expect(link).toHaveCount(qualified ? 1 : 0);
      if (qualified) {
        await expect(link).toHaveAttribute('data-og7-id', evidenceId);
        await expect(link).toHaveAttribute(
          'href',
          `/admin/fundraiser/campaigns?sponsorshipId=${id}&obligationId=${obligation.id}`
        );
        await link.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(
          new RegExp(
            `campaigns\\?sponsorshipId=${id}&obligationId=${obligation.id}$`
          )
        );
      } else {
        await expect(row).toContainText(
          language === 'en' ? 'delivery unconfirmed' : 'livraison non confirmée'
        );
      }
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}

for (const width of [1280, 390]) {
  test(`dossier guide explains all milestones without validating them at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'operator');
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path());
    await openDossierHelp(page);
    const panel = guide(page);
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: 'Revue', exact: true })
    ).toBeVisible();
    await expect(panel).toContainText('À traiter maintenant');
    const previous = panel.locator('[data-og7="guide-previous"]');
    const next = panel.locator('[data-og7="guide-next"]');
    for (let count = 0; count < 3; count++) await previous.click();
    await expect(previous).toBeDisabled();
    const titles = [
      'Paiement',
      'Identité',
      'Médias',
      'Revue',
      'Facturation',
      'Publication'
    ];
    for (const [index, title] of titles.entries()) {
      await expect(
        panel.getByRole('heading', { name: title, exact: true })
      ).toBeVisible();
      await expect(panel).toContainText(`Étape ${index + 1} sur 6`);
      await expect(panel.locator('ol > li')).toHaveCount(3);
      await expect(panel).toContainText('Qui intervient :');
      await expect(panel).toContainText('Condition de validation :');
      if (index < 5) {
        await next.focus();
        await page.keyboard.press('Enter');
      }
    }
    await expect(next).toBeDisabled();
    await panel.locator('[data-og7="guide-recommended"]').click();
    await expect(
      panel.getByRole('heading', { name: 'Revue', exact: true })
    ).toBeVisible();
    const summary = panel.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading')).toBeVisible();
    await summary.press('Space');
    await expect(panel.getByRole('heading')).toBeHidden();
    await summary.press('Space');
    await expect(panel.getByRole('heading')).toBeVisible();
    await summary.click();
    await summary.click();
    await expect(panel.getByRole('heading')).toBeVisible();
    await expect(summary).toBeFocused();
    if (width === 390)
      await panel.screenshot({ path: 'test-results/dossier-guide-mobile.png' });
    for (let repeat = 0; repeat < 2; repeat++) {
      await panel.locator('[data-og7="guide-open-section"]').click();
      await expect(page).toHaveURL(/tab=overview#dossier-review$/);
      await expect(
        tabs(page).getByRole('button', { name: 'Publication', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#dossier-review')).toBeFocused();
      await expect(page.locator('#dossier-review')).toBeInViewport();
      await expect(
        page.getByRole('group', { name: 'Revue', exact: true })
      ).toHaveAttribute('data-review-state', 'pending_review');
      await expect(
        page.locator('[data-og7="publication-monitor"]')
      ).toBeVisible();
      await openDossierHelp(page);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const role of ['owner', 'operator', 'reader'] as const) {
  test(`dossier guide identity actions open only the permitted owner control for ${role}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, role);
    options.edited.set(id, {
      sponsor_contact_email: null,
      sponsor_details_submitted_at: null
    });
    await page.goto(path('identity'));
    await openDossierHelp(page);
    const panel = guide(page);
    if (role === 'reader') {
      await expect(
        panel.locator('[data-og7="guide-edit-identity"]')
      ).toHaveCount(0);
      await panel.locator('[data-og7="guide-open-section"]').click();
    } else await panel.locator('[data-og7="guide-edit-identity"]').click();
    await expect(page).toHaveURL(/tab=identity/);
    await expect(page).not.toHaveURL(/action=/);
    await expect(page.locator('[data-og7="dossier-identity"]')).toBeVisible();
    if (role === 'reader') await expect(editForm(page)).toBeHidden();
    else {
      await expect(editForm(page)).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(
      page.locator('[data-og7="admin-followup-access"]')
    ).toBeHidden();
    if (role === 'owner') {
      options.edited.set(id, {
        sponsor_contact_email: 'contact@example.invalid',
        sponsor_details_submitted_at: null
      });
      await page.goto(path('identity'));
      await openDossierHelp(page);
      await guide(page).locator('[data-og7="guide-followup-access"]').click();
      await expect(page).toHaveURL(/tab=identity/);
      await expect(page).not.toHaveURL(/action=/);
      await expect(
        page.locator('[data-og7="admin-followup-access"]')
      ).toBeVisible();
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const [role, action] of [
  ['reader', 'edit-identity'],
  ['reader', 'followup-access'],
  ['operator', 'followup-access']
] as const) {
  test(`dossier guide action URL cannot grant ${action} to ${role}`, async ({
    page
  }) => {
    const { calls } = await fixtures(page, role);
    await page.goto(path('identity') + '&action=' + action);
    await expect(page).toHaveURL(path('identity'));
    await expect(editForm(page)).toBeHidden();
    await expect(
      page.locator('[data-og7="admin-followup-access"]')
    ).toBeHidden();
    await page.reload();
    await expect(page).toHaveURL(path('identity'));
    await expect(editForm(page)).toBeHidden();
    await expect(
      page.locator('[data-og7="admin-followup-access"]')
    ).toBeHidden();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('dossier guide action URL without a dossier is discarded before selecting a sponsorship', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'owner');
  const origin = '/admin/fundraiser/sponsors?tab=identity';
  await page.goto(origin + '&action=edit-identity');
  await expect(page).toHaveURL(origin);
  await page.locator('[data-og7="sponsor-row"]').first().click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/admin/fundraiser/sponsors' &&
      url.searchParams.get('sponsorshipId') === id &&
      url.searchParams.get('tab') === 'identity' &&
      !url.searchParams.has('action')
  );
  await expect(page.locator('[data-og7="dossier-identity"]')).toBeVisible();
  await expect(editForm(page)).toBeHidden();
  await expect(page.locator('[data-og7="admin-followup-access"]')).toBeHidden();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('dossier guide action URL outside its identity tab is discarded before later navigation', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'owner');
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto(path('overview') + '&action=edit-identity');
  await expect(page).toHaveURL(path('overview'));
  await expect(editForm(page)).toBeHidden();
  await tabs(page)
    .getByRole('button', { name: 'Identité', exact: true })
    .click();
  await expect(page).toHaveURL(path('identity'));
  await expect(editForm(page)).toBeHidden();
  await page
    .locator('[data-og7="sponsors-list"]')
    .getByRole('searchbox')
    .fill('');
  const next = page.getByRole('button', {
    name: 'Dossier suivant',
    exact: true
  });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page).toHaveURL(path('identity', secondId));
  await expect(editForm(page)).toBeHidden();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

for (const [reason, tab, title, section] of [
  ['refund_check', 'refund', 'Refund to check', 'refund'],
  ['stripe_failed', 'overview', 'Failed Stripe event', 'stripe'],
  ['email_failed', 'billing', 'Failed email', 'billing']
] as const) {
  test(`dossier guide prioritizes ${reason} in English on mobile`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'operator');
    options.next = { reason, tab, adminUrl: path(tab) };
    if (reason === 'stripe_failed')
      options.progressOverrides = {
        failedStripeEvents: [
          { id: 'evt_synthetic_failed', type: 'payment_intent.succeeded' }
        ]
      };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path());
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    await openDossierHelp(page);
    const panel = guide(page);
    await expect(
      panel.getByRole('heading', { name: title, exact: true })
    ).toBeVisible();
    await expect(panel).toContainText('Step 1 of 7');
    await expect(panel).toContainText('Handle now');
    await expect(panel).not.toContainText('admin.dossier.');
    if (reason === 'refund_check')
      await expect(panel).toContainText('Ask an owner to process it');
    await panel.locator('[data-og7="guide-open-section"]').click();
    await expect(page.locator('#dossier-' + section)).toBeFocused();
    await expect(page.locator('#dossier-' + section)).toBeInViewport();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
}

test('dossier guide clears unavailable facts and resets its recommendation after changing dossier', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.progressGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(assistantPath());
  await expect(progress(page)).toContainText('Chargement du dossier');
  await expect(guide(page)).toHaveCount(0);
  release();
  options.progressGate = null;
  await openDossierHelp(page);
  await guide(page).locator('[data-og7="guide-previous"]').click();
  await expect(
    guide(page).getByRole('heading', { name: 'Médias', exact: true })
  ).toBeVisible();
  await page.evaluate((next) => {
    history.pushState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, assistantPath(secondId));
  await openDossierHelp(page);
  await expect(
    guide(page).getByRole('heading', { name: 'Revue', exact: true })
  ).toBeVisible();
  await expect(
    guide(page).locator('[data-og7="guide-open-section"]')
  ).toHaveAttribute(
    'href',
    new RegExp(`sponsorshipId=${secondId}.*#dossier-review$`)
  );
  options.status = 503;
  await page.reload();
  await expect(guide(page)).toHaveCount(0);
  await expect(progress(page).getByRole('alert')).toBeVisible();
  await expect(
    page.locator(
      '[data-og7="assistant-dossier-main"] [data-og7="assistant-context"]'
    )
  ).toBeVisible();
  options.status = 200;
  await progress(page)
    .getByRole('button', { name: 'Réessayer', exact: true })
    .click();
  await expect(guide(page)).toBeVisible();
  await expect(
    guide(page).locator('[data-og7="guide-open-section"]')
  ).toHaveAttribute(
    'href',
    new RegExp(`sponsorshipId=${secondId}.*#dossier-review$`)
  );
  options.status = 403;
  await page.reload();
  await expect(guide(page)).toHaveCount(0);
  await expect(progress(page).getByRole('alert')).toBeVisible();
});

test('completed dossier guide remains consultable and never asks to validate browsing', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.next = { reason: 'complete', tab: 'overview', adminUrl: path() };
  options.milestones = dossier().milestones.map((step) => ({
    ...step,
    state: 'complete'
  }));
  await page.goto(path());
  await openDossierHelp(page);
  const panel = guide(page);
  await expect(panel).toContainText(
    'Toutes les étapes requises sont terminées'
  );
  await expect(panel).not.toContainText('À traiter maintenant');
  for (let count = 0; count < 5; count++)
    await panel.locator('[data-og7="guide-next"]').click();
  await expect(panel.locator('[data-og7="guide-next"]')).toBeDisabled();
  await expect(panel.locator('[data-og7="guide-recommended"]')).toHaveCount(0);
  await expect(panel.locator('[data-og7="guide-edit-identity"]')).toHaveCount(
    0
  );
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

for (const alreadySubmitted of [false, true]) {
  test(`identity correction preserves sponsor submission: ${alreadySubmitted}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'operator');
    options.edited.set(id, {
      sponsor_contact_email: null,
      sponsor_details_submitted_at: alreadySubmitted ? date : null
    });
    await page.goto(path());
    await page
      .getByRole('button', { name: 'Modifier le dossier', exact: true })
      .click();
    const form = editForm(page);
    await expect(form).toContainText(/transmission/);
    const submissionHelp = form.locator(
      '[data-og7="edit-dossier-submission-help"]'
    );
    if (alreadySubmitted) await expect(submissionHelp).toHaveCount(0);
    else await expect(submissionHelp).toBeVisible();
    await form
      .getByLabel('Courriel du contact', { exact: true })
      .fill('identity@example.invalid');
    await form
      .getByRole('button', { name: 'Enregistrer les modifications' })
      .click();
    expect(postsTo(calls, '/details')).toHaveLength(0);
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(form).toBeHidden();
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].url.pathname).toBe('/api/admin/sponsorships/details');
    expect(writes[0].body).not.toHaveProperty('sponsor_details_submitted_at');
    await page
      .getByRole('button', { name: 'Modifier le dossier', exact: true })
      .click();
    await expect(
      form.getByLabel('Courriel du contact', { exact: true })
    ).toHaveValue('identity@example.invalid');
    await page.keyboard.press('Escape');
    expect(options.edited.get(id)?.sponsor_details_submitted_at).toBe(
      alreadySubmitted ? date : null
    );
  });
}

test('pending sponsor submission is explained from the dossier through identity in English on mobile', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  options.edited.set(id, { sponsor_details_submitted_at: null });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('billing'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    page.locator('[data-og7="dossier-recommendation"]')
  ).toContainText('Contact details are present. The sponsor can submit');
  await dossierNext(page).click();
  const identity = page.locator('#dossier-identity');
  await expect(identity).toBeFocused();
  await expect(identity).toBeInViewport();
  await expect(
    identity.locator('[data-og7="identity-coordinates-status"]')
  ).toHaveText('The organization name and contact email are present.');
  await expect(
    identity.locator('[data-og7="identity-submission-status"]')
  ).toHaveText(
    'The sponsor must submit their form through their private follow-up access.'
  );
  const roleHelp = identity.locator('[data-og7="identity-role-help"]');
  await expect(roleHelp).toHaveCount(1);
  await expect(roleHelp).toContainText(
    'Administration’s role: complete contact details without submitting the form.'
  );
  await expect(roleHelp).toContainText(
    'Only the sponsor can submit their form through their follow-up access.'
  );
  await expect(identity.locator('[data-og7="identity-step"]')).toHaveCount(2);
  await expect(
    identity.locator('[data-og7="identity-coordinates-state"]')
  ).toHaveAttribute('data-state', 'complete');
  await expect(
    identity.locator('[data-og7="identity-submission-state"]')
  ).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('[data-og7="dossier-worklist"]')).toHaveCount(0);
  await expect(identity.locator('details')).toHaveCount(0);
  await expect(identity.locator('time')).toHaveCount(0);
  await expect(
    identity.locator('[data-og7="identity-submission-required"]')
  ).toHaveCount(0);
  await expect(identity).not.toContainText('Even if you fill in every field');
  await expect(
    identity.getByRole('button', { name: 'Edit identity and contact details' })
  ).toBeEnabled();
  await expect(
    identity.getByRole('button', { name: 'View sponsor follow-up access' })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

const actions = (page: Page) => page.locator('[data-og7="dossier-actions"]');

for (const width of [1920, 1280, 390]) {
  test(`review actions float within the selected dossier at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('publication'));
    const panel = page.locator('[data-og7="sponsorship-dossier"]');
    const dock = actions(page);
    await expect(dock).toHaveAccessibleName('Actions de validation');
    await expect(dock).toContainText('Atelier Boréal');
    await expect(dock).toContainText('DEMO-401');

    // Bring the dossier into view without scrolling to its action footer.
    await panel.evaluate((element) => {
      element.scrollTop = 0;
      window.scrollTo({
        top: scrollY + element.getBoundingClientRect().top - 24,
        behavior: 'instant'
      });
    });
    for (const label of ['Remettre en attente', 'Refuser', 'Accepter']) {
      await expect(
        dock.getByRole('button', { name: label, exact: true })
      ).toBeInViewport({ ratio: 1 });
    }
    const initialDock = await dock.boundingBox();
    expect(initialDock!.y + initialDock!.height).toBeLessThanOrEqual(844);

    await tabs(page)
      .getByRole('button', { name: 'Fiche et médias', exact: true })
      .click();
    await expect(dock).toHaveCount(0);
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'instant'
      });
    });
    const review = page.locator('#dossier-review');
    await expect(review).toBeInViewport({ ratio: 1 });
    await expect(
      review.getByRole('button', { name: 'Accepter', exact: true })
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    await page.screenshot({
      path: `test-results/dossier-floating-actions-${width}.png`
    });
  });
}

const mediaAsset = (assetId = secondId): SponsorMediaAsset => ({
  // This synthetic fixture explicitly owns these technical-use permissions.
  usage: {
    state: 'confirmed',
    channels: ['website', 'facebook', 'linkedin'],
    targets: ['openg7'],
    transformations: ['technical'],
    credit: null,
    restrictions: null
  },
  usageRestrictionsReviewed: false,
  id: assetId,
  contributionId: id,
  kind: 'supporting_image',
  reviewStatus: 'pending_review',
  uploadedBy: 'sponsor',
  originalFilename: 'fixture.png',
  originalMimeType: 'image/png',
  originalSizeBytes: 68,
  processedMimeType: 'image/webp',
  processedSizeBytes: 68,
  width: 1,
  height: 1,
  altText: 'Description initiale',
  sortOrder: 0,
  publicUrl: null,
  reviewedAt: null,
  version: 'v1',
  createdAt: date
});
const postsTo = (
  calls: Awaited<ReturnType<typeof fixtures>>['calls'],
  suffix: string
) =>
  calls.filter(
    (call) => call.method === 'POST' && call.url.pathname.endsWith(suffix)
  );

test('preparation activity stays accessible from Publication without adding a dashboard panel', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.progressOverrides = { preparationActivityId: '7401' };
  const item: ContributionActivityItem = {
    id: '7401',
    contributionId: id,
    reference: 'DEMO-PREPARATION-7401',
    companyName: 'Atelier préparation synthétique',
    amountMinor: 50000,
    currency: 'CAD',
    confirmedAt: date,
    revision: 1,
    preparation: {
      state: 'worker_stopped',
      reasons: ['payment_confirmed', 'worker_stopped', 'review_required'],
      cartouche: null
    },
    email: 'not_configured',
    sms: 'disabled',
    simulatedSms: false,
    adminUrl: path('publication'),
    history: [
      {
        revision: 1,
        state: 'worker_stopped',
        reasons: ['worker_stopped'],
        at: date
      }
    ]
  };
  const queries: URL[] = [];
  await page.route('**/api/admin/contribution-activity**', (route) => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    queries.push(url);
    return route.fulfill({
      json: {
        items: url.searchParams.get('id') === item.id ? [item] : [],
        hasMore: false
      }
    });
  });
  await page.goto(path());
  await expect(
    page.locator('[data-og7="publication-preparation-activity"]')
  ).toHaveCount(0);
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  const open = page.locator('[data-og7="publication-preparation-activity"]');
  await open.focus();
  await open.press('Enter');
  const history = page.getByRole('dialog', {
    name: 'Contributions reçues',
    exact: true
  });
  await expect(history).toContainText(item.reference);
  expect(queries.some((url) => url.searchParams.get('id') === item.id)).toBe(
    true
  );
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('overview public profile statistic opens its media owner without changing visibility', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.progressOverrides = {
    website: {
      visible: false,
      held: false,
      canPublish: false,
      version: 'synthetic-profile-version',
      blockers: ['review']
    }
  };
  await page.goto(path());
  const visibility = page.locator(
    '[data-og7="overview-stat"][data-og7-id="visibility"]'
  );
  await visibility.focus();
  await visibility.press('Enter');
  await expect(page).toHaveURL(path('media') + '#dossier-website-settings');
  await expect(page.locator('#dossier-website-settings')).toBeFocused();
  await expect(
    page.locator('[data-og7="dossier-publication-editor"]')
  ).toBeVisible();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('overview media statistic counts recorded approvals and distinguishes missing media data', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.media = [
    {
      ...mediaAsset(),
      id: 'synthetic-approved-media',
      reviewStatus: 'approved',
      reviewedAt: date
    },
    { ...mediaAsset(), id: 'synthetic-pending-media' },
    {
      ...mediaAsset(),
      id: 'synthetic-rejected-media',
      reviewStatus: 'rejected',
      reviewedAt: date
    }
  ];
  await page.goto(path());
  const stat = page.locator('[data-og7="overview-stat"][data-og7-id="media"]');
  await expect(stat).toContainText(/1\s*\/\s*3/);
  await stat.focus();
  await stat.press('Enter');
  await expect(page).toHaveURL(/tab=media.*#dossier-media$/);
  await expect(page.locator('[data-og7="media-tile"]')).toHaveCount(3);
  options.media = [];
  await page.goto(path());
  await expect(stat).toContainText(/0\s*\/\s*0/);
  await page.route('**/api/admin/sponsorships/media?**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Synthetic unavailable media' }
    })
  );
  await page.reload();
  await expect(stat).toContainText(/Indisponible|Unavailable/);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('overview waits for the sponsor submission while identity remains available', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'operator');
  options.edited.set(id, { sponsor_details_submitted_at: null });
  options.next = {
    reason: 'identity_submission_pending',
    tab: 'identity',
    adminUrl: path('identity')
  };
  await page.goto(path());
  const priority = page.locator('[data-og7="overview-priority"]');
  await expect(priority).toHaveAttribute('data-state', 'waiting');
  await expect(priority).not.toContainText('admin.dossier.');
  await expect(
    page.locator('[data-og7="overview-priority-action"]')
  ).toHaveCount(0);
  await page
    .locator('[data-og7="overview-domain"][data-og7-id="identity"]')
    .getByRole('button')
    .click();
  await expect(
    page.locator('[data-og7="identity-submission-state"]')
  ).toHaveAttribute('data-state', 'pending');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('overview leaves scheduled platform work waiting without an administrative action', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'operator');
  options.next = {
    reason: 'publication_scheduled',
    tab: 'publication',
    adminUrl: path('publication')
  };
  options.progressOverrides = {
    publicationWorkflow: {
      state: 'waiting',
      responsibility: 'platform',
      reason: 'publication_scheduled',
      obligations: []
    }
  };
  await page.goto(path());
  await expect(page.locator('[data-og7="overview-priority"]')).toHaveAttribute(
    'data-state',
    'waiting'
  );
  await expect(
    page.locator('[data-og7="overview-priority-action"]')
  ).toHaveCount(0);
  await page
    .locator('[data-og7="overview-domain"][data-og7-id="review"]')
    .getByRole('button')
    .click();
  await expect(page).toHaveURL(/tab=publication.*#dossier-review$/);
  await expect(page.locator('#dossier-review')).toBeFocused();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('dossier controls respect reader and operator permissions', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.edited.set(id, {
    sponsor_review_note: 'Suivi interne réservé à l’équipe.'
  });
  options.media = [mediaAsset()];
  await page.goto(path());
  await expect(
    page.getByText('Accès en lecture seule', { exact: false })
  ).toBeVisible();
  await expect(actions(page).getByRole('button')).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0);
  await expect(page.locator('[data-og7="admin-followup-access"]')).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: 'Modifier le dossier', exact: true })
  ).toBeDisabled();
  await page.locator('[data-og7="dossier-note"]').click();
  await expect(page.locator('dialog[open]').getByRole('textbox')).toHaveValue(
    'Suivi interne réservé à l’équipe.'
  );
  await expect(
    page.locator('dialog[open]').getByRole('textbox')
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await tabs(page)
    .getByRole('button', { name: 'Fiche et médias', exact: true })
    .click();
  await expect(page.locator('[data-og7="dossier-main"]')).toBeVisible();
  await expect(page.locator('[data-og7="media-review-workspace"]')).toHaveCount(
    1
  );
  await expect(page.locator('[data-og7="dossier-actions"]')).toHaveCount(0);
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  await openSponsorshipWebsiteSettings(page);
  await expect(
    page
      .locator('[data-og7="dossier-publication-editor"]')
      .locator('[data-og7="publication-tracking-save"]')
  ).toBeDisabled();
  await expect(page.getByLabel('Slug public', { exact: false })).toBeDisabled();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('operator can review but owner controls are absent', async ({ page }) => {
  await fixtures(page, 'operator');
  await page.goto(path('publication'));
  await expect(
    actions(page).getByRole('button', { name: 'Accepter', exact: true })
  ).toBeEnabled();
  await expect(
    actions(page).getByRole('button', { name: 'Refuser', exact: true })
  ).toBeEnabled();
  await expect(
    actions(page).getByRole('button', {
      name: 'Rembourser Stripe',
      exact: true
    })
  ).toHaveCount(0);
  await expect(page.locator('[data-og7="admin-followup-access"]')).toHaveCount(
    0
  );
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`approval effect waits for confirmation and respects ${reducedMotion}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    options.reviewGate = new Promise((resolve) => {
      release = resolve;
    });
    options.reviewStatus = 200;
    await page.goto(path('publication'));
    const approve = page.locator('[data-og7="sponsorship-approve"]');
    await expect(approve).toHaveAttribute('data-state', 'idle');
    await approve.focus();
    await page.keyboard.press('Enter');
    await completeModeration(page);
    await expect(approve).toHaveAttribute('data-state', 'pending');
    await expect(approve).toHaveAttribute('aria-busy', 'true');
    await expect(approve).toBeDisabled();
    await expect(actions(page)).toHaveAttribute(
      'data-approval-state',
      'pending'
    );
    const reviewBadge = page.getByRole('group', { name: 'Revue', exact: true });
    await expect(reviewBadge).toContainText('À réviser');
    const moving = () =>
      approve.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .map(
            (animation) =>
              (animation as CSSAnimation).animationName ||
              animation.constructor.name
          )
      );
    if (reducedMotion === 'reduce') expect(await moving()).toEqual([]);
    else expect((await moving()).length).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    expect(postsTo(calls, '/review')).toHaveLength(1);

    options.edited.set(id, {
      sponsor_review_status: 'approved',
      version: 'v2'
    });
    release();
    await expect(approve).toHaveAttribute('data-state', 'success');
    await expect(approve).toHaveAttribute('aria-busy', 'false');
    await expect(approve).toBeDisabled();
    await expect(actions(page)).toHaveAttribute(
      'data-approval-state',
      'success'
    );
    await expect(reviewBadge).toContainText('Approuvé');
    if (reducedMotion === 'reduce') expect(await moving()).toEqual([]);
    else {
      expect((await moving()).length).toBeGreaterThan(0);
      // Capture the actual CSS celebration at its peak for visual review.
      await approve.evaluate((element) => {
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 280;
        }
      });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: `test-results/dossier-approval-${reducedMotion}.png`,
      fullPage: true
    });
    await expect(approve).toHaveAttribute('data-state', 'idle');
    await expect(approve).toBeDisabled();
    expect(postsTo(calls, '/review')).toHaveLength(1);
  });
}

for (const failure of ['http', 'not_updated'] as const) {
  test(`approval effect reports ${failure} failure without celebrating and allows retry`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.reviewStatus = failure === 'http' ? 503 : 200;
    options.reviewUpdated = failure !== 'not_updated';
    await page.goto(path('publication'));
    const approve = page.locator('[data-og7="sponsorship-approve"]');
    await approve.click();
    await completeModeration(page);
    await expect(approve).toHaveAttribute('data-state', 'error');
    await expect(approve).toHaveAttribute('aria-busy', 'false');
    await expect(approve).toBeEnabled();
    await expect(actions(page)).toHaveAttribute('data-approval-state', 'error');
    options.reviewStatus = 200;
    options.reviewUpdated = true;
    options.edited.set(id, { sponsor_review_status: 'approved' });
    await approve.click();
    await completeModeration(page);
    await expect(approve).toHaveAttribute('data-state', 'success');
    expect(postsTo(calls, '/review')).toHaveLength(2);
  });
}

test('late approval never celebrates on another dossier or after returning to its source', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  options.reviewStatus = 200;
  await page.goto('/admin/fundraiser/sponsors');
  await page.locator('[data-og7="sponsor-row"]').first().click();
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  const approve = page.locator('[data-og7="sponsorship-approve"]');
  await approve.click();
  await completeModeration(page);
  await expect(approve).toHaveAttribute('data-state', 'pending');
  await page
    .getByRole('button', { name: 'Dossier suivant', exact: true })
    .click();
  await expect(actions(page)).toContainText('DEMO-402');
  await expect(approve).toHaveAttribute('data-state', 'idle');
  release();
  await expect(approve).toBeEnabled();
  await expect(approve).toHaveAttribute('data-state', 'idle');
  await page
    .getByRole('button', { name: 'Dossier précédent', exact: true })
    .click();
  await expect(actions(page)).toContainText('DEMO-401');
  await expect(approve).toHaveAttribute('data-state', 'idle');
});

test('review controls disable redundant decisions and retain mandatory refusal confirmation', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.reviewStatus = 200;
  await page.goto(path('publication'));
  await expect(
    actions(page).getByRole('button', { name: 'Remettre en attente' })
  ).toBeDisabled();
  const reject = actions(page).getByRole('button', {
    name: 'Refuser',
    exact: true
  });
  await reject.click();
  await expect(page).toHaveURL(path('publication'));
  const form = page.locator('[data-og7="dossier-rejection-form"]');
  await expect(form.getByLabel(/Justification interne/)).toBeFocused();
  const confirm = form.getByRole('button', { name: /Confirmer/ });
  await expect(confirm).toBeDisabled();
  await form.getByLabel(/Justification interne/).fill('Motif synthétique');
  await form.getByRole('checkbox').uncheck();
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(reject).toBeFocused();
  expect(postsTo(calls, '/review')).toHaveLength(0);
  await reject.click();
  await confirm.click();
  await completeModeration(page, true);
  await expect(form).toHaveCount(0);
  expect(postsTo(calls, '/review')[0]?.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    reviewStatus: 'rejected',
    reviewNote: 'Motif synthétique',
    notifySponsor: false
  });
  options.edited.set(id, { sponsor_review_status: 'approved' });
  await page
    .getByRole('button', { name: 'Actualiser le dossier', exact: true })
    .click();
  await expect(
    actions(page).getByRole('button', { name: 'Accepter', exact: true })
  ).toBeDisabled();
  await actions(page)
    .getByRole('button', { name: 'Remettre en attente' })
    .click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(postsTo(calls, '/review')).toHaveLength(1);
  await actions(page)
    .getByRole('button', { name: 'Remettre en attente' })
    .click();
  await page.locator('[data-og7="confirm-action"]').click();
  await completeModeration(page, true);
  await expect.poll(() => postsTo(calls, '/review').length).toBe(2);
});

test('publication save normalizes the slug, confirms visibility and preserves a failed draft', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.edited.set(id, { sponsor_review_status: 'approved' });
  await page.goto(path('publication'));
  const editor = page.locator('[data-og7="dossier-publication-editor"]');
  await openSponsorshipWebsiteSettings(page);
  const slug = editor.getByLabel('Slug public', { exact: false });
  const save = editor.locator('[data-og7="publication-tracking-save"]');
  await slug.fill('invalid slug !');
  await expect(slug).toHaveValue('invalid-slug');
  await slug.fill('atelier-demo');
  await editor
    .locator('[data-og7="publication-declared-tracking"] > summary')
    .click();
  await editor.getByLabel('Destination feed').selectOption('openg7');
  await editor.getByLabel('Statut de suivi déclaré').selectOption('published');
  await save.click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(postsTo(calls, '/publication')).toHaveLength(0);
  options.mutationStatus = 503;
  await save.click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(editor).toContainText('Synthetic action failure');
  await expect(slug).toHaveValue('atelier-demo');
  options.mutationStatus = 200;
  await save.click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(save).toBeDisabled();
  expect(postsTo(calls, '/publication')[1]?.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    publicSlug: 'atelier-demo',
    feedStatus: 'published'
  });
});

for (const returnBeforeResponse of [false, true]) {
  test(`late publication response clears pending feedback after switching dossiers: ${returnBeforeResponse}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.edited.set(id, { sponsor_review_status: 'approved' });
    let release!: () => void;
    options.mutationGate = new Promise((resolve) => {
      release = resolve;
    });
    await page.goto('/admin/fundraiser/sponsors');
    await page.locator(`[data-og7="sponsor-row"][data-og7-id="${id}"]`).click();
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await openSponsorshipWebsiteSettings(page);
    const editor = page.locator('[data-og7="dossier-publication-editor"]');
    await editor
      .getByLabel('Slug public', { exact: false })
      .fill('retour-tardif');
    await editor.locator('[data-og7="publication-tracking-save"]').click();
    await expect.poll(() => postsTo(calls, '/publication').length).toBe(1);
    await page.locator('[data-og7="dossier-global-tools"] > summary').click();
    await page
      .getByRole('button', { name: 'Dossier suivant', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Atelier Rivage'
    );
    if (returnBeforeResponse) {
      await page
        .getByRole('button', { name: 'Dossier précédent', exact: true })
        .click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Atelier Boréal'
      );
    }
    release();
    await expect(page.locator('[data-og7="dossier-refresh"]')).toBeEnabled();
    if (!returnBeforeResponse) {
      await page
        .getByRole('button', { name: 'Dossier précédent', exact: true })
        .click();
    }
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Atelier Boréal'
    );
    await expect(editor).not.toContainText('Enregistrement en cours');
    await expect(
      editor.getByLabel('Slug public', { exact: false })
    ).toHaveValue('retour-tardif');
    expect(postsTo(calls, '/publication')).toHaveLength(1);
  });
}

test('refund validates amount and reference, cancellation is inert and submission is singular', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  await page.goto(path('refund'));
  const opener = actions(page).getByRole('button', {
    name: 'Rembourser Stripe'
  });
  await opener.click();
  const form = page.locator('[data-og7="dossier-refund-form"]');
  const amount = form.getByRole('spinbutton');
  await expect(amount).toBeFocused();
  const confirm = form.getByRole('button', { name: /^Rembours/ });
  await expect(confirm).toBeDisabled();
  await form.locator('input[autocomplete="off"]').fill('DEMO-401');
  await amount.fill('501');
  await expect(confirm).toBeDisabled();
  await amount.fill('25');
  await form.getByRole('checkbox').uncheck();
  await expect(confirm).toBeEnabled();
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(opener).toBeFocused();
  expect(postsTo(calls, '/refund')).toHaveLength(0);
  await opener.click();
  let release!: () => void;
  options.mutationGate = new Promise((resolve) => {
    release = resolve;
  });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(
    form.getByRole('button', { name: 'Annuler', exact: true })
  ).toBeDisabled();
  release();
  await expect(form).toHaveCount(0);
  expect(postsTo(calls, '/refund')).toHaveLength(1);
  expect(postsTo(calls, '/refund')[0]?.body).toMatchObject({
    contributionId: id,
    confirmationText: 'DEMO-401',
    amount: 25,
    notifySponsor: false,
    expectedVersion: 'v1'
  });
});

test('an uncertain Stripe refund closes the form, refreshes its state and blocks another submission', async ({
  page
}) => {
  const { options } = await fixtures(page, 'owner');
  let submissions = 0;
  await page.route('**/api/admin/sponsorships/refund', async (route) => {
    submissions++;
    options.edited.set(id, {
      sponsorship_refund_status: 'processing',
      version: 'v2'
    });
    await route.fulfill({
      status: 502,
      json: {
        code: 'SPONSORSHIP_REFUND_UNCERTAIN',
        error: 'Awaiting Stripe confirmation.'
      }
    });
  });
  await page.goto(path('refund'));
  const opener = actions(page).getByRole('button', {
    name: 'Rembourser Stripe'
  });
  await opener.click();
  const form = page.locator('[data-og7="dossier-refund-form"]');
  await form.getByRole('spinbutton').fill('25');
  await form.locator('input[autocomplete="off"]').fill('DEMO-401');
  await form.getByRole('checkbox').uncheck();
  await form.getByRole('button', { name: /^Rembours/ }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByText('Confirmation de Stripe en attente.', { exact: false })
  ).toBeVisible();
  await expect(opener).toBeDisabled();
  expect(submissions).toBe(1);
});

test('private access resend confirms recipient and retry reuses the request identifier', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  await page.goto(path());
  await page.getByText('Accès au suivi', { exact: true }).click();
  const access = page.locator('[data-og7="admin-followup-access"]');
  await access.getByRole('button').click();
  await expect(page.locator('dialog[open]')).toContainText(
    'payment@example.invalid'
  );
  await page.keyboard.press('Escape');
  expect(postsTo(calls, '/followup-access')).toHaveLength(0);
  options.mutationStatus = 503;
  await access.getByRole('button').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(access).toContainText('Le lien n’a pas pu être mis en file');
  options.mutationStatus = 200;
  await access.getByRole('button').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(access).toContainText('Le courriel est en file d’envoi');
  await expect.poll(() => postsTo(calls, '/followup-access').length).toBe(2);
  const sent = postsTo(calls, '/followup-access');
  expect(sent[1]?.body).toEqual(sent[0]?.body);
  expect(sent[0]?.body).toMatchObject({
    contributionId: id,
    recipient: 'payment@example.invalid',
    confirmed: true
  });
});

test('a late access recipient cannot open confirmation for another dossier', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'owner');
  let release!: () => void;
  const recipientGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let recipientRequested = false;
  await page.route(
    '**/api/admin/sponsorships/followup-access*',
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      recipientRequested = true;
      await recipientGate;
      await route.fulfill({
        json: { recipient: 'old-dossier@example.invalid' }
      });
    }
  );
  await page.goto('/admin/fundraiser/sponsors');
  await page.locator('[data-og7="sponsor-row"]').first().click();
  await expect(
    page.getByRole('button', { name: 'Dossier suivant', exact: true })
  ).toBeEnabled();
  await page.getByText('Accès au suivi', { exact: true }).click();
  const recipientResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/followup-access') &&
      url.searchParams.get('contributionId') === id
    );
  });
  await page
    .locator('[data-og7="admin-followup-access"]')
    .getByRole('button')
    .click();
  try {
    await expect.poll(() => recipientRequested).toBe(true);
    await page
      .getByRole('button', { name: 'Dossier suivant', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Atelier Rivage'
    );
  } finally {
    release();
  }
  await (await recipientResponse).finished();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
  await expect(progress(page)).not.toHaveAttribute('aria-busy', 'true');
  await toolToggle(page, 'access').click();
  await expect(
    page.locator('[data-og7="admin-followup-access"]').getByRole('button')
  ).toBeEnabled();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(postsTo(calls, '/followup-access')).toHaveLength(0);
});

for (const blocked of [
  { payment_status: 'refunded' },
  { payment_status: 'disputed' },
  { sponsorship_refund_status: 'processing' }
] as const) {
  test(`ineligible financial state disables approval, publication and refund: ${JSON.stringify(blocked)}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.edited.set(id, blocked);
    await page.goto(path('publication'));
    await openSponsorshipWebsiteSettings(page);
    await expect(
      page
        .locator('[data-og7="dossier-publication-editor"]')
        .locator('[data-og7="publication-tracking-save"]')
    ).toBeDisabled();
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(
      actions(page).getByRole('button', { name: 'Accepter', exact: true })
    ).toBeDisabled();
    await tabs(page)
      .getByRole('button', { name: 'Finances', exact: true })
      .click();
    await expect(
      actions(page).getByRole('button', { name: 'Rembourser Stripe' })
    ).toBeDisabled();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
}

test('copy, refresh, close, list pagination and filter reset perform their named actions', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.listSize = 8;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(path());
  await page.locator('[data-og7="dossier-copy-reference"]').click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('DEMO-401');
  await page
    .getByRole('button', { name: 'Toutes les commandites', exact: true })
    .click();
  await expect(page).not.toHaveURL(/sponsorshipId=/);
  await expect(tabs(page)).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0);
  const list = page.locator('openg7-admin-sponsors-list-panel');
  await list.getByRole('searchbox').fill('Atelier');
  await list.locator('summary').click();
  await list
    .getByRole('button', { name: 'Reinitialiser', exact: true })
    .click();
  await expect(list.getByRole('searchbox')).toHaveValue('');
  await expect(
    list.getByRole('button', { name: 'Page precedente' })
  ).toBeDisabled();
  await list.getByRole('button', { name: 'Page suivante' }).click();
  await expect(
    list.getByRole('button', { name: 'Page suivante' })
  ).toBeDisabled();
  await list.getByRole('button', { name: 'Page precedente' }).click();
  await expect(
    list.getByRole('button', { name: 'Page precedente' })
  ).toBeDisabled();
  await list.getByLabel('Par page').selectOption('10');
  await expect(
    list.getByRole('button', { name: 'Page suivante' })
  ).toBeDisabled();
  await list.getByLabel('Statut de revue').selectOption('approved');
  await expect
    .poll(() =>
      calls
        .filter((call) => call.url.pathname === '/api/admin/sponsorships')
        .at(-1)
        ?.url.searchParams.get('reviewStatus')
    )
    .toBe('approved');
  options.listStatus = 503;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Reessayer' })).toBeVisible();
  options.listStatus = 200;
  await list.getByRole('button', { name: 'Reessayer' }).click();
  await expect(list.getByRole('button', { name: 'Reessayer' })).toHaveCount(0);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
const saveDetails = async (page: Page) => {
  await editForm(page)
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  await page.locator('[data-og7="confirm-action"]').click();
};

for (const width of [1440, 390]) {
  test(`opening dossier editing prefills every company field at ${width}px`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.edited.set(id, {
      public_name: 'Boréal public',
      sponsor_contact_name: 'Camille Boréal',
      sponsor_contact_email: 'camille@example.invalid',
      sponsor_website_url: 'https://boreal.example.invalid'
    });
    await page.addInitScript(() => {
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        const form = this.querySelector('[data-og7="edit-dossier-form"]');
        if (form) {
          form.setAttribute(
            'data-values-at-open',
            JSON.stringify(
              Array.from(form.querySelectorAll('input'), (input) => input.value)
            )
          );
        }
        showModal.call(this);
      };
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path());
    const opener = page.getByRole('button', {
      name: 'Modifier le dossier',
      exact: true
    });
    const form = editForm(page);
    const expected = [
      ['Nom de l’entreprise', 'Atelier Boréal'],
      ['Nom public', 'Boréal public'],
      ['Nom du contact', 'Camille Boréal'],
      ['Courriel du contact', 'camille@example.invalid'],
      ['Site web', 'https://boreal.example.invalid']
    ];
    for (let opening = 0; opening < 2; opening++) {
      await opener.click();
      await expect(form).toHaveAttribute(
        'data-values-at-open',
        JSON.stringify(expected.map(([, value]) => value))
      );
      for (const [label, value] of expected) {
        await expect(form.getByLabel(label, { exact: true })).toHaveValue(
          value
        );
      }
      await expect(
        form.getByRole('button', { name: 'Enregistrer les modifications' })
      ).toBeDisabled();
      await expect(form.getByLabel('Motif de la modification')).toHaveValue(
        'correction'
      );
      await form
        .getByLabel('Motif de la modification')
        .selectOption('organization_update');
      await form
        .getByLabel('Nom de l’entreprise', { exact: true })
        .fill('Brouillon annulé');
      await form.getByRole('button', { name: 'Annuler', exact: true }).click();
    }
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
}

test('switching dossiers prefills the selected company and clears absent optional fields', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.edited.set(id, {
    public_name: 'Boréal public',
    sponsor_website_url: 'https://boreal.example.invalid'
  });
  options.edited.set(secondId, {
    sponsor_contact_name: null,
    sponsor_contact_email: null
  });
  await page.goto('/admin/fundraiser/sponsors');
  await page.locator('[data-og7="sponsor-row"]').first().click();
  const opener = page.getByRole('button', {
    name: 'Modifier le dossier',
    exact: true
  });
  const form = editForm(page);
  await opener.click();
  await expect(form.getByLabel('Nom public', { exact: true })).toHaveValue(
    'Boréal public'
  );
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page
    .getByRole('button', { name: 'Dossier suivant', exact: true })
    .click();
  await expect(page.locator('[data-og7="dossier-header"]')).toContainText(
    'Atelier Rivage'
  );
  await expect(page.locator('[data-og7="dossier-header"]')).toContainText(
    'DEMO-402'
  );
  await opener.click();
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Atelier Rivage');
  for (const label of [
    'Nom public',
    'Nom du contact',
    'Courriel du contact',
    'Site web'
  ]) {
    await expect(form.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await expect(
    form.getByRole('button', { name: 'Enregistrer les modifications' })
  ).toBeDisabled();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('dossier identity correction requires confirmation and refreshes the saved fields', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  const form = editForm(page);
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Atelier Boréal');
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Atelier corrigé');
  await form
    .getByLabel('Nom public', { exact: true })
    .fill('Nom public corrigé');
  await form
    .getByLabel('Courriel du contact', { exact: true })
    .fill('corrected@example.invalid');
  await form
    .getByLabel('Site web', { exact: true })
    .fill('https://example.invalid/updated');
  await form
    .getByLabel('Motif de la modification')
    .selectOption('contact_update');
  await form
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .filter({ has: page.locator('[data-og7="confirm-action"]') })
  ).toContainText('corrected@example.invalid');
  expect(calls.filter((c) => c.url.pathname.endsWith('/details'))).toHaveLength(
    0
  );
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Les modifications du dossier sont enregistrées.' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Atelier corrigé', exact: true })
  ).toBeVisible();
  const writes = calls.filter((c) => c.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    confirmed: true,
    companyName: 'Atelier corrigé',
    publicName: 'Nom public corrigé',
    contactName: 'Contact démo',
    contactEmail: 'corrected@example.invalid',
    websiteUrl: 'https://example.invalid/updated',
    reason: 'contact_update'
  });
  expect(writes[0].body?.['requestId']).toMatch(/^[0-9a-f-]{36}$/);
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  await expect(
    form.getByLabel('Courriel du contact', { exact: true })
  ).toHaveValue('corrected@example.invalid');
});

test('invalid dossier fields show associated errors and cancellation restores focus without saving', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  const opener = page.getByRole('button', {
    name: 'Modifier le dossier',
    exact: true
  });
  await opener.click();
  const form = editForm(page);
  await form.getByLabel('Nom de l’entreprise', { exact: true }).fill('');
  await form
    .getByLabel('Courriel du contact', { exact: true })
    .fill('invalid-email');
  await form
    .getByLabel('Site web', { exact: true })
    .fill('javascript:alert(1)');
  await form
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click();
  for (const label of [
    'Nom de l’entreprise',
    'Courriel du contact',
    'Site web'
  ]) {
    await expect(form.getByLabel(label, { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await expect(form.getByLabel(label, { exact: true })).toHaveAttribute(
      'aria-describedby',
      /sponsor-edit-error-/
    );
  }
  await page.keyboard.press('Escape');
  await expect(form).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

test('dossier save failure preserves entries and retry reuses the same request without duplicate submissions', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.detailsStatus = 503;
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  const form = editForm(page);
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Correction conservée');
  await saveDetails(page);
  await expect(form.getByRole('alert')).toContainText(
    'Vos saisies sont conservées'
  );
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Correction conservée');
  options.detailsStatus = 200;
  let release!: () => void;
  options.detailsGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await saveDetails(page);
  await expect(
    form.getByRole('button', { name: 'Enregistrement…' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  await expect
    .poll(() => calls.filter((c) => c.url.pathname.endsWith('/details')).length)
    .toBe(2);
  const writes = calls.filter((c) => c.url.pathname.endsWith('/details'));
  expect(writes[0].body).toEqual(writes[1].body);
  release();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Correction conservée', exact: true })
  ).toBeVisible();
});

test('a conflicting dossier requires refresh before another correction', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.detailsStatus = 409;
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  const form = editForm(page);
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Correction en conflit');
  await saveDetails(page);
  await expect(form.getByRole('alert')).toContainText('Ce dossier a changé');
  await expect(
    form.getByLabel('Nom de l’entreprise', { exact: true })
  ).toHaveValue('Correction en conflit');
  await expect(
    form.getByRole('button', { name: 'Enregistrer les modifications' })
  ).toBeDisabled();
  await form.getByRole('button', { name: 'Annuler', exact: true }).click();
  options.version = 'v2';
  options.detailsStatus = 200;
  await page
    .getByRole('alert')
    .filter({ hasText: 'Le dossier a changé' })
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le dossier a changé' })
  ).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Modifier le dossier', exact: true })
    .click();
  await form
    .getByLabel('Nom de l’entreprise', { exact: true })
    .fill('Correction après actualisation');
  await saveDetails(page);
  await expect(form).not.toBeVisible();
  const writes = calls.filter((c) => c.url.pathname.endsWith('/details'));
  expect(writes[1].body?.['expectedVersion']).toBe('v2');
});

for (const status of [401, 403]) {
  test(`dossier correction clears the draft on authorization failure ${status}`, async ({
    page
  }) => {
    const { options } = await fixtures(page);
    options.detailsStatus = status;
    await page.goto(path());
    await page
      .getByRole('button', { name: 'Modifier le dossier', exact: true })
      .click();
    await editForm(page)
      .getByLabel('Nom de l’entreprise', { exact: true })
      .fill('Private correction draft');
    await saveDetails(page);
    await expect(editForm(page)).not.toBeVisible();
    if (status === 401)
      await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);
    else
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'l’autorisation de modifier' })
      ).toBeVisible();
  });
}

test('English dossier editing works on mobile and cancelling confirmation keeps the draft', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await page.getByRole('button', { name: 'Edit dossier', exact: true }).click();
  const form = editForm(page);
  await form.getByLabel('Company name', { exact: true }).fill('Corrected name');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form.getByLabel('Company name', { exact: true })).toHaveValue(
    'Corrected name'
  );
  await expect(
    form.getByRole('button', { name: 'Save changes', exact: true })
  ).toBeFocused();
  expect(
    await form.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1
    )
  ).toBe(true);
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

for (const [width, localNote] of [
  [1280, 'Note locale à conserver'],
  [390, '']
] as const) {
  test(`dossier refresh preserves edited fields and refreshes untouched values at ${width}px`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'operator');
    options.edited.set(id, {
      sponsor_review_note: 'Note initiale',
      sponsor_public_summary: 'Présentation initiale'
    });
    options.edited.set(secondId, {
      sponsor_review_note: 'Note du second dossier'
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/fundraiser/sponsors');
    await page
      .locator('[data-og7="sponsor-row"][data-og7-id="' + id + '"]')
      .click();
    const opener = page.locator('[data-og7="dossier-note"]');
    const drawer = page.getByRole('dialog', {
      name: 'Note interne',
      exact: true
    });
    await opener.click();
    await drawer.getByRole('textbox').fill(localNote);
    await page.keyboard.press('Escape');
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await openSponsorshipWebsiteSettings(page);
    const editor = page.locator('[data-og7="dossier-publication-editor"]');
    const slug = editor.getByLabel('Slug public', { exact: false });
    await slug.fill('brouillon-local');
    options.version = 'v2';
    options.edited.set(id, {
      ...options.edited.get(id),
      sponsor_company_name: 'Atelier actualisé',
      sponsor_review_note: 'Note actualisée sur le serveur',
      sponsor_public_slug: 'slug-du-serveur',
      sponsor_public_summary: 'Présentation actualisée',
      sponsor_feed_status: 'planned'
    });
    options.edited.set(secondId, {
      sponsor_review_note: 'Second dossier actualisé'
    });
    await page.locator('[data-og7="dossier-global-tools"] > summary').click();
    const refresh = page.locator('[data-og7="dossier-refresh"]');
    for (let pass = 0; pass < 2; pass++) {
      await refresh.click();
      await expect(refresh).toBeEnabled();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Atelier actualisé'
      );
      await expect(slug).toHaveValue('brouillon-local');
      await expect(editor.getByLabel('Resume public')).toHaveValue(
        'Présentation actualisée'
      );
      await expect(editor.getByLabel('Statut de suivi déclaré')).toHaveValue(
        'planned'
      );
    }
    await tabs(page)
      .getByRole('button', { name: 'Aperçu', exact: true })
      .click();
    await opener.click();
    await expect(drawer.getByRole('textbox')).toHaveValue(localNote);
    await expect(drawer.getByRole('status')).toHaveText(
      'Modifications non enregistrées'
    );
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Dossier suivant', exact: true })
      .click();
    await opener.click();
    await expect(drawer.getByRole('textbox')).toHaveValue(
      'Second dossier actualisé'
    );
    await expect(drawer.getByRole('status')).toHaveText('Note enregistrée.');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Dossier précédent', exact: true })
      .click();
    await opener.click();
    await expect(drawer.getByRole('textbox')).toHaveValue(localNote);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('overview domains keep identity, finances and the global internal note reachable', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  const domain = (id: string) =>
    page
      .locator(`[data-og7="overview-domain"][data-og7-id="${id}"]`)
      .getByRole('button');
  await domain('identity').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#dossier-identity')).toBeFocused();
  await expect(page.locator('[data-og7="identity-coordinates"]')).toHaveCount(
    1
  );
  await tabs(page).getByRole('button', { name: 'Aperçu', exact: true }).click();
  await domain('finance').click();
  await expect(page.locator('#dossier-billing')).toBeFocused();
  const noteAccess = page.locator('[data-og7="dossier-note"]');
  await noteAccess.click();
  const drawer = page.getByRole('dialog', {
    name: 'Note interne',
    exact: true
  });
  await drawer
    .getByRole('textbox')
    .fill('Précision conservée pendant la navigation.');
  await page.keyboard.press('Escape');
  await expect(noteAccess).toBeFocused();
  await expect(page).toHaveURL(/tab=billing/);
  await tabs(page)
    .getByRole('button', { name: 'Identité', exact: true })
    .click();
  await noteAccess.click();
  await expect(drawer.getByRole('textbox')).toHaveValue(
    'Précision conservée pendant la navigation.'
  );
  await expect(page).toHaveURL(/tab=identity/);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('note drawer retains the draft after failure, blocks duplicate save and restores focus', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.edited.set(id, {
    sponsor_message:
      'Message de démonstration du commanditaire.\nNous souhaitons soutenir le projet et discuter de notre contribution.'
  });
  options.reviewStatus = 503;
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path());
  const opener = page.locator('[data-og7="dossier-note"]');
  await opener.click();
  const drawer = page.locator('dialog[open]');
  await expect(drawer.getByRole('status')).toHaveText(
    'Aucune note pour le moment.'
  );
  await drawer.getByRole('textbox').fill('Note de test conservée');
  await expect(drawer.getByRole('status')).toHaveText(
    'Modifications non enregistrées'
  );
  await drawer.getByRole('button', { name: 'Enregistrer la note' }).click();
  await expect(
    drawer.getByRole('button', { name: 'Enregistrement...' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  release();
  await expect(drawer).toContainText('Conflict');
  await expect(drawer.getByRole('textbox')).toHaveValue(
    'Note de test conservée'
  );
  expect(calls.filter((c) => c.url.pathname.endsWith('/review'))).toHaveLength(
    1
  );
  options.reviewGate = null;
  options.reviewStatus = 200;
  options.edited.set(id, {
    ...options.edited.get(id),
    sponsor_review_note: 'Note de test conservée'
  });
  await drawer.getByRole('button', { name: 'Enregistrer la note' }).click();
  await expect(drawer.getByRole('status')).toHaveText('Note enregistrée.');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(
    calls.filter((c) => c.url.pathname.endsWith('/review'))[1]?.body?.[
      'reviewNote'
    ]
  ).toBe('Note de test conservée');
  await opener.click();
  await drawer.getByRole('textbox').fill('Nouvelle précision à conserver');
  await expect(drawer.getByRole('status')).toHaveText(
    'Modifications non enregistrées'
  );
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(drawer.getByRole('textbox')).toHaveValue(
    'Nouvelle précision à conserver'
  );
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(drawer.getByRole('textbox')).toHaveValue(
    'Nouvelle précision à conserver'
  );
  await expect(drawer.getByRole('status')).toHaveText(
    'Modifications non enregistrées'
  );
  expect(calls.filter((c) => c.url.pathname.endsWith('/review'))).toHaveLength(
    2
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await drawer.screenshot({
      path: `test-results/dossier-notes-${width}.png`
    });
  }
  await page.keyboard.press('Escape');
  await tabs(page)
    .getByRole('button', { name: 'Identité', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="identity-sponsor-message"]')
  ).toContainText('Message de démonstration du commanditaire.');
});

for (const [language, width] of [
  ['fr-CA', 1280],
  ['en', 390]
] as const) {
  test(`note editor exposes its limit and keeps an unsaved draft in ${language} at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path());
    const english = language === 'en';
    if (english)
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    const opener = page.locator('[data-og7="dossier-note"]');
    await opener.click();
    const drawer = page.getByRole('dialog', {
      name: english ? 'Internal note' : 'Note interne',
      exact: true
    });
    const field = drawer.getByRole('textbox', {
      name: english ? 'Follow-up note' : 'Note de suivi'
    });
    await expect(drawer).toContainText('Atelier Boréal');
    await expect(drawer).toContainText('DEMO-401');
    await expect(field).toHaveAccessibleDescription(/1000/);
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    const draft = english
      ? 'Follow up with the sponsor on Friday.\nConfirm the contact for the publication.'
      : 'Recontacter le commanditaire vendredi.\nConfirmer la personne responsable de la publication.';
    await field.fill(draft);
    await expect(drawer).toContainText(`${draft.length} / 1000`);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await drawer.screenshot({
      path: `test-results/note-editor-${language}-${width}.png`
    });
    await field.fill('a'.repeat(999));
    await field.press('End');
    await field.pressSequentially('bc');
    await expect(field).toHaveValue('a'.repeat(999) + 'b');
    await expect(drawer).toContainText('1000 / 1000');
    expect(
      await drawer.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await drawer
      .getByRole('button', { name: english ? 'Close' : 'Fermer', exact: true })
      .click();
    await expect(opener).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await opener.press('Enter');
    await expect(field).toHaveValue('a'.repeat(999) + 'b');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('media and history inspections stay inside the selected dossier', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.media = [mediaAsset()];
  await page.goto(path('media'));
  await expect(page.locator('[data-og7="media-tile"]')).toHaveCount(1);
  await expect(page.locator('[data-og7="dossier-main"]')).toBeVisible();
  await tabs(page).getByRole('button', { name: 'Historique' }).click();
  await page
    .locator('[data-og7="dossier-audit-history"]')
    .getByRole('button', { name: 'Consulter le journal', exact: true })
    .click();
  await expect(page.locator('dialog[open]')).toContainText(
    'Aucune entrée d’audit disponible'
  );
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/tab=audit/);
});

test('six dossier workspaces use direct URLs; invoice is complete before review; browsing makes no writes', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path('billing'));
  await expect(tabs(page).getByRole('button')).toHaveCount(6);
  await expect(
    page.getByRole('group', { name: 'Revue', exact: true })
  ).toHaveAttribute('data-review-state', 'pending_review');
  await expect(page.locator('#dossier-billing')).toContainText('FAC-DEMO-401');
  await tabs(page)
    .getByRole('button', { name: 'Identité', exact: true })
    .click();
  await expect(page).toHaveURL(/tab=identity/);
  await expect(page.locator('[data-og7="dossier-identity"]')).toBeVisible();
  await tabs(page)
    .getByRole('button', { name: 'Fiche et médias', exact: true })
    .click();
  await expect(page.locator('[data-og7="media-review-workspace"]')).toHaveCount(
    1
  );
  await page.reload();
  await expect(
    tabs(page).getByRole('button', { name: 'Fiche et médias', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});

for (const width of [1280, 390]) {
  test(`dossier tabs preserve scroll and keyboard focus at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('media'));
    const navigation = tabs(page);
    await expect(
      navigation.getByRole('button', { name: 'Fiche et médias', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await navigation.evaluate((element) =>
      window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - 280,
        behavior: 'instant'
      })
    );
    let refundPosition = 0;
    for (const [index, tab] of [
      'overview',
      'identity',
      'media',
      'publication',
      'billing',
      'audit',
      'audit'
    ].entries()) {
      const button = navigation
        .getByRole('button')
        .nth(
          [
            'overview',
            'identity',
            'media',
            'publication',
            'billing',
            'audit'
          ].indexOf(tab)
        );
      // Keep the target clear of the floating decision controls before measuring
      // the viewport that the route must preserve.
      await button.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      await button.focus();
      await expect
        .poll(() =>
          button.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2
              )
            );
          })
        )
        .toBe(true);
      const before = await page.evaluate(() => window.scrollY);
      if (tab === 'billing') refundPosition = before;
      expect(before).toBeGreaterThanOrEqual(0);
      if (index % 2) await button.press('Enter');
      else await button.click();
      await expect(page).toHaveURL(path(tab));
      await expect(button).toHaveAttribute('aria-current', 'page');
      // Let the router's scheduled scrolling and the new panel layout complete.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      const position = await page.evaluate(() => ({
        y: window.scrollY,
        maximum: Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight
        )
      }));
      expect(position.y).toBeCloseTo(Math.min(before, position.maximum), 0);
      await expect(button).toBeFocused();
      await expect(button).toBeInViewport();
    }
    await page.goBack();
    await expect(page).toHaveURL(path('billing'));
    await expect
      .poll(() =>
        page.evaluate(
          (expected) =>
            Math.abs(
              window.scrollY -
                Math.min(
                  expected,
                  document.documentElement.scrollHeight - window.innerHeight
                )
            ),
          refundPosition
        )
      )
      .toBeLessThan(1);
    await page.goForward();
    await expect(page).toHaveURL(path('audit'));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    // Leaving the dossier must still use the normal router scroll behavior.
    await page
      .getByRole('link', { name: 'Assistant', exact: true })
      .last()
      .click();
    await expect(page).toHaveURL(
      '/admin/fundraiser/assistant?sponsorshipId=' +
        id +
        '&returnTo=' +
        encodeURIComponent(path('audit'))
    );
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
}

for (const width of [1280, 390]) {
  test(`overview replaces detailed states and leaves work to the responsible tabs at ${width}px`, async ({
    page
  }, testInfo) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    const query =
      '&returnTo=' +
      encodeURIComponent(
        '/admin/fundraiser/assistant?type=sponsorship_needs_review'
      );
    await page.goto(path() + query);
    const overview = page.locator('openg7-admin-sponsor-detail-overview');
    await expect(overview.locator('[data-og7="overview-stat"]')).toHaveCount(6);
    await expect(
      overview.locator('[data-og7="overview-stat"][data-og7-id="steps"]')
    ).toContainText(/4\s*\/\s*6/);
    await expect(overview.locator('[data-og7="overview-domain"]')).toHaveCount(
      5
    );
    await expect(overview.locator('details, textarea, input')).toHaveCount(0);
    await expect(
      page.locator('[data-og7="dossier-progress-details"]:visible')
    ).toHaveCount(0);
    await expect(
      page.locator('[data-og7="dossier-service-summary"]')
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`dossier-overview-${width}.png`),
      animations: 'disabled'
    });
    for (const [tab, label] of [
      ['identity', 'Identité'],
      ['media', 'Fiche et médias'],
      ['publication', 'Publication'],
      ['billing', 'Finances'],
      ['audit', 'Historique']
    ]) {
      const button = tabs(page).getByRole('button', {
        name: label,
        exact: true
      });
      await button.focus();
      await button.press('Enter');
      await expect(page).toHaveURL(path(tab) + query);
      await expect(button).toBeFocused();
      await expect(overview).toHaveCount(0);
    }
    await tabs(page)
      .getByRole('button', { name: 'Aperçu', exact: true })
      .click();
    await expect(overview).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const width of [1280, 390]) {
  test(`next step reveals and focuses review across tabs and on repeated clicks at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    const returnTo =
      '/admin/fundraiser/attention?type=sponsorship_needs_review';
    const query = '&returnTo=' + encodeURIComponent(returnTo);
    await page.goto(path('billing') + query);
    const next = dossierNext(page);
    await expect(next).toHaveText('Voir les actions de validation');
    await expect(next).toHaveAttribute(
      'href',
      path('publication') + query + '#dossier-review'
    );
    const target = page.locator('#dossier-review');
    for (const keyboard of [false, true]) {
      await tabs(page)
        .getByRole('button', { name: 'Finances', exact: true })
        .click();
      await expect(next).toBeVisible();
      await next.scrollIntoViewIfNeeded();
      await next.focus();
      if (keyboard) await next.press('Enter');
      else await next.click();
      await expect(page).toHaveURL(
        path('publication') + query + '#dossier-review'
      );
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Tab');
      await expect(
        actions(page).getByRole('button', { name: 'Refuser', exact: true })
      ).toBeFocused();
    }
    // Leaving a section via a normal tab keeps the viewport instead of replaying the anchor.
    const billing = tabs(page).getByRole('button', {
      name: 'Finances',
      exact: true
    });
    await billing.scrollIntoViewIfNeeded();
    await billing.focus();
    const before = await page.evaluate(() => scrollY);
    await billing.click();
    await expect(page).toHaveURL(path('billing') + query);
    await expect(billing).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(
          (position) =>
            Math.abs(
              scrollY -
                Math.min(
                  position,
                  document.documentElement.scrollHeight - innerHeight
                )
            ),
          before
        )
      )
      .toBeLessThan(2);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

const nextDestinations = [
  ['payment_unconfirmed', 'overview', 'billing', 'billing'],
  ['stripe_failed', 'overview', 'billing', 'stripe'],
  ['identity_missing', 'identity', 'identity', 'identity'],
  ['media_review', 'media', 'media', 'media'],
  ['credit_missing', 'billing', 'billing', 'billing'],
  ['publication_pending', 'publication', 'publication', 'publication'],
  ['refund_check', 'refund', 'billing', 'billing']
] as const;

for (const [reason, sourceTab, tab, section] of nextDestinations) {
  test(`overview priority reaches its responsible section: ${reason}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.next = { reason, tab: sourceTab, adminUrl: path(sourceTab) };
    if (reason === 'stripe_failed')
      options.progressOverrides = {
        failedStripeEvents: [
          { id: 'evt_synthetic_failed', type: 'payment_intent.succeeded' }
        ]
      };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path());
    const action = page.locator('[data-og7="overview-priority-action"]');
    await expect(action).toHaveCount(1);
    await action.focus();
    await action.press('Enter');
    await expect(page).toHaveURL(path(tab) + '#dossier-' + section);
    await expect(page.locator('#dossier-' + section)).toBeFocused();
    await expect(page.locator('#dossier-' + section)).toBeInViewport();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('a direct next-step section waits for dossier data before receiving focus', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  let releaseList!: () => void;
  let releaseProgress!: () => void;
  options.listGate = new Promise((resolve) => {
    releaseList = resolve;
  });
  options.progressGate = new Promise((resolve) => {
    releaseProgress = resolve;
  });
  await page.goto(path('publication') + '#dossier-review');
  await expect(page).toHaveURL(path('publication') + '#dossier-review');
  await expect(page.locator('#dossier-review')).toHaveCount(0);
  releaseList();
  await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
  releaseProgress();
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('a direct section link works for a reader after reload without enabling mutations', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'reader');
  await page.goto(path('publication') + '#dossier-review');
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toContainText('À réviser');
  await expect(actions(page).getByRole('button')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('leaving a pending section cancels its delayed focus request', async ({
  page
}) => {
  const { options } = await fixtures(page);
  let release!: () => void;
  options.progressGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path('publication') + '#dossier-review');
  await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
  const identity = tabs(page).getByRole('button', {
    name: 'Identité',
    exact: true
  });
  await identity.click();
  await expect(page).toHaveURL(path('identity'));
  release();
  await expect(progress(page)).toBeHidden();
  await expect(identity).toBeFocused();
  await expect(page.locator('#dossier-review')).toHaveCount(0);
});

test('a delayed section response cannot move focus into a newly selected dossier', async ({
  page
}) => {
  const { options, calls } = await fixtures(page, 'reader');
  let release!: () => void;
  options.progressGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path('publication') + '#dossier-review');
    await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-og7="overview-priority"]')).toHaveCount(0);
    await page.locator('[data-og7="dossier-back"]').click();
    await page
      .locator('[data-og7="sponsors-list"]')
      .locator(`[data-og7="sponsor-row"][data-og7-id="${secondId}"]`)
      .click();
    await expect(page).toHaveURL(path('overview', secondId));
    const detail = page.locator('[data-og7="sponsorship-dossier"]');
    await expect(detail).toBeFocused();
    await expect(progress(page)).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Atelier Rivage'
    );
    await expect(page.locator('[data-og7="overview-priority"]')).toHaveCount(1);
    await expect(
      page.locator('[data-og7="overview-priority-action"]')
    ).toHaveCount(0);
    // The new dossier uses normal router scrolling; wait for its smooth return to the top.
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const before = await page.evaluate(() => scrollY);
    const late = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/admin/sponsorships/progress' &&
        url.searchParams.get('sponsorshipId') === id
      );
    });
    release();
    options.progressGate = null;
    await (await late).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(detail).toBeFocused();
    await expect(page.locator('#dossier-review')).toHaveCount(0);
    await expect(page).toHaveURL(path('overview', secondId));
    await expect(page.locator('[data-og7="overview-priority"]')).toHaveCount(1);
    await expect(
      page.locator('[data-og7="overview-priority-action"]')
    ).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeCloseTo(before, 0);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  } finally {
    release();
    options.progressGate = null;
  }
});

test('browser history restores the viewport after visiting a next-step section', async ({
  page
}) => {
  await fixtures(page);
  // Measure saved history positions without a smooth scroll still in flight.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(path('billing'));
  const next = dossierNext(page);
  await next.scrollIntoViewIfNeeded();
  // Start away from the top and keep the link visible so clicking cannot scroll it.
  await next.evaluate((element) => {
    element.focus({ preventScroll: true });
    window.scrollTo({
      top: scrollY + element.getBoundingClientRect().top - 120,
      behavior: 'instant'
    });
  });
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(0);
  await next.click();
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  const destination = await page.evaluate(() => scrollY);
  expect(Math.abs(destination - before)).toBeGreaterThan(1);
  await page.goBack();
  await expect(page).toHaveURL(path('billing'));
  await expect(
    tabs(page).getByRole('button', { name: 'Finances', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#dossier-review')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.goForward();
  await expect(page).toHaveURL(path('publication') + '#dossier-review');
  await expect(
    tabs(page).getByRole('button', { name: 'Publication', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeCloseTo(destination, 0);
});

test('completed dossiers show a discreet confirmation with no current action in both languages', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.next = { reason: 'complete', tab: 'overview', adminUrl: path() };
  options.milestones = dossier().milestones.map((step) => ({
    ...step,
    state: 'complete'
  }));
  options.progressOverrides = {
    publicationBlockers: [],
    publicationWorkflow: {
      state: 'complete',
      reason: 'publication_done',
      responsibility: 'none',
      obligations: []
    },
    website: {
      visible: true,
      held: false,
      canPublish: false,
      version: 'complete-fixture',
      blockers: []
    },
    failedEmails: [],
    failedStripeEvents: [],
    refund: {
      workflow: 'none',
      state: 'not_required',
      confirmedAmountMinor: 0,
      creditMissing: false,
      hasError: false
    }
  };
  await page.goto(path());
  const priority = page.locator('[data-og7="overview-priority"]');
  await expect(priority).toHaveAttribute('data-state', 'complete');
  await expect(
    page.locator('[data-og7="overview-priority-action"]')
  ).toHaveCount(0);
  await expect(
    page.locator('[data-og7="overview-stat"][data-og7-id="steps"]')
  ).toContainText(/6\s*\/\s*6/);
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(priority).not.toContainText('admin.dossier.');
  await expect(
    page.locator('[data-og7="overview-priority-action"]')
  ).toHaveCount(0);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('a cancelled publication without a qualified agreement remains unresolved while refund, credit and failed email stay linked to the dossier', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(path('publication'));
  const monitor = page.locator('[data-og7="publication-monitor"]');
  await expect(
    monitor.locator('[data-og7="publication-monitor-summary"]')
  ).toHaveAttribute('data-state', 'agreement_unknown');
  await expect(monitor.locator('[data-og7="publication-service"]')).toHaveCount(
    0
  );
  await expect(monitor.getByRole('progressbar')).toHaveCount(0);
  await expect(
    monitor.getByRole('link', { name: 'Consulter l’historique', exact: true })
  ).toHaveAttribute('href', path('audit'));
  await tabs(page)
    .getByRole('button', { name: 'Finances', exact: true })
    .click();
  await expect(page.locator('#dossier-refund')).toContainText('200,00');
  await expect(page.locator('#dossier-refund')).toContainText('Partiel');
  await tabs(page)
    .getByRole('button', { name: 'Finances', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Consulter le courriel en échec.' })
  ).toHaveAttribute('href', new RegExp(`messageId=${secondId}`));
  await expect(
    page.getByRole('link', { name: 'Ouvrir la facturation du dossier' })
  ).toHaveAttribute('href', new RegExp(`contributionId=${id}`));
});

test('return to filtered queue survives tab navigation and badge counts refresh after confirmed review', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  const destination =
    '/admin/fundraiser/attention?type=sponsorship_needs_review&priority=today&page=2';
  await page.goto(path() + '&returnTo=' + encodeURIComponent(destination));
  await expect(
    page.locator('[data-og7="nav-count"][data-og7-id="sponsors"]')
  ).toHaveText('3');
  await tabs(page)
    .getByRole('button', { name: 'Finances', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="return-to-attention"]')
  ).toHaveAttribute('href', destination);
  options.reviewStatus = 200;
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  await page.getByRole('button', { name: 'Accepter', exact: true }).click();
  await expect(page.locator('[data-og7="moderation-decision"]')).toBeVisible();
  expect(postsTo(calls, '/review')).toHaveLength(0);
  await completeModeration(page);
  await expect.poll(() => postsTo(calls, '/review').length).toBe(1);
  expect(postsTo(calls, '/review')[0]?.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    confirmation: id,
    moderationDecision: {
      policyVersion: '1.0',
      contentVersion: 3,
      contentFingerprint: 'a'.repeat(64),
      level: 'N0',
      confirmation: id
    }
  });
  await expect(
    page.locator('[data-og7="nav-count"][data-og7-id="sponsors"]')
  ).toHaveText('3');
  options.queueCount = 0;
  release();
  await expect(
    page.locator('[data-og7="nav-count"][data-og7-id="sponsors"]')
  ).toHaveCount(0);
  const reviews = postsTo(calls, '/review');
  expect(reviews).toHaveLength(1);
  expect(reviews[0]!.body).toMatchObject({
    contributionId: id,
    reviewStatus: 'approved',
    confirmation: id,
    moderationDecision: { level: 'N0' }
  });
  await page.locator('[data-og7="return-to-attention"]').click();
  await expect(page).toHaveURL(destination);
});

test('version conflict offers reload; pending action is disabled and retry uses the new version', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  let release!: () => void;
  options.reviewGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto(path('publication'));
  const approve = page.getByRole('button', { name: 'Accepter', exact: true });
  await approve.click();
  await completeModeration(page);
  await expect(approve).toBeDisabled();
  release();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le dossier a changé' })
  ).toBeVisible();
  options.version = 'v2';
  options.reviewGate = null;
  await page
    .getByRole('alert')
    .getByRole('button', { name: 'Actualiser le dossier' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le dossier a changé' })
  ).toHaveCount(0);
  options.reviewStatus = 200;
  await approve.click();
  await completeModeration(page);
  await expect(approve).toBeEnabled();
  expect(
    calls
      .filter((c) => c.url.pathname.endsWith('/review'))
      .map((c) => c.body?.['expectedVersion'])
  ).toEqual(['v1', 'v2']);
});

test('returning to the cockpit preserves the dossier selection without fetching its details and logout clears it', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path('billing', secondId));
  await expect(page.locator('#dossier-billing')).toContainText('FAC-DEMO-401');
  const dossierReads = calls.filter((c) =>
    c.url.pathname.endsWith('/progress')
  ).length;
  await page
    .getByRole('navigation', { name: 'Navigation admin du fonds' })
    .getByRole('link', { name: 'Cockpit', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Cockpit', exact: true })
  ).toBeVisible();
  await expect(page.locator('[data-og7="dashboard-refresh"]')).toBeEnabled();
  await expect(progress(page)).toHaveCount(0);
  expect(calls.filter((c) => c.url.pathname.endsWith('/progress')).length).toBe(
    dossierReads
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-selected-sponsorship')
    )
  ).toBe(secondId);
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-selected-sponsorship')
    )
  ).toBeNull();
});

test('dossier progress keeps empty and unavailable states explicit', async ({
  page
}) => {
  const { options } = await fixtures(page);
  await page.goto(path());
  await expect(
    page.getByRole('heading', { name: 'Atelier Boréal', exact: true })
  ).toBeVisible();
  options.state = 'empty';
  await page.locator('[data-og7="dossier-refresh"]').click();
  await expect(progress(page)).toContainText(
    'Aucune commandite ne demande une action'
  );
  options.status = 503;
  await page.locator('[data-og7="dossier-refresh"]').click();
  await expect(progress(page).getByRole('alert')).toContainText('indisponible');
  await expect(progress(page).locator('ol')).toHaveCount(0);
});

test('denied progress clears facts and expired session returns to login', async ({
  page
}) => {
  const { options } = await fixtures(page);
  await page.goto(path('billing'));
  await expect(page.locator('#dossier-billing')).toContainText('FAC-DEMO-401');
  await expect(page.locator('[data-og7="dossier-recommendation"]')).toHaveCount(
    1
  );
  options.status = 403;
  await page.locator('[data-og7="dossier-refresh"]').click();
  await expect(progress(page).getByRole('alert')).toBeVisible();
  await expect(progress(page).getByRole('alert')).toContainText('pas accès');
  await expect(page.locator('[data-og7="dossier-recommendation"]')).toHaveCount(
    0
  );
  await expect(page.locator('#dossier-billing')).toHaveCount(0);
  options.status = 401;
  await page.locator('[data-og7="dossier-refresh"]').click();
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('refreshing progress clears invoice facts until the server responds', async ({
  page
}) => {
  const { options, calls } = await fixtures(page);
  await page.goto(path('billing'));
  await expect(page.locator('#dossier-billing')).toContainText('FAC-DEMO-401');
  await expect(page.locator('[data-og7="dossier-recommendation"]')).toHaveCount(
    1
  );
  let release!: () => void;
  options.progressGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.locator('[data-og7="dossier-refresh"]').click();
    await expect(progress(page)).toHaveAttribute('aria-busy', 'true');
    await expect(progress(page)).toBeVisible();
    await expect(progress(page).getByRole('status')).toContainText(
      'Chargement du dossier'
    );
    await expect(page.locator('#dossier-billing')).toHaveCount(0);
    await expect(
      page.locator('[data-og7="dossier-recommendation"]')
    ).toHaveCount(0);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  } finally {
    release();
    options.progressGate = null;
  }
  await expect(page.locator('#dossier-billing')).toContainText('FAC-DEMO-401');
  await expect(page.locator('[data-og7="dossier-recommendation"]')).toHaveCount(
    1
  );
});

test('English dossier next step supports keyboard at mobile width without horizontal overflow', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('billing'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const next = dossierNext(page);
  await expect(next).toHaveAccessibleName('View review actions');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=publication/);
  await expect(page.locator('#dossier-review')).toBeFocused();
  await expect(page.locator('#dossier-review')).toBeInViewport();
  await expect(
    tabs(page).getByRole('button', { name: 'Publication', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/lot4-mobile.png',
    fullPage: true
  });
});

test('intervention journal records actions with actor and date, retains notes across tabs and supports extension', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'operator');
  await page.goto(path('refund'));
  const journal = page.locator('[data-og7="dossier-interventions"]');
  const journalToggle = journal.locator('[data-og7="interventions-toggle"]');
  await expect(journalToggle).toHaveAttribute('aria-expanded', 'false');
  await journalToggle.focus();
  await journalToggle.press('Enter');
  await expect(journalToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(journal).toContainText('Dossier incomplet — décision requise');
  await expect(journal.locator('[data-og7="intervention-kind"]')).toHaveValue(
    'internal'
  );
  await expect(journal).toContainText('Envoi en échec');
  await expect(
    journal.locator('[data-og7="interventions-access"]')
  ).toHaveCount(0);
  await journal.locator('[data-og7="intervention-kind"]').selectOption('phone');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Appel effectué. Le commanditaire demande un délai.');
  await page.keyboard.press('Escape');
  await tabs(page)
    .getByRole('button', { name: 'Historique', exact: true })
    .click();
  await journalToggle.click();
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    'Appel effectué. Le commanditaire demande un délai.'
  );
  await journal.locator('[data-og7="intervention-save"]').focus();
  await page.keyboard.press('Enter');
  await expect(
    journal.locator('[data-og7="interventions-history"]')
  ).toContainText('Operator fixture');
  await expect(journal.locator('time')).toHaveAttribute('datetime', date);
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    ''
  );
  await expect(
    journal.locator('[data-og7="intervention-save"]')
  ).toBeDisabled();
  await journal
    .locator('[data-og7="intervention-kind"]')
    .selectOption('extension');
  await journal.locator('[data-og7="intervention-date"]').fill('2099-01-01');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Nouvelle échéance convenue.');
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(
    journal.locator('[data-og7="interventions-state"]')
  ).toContainText('délai supplémentaire');
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(2);
  await expect(journal.locator('[data-og7="intervention-kind"]')).toHaveValue(
    'internal'
  );
  const writes = calls.filter((c) => c.method === 'POST');
  expect(
    writes.filter((c) => c.url.pathname.endsWith('/interventions'))
  ).toHaveLength(2);
  expect(
    writes.filter((c) =>
      /refund|followup-access|request-information/.test(c.url.pathname)
    )
  ).toHaveLength(0);
});

test('intervention journal retries the same request after an uncertain save and blocks a double submit', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'owner');
  options.journalSaveStatus = 503;
  await page.goto(path('audit'));
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await journal.locator('[data-og7="interventions-toggle"]').click();
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Relance effectuée, réponse attendue.');
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(journal.getByRole('alert')).toContainText(
    'enregistrement n’est pas confirmé'
  );
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    'Relance effectuée, réponse attendue.'
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-og7="dossier-refresh"]').click();
  await journal.locator('[data-og7="interventions-toggle"]').click();
  await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
    'Relance effectuée, réponse attendue.'
  );
  options.journalSaveStatus = 200;
  let release!: () => void;
  options.journalGate = new Promise((resolve) => {
    release = resolve;
  });
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(
    journal.locator('[data-og7="intervention-save"]')
  ).toBeDisabled();
  release();
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(1);
  const saves = calls.filter(
    (c) => c.method === 'POST' && c.url.pathname.endsWith('/interventions')
  );
  expect(saves).toHaveLength(2);
  expect(saves[1].body?.requestId).toBe(saves[0].body?.requestId);
});

for (const status of [401, 403])
  test(`intervention journal clears private drafts on ${status}`, async ({
    page
  }) => {
    const { options } = await fixtures(page, 'operator');
    await page.goto(path('audit'));
    const journal = page.locator('[data-og7="dossier-interventions"]');
    await journal.locator('[data-og7="interventions-toggle"]').click();
    await journal
      .locator('[data-og7="intervention-note"]')
      .fill('Private synthetic draft');
    options.journalSaveStatus = status;
    await journal.locator('[data-og7="intervention-save"]').click();
    if (status === 401) await expect(page).toHaveURL(/admin\/login/);
    else {
      await expect(journal.getByRole('alert')).toBeVisible();
      await expect(journal.locator('textarea')).toHaveCount(0);
    }
  });

test('intervention journal keeps older notes readable for a reader and renders note text safely', async ({
  page
}) => {
  const { options, calls } = await fixtures(page, 'reader');
  options.journal.set(
    id,
    Array.from({ length: 27 }, (_, i) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      actor: 'Operator fixture',
      recordedAt: date,
      kind: 'internal',
      note:
        i === 26 ? '<img src=x onerror=alert(1)> Historical note' : `Note ${i}`,
      nextReviewOn: null
    }))
  );
  const ready = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/sponsorships/progress' &&
      response.status() === 200
  );
  await page.goto(path('refund'));
  await (await ready).finished();
  const journal = page.locator('[data-og7="dossier-interventions"]');
  const journalToggle = journal.locator('[data-og7="interventions-toggle"]');
  await expect(journalToggle).toHaveAttribute('aria-expanded', 'false');
  await journalToggle.focus();
  await journalToggle.press('Enter');
  await expect(journalToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(journal.locator('[data-og7="intervention-form"]')).toHaveCount(
    0
  );
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(25);
  await journal.locator('[data-og7="interventions-more"]').click();
  await expect(
    journal.locator('[data-og7="interventions-history"] li')
  ).toHaveCount(27);
  await expect(journal).toContainText(
    '<img src=x onerror=alert(1)> Historical note'
  );
  await expect(journal.locator('img')).toHaveCount(0);
  expect(
    calls.filter(
      (c) => c.method === 'POST' && c.url.pathname.endsWith('/interventions')
    )
  ).toHaveLength(0);
});

test('intervention journal rejects a late response for another dossier and recovers from a read failure', async ({
  page
}) => {
  const { options, calls } = await fixtures(page);
  let release!: () => void;
  options.journalReadGate = new Promise((resolve) => {
    release = resolve;
  });
  options.journal.set(id, [
    {
      id,
      actor: 'Fixture',
      recordedAt: date,
      kind: 'internal',
      note: 'OLD DOSSIER PRIVATE NOTE',
      nextReviewOn: null
    }
  ]);
  await page.goto('/admin/fundraiser/sponsors?tab=audit');
  await page.locator('[data-og7="sponsor-row"]').first().click();
  const journal = page.locator('[data-og7="dossier-interventions"]');
  const drawer = journal.locator('[data-og7="admin-drawer"]');
  await journal.locator('[data-og7="interventions-toggle"]').click();
  await expect
    .poll(() => calls.some((c) => c.url.pathname.endsWith('/interventions')))
    .toBe(true);
  // The GET starts before the drawer reaches the native modal top layer.
  await expect(drawer).toHaveJSProperty('open', true);
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveJSProperty('open', false);
  await expect(drawer).toBeHidden();
  await page
    .getByRole('button', { name: 'Dossier suivant', exact: true })
    .click();
  await journal.locator('[data-og7="interventions-toggle"]').click();
  await expect(journal).toContainText('Aucune intervention consignée');
  release();
  await expect(journal).not.toContainText('OLD DOSSIER PRIVATE NOTE');
  options.journalReadStatus = 503;
  await page.reload();
  await journal.locator('[data-og7="interventions-toggle"]').click();
  await expect(journal.getByRole('alert')).toContainText('actualisé');
  options.journalReadStatus = 200;
  await journal
    .getByRole('button', { name: 'Actualiser le journal', exact: true })
    .click();
  await expect(journal.getByRole('alert')).toHaveCount(0);
});

test('intervention journal is usable in English on mobile', async ({
  page
}) => {
  await fixtures(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('audit'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const journal = page.locator('[data-og7="dossier-interventions"]');
  await journal.locator('[data-og7="interventions-toggle"]').click();
  await expect(journal).toContainText('Incomplete record — decision required');
  await journal
    .locator('[data-og7="intervention-note"]')
    .fill('Sponsor contacted. Awaiting reply.');
  await journal.locator('[data-og7="intervention-save"]').click();
  await expect(
    journal.locator('[data-og7="interventions-history"]')
  ).toContainText('Sponsor contacted. Awaiting reply.');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  await journal
    .locator('dialog')
    .screenshot({ path: 'test-results/interventions-mobile.png' });
});

test('a late progress response cannot overwrite a newly selected dossier or reset list filters', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  let release!: () => void;
  options.progressGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto('/admin/fundraiser/sponsors');
  await page.locator('[data-og7="sponsor-row"]').first().click();
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.url.pathname.endsWith('/progress') &&
          c.url.searchParams.get('sponsorshipId') === id
      )
    )
    .toBe(true);
  await page
    .getByRole('button', { name: 'Dossier suivant', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="sponsorship-dossier"]')
  ).toHaveAttribute('data-og7-id', secondId);
  await expect(
    page.locator('[data-og7="overview-priority-action"]')
  ).toHaveCount(1);
  release();
  await tabs(page)
    .getByRole('button', { name: 'Finances', exact: true })
    .click();
  await expect(dossierNext(page)).toHaveAttribute(
    'href',
    new RegExp(`sponsorshipId=${secondId}`)
  );
  expect(
    calls.filter((c) => c.url.pathname === '/api/admin/sponsorships')
  ).toHaveLength(1);
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.screenshot({
    path: 'test-results/lot4-dossier-desktop.png',
    fullPage: true
  });
});

/** Captured synthetic terms are independent of today's pricing thresholds. */
function recordedCommitment(
  amountMinor = 50000,
  socialBenefits = true
): SponsorshipCommitmentRecord {
  const commitmentId = '10000000-0000-4000-8000-000000000450';
  const definitions: readonly Pick<
    SponsorshipOfferedBenefit,
    'id' | 'channel'
  >[] = [
    { id: 'website_mention', channel: 'website' },
    ...(socialBenefits
      ? ([
          { id: 'facebook_batch', channel: 'facebook' },
          { id: 'linkedin_batch', channel: 'linkedin' }
        ] as const)
      : [])
  ];
  const benefits: SponsorshipOfferedBenefit[] = definitions.map((benefit) => ({
    ...benefit,
    target: 'openg7',
    quantity: 1,
    requiredElements: ['company_name', 'approved_presentation'],
    deadlineDays: null,
    durationDays: null,
    ...(benefit.channel === 'website'
      ? {}
      : { format: 'collective_text' as const })
  }));
  return {
    id: commitmentId,
    contributionId: id,
    offerId: '10000000-0000-4000-8000-000000000452',
    provenance: 'accepted_offer',
    state: 'active',
    qualificationReason: null,
    version: 1,
    offer: {
      version: 'synthetic-captured-offer-v1',
      amountMinor,
      currency: 'CAD',
      benefits
    },
    obligations: benefits.map((benefit, index) => ({
      id: `10000000-0000-4000-8000-${String(451 + index).padStart(12, '0')}`,
      commitmentId,
      contributionId: id,
      benefitId: benefit.id,
      channel: benefit.channel,
      target: benefit.target,
      ordinal: 1,
      state: 'pending',
      format: benefit.format ?? null,
      blockedReason: null,
      version: 1,
      fulfilmentEvidenceId: null
    }))
  };
}

/** Synthetic server qualification, distinct from the requested visibility. */
function qualifiedWebsiteProgress(
  progress: Partial<AdminSponsorshipProgress>
): Partial<AdminSponsorshipProgress> {
  const commitment = progress.commitment;
  const obligation = commitment?.obligations.find(
    (item) => item.channel === 'website'
  );
  if (!commitment || !obligation) return {};
  const evidenceId = '10000000-0000-4000-8000-000000000461';
  return {
    commitment: {
      ...commitment,
      obligations: commitment.obligations.map((item) =>
        item.id === obligation.id
          ? { ...item, state: 'fulfilled', fulfilmentEvidenceId: evidenceId }
          : item
      )
    },
    qualifiedFulfilmentEvidenceIds: [
      ...new Set([
        ...(progress.qualifiedFulfilmentEvidenceIds ?? []),
        evidenceId
      ])
    ],
    fulfilmentEvidence: [
      ...(progress.fulfilmentEvidence ?? []).filter(
        (item) => item.id !== evidenceId
      ),
      {
        id: evidenceId,
        obligationId: obligation.id,
        deliveryId: null,
        channel: 'website',
        target: obligation.target,
        provenance: 'website_verified',
        deliveredAt: date,
        externalPostUrl: null,
        visibility: 'visible',
        visibilityObservedAt: date
      }
    ]
  };
}

for (const width of [1280, 390]) {
  test(`publication monitor shows promised passages and directs exceptions to their owner at ${width}px`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.progressOverrides = {
      commitment: recordedCommitment(10000),
      publicationCompletion: { done: 0, total: 3 },
      publicationBlockers: ['media'],
      publications: []
    };
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('publication'));
    const view = page.locator('[data-og7="publication-monitor"]');
    await expect(view.locator('[data-og7="publication-service"]')).toHaveCount(
      3
    );
    await expect(view.getByRole('progressbar')).toHaveAttribute('value', '0');
    await expect(view.getByRole('progressbar')).toHaveAttribute('max', '3');
    await expect(
      view.locator('[data-og7="publication-monitor-summary"]')
    ).toHaveAttribute('data-state', 'exception');
    const blockers = view.locator('[data-og7="publication-monitor-blockers"]');
    await expect(blockers).toBeVisible();
    const media = blockers.getByRole('link').first();
    await expect(media).toHaveAttribute(
      'href',
      path('media') + '#dossier-media'
    );
    await expect(view.locator('input, textarea, select')).toHaveCount(0);
    await tabs(page)
      .getByRole('button', { name: 'Aperçu', exact: true })
      .click();
    const mediaDomain = page.locator(
      '[data-og7="overview-domain"][data-og7-id="media"]'
    );
    await expect(mediaDomain.getByRole('button')).toBeEnabled();
    await expect(page.locator('[data-og7="publication-blockers"]')).toHaveCount(
      0
    );
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(mediaDomain).toHaveCount(0);

    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="publication-monitor"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await media.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(path('media') + '#dossier-media');
    await expect(page.locator('#dossier-media')).toBeFocused();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const [deliveryStatus, deliveryMode, expected, qualified] of [
  ['approved', 'live', 'approved', false],
  ['published', 'mock', 'simulated', false],
  ['published', 'live', 'delivered', true],
  ['published', 'live', 'exception', false],
  ['uncertain', 'live', 'exception', false],
  ['blocked', 'live', 'exception', false]
] as const) {
  test(`publication monitor displays ${deliveryStatus}/${deliveryMode} ${qualified ? 'with qualified evidence' : 'without qualified evidence'} without inventing success`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    const commitment = recordedCommitment();
    const obligation = commitment.obligations.find(
      (item) => item.channel === 'facebook'
    )!;
    const evidenceId = '10000000-0000-4000-8000-000000000460';
    options.progressOverrides = {
      commitment: {
        ...commitment,
        obligations: commitment.obligations.map((item) =>
          item.id === obligation.id && qualified
            ? { ...item, state: 'fulfilled', fulfilmentEvidenceId: evidenceId }
            : item
        )
      },
      fulfilmentEvidence: qualified
        ? [
            {
              id: evidenceId,
              obligationId: obligation.id,
              deliveryId: secondId,
              channel: 'facebook',
              target: 'openg7',
              provenance: 'provider_acknowledged',
              deliveredAt: date,
              externalPostUrl: 'https://example.invalid/post',
              visibility: 'unknown',
              visibilityObservedAt: null
            }
          ]
        : [],
      qualifiedFulfilmentEvidenceIds: qualified ? [evidenceId] : [],
      publicationCompletion: { done: qualified ? 1 : 0, total: 3 },
      publications: [
        {
          ...dossier().publications[0]!,
          obligationId: obligation.id,
          batchStatus: null,
          deliveryId: secondId,
          deliveryStatus,
          deliveryMode,
          feedPaused: true,
          deliveryError:
            deliveryStatus === 'blocked' ? 'UNKNOWN_PROVIDER_CODE' : null,
          publicUrl: 'https://example.invalid/post'
        }
      ]
    };
    await page.goto(path('publication'));
    const view = page.locator('[data-og7="publication-monitor"]');
    const row = view.locator(
      `[data-og7="publication-service"][data-og7-id="${obligation.id}"]`
    );
    await expect(row).toHaveAttribute('data-state', expected);
    await expect(view).not.toContainText('UNKNOWN_PROVIDER_CODE');
    await expect(view.getByRole('progressbar')).toHaveAttribute(
      'value',
      qualified ? '1' : '0'
    );
    if (qualified) {
      await row.locator('[data-og7="publication-service-action"]').click();
      const proof = page.locator('[data-og7="publication-monitor-proof"]');
      await expect(proof).toContainText(evidenceId);
      await expect(proof.getByRole('link')).toHaveAttribute(
        'href',
        'https://example.invalid/post'
      );
      await expect(proof.getByRole('link')).toHaveAttribute(
        'rel',
        'noopener noreferrer'
      );
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const [currency, language] of [
  ['CAD', 'fr-CA'],
  ['USD', 'en']
] as const) {
  test(`publication monitor keeps unrecorded ${currency} benefits unknown in ${language}`, async ({
    page
  }) => {
    const { options, calls } = await fixtures(page, 'reader');
    options.progressOverrides = {
      currency,
      commitment: null,
      publications: [],
      publicationCompletion: { done: 0, total: 0 }
    };
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    await page.goto(path('publication'));
    const view = page.locator('[data-og7="publication-monitor"]');
    await expect(
      view.locator('[data-og7="publication-monitor-summary"]')
    ).toHaveAttribute('data-state', 'agreement_unknown');
    await expect(view.locator('[data-og7="publication-service"]')).toHaveCount(
      0
    );
    await expect(view.getByRole('progressbar')).toHaveCount(0);
    const agreement = view
      .locator('[data-og7="publication-monitor-empty"]')
      .getByRole('link');
    await expect(agreement).toHaveAttribute(
      'href',
      path('publication') + '#dossier-agreement'
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const width of [1280, 390]) {
  test(`website publication remains confirmed in its media owner and proofs persist after hiding at ${width}px`, async ({
    page
  }) => {
    const { options, calls } = await fixtures(page, 'operator');
    options.progressOverrides = {
      amountMinor: 10000,
      commitment: recordedCommitment(10000, false),
      publications: [],
      website: {
        visible: false,
        held: true,
        canPublish: true,
        version: 'site-v1',
        blockers: []
      },
      publicationCompletion: { done: 0, total: 1 }
    };
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path('media'));
    const site = page.locator('[data-og7="publication-website"]');
    const action = site.locator('[data-og7="website-visibility"]');
    await expect(site).toContainText('Fiche masquée');
    await action.click();
    await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(
      calls.filter((call) => call.url.pathname.endsWith('/website-visibility'))
    ).toHaveLength(0);
    let release!: () => void;
    options.mutationGate = new Promise((resolve) => {
      release = resolve;
    });
    await action.click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(action).toBeDisabled();
    await expect(site).toContainText('Fiche masquée');
    release();
    options.mutationGate = null;
    await expect(site).toContainText('Fiche visible');
    expect(
      calls.find((call) => call.url.pathname.endsWith('/website-visibility'))
        ?.body
    ).toEqual({
      contributionId: id,
      expectedVersion: 'site-v1',
      visible: true,
      confirmed: true
    });
    await expect(
      site.getByRole('link', { name: 'Voir l’annuaire' })
    ).toHaveAttribute('href', '/commanditaires');
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    const view = page.locator('[data-og7="publication-monitor"]');
    await expect(view.getByRole('progressbar')).toHaveAttribute('value', '1');
    await expect(
      view.locator('[data-og7="publication-monitor-next"]').getByRole('button')
    ).toHaveCount(0);
    await tabs(page)
      .getByRole('button', { name: 'Fiche et médias', exact: true })
      .click();
    await action.click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(site).toContainText('Fiche masquée');
    await tabs(page)
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(view.getByRole('progressbar')).toHaveAttribute('value', '1');
    await view.locator('[data-og7="publication-service-action"]').click();
    await expect(
      page.locator('[data-og7="publication-monitor-proof"]')
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await openSponsorshipWebsiteSettings(page);
    await expect(
      page.locator('[data-og7="dossier-publication-editor"]')
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .include('#dossier-website-settings')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
}

test('website readers can inspect confirmed visibility in media without mutation controls', async ({
  page
}) => {
  const { options, calls } = await fixtures(page, 'reader');
  options.progressOverrides = {
    ...qualifiedWebsiteProgress({
      commitment: recordedCommitment(10000, false)
    }),
    publications: [],
    publicationCompletion: { done: 1, total: 1 },
    website: {
      visible: true,
      held: false,
      canPublish: true,
      version: 'site-v1',
      blockers: []
    }
  };
  await page.addInitScript(() => localStorage.setItem('openg7.language', 'en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('media'));
  const site = page.locator('[data-og7="publication-website"]');
  await expect(site).toContainText('Profile visible');
  await expect(site.locator('[data-og7="website-visibility"]')).toHaveCount(0);
  await expect(
    site.getByRole('link', { name: 'View the directory' })
  ).toHaveAttribute('href', '/commanditaires');
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="publication-monitor"]').getByRole('progressbar')
  ).toHaveAttribute('value', '1');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('website visibility errors retain confirmed state and missing prerequisites disable publication in media', async ({
  page
}) => {
  const { options } = await fixtures(page, 'operator');
  options.progressOverrides = {
    website: {
      visible: false,
      held: true,
      canPublish: true,
      version: 'site-v1',
      blockers: []
    }
  };
  options.mutationStatus = 503;
  await page.goto(path('media'));
  const site = page.locator('[data-og7="publication-website"]');
  await site.locator('[data-og7="website-visibility"]').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(site).toContainText('La visibilité n’a pas pu être modifiée');
  await expect(site).toContainText('Fiche masquée');
  options.progressOverrides = {
    website: {
      visible: false,
      held: true,
      canPublish: false,
      version: 'site-v1',
      blockers: ['consent', 'media']
    }
  };
  await page.reload();
  await expect(site.locator('[data-og7="website-visibility"]')).toBeDisabled();
  await tabs(page)
    .getByRole('button', { name: 'Publication', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="publication-monitor-blockers"]')
  ).toContainText(/consentement/i);
});
for (const width of [1920, 1280, 390]) {
  test(
    'workspace opens a spacious dossier and returns to the filtered list at ' +
      width +
      'px',
    async ({ page }) => {
      const { calls } = await fixtures(page, 'owner');
      await page.setViewportSize({ width, height: 1000 });
      const loaded = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/admin/sponsorships' &&
          response.status() === 200
      );
      await page.goto('/admin/fundraiser/sponsors');
      await (await loaded).finished();
      const list = page.locator('[data-og7="sponsors-list"]');
      const detail = page.locator('[data-og7="sponsorship-dossier"]');
      await expect(list).toBeVisible();
      await expect(detail).toBeHidden();
      await list.getByRole('searchbox').fill('Atelier');
      const row = list.locator('[data-og7-id="' + id + '"]');
      await row.focus();
      await page.keyboard.press('Enter');
      await expect(detail).toBeFocused();
      await expect(tabs(page).getByRole('button')).toHaveCount(6);
      await expect(
        page.getByRole('group', { name: 'Revue', exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expect(guide(page)).toHaveCount(0);
      await expect(
        page.locator('[data-og7="dossier-interventions"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-og7="dossier-interventions"] dialog')
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Rembourser Stripe', exact: true })
      ).toHaveCount(0);
      if (width < 1440) await expect(list).toBeHidden();
      else {
        await expect(list).toBeVisible();
        const listBox = await list.boundingBox();
        const dossierBox = await detail.boundingBox();
        expect(dossierBox!.width).toBeGreaterThan(listBox!.width * 2);
      }
      await tabs(page)
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await expect(page.locator('[data-og7="dossier-actions"]')).toHaveCount(1);
      await expect(
        page.locator('[data-og7="dossier-actions"]')
      ).toHaveAccessibleName('Actions de validation');
      await expect(
        page.locator('[data-og7="publication-monitor"]')
      ).toBeVisible();
      await page.screenshot({
        path: 'test-results/sponsors-workspace-' + width + '.png',
        fullPage: true
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
      ).toBe(false);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.locator('[data-og7="dossier-back"]').click();
      await expect(list.getByRole('searchbox')).toHaveValue('Atelier');
      await expect(row).toBeFocused();
      await expect(detail).toBeHidden();
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    }
  );
}

test('workspace groups legacy media and refund URLs and preserves confirmations', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'owner');
  await page.goto(path('media'));
  await expect(
    tabs(page).getByRole('button', { name: 'Fiche et médias' })
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#dossier-identity')).toHaveCount(0);
  await expect(page.locator('#dossier-media')).toBeVisible();
  await page.goto(path('refund'));
  await expect(
    tabs(page).getByRole('button', { name: 'Finances', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-og7="dossier-actions"]')).not.toContainText(
    'Accepter'
  );
  await page
    .getByRole('button', { name: 'Rembourser Stripe', exact: true })
    .click();
  await expect(page.locator('[data-og7="dossier-refund-form"]')).toBeVisible();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
  await page
    .locator('[data-og7="dossier-refund-form"]')
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  await page.reload();
  await expect(
    tabs(page).getByRole('button', { name: 'Finances', exact: true })
  ).toHaveAttribute('aria-current', 'page');
});

test('workspace English mobile opens shared assistance and optional access with the keyboard', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('identity'));
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    tabs(page).getByRole('button', { name: 'Profile & media' })
  ).toBeVisible();
  const assistance = page.locator('[data-og7="dossier-assistant"]');
  await expect(assistance).toHaveText('Assistant & help');
  await expect(guide(page)).toHaveCount(0);
  await assistance.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/admin/fundraiser/assistant' &&
      url.searchParams.get('sponsorshipId') === id &&
      url.searchParams.get('returnTo') === path('identity')
  );
  await expect(guide(page)).toHaveAttribute('open', '');
  await guide(page).locator('[data-og7="guide-open-section"]').click();
  await expect(page).toHaveURL(/tab=overview#dossier-review$/);
  await expect(
    tabs(page).getByRole('button', { name: 'Publication', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  const review = page.locator('#dossier-review');
  await expect(review).toBeFocused();
  await expect(review).toBeInViewport();
  const access = toolToggle(page, 'access');
  await access.focus();
  await expect(access).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.locator('[data-og7="admin-followup-access"]')
  ).toBeVisible();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

for (const english of [false, true]) {
  test(`workspace sections remain accessible with distinct financial and publication actions${english ? ' EN mobile' : ''}`, async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    await page.setViewportSize(
      english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
    );
    await page.goto(path());
    if (english) {
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    }
    const titles = english
      ? [
          'Overview',
          'Identity',
          'Profile & media',
          'Publication',
          'Finances',
          'History'
        ]
      : [
          'Aperçu',
          'Identité',
          'Fiche et médias',
          'Publication',
          'Finances',
          'Historique'
        ];
    for (const title of titles) {
      await tabs(page)
        .getByRole('button', { name: title, exact: true })
        .click();
      const section = page.locator('[data-og7="dossier-main"]');
      await expect(
        section.getByRole('heading', {
          name: title === 'Profile & media' ? 'Profile and media' : title,
          level: 2,
          exact: true
        })
      ).toHaveCount(1);
      expect(
        (await new AxeBuilder({ page }).analyze()).violations,
        title
      ).toEqual([]);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Atelier Boréal'
      );
      await expect(
        page.locator('openg7-admin-sponsor-detail-header').getByRole('group', {
          name: english ? 'Review' : 'Revue',
          exact: true
        })
      ).toContainText(english ? 'Awaiting review' : 'À réviser');
    }
    await expect(
      page.locator('[data-og7="dossier-interventions"]')
    ).toBeVisible();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const english of [false, true]) {
  test(`moderation V1 requires contextual reasons and separates private notes from external explanation ${english ? 'EN mobile' : 'FR desktop'}`, async ({
    page
  }) => {
    await fixtures(page, 'operator');
    await page.setViewportSize(
      english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
    );
    const decisions: Record<string, unknown>[] = [];
    let currentDecision: Record<string, unknown> | null = null;
    await page.route('**/api/admin/moderation/**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('subjectId') ?? id).toBe(id);
      if (url.pathname.endsWith('/content'))
        return route.fulfill({
          json: {
            subject: { type: 'sponsorship', id },
            contributionId: id,
            contributionIds: [id],
            contentVersion: 8,
            fingerprint: 'b'.repeat(64),
            snapshot: {
              companyName: 'Atelier Boréal',
              message: 'Synthetic current submitted content'
            },
            currentDecisionId: null
          }
        });
      if (url.pathname.endsWith('/cases'))
        return route.fulfill({
          json: {
            items: currentDecision
              ? [
                  {
                    id: 'synthetic-case',
                    state: 'pending_independent_review',
                    currentDecisionId: secondId
                  }
                ]
              : []
          }
        });
      if (url.pathname.endsWith('/reconsiderations'))
        return route.fulfill({ json: { items: [] } });
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: { items: currentDecision ? [currentDecision] : [] }
        });
      const payload = route.request().postDataJSON();
      decisions.push(payload);
      currentDecision = {
        ...payload.decision,
        id: secondId,
        subjectType: 'sponsorship',
        subjectId: id,
        state: 'pending_independent_review',
        createdAt: date
      };
      return route.fulfill({ json: { decision: currentDecision } });
    });
    await page.goto(path());
    if (english)
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    await toolToggle(page, 'moderation').click();
    const actions = page.locator('[data-og7="moderation-actions"]').first();
    await expect(actions.getByRole('combobox')).toHaveValue('N1');
    await actions.locator('[data-og7="moderation-open"]').click();
    let panel = page.locator('[data-og7="moderation-decision"]');
    await expect(
      panel.locator(
        '[data-og7="moderation-primary-reason"] option[value="HATE_TARGETED"]'
      )
    ).toHaveCount(0);
    await panel
      .getByRole('button', {
        name: english ? 'Cancel' : 'Annuler',
        exact: true
      })
      .click();
    expect(decisions).toHaveLength(0);
    await actions.getByRole('combobox').selectOption('N4');
    await actions.locator('[data-og7="moderation-open"]').click();
    panel = page.locator('[data-og7="moderation-decision"]');
    await panel.locator('[data-og7="moderation-confirmation"]').check();
    await expect(
      panel.locator('[data-og7="moderation-submit"]')
    ).toBeDisabled();
    await panel
      .locator('[data-og7="moderation-primary-reason"]')
      .selectOption('DEHUMANIZATION');
    await panel
      .locator('[data-og7="moderation-internal-reason"]')
      .fill('PRIVATE-RATIONALE-ONLY');
    await panel
      .locator('[data-og7="moderation-explanation"]')
      .fill(
        english
          ? 'This submitted message dehumanizes people; please use the private reconsideration route.'
          : 'Ce message soumis déshumanise des personnes; utilisez le parcours privé de réexamen.'
      );
    await expect(
      panel.locator('[data-og7="moderation-confirmation"]')
    ).not.toBeChecked();
    await panel.locator('summary').first().click();
    await expect(
      panel.locator('[data-og7="moderation-snapshot"]')
    ).toContainText('Synthetic current submitted content');
    expect(
      (await new AxeBuilder({ page }).include('dialog[open]').analyze())
        .violations
    ).toEqual([]);
    await panel.locator('[data-og7="moderation-confirmation"]').check();
    await panel.locator('[data-og7="moderation-submit"]').click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({
      subject: { type: 'sponsorship', id },
      decision: {
        policyVersion: '1.0',
        contentVersion: 8,
        contentFingerprint: 'b'.repeat(64),
        level: 'N4',
        primaryReason: 'DEHUMANIZATION',
        internalReason: 'PRIVATE-RATIONALE-ONLY',
        confirmation: id
      }
    });
    await expect(actions).toContainText(
      english ? 'another authorized person' : 'autre personne habilitée'
    );
    await actions.locator('summary').click();
    await expect(
      actions.locator('[data-og7="moderation-independent"]')
    ).toBeVisible();
    await expect(actions).not.toContainText('PRIVATE-RATIONALE-ONLY');
    await expect(page.locator('[data-og7="moderation-decision"]')).toHaveCount(
      0
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
}

for (const english of [false, true]) {
  test(`moderation V1 owner assigns an active member and resolves reconsideration with a fresh explained decision ${english ? 'EN mobile' : 'FR desktop'}`, async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'owner');
    await page.setViewportSize(
      english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
    );
    let assignedTo: string | null = null;
    let resolved = false;
    const mutations: { path: string; body: Record<string, unknown> }[] = [];
    await page.route('**/api/admin/access', (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              id: secondId,
              subject: 'synthetic-operator',
              displayName: 'Camille Reviewer',
              role: 'operator',
              disabled: false
            },
            {
              id: 'reader-only',
              subject: 'synthetic-reader',
              displayName: 'Reader Only',
              role: 'reader',
              disabled: false
            },
            {
              id: 'disabled-owner',
              subject: 'synthetic-disabled',
              displayName: 'Disabled Member',
              role: 'owner',
              disabled: true
            }
          ],
          sessions: []
        }
      })
    );
    await page.route('**/api/admin/moderation/**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        mutations.push({ path: url.pathname, body });
        if (url.pathname.endsWith('/assignment')) {
          assignedTo = body.assignedTo;
          return route.fulfill({ json: { assignedTo } });
        }
        expect(url.pathname).toBe(
          '/api/admin/moderation/reconsiderations/resolve'
        );
        resolved = true;
        return route.fulfill({
          json: {
            decision: {
              ...body.decision,
              id: secondId,
              subject: body.subject,
              state: 'active'
            }
          }
        });
      }
      expect(url.searchParams.get('subjectId')).toBe(id);
      if (url.pathname.endsWith('/content'))
        return route.fulfill({
          json: {
            subject: { type: 'sponsorship', id },
            contributionId: id,
            contributionIds: [id],
            contentVersion: 9,
            fingerprint: 'c'.repeat(64),
            snapshot: {
              companyName: 'Atelier Boréal',
              message: 'Corrected current version'
            },
            currentDecisionId: secondId
          }
        });
      if (url.pathname.endsWith('/cases'))
        return route.fulfill({
          json: {
            items: [
              {
                id: 'synthetic-case',
                state: resolved ? 'approved' : 'rejected',
                currentDecisionId: secondId,
                assignedTo
              }
            ]
          }
        });
      if (url.pathname.endsWith('/reconsiderations'))
        return route.fulfill({
          json: {
            items: [
              {
                id: secondId,
                decisionId: secondId,
                subjectType: 'sponsorship',
                subjectId: id,
                message: 'Please reconsider the corrected version in context.',
                state: resolved ? 'resolved' : 'open',
                createdAt: date
              }
            ]
          }
        });
      return route.fulfill({ json: { items: [] } });
    });
    await page.goto(path());
    if (english)
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    await toolToggle(page, 'moderation').click();
    const actions = page.locator('[data-og7="moderation-actions"]').first();
    await actions.locator('summary').click();
    const member = actions.locator('[data-og7="moderation-assigned-member"]');
    await expect(member).toBeVisible();
    await expect(member.locator('option')).toHaveCount(2);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await member.selectOption('admin:' + secondId);
    await actions.locator('[data-og7="moderation-assign"]').click();
    expect(mutations).toHaveLength(0);
    await page.locator('[data-og7="confirm-action"]').click();
    await expect.poll(() => mutations.length).toBe(1);
    expect(mutations[0]).toMatchObject({
      path: '/api/admin/moderation/assignment',
      body: {
        subject: { type: 'sponsorship', id },
        assignedTo: 'admin:' + secondId,
        expectedAssignedTo: null,
        confirmation: id
      }
    });
    await member.selectOption('');
    await actions.locator('[data-og7="moderation-assign"]').click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect.poll(() => mutations.length).toBe(2);
    expect(mutations[1].body).toMatchObject({
      assignedTo: null,
      expectedAssignedTo: 'admin:' + secondId
    });
    await actions.getByRole('combobox').first().selectOption('N0');
    const resolve = actions.locator(
      '[data-og7="moderation-resolve-reconsideration"]'
    );
    // Native keyboard activation avoids a WebKit click lost during smooth scrolling.
    await expect(resolve).toBeEnabled();
    await resolve.focus();
    await expect(resolve).toBeFocused();
    await page.keyboard.press('Enter');
    const panel = page.locator('[data-og7="moderation-decision"]');
    await expect(panel).toBeVisible();
    await expect(
      panel.locator('[data-og7="moderation-internal-reason"]')
    ).toHaveCount(0);
    await panel.locator('[data-og7="moderation-confirmation"]').check();
    await expect(
      panel.locator('[data-og7="moderation-submit"]')
    ).toBeDisabled();
    await panel
      .locator('[data-og7="moderation-explanation"]')
      .fill(
        'The corrected current version is approved editorially after human reconsideration.'
      );
    await panel.locator('[data-og7="moderation-confirmation"]').check();
    await panel.locator('[data-og7="moderation-submit"]').click();
    await expect.poll(() => mutations.length).toBe(3);
    expect(mutations[2]).toMatchObject({
      path: '/api/admin/moderation/reconsiderations/resolve',
      body: {
        appealId: secondId,
        subject: { type: 'sponsorship', id },
        decision: {
          level: 'N0',
          contentVersion: 9,
          contentFingerprint: 'c'.repeat(64),
          expectedDecisionId: secondId,
          sponsorExplanation:
            'The corrected current version is approved editorially after human reconsideration.',
          confirmation: id
        }
      }
    });
    await expect(
      actions.locator('[data-og7="moderation-resolve-reconsideration"]')
    ).toHaveCount(0);
    expect(
      calls.filter((call) => call.method === 'POST'),
      'editorial reconsideration alone never publishes or approves a commercial dossier'
    ).toHaveLength(0);
  });
}
