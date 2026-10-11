import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enqueueModerationNotification,
  enqueueModerationFollowupReceipt,
  renderModerationNotification
} from '../dist/apps/funding-api/src/moderation/notifications.js';
import { renderSponsorshipRejectionEmail } from '../dist/apps/funding-api/src/services/email/sponsorship.templates.js';

const decision = {
  id: '11111111-1111-4111-8111-111111111111',
  contributionId: '22222222-2222-4222-8222-222222222222',
  policyVersion: '1.0',
  level: 'N1',
  state: 'active',
  sponsorExplanation: 'Please replace the <synthetic> logo.',
  internalReason: 'PRIVATE_REVIEW_NOTE_MARKER',
  actor: 'PRIVATE_REVIEWER_MARKER'
};

test('moderation notifications render FR and EN using only the external explanation', () => {
  for (const locale of ['fr-CA', 'en']) {
    const message = renderModerationNotification(decision, locale);
    assert.match(message.text, /Please replace the <synthetic> logo/);
    assert.match(message.html, /&lt;synthetic&gt;/);
    assert.doesNotMatch(
      JSON.stringify(message),
      /PRIVATE_REVIEW_NOTE_MARKER|PRIVATE_REVIEWER_MARKER/
    );
    assert.match(
      message.text,
      locale === 'en'
        ? /does not confirm a refund/
        : /ne confirme aucun remboursement/
    );
  }
});

test('old refusal email ignores historical private reviewReason even if an untyped caller still supplies it', () => {
  const message = renderSponsorshipRejectionEmail({
    to: 'sponsor@example.test',
    contributionId: decision.contributionId,
    publicReference: null,
    sponsorName: 'Synthetic sponsor',
    amount: 25,
    currency: 'CAD',
    reviewReason: decision.internalReason,
    sponsorMessage: decision.sponsorExplanation,
    refundHandling: 'none'
  });
  assert.doesNotMatch(
    JSON.stringify(message),
    /PRIVATE_REVIEW_NOTE_MARKER|Motif de revue/
  );
  assert.match(message.text, /Please replace the <synthetic> logo/);
});

test('pending independent review and editorial approval never queue a refusal notification', async () => {
  const db = {
    query() {
      assert.fail('No recipient or queue lookup is allowed.');
    }
  };
  assert.equal(
    await enqueueModerationNotification(db, {
      ...decision,
      state: 'pending_independent_review'
    }),
    null
  );
  assert.equal(
    await enqueueModerationNotification(db, { ...decision, level: 'N0' }),
    null
  );
  assert.equal(
    await enqueueModerationNotification(db, {
      ...decision,
      contributionId: null
    }),
    null
  );
});

test('a missing confirmed recipient preserves private explanation without delivering to a supplied contact', async () => {
  let reads = 0;
  const db = {
    async query(sql) {
      reads++;
      assert.match(sql, /c\.email_private AS email/);
      assert.match(sql, /c\.status IN \('paid','refunded','disputed'\)/);
      return {
        rows: [
          {
            email: null,
            locale: 'en',
            sponsor_contact_email: 'unverified@example.test'
          }
        ]
      };
    }
  };
  assert.equal(await enqueueModerationNotification(db, decision), null);
  assert.equal(reads, 1);
});

test('a receipt has no fallback recipient before payment confirmation', async () => {
  let reads = 0;
  const db = {
    async query(sql) {
      reads++;
      assert.match(sql, /status IN \('paid','refunded','disputed'\)/);
      return { rows: [] };
    }
  };
  await enqueueModerationFollowupReceipt(db, {
    contributionId: decision.contributionId,
    eventId: decision.id,
    kind: 'reconsideration'
  });
  assert.equal(reads, 1);
});
