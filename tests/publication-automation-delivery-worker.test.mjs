import assert from 'node:assert/strict';
import test from 'node:test';

import {
  complete,
  PublicationDeliveryWorker
} from '../dist/apps/funding-api/src/publication-automation/delivery-worker.js';
import {
  handleDeliveryFailure,
  observeProviderResult
} from '../dist/apps/funding-api/src/publication-automation/delivery-outcomes.js';
import { PublicationAutomationError } from '../dist/apps/funding-api/src/publication-automation/policy.js';
import { moderationQueryFixture } from './support/moderation-query-fixture.mjs';
import {
  accountQueryFixture,
  ownsAccountFixture
} from './support/publication-account-query-fixture.mjs';
import {
  qualifyCommercialFixture,
  fulfilmentQueryFixture
} from './support/publication-fulfilment-query-fixture.mjs';

const now = new Date('2030-10-03T12:00:00Z');
const delivery = (id = 'synthetic-delivery', overrides = {}) => ({
  id,
  feed_id: 'openg7:facebook',
  kind: 'news',
  batch_id: null,
  message: 'Exact approved synthetic text',
  scheduled_at: now,
  media_id: null,
  media_snapshot: null,
  source_snapshot: [],
  account_id: 'mock-openg7:facebook',
  mode: 'mock',
  auto_managed: false,
  version: 1,
  status: 'approved',
  attempts: 0,
  next_attempt_at: null,
  external_post_id: null,
  external_post_url: null,
  provider_media_id: null,
  error_code: null,
  approved_at: new Date(now.getTime() - 60000),
  published_at: null,
  ...overrides
});

