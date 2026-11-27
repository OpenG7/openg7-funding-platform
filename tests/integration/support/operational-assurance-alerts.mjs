import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import {
  syncOperationsIncidents,
  deliverOperationsAlerts
} from '../../../dist/apps/funding-api/src/operations-alerts.js';

/** Native alert episodes with an owned loopback receiver and a durable synthetic receipt. */
export async function assureAlertEpisodes(pool) {
  await pool.query(
    'CREATE TABLE synthetic_assurance_receipts(event_id UUID PRIMARY KEY,digest TEXT NOT NULL)'
  );
  const secret = randomBytes(32).toString('hex');
  let drop = true,
    posts = 0;
  const receiver = createServer(
    (req, res) =>
      void (async () => {
        if (req.method !== 'POST' || req.url !== '/alert') {
          res.writeHead(404).end();
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        posts++;
        const signature = createHmac('sha256', secret)
          .update(`${req.headers['x-openg7-timestamp']}.${body}`)
          .digest('hex');
        assert.equal(req.headers['x-openg7-signature'], signature);
        assert.doesNotMatch(
          body,
          /synthetic-private|private-body|private-subject/
        );
        const data = JSON.parse(body);
        assert.equal(data.eventId, req.headers['x-openg7-event-id']);
        assert.deepEqual(Object.keys(data).sort(), [
          'adminUrl',
          'eventId',
          'firstSeen',
          'severity',
          'type'
        ]);
        const digest = createHash('sha256').update(body).digest('hex');
        await pool.query(
          'INSERT INTO synthetic_assurance_receipts(event_id,digest) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING',
          [data.eventId, digest]
        );
        assert.equal(
          (
            await pool.query(
              'SELECT digest FROM synthetic_assurance_receipts WHERE event_id=$1',
              [data.eventId]
            )
          ).rows[0].digest,
          digest
        );
        if (drop) {
          drop = false;
          req.socket.destroy();
          return;
        }
        res.writeHead(204).end();
      })().catch(() => {
        res.writeHead(500).end();
      })
  );
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const config = {
    webhook: `http://127.0.0.1:${receiver.address().port}/alert`,
    secret,
    adminOrigin: 'https://synthetic.invalid'
  };
  try {
    const id = (
      await pool.query(`INSERT INTO email_messages(template_key,recipient_email,from_email,subject,text_body,html_body,status)
      VALUES('assurance','synthetic-private@example.invalid','sender@example.invalid','private-subject','private-body','private-body','failed') RETURNING id`)
    ).rows[0].id;
    await Promise.all([
      syncOperationsIncidents(pool),
      syncOperationsIncidents(pool)
    ]);
    const first = (
      await pool.query(
        'SELECT id,next_attempt_at FROM operations_alerts WHERE resolved_at IS NULL'
      )
    ).rows;
    assert.equal(first.length, 1);
    assert.equal(await deliverOperationsAlerts(pool, config), 0);
    const pending = (
      await pool.query(
        'SELECT delivered_at,next_attempt_at>now() AS delayed FROM operations_alerts WHERE id=$1',
        [first[0].id]
      )
    ).rows[0];
    assert.equal(pending.delivered_at, null);
    assert.equal(pending.delayed, true);
    // Reconcile the receiver's durable acceptance before any retry of this notification.
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int n FROM synthetic_assurance_receipts WHERE event_id=$1',
          [first[0].id]
        )
      ).rows[0].n,
      1
    );
    // Advance only this owned fixture's retry eligibility; real backoff remains untouched.
    await pool.query(
      'UPDATE operations_alerts SET next_attempt_at=now() WHERE id=$1',
      [first[0].id]
    );
    const delivered = await Promise.all([
      deliverOperationsAlerts(pool, config),
      deliverOperationsAlerts(pool, config)
    ]);
    assert.equal(
      delivered.reduce((a, b) => a + b, 0),
      1
    );
    assert.equal(posts, 2);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int n FROM synthetic_assurance_receipts'
        )
      ).rows[0].n,
      1
    );
    assert.equal(await deliverOperationsAlerts(pool, config), 0);
    await pool.query("UPDATE email_messages SET status='sent' WHERE id=$1", [
      id
    ]);
    await syncOperationsIncidents(pool);
    assert.ok(
      (
        await pool.query(
          'SELECT resolved_at FROM operations_alerts WHERE id=$1',
          [first[0].id]
        )
      ).rows[0].resolved_at
    );
    await pool.query("UPDATE email_messages SET status='failed' WHERE id=$1", [
      id
    ]);
    await syncOperationsIncidents(pool);
    const second = (
      await pool.query(
        'SELECT id FROM operations_alerts WHERE resolved_at IS NULL'
      )
    ).rows[0];
    assert.notEqual(second.id, first[0].id);
    assert.equal(await deliverOperationsAlerts(pool, config), 1);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int n FROM synthetic_assurance_receipts'
        )
      ).rows[0].n,
      2
    );
    await pool.query("UPDATE email_messages SET status='sent' WHERE id=$1", [
      id
    ]);
    await syncOperationsIncidents(pool);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int n FROM operations_alerts WHERE resolved_at IS NULL'
        )
      ).rows[0].n,
      0
    );
    return {
      episodes: 2,
      resolved: 2,
      transportAttempts: posts,
      logicalNotifications: 2,
      receiverAcceptanceReconciled: true,
      controlledRetryEligibility: true
    };
  } finally {
    receiver.closeAllConnections();
    await new Promise((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
