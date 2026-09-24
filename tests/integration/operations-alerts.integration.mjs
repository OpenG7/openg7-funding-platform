import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  syncOperationsIncidents,
  deliverOperationsAlerts,
  detectOperationsIncidents
} from '../../dist/apps/funding-api/src/operations-alerts.js';

test(
  'operations alerts deduplicate concurrent delivery, retry failures and create a new episode after recovery without exposing private data',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const received = [];
    let fail = true;
    const receiver = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      received.push({ body, headers: req.headers });
      res.writeHead(fail ? 503 : 204).end();
    });
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    t.after(() => new Promise((resolve) => receiver.close(resolve)));
    const config = {
      webhook: `http://127.0.0.1:${receiver.address().port}/hook`,
      secret: 'synthetic-signing-secret-not-real',
      adminOrigin: 'https://example.test'
    };
    await db.pool
      .query(`INSERT INTO email_messages (template_key,recipient_email,from_email,subject,text_body,html_body,status)
    VALUES ('test','private-person@example.test','sender@example.test','Private subject','Private body','Private body','failed')`);
    const incidents = await detectOperationsIncidents(db.pool);
    assert.equal(incidents.length, 1);
    await Promise.all([
      syncOperationsIncidents(db.pool),
      syncOperationsIncidents(db.pool)
    ]);
    assert.equal(
      (await db.pool.query('SELECT * FROM operations_alerts')).rowCount,
      1
    );
    assert.equal(await deliverOperationsAlerts(db.pool, config), 0);
    fail = false;
    await db.pool.query('UPDATE operations_alerts SET next_attempt_at=now()');
    const counts = await Promise.all([
      deliverOperationsAlerts(db.pool, config),
      deliverOperationsAlerts(db.pool, config)
    ]);
    assert.equal(
      counts.reduce((a, b) => a + b),
      1
    );
    assert.equal(received.length, 2);
    assert.equal(
      received[0].headers['x-openg7-event-id'],
      received[1].headers['x-openg7-event-id']
    );
    for (const item of received) {
      assert.doesNotMatch(
        item.body,
        /private-person|Private body|Private subject/
      );
      assert.equal(
        item.headers['x-openg7-signature'],
        createHmac('sha256', config.secret)
          .update(`${item.headers['x-openg7-timestamp']}.${item.body}`)
          .digest('hex')
      );
    }
    assert.equal(await deliverOperationsAlerts(db.pool, config), 0);
    await db.pool.query("UPDATE email_messages SET status='sent'");
    await syncOperationsIncidents(db.pool);
    await db.pool.query("UPDATE email_messages SET status='failed'");
    await syncOperationsIncidents(db.pool);
    assert.equal(await deliverOperationsAlerts(db.pool, config), 1);
    assert.notEqual(
      received[1].headers['x-openg7-event-id'],
      received[2].headers['x-openg7-event-id']
    );
  }
);

test(
  'a waiting watcher reads incidents after the lock and cannot reopen a recovered episode',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    await db.pool
      .query(`INSERT INTO email_messages (template_key,recipient_email,from_email,subject,text_body,html_body,status)
    VALUES ('test','private@example.test','sender@example.test','Private','Private','Private','failed')`);
    await syncOperationsIncidents(db.pool);
    const locker = await db.pool.connect();
    let pending;
    try {
      await locker.query('BEGIN');
      await locker.query(
        'LOCK TABLE operations_alerts IN SHARE ROW EXCLUSIVE MODE'
      );
      pending = syncOperationsIncidents(db.pool);
      const deadline = Date.now() + 5000;
      while (true) {
        const { rows } = await db.pool
          .query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE operations_alerts%'`);
        if (rows[0].count === 1) break;
        assert.ok(
          Date.now() < deadline,
          'Second watcher must wait for the synchronization lock'
        );
        await setTimeout(20);
      }
      await db.pool.query("UPDATE email_messages SET status='sent'");
      await locker.query('COMMIT');
      await pending;
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
      if (pending) await pending;
    }
    const { rows } = await db.pool.query(
      'SELECT resolved_at FROM operations_alerts'
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].resolved_at, 'Recovery must close the original episode');
  }
);