function fixture(options = {}) {
  let state = {
    rows: structuredClone(options.rows ?? [delivery()]),
    audits: [],
    projections: []
  };
  qualifyCommercialFixture(state);
  const feed = {
    id: 'openg7:facebook',
    paused: false,
    autoPrepare: false,
    configured: true,
    connection: 'ready',
    checkedAt: now.toISOString(),
    accountId: state.rows[0]?.account_id ?? 'mock-openg7:facebook',
    mode: state.rows[0]?.mode ?? 'mock',
    ...options.feed
  };
  const events = [];
  const transactions = new Set();
  const preparations = new Map();
  let enabled = options.enabled ?? true;
  let commitFailures = options.commitFailures ?? 0;
  let publishedAuditFailures = options.publishedAuditFailures ?? 0;
  let observedAuditFailures = options.observedAuditFailures ?? 0;
  let databaseUnavailable = false;
  let guardCalls = 0;
  let clock = now;

  async function query(target, sql, values = [], transactional = false) {
    const text = sql.replace(/\s+/g, ' ').trim();
    events.push({ type: 'query', text, values, transactional });
    const result = (rows = []) => ({ rows, rowCount: rows.length });
    const account = accountQueryFixture(target, text, values, clock);
    if (account) return account;
    const fulfilment = fulfilmentQueryFixture(target, text, values);
    if (fulfilment) return fulfilment;
    if (text.startsWith('SELECT to_regclass('))
      return result([
        {
          has_publication_drafts: true,
          has_publication_batches: true,
          has_publication_slots: true,
          has_social_publication_jobs: true,
          has_audit_log: true,
          has_fund_allocations: true
        }
      ]);
    const moderation = moderationQueryFixture(text);
    if (moderation) return moderation;
    if (text.startsWith('UPDATE moderation_remote_removals')) return result();
    if (text.startsWith('INSERT INTO admin_audit_log')) {
      if (
        values[1] === 'publication_automation.published' &&
        publishedAuditFailures
      ) {
        publishedAuditFailures--;
        throw new Error('synthetic completion audit failure');
      }
      if (
        values[1] === 'publication_automation.provider_result_observed' &&
        observedAuditFailures
      ) {
        observedAuditFailures--;
        throw new Error('synthetic observation audit failure');
      }
      target.audits.push({
        actor: values[0],
        action: values[1],
        id: values.length === 6 ? values[3] : values[2],
        metadata: JSON.parse(values.length === 6 ? values[5] : values[3])
      });
      if (values[1] === 'publication_automation.claim')
        await options.onClaim?.(controls);
      return values.length === 6 ? { rows: [], rowCount: 1 } : result();
    }
    if (text.startsWith('SELECT metadata FROM admin_audit_log'))
      return result(
        target.audits
          .filter(
            (audit) =>
              audit.id === values[0] &&
              audit.action ===
                'publication_automation.provider_result_observed' &&
              String(audit.metadata.claimVersion) === values[1]
          )
          .map(({ metadata }) => ({ metadata: structuredClone(metadata) }))
      );
    if (text.startsWith('UPDATE publication_feeds SET last_prepared_at=')) {
      const previous = preparations.get(values[0]);
      if (previous && previous >= values[1].getTime() - 300000) return result();
      preparations.set(values[0], values[1].getTime());
      return result([{ id: values[0] }]);
    }
    if (text.startsWith('UPDATE publication_feeds SET connection=')) {
      feed.connection = 'error';
      return result();
    }
    if (text.startsWith('SELECT paused FROM publication_feeds'))
      return result([{ paused: feed.paused }]);
    if (text.startsWith('SELECT * FROM sponsor_publication_batches'))
      return result([
        { id: values[0], slot_id: null, status: 'scheduled', capacity: 10 }
      ]);
    if (text.startsWith('SELECT 1 FROM social_publication_jobs'))
      return result();
    if (text.startsWith('SELECT d.id,d.contribution_id'))
      return result(
        target.rows
          .find((row) => row.batch_id === values[0])
          ?.source_snapshot.map((source) => ({
            ...source,
            status: 'scheduled',
            sponsor_feed_status: 'planned',
            public_display_consent: true,
            sponsor_review_status: 'approved',
            payment_status: 'paid',
            destination_eligible: true
          })) ?? []
      );
    if (
      text.startsWith(
        'SELECT slot_id::text AS slot_id FROM sponsor_publication_batches'
      )
    ) {
      return result([
        {
          slot_id:
            text.includes('FOR UPDATE') &&
            Object.hasOwn(options, 'batchSlotAfterLock')
              ? options.batchSlotAfterLock
              : (options.batchSlotId ?? null)
        }
      ]);
    }
    if (text.startsWith('SELECT id::text AS id FROM publication_slots')) {
      return result([{ id: values[0] }]);
    }
    if (
      text.startsWith('SELECT id,sponsor_company_name FROM fund_contributions')
    )
      return result(
        values[0].map((id) => ({
          id,
          sponsor_company_name: 'Synthetic sponsor'
        }))
      );
    if (text.startsWith('SELECT * FROM publication_deliveries')) {
      return result(
        structuredClone(
          target.rows.filter(
            (row) =>
              row.id === values[0] &&
              row.status === 'publishing' &&
              row.version === values[1] &&
              row.approved_at &&
              row.lease_until > clock &&
              ownsAccountFixture(target, row, clock)
          )
        )
      );
    }
    if (text.startsWith('SELECT d.* FROM publication_deliveries')) {
      const rows = target.rows
        .filter(
          (row) =>
            row.status === 'approved' &&
            !values[1]?.includes(row.id) &&
            !feed.paused &&
            row.scheduled_at <= values[0] &&
            (!row.next_attempt_at || row.next_attempt_at <= values[0])
        )
        .sort((a, b) => a.scheduled_at - b.scheduled_at);
      return result(structuredClone(rows.slice(0, 1)));
    }
    if (text.startsWith('SELECT id FROM publication_deliveries'))
      return result([{ id: values[0] }]);
    if (text.includes("WHERE status='publishing' AND lease_until<$1")) {
      const stale = target.rows.filter(
        (row) => row.status === 'publishing' && row.lease_until < values[0]
      );
      for (const row of stale) {
        row.status = 'uncertain';
        row.error_code = 'LEASE_EXPIRED';
        row.version++;
      }
      return result(structuredClone(stale));
    }
    if (text.startsWith('UPDATE publication_deliveries')) {
      const row = target.rows.find((row) => row.id === values[0]);
      assert.ok(row, 'delivery exists');
      const owns = (version) =>
        row.status === 'publishing' &&
        row.version === version &&
        row.approved_at &&
        row.lease_until > clock &&
        ownsAccountFixture(target, row, clock);
      if (text.includes("SET status='publishing'")) {
        row.status = 'publishing';
        row.attempts++;
        row.version++;
        row.lease_until = new Date(clock.getTime() + 300000);
        return result([structuredClone(row)]);
      } else if (text.includes("SET status='published'")) {
        if (values.length === 4 && !owns(values[3])) return result();
        row.status = 'published';
        row.external_post_id = values[1];
        row.external_post_url = values[2];
        row.lease_until = null;
        row.error_code = null;
        row.version++;
      } else if (text.includes("SET status='approved',attempts=attempts-1")) {
        if (!owns(values[1])) return result();
        row.status = 'approved';
        row.attempts--;
        row.lease_until = null;
      } else if (text.includes('SET status=$2')) {
        if (!owns(values[4])) return result();
        row.status = values[1];
        row.error_code = values[2];
        row.next_attempt_at =
          row.status === 'approved'
            ? new Date(now.getTime() + values[3] * 60000)
            : null;
        row.lease_until = null;
        row.version++;
        if (
          values[2].startsWith('MODERATION_') ||
          [
            'SPONSOR_REVIEW_REQUIRED',
            'MEDIA_CHANGED',
            'MEDIA_NOT_APPROVED',
            'MEDIA_UNAVAILABLE',
            'SOURCE_CONTENT_MISSING',
            'INVALID_MESSAGE'
          ].includes(values[2])
        )
          row.approved_at = null;
      } else if (text.includes('SET provider_media_id=$2')) {
        if (!owns(values[2])) return result();
        row.provider_media_id = values[1];
      } else if (
        text.includes("SET status='uncertain',error_code='LEASE_EXPIRED'")
      ) {
        if (row.status !== 'publishing' || row.version !== values[1])
          return result();
        row.status = 'uncertain';
        row.error_code = 'LEASE_EXPIRED';
        row.lease_until = null;
        row.version++;
      } else assert.fail(`Unexpected delivery update: ${text}`);
      return result([{ id: row.id }]);
    }
    for (const table of [
      'sponsor_publication_batches',
      'sponsor_publication_drafts',
      'publication_slots'
    ]) {
      if (text.startsWith(`UPDATE ${table} SET status='published'`)) {
        target.projections.push({ table, values });
        return result();
      }
    }
    assert.fail(`Unexpected query: ${text}`);
  }

  const pool = {
    query: (sql, values) => {
      if (databaseUnavailable)
        throw new Error('synthetic database unavailable');
      return query(state, sql, values);
    },
    async connect() {
      if (databaseUnavailable)
        throw new Error('synthetic database unavailable');
      let pending;
      const client = {
        async query(sql, values) {
          if (sql === 'BEGIN') {
            pending = structuredClone(state);
            transactions.add(client);
          } else if (sql === 'COMMIT') {
            if (
              commitFailures &&
              pending.audits.some(
                (audit) => audit.action === 'publication_automation.published'
              )
            ) {
              commitFailures--;
              throw new Error('synthetic completion commit failure');
            }
            state = pending;
            transactions.delete(client);
          } else if (sql === 'ROLLBACK') {
            transactions.delete(client);
          } else return query(pending, sql, values, true);
          events.push({ type: sql.toLowerCase() });
          return { rows: [], rowCount: 0 };
        },
        release() {
          assert.equal(transactions.has(client), false);
          events.push({ type: 'release' });
        }
      };
      return client;
    }
  };
  const controls = {
    feed,
    events,
    transactions,
    pool,
    get state() {
      return state;
    },
    get guardCalls() {
      return guardCalls;
    },
    disable() {
      enabled = false;
    },
    enable() {
      enabled = true;
    },
    advance(milliseconds) {
      clock = new Date(clock.getTime() + milliseconds);
    },
    stopDatabase() {
      databaseUnavailable = true;
    },
    restoreDatabase() {
      databaseUnavailable = false;
    }
  };
  controls.context = {
    pool,
    storage: {
      async readPrivateObject() {
        assert.fail('text-only deliveries do not read storage');
      }
    },
    env: options.env ?? { SOCIAL_PUBLICATION_MODE: 'mock' },
    async workerSettings(db, lock) {
      await options.onSettings?.(controls, db, lock);
      return { enabled, version: 1 };
    },
    async feeds(db) {
      if (db) await options.onPreflight?.(controls);
      return [feed];
    },
    async guardEligibility() {
      guardCalls++;
      events.push({ type: 'guard' });
      await options.onGuard?.(controls);
    },
    async command(input, actor) {
      events.push({ type: 'command', input, actor });
      return {};
    },
    async prepare(feedId, actor, date) {
      events.push({ type: 'prepare', feedId, actor, date });
    }
  };
  controls.worker = new PublicationDeliveryWorker(controls.context);
  return controls;
}

