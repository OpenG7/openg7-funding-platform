// Executed only inside the disposable acceptance API container. The receiver
// binds loopback and never forwards a notification to an external service.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import pg from 'pg';

assert.equal(process.env.OPENG7_E2E_ISOLATED, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'postgres');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/acceptance');
const { emailId, failedId, stalledId } = JSON.parse(process.argv[1]);
const keys = [`email:${emailId}`, `stripe:${failedId}`, `stripe:${stalledId}`];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const secret = 'synthetic-operations-acceptance-secret';
const attempts = [];
const accepted = new Map();
let mode = 'refuse';
const errors = [];
const receiver = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/hook');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const timestamp = req.headers['x-openg7-timestamp'];
    assert.ok(Math.abs(Date.now() / 1000 - Number(timestamp)) < 60);
    assert.equal(
      req.headers['x-openg7-signature'],
      createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')
    );
    assert.equal(req.headers['x-openg7-event-id'], body.eventId);
    assert.deepEqual(Object.keys(body).sort(), [
      'adminUrl',
      'eventId',
      'firstSeen',
      'severity',
      'type'
    ]);
    assert.doesNotMatch(
      raw,
      /private|evt_|recipient|subject|payload|token|password/i
    );
    assert.equal(body.severity, 'urgent');
    assert.equal(
      body.adminUrl,
      process.env.FUNDING_PUBLIC_BASE_URL + '/admin/fundraiser/attention'
    );
    assert.ok(Number.isFinite(Date.parse(body.firstSeen)));
    const { rows } = await pool.query(
      'SELECT incident_key FROM operations_alerts WHERE id=$1',
      [body.eventId]
    );
    // Other acceptance specs can leave incidents behind. Acknowledge their
    // alerts locally, but inject failures and count only this recipe's rows.
    if (!keys.includes(rows[0]?.incident_key)) {
      res.writeHead(204).end();
      return;
    }
    attempts.push(body);
    if (mode === 'refuse') {
      res.writeHead(503).end();
      return;
    }
    // Record logical acceptance before simulating a lost HTTP response.
    // This test adapter illustrates the receiver's mandatory ID deduplication.
    if (accepted.has(body.eventId))
      assert.deepEqual(body, accepted.get(body.eventId));
    else accepted.set(body.eventId, body);
    if (mode === 'lose-response') res.destroy();
    else res.writeHead(204).end();
  } catch (error) {
    errors.push(error.message);
    res.writeHead(400).end();
  }
});
try {
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    FUNDING_PUBLIC_BASE_URL: process.env.FUNDING_PUBLIC_BASE_URL,
    FUNDING_OPERATIONS_WEBHOOK_URL: `http://127.0.0.1:${receiver.address().port}/hook`,
    FUNDING_OPERATIONS_WEBHOOK_SECRET: secret
  };
  const run = async () => {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ['scripts/operations-watch.mjs', '--once'],
      { env, timeout: 30000 }
    );
    assert.equal(stderr, '');
    const log = JSON.parse(stdout.trim());
    assert.equal(log.status, 'checked');
    return log.delivered;
  };
  const states = async () =>
    (
      await pool.query(
        `SELECT id,incident_key,attempts,delivered_at,resolved_at,
    extract(epoch FROM next_attempt_at-now())::float AS delay FROM operations_alerts
    WHERE incident_key=ANY($1::text[]) ORDER BY incident_key,created_at`,
        [keys]
      )
    ).rows;
  const due = () =>
    pool.query(
      'UPDATE operations_alerts SET next_attempt_at=now() WHERE incident_key=ANY($1::text[])',
      [keys]
    );
  await run();
  const first = await states();
  assert.equal(first.length, 3);
  for (const row of first) {
    assert.equal(row.attempts, 1);
    assert.equal(row.delivered_at, null);
    assert.ok(row.delay > 50 && row.delay <= 60);
  }
  assert.equal(attempts.length, 3);
  assert.equal(accepted.size, 0);
  await run();
  assert.equal(
    attempts.length,
    3,
    'Retry deadline survives a fresh watcher process'
  );
  await due();
  mode = 'lose-response';
  await run();
  assert.equal(accepted.size, 3);
  for (const row of await states()) {
    assert.equal(row.attempts, 2);
    assert.equal(row.delivered_at, null);
    assert.ok(row.delay > 110 && row.delay <= 120);
  }
  await due();
  mode = 'accept';
  const concurrent = await Promise.all([run(), run()]);
  assert.ok(concurrent.reduce((a, b) => a + b, 0) >= 3);
  assert.equal(
    accepted.size,
    3,
    'Lost responses must not create a second logical notification'
  );
  assert.equal(attempts.length, 9);
  for (const row of await states()) {
    assert.equal(row.attempts, 3);
    assert.ok(row.delivered_at);
  }
  await run();
  assert.equal(attempts.length, 9);
  // Recovery ends the episode. A subsequent incident creates a distinct ID.
  await pool.query("UPDATE email_messages SET status='sent' WHERE id=$1", [
    emailId
  ]);
  await pool.query(
    "UPDATE stripe_events SET processing_status='processed' WHERE stripe_event_id=ANY($1::text[])",
    [[failedId, stalledId]]
  );
  await run();
  assert.ok((await states()).every((row) => row.resolved_at));
  await pool.query("UPDATE email_messages SET status='failed' WHERE id=$1", [
    emailId
  ]);
  await pool.query(
    "UPDATE stripe_events SET processing_status=CASE WHEN stripe_event_id=$1 THEN 'failed' ELSE 'processing' END WHERE stripe_event_id=ANY($2::text[])",
    [failedId, [failedId, stalledId]]
  );
  await run();
  assert.equal(accepted.size, 6);
  const active = (await states()).filter((row) => !row.resolved_at);
  assert.equal(active.length, 3);
  assert.ok(
    active.every(
      (row) =>
        row.attempts === 1 &&
        row.delivered_at &&
        !first.some((old) => old.id === row.id)
    )
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    JSON.stringify({
      transportAttempts: attempts.length,
      logicalNotifications: accepted.size,
      alerts: [...accepted.values()]
    })
  );
} finally {
  receiver.closeAllConnections();
  await new Promise((resolve) => receiver.close(resolve));
  await pool.end();
}
