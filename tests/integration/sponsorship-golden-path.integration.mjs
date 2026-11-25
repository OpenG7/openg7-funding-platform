import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { readSponsorshipGoldenPath } from '../../dist/apps/funding-api/src/sponsorship-golden-path.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

test(
  'GP1 composes native persisted owners in a stable read-only dossier snapshot',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const create = async (type = 'sponsorship_interest') =>
      (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      sponsor_company_name,sponsor_contact_email,email_private,sponsor_details_submitted_at,
      sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
     VALUES($1,1500,'cad','paid',NOW(),'Synthetic GP1',
      'gp1@example.invalid','gp1@example.invalid',NOW(),'Synthetic private presentation',TRUE,'pending_review',TRUE) RETURNING id`,
          [type]
        )
      ).rows[0].id;
    const id = await create();
    const beforeAgreement = await readSponsorshipGoldenPath(pool, id);
    assert.equal(beforeAgreement.status, 'available');
    assert.equal(beforeAgreement.path.state, 'unknown');
    assert.equal(beforeAgreement.path.counts.fulfilled, 0);
    await recordFixtureSponsorshipAgreement(pool, id, {
      benefits: [
        { channel: 'website', target: 'openg7', quantity: 2 },
        {
          channel: 'facebook',
          target: 'openg7',
          quantity: 2,
          format: 'collective_text'
        },
        {
          channel: 'linkedin',
          target: 'openg7',
          quantity: 1,
          format: 'individual_text'
        }
      ]
    });
    // Any attempted mutation by a reused owner would fail this real READ ONLY transaction.
    const statements = [];
    let changed = false;
    const observingPool = {
      async connect() {
        const client = await pool.connect();
        return {
          async query(sql, params) {
            statements.push(sql);
            const result = await client.query(sql, params);
            if (!changed && sql.includes('c.paid_at::text AS "paidAt"')) {
              changed = true;
              await pool.query(
                "UPDATE fund_contributions SET status='disputed',updated_at=NOW() WHERE id=$1",
                [id]
              );
            }
            return result;
          },
          release: () => client.release()
        };
      }
    };
    const auditCount = Number(
      (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0].n
    );
    const observed = await readSponsorshipGoldenPath(
      observingPool,
      id.toUpperCase()
    );
    assert.equal(observed.status, 'available');
    assert.equal(observed.path.contributionId, id);
    assert.equal(observed.path.paymentStatus, 'paid');
    assert.equal(observed.path.counts.expected, 5);
    assert.equal(observed.path.counts.fulfilled, 0);
    assert.equal(observed.path.counts.outstanding, 5);
    assert.equal(observed.path.services.length, 5);
    assert.equal(observed.path.partial, false);
    assert.ok(
      observed.path.services.every((service) => service.preparation !== null)
    );
    assert.equal(
      new Set(observed.path.services.map((service) => service.obligation.id))
        .size,
      5
    );
    assert.deepEqual(
      statements.filter((sql) => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql)),
      ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT']
    );
    assert.equal(
      Number(
        (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0].n
      ),
      auditCount
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*) n FROM sponsorship_fulfilment_evidence'
        )
      ).rows[0].n,
      '0'
    );
    const disputed = await readSponsorshipGoldenPath(pool, id);
    assert.equal(disputed.path.paymentStatus, 'disputed');
    assert.equal(disputed.path.counts.fulfilled, 0);
    assert.deepEqual(await readSponsorshipGoldenPath(pool, randomUUID()), {
      status: 'not_found',
      path: null
    });
    assert.equal(
      (await readSponsorshipGoldenPath(pool, await create('personal_support')))
        .status,
      'not_sponsorship'
    );
  }
);