test('one worker skips concurrent ticks, caps a pass at five and releases its lock', async () => {
  let start;
  let finish;
  const entered = new Promise((resolve) => (start = resolve));
  const gate = new Promise((resolve) => (finish = resolve));
  const f = fixture({
    rows: Array.from({ length: 6 }, (_, i) => delivery(`synthetic-${i}`)),
    async onGuard() {
      start();
      await gate;
    }
  });
  const first = f.worker.tick(now);
  await entered;
  await f.worker.tick(now);
  assert.equal(f.guardCalls, 1);
  assert.equal(f.state.audits.length, 0);
  finish();
  await first;
  assert.equal(
    f.state.rows.filter((row) => row.status === 'published').length,
    5
  );
  assert.equal(f.state.rows[5].status, 'approved');
  await f.worker.tick(now);
  assert.equal(f.guardCalls, 2);
  assert.ok(f.state.rows.every((row) => row.status === 'published'));
});

test('disabled processing performs no planning, claims or provider calls', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  const f = fixture({ enabled: false, feed: { autoPrepare: true } });
  await f.worker.tick(now);
  assert.equal(f.events.length, 0);
  assert.equal(f.state.rows[0].attempts, 0);
});

test('worker switch is checked under the claim transaction lock', async () => {
  const f = fixture({
    onSettings(controls, db, lock) {
      if (lock === 'FOR SHARE') {
        assert.ok(db);
        assert.equal(controls.transactions.size, 1);
        controls.disable();
      }
    }
  });
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].status, 'approved');
  assert.equal(f.state.rows[0].attempts, 0);
  assert.equal(f.state.audits.length, 0);
});

