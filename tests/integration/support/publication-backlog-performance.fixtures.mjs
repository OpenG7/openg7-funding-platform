import { createHash } from 'node:crypto';

import { normalizeSponsorshipOfferSnapshot } from '../../../dist/packages/funding-core/src/index.js';

export const BACKLOG_COUNTS = Object.freeze({
  dossiers: 3000,
  obligations: 6000,
  deliveries: 2000,
  batches: 150,
  members: 750,
  uncertain: 20
});

/** Bulk synthetic facts declared explicitly; no price-based historical inference. */
export async function seedPublicationBacklog(source) {
  const pool = await source.connect();
  try {
    const offer = normalizeSponsorshipOfferSnapshot({
      version: 'synthetic-backlog-v1',
      amountMinor: 50000,
      currency: 'CAD',
      benefits: ['facebook', 'linkedin'].map((channel) => ({
        id: `${channel}_batch`,
        channel,
        target: 'openg7',
        quantity: 1,
        requiredElements: ['company_name'],
        deadlineDays: 7,
        durationDays: null,
        format: 'collective_text'
      }))
    });
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(offer))
      .digest('hex');
    await pool.query(`CREATE TEMP TABLE backlog_dossiers(n integer PRIMARY KEY,id uuid NOT NULL,offer_id uuid NOT NULL,commitment_id uuid NOT NULL);
    INSERT INTO backlog_dossiers SELECT n,gen_random_uuid(),gen_random_uuid(),gen_random_uuid() FROM generate_series(1,3000) n;
    INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,created_at,
      sponsor_company_name,sponsor_public_summary,sponsor_review_status,public_display_consent,public_reference)
    SELECT id,'sponsorship_interest',50000,'cad','paid',NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days',
      'Synthetic sponsor '||n,'Synthetic contribution to a shared public project.','pending_review',TRUE,'SYNTHETIC-BACKLOG-'||n
    FROM backlog_dossiers;`);
    await pool.query(
      `INSERT INTO sponsorship_offers(id,public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
    SELECT offer_id,'SYNTHETIC-BACKLOG-'||n,$1,$2,50000,'CAD',$3::jsonb,'historical_qualification' FROM backlog_dossiers`,
      [offer.version, fingerprint, JSON.stringify(offer)]
    );
    await pool.query(`INSERT INTO sponsorship_commitments(id,contribution_id,offer_id,provenance,state,activated_at,created_at)
    SELECT commitment_id,id,offer_id,'qualified_historical','active',NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days' FROM backlog_dossiers;
    INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal,publication_format,created_at)
    SELECT commitment_id,id,channel||'_batch',channel,'openg7',1,'collective_text',NOW()-INTERVAL '30 days'
    FROM backlog_dossiers CROSS JOIN (VALUES('facebook'),('linkedin')) channels(channel);
    INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,origin_at,origin_provenance,due_at)
    SELECT id,7,created_at,'owner_recorded',created_at+7*INTERVAL '24 hours' FROM sponsorship_obligations;
    CREATE TEMP TABLE backlog_batches(n integer PRIMARY KEY,id uuid NOT NULL,slot_id uuid NOT NULL);
    INSERT INTO backlog_batches SELECT n,gen_random_uuid(),gen_random_uuid() FROM generate_series(1,150) n;
    INSERT INTO publication_slots(id,feed_target,channel,starts_at,timezone,capacity,status)
    SELECT slot_id,'openg7','facebook',NOW()+INTERVAL '45 days'+n*INTERVAL '2 minutes','UTC',5,'open' FROM backlog_batches;
    INSERT INTO sponsor_publication_batches(id,channel,capacity,status,scheduled_at,slot_id,publication_format)
    SELECT id,'facebook',5,'open',NOW()+INTERVAL '45 days'+n*INTERVAL '2 minutes',slot_id,'collective_text' FROM backlog_batches;
    INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,batch_id,obligation_id,scheduled_at,created_at)
    SELECT c.id,'openg7','facebook','Synthetic recognition','Synthetic contribution to a shared public project.','Paid sponsorship.',b.id,o.id,
      NOW()+INTERVAL '45 days'+b.n*INTERVAL '2 minutes',c.created_at
    FROM backlog_dossiers f JOIN fund_contributions c ON c.id=f.id
    JOIN backlog_batches b ON b.n=((f.n-1)/5)+1
    JOIN sponsorship_obligations o ON o.contribution_id=c.id AND o.channel='facebook' WHERE f.n<=750;
    CREATE TEMP TABLE backlog_deliveries(n integer PRIMARY KEY,id uuid NOT NULL);
    INSERT INTO backlog_deliveries SELECT n,gen_random_uuid() FROM generate_series(1,2000) n;
    INSERT INTO publication_deliveries(id,feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,approved_at,approved_by,obligation_snapshot)
    SELECT f.id,'openg7:facebook',CASE WHEN b.id IS NULL THEN 'news' ELSE 'sponsorship' END,b.id,
      'Synthetic approved publication.',NOW()+INTERVAL '45 days'+f.n*INTERVAL '2 minutes',
      CASE WHEN f.n>1980 THEN 'SYNTHETIC_PRIVATE_ACCOUNT_'||f.n ELSE 'SYNTHETIC_PRIVATE_SHARED_ACCOUNT' END,
      'live',CASE WHEN f.n>1980 THEN 'uncertain' ELSE 'approved' END,NOW(),'synthetic-fixture',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.obligation_id::text,'version',1))
        FROM sponsor_publication_drafts d WHERE d.batch_id=b.id),'[]'::jsonb)
    FROM backlog_deliveries f LEFT JOIN backlog_batches b ON b.n=f.n;
    INSERT INTO sponsorship_obligation_reservations(obligation_id,delivery_id,obligation_version)
    SELECT d.obligation_id,p.id,1 FROM sponsor_publication_drafts d JOIN publication_deliveries p ON p.batch_id=d.batch_id;
    INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain)
    SELECT 'facebook','SYNTHETIC_PRIVATE_SHARED_ACCOUNT','live',NULL,NULL,NULL,FALSE
    UNION ALL SELECT 'facebook','SYNTHETIC_PRIVATE_ACCOUNT_'||n,'live',id,1,NOW()+INTERVAL '5 minutes',TRUE
      FROM backlog_deliveries WHERE n>1980;
    INSERT INTO publication_account_reservations(delivery_id,provider,account_id,mode,scheduled_at,approval_version,status)
    SELECT id,'facebook',account_id,mode,scheduled_at,1,CASE WHEN status='uncertain' THEN 'uncertain' ELSE 'reserved' END FROM publication_deliveries;
    UPDATE publication_feeds SET timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time='12:00',capacity=10,horizon_days=2;
    ANALYZE;`);
    return BACKLOG_COUNTS;
  } finally {
    pool.release();
  }
}
