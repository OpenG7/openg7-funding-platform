import assert from 'node:assert/strict';
import test from 'node:test';

import {
  complete,
  PublicationDeliveryWorker
} from '../dist/apps/funding-api/src/publication-automation/delivery-worker.js';

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
  let guardCalls = 0;

  async function query(target, sql, values = [], transactional = false) {
    const text = sql.replace(/\s+/g, ' ').trim();
    events.push({ type: 'query', text, values, transactional });
    const result = (rows = []) => ({ rows, rowCount: rows.length });
    if (text.startsWith('INSERT INTO admin_audit_log')) {
      target.audits.push({
        actor: values[0],
        action: values[1],
        id: values[2],
        metadata: JSON.parse(values[3])
      });
      if (values[1] === 'publication_automation.claim')
        await options.onClaim?.(controls);
      return result();
    }
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
    if (text.startsWith('SELECT d.* FROM publication_deliveries')) {
      const rows = target.rows
        .filter(
          (row) =>
            row.status === 'approved' &&
            !feed.paused &&
            row.scheduled_at <= values[0] &&
            (!row.next_attempt_at || row.next_attempt_at <= values[0])
        )
        .sort((a, b) => a.scheduled_at - b.scheduled_at);
      return result(structuredClone(rows.slice(0, 1)));
    }
    if (text.startsWith('SELECT id FROM publication_deliveries'))
      return result([{ id: values[0] }]);
    if (text.includes("error_code='LEASE_EXPIRED'")) {
      const stale = target.rows.filter(
        (row) => row.status === 'publishing' && row.lease_until < values[0]
      );
      for (const row of stale) {
        row.status = 'uncertain';
        row.error_code = 'LEASE_EXPIRED';
        row.version++;
      }
      return result(stale.map(({ id }) => ({ id })));
    }
    if (text.startsWith('UPDATE publication_deliveries')) {
      const row = target.rows.find((row) => row.id === values[0]);
      assert.ok(row, 'delivery exists');
      if (text.includes("SET status='publishing'")) {
        row.status = 'publishing';
        row.attempts++;
        row.lease_until = new Date(now.getTime() + 300000);
      } else if (text.includes("SET status='published'")) {
        row.status = 'published';
        row.external_post_id = values[1];
        row.external_post_url = values[2];
        row.lease_until = null;
        row.error_code = null;
        row.version++;
      } else if (text.includes("SET status='approved',attempts=attempts-1")) {
        if (row.status !== 'publishing') return result();
        row.status = 'approved';
        row.attempts--;
        row.lease_until = null;
      } else if (text.includes('SET status=$2')) {
        if (row.status !== 'publishing') return result();
        row.status = values[1];
        row.error_code = values[2];
        row.next_attempt_at =
          row.status === 'approved'
            ? new Date(now.getTime() + values[3] * 60000)
            : null;
        row.lease_until = null;
        row.version++;
      } else if (text.includes('SET provider_media_id=$2')) {
        row.provider_media_id = values[1];
      } else assert.fail(`Unexpected delivery update: ${text}`);
      return result();
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
    query: (sql, values) => query(state, sql, values),
    async connect() {
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
          source_snapshot: [{ id: 'synthetic-draft' }]
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
    assert.equal(f.state.audits[0].actor, 'synthetic-reviewer');
    assert.equal(f.state.audits[0].metadata.mode, mode);
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