test('switching off after preflight releases the claim and preserves authorization', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  const f = fixture({ onPreflight: (controls) => controls.disable() });
  await f.worker.tick(now);
  const row = f.state.rows[0];
  assert.equal(row.status, 'approved');
  assert.equal(row.attempts, 0);
  assert.equal(row.lease_until, null);
  assert.deepEqual(row.approved_at, new Date(now.getTime() - 60000));
  assert.equal(f.state.audits.at(-1).action, 'publication_automation.deferred');
});

test('paused feeds hold claims and a pause after claim blocks dispatch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  const paused = fixture({ feed: { paused: true } });
  await paused.worker.tick(now);
  assert.equal(paused.state.rows[0].status, 'approved');
  assert.equal(paused.state.rows[0].attempts, 0);
  const changed = fixture({
    onClaim: (controls) => (controls.feed.paused = true)
  });
  await changed.worker.tick(now);
  assert.equal(changed.state.rows[0].status, 'blocked');
  assert.equal(changed.state.rows[0].error_code, 'FEED_PAUSED');
  assert.equal(
    changed.events.filter((event) => event.type === 'rollback').length,
    1
  );
});

test('private preparation remains available while paused and is bounded across restarts', async () => {
  const f = fixture({
    rows: [],
    feed: { autoPrepare: true, paused: true, configured: false }
  });
  await f.worker.tick(now);
  const restarted = new PublicationDeliveryWorker(f.context);
  await restarted.tick(new Date(now.getTime() + 299999));
  assert.equal(f.events.filter((event) => event.type === 'prepare').length, 1);
  await restarted.tick(new Date(now.getTime() + 300001));
  const prepared = f.events.filter((event) => event.type === 'prepare');
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].feedId, 'openg7:facebook');
  assert.equal(prepared[0].actor, 'publication-worker');
  assert.deepEqual(prepared[0].date, now);
  assert.equal(f.events.filter((event) => event.type === 'command').length, 0);
});

