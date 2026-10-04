import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { buildSponsorshipSeedFragments } from '../scripts/lib/e2e-seed/sponsorship.mjs';
import { SPONSORSHIP_FIXTURES } from './playwright/fixtures/e2e-fixtures.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

// Read columns and expressions rather than comparing snapshots of the SQL.
// Commas inside quoted text, JSON and calls must remain part of their value.
function expressions(sql) {
  const values = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (character === ',' && depth === 0) {
        values.push(sql.slice(start, index).trim());
        start = index + 1;
      }
    }
  }
  assert.equal(quoted, false, 'SQL text literals must be closed');
  assert.equal(depth, 0, 'SQL expressions must be balanced');
  values.push(sql.slice(start).trim());
  return values;
}

function value(expression) {
  if (expression === 'NULL') return null;
  if (expression === 'TRUE') return true;
  if (/^\d+$/.test(expression)) return Number(expression);
  const literal = /^'((?:[^']|'')*)'(::jsonb)?$/.exec(expression);
  if (!literal) return expression;
  const text = literal[1].replace(/''/g, "'");
  return literal[2] ? JSON.parse(text) : text;
}

function insertRows(sql, table, select = false) {
  const tail = select
    ? String.raw`\)\s*SELECT\s+([\s\S]*?)\s+FROM fund_contributions`
    : String.raw`\)\s*VALUES\s*\(([\s\S]*?)\n\);`;
  const pattern = new RegExp(
    String.raw`INSERT INTO ` + table + String.raw`\s*\(([\s\S]*?)` + tail,
    'g'
  );
  return [...sql.matchAll(pattern)].map((match) => {
    const columns = expressions(match[1]);
    const values = expressions(match[2]).map(value);
    assert.equal(columns.length, values.length);
    return Object.fromEntries(
      columns.map((column, index) => [column, values[index]])
    );
  });
}

const syntheticFixture = (overrides = {}) => ({
  publicReference: 'OG7-E2E-SYNTHETIC',
  companyName: 'Synthetic Company',
  contactName: 'Synthetic Contact',
  contactEmail: 'synthetic@example.invalid',
  websiteUrl: 'https://example.invalid/synthetic',
  followupToken: 'synthetic-local-only-followup-token',
  amountCents: 25000,
  ...overrides
});

const planFor = (fixtures, publicationFixtures = fixtures) =>
  buildSponsorshipSeedFragments({ fixtures, publicationFixtures });

test('sponsorship fragments seed every selected fixture with unchanged payment, consent and review fields', () => {
  const fixtures = Object.values(SPONSORSHIP_FIXTURES);
  const plan = planFor(fixtures);
  const rows = insertRows(plan.insertStatements, 'fund_contributions');
  assert.equal(rows.length, fixtures.length);
  assert.deepEqual(
    rows.map((row) => row.public_reference),
    fixtures.map((fixture) => fixture.publicReference)
  );
  for (const [index, fixture] of fixtures.entries()) {
    const reviewStatus = fixture.reviewStatus ?? 'pending_review';
    assert.deepEqual(rows[index], {
      contribution_type: 'sponsorship_interest',
      amount_cents: fixture.amountCents,
      currency: 'cad',
      status: 'paid',
      paid_at: 'NOW()',
      public_display_consent: true,
      display_amount_consent: true,
      non_charity_acknowledged: true,
      sponsor_company_name: fixture.companyName,
      sponsor_contact_name: fixture.contactName,
      sponsor_contact_email: fixture.contactEmail,
      sponsor_website_url: fixture.websiteUrl,
      sponsor_details_submitted_at: 'NOW()',
      sponsor_review_status: reviewStatus,
      sponsor_reviewed_at: reviewStatus === 'pending_review' ? null : 'NOW()',
      sponsorship_followup_token_hash: hash(fixture.followupToken),
      sponsorship_followup_token_created_at: 'NOW()',
      public_reference: fixture.publicReference,
      stripe_payment_intent_id: fixture.stripePaymentIntentId ?? null,
      stripe_session_id: fixture.stripeSessionId ?? null,
      sponsor_feed_target: fixture.feedTarget ?? null,
      sponsor_feed_channels: fixture.feedChannels ?? [],
      email_private: fixture.paymentEmail ?? null
    });
    assert.equal(plan.insertStatements.includes(fixture.followupToken), false);
  }
  assert.equal(
    plan.insertStatements.includes('INSERT INTO sponsor_publication_batches'),
    false
  );
  assert.equal(
    plan.insertStatements.includes('INSERT INTO publication_deliveries'),
    false
  );
});

