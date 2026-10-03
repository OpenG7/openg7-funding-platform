import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { loadAdminPilotageState } from '../dist/apps/funding-api/src/admin-pilotage.read-model.js';
import { pilotageVersion } from '../dist/apps/funding-api/src/admin-pilotage-version.js';

const version = '2026-10-03 12:34:56.123456+00';
const future = '2099-10-03T12:00:00.000Z';
const feed = {
  id: 'openg7:facebook',
  configured: true,
  connection: 'ready',
  mode: 'mock',
  accountId: 'synthetic-account',
  paused: true,
  autoPrepare: false,
  timezone: 'America/Toronto',
  weekdays: [1],
  localTime: '09:00',
  capacity: 3,
  horizonDays: 7,
  expiresAt: null,
  checkedAt: '2026-10-03T12:00:00.000Z'
};
const delivery = (id, overrides = {}) => ({
  id,
  feedId: feed.id,
  batchId: null,
  message: 'Synthetic proposal\nExact second line',
  scheduledAt: future,
  accountId: feed.accountId,
  mode: 'mock',
  sponsors: [],
  status: 'draft',
  version: 3,
  ...overrides
});
const project = (id, overrides = {}) => ({
  id,
  project_name: 'Synthetic project',
  public_description: 'Synthetic public description',
  expected_outcome: 'Synthetic outcome',
  progress_status: 'planned',
  amount_allocated: '10000',
  currency: 'cad',
  status: 'draft',
  updated_at: version,
  ...overrides
});
const sponsor = (id, overrides = {}) => ({
  contribution_id: id,
  public_reference: 'SYNTHETIC-' + id,
  amount_cents: '10000',
  currency: 'cad',
  payment_status: 'paid',
  paid_at: '2099-10-01T00:00:00.000Z',
  updated_at: version,
  sponsor_details_submitted_at: '2099-10-02T00:00:00.000Z',
  has_company_name: true,
  has_contact_email: true,
  has_supporting_image: true,
  sponsor_review_status: 'pending_review',
  sponsor_feed_status: 'not_planned',
  sponsorship_refund_status: 'not_requested',
  ...overrides
});
const email = (id) => ({
  id,
  template_key: 'synthetic-template',
  recipient_email: 'synthetic@example.test',
  subject: 'Synthetic email ' + id,
  status: 'failed',
  attempts: 1,
  max_attempts: 3,
  last_error: null,
  updated_at: version
});

const fixture = (options = {}) => {
  const calls = [];
  const sponsors = options.sponsors ?? [];
  const emails = options.emails ?? [];
  const publications = {
    state: async () => {
      if (options.failPublications)
        throw new Error('Synthetic publication failure');
      return {
        feeds: options.feeds ?? [feed],
        deliveries: options.deliveries ?? [],
        summary: options.summary ?? { awaitingApproval: 0, exceptions: 0 },
        workerEnabled: false
      };
    }
  };
  const pool = {
    query: async (statement, values = []) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      calls.push({ sql, values });
      assert.match(
        sql,
        /^(SELECT|WITH) /,
        'The read model only reads existing data'
      );
      if (sql.includes("to_regclass('public.admin_command_receipts')")) {
        if (options.failReceipts) throw new Error('Synthetic receipt failure');
        return { rows: [{ present: options.receiptsPresent ?? true }] };
      }
      if (sql.includes('FROM unnest($1::text[])')) {
        if (options.failAttention)
          throw new Error('Synthetic attention failure');
        return {
          rows: values[0].map((name) => ({
            name,
            present: !(options.missingAttention ?? []).includes(name)
          }))
        };
      }
      if (sql.includes('AS has_fund_allocations'))
        return { rows: [{ has_fund_allocations: true }] };
      if (sql.includes('FROM fund_allocations')) {
        if (options.failProjects) throw new Error('Synthetic project failure');
        return {
          rows: sql.includes('project_name') ? (options.projects ?? []) : []
        };
      }
      if (sql.includes('AS has_email_messages'))
        return { rows: [{ has_email_messages: true }] };
      if (sql.includes('AS exists')) return { rows: [{ exists: true }] };
      if (sql.includes('AS contribution_id,')) return { rows: sponsors };
      if (sql.startsWith('SELECT c.id,c.sponsor_company_name')) {
        if (options.failSponsors) throw new Error('Synthetic sponsor failure');
        return {
          rows: sponsors
            .filter((s) => values[0].includes(s.contribution_id))
            .map((s) => ({
              id: s.contribution_id,
              sponsor_company_name: 'Synthetic sponsor ' + s.contribution_id,
              sponsor_review_status: s.sponsor_review_status,
              status: s.payment_status,
              version: s.updated_at,
              media_id: 'synthetic-media',
              photo: true
            }))
        };
      }
      if (sql.startsWith('SELECT id,subject,status,updated_at::text')) {
        if (options.failEmails) throw new Error('Synthetic email failure');
        return {
          rows: emails
            .filter((e) => values[0].includes(e.id))
            .map((e) => ({ ...e, version: e.updated_at }))
        };
      }
      if (sql.startsWith('SELECT subject,text_body,recipient_email')) {
        if (options.failPrivateEmail)
          throw new Error('Synthetic private email failure');
        return {
          rows: emails
            .filter((e) => e.id === values[0])
            .map((e) => ({ ...e, text_body: 'Synthetic private body ' + e.id }))
        };
      }
      if (sql.includes('FROM email_messages') && sql.includes('template_key,'))
        return { rows: emails };
      return { rows: [] };
    }
  };
  return {
    calls,
    load: (query = {}, writable = true, owner = true) =>
      loadAdminPilotageState(pool, publications, query, writable, owner)
  };
};