test('expired leases are quarantined and audited once without provider resend', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  const f = fixture({
    rows: [
      delivery('synthetic-stale', {
        status: 'publishing',
        attempts: 1,
        lease_until: new Date(now.getTime() - 1)
      })
    ]
  });
  await f.worker.tick(now);
  await new PublicationDeliveryWorker(f.context).tick(now);
  assert.equal(f.state.rows[0].status, 'uncertain');
  assert.equal(f.state.rows[0].error_code, 'LEASE_EXPIRED');
  assert.equal(f.state.rows[0].attempts, 1);
  assert.equal(f.state.audits.length, 1);
  assert.equal(f.state.audits[0].action, 'publication_automation.uncertain');
});

test('provider success followed by completion commit failure is quarantined without resend', async (t) => {
  const f = fixture({
    rows: [delivery('synthetic-live', { mode: 'live', account_id: '20' })],
    env: {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-token'
    },
    commitFailures: 1
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(
      f.transactions.size,
      0,
      'send follows transaction commit and release'
    );
    assert.equal(f.events.at(-1).type, 'release');
    assert.match(url, /\/20\/feed$/);
    assert.equal(init.body.get('message'), 'Exact approved synthetic text');
    return Response.json({ id: '20_1' });
  });
  await f.worker.tick(now);
  await new PublicationDeliveryWorker(f.context).tick(now);
  assert.equal(calls, 1);
  assert.equal(f.state.rows[0].status, 'uncertain');
  assert.equal(f.state.rows[0].error_code, 'DELIVERY_INTERRUPTED');
  assert.equal(f.state.rows[0].next_attempt_at, null);
  assert.equal(f.state.rows[0].external_post_id, null);
  assert.equal(
    f.state.audits.some((audit) => audit.action.endsWith('.published')),
    false
  );
  assert.equal(
    f.state.audits.at(-1).action,
    'publication_automation.uncertain'
  );
  assert.deepEqual(
    f.state.audits.filter(
      (audit) =>
        audit.action === 'publication_automation.provider_result_observed'
    ),
    [
      {
        actor: 'publication-worker',
        action: 'publication_automation.provider_result_observed',
        id: 'synthetic-live',
        metadata: {
          claimVersion: 2,
          mode: 'live',
          feedId: 'openg7:facebook',
          externalPostId: '20_1',
          externalPostUrl: 'https://www.facebook.com/20_1'
        }
      }
    ]
  );
  assert.equal(f.state.audits.at(-1).metadata.externalPostId, '20_1');
});

test('provider acknowledgement survives completion audit failure and failed initial observation', async (t) => {
  for (const failure of ['publishedAuditFailures', 'observedAuditFailures']) {
    await t.test(failure, async (st) => {
      const f = fixture({
        rows: [delivery('synthetic-live', { mode: 'live', account_id: '20' })],
        env: {
          SOCIAL_PUBLICATION_MODE: 'live',
          SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
          SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-token'
        },
        [failure]: 1
      });
      let calls = 0;
      st.mock.method(globalThis, 'fetch', async () => {
        calls++;
        return Response.json({ id: '20_2' });
      });
      await f.worker.tick(now);
      await new PublicationDeliveryWorker(f.context).tick(now);
      assert.equal(calls, 1);
      assert.equal(f.state.rows[0].status, 'uncertain');
      assert.equal(f.state.rows[0].external_post_id, null);
      assert.equal(f.state.rows[0].next_attempt_at, null);
      assert.equal(
        f.state.audits.some((audit) => audit.action.endsWith('.published')),
        false
      );
      assert.deepEqual(f.state.audits.at(-1).metadata, {
        code: 'DELIVERY_INTERRUPTED',
        claimVersion: 2,
        mode: 'live',
        feedId: 'openg7:facebook',
        externalPostId: '20_2',
        externalPostUrl: 'https://www.facebook.com/20_2'
      });
    });
  }
});

