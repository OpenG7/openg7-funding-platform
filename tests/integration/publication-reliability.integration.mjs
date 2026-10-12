import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  publicationReliability,
  detectPublicationReliabilityIncidents
} from '../../dist/apps/funding-api/src/publication-reliability.repository.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { syncOperationsIncidents } from '../../dist/apps/funding-api/src/operations-alerts.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

test(
  'global publication reliability measures a large complete queue and reconciles synthetic internal drift',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const sponsors = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    sponsor_company_name,email_private,public_display_consent,public_reference)
    SELECT 'sponsorship_interest',50000,'cad','paid',NOW(),'SYNTHETIC_PRIVATE_NAME_'||n,'private-'||n||'@example.invalid',TRUE,'SYNTHETIC-RELIABILITY-'||n
    FROM generate_series(1,13) n RETURNING id`)
    ).rows.map((r) => r.id);
    for (const id of sponsors)
      await recordFixtureSponsorshipAgreement(pool, id, {
        channel: 'facebook',
        quantity: 50
      });
    await pool.query(
      "UPDATE sponsorship_obligations SET created_at=NOW()-INTERVAL '10 days'"
    );
    const deliveries = (
      await pool.query(`INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode)
    SELECT 'openg7:facebook','news','SYNTHETIC_PRIVATE_TEXT_'||n,NOW()+INTERVAL '1 day','SYNTHETIC_PRIVATE_ACCOUNT','live'
    FROM generate_series(1,225) n RETURNING id`)
    ).rows.map((r) => r.id);
    const service = new PublicationAutomationService(pool, {}, {});
    const auditCount = async () =>
      Number(
        (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0].n
      );
    const initialAudits = await auditCount();
    await t.test(
      'filters and response pages never bound the complete aggregate and reads never write audit',
      async () => {
        const global = await service.state();
        assert.equal(global.deliveries.length, 200);
        assert.equal(global.reliability.obligations.open, 650);
        assert.equal(global.reliability.obligations.undatedSocial, 650);
        assert.equal(global.reliability.incidentTotal, 0);
        assert.ok(
          Date.parse(global.reliability.obligations.oldestOpenAt) <
            Date.now() - 9 * 86400000
        );
        for (const filter of [
          { deliveryId: deliveries[224] },
          { sponsorshipId: sponsors[12], queueOffset: 400 }
        ]) {
          const filtered = await service.state(undefined, filter);
          assert.equal(filtered.reliability.obligations.open, 650);
          assert.equal(filtered.reliability.obligations.undatedSocial, 650);
          assert.equal(filtered.reliability.scope, 'global');
        }
        assert.equal(await auditCount(), initialAudits);
        assert.doesNotMatch(
          JSON.stringify(global.reliability),
          /SYNTHETIC_PRIVATE|private-\d|evidenceReference|storageKey/
        );
      }
    );
    const obligations = (
      await pool.query(
        'SELECT id,contribution_id FROM sponsorship_obligations ORDER BY id'
      )
    ).rows;
    await t.test(
      'versioned evidence and obligation reservations expose internal mismatches without completing an unproven benefit',
      async () => {
        const addEvidence = async (ob) =>
          (
            await pool.query(
              `INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,
      delivery_id,delivery_version,mode,account_id,provenance,external_post_id,message,source_snapshot,content_fingerprint,delivered_at,actor)
      VALUES($1,$2,1,'facebook','openg7',$3,1,'live','SYNTHETIC_PRIVATE_ACCOUNT','provider_acknowledged',$4,
      'SYNTHETIC_PRIVATE_PROOF','[]',$5,NOW(),'synthetic-fixture') RETURNING id`,
              [
                ob.id,
                ob.contribution_id,
                deliveries[0],
                randomUUID(),
                '0'.repeat(64)
              ]
            )
          ).rows[0].id;
        const evidenceId = await addEvidence(obligations[0]);
        await pool.query(
          "UPDATE sponsorship_obligations SET state='fulfilled',version=3,fulfilment_evidence_id=$2 WHERE id=$1",
          [obligations[0].id, evidenceId]
        );
        await addEvidence(obligations[1]);
        await pool.query(
          'INSERT INTO sponsorship_obligation_reservations(obligation_id,delivery_id,obligation_version) VALUES($1,$2,99)',
          [obligations[0].id, deliveries[0]]
        );
        const r = await publicationReliability(pool);
        assert.equal(r.obligations.open, 649);
        assert.equal(r.obligations.fulfilledWithEvidence, 0);
        assert.equal(r.discrepancies.proof, 1);
        assert.equal(r.discrepancies.orphanProof, 1);
        assert.equal(r.discrepancies.obligationReservation, 1);
        assert.ok(
          r.incidents.some(
            (i) =>
              i.code === 'FULFILMENT_EVIDENCE_MISMATCH' &&
              i.subjectId === obligations[0].id
          )
        );
      }
    );
    await t.test(
      'shared capacity and provider accounts reveal saturation, collisions and unresolved results',
      async () => {
        const slot = (
          await pool.query(
            "INSERT INTO publication_slots(feed_target,channel,starts_at,timezone,capacity,status) VALUES('openg7','facebook',NOW()+INTERVAL '1 day','UTC',1,'open') RETURNING id"
          )
        ).rows[0].id;
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity,status,slot_id,publication_format) VALUES('facebook',1,'open',$1,'collective_text') RETURNING id",
            [slot]
          )
        ).rows[0].id;
        for (const id of sponsors.slice(0, 2))
          await pool.query(
            "INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,batch_id) VALUES($1,'openg7','facebook','Synthetic title','Synthetic body','Paid sponsorship',$2)",
            [id, batch]
          );
        await pool.query(
          "UPDATE publication_deliveries SET status='uncertain' WHERE id=$1",
          [deliveries[0]]
        );
        await pool.query(
          "UPDATE publication_deliveries SET status='approved',approved_at=NOW(),approved_by='synthetic-fixture',scheduled_at=(SELECT scheduled_at+INTERVAL '30 seconds' FROM publication_deliveries WHERE id=$1) WHERE id=$2",
          [deliveries[0], deliveries[1]]
        );
        await pool.query(
          `INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain)
      VALUES('facebook','SYNTHETIC_PRIVATE_ACCOUNT','live',$1,1,NOW()+INTERVAL '5 minutes',TRUE)`,
          [deliveries[0]]
        );
        await pool.query(
          `INSERT INTO publication_account_reservations(delivery_id,provider,account_id,mode,scheduled_at,approval_version,status)
      SELECT id,'facebook',account_id,mode,scheduled_at,1,CASE WHEN id=$1 THEN 'uncertain' ELSE 'reserved' END
      FROM publication_deliveries WHERE id=ANY($2::uuid[])`,
          [deliveries[0], deliveries.slice(0, 2)]
        );
        const r = await publicationReliability(pool);
        assert.equal(r.capacity.saturatedBatches, 1);
        assert.equal(r.capacity.saturatedSlots, 1);
        assert.equal(r.capacity.accountConflicts, 1);
        assert.equal(r.discrepancies.batchCapacity, 1);
        assert.equal(r.discrepancies.slotCapacity, 1);
        assert.equal(r.deliveries.uncertainAccounts, 1);
        assert.equal(r.deliveries.uncertain, 1);
        assert.equal(
          r.discrepancies.accountLease,
          0,
          'a held uncertain version is an investigation, not a stale claim mismatch'
        );
      }
    );
    await t.test(
      'visible correlations are bounded while complete alert episodes deduplicate and reopen only after recovery',
      async () => {
        const ids = deliveries.slice(2, 102);
        await pool.query(
          "UPDATE publication_deliveries SET status='uncertain' WHERE id=ANY($1::uuid[])",
          [ids]
        );
        await pool.query(
          `INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain)
      SELECT 'facebook','SYNTHETIC_PRIVATE_ACCOUNT_'||id,'live',id,version,NOW()+INTERVAL '5 minutes',TRUE
      FROM publication_deliveries WHERE id=ANY($1::uuid[])`,
          [ids]
        );
        const r = await publicationReliability(pool),
          incidents = await detectPublicationReliabilityIncidents(pool);
        assert.ok(r.incidentTotal > 200);
        assert.equal(r.incidents.length, 50);
        assert.equal(incidents.length, r.incidentTotal);
        for (const i of r.incidents)
          assert.match(i.subjectId, /^[0-9a-f-]{36}$/);
        assert.doesNotMatch(
          JSON.stringify(r),
          /SYNTHETIC_PRIVATE|private-|PROOF|@example/
        );
        await Promise.all([
          syncOperationsIncidents(pool),
          syncOperationsIncidents(pool)
        ]);
        const key = `publication:ACCOUNT_RESULT_UNCERTAIN:${ids[99]}`;
        const episodes = async () =>
          (
            await pool.query(
              'SELECT id,resolved_at FROM operations_alerts WHERE incident_key=$1 ORDER BY created_at,id',
              [key]
            )
          ).rows;
        const first = (await episodes())[0];
        assert.ok(first);
        assert.equal((await episodes()).length, 1);
        await pool.query(
          'UPDATE publication_account_leases SET delivery_id=NULL,delivery_version=NULL,lease_until=NULL,uncertain=FALSE WHERE delivery_id=$1',
          [ids[99]]
        );
        await pool.query(
          "UPDATE publication_deliveries SET status='draft' WHERE id=$1",
          [ids[99]]
        );
        await syncOperationsIncidents(pool);
        assert.ok((await episodes())[0].resolved_at);
        await pool.query(
          "UPDATE publication_deliveries SET status='uncertain' WHERE id=$1",
          [ids[99]]
        );
        await syncOperationsIncidents(pool);
        const current = await episodes();
        assert.equal(current.length, 2);
        assert.notEqual(current[1].id, first.id);
        assert.equal(current[1].resolved_at, null);
      }
    );
    await t.test(
      'the aggregate shares a repeatable read snapshot rather than mixing a newer age into an existing read',
      async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          const before = await publicationReliability(client);
          await pool.query(
            "UPDATE sponsorship_obligations SET created_at=NOW()-INTERVAL '30 days' WHERE id=$1",
            [obligations[2].id]
          );
          assert.equal(
            (await publicationReliability(client)).obligations.oldestOpenAt,
            before.obligations.oldestOpenAt
          );
          assert.ok(
            Date.parse(
              (await publicationReliability(pool)).obligations.oldestOpenAt
            ) < Date.parse(before.obligations.oldestOpenAt)
          );
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    );
  }
);
