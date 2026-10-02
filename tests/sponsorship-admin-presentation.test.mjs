import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPONSORSHIP_ADMIN_PATH,
  sponsorshipAdminUrl,
  sponsorshipRef
} from '../dist/apps/funding-api/src/sponsorship-admin-presentation.js';
import {
  buildSummaryFromDataset,
  detectSponsorshipReviewItems,
  promisedSocialChannels,
  sponsorshipAdminUrl as attentionAdminUrl,
  sponsorshipRef as attentionRef
} from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';
import { buildSponsorshipAssistantContext } from '../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { createAssistantToolRegistry } from '../dist/apps/funding-api/src/admin-assistant/tool-registry.js';
import {
  buildSponsorshipReviewReminderAdminUrl,
  buildSponsorshipReviewReminderCandidate
} from '../dist/apps/funding-api/src/admin-reminder.service.js';
import { resolveSponsorshipSocialChannels } from '../dist/apps/funding-api/src/sponsorship-benefits.js';

test('sponsorship links encode reserved characters without adding query parameters or a fragment', () => {
  const id = 'demo /?&=#é';
  const path = sponsorshipAdminUrl(id);
  assert.equal(
    path,
    '/admin/fundraiser/sponsors?sponsorshipId=demo%20%2F%3F%26%3D%23%C3%A9'
  );
  const url = new URL(path, 'https://example.invalid');
  assert.equal(url.pathname, SPONSORSHIP_ADMIN_PATH);
  assert.deepEqual([...url.searchParams], [['sponsorshipId', id]]);
  assert.equal(url.hash, '');
});

test('sponsorship links preserve the dossier tabs and their query order', () => {
  for (const tab of [
    'overview',
    'identity',
    'media',
    'publication',
    'billing',
    'refund',
    'audit'
  ]) {
    const path = sponsorshipAdminUrl('demo&tab=refund#fragment', tab);
    assert.equal(
      path,
      `/admin/fundraiser/sponsors?sponsorshipId=demo%26tab%3Drefund%23fragment&tab=${tab}`
    );
    const url = new URL(path, 'https://example.invalid');
    assert.deepEqual(
      [...url.searchParams],
      [
        ['sponsorshipId', 'demo&tab=refund#fragment'],
        ['tab', tab]
      ]
    );
    assert.equal(url.hash, '');
  }
});

test('sponsorship references preserve public values and use a short fallback only when absent', () => {
  const contributionId = '01234567-89ab-cdef-0123-456789abcdef';
  for (const publicReference of ['OG7-CMD-DEMO', '']) {
    assert.equal(
      sponsorshipRef({ contributionId, publicReference }),
      publicReference
    );
  }
  assert.equal(
    sponsorshipRef({ contributionId, publicReference: null }),
    '#01234567'
  );
  assert.equal(
    sponsorshipRef({ contributionId: 'demo', publicReference: null }),
    '#demo'
  );
});

test('attention keeps its existing presentation and social-channel exports', () => {
  assert.equal(attentionAdminUrl, sponsorshipAdminUrl);
  assert.equal(attentionRef, sponsorshipRef);
  assert.equal(promisedSocialChannels, resolveSponsorshipSocialChannels);
});

test('attention, context, tools and reminders share presentation while omitting synthetic private fields', () => {
  const now = new Date('2026-07-24T00:00:00.000Z');
  const contributionId = '01234567-89ab-cdef-0123-456789abcdef';
  const recipient = 'synthetic-contact@example.invalid';
  const registry = createAssistantToolRegistry();

  for (const publicReference of ['OG7-CMD-DEMO', null, '']) {
    const record = {
      contributionId,
      publicReference,
      amount: 300,
      currency: 'CAD',
      paymentStatus: 'paid',
      paidAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
      detailsSubmittedAt: '2026-07-02T00:00:00.000Z',
      hasCompanyName: true,
      hasContactEmail: true,
      hasWebsite: false,
      hasLogo: false,
      hasSupportingImage: true,
      reviewStatus: 'pending_review',
      feedStatus: 'not_planned',
      feedTarget: null,
      feedChannels: [],
      refundStatus: 'not_requested',
      companyName: 'Synthetic private company',
      contactEmail: recipient,
      followupToken: 'synthetic-private-followup'
    };
    const dataset = {
      now,
      sponsorships: [record],
      sponsorshipsTruncated: false,
      drafts: [],
      batches: [],
      slots: [],
      emailMessages: [],
      financialTotals: {
        grossPaid: 300,
        refunded: 0,
        disputed: 0,
        currency: 'CAD'
      }
    };
    const expectedReference = publicReference ?? '#01234567';
    const expectedUrl =
      '/admin/fundraiser/sponsors?sponsorshipId=01234567-89ab-cdef-0123-456789abcdef';
    const attention = detectSponsorshipReviewItems(dataset);
    assert.equal(attention.length, 1);
    assert.equal(attention[0].facts.reference, expectedReference);
    assert.equal(attention[0].adminUrl, expectedUrl);

    const context = buildSponsorshipAssistantContext({
      record,
      dataset,
      media: [],
      consent: false,
      recipient,
      version: 'synthetic-version'
    });
    assert.equal(context.reference, expectedReference);
    assert.equal(context.adminUrl, expectedUrl);

    const toolContext = {
      dataset,
      summary: buildSummaryFromDataset(dataset)
    };
    const listTool = registry.get('list_sponsorships_needing_review');
    const listed = listTool.execute(toolContext, listTool.parseInput({}));
    assert.equal(listed.resultCount, 1);
    assert.equal(listed.data[0].facts.reference, expectedReference);
    assert.equal(listed.data[0].adminUrl, expectedUrl);

    const explainTool = registry.get('explain_sponsorship_state');
    const explained = explainTool.execute(
      toolContext,
      explainTool.parseInput({ reference: contributionId })
    );
    assert.equal(explained.resultCount, 1);
    assert.equal(explained.data.reference, expectedReference);

    const reminder = buildSponsorshipReviewReminderCandidate([record], now, {
      minAgeDays: 1,
      maxItems: 5
    });
    assert.equal(reminder.totalCount, 1);
    assert.equal(reminder.items[0].reference, expectedReference);
    assert.equal(
      buildSponsorshipReviewReminderAdminUrl(undefined),
      SPONSORSHIP_ADMIN_PATH
    );

    const serialized = JSON.stringify({
      attention,
      context,
      listed,
      explained,
      reminder
    });
    for (const privateValue of [
      record.companyName,
      recipient,
      record.followupToken
    ]) {
      assert.equal(serialized.includes(privateValue), false);
    }
  }
});