test('observation is idempotent for its claim and rejects incompatible references without publishing', async () => {
  const f = fixture({
    rows: [
      delivery('synthetic-observation', {
        status: 'publishing',
        lease_until: new Date(now.getTime() + 300000)
      })
    ]
  });
  const row = structuredClone(f.state.rows[0]);
  const result = {
    externalPostId: 'synthetic-post',
    externalPostUrl: 'https://example.test/post'
  };
  await observeProviderResult(f.context, row, result);
  await observeProviderResult(f.context, row, result);
  assert.equal(f.state.audits.length, 1);
  assert.equal(f.state.rows[0].status, 'publishing');
  assert.equal(f.state.rows[0].external_post_id, null);
  assert.equal(f.state.projections.length, 0);
  await assert.rejects(
    observeProviderResult(f.context, row, {
      ...result,
      externalPostId: 'incompatible-post'
    }),
    { code: 'PROVIDER_RESULT_CONFLICT' }
  );
  assert.equal(f.state.audits.length, 1);
});

test('a business failure after acknowledgement stays uncertain and cannot return to an approved retry', async () => {
  const f = fixture({
    rows: [
      delivery('synthetic-acknowledged', {
        status: 'publishing',
        attempts: 1,
        lease_until: new Date(now.getTime() + 300000)
      })
    ]
  });
  const row = structuredClone(f.state.rows[0]);
  await handleDeliveryFailure(
    f.context,
    row,
    new PublicationAutomationError('WORKER_DISABLED'),
    true,
    { externalPostId: 'synthetic-post', externalPostUrl: null }
  );
  assert.equal(f.state.rows[0].status, 'uncertain');
  assert.equal(f.state.rows[0].next_attempt_at, null);
  assert.equal(f.state.rows[0].attempts, 1);
  assert.equal(f.state.audits.at(-1).metadata.externalPostId, 'synthetic-post');
});

test('persistent database unavailability cannot invent a stored acknowledgement or retry a submitted delivery', async (t) => {
  const f = fixture({
    rows: [delivery('synthetic-live', { mode: 'live', account_id: '20' })],
    env: {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-token'
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    f.stopDatabase();
    return Response.json({ id: '20_3' });
  });
  await assert.rejects(f.worker.tick(now), /synthetic database unavailable/);
  assert.equal(f.state.rows[0].status, 'publishing');
  assert.equal(f.state.rows[0].external_post_id, null);
  assert.equal(
    f.state.audits.length,
    1,
    'only the claim committed before the outage'
  );
  f.restoreDatabase();
  f.advance(300001);
  await new PublicationDeliveryWorker(f.context).tick(
    new Date(now.getTime() + 300001)
  );
  assert.equal(f.state.rows[0].status, 'uncertain');
  assert.equal(calls, 1);
  assert.equal(
    f.state.audits.some((audit) => audit.action.endsWith('.published')),
    false
  );
});

test('ambiguous provider response is quarantined without an implicit retry', async (t) => {
  const f = fixture({
    rows: [delivery('synthetic-live', { mode: 'live', account_id: '20' })],
    env: {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-token'
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    assert.equal(f.transactions.size, 0);
    return new Response(null, { status: 503 });
  });
  await f.worker.tick(now);
  await f.worker.tick(now);
  assert.equal(calls, 1);
  assert.equal(f.state.rows[0].status, 'uncertain');
  assert.equal(f.state.rows[0].error_code, 'PROVIDER_HTTP_503');
  assert.equal(f.state.rows[0].next_attempt_at, null);
});

test('an invalid legacy approved message revokes authorization before dispatch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  const f = fixture({
    rows: [delivery('synthetic-invalid', { message: 'x'.repeat(2901) })]
  });
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].status, 'blocked');
  assert.equal(f.state.rows[0].error_code, 'INVALID_MESSAGE');
  assert.equal(f.state.rows[0].approved_at, null);
  assert.equal(f.state.rows[0].external_post_id, null);
  assert.equal(f.state.projections.length, 0);
  assert.equal(
    f.state.audits.some((audit) =>
      audit.action.endsWith('.provider_result_observed')
    ),
    false
  );
});