test('pending review defaults and rejected sponsors remain distinct from paid status and publication authorization', () => {
  const fixtures = [
    syntheticFixture(),
    syntheticFixture({
      publicReference: 'OG7-E2E-APPROVED',
      reviewStatus: 'approved'
    }),
    syntheticFixture({
      publicReference: 'OG7-E2E-REJECTED',
      reviewStatus: 'rejected'
    })
  ];
  const plan = planFor(fixtures);
  const rows = insertRows(plan.insertStatements, 'fund_contributions');
  assert.deepEqual(
    rows.map((row) => row.sponsor_review_status),
    ['pending_review', 'approved', 'rejected']
  );
  assert.deepEqual(
    rows.map((row) => row.sponsor_reviewed_at),
    [null, 'NOW()', 'NOW()']
  );
  assert.ok(rows.every((row) => row.status === 'paid'));
  assert.ok(rows.every((row) => row.sponsor_feed_target === null));
  assert.ok(rows.every((row) => row.email_private === null));
  assert.doesNotMatch(
    plan.insertStatements,
    /approved_by|approved_at|authorization|published_at/
  );
});

test('sponsorship SQL escapes synthetic quoted input, JSON channels, optional Stripe ids and payment email', () => {
  const fixture = Object.freeze(
    syntheticFixture({
      publicReference: "OG7-E2E-O'BRIEN",
      companyName: "Synthetic O'Brien, Inc.;\nSELECT 'private'",
      contactName: "O'Contact",
      contactEmail: "o'contact@example.invalid",
      websiteUrl: "https://example.invalid/o'brien",
      followupToken: "synthetic-token-o'brien",
      paymentEmail: "o'payment@example.invalid",
      stripePaymentIntentId: "pi_synthetic_o'brien",
      stripeSessionId: "cs_synthetic_o'brien",
      feedTarget: "synthetic-o'brien",
      feedChannels: Object.freeze(['facebook', "synthetic-o'brien"])
    })
  );
  const plan = planFor(Object.freeze([fixture]));
  const [row] = insertRows(plan.insertStatements, 'fund_contributions');
  for (const [column, property] of Object.entries({
    public_reference: 'publicReference',
    sponsor_company_name: 'companyName',
    sponsor_contact_name: 'contactName',
    sponsor_contact_email: 'contactEmail',
    sponsor_website_url: 'websiteUrl',
    email_private: 'paymentEmail',
    stripe_payment_intent_id: 'stripePaymentIntentId',
    stripe_session_id: 'stripeSessionId',
    sponsor_feed_target: 'feedTarget',
    sponsor_feed_channels: 'feedChannels'
  })) {
    assert.deepEqual(row[column], fixture[property]);
  }
  assert.equal(
    row.sponsorship_followup_token_hash,
    hash(fixture.followupToken)
  );
  assert.match(
    plan.deleteStatements,
    /sponsor_contact_email = 'o''contact@example\.invalid'/
  );
  assert.match(
    plan.publicationCleanup,
    /ARRAY\['OG7-E2E-O''BRIEN'\]::text\[\]/
  );
  assert.match(
    plan.publicationCleanup,
    /ARRAY\['o''contact@example\.invalid'\]::text\[\]/
  );
  const [media] = insertRows(
    plan.sponsorMediaInsertStatements,
    'sponsor_media_assets',
    true
  );
  assert.equal(media.alt_text, `Photo de presentation ${fixture.companyName}`);
  assert.equal(media.original_storage_key, "e2e/og7-e2e-o'brien/original.png");
  assert.equal(
    media.checksum_sha256,
    hash(`${fixture.publicReference}:presentation`)
  );
});

