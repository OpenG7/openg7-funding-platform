import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import pg from 'pg';

import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const directory = new URL(
  '../../apps/funding-api/migrations/',
  import.meta.url
);
const fingerprint = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tables = async (pool) =>
  (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
  ).rows.map((row) => row.tablename);
const rows = async (pool, table, upgraded = false) => {
  // Names come exclusively from PostgreSQL's catalog, never from user input.
  assert.match(table, /^[a-z_][a-z0-9_]*$/);
  const value =
    upgraded && table === 'sponsorship_fulfilment_evidence'
      ? "to_jsonb(fact)-'provider_media_ids'"
      : 'to_jsonb(fact)';
  return (
    await pool.query(
      `SELECT ${value} AS fact FROM "${table}" fact ORDER BY ${value}::text`
    )
  ).rows.map((row) => row.fact);
};
const privileges = async (pool, role, names) =>
  (
    await pool.query(
      `
  SELECT name, privilege, has_table_privilege($1,name,privilege) AS table_grant,
    CASE WHEN privilege='DELETE' THEN FALSE ELSE has_any_column_privilege($1,name,privilege) END AS column_grant
  FROM unnest($2::text[]) name CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES']) privilege
  ORDER BY name,privilege`,
      [role, names]
    )
  ).rows;