test('simulation completes a delivery without marking sponsorship benefits delivered', async () => {
  const f = fixture();
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].status, 'published');
  assert.equal(f.state.rows[0].external_post_id, 'mock-synthetic-delivery');
  assert.equal(f.state.audits.at(-1).metadata.mode, 'mock');
  assert.equal(f.state.projections.length, 0);
});

test('completion updates sponsorship projections only for live deliveries', async () => {
  for (const mode of ['mock', 'live']) {
    const f = fixture({
      rows: [
        delivery('synthetic-batch-delivery', {
          mode,
          batch_id: 'synthetic-batch',
          message:
            'Synthetic sponsor\n\nSynthetic sponsor contribution\n\nPaid sponsorship.',
          source_snapshot: [
            {
              id: 'synthetic-draft',
              contribution_id: 'synthetic-sponsor',
              title: 'Synthetic sponsor',
              body: 'Synthetic sponsor contribution',
              disclosure_text: 'Paid sponsorship.',
              feed_target: 'openg7',
              channel: 'facebook'
            }
          ]
        })
      ]
    });
    await complete(
      f.pool,
      f.state.rows[0],
      'synthetic-post',
      'https://example.test/post',
      'synthetic-reviewer'
    );
    assert.equal(f.state.rows[0].status, 'published');
    const publishedAudit = f.state.audits.find(
      (audit) => audit.action === 'publication_automation.published'
    );
    assert.equal(publishedAudit.actor, 'synthetic-reviewer');
    assert.equal(publishedAudit.metadata.mode, mode);
    assert.deepEqual(
      f.state.projections.map(({ table }) => table),
      mode === 'live'
        ? [
            'sponsor_publication_batches',
            'sponsor_publication_drafts',
            'publication_slots'
          ]
        : []
    );
    if (mode === 'live') {
      assert.deepEqual(f.state.projections[0].values, ['synthetic-batch']);
      assert.deepEqual(f.state.projections[1].values, [
        ['synthetic-draft'],
        'https://example.test/post'
      ]);
    }
  }
});

test('completion cannot record an older externally verified post whose beneficiary block is missing', async () => {
  const f = fixture({
    rows: [
      delivery('synthetic-incomplete-batch', {
        mode: 'live',
        batch_id: 'synthetic-batch',
        message: 'A historical post that omitted its sponsor',
        source_snapshot: [
          {
            id: 'synthetic-draft',
            contribution_id: 'synthetic-sponsor',
            title: 'Synthetic sponsor',
            body: 'Synthetic sponsor contribution',
            disclosure_text: 'Paid sponsorship.',
            feed_target: 'openg7',
            channel: 'facebook'
          }
        ]
      })
    ]
  });
  const before = structuredClone(f.state.rows[0]);
  await assert.rejects(
    complete(
      f.pool,
      before,
      'synthetic-post',
      'https://example.test/post',
      'synthetic-reviewer'
    ),
    { code: 'SOURCE_CONTENT_MISSING' }
  );
  assert.deepEqual(f.state.rows[0], before);
  assert.equal(f.state.audits.length, 0);
  assert.equal(f.state.projections.length, 0);
});

test('completion preserves an uncertain delivery when its batch association changes before locking', async () => {
  const f = fixture({
    batchSlotId: 'synthetic-original-slot',
    batchSlotAfterLock: 'synthetic-new-slot',
    rows: [
      delivery('synthetic-uncertain-batch', {
        mode: 'live',
        batch_id: 'synthetic-batch',
        status: 'uncertain'
      })
    ]
  });
  const before = structuredClone(f.state.rows[0]);
  await assert.rejects(
    complete(
      f.pool,
      before,
      'synthetic-post',
      'https://example.test/post',
      'synthetic-reviewer'
    ),
    { code: 'SOURCE_CHANGED' }
  );
  assert.deepEqual(f.state.rows[0], before);
  assert.equal(f.state.projections.length, 0);
  assert.equal(f.state.audits.length, 0);
  assert.equal(
    f.events.some(({ text }) =>
      text?.startsWith('UPDATE publication_deliveries')
    ),
    false
  );
});