test('publication selection uses only the explicit complete list, including reference-only and email-only matches', () => {
  const sponsor = syntheticFixture();
  const publicationFixtures = Object.freeze([
    Object.freeze({
      publicReference: 'OG7-E2E-WEBHOOK',
      contactEmail: 'webhook@example.invalid'
    }),
    Object.freeze({ publicReference: 'OG7-E2E-BACKFILL' }),
    Object.freeze({ publicReference: 'OG7-E2E-EXPIRED', contactEmail: '' })
  ]);
  const plan = planFor([sponsor], publicationFixtures);
  assert.match(
    plan.publicationCleanup,
    /public_reference = ANY\(ARRAY\['OG7-E2E-WEBHOOK', 'OG7-E2E-BACKFILL', 'OG7-E2E-EXPIRED'\]::text\[\]\)/
  );
  assert.match(
    plan.publicationCleanup,
    /OR sponsor_contact_email = ANY\(ARRAY\['webhook@example\.invalid'\]::text\[\]\)/
  );
  assert.equal(
    plan.publicationCleanup.includes(sponsor.publicReference),
    false
  );
  assert.equal(plan.publicationCleanup.includes(sponsor.contactEmail), false);
  assert.equal(plan.insertStatements.includes('OG7-E2E-WEBHOOK'), false);
  assert.equal(plan.deleteStatements.includes('OG7-E2E-BACKFILL'), false);
  assert.equal(
    plan.sponsorMediaInsertStatements.includes('OG7-E2E-EXPIRED'),
    false
  );
});

test('sponsor cleanup scopes tokens and drafts by reference, removes linked emails and preserves internal deletion order', () => {
  const fixtures = [
    syntheticFixture(),
    syntheticFixture({
      publicReference: 'OG7-E2E-SECOND',
      contactEmail: 'second@example.invalid'
    })
  ];
  const plan = planFor(fixtures);
  const deletions = [
    ...plan.deleteStatements.matchAll(/DELETE FROM (\w+)/g)
  ].map((match) => match[1]);
  assert.deepEqual(
    deletions,
    fixtures.flatMap(() => [
      'sponsorship_access_tokens',
      'email_messages',
      'sponsorship_followup_drafts',
      'fund_contributions'
    ])
  );
  assert.match(
    plan.deleteStatements,
    /RETURNING email_message_id\s*\) DELETE FROM email_messages WHERE id IN \(SELECT email_message_id FROM removed\)/
  );
  for (const fixture of fixtures) {
    const reference = "'" + fixture.publicReference + "'";
    assert.equal(
      plan.deleteStatements.split('public_reference = ' + reference).length - 1,
      3
    );
    assert.ok(
      plan.deleteStatements.includes(
        "WHERE sponsor_contact_email = '" +
          fixture.contactEmail +
          "'\n   OR public_reference = " +
          reference
      )
    );
  }
  assert.ok(
    plan.deleteStatements.indexOf(fixtures[0].publicReference) <
      plan.deleteStatements.indexOf(fixtures[1].publicReference)
  );
});

