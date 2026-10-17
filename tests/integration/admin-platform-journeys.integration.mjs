import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { getCockpitJourneys } from '../../dist/apps/funding-api/src/admin-cockpit/journeys.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const now = new Date('2026-10-17T14:00:00Z');
const recent = '2026-10-17T13:59:00Z';
const journey = (result, id) => result.journeys.find((j) => j.id === id);

// Existing public presentations use their genuine legacy policy, without inventing a new N0 decision.
const recordLegacyVisibility = async (pool, sponsor) => {
  for (const [type, id] of [
    ['sponsorship', sponsor.id],
    ['media', sponsor.media]
  ])
    await pool.query(
      `INSERT INTO moderation_legacy_visibility(subject_type,subject_id,content_fingerprint,observed_at)
      VALUES($1,$2,encode(digest(moderation_snapshot($1,$2)::text,'sha256'),'hex'),$3)
      ON CONFLICT(subject_type,subject_id) DO UPDATE SET content_fingerprint=EXCLUDED.content_fingerprint,invalidated_at=NULL`,
      [type, id, recent]
    );
};

const createWebsiteSponsor = async (pool, label) => {
  const created = '2026-10-17T13:50:00Z';
  const id = (
    await pool.query(
      `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      public_display_consent,sponsor_review_status,sponsor_reviewed_at,sponsor_company_name,created_at,updated_at)
      VALUES('sponsorship_interest',25000,'cad','paid',$1,TRUE,'approved',$1,$2,$1,$1) RETURNING id`,
      [created, `Synthetic ${label}`]
    )
  ).rows[0].id;
  const offer = (
    await pool.query(
      `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
      VALUES($1,'synthetic',repeat('a',64),25000,'CAD',
        '{"version":"synthetic","amountMinor":25000,"currency":"CAD","benefits":[]}',
        'historical_qualification') RETURNING id`,
      [`SYNTHETIC-${label}`]
    )
  ).rows[0].id;
  const commitment = (
    await pool.query(
      `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at)
      VALUES($1,$2,'qualified_historical','active',$3) RETURNING id`,
      [id, offer, created]
    )
  ).rows[0].id;
  const obligation = (
    await pool.query(
      `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal)
      VALUES($1,$2,'website_mention','website','openg7',1) RETURNING id`,
      [commitment, id]
    )
  ).rows[0].id;
  const media = (
    await pool.query(
      `INSERT INTO sponsor_media_assets(contribution_id,kind,review_status,original_filename,original_mime_type,
      original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_url,
      checksum_sha256,width,height,created_at,updated_at)
      VALUES($1,'supporting_image','approved','synthetic.webp','image/webp',64,$2,64,$3,
        'https://public.example.invalid/synthetic.webp',repeat('b',64),40,30,$4,$4) RETURNING id`,
      [id, `${label}/original.webp`, `${label}/processed.webp`, created]
    )
  ).rows[0].id;
  const sponsor = { id, media, obligation };
  await recordLegacyVisibility(pool, sponsor);
  return sponsor;
};

const startWebsiteObservation = async (pool, sponsor, at) =>
  (
    await pool.query(
      `INSERT INTO sponsorship_website_exposure_observations(obligation_id,contribution_id,
      obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,observed_at,actor)
      VALUES($1,$2,1,repeat('c',64),'Synthetic public profile','[]','[]',$3,'synthetic-owner') RETURNING id`,
      [sponsor.obligation, sponsor.id, at]
    )
  ).rows[0].id;

const observeWebsite = async (pool, sponsor, start, status, at) => {
  const reason = {
    visible: 'MATCH',
    changed: 'PUBLIC_CONTENT_CHANGED',
    not_visible: 'PUBLIC_MEDIA_MISSING',
    unknown: 'HTTP_ERROR'
  }[status];
  await pool.query(
    `INSERT INTO sponsorship_public_visibility_observations(request_id,obligation_id,contribution_id,
    start_observation_id,obligation_version,content_fingerprint,started_at,checked_at,status,reason,request_count,next_directory_page)
    VALUES($1,$2,$3,$4,1,repeat('c',64),$5,$5,$6,$7,1,1)`,
    [randomUUID(), sponsor.obligation, sponsor.id, start, at, status, reason]
  );
};