test('revocation after preflight stops the old worker before dispatch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  let settingsReads = 0;
  const f = fixture({
    onSettings(controls, db) {
      if (!db && ++settingsReads === 2) {
        const row = controls.state.rows[0];
        row.status = 'blocked';
        row.approved_at = null;
        row.version++;
      }
    }
  });
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].status, 'blocked');
  assert.equal(f.state.rows[0].approved_at, null);
  assert.equal(f.state.rows[0].version, 3);
  assert.equal(f.state.projections.length, 0);
  assert.deepEqual(
    f.state.audits.map((a) => a.action),
    ['publication_automation.claim']
  );
});

test('lease expiration without another worker stops dispatch and quarantines once', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no dispatch'));
  let settingsReads = 0;
  const f = fixture({
    onSettings(controls, db) {
      if (!db && ++settingsReads === 2) controls.advance(300001);
    }
  });
  await f.worker.tick(now);
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].status, 'uncertain');
  assert.equal(f.state.rows[0].error_code, 'LEASE_EXPIRED');
  assert.equal(
    f.state.audits.filter((a) => a.action.endsWith('.uncertain')).length,
    1
  );
});

test('late provider success preserves the newer decision and records its external result', async (t) => {
  const f = fixture({
    rows: [delivery('synthetic-live', { mode: 'live', account_id: '20' })],
    env: {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-token'
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const row = f.state.rows[0];
    row.status = 'blocked';
    row.approved_at = null;
    row.error_code = 'synthetic-new-decision';
    row.version++;
    return Response.json({ id: '20_8' });
  });
  await f.worker.tick(now);
  assert.equal(calls, 1);
  assert.equal(f.state.rows[0].status, 'blocked');
  assert.equal(f.state.rows[0].version, 3);
  assert.equal(f.state.rows[0].external_post_id, null);
  assert.equal(f.state.rows[0].error_code, 'synthetic-new-decision');
  assert.equal(f.state.projections.length, 0);
  assert.deepEqual(f.state.audits.at(-1), {
    actor: 'publication-worker',
    action: 'publication_automation.late_result',
    id: 'synthetic-live',
    metadata: {
      claimVersion: 2,
      mode: 'live',
      feedId: 'openg7:facebook',
      externalPostId: '20_8',
      externalPostUrl: 'https://www.facebook.com/20_8'
    }
  });
});

test('late provider rejection cannot change a newer claim or its connection', async (t) => {
  const f = fixture({
    rows: [delivery('synthetic-live', { mode: 'live', account_id: '20' })],
    env: {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-token'
    }
  });
  t.mock.method(globalThis, 'fetch', async () => {
    const row = f.state.rows[0];
    row.version++;
    row.provider_media_id = 'synthetic-new-image';
    return new Response('{}', { status: 403 });
  });
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].status, 'publishing');
  assert.equal(f.state.rows[0].version, 3);
  assert.equal(f.state.rows[0].provider_media_id, 'synthetic-new-image');
  assert.equal(f.state.rows[0].error_code, null);
  assert.equal(f.feed.connection, 'ready');
  assert.deepEqual(
    f.state.audits.map((a) => a.action),
    ['publication_automation.claim']
  );
});

test('claims keep increasing versions when the global switch restores the attempt count', async () => {
  const f = fixture({ onPreflight: (controls) => controls.disable() });
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].attempts, 0);
  assert.equal(f.state.rows[0].version, 2);
  f.enable();
  await f.worker.tick(now);
  assert.equal(f.state.rows[0].attempts, 0);
  assert.equal(f.state.rows[0].version, 3);
  assert.deepEqual(
    f.state.audits
      .filter((a) => a.action.endsWith('.claim'))
      .map((a) => a.metadata.claimVersion),
    [2, 3]
  );
});
