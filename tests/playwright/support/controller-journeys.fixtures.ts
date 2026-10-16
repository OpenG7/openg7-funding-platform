import type { Page } from '@playwright/test';
import type {
  AdminEmailQueueMessageRecord,
  AdminPaymentJourney,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  SponsorMediaAsset,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { moderationFixture } from './moderation.js';
import { installAdminController } from './admin-controller.js';

export const controllerId = '10000000-0000-4000-8000-000000000401';
export const controllerAssetId = '10000000-0000-4000-8000-000000000402';
export const controllerObligationId = '10000000-0000-4000-8000-000000000403';
const date = '2026-10-15T12:00:00Z';
type FixtureBody = Record<string, unknown> & {
  companyName: string;
  contactEmail: string;
  publicName: string;
  contactName: string;
  websiteUrl: string;
  assetId: string;
  reviewStatus: SponsorMediaAsset['reviewStatus'];
  altText: string;
  outcome: 'sent' | 'not_sent';
  to: string;
};
export const controllerPath = (tab = 'overview') =>
  `/admin/fundraiser/sponsors?sponsorshipId=${controllerId}&tab=${tab}`;

const sponsor = (): AdminSponsorshipRecord => ({
  id: controllerId,
  version: 'v1',
  public_reference: 'XBOX-401',
  contribution_type: 'sponsorship_interest',
  amount: 500,
  currency: 'CAD',
  payment_status: 'paid',
  paid_at: date,
  public_name: null,
  public_display_consent: true,
  display_amount_consent: false,
  sponsor_company_name: 'Xbox fixture',
  sponsor_contact_name: 'Contact test',
  sponsor_contact_email: 'company@example.test',
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
const progress = (): AdminSponsorshipProgress => ({
  contributionId: controllerId,
  reference: 'XBOX-401',
  companyName: 'Xbox fixture',
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
    { id: 'media', state: 'pending', reason: 'media_pending', tab: 'media' },
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
      state: 'pending',
      reason: 'publication_pending',
      tab: 'publication'
    }
  ],
  next: {
    reason: 'review_pending',
    tab: 'overview',
    adminUrl: controllerPath()
  },
  documents: [],
  publications: [],
  refund: {
    workflow: 'not_requested',
    state: 'not_required',
    confirmedAmountMinor: 0,
    creditMissing: false,
    hasError: false
  },
  failedEmails: [],
  failedStripeEvents: []
});
const media = (): SponsorMediaAsset => ({
  id: controllerAssetId,
  contributionId: controllerId,
  kind: 'supporting_image',
  reviewStatus: 'pending_review',
  uploadedBy: 'sponsor',
  originalFilename: 'synthetic.png',
  originalMimeType: 'image/png',
  originalSizeBytes: 68,
  processedMimeType: 'image/webp',
  processedSizeBytes: 68,
  width: 1,
  height: 1,
  altText: 'Photo test',
  sortOrder: 0,
  publicUrl: null,
  reviewedAt: null,
  version: 'v1',
  createdAt: date,
  usage: {
    state: 'confirmed',
    channels: ['website'],
    targets: ['openg7'],
    transformations: ['technical'],
    credit: null,
    restrictions: 'Credit required'
  },
  usageRestrictionsReviewed: false
});
const message = (): AdminEmailQueueMessageRecord => ({
  id: controllerAssetId,
  template_key: 'sponsorship_access_recovery',
  recipient_email: 'company@example.test',
  from_email: 'sender@example.test',
  reply_to_email: null,
  subject: 'Synthetic private access',
  status: 'failed',
  attempts: 1,
  max_attempts: 5,
  next_attempt_at: date,
  sent_at: null,
  last_error: 'EMAIL_CONNECTION_ERROR',
  metadata: {},
  created_at: date,
  updated_at: date
});
const invoice = (): AdminSponsorshipInvoiceRecord => {
  const shared = {
    contribution_id: controllerId,
    public_reference: 'XBOX-401',
    stripe_payment_intent_id: null,
    issued_at: date,
    currency: 'CAD',
    subtotal: 500,
    tax: 0,
    total: 500,
    tax_label: '',
    issuer_name: 'OpenG7',
    issuer_email: null,
    issuer_address: null,
    issuer_tax_id: null,
    sponsor_name: 'Xbox fixture',
    sponsor_contact_name: 'Contact test',
    sponsor_contact_email: 'company@example.test',
    sponsor_website_url: null,
    line_items: [
      { description: 'Commandite', quantity: 1, unit_amount: 500, total: 500 }
    ],
    notes: null,
    last_email_status: 'failed',
    last_email_recipient: 'company@example.test',
    last_email_sent_at: null,
    last_email_error: 'EMAIL_CONNECTION_ERROR'
  };
  return {
    ...shared,
    id: controllerId,
    invoice_number: 'INV-XBOX-401',
    stripe_session_id: 'cs_test_xbox',
    paid_at: date,
    credit_notes: [
      {
        ...shared,
        id: controllerAssetId,
        invoice_id: controllerId,
        invoice_number: 'INV-XBOX-401',
        credit_note_number: 'CN-XBOX-401',
        stripe_refund_id: 're_test_xbox'
      }
    ]
  };
};

/** Synthetic HTTP state for built-Web interaction tests, never a server qualification. */
export async function controllerJourneysFixtures(
  page: Page,
  role = 'owner',
  locale = 'en',
  options: { hardware?: 'simulated' | 'native' } = {}
) {
  if (options.hardware !== 'native') await installAdminController(page);
  await page.addInitScript((language) => {
    localStorage.setItem('openg7.language', language);
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.cookie'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, locale);
  const state = {
    sponsor: sponsor(),
    progress: progress(),
    media: [media()],
    email: message(),
    invoice: invoice(),
    commitment: null as SponsorshipCommitmentRecord | null,
    commands: [] as { path: string; body: Record<string, unknown> }[],
    unexpected: [] as string[],
    historicalVersion: 0,
    retryGate: null as Promise<void> | null
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const body =
      request.method() === 'POST'
        ? (request.postDataJSON() as FixtureBody)
        : null;
    if (body) state.commands.push({ path, body });
    if (
      await moderationFixture(route, [
        { type: 'sponsorship', id: controllerId },
        { type: 'media', id: controllerAssetId }
      ])
    )
      return;
    if (path.endsWith('/auth/current'))
      return route.fulfill({
        json: {
          id: 'controller-fixture-owner',
          sessionId: 'controller-fixture-session',
          displayName: 'Synthetic controller',
          role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path.endsWith('/attention'))
      return route.fulfill({
        json: {
          available: true,
          coverage: 'complete',
          missingSources: [],
          generatedAt: date,
          timezone: 'America/Toronto',
          total: 0,
          filteredTotal: 0,
          todayTotal: 0,
          counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
          typeCounts: {},
          actionCounts: {},
          page: 1,
          pageSize: 25,
          items: []
        }
      });
    if (path.endsWith('/sponsorships'))
      return route.fulfill({
        json: {
          data_source: 'database',
          items: [state.sponsor],
          sponsorships: [state.sponsor],
          last_updated_at: date,
          pagination: {
            page: 1,
            pageSize: 6,
            totalItems: 1,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false
          }
        }
      });
    if (path.endsWith('/sponsorships/progress'))
      return route.fulfill({
        json: {
          status: 'ok',
          generatedAt: date,
          dossier: { ...state.progress, commitment: state.commitment }
        }
      });
    if (path.endsWith('/sponsorships/media'))
      return route.fulfill({ json: { assets: state.media } });
    if (path.includes('/media/content/'))
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV0cAAAAASUVORK5CYII=',
          'base64'
        )
      });
    if (path.endsWith('/sponsorships/interventions'))
      return route.fulfill({
        json: {
          entries: [],
          nextCursor: null,
          followup: {
            state: 'recent',
            ageDays: 0,
            nextReviewOn: null,
            lastEmail: null
          }
        }
      });
    if (path.endsWith('/sponsorships/followup-access'))
      return route.fulfill({ json: { recipient: 'company@example.test' } });
    if (path.endsWith('/assistant/context'))
      return route.fulfill({
        json: {
          status: 'empty',
          generatedAt: date,
          conversationMode: 'disabled',
          context: null
        }
      });
    if (path.endsWith('/payment-journey')) {
      const journey: AdminPaymentJourney = {
        contributionId: controllerId,
        reference: 'XBOX-401',
        contributionType: 'sponsorship_interest',
        amountMinor: 50000,
        currency: 'CAD',
        paymentStatus: 'paid',
        state: 'action_required',
        completed: 1,
        total: 2,
        steps: [
          {
            id: 'payment',
            state: 'complete',
            reason: 'payment_recorded',
            adminUrl:
              '/admin/fundraiser/contributions?contributionId=' + controllerId
          },
          {
            id: 'review',
            state: 'pending',
            reason: 'review_pending',
            adminUrl: controllerPath(),
            target: 'sponsorship-dossier'
          }
        ],
        next: {
          reason: 'review_pending',
          adminUrl: controllerPath(),
          target: 'sponsorship-dossier'
        }
      };
      return route.fulfill({
        json: { status: 'ok', generatedAt: date, journey }
      });
    }
    if (path.endsWith('/sponsorships/details') && body) {
      state.sponsor = {
        ...state.sponsor,
        sponsor_company_name: body.companyName,
        sponsor_contact_email: body.contactEmail,
        public_name: body.publicName,
        sponsor_contact_name: body.contactName,
        sponsor_website_url: body.websiteUrl,
        version: 'v2'
      };
      return route.fulfill({ json: { updated: true, version: 'v2' } });
    }
    if (path.endsWith('/sponsorships/media/review') && body) {
      state.media = state.media.map((asset) =>
        asset.id === body.assetId
          ? {
              ...asset,
              reviewStatus: body.reviewStatus,
              altText: body.altText,
              version: 'v2',
              usageRestrictionsReviewed: true
            }
          : asset
      );
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith('/sponsorships/media/metadata') && body) {
      state.media = state.media.map((asset) =>
        asset.id === body.assetId
          ? { ...asset, altText: body.altText, version: 'v2' }
          : asset
      );
      return route.fulfill({
        json: {
          updated: true,
          asset: state.media.find((asset) => asset.id === body.assetId)
        }
      });
    }
    if (path.endsWith('/sponsorships/refund') && body)
      return route.fulfill({
        json: {
          updated: true,
          refundWorkflowStatus: 'processing',
          refundStatus: 'pending',
          refundId: 're_test_xbox',
          creditNoteId: controllerAssetId
        }
      });
    if (path.endsWith('/sponsorships/website-visibility') && body) {
      state.progress = {
        ...state.progress,
        website: {
          visible: Boolean(body.visible),
          held: !body.visible,
          canPublish: true,
          version: 'v2',
          blockers: []
        }
      };
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith('/email-queue/retry') && body) {
      if (state.retryGate) await state.retryGate;
      state.email = {
        ...state.email,
        status: 'sent',
        sent_at: date,
        last_error: null
      };
      return route.fulfill({
        json: {
          attempted: 1,
          sent: 1,
          failed: 0,
          messageIds: [state.email.id],
          sentMessageIds: [state.email.id],
          failedMessageIds: [],
          message: state.email
        }
      });
    }
    if (path.endsWith('/email-queue/reconcile') && body) {
      state.email = {
        ...state.email,
        status: body.outcome === 'sent' ? 'sent' : 'failed',
        updated_at: date
      };
      return route.fulfill({ json: { updated: true, message: state.email } });
    }
    if (path.endsWith('/email-queue'))
      return route.fulfill({
        json: {
          data_source: 'database',
          messages: [state.email],
          last_updated_at: date,
          summary: {
            queued_count: 0,
            sending_count: 0,
            sent_count: state.email.status === 'sent' ? 1 : 0,
            failed_count: state.email.status === 'failed' ? 1 : 0,
            uncertain_count: state.email.status === 'uncertain' ? 1 : 0,
            retryable_count: state.email.status === 'failed' ? 1 : 0,
            last_failed_at: date,
            last_error: null
          }
        }
      });
    if (path.endsWith('/sponsorship-invoices'))
      return route.fulfill({
        json: {
          data_source: 'database',
          invoices: [state.invoice],
          last_updated_at: date,
          summary: {
            total_count: 1,
            total_amount: 500,
            credit_note_count: 1,
            total_credited: 500,
            failed_email_count: 1,
            currency: 'CAD'
          }
        }
      });
    if (path.endsWith('/sponsorship-credit-notes/resend') && body) {
      const creditNote = {
        ...state.invoice.credit_notes[0]!,
        last_email_status: 'sent',
        last_email_recipient: body.to,
        last_email_sent_at: date,
        last_email_error: null
      };
      state.invoice = { ...state.invoice, credit_notes: [creditNote] };
      return route.fulfill({
        json: {
          queued: false,
          attempted: true,
          sent: true,
          messageId: controllerObligationId,
          creditNote,
          error: null
        }
      });
    }
    if (path.endsWith('/sponsorship-commitments') && request.method() === 'GET')
      return route.fulfill({ json: { commitment: state.commitment } });
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({
      status: 503,
      json: { error: 'Synthetic controller fixture unavailable' }
    });
  });
  return state;
}