test('independent failed sources retain available decisions and unavailable receipts disable commands', async () => {
  const f = fixture({
    failAttention: true,
    failProjects: true,
    failReceipts: true,
    deliveries: [delivery('available')]
  });
  const state = await f.load();
  assert.equal(state.coverage, 'partial');
  assert.deepEqual(state.missingSources, ['commands', 'attention', 'projects']);
  assert.equal(state.writable, false);
  assert.equal(state.decisions[0].targetId, 'available');
  assert.ok(state.decisions[0].actions.every((a) => a.blocked === 'READ_ONLY'));

  const absent = await fixture({ receiptsPresent: false }).load();
  assert.deepEqual(absent.missingSources, ['commands']);
  assert.equal(absent.writable, false);
});

test('partial attention and the publication window report their exact missing sources', async () => {
  const state = await fixture({
    missingAttention: ['email_messages', 'stripe_events'],
    summary: { awaitingApproval: 2, exceptions: 1 },
    deliveries: [delivery('visible')]
  }).load();
  assert.equal(state.coverage, 'partial');
  assert.deepEqual(state.missingSources, [
    'publication_limit',
    'attention:stripe_events',
    'attention:email_messages'
  ]);
  assert.equal(state.total, 1);
  assert.equal(state.writable, true);
});

test('sponsor and email enrichment failures remain independent and preserve other domains', async () => {
  const options = {
    failPublications: true,
    sponsors: [sponsor('sponsor')],
    emails: [email('email')],
    projects: [project('42')]
  };
  const sponsorFailure = await fixture({
    ...options,
    failSponsors: true
  }).load();
  assert.deepEqual(sponsorFailure.missingSources, ['publications', 'sponsors']);
  assert.equal(sponsorFailure.domains.sponsors, 1);
  assert.equal(sponsorFailure.domains.email, 1);
  assert.equal(sponsorFailure.domains.projects, 1);
  assert.equal(
    sponsorFailure.decisions.find((d) => d.domain === 'email').actions[0].id,
    'email.retry'
  );
  assert.deepEqual(
    sponsorFailure.decisions.find((d) => d.domain === 'sponsors').actions,
    []
  );

  const emailFailure = await fixture({ ...options, failEmails: true }).load();
  assert.deepEqual(emailFailure.missingSources, ['publications', 'email']);
  assert.equal(
    emailFailure.decisions.find((d) => d.domain === 'sponsors').actions[0].id,
    'sponsor.approve'
  );
  assert.deepEqual(
    emailFailure.decisions.find((d) => d.domain === 'email').actions,
    []
  );
});

test('publication representation removes duplicate sponsor review while versions retain PostgreSQL precision', async () => {
  const options = {
    sponsors: [sponsor('represented'), sponsor('available')],
    emails: [email('mail')],
    deliveries: [
      delivery('scheduled', {
        status: 'approved',
        sponsors: [{ id: 'represented' }]
      })
    ]
  };
  const state = await fixture(options).load();
  assert.equal(state.domains.sponsors, 1);
  assert.equal(state.domains.publications, 0);
  const sponsorCard = state.decisions.find((d) => d.domain === 'sponsors');
  assert.equal(sponsorCard.targetId, 'available');
  assert.equal(sponsorCard.version, version);
  assert.equal(
    state.decisions.find((d) => d.domain === 'email').version,
    version
  );
  assert.equal(
    state.feeds[0].version,
    createHash('sha256').update(JSON.stringify(feed)).digest('hex')
  );
  assert.equal(state.feeds[0].version, pilotageVersion(feed));
});

