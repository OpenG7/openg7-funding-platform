import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import {
  detectPublicationReliabilityIncidents,
  publicationReliability
} from '../../dist/apps/funding-api/src/publication-reliability.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

test(
  'complete reliability incidents are actionable and paginated without writes or snapshot mixing',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const deliveries = (
      await pool.query(`INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode,status)
    SELECT 'openg7:facebook','news','SYNTHETIC_PRIVATE_TEXT_'||n,NOW()+INTERVAL '1 day','SYNTHETIC_PRIVATE_ACCOUNT_'||n,'live','uncertain'
    FROM generate_series(1,123) n RETURNING id`)
    ).rows.map((r) => r.id);
    const contribution = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    sponsor_company_name,email_private,public_display_consent,public_reference)
    VALUES('sponsorship_interest',50000,'cad','paid',NOW(),'SYNTHETIC_PRIVATE_NAME','private@example.invalid',TRUE,'SYNTHETIC-INCIDENT-PAGE') RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, contribution, {
      channel: 'facebook',
      quantity: 1
    });
    const obligation = (
      await pool.query(
        'SELECT id FROM sponsorship_obligations WHERE contribution_id=$1',
        [contribution]
      )
    ).rows[0].id;
    const evidence = (
      await pool.query(
        `INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,
    delivery_id,delivery_version,mode,account_id,provenance,external_post_id,message,source_snapshot,content_fingerprint,delivered_at,actor)
    VALUES($1,$2,1,'facebook','openg7',$3,1,'live','SYNTHETIC_PRIVATE_ACCOUNT','provider_acknowledged','synthetic-private-external-id',
      'SYNTHETIC_PRIVATE_PROOF','[]',$4,NOW(),'synthetic-fixture') RETURNING id`,
        [obligation, contribution, deliveries[0], '0'.repeat(64)]
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE sponsorship_obligations SET state='fulfilled',version=3,fulfilment_evidence_id=$2 WHERE id=$1",
      [obligation, evidence]
    );
    const service = new PublicationAutomationService(pool, {}, {});
    const before = (await pool.query('SELECT count(*) n FROM admin_audit_log'))
      .rows[0].n;

    await t.test(
      'all pages exhaust more than 50 correlations once with complete alert and global count agreement',
      async () => {
        const seen = [];
        let cursor, snapshot, total;
        let pages = 0;
        do {
          const page = await service.reliabilityIncidents(
            cursor ? { cursor } : {}
          );
          snapshot ??= page.snapshot;
          total ??= page.globalTotal;
          assert.equal(page.snapshot, snapshot);
          assert.equal(page.globalTotal, total);
          assert.ok(page.incidents.length <= 50);
          seen.push(
            ...page.incidents.map(
              (i) => `${i.code}:${i.subjectType}:${i.subjectId}`
            )
          );
          cursor = page.nextCursor;
          pages++;
        } while (cursor);
        assert.ok(pages > 2);
        assert.equal(seen.length, total);
        assert.equal(new Set(seen).size, total);
        assert.equal(
          (await detectPublicationReliabilityIncidents(pool)).length,
          total
        );
      }
    );
    await t.test(
      'filtered pages retain global totals and expose safe exact destination links only',
      async () => {
        const first = await service.reliabilityIncidents({
          code: 'ACCOUNT_RESULT_UNCERTAIN',
          subjectType: 'delivery'
        });
        assert.equal(first.filteredTotal, 123);
        assert.ok(first.globalTotal > 123);
        assert.equal(first.incidents.length, 50);
        assert.ok(
          first.incidents.every(
            (i) =>
              i.subjectId === i.deliveryId &&
              i.code === 'ACCOUNT_RESULT_UNCERTAIN'
          )
        );
        const second = await service.reliabilityIncidents({
          code: 'ACCOUNT_RESULT_UNCERTAIN',
          subjectType: 'delivery',
          cursor: first.nextCursor
        });
        const third = await service.reliabilityIncidents({
          code: 'ACCOUNT_RESULT_UNCERTAIN',
          subjectType: 'delivery',
          cursor: second.nextCursor
        });
        assert.equal(third.incidents.length, 23);
        assert.equal(third.nextCursor, null);
        const proof = await service.reliabilityIncidents({
          code: 'FULFILMENT_EVIDENCE_MISMATCH'
        });
        assert.deepEqual(proof.incidents, [
          {
            code: 'FULFILMENT_EVIDENCE_MISMATCH',
            subjectType: 'obligation',
            subjectId: obligation,
            sponsorshipId: contribution,
            deliveryId: deliveries[0]
          }
        ]);
        assert.doesNotMatch(
          JSON.stringify([first, second, third, proof]),
          /SYNTHETIC_PRIVATE|private@|external-id|source_snapshot|content_fingerprint|storageKey/
        );
        assert.equal(
          (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0]
            .n,
          before
        );
      }
    );
    await t.test(
      'a changed incident set forces a new examination instead of silently losing inserted or resolved records',
      async () => {
        const first = await service.reliabilityIncidents({
          code: 'ACCOUNT_RESULT_UNCERTAIN'
        });
        await pool.query(
          "UPDATE publication_deliveries SET status='draft' WHERE id=$1",
          [deliveries[0]]
        );
        await assert.rejects(
          service.reliabilityIncidents({
            code: 'ACCOUNT_RESULT_UNCERTAIN',
            cursor: first.nextCursor
          }),
          { code: 'RELIABILITY_SNAPSHOT_CHANGED', status: 409 }
        );
        const refreshed = await service.reliabilityIncidents({
          code: 'ACCOUNT_RESULT_UNCERTAIN'
        });
        assert.equal(refreshed.filteredTotal, 122);
        assert.notEqual(refreshed.snapshot, first.snapshot);
        assert.equal(
          (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0]
            .n,
          before
        );
      }
    );
    await t.test(
      'documented overdue and unknown origins enter complete alert episodes without bypassing payment blockers',
      async () => {
        const c = (
          await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      sponsor_company_name,public_display_consent) VALUES('sponsorship_interest',5000,'cad','paid',NOW(),'Synthetic deadline',TRUE) RETURNING id`)
        ).rows[0].id;
        const snapshot = {
          version: 'historical-qualification-v1',
          amountMinor: 5000,
          currency: 'CAD',
          benefits: [
            {
              id: 'website_mention',
              channel: 'website',
              target: 'openg7',
              quantity: 1,
              requiredElements: ['company_name'],
              deadlineDays: 1,
              durationDays: 2
            },
            {
              id: 'facebook_batch',
              channel: 'facebook',
              target: 'openg7',
              quantity: 1,
              requiredElements: ['company_name'],
              deadlineDays: 1,
              durationDays: null
            }
          ]
        };
        const offer = (
          await pool.query(
            `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
      VALUES($1,$2,$3,5000,'CAD',$4::jsonb,'historical_qualification') RETURNING id`,
            [c, snapshot.version, 'a'.repeat(64), JSON.stringify(snapshot)]
          )
        ).rows[0].id;
        const commitment = (
          await pool.query(
            `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at)
      VALUES($1,$2,'qualified_historical','active',NOW()) RETURNING id`,
            [c, offer]
          )
        ).rows[0].id;
        const pending = (
          await pool.query(
            `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal)
      VALUES($1,$2,'website_mention','website','openg7',1),($1,$2,'facebook_batch','facebook','openg7',1) RETURNING id,channel`,
            [commitment, c]
          )
        ).rows;
        const website = pending.find((o) => o.channel === 'website').id,
          facebook = pending.find((o) => o.channel === 'facebook').id;
        await pool.query(
          'INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,duration_days) VALUES($1,1,2)',
          [website]
        );
        await pool.query(
          `INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,origin_at,origin_provenance,due_at)
      VALUES($1,1,NOW()-INTERVAL '3 days','owner_recorded',NOW()-INTERVAL '2 days')`,
          [facebook]
        );
        await pool.query(
          "UPDATE sponsorship_obligations SET state='blocked',blocked_reason='PAYMENT_NOT_ELIGIBLE' WHERE id=$1",
          [facebook]
        );
        const reliability = await publicationReliability(pool);
        assert.equal(reliability.obligations.overdue, 1);
        assert.equal(reliability.obligations.missingDeadlineOrigin, 1);
        assert.equal(reliability.obligations.awaitingDuration, 1);
        const overdue = await service.reliabilityIncidents({
          code: 'SPONSORSHIP_DEADLINE_EXCEEDED'
        });
        assert.deepEqual(overdue.incidents, [
          {
            code: 'SPONSORSHIP_DEADLINE_EXCEEDED',
            subjectType: 'obligation',
            subjectId: facebook,
            sponsorshipId: c
          }
        ]);
        const origin = await service.reliabilityIncidents({
          code: 'SPONSORSHIP_DEADLINE_ORIGIN_UNKNOWN'
        });
        assert.equal(origin.filteredTotal, 1);
        assert.equal(origin.incidents[0].subjectId, website);
        const episodes = await detectPublicationReliabilityIncidents(pool);
        assert.ok(
          episodes.some(
            (e) =>
              e.key === `publication:SPONSORSHIP_DEADLINE_EXCEEDED:${facebook}`
          )
        );
        assert.ok(
          episodes.some(
            (e) =>
              e.key ===
              `publication:SPONSORSHIP_DEADLINE_ORIGIN_UNKNOWN:${website}`
          )
        );
        await pool.query(
          "UPDATE sponsorship_obligations SET state='adjusted' WHERE id=$1",
          [facebook]
        );
        assert.equal(
          (
            await service.reliabilityIncidents({
              code: 'SPONSORSHIP_DEADLINE_EXCEEDED'
            })
          ).filteredTotal,
          0
        );
      }
    );
  }
);
