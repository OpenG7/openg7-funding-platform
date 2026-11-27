import assert from 'node:assert/strict';
import test from 'node:test';
import { readFlowMeasurement } from '../../dist/apps/funding-api/src/admin-flow-measurement.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

test(
  'flow cohorts use a read-only persisted snapshot, exact collective passages and qualified evidence only',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const ids = [];
    for (let index = 0; index < 3; index++) {
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      public_display_consent,sponsor_company_name,sponsor_contact_email,sponsor_details_submitted_at,sponsor_review_status)
      VALUES('sponsorship_interest',1500,$1,'paid',NOW(),TRUE,'Synthetic flow','synthetic@example.invalid',NOW(),'approved') RETURNING id`,
          [index === 2 ? 'usd' : 'cad']
        )
      ).rows[0].id;
      ids.push(id);
      if (index < 2)
        await recordFixtureSponsorshipAgreement(pool, id, {
          channel: 'facebook',
          quantity: index === 0 ? 2 : 1
        });
    }
    await pool.query(
      "UPDATE sponsorship_obligations SET created_at=NOW()-interval '2 days'"
    );
    const batch = (
      await pool.query(
        "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',5,'scheduled') RETURNING id"
      )
    ).rows[0].id;
    for (const id of ids.slice(0, 2)) {
      const obligation = (
        await pool.query(
          'SELECT id FROM sponsorship_obligations WHERE contribution_id=$1 ORDER BY ordinal LIMIT 1',
          [id]
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(contribution_id,obligation_id,feed_target,channel,title,body,disclosure_text,status,batch_id)
      VALUES($1,$2,'openg7','facebook','Synthetic','Synthetic','Synthetic','scheduled',$3)`,
        [id, obligation, batch]
      );
    }
    const delivery = (
      await pool.query(
        `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,account_id,mode,status,scheduled_at)
    VALUES('openg7:facebook','sponsorship',$1,'Synthetic','synthetic-account','mock','draft',NOW()+interval '1 day') RETURNING id`,
        [batch]
      )
    ).rows[0].id;
    const before = (
      await pool.query('SELECT count(*)::int n FROM admin_audit_log')
    ).rows[0].n;
    const statements = [];
    const readPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql, args) => {
            statements.push(sql);
            return client.query(sql, args);
          },
          release: () => client.release()
        };
      }
    };
    const now = new Date();
    const global = await readFlowMeasurement(readPool, {}, now);
    assert.equal(global.status, 'available');
    assert.equal(global.totals.population, 3);
    assert.equal(global.totals.entries, 3);
    assert.equal(global.totals.open, 3);
    assert.equal(global.totals.qualifiedExits, 0);
    assert.equal(global.excludedDossiers, 1);
    assert.equal(
      global.cohorts.reduce((sum, c) => sum + c.population, 0),
      3
    );
    assert.ok(global.cohorts.some((c) => c.mode === 'mock' && c.open === 2));
    assert.equal(
      statements[0],
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
    );
    assert.equal(statements.at(-1), 'COMMIT');
    assert.equal(
      statements.filter((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)).length,
      0
    );
    const collective = await readFlowMeasurement(
      pool,
      { deliveryId: delivery },
      now
    );
    assert.equal(collective.status, 'available');
    assert.equal(collective.totals.population, 2);
    const intersection = await readFlowMeasurement(
      pool,
      { deliveryId: delivery, sponsorshipId: ids[0] },
      now
    );
    assert.equal(intersection.totals.population, 1);
    const unrelated = await readFlowMeasurement(
      pool,
      { deliveryId: delivery, sponsorshipId: ids[2] },
      now
    );
    assert.equal(unrelated.totals.population, 0);
    assert.equal(unrelated.totals.medianAgeSeconds, null);
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM admin_audit_log')).rows[0]
        .n,
      before
    );
    assert.equal(
      (
        await pool.query(
          'SELECT COALESCE(sum(attempts),0)::int n FROM publication_deliveries'
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      JSON.stringify(global).includes('synthetic@example.invalid'),
      false
    );
  }
);