test('priority, due date, ID ties and duplicate IDs are resolved before pagination and focus', async () => {
  const drafts = Array.from({ length: 33 }, (_, i) =>
    delivery('draft-' + String(i).padStart(2, '0'))
  );
  const f = fixture({
    projects: [project('42')],
    deliveries: [
      ...drafts.toReversed(),
      delivery('urgent-b', { status: 'uncertain' }),
      delivery('urgent-a', { status: 'uncertain' }),
      delivery('today', { status: 'blocked' }),
      delivery('draft-00', { message: 'Latest duplicate card' }),
      delivery('earlier', { scheduledAt: '2099-10-02T12:00:00.000Z' })
    ]
  });
  const first = await f.load({ domain: 'publications' });
  assert.deepEqual(
    first.decisions.slice(0, 5).map((d) => d.targetId),
    ['urgent-a', 'urgent-b', 'today', 'earlier', 'draft-00']
  );
  assert.equal(first.decisions[4].title, 'Latest duplicate card');
  assert.equal(first.pageSize, 30);
  assert.equal(first.total, 37);
  assert.equal(first.domains.publications, 37);
  assert.equal(first.domains.projects, 1);
  const second = await f.load({ domain: 'publications', page: 1000 });
  assert.equal(second.page, 2);
  assert.equal(second.decisions.length, 7);
  const focus = await f.load({
    domain: 'publications',
    id: 'publication:draft-32'
  });
  assert.equal(focus.total, 1);
  assert.equal(focus.page, 1);
  assert.equal(focus.focusPage, 2);
  assert.equal(focus.decisions[0].targetId, 'draft-32');
});

test('reader and operator projections retain their separate command restrictions', async () => {
  const f = fixture({
    deliveries: [delivery('publication')],
    sponsors: [sponsor('sponsor')],
    emails: [email('email')],
    projects: [project('42')]
  });
  const reader = await f.load({}, false, false);
  assert.equal(reader.writable, false);
  assert.ok(
    reader.decisions.every((d) =>
      d.actions.every((a) => a.blocked === 'READ_ONLY')
    )
  );
  const operator = await f.load({}, true, false);
  assert.equal(operator.writable, true);
  assert.equal(
    operator.decisions.find((d) => d.domain === 'projects').actions[0].blocked,
    'READ_ONLY'
  );
  for (const domain of ['publications', 'sponsors', 'email'])
    assert.equal(
      operator.decisions.find((d) => d.domain === domain).actions[0].blocked,
      null
    );
});

test('private email content requires explicit selection of a matching email card', async () => {
  const f = fixture({ emails: [email('first'), email('second')] });
  for (const query of [
    {},
    { domain: 'email' },
    { id: 'missing' },
    { id: 'email_delivery_failed:first', domain: 'publications' }
  ]) {
    const state = await f.load(query);
    assert.ok(state.decisions.every((d) => d.email === undefined));
  }
  assert.equal(f.calls.filter((c) => c.sql.includes('text_body')).length, 0);
  const selected = await f.load(
    { id: 'email_delivery_failed:second' },
    false,
    false
  );
  assert.equal(selected.decisions.length, 1);
  assert.deepEqual(selected.decisions[0].email, {
    subject: 'Synthetic email second',
    text: 'Synthetic private body second',
    recipient: 'synthetic@example.test'
  });
  assert.deepEqual(
    f.calls.filter((c) => c.sql.includes('text_body')).map((c) => c.values),
    [['second']]
  );
  const unavailable = fixture({
    emails: [email('first')],
    failPrivateEmail: true
  });
  await assert.rejects(
    unavailable.load({ id: 'email_delivery_failed:first' }),
    {
      message: 'Synthetic private email failure'
    }
  );
});

test('approval guards keep connection, schedule, sponsor media and review precedence', async () => {
  const f = fixture({
    deliveries: [
      delivery('connection', {
        feedId: 'openg20:linkedin',
        scheduledAt: '2000-01-01T00:00:00.000Z'
      }),
      delivery('schedule', {
        scheduledAt: '2000-01-01T00:00:00.000Z',
        sponsors: [
          { reviewStatus: 'pending_review', presentationApproved: false }
        ]
      }),
      delivery('media', {
        sponsors: [
          { reviewStatus: 'pending_review', presentationApproved: false }
        ]
      }),
      delivery('review', { status: 'blocked', feedId: 'openg20:linkedin' }),
      delivery('uncertain', { status: 'uncertain' })
    ]
  });
  const state = await f.load();
  for (const [id, blocked] of [
    ['connection', 'CONNECTION_REQUIRED'],
    ['schedule', 'SCHEDULE_EXPIRED'],
    ['media', 'SPONSOR_MEDIA_REQUIRED'],
    ['review', 'REVIEW_REQUIRED']
  ]) {
    const card = state.decisions.find((d) => d.targetId === id);
    assert.equal(card.actions[0].blocked, blocked);
    assert.equal(card.actions[1].blocked, null);
    assert.equal(card.actions[2].blocked, null);
  }
  assert.deepEqual(
    state.decisions.find((d) => d.targetId === 'uncertain').actions,
    []
  );
});