test('publication guards reject shared batches, live jobs and live or foreign deliveries before deleting authorization dependencies', () => {
  const { publicationCleanup } = planFor([syntheticFixture()]);
  const sharedGuard = publicationCleanup.indexOf('RAISE EXCEPTION');
  const liveGuard = publicationCleanup.indexOf(
    'RAISE EXCEPTION',
    sharedGuard + 1
  );
  const firstDelete = publicationCleanup.indexOf('DELETE FROM');
  assert.ok(
    sharedGuard > 0 && liveGuard > sharedGuard && firstDelete > liveGuard
  );
  assert.match(
    publicationCleanup,
    /WHERE contribution_id = ANY\(contribution_ids\) AND batch_id IS NOT NULL/
  );
  assert.match(
    publicationCleanup,
    /WHERE batch_id = ANY\(batch_ids\) AND NOT contribution_id = ANY\(contribution_ids\)\) THEN\s+RAISE EXCEPTION '[^']*shared with non-fixture contributions'/
  );
  assert.match(
    publicationCleanup,
    /WHERE batch_id = ANY\(batch_ids\) OR media_id IN \(\s+SELECT id FROM sponsor_media_assets WHERE contribution_id = ANY\(contribution_ids\)/
  );
  assert.match(
    publicationCleanup,
    /WHERE id = ANY\(delivery_ids\) AND \(mode = 'live'\s+OR \(batch_id IS NOT NULL AND NOT batch_id = ANY\(batch_ids\)\)\)\)/
  );
  assert.match(
    publicationCleanup,
    /OR EXISTS\(SELECT 1 FROM social_publication_jobs\s+WHERE batch_id = ANY\(batch_ids\) AND mode = 'live'\) THEN\s+RAISE EXCEPTION '[^']*live or non-fixture publications'/
  );
  assert.deepEqual(
    [...publicationCleanup.matchAll(/DELETE FROM (\w+)/g)].map(
      (match) => match[1]
    ),
    [
      'publication_editorial_observations',
      'publication_deliveries',
      'publication_recurrences',
      'sponsor_publication_batches'
    ]
  );
  assert.doesNotMatch(
    publicationCleanup,
    /DISABLE|ALTER|TRUNCATE|SET\s+session_replication_role/
  );
});

test('each sponsor receives approved presentation media with stable keys, bytes, dimensions and review metadata', () => {
  const fixtures = Object.values(SPONSORSHIP_FIXTURES);
  const plan = planFor(fixtures);
  const rows = insertRows(
    plan.sponsorMediaInsertStatements,
    'sponsor_media_assets',
    true
  );
  assert.equal(rows.length, fixtures.length);
  for (const [index, fixture] of fixtures.entries()) {
    const key = 'e2e/' + fixture.publicReference.toLowerCase();
    assert.deepEqual(rows[index], {
      contribution_id: 'id',
      kind: 'supporting_image',
      review_status: 'approved',
      uploaded_by: 'admin',
      original_filename: 'presentation.png',
      original_mime_type: 'image/png',
      original_size_bytes: 68,
      original_storage_key: key + '/original.png',
      processed_size_bytes: 44,
      processed_storage_key: key + '/processed.webp',
      public_storage_key: key + '/public.webp',
      public_url:
        'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
      checksum_sha256: hash(fixture.publicReference + ':presentation'),
      width: 1,
      height: 1,
      alt_text: 'Photo de presentation ' + fixture.companyName,
      reviewed_at: 'NOW()',
      reviewed_by: 'e2e-seed'
    });
    assert.ok(
      plan.sponsorMediaInsertStatements.includes(
        "WHERE public_reference = '" + fixture.publicReference + "';"
      )
    );
  }
});

test('empty selections produce no sponsor writes and repeated builds are deterministic without transaction ownership', () => {
  const empty = planFor([], []);
  assert.deepEqual(Object.keys(empty), [
    'publicationCleanup',
    'deleteStatements',
    'insertStatements',
    'sponsorMediaInsertStatements'
  ]);
  assert.equal(empty.deleteStatements, '');
  assert.equal(empty.insertStatements, '');
  assert.equal(empty.sponsorMediaInsertStatements, '');
  assert.match(
    empty.publicationCleanup,
    /public_reference = ANY\(ARRAY\[\]::text\[\]\)/
  );
  assert.match(
    empty.publicationCleanup,
    /sponsor_contact_email = ANY\(ARRAY\[\]::text\[\]\)/
  );
  const fixtures = Object.freeze([Object.freeze(syntheticFixture())]);
  assert.deepEqual(planFor(fixtures), planFor(fixtures));
  for (const fragment of Object.values(planFor(fixtures))) {
    assert.equal(typeof fragment, 'string');
    assert.doesNotMatch(fragment, /\b(?:BEGIN|COMMIT|ROLLBACK);/);
  }
});
