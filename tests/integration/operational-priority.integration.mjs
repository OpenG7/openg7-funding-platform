import assert from 'node:assert/strict';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { getAdminWorkQueue } from '../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { readEngineRoom } from '../../dist/apps/funding-api/src/admin-engine-room.service.js';

test(
  'Assistant and engine room share exact persisted exception priorities without dispatching or changing decisions',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const now = new Date();
    const future = new Date(now.getTime() + 3600000).toISOString();
    const ids = [];
    for (const label of ['one', 'two']) {
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
       public_display_consent,sponsor_company_name,sponsor_contact_email,sponsor_details_submitted_at,sponsor_review_status)
       VALUES('sponsorship_interest',1500,'cad','paid',NOW(),TRUE,$1,'synthetic@example.invalid',NOW(),'approved') RETURNING id`,
          ['Synthetic exception ' + label]
        )
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        channel: 'facebook'
      });
      ids.push(id);
    }
    await pool.query(
      "UPDATE publication_feeds SET paused=FALSE WHERE id='openg7:facebook'"
    );
    await pool.query(
      'UPDATE publication_worker_settings SET enabled=TRUE WHERE id=TRUE'
    );
    const slot = (
      await pool.query(
        "INSERT INTO publication_slots(feed_target,channel,starts_at,capacity,status) VALUES('openg7','facebook',$1,5,'scheduled') RETURNING id",
        [future]
      )
    ).rows[0].id;
    const batch = (
      await pool.query(
        "INSERT INTO sponsor_publication_batches(channel,capacity,status,scheduled_at,slot_id) VALUES('facebook',5,'scheduled',$1,$2) RETURNING id",
        [future, slot]
      )
    ).rows[0].id;
    for (const id of ids) {
      const ob = (
        await pool.query(
          'SELECT id FROM sponsorship_obligations WHERE contribution_id=$1',
          [id]
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(contribution_id,obligation_id,feed_target,channel,title,body,disclosure_text,status,batch_id,slot_id)
      VALUES($1,$2,'openg7','facebook','Synthetic','Synthetic','Synthetic','scheduled',$3,$4)`,
        [id, ob, batch, slot]
      );
    }
    const delivery = (
      await pool.query(
        `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,approved_at,approved_by)
    VALUES('openg7:facebook','sponsorship',$1,'Synthetic observation only',$2,'synthetic-account','live','approved',NOW(),'synthetic-admin') RETURNING id`,
        [batch, future]
      )
    ).rows[0].id;
    const auditCount = (
      await pool.query('SELECT count(*) n FROM admin_audit_log')
    ).rows[0].n;
    const read = (scope = {}) =>
      getAdminWorkQueue(pool, { ...scope, overview: true, pageSize: 100 }, now);
    const assistant = await read({ sponsorshipId: ids[0] });
    const fulfilment = assistant.items.find(
      (item) => item.type === 'sponsorship_needs_fulfilment'
    );
    assert.ok(fulfilment);
    assert.equal(fulfilment.intervention.reason, 'publication_scheduled');
    assert.equal(fulfilment.intervention.responsibility, 'platform');
    assert.equal(fulfilment.severity, 'informational');
    assert.equal(
      assistant.overview.recommendations.some(
        (item) => item.id === fulfilment.id
      ),
      false
    );
    const room = await readEngineRoom(
      {
        publications: null,
        connectorEnabled: false,
        localPreparationEnabled: false,
        connector: async () => assert.fail('disabled connector'),
        workQueue: read
      },
      { sponsorshipId: ids[0] },
      () => now
    );
    assert.deepEqual(room.workQueue, assistant);
    const collective = await read({ deliveryId: delivery });
    const placement = collective.items.find(
      (item) => item.type === 'publication_slot_upcoming'
    );
    assert.deepEqual(
      [...placement.relatedContributionIds].sort(),
      [...ids].sort()
    );
    assert.equal(placement.severity, 'informational');
    assert.ok(
      (await read({ sponsorshipId: ids[1] })).items.some(
        (item) => item.id === placement.id
      )
    );
    await pool.query(
      "UPDATE publication_deliveries SET status='uncertain',error_code='SYNTHETIC_RESPONSE_LOST' WHERE id=$1",
      [delivery]
    );
    const uncertain = await read({ sponsorshipId: ids[0] });
    const exception = uncertain.items.find((item) => item.id === fulfilment.id);
    assert.equal(exception.intervention.reason, 'publication_uncertain');
    assert.equal(exception.intervention.responsibility, 'admin');
    assert.equal(exception.severity, 'urgent');
    assert.ok(
      exception.suggestedActions.every(
        (action) => action.executionMode === 'navigate'
      )
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*) n FROM sponsorship_fulfilment_evidence'
        )
      ).rows[0].n,
      '0'
    );
    assert.equal(
      (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0].n,
      auditCount
    );
    assert.equal(
      (
        await pool.query(
          'SELECT attempts FROM publication_deliveries WHERE id=$1',
          [delivery]
        )
      ).rows[0].attempts,
      0
    );
  }
);