test(
  'leases, retry deadlines, redirects and recovery prevent obsolete or duplicate delivery',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    let posts = 0;
    let redirected = 0;
    const receiver = createServer((req, res) => {
      req.resume();
      if (req.url === '/elsewhere') {
        redirected++;
        res.writeHead(204).end();
      } else {
        posts++;
        res.writeHead(307, { Location: '/elsewhere' }).end();
      }
    });
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    t.after(() => new Promise((resolve) => receiver.close(resolve)));
    const config = {
      webhook: `http://127.0.0.1:${receiver.address().port}/hook`,
      secret: 'synthetic-operations-signing-secret',
      adminOrigin: 'https://example.test'
    };
    await db.pool
      .query(`INSERT INTO stripe_events (stripe_event_id,event_type,payload,processing_status,received_at) VALUES
    ('evt_failed','test','{}','failed',now()),
    ('evt_stalled','test','{}','processing',now()-interval '16 minutes'),
    ('evt_recent','test','{}','processing',now()),
    ('evt_done','test','{}','processed',now()-interval '1 day')`);
    assert.deepEqual(
      (await detectOperationsIncidents(db.pool)).map((i) => i.type).sort(),
      ['stripe_event_failed', 'stripe_event_stalled']
    );
    await syncOperationsIncidents(db.pool);
    await db.pool.query(
      "UPDATE operations_alerts SET lease_until=now()+interval '1 minute',attempts=15"
    );
    assert.equal(await deliverOperationsAlerts(db.pool, config), 0);
    assert.equal(posts, 0);
    await db.pool.query(
      "UPDATE operations_alerts SET lease_until=now()-interval '1 second'"
    );
    assert.equal(await deliverOperationsAlerts(db.pool, config), 0);
    assert.equal(posts, 2);
    assert.equal(redirected, 0, 'Signed payload must not follow a redirect');
    const { rows } = await db.pool
      .query(`SELECT attempts,delivered_at,lease_until,
    extract(epoch FROM next_attempt_at-now()) AS delay FROM operations_alerts`);
    for (const row of rows) {
      assert.equal(row.attempts, 16);
      assert.equal(row.delivered_at, null);
      assert.equal(row.lease_until, null);
      assert.ok(Number(row.delay) > 3590 && Number(row.delay) <= 3600);
    }
    assert.equal(await deliverOperationsAlerts(db.pool, config), 0);
    assert.equal(posts, 2, 'Future retries must not be attempted early');
    await db.pool.query(
      "UPDATE stripe_events SET processing_status='processed'"
    );
    await syncOperationsIncidents(db.pool);
    await db.pool.query('UPDATE operations_alerts SET next_attempt_at=now()');
    assert.equal(await deliverOperationsAlerts(db.pool, config), 0);
    assert.equal(
      posts,
      2,
      'Recovery before retry must suppress obsolete alerts'
    );
  }
);

test(
  'the actual watcher reports database unavailability through a signed minimal alert and fails --once',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const received = [];
    const secret = 'synthetic-operations-signing-secret';
    const receiver = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      received.push({ body, headers: req.headers });
      res.writeHead(204).end();
    });
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    t.after(() => new Promise((resolve) => receiver.close(resolve)));
    const options = db.pool.options;
    const connection = new URL(
      `postgres://127.0.0.1:${options.port}/${options.database}`
    );
    connection.username = options.user;
    connection.password = 'synthetic-invalid-password';
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(key)
        )
      ),
      NODE_ENV: 'test',
      DATABASE_URL: connection.href,
      FUNDING_OPERATIONS_WEBHOOK_URL: `http://127.0.0.1:${receiver.address().port}/hook`,
      FUNDING_OPERATIONS_WEBHOOK_SECRET: secret,
      FUNDING_PUBLIC_BASE_URL: 'https://funding.example.test'
    };
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ['scripts/operations-watch.mjs', '--once'],
        { env, windowsHide: true, timeout: 15000 }
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, '');
        assert.equal(error.stderr.trim(), 'Operations check unavailable.');
        return true;
      }
    );
    assert.equal(received.length, 1);
    const item = received[0];
    assert.deepEqual(Object.keys(JSON.parse(item.body)).sort(), [
      'adminUrl',
      'eventId',
      'firstSeen',
      'severity',
      'type'
    ]);
    assert.equal(JSON.parse(item.body).type, 'operations_database_unavailable');
    assert.equal(
      JSON.parse(item.body).eventId,
      item.headers['x-openg7-event-id']
    );
    assert.equal(
      item.headers['x-openg7-signature'],
      createHmac('sha256', secret)
        .update(`${item.headers['x-openg7-timestamp']}.${item.body}`)
        .digest('hex')
    );
    assert.equal(
      (await db.pool.query('SELECT * FROM operations_alerts')).rowCount,
      0
    );
  }
);
