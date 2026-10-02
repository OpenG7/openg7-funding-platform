import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import {
  getSponsorshipInterventions,
  recordSponsorshipIntervention
} from '../../dist/apps/funding-api/src/sponsorship-interventions.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'interventions preserve the entire audit trail, isolate dossiers, deduplicate retries and never change money or send emails',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const ids = (
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, public_reference)
    VALUES ('sponsorship_interest', 25000, 'cad', 'paid', NOW() - interval '31 days', 'INTERVENTION-DEMO-1'),
    ('sponsorship_interest', 25000, 'cad', 'paid', NOW(), 'INTERVENTION-DEMO-2') RETURNING id`)
    ).rows.map((row) => row.id);
    const personalId = (
      await pool.query(
        "INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status) VALUES ('personal_support', 5000, 'cad', 'paid') RETURNING id"
      )
    ).rows[0].id;
    const before = (
      await pool.query('SELECT * FROM fund_contributions ORDER BY id')
    ).rows;
    const input = {
      contributionId: ids[0],
      requestId: randomUUID(),
      kind: 'phone',
      note: 'Appel effectué, réponse attendue.',
      nextReviewOn: null
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        recordSponsorshipIntervention(pool, input, 'operator-fixture')
      )
    );
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].actor, 'operator-fixture');
    assert.ok(Date.parse(results[0].recordedAt));
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM admin_audit_log'))
        .rows[0].count,
      1
    );
    await assert.rejects(
      recordSponsorshipIntervention(
        pool,
        { ...input, note: 'Different content' },
        'operator-fixture'
      ),
      { status: 409 }
    );
    await assert.rejects(
      recordSponsorshipIntervention(pool, input, 'another-actor'),
      { status: 409 }
    );
    for (const contributionId of [randomUUID(), personalId]) {
      await assert.rejects(
        recordSponsorshipIntervention(
          pool,
          { ...input, contributionId },
          'operator-fixture'
        ),
        { status: 404 }
      );
    }
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM admin_audit_log'))
        .rows[0].count,
      1
    );
    await assert.rejects(getSponsorshipInterventions(pool, randomUUID()), {
      status: 404
    });
    const nextReviewOn = new Date(Date.now() + 10 * 86400000)
      .toISOString()
      .slice(0, 10);
    const extensionInput = {
      ...input,
      requestId: randomUUID(),
      kind: 'extension',
      note: 'Délai supplémentaire convenu.',
      nextReviewOn
    };
    const extensionEntry = await recordSponsorshipIntervention(
      pool,
      extensionInput,
      'operator-fixture'
    );
    const initial = await getSponsorshipInterventions(pool, ids[0]);
    assert.equal(initial.entries.length, 2);
    assert.equal(initial.followup.state, 'extended');
    assert.equal(initial.followup.nextReviewOn, nextReviewOn);
    assert.equal(initial.followup.lastEmail, null);
    t.mock.timers.enable({
      apis: ['Date'],
      now: Date.parse(nextReviewOn) + 86400000
    });
    try {
      assert.deepEqual(
        await recordSponsorshipIntervention(
          pool,
          extensionInput,
          'operator-fixture'
        ),
        extensionEntry
      );
      assert.equal(
        (await getSponsorshipInterventions(pool, ids[0])).followup.state,
        'decision_required'
      );
    } finally {
      t.mock.timers.reset();
    }
    await assert.rejects(
      recordSponsorshipIntervention(
        pool,
        {
          ...input,
          requestId: randomUUID(),
          kind: 'extension',
          nextReviewOn: '2000-01-01'
        },
        'operator-fixture'
      ),
      { status: 400 }
    );
    for (let i = 0; i < 29; i++)
      await recordSponsorshipIntervention(
        pool,
        {
          ...input,
          requestId: randomUUID(),
          note: `Intervention de démonstration ${i}`
        },
        'operator-fixture'
      );
    const page = await getSponsorshipInterventions(pool, ids[0]);
    assert.equal(page.entries.length, 25);
    assert.ok(page.nextCursor);
    await recordSponsorshipIntervention(
      pool,
      {
        ...input,
        requestId: randomUUID(),
        kind: 'internal',
        note: 'Correction : se référer à la première note.'
      },
      'owner-fixture'
    );
    const older = await getSponsorshipInterventions(
      pool,
      ids[0],
      page.nextCursor
    );
    assert.equal(older.entries.length, 6);
    assert.equal(older.nextCursor, null);
    assert.equal(
      new Set([...page.entries, ...older.entries].map((entry) => entry.id))
        .size,
      31
    );
    assert.equal(older.entries.at(-1).note, input.note);
    assert.equal(
      (await getSponsorshipInterventions(pool, ids[1])).entries.length,
      0
    );
    assert.equal(
      (await getSponsorshipInterventions(pool, ids[1], page.nextCursor)).entries
        .length,
      0
    );
    assert.deepEqual(
      (await pool.query('SELECT * FROM fund_contributions ORDER BY id')).rows,
      before
    );
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM email_messages'))
        .rows[0].count,
      0
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM sponsorship_credit_notes'
        )
      ).rows[0].count,
      0
    );
    // Delivery state is read from the queue, never fabricated by a manual reminder note.
    await pool.query(
      `INSERT INTO email_messages (template_key, recipient_email, from_email, subject, text_body, html_body, metadata, status)
    VALUES ('sponsorship_followup', 'private@example.invalid', 'noreply@example.invalid', 'Fixture', 'PRIVATE BODY', 'PRIVATE BODY', $1, 'failed')`,
      [
        JSON.stringify({
          publicReference: 'INTERVENTION-DEMO-1',
          followupUrl: 'PRIVATE LINK'
        })
      ]
    );
    const delivery = await getSponsorshipInterventions(pool, ids[0]);
    assert.equal(delivery.followup.lastEmail.status, 'failed');
    assert.doesNotMatch(
      JSON.stringify(delivery),
      /PRIVATE|private@example|followupUrl|requestHash/
    );
    assert.equal(
      (await getSponsorshipInterventions(pool, ids[1])).followup.lastEmail,
      null
    );
    // Financial state changes never erase the notes leading to the decision.
    await pool.query(
      "UPDATE fund_contributions SET status = 'refunded', sponsorship_refund_status = 'completed' WHERE id = $1",
      [ids[0]]
    );
    const refunded = await getSponsorshipInterventions(pool, ids[0]);
    assert.equal(refunded.followup.state, 'inactive');
    assert.equal(refunded.entries.length, 25);
    await pool.query(`CREATE FUNCTION reject_intervention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
    CREATE TRIGGER reject_intervention BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_intervention()`);
    const failedRequest = { ...input, requestId: randomUUID() };
    await assert.rejects(
      recordSponsorshipIntervention(pool, failedRequest, 'operator-fixture')
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM admin_audit_log WHERE metadata->>'requestId' = $1",
          [failedRequest.requestId]
        )
      ).rows[0].count,
      0
    );
    await pool.query('DROP TRIGGER reject_intervention ON admin_audit_log');

    // Real HTTP API, synthetic local credentials, isolated DB, no inherited provider config.
    const token = randomUUID(),
      db = pool.options;
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => { console.log('TEST_PORT=' + this.address().port); callback?.(); });
    };
    await import('./dist/apps/funding-api/src/main.js');
  `
      ],
      {
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          FUNDING_API_PORT: '0',
          DATABASE_URL: `postgresql://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@127.0.0.1:${db.port}/${db.database}`,
          FUNDING_ADMIN_TOKEN: token,
          FUNDING_ADMIN_SESSION_SECRET: randomUUID(),
          FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
          FUNDING_EMAIL_WORKER_ENABLED: 'false'
        },
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    });
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error('Test API did not start')),
        15000
      );
      child.on('error', reject);
      child.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('Test API exited'));
      });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/TEST_PORT=(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    const headers = {
      authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    for (const prefix of ['/api/admin', '/admin']) {
      const url = `http://127.0.0.1:${port}${prefix}/sponsorships/interventions`;
      assert.equal((await fetch(url + `?sponsorshipId=${ids[0]}`)).status, 401);
      assert.equal(
        (await fetch(url, { method: 'POST', body: '{}' })).status,
        401
      );
      assert.equal(
        (await fetch(url, { method: 'DELETE', headers })).status,
        405
      );
      assert.equal((await fetch(url, { headers })).status, 400);
      assert.equal(
        (
          await fetch(url, {
            method: 'POST',
            headers: { authorization: headers.authorization },
            body: '{}'
          })
        ).status,
        415
      );
      for (const body of [
        '{',
        'null',
        '{}',
        JSON.stringify({ ...input, actor: 'spoof' }),
        'x'.repeat(17000)
      ])
        assert.equal(
          (await fetch(url, { method: 'POST', headers, body })).status,
          400
        );
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...input,
          requestId: randomUUID(),
          note: 'Revue administrative terminée.'
        })
      });
      assert.equal(response.status, 200);
      const entry = await response.json();
      assert.equal(entry.actor, 'funding-admin-token');
      assert.match(response.headers.get('cache-control'), /no-store/);
      const read = await fetch(url + `?sponsorshipId=${ids[0]}`, { headers });
      assert.equal(read.status, 200);
      assert.equal((await read.json()).entries[0].id, entry.id);
    }
  }
);