test(
  'journey observations correlate PostgreSQL facts, preserve read-only snapshots and keep partial sources honest',
  { timeout: 120000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      let result = await getCockpitJourneys(pool, now, true);
      assert.equal(
        journey(result, 'contribution').diagnostic,
        'source_missing'
      );
      assert.equal(
        journey(result, 'administration').steps.find(
          (s) => s.id === 'api_access'
        ).state,
        'operational'
      );
      for (const file of (await readdir('apps/funding-api/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort())
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      result = await getCockpitJourneys(pool, now);
      assert.ok(result.journeys.every((j) => j.state === 'unknown'));
      assert.equal(
        journey(result, 'publication').diagnostic,
        'no_recent_observation',
        'paused empty feeds are not an incident'
      );

      const id = (
        await pool.query(
          `INSERT INTO fund_contributions
        (contribution_type,amount_cents,currency,status,paid_at,stripe_session_id,stripe_payment_intent_id,
          public_reference,email_private,created_at,updated_at)
        VALUES ('personal_support',10000,'cad','paid',$1,'cs_journey','pi_journey','OG7-2026-ABC234',
          'synthetic-private-journey@example.invalid',$1,$1) RETURNING id`,
          [recent]
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO stripe_checkout_sessions
        (stripe_session_id,stripe_payment_intent_id,contribution_type,amount_cents,currency,status,created_at,updated_at)
        VALUES ('cs_journey','pi_journey','personal_support',10000,'cad','completed',$1,$1)`,
        [recent]
      );
      await pool.query(
        `INSERT INTO stripe_events
        (stripe_event_id,event_type,payload,processing_status,received_at,processed_at)
        VALUES ('evt_journey','payment_intent.succeeded',$1::jsonb,'processed',$2,$2)`,
        [
          JSON.stringify({
            livemode: false,
            data: {
              object: {
                id: 'pi_journey',
                private_data: 'synthetic-private-provider'
              }
            }
          }),
          recent
        ]
      );
      await pool.query(
        `INSERT INTO fund_transactions
        (stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,inserted_at,public_category)
        VALUES ('evt_journey','pi_journey','payment_intent.succeeded',10000,300,9700,'cad','succeeded',$1,$1,'contribution')`,
        [recent]
      );
      const invoice = (
        await pool.query(
          `INSERT INTO sponsorship_invoices
        (contribution_id,invoice_number,stripe_session_id,stripe_payment_intent_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name,issued_at)
        VALUES ($1,'FAC-JOURNEY','cs_journey','pi_journey','cad',10000,10000,'Synthetic','Synthetic',$2) RETURNING id`,
          [id, recent]
        )
      ).rows[0].id;
      const message = (
        await pool.query(
          `INSERT INTO email_messages
        (template_key,recipient_email,from_email,subject,text_body,html_body,metadata,status,sent_at,created_at,updated_at)
        VALUES ('sponsorship_invoice','synthetic-private-journey@example.invalid','noreply@example.invalid',
          'synthetic-private-subject','synthetic-private-body','synthetic-private-body',$1::jsonb,'sent',$2,$2,$2) RETURNING id`,
          [JSON.stringify({ invoiceId: invoice }), recent]
        )
      ).rows[0].id;

      const counts = async () =>
        (
          await pool.query(`SELECT (SELECT count(*) FROM email_messages)::integer AS email,
        (SELECT count(*) FROM admin_audit_log)::integer AS audit,(SELECT count(*) FROM fund_transactions)::integer AS ledger,
        (SELECT count(*) FROM sponsorship_public_visibility_observations)::integer AS observations`)
        ).rows[0];
      const before = await counts();
      let readOnlyVerified = false;
      const readOnlyPool = {
        connect: async () => {
          const client = await pool.connect();
          return {
            release: (...args) => client.release(...args),
            query: async (sql, ...args) => {
              const answer = await client.query(sql, ...args);
              if (/^BEGIN\b/.test(sql)) {
                assert.equal(
                  (await client.query('SHOW transaction_read_only')).rows[0]
                    .transaction_read_only,
                  'on'
                );
                assert.equal(
                  (await client.query('SHOW transaction_isolation')).rows[0]
                    .transaction_isolation,
                  'repeatable read'
                );
                readOnlyVerified = true;
              }
              return answer;
            }
          };
        }
      };
      result = await getCockpitJourneys(readOnlyPool, now, true);
      assert.ok(readOnlyVerified);
      assert.equal(journey(result, 'contribution').state, 'operational');
      assert.equal(journey(result, 'contribution').environment, 'test');
      assert.equal(journey(result, 'invoicing').state, 'operational');
      assert.equal(
        journey(result, 'invoicing').steps.find((s) => s.id === 'email')
          .diagnostic,
        'smtp_accepted'
      );
      assert.equal(journey(result, 'transparency').state, 'unknown');
      assert.deepEqual(
        await counts(),
        before,
        'reading journeys must not queue mail, publish, audit, or create observations'
      );
      assert.ok(!JSON.stringify(result).includes('synthetic-private'));

      await pool.query(
        `INSERT INTO stripe_events(stripe_event_id,event_type,payload,processing_status,received_at)
        VALUES('evt_journey_failed','checkout.session.completed','{"livemode":true}',
          'failed','2026-10-17T13:58:00Z')`
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(journey(result, 'contribution').state, 'unavailable');
      assert.equal(journey(result, 'contribution').environment, 'live');
      assert.equal(
        journey(result, 'contribution').steps.find(
          (step) => step.id === 'confirmation'
        ).state,
        'unavailable',
        'a newer healthy payment cannot hide another unresolved webhook'
      );
      await pool.query(
        "UPDATE stripe_events SET processing_status='processed',processed_at=$1 WHERE stripe_event_id='evt_journey_failed'",
        [recent]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'contribution').state,
        'operational'
      );

      await pool.query(
        "UPDATE fund_contributions SET public_reference='invalid-reference' WHERE id=$1",
        [id]
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(
        journey(result, 'contribution').state,
        'unknown',
        'follow-up needs a reference accepted by the real public contract'
      );
      assert.equal(journey(result, 'invoicing').state, 'operational');
      await pool.query(
        "UPDATE fund_contributions SET public_reference='OG7-2026-ABC234' WHERE id=$1",
        [id]
      );

      await pool.query(
        "UPDATE fund_transactions SET amount=9999 WHERE stripe_event_id='evt_journey'"
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(
        journey(result, 'contribution').state,
        'unknown',
        'mismatched amount cannot attest a completed payment'
      );
      assert.equal(journey(result, 'invoicing').state, 'unknown');
      await pool.query(
        "UPDATE fund_transactions SET amount=10000 WHERE stripe_event_id='evt_journey'"
      );
      await pool.query(
        "UPDATE stripe_events SET payload=jsonb_set(payload,'{data,object,id}','\"pi_unrelated\"') WHERE stripe_event_id='evt_journey'"
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'contribution').state,
        'unknown'
      );
      await pool.query(
        "UPDATE stripe_events SET payload=jsonb_set(payload,'{data,object,id}','\"pi_journey\"') WHERE stripe_event_id='evt_journey'"
      );
      await pool.query(
        "UPDATE email_messages SET metadata='{}'::jsonb WHERE id=$1",
        [message]
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(
        journey(result, 'invoicing').state,
        'unknown',
        'an unrelated SMTP success cannot complete an invoice'
      );
      assert.equal(journey(result, 'contribution').state, 'operational');
      await pool.query(
        "UPDATE email_messages SET metadata=$2::jsonb,status='uncertain' WHERE id=$1",
        [message, JSON.stringify({ invoiceId: invoice })]
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(journey(result, 'invoicing').state, 'degraded');
      assert.equal(
        journey(result, 'invoicing').diagnostic,
        'delivery_uncertain'
      );
      await pool.query(
        "UPDATE email_messages SET status='failed' WHERE id=$1",
        [message]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'invoicing').state,
        'unavailable'
      );
      await pool.query("UPDATE email_messages SET status='sent' WHERE id=$1", [
        message
      ]);

      await pool.query(
        "UPDATE publication_feeds SET paused=FALSE WHERE id='openg7:facebook'"
      );
      const delivery = (
        await pool.query(
          `INSERT INTO publication_deliveries
        (feed_id,kind,message,scheduled_at,account_id,mode,status,approved_at,approved_by,published_at,external_post_id,created_at,updated_at)
        VALUES ('openg7:facebook','news','Synthetic content','2026-10-17T13:00Z','synthetic-account','mock','published',
          '2026-10-16T13:00Z','synthetic-actor',$1,'synthetic-post',$1,$1) RETURNING id`,
          [recent]
        )
      ).rows[0].id;
      result = await getCockpitJourneys(pool, now);
      assert.equal(journey(result, 'publication').state, 'operational');
      assert.equal(journey(result, 'publication').environment, 'test');
      const blockedDelivery = (
        await pool.query(
          `INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode,status,
          approved_at,approved_by,created_at,updated_at)
          VALUES('openg7:facebook','news','Synthetic blocked delivery','2026-10-17T13:00Z',
            'synthetic-account','live','blocked','2026-10-17T12:00Z','synthetic-actor',
            '2026-10-17T12:00Z','2026-10-17T13:58Z') RETURNING id`
        )
      ).rows[0].id;
      for (const [status, state, diagnostic] of [
        ['blocked', 'unavailable', 'processing_failed'],
        ['uncertain', 'degraded', 'delivery_uncertain']
      ]) {
        await pool.query(
          'UPDATE publication_deliveries SET status=$2 WHERE id=$1',
          [blockedDelivery, status]
        );
        result = await getCockpitJourneys(pool, now);
        assert.equal(
          journey(result, 'publication').state,
          state,
          'a successful delivery must not hide another incident'
        );
        assert.equal(journey(result, 'publication').diagnostic, diagnostic);
        assert.equal(journey(result, 'publication').environment, 'live');
      }
      await pool.query(
        "UPDATE publication_deliveries SET status='published',published_at=$2,external_post_id='synthetic-resolved-post' WHERE id=$1",
        [blockedDelivery, recent]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'publication').state,
        'operational'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE WHERE id='openg7:facebook'"
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'publication').state,
        'unknown',
        'a paused feed is inactive, even after a recent success'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=FALSE WHERE id='openg7:facebook'"
      );
      await pool.query(
        'UPDATE publication_deliveries SET approved_at=NULL,approved_by=NULL WHERE id=ANY($1::uuid[])',
        [[delivery, blockedDelivery]]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'publication').state,
        'unknown',
        'publication without recorded authorization is not a complete chain'
      );
      await pool.query(
        "INSERT INTO fund_contributions (contribution_type,amount_cents,currency,status,sponsor_review_status,created_at,updated_at) VALUES ('sponsorship_interest',25000,'cad','paid','pending_review',$1,$1)",
        [recent]
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(journey(result, 'sponsorship').state, 'unknown');
      assert.equal(
        journey(result, 'sponsorship').diagnostic,
        'awaiting_review'
      );

      const healthy = await createWebsiteSponsor(pool, 'healthy');
      const healthyStart = await startWebsiteObservation(
        pool,
        healthy,
        '2026-10-17T13:55Z'
      );
      await observeWebsite(pool, healthy, healthyStart, 'visible', recent);
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'sponsorship').state,
        'operational'
      );
      const interrupted = await createWebsiteSponsor(pool, 'interrupted');
      const interruptedStart = await startWebsiteObservation(
        pool,
        interrupted,
        '2026-10-17T13:55Z'
      );
      for (const [status, at] of [
        ['not_visible', '2026-10-17T13:58Z'],
        ['changed', '2026-10-17T13:58:10Z'],
        ['visible', '2026-10-17T13:58:20Z']
      ]) {
        await observeWebsite(pool, interrupted, interruptedStart, status, at);
        result = await getCockpitJourneys(pool, now);
        assert.equal(
          journey(result, 'sponsorship').state,
          'unavailable',
          'another healthy dossier or a healthy sample of the interrupted period cannot hide its incident'
        );
        assert.equal(
          journey(result, 'sponsorship').diagnostic,
          'processing_failed'
        );
        assert.equal(
          journey(result, 'sponsorship').steps.find(
            (step) => step.id === 'visibility'
          ).state,
          'unavailable'
        );
      }

      for (const [apply, restore] of [
        [
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          'UPDATE fund_contributions SET public_display_consent=TRUE WHERE id=$1'
        ],
        [
          'UPDATE fund_contributions SET sponsor_site_visibility_held=TRUE WHERE id=$1',
          'UPDATE fund_contributions SET sponsor_site_visibility_held=FALSE WHERE id=$1'
        ],
        [
          "UPDATE sponsorship_obligations SET state='adjusted' WHERE contribution_id=$1",
          "UPDATE sponsorship_obligations SET state='pending' WHERE contribution_id=$1"
        ],
        [
          'UPDATE sponsorship_obligations SET version=2 WHERE contribution_id=$1',
          'UPDATE sponsorship_obligations SET version=1 WHERE contribution_id=$1'
        ],
        [
          "UPDATE fund_contributions SET updated_at='2026-10-17T13:59:30Z' WHERE id=$1",
          "UPDATE fund_contributions SET updated_at='2026-10-17T13:50Z' WHERE id=$1"
        ],
        [
          "UPDATE sponsor_media_assets SET review_status='rejected',public_url=NULL WHERE contribution_id=$1",
          "UPDATE sponsor_media_assets SET review_status='approved',public_url='https://public.example.invalid/synthetic.webp' WHERE contribution_id=$1"
        ]
      ]) {
        await pool.query(apply, [interrupted.id]);
        assert.equal(
          journey(await getCockpitJourneys(pool, now), 'sponsorship').state,
          'operational',
          'withdrawn authorization, retired obligations or obsolete observations are not platform incidents'
        );
        await pool.query(restore, [interrupted.id]);
        await recordLegacyVisibility(pool, interrupted);
        assert.equal(
          journey(await getCockpitJourneys(pool, now), 'sponsorship').state,
          'unavailable'
        );
      }
      const fulfilment = (
        await pool.query(
          `INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,
          channel,target,mode,account_id,provenance,message,source_snapshot,media_snapshot,content_fingerprint,
          delivered_at,actor) VALUES($1,$2,1,'website','openg7','live','synthetic-directory','website_verified',
          'Synthetic fulfilled profile','[]','[]',repeat('d',64),$3,'synthetic-owner') RETURNING id`,
          [interrupted.obligation, interrupted.id, recent]
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE sponsorship_obligations SET state='fulfilled',fulfilment_evidence_id=$2 WHERE id=$1",
        [interrupted.obligation, fulfilment]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'sponsorship').state,
        'operational',
        'a completed obligation no longer supplies platform incidents'
      );
      await pool.query(
        "UPDATE sponsorship_obligations SET state='pending',fulfilment_evidence_id=NULL WHERE id=$1",
        [interrupted.obligation]
      );
      const resumedStart = await startWebsiteObservation(
        pool,
        interrupted,
        '2026-10-17T13:59:10Z'
      );
      await observeWebsite(
        pool,
        interrupted,
        resumedStart,
        'visible',
        '2026-10-17T13:59:20Z'
      );
      await pool.query(
        'UPDATE fund_contributions SET sponsor_site_visibility_held=TRUE WHERE id=$1',
        [healthy.id]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'sponsorship').state,
        'operational',
        'a new current exposure period with a public observation resolves the prior incident'
      );
      await pool.query(
        'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
        [interrupted.id]
      );
      assert.equal(
        journey(await getCockpitJourneys(pool, now), 'sponsorship').state,
        'unknown',
        'a formerly complete chain cannot remain green after consent withdrawal'
      );

      await pool.query(
        'ALTER TABLE email_messages RENAME TO journey_hidden_email_messages'
      );
      result = await getCockpitJourneys(pool, now);
      assert.equal(journey(result, 'invoicing').diagnostic, 'source_missing');
      assert.equal(
        journey(result, 'contribution').state,
        'operational',
        'missing optional source does not hide available journeys'
      );
    } finally {
      await stop();
    }
  }
);
