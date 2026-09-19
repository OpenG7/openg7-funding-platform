import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
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
      syncOperationsIncidents(db.pool, incidents),
      syncOperationsIncidents(db.pool, incidents)
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
    await syncOperationsIncidents(db.pool, []);
    await syncOperationsIncidents(db.pool, incidents);
    assert.equal(await deliverOperationsAlerts(db.pool, config), 1);
    assert.notEqual(
      received[1].headers['x-openg7-event-id'],
      received[2].headers['x-openg7-event-id']
    );
  }
);