test(
  'migrations 053–054 preserve an existing paid agreement, source publication and immutable timing history',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    const pool = database.pool;
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const migrations = (await readdir(directory))
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort();
    assert.equal(
      migrations.filter((name) => Number(name.slice(0, 3)) <= 52).length,
      52
    );
    for (const migration of migrations.filter(
      (name) => Number(name.slice(0, 3)) <= 52
    ))
      await pool.query(await readFile(new URL(migration, directory), 'utf8'));
    assert.equal(
      (
        await pool.query(
          "SELECT to_regclass('sponsorship_public_visibility_observations') AS relation"
        )
      ).rows[0].relation,
      null
    );

    // Explicit synthetic pre-upgrade facts: no current offer or historical provider
    // response is inferred by application code, and no provider/storage is called.
    const id = Object.fromEntries(
      [
        'contribution',
        'offer',
        'commitment',
        'website',
        'linkedin',
        'media',
        'batch',
        'draft',
        'delivery',
        'evidence',
        'start',
        'change',
        'review'
      ].map((name) => [name, randomUUID()])
    );
    const knownAt = '2020-01-01T00:00:00.000Z';
    const company = 'Synthetic upgrade sponsor';
    const summary = 'A preserved historical presentation.';
    const usage = {
      state: 'confirmed',
      channels: ['website', 'linkedin'],
      targets: ['openg7'],
      transformations: [],
      credit: null,
      restrictions: null
    };
    const mediaHash = fingerprint({ syntheticImage: 'historical-source' });
    const media = {
      id: id.media,
      kind: 'supporting_image',
      url: '/api/public/sponsor-media/' + id.media,
      sourceHash: mediaHash,
      version: knownAt,
      usage,
      restrictionsReviewed: true
    };
    const source = {
      id: id.contribution,
      company,
      summary,
      version: knownAt,
      logo_url: null,
      approvals: null
    };
    const websiteContent = {
      message: company + '\n\n' + summary,
      sources: [source],
      media: [media]
    };
    const title = 'Recognition of ' + company;
    const disclosure = 'Paid sponsorship — historical synthetic fixture.';
    const message = [title, summary, disclosure].join('\n\n');
    const socialSources = [
      {
        id: id.draft,
        contribution_id: id.contribution,
        title,
        body: summary,
        disclosure_text: disclosure
      }
    ];
    // Omit kind deliberately: pre-053 source snapshots use the legacy default.
    const socialMedia = {
      id: id.media,
      hash: mediaHash,
      version: knownAt,
      url: media.url,
      usage
    };
    const offer = {
      version: 'historical-qualification-v1',
      amountMinor: 50000,
      currency: 'CAD',
      benefits: [
        {
          id: 'website_mention',
          channel: 'website',
          target: 'openg7',
          quantity: 1,
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: 7,
          durationDays: 30
        },
        {
          id: 'linkedin_batch',
          channel: 'linkedin',
          target: 'openg7',
          quantity: 1,
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: null,
          durationDays: null,
          format: 'collective_text'
        }
      ]
    };
    await pool.query(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,
    stripe_session_id,stripe_payment_intent_id,public_reference,sponsor_company_name,sponsor_public_summary,
    public_display_consent,sponsor_review_status,sponsor_site_visibility_held,created_at,updated_at)
    VALUES($1,'sponsorship_interest',50000,'cad','paid',$2,'cs_synthetic_upgrade','pi_synthetic_upgrade',
      'OG7-2020-ABCDEF12',$3,$4,TRUE,'approved',TRUE,$2,$2)`,
      [id.contribution, knownAt, company, summary]
    );
    await pool.query(
      `INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
    VALUES('evt_synthetic_upgrade','pi_synthetic_upgrade','payment_intent.succeeded',50000,1500,48500,'cad','succeeded',$1,'contribution','{"synthetic":true}'::jsonb)`,
      [knownAt]
    );
    await pool.query(
      `INSERT INTO sponsorship_offers(id,public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance,created_at)
    VALUES($1,'OG7-2020-ABCDEF12',$2,$3,50000,'CAD',$4::jsonb,'historical_qualification',$5)`,
      [
        id.offer,
        offer.version,
        fingerprint(offer),
        JSON.stringify(offer),
        knownAt
      ]
    );
    await pool.query(
      `INSERT INTO sponsorship_commitments(id,contribution_id,offer_id,provenance,state,qualification_reason,version,activated_at,created_at,updated_at)
    VALUES($1,$2,$3,'qualified_historical','active','Synthetic documented historical agreement',3,$4,$4,$4)`,
      [id.commitment, id.contribution, id.offer, knownAt]
    );
    for (const [obligation, benefit, channel] of [
      [id.website, 'website_mention', 'website'],
      [id.linkedin, 'linkedin_batch', 'linkedin']
    ]) {
      await pool.query(
        `INSERT INTO sponsorship_obligations(id,commitment_id,contribution_id,benefit_id,channel,target,ordinal,publication_format,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'openg7',1,$6,$7,$7)`,
        [
          obligation,
          id.commitment,
          id.contribution,
          benefit,
          channel,
          channel === 'website' ? null : 'collective_text',
          knownAt
        ]
      );
    }
    await pool.query(
      `INSERT INTO sponsorship_obligation_timing(obligation_id,version,deadline_days,duration_days)
    VALUES($1,2,7,30),($2,1,NULL,NULL)`,
      [id.website, id.linkedin]
    );
    await pool.query(
      `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,uploaded_by,original_filename,original_mime_type,
    original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_url,checksum_sha256,width,height,
    alt_text,reviewed_at,reviewed_by,usage_rights,usage_restrictions_reviewed,created_at,updated_at)
    VALUES($1,$2,'supporting_image','approved','admin','synthetic.webp','image/webp',64,'synthetic/upgrade/original.webp',
      64,'synthetic/upgrade/processed.webp',$3,$4,40,30,'Synthetic historical image',$5,'synthetic-owner',$6::jsonb,TRUE,$5,$5)`,
      [
        id.media,
        id.contribution,
        media.url,
        mediaHash,
        knownAt,
        JSON.stringify(usage)
      ]
    );
    await pool.query(
      `INSERT INTO sponsor_publication_batches(id,channel,capacity,status,scheduled_at,published_at,publication_format,created_at,updated_at)
    VALUES($1,'linkedin',3,'published',$2,$2,'collective_text',$2,$2)`,
      [id.batch, knownAt]
    );
    await pool.query(
      `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,status,
    batch_id,obligation_id,public_url,scheduled_at,approved_at,published_at,created_at,updated_at)
    VALUES($1,$2,'openg7','linkedin',$3,$4,$5,'published',$6,$7,'https://www.linkedin.com/feed/update/urn:li:share:100/',$8,$8,$8,$8,$8)`,
      [
        id.draft,
        id.contribution,
        title,
        summary,
        disclosure,
        id.batch,
        id.linkedin,
        knownAt
      ]
    );
    await pool.query(
      `INSERT INTO publication_deliveries(id,feed_id,kind,batch_id,message,scheduled_at,media_id,media_snapshot,source_snapshot,
    account_id,mode,version,status,attempts,external_post_id,external_post_url,provider_media_id,approved_at,approved_by,published_at,created_at,updated_at)
    VALUES($1,'openg7:linkedin','sponsorship',$2,$3,$4,$5,$6::jsonb,$7::jsonb,'urn:li:organization:100','live',3,'published',1,
      'urn:li:share:100','https://www.linkedin.com/feed/update/urn:li:share:100/','urn:li:image:historical_cache',$4,'synthetic-owner',$4,$4,$4)`,
      [
        id.delivery,
        id.batch,
        message,
        knownAt,
        id.media,
        JSON.stringify(socialMedia),
        JSON.stringify(socialSources)
      ]
    );
    await pool.query(
      `INSERT INTO sponsorship_fulfilment_evidence(id,obligation_id,contribution_id,obligation_version,channel,target,delivery_id,delivery_version,
    mode,account_id,provenance,external_post_id,external_post_url,message,source_snapshot,media_snapshot,content_fingerprint,delivered_at,recorded_at,actor)
    VALUES($1,$2,$3,1,'linkedin','openg7',$4,3,'live','urn:li:organization:100','provider_acknowledged','urn:li:share:100',
      'https://www.linkedin.com/feed/update/urn:li:share:100/',$5,$6::jsonb,$7::jsonb,$8,$9,$9,'synthetic-owner')`,
      [
        id.evidence,
        id.linkedin,
        id.contribution,
        id.delivery,
        message,
        JSON.stringify(socialSources),
        JSON.stringify(socialMedia),
        fingerprint({ message, sources: socialSources, media: socialMedia }),
        knownAt
      ]
    );
    await pool.query(
      "UPDATE sponsorship_obligations SET state='fulfilled',version=2,fulfilment_evidence_id=$2 WHERE id=$1",
      [id.linkedin, id.evidence]
    );
    await pool.query(
      `INSERT INTO sponsorship_website_exposure_observations(id,obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,observed_at,actor)
    VALUES($1,$2,$3,1,$4,$5,$6::jsonb,$7::jsonb,$8,'synthetic-owner')`,
      [
        id.start,
        id.website,
        id.contribution,
        fingerprint(websiteContent),
        websiteContent.message,
        JSON.stringify(websiteContent.sources),
        JSON.stringify(websiteContent.media),
        knownAt
      ]
    );
    await pool.query(
      `INSERT INTO sponsorship_commitment_changes(id,request_id,request_fingerprint,commitment_id,kind,actor,reason,evidence_reference,previous_value,resulting_value,created_at)
    VALUES($1,$2,$3,$4,'qualification','synthetic-owner','Documented synthetic terms','Synthetic historical agreement',
      '{"state":"needs_confirmation"}'::jsonb,$5::jsonb,$6)`,
      [
        id.change,
        randomUUID(),
        fingerprint(offer),
        id.commitment,
        JSON.stringify({ state: 'active', offerId: id.offer }),
        knownAt
      ]
    );
    await pool.query(
      `INSERT INTO sponsorship_historical_evidence_reviews(id,evidence_id,request_id,request_fingerprint,review_version,conclusion,reason,actor,reviewed_at)
    VALUES($1,$2,$3,$4,1,'confirmed','Synthetic historical review, no new send','synthetic-owner',$5)`,
      [
        id.review,
        id.evidence,
        randomUUID(),
        fingerprint({ evidence: id.evidence }),
        knownAt
      ]
    );

    const oldTables = await tables(pool);
    const before = Object.fromEntries(
      await Promise.all(
        oldTables.map(async (name) => [name, await rows(pool, name)])
      )
    );
    assert.deepEqual(
      before.sponsorship_obligations.map(({ state }) => state).sort(),
      ['fulfilled', 'pending']
    );
    assert.equal(before.sponsorship_website_exposure_observations.length, 1);
    assert.deepEqual(before.sponsorship_obligation_duration_attestations, []);
    const role = 'og7_observability_upgrade_test';
    const name = (await pool.query('SELECT current_database() AS name')).rows[0]
      .name;
    const config = {
      role,
      database: name,
      password: randomBytes(32).toString('hex')
    };
    await pool.query(buildRuntimeRoleSql(config, { create: true }));
    const oldPrivileges = await privileges(pool, role, oldTables);

    await t.test(
      'additive migrations preserve every old row and infer no provider identity or new delivery',
      async () => {
        for (const migration of [
          '053_publication_provider_media_evidence.sql',
          '054_sponsorship_public_visibility_observations.sql'
        ]) {
          await pool.query(
            await readFile(new URL(migration, directory), 'utf8')
          );
        }
        assert.deepEqual(
          await tables(pool),
          [
            ...oldTables,
            'sponsorship_public_visibility_observations',
            'sponsorship_public_visibility_worker'
          ].sort()
        );
        for (const table of oldTables)
          assert.deepEqual(await rows(pool, table, true), before[table], table);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT id,provider_media_ids FROM sponsorship_fulfilment_evidence'
            )
          ).rows,
          [{ id: id.evidence, provider_media_ids: [] }]
        );
        assert.deepEqual(
          await rows(pool, 'sponsorship_public_visibility_observations'),
          []
        );
        assert.deepEqual(
          await rows(pool, 'sponsorship_public_visibility_worker'),
          [{ id: true, cursor_obligation_id: null, last_claimed_at: null }]
        );
        assert.deepEqual(
          await privileges(pool, role, oldTables),
          oldPrivileges
        );
        const newPrivileges = await privileges(pool, role, [
          'sponsorship_public_visibility_observations',
          'sponsorship_public_visibility_worker'
        ]);
        assert.ok(
          newPrivileges.every((row) => !row.table_grant && !row.column_grant),
          'migrations do not silently grant new runtime rights'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sum(amount)::text AS gross,sum(net)::text AS net FROM fund_transactions'
            )
          ).rows[0].gross,
          '50000'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sum(amount)::text AS gross,sum(net)::text AS net FROM fund_transactions'
            )
          ).rows[0].net,
          '48500'
        );
      }
    );

    await t.test(
      'legacy source pairing and immutable evidence constraints still reject unsafe changes',
      async () => {
        await assert.rejects(
          pool.query(
            'UPDATE publication_deliveries SET media_id=NULL WHERE id=$1',
            [id.delivery]
          ),
          { code: '23514' }
        );
        for (const table of [
          'sponsorship_offers',
          'sponsorship_commitment_changes',
          'sponsorship_fulfilment_evidence',
          'sponsorship_website_exposure_observations',
          'sponsorship_historical_evidence_reviews'
        ]) {
          await assert.rejects(pool.query(`DELETE FROM ${table}`), {
            code: '23514'
          });
        }
        await assert.rejects(
          pool.query(
            "UPDATE sponsorship_fulfilment_evidence SET provider_media_ids='[]'::jsonb WHERE id=$1",
            [id.evidence]
          ),
          { code: '23514' }
        );
        for (const invalidIds of [
          '{}',
          '[17]',
          '["urn:li:video:historical_cache"]'
        ]) {
          await assert.rejects(
            pool.query(
              `INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,
        mode,account_id,provenance,message,source_snapshot,media_snapshot,content_fingerprint,delivered_at,actor,provider_media_ids)
        VALUES($1,$2,1,'website','openg7','live','openg7','website_verified',$3,$4::jsonb,$5::jsonb,$6,$7,'synthetic-owner',$8::jsonb)`,
              [
                id.website,
                id.contribution,
                websiteContent.message,
                JSON.stringify(websiteContent.sources),
                JSON.stringify(websiteContent.media),
                fingerprint(websiteContent),
                knownAt,
                invalidIds
              ]
            ),
            { code: '23514' }
          );
        }
        // Exercise new checks with native SQL, without persisting a sampled HTTP fact.
        const insert = `INSERT INTO sponsorship_public_visibility_observations(request_id,obligation_id,contribution_id,start_observation_id,
      obligation_version,content_fingerprint,started_at,checked_at,status,reason,request_count,next_directory_page)
      VALUES($1,$2,$3,$4,1,$5,$6,$6,$7,$8,$9,1)`;
        const parameters = [
          randomUUID(),
          id.website,
          id.contribution,
          id.start,
          fingerprint(websiteContent),
          knownAt,
          'visible',
          'MATCH',
          1
        ];
        await assert.rejects(
          pool.query(insert, [
            ...parameters.slice(0, 6),
            'visible',
            'HTTP_ERROR',
            1
          ]),
          { code: '23514' }
        );
        await assert.rejects(
          pool.query(insert, [...parameters.slice(0, 8), 49]),
          { code: '23514' }
        );
        await assert.rejects(
          pool.query(insert, [
            parameters[0],
            id.linkedin,
            ...parameters.slice(2)
          ]),
          { code: '23503' }
        );
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(insert, parameters);
          await assert.rejects(
            client.query(
              "UPDATE sponsorship_public_visibility_observations SET reason='HTTP_ERROR',status='unknown'"
            ),
            { code: '23514' }
          );
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        assert.deepEqual(
          await rows(pool, 'sponsorship_public_visibility_observations'),
          []
        );
        for (const table of oldTables)
          assert.deepEqual(await rows(pool, table, true), before[table], table);
      }
    );

    await t.test(
      'explicit grant refresh adds append-only observations while preserving existing least privilege',
      async () => {
        await pool.query(buildRuntimeRoleSql(config));
        runtime = new pg.Pool({
          ...pool.options,
          user: role,
          password: config.password
        });
        await assertProductionDatabasePrivileges(runtime, true);
        assert.deepEqual(
          await privileges(pool, role, oldTables),
          oldPrivileges
        );
        const observationPrivileges = await privileges(pool, role, [
          'sponsorship_public_visibility_observations'
        ]);
        assert.deepEqual(
          observationPrivileges.map(
            ({ privilege, table_grant, column_grant }) => [
              privilege,
              table_grant,
              column_grant
            ]
          ),
          [
            ['DELETE', false, false],
            ['INSERT', true, true],
            ['REFERENCES', false, false],
            ['SELECT', true, true],
            ['UPDATE', false, false]
          ]
        );
        await runtime.query(
          'SELECT * FROM sponsorship_public_visibility_observations'
        );
        await assert.rejects(
          runtime.query(
            "UPDATE sponsorship_public_visibility_observations SET reason='HTTP_ERROR'"
          ),
          { code: '42501' }
        );
        await assert.rejects(
          runtime.query(
            'DELETE FROM sponsorship_public_visibility_observations'
          ),
          { code: '42501' }
        );
        await runtime.query(
          'UPDATE sponsorship_public_visibility_worker SET cursor_obligation_id=$1 WHERE id=TRUE',
          [id.website]
        );
        await assert.rejects(
          runtime.query('DELETE FROM sponsorship_public_visibility_worker'),
          { code: '42501' }
        );
        await assert.rejects(
          runtime.query(
            'ALTER TABLE sponsorship_public_visibility_worker ADD COLUMN unsafe TEXT'
          ),
          { code: '42501' }
        );
        await runtime.query(
          'UPDATE sponsorship_public_visibility_worker SET cursor_obligation_id=NULL WHERE id=TRUE'
        );
        for (const table of oldTables)
          assert.deepEqual(await rows(pool, table, true), before[table], table);
        assert.deepEqual(
          await rows(pool, 'sponsorship_public_visibility_observations'),
          []
        );
        assert.deepEqual(
          await rows(pool, 'sponsorship_public_visibility_worker'),
          [{ id: true, cursor_obligation_id: null, last_claimed_at: null }]
        );
      }
    );
  }
);
