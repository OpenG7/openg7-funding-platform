import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { updateAdminSponsorshipDetails } from '../../dist/apps/funding-api/src/admin-sponsorship-details.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'dossier corrections are atomic, idempotent, versioned, authenticated and leave financial facts intact',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const id = (
      await pool.query(`INSERT INTO fund_contributions
    (contribution_type, amount_cents, currency, status, paid_at, public_name, email_private,
     public_display_consent, sponsor_company_name, sponsor_contact_name, sponsor_contact_email,
     sponsor_website_url, sponsor_review_status, sponsor_reviewed_at, sponsor_feed_status, stripe_session_id)
    VALUES ('sponsorship_interest', 50000, 'cad', 'paid', NOW(), 'Original public name', 'payer@example.invalid',
      true, 'Original company', 'Original contact', 'original@example.invalid', 'https://example.invalid/old',
      'approved', NOW(), 'published', 'cs_details_fixture') RETURNING id`)
    ).rows[0].id;
    await pool.query(
      `INSERT INTO sponsorship_invoices (contribution_id, invoice_number, stripe_session_id,
    currency, subtotal_cents, total_cents, issuer_name, sponsor_name, sponsor_contact_email)
    VALUES ($1, 'FAC-DETAILS', 'cs_details_fixture', 'cad', 50000, 50000, 'Fixture', 'Original company', 'original@example.invalid')`,
      [id]
    );
    const record = async () =>
      (
        await pool.query(
          'SELECT *, updated_at::text AS version FROM fund_contributions WHERE id = $1',
          [id]
        )
      ).rows[0];
    const before = await record();
    const originalInvoices = (
      await pool.query('SELECT * FROM sponsorship_invoices')
    ).rows;
    const input = {
      contributionId: id,
      expectedVersion: before.version,
      requestId: randomUUID(),
      confirmed: true,
      reason: 'correction',
      companyName: 'Corrected company',
      publicName: 'Corrected public name',
      contactName: 'Corrected contact',
      contactEmail: 'corrected@example.invalid',
      websiteUrl: 'https://example.invalid/corrected'
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        updateAdminSponsorshipDetails(pool, input, 'fixture-admin')
      )
    );
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].updated, true);
    const after = await record();
    assert.notEqual(after.version, before.version);
    const mutable = new Set([
      'version',
      'updated_at',
      'sponsor_company_name',
      'public_name',
      'sponsor_contact_name',
      'sponsor_contact_email',
      'sponsor_website_url'
    ]);
    for (const key of Object.keys(before).filter((key) => !mutable.has(key)))
      assert.deepEqual(after[key], before[key], key);
    assert.deepEqual(
      (await pool.query('SELECT * FROM sponsorship_invoices')).rows,
      originalInvoices
    );
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM email_messages'))
        .rows[0].count,
      0
    );
    const audits = (
      await pool.query(
        "SELECT * FROM admin_audit_log WHERE action = 'sponsorship.details.update'"
      )
    ).rows;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor, 'fixture-admin');
    assert.equal(audits[0].metadata.requestId, input.requestId);
    assert.equal(audits[0].metadata.reason, 'correction');
    assert.deepEqual(audits[0].metadata.changedFields, [
      'companyName',
      'publicName',
      'contactName',
      'contactEmail',
      'websiteUrl'
    ]);
    assert.doesNotMatch(
      JSON.stringify(audits),
      /corrected@example|Original company|Corrected company|payer@example|example.invalid/
    );
    await assert.rejects(
      updateAdminSponsorshipDetails(
        pool,
        { ...input, companyName: 'Different' },
        'fixture-admin'
      ),
      { status: 409 }
    );
    await assert.rejects(
      updateAdminSponsorshipDetails(
        pool,
        { ...input, requestId: randomUUID() },
        'fixture-admin'
      ),
      { status: 409 }
    );
    await assert.rejects(
      updateAdminSponsorshipDetails(
        pool,
        { ...input, contributionId: randomUUID() },
        'fixture-admin'
      ),
      { status: 404 }
    );
    assert.equal(
      (
        await updateAdminSponsorshipDetails(
          pool,
          { ...input, expectedVersion: after.version, requestId: randomUUID() },
          'fixture-admin'
        )
      ).updated,
      false
    );
    assert.equal((await record()).version, after.version);

    // A failed audit must roll back the identity correction as well.
    await pool.query(`CREATE FUNCTION reject_details_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
    CREATE TRIGGER reject_details_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_details_audit()`);
    await assert.rejects(
      updateAdminSponsorshipDetails(
        pool,
        {
          ...input,
          companyName: 'Must roll back',
          requestId: randomUUID(),
          expectedVersion: after.version
        },
        'fixture-admin'
      )
    );
    assert.equal((await record()).sponsor_company_name, 'Corrected company');
    assert.equal((await record()).version, after.version);
    await pool.query('DROP TRIGGER reject_details_audit ON admin_audit_log');

    // Start the real API against this disposable database with no inherited provider configuration.
    const token = randomUUID();
    const db = pool.options;
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
        reject(new Error('Test API exited before ready'));
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
      const url = `http://127.0.0.1:${port}${prefix}/sponsorships/details`;
      assert.equal(
        (await fetch(url, { method: 'POST', body: '{}' })).status,
        401
      );
      assert.equal((await fetch(url, { headers })).status, 405);
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
      for (const invalid of [
        '{',
        'null',
        '{}',
        JSON.stringify({ ...input, confirmed: false }),
        JSON.stringify({ ...input, amount_cents: 1 })
      ]) {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: invalid
        });
        assert.equal(response.status, 400);
        assert.doesNotMatch(await response.text(), /corrected@example/);
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(input)
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.deepEqual(await response.json(), results[0]);
    }
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM admin_audit_log'))
        .rows[0].count,
      1
    );
  }
);
