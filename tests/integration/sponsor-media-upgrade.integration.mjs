import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const directory = new URL(
  '../../apps/funding-api/migrations/',
  import.meta.url
);
const unknown = {
  state: 'needs_confirmation',
  channels: [],
  targets: [],
  transformations: [],
  credit: null,
  restrictions: null
};
const confirmed = {
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: 'Photographie : Atelier synthétique historique',
  restrictions: null
};

test(
  'upgrading an existing 059 database preserves historical media, rights, exact moderation and public selections without scheduling work',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    t.after(database.stop);
    const pool = database.pool;
    const migrations = (await readdir(directory))
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort();
    const number = (name) => Number(name.slice(0, 3));
    assert.ok(migrations.some((name) => number(name) === 59));
    assert.deepEqual(
      migrations
        .filter((name) => number(name) > 59 && number(name) <= 61)
        .map(number),
      [60, 61]
    );
    for (const file of migrations.filter((name) => number(name) <= 59))
      await pool.query(await readFile(new URL(file, directory), 'utf8'));

    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,sponsor_company_name,sponsor_review_status,public_display_consent)
    VALUES('sponsorship_interest',50000,'cad','paid','Synthetic historical workshop','approved',TRUE) RETURNING id`)
    ).rows[0].id;
    async function insertMedia(usage, approved = true) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,uploaded_by,
      original_filename,original_mime_type,original_size_bytes,original_storage_key,
      processed_size_bytes,processed_storage_key,checksum_sha256,width,height,alt_text,
      public_storage_key,public_url,usage_rights,usage_restrictions_reviewed,reviewed_at,reviewed_by)
      VALUES($1,$2,'supporting_image',$3,'admin','synthetic-historical.webp','image/webp',100,$4,
        80,$5,$6,100,80,'Synthetic historical workshop image',NULL,$7,$8::jsonb,FALSE,
        CASE WHEN $9::boolean THEN NOW() ELSE NULL END,CASE WHEN $9::boolean THEN 'synthetic-historical-reviewer' ELSE NULL END)`,
        [
          id,
          contributionId,
          approved ? 'approved' : 'pending_review',
          id + '/original.webp',
          id + '/processed.webp',
          'a'.repeat(64),
          approved ? '/api/public/sponsor-media/' + id : null,
          JSON.stringify(usage),
          approved
        ]
      );
      return id;
    }
    const historicalIds = [
      await insertMedia(unknown),
      await insertMedia(confirmed)
    ];
    await approveFixtureSubject(pool, { type: 'media', id: historicalIds[1] });
    const mediaFacts = async (stripWorkspaceFields = false) =>
      (
        await pool.query(
          `SELECT ${stripWorkspaceFields ? "to_jsonb(m)-'media_batch_id'-'usage_inheritance'-'website_selected'" : 'to_jsonb(m)'} AS facts,
      moderation_snapshot('media',m.id) AS snapshot
      FROM sponsor_media_assets m WHERE m.id=ANY($1::uuid[]) ORDER BY m.id`,
          [historicalIds]
        )
      ).rows;
    const evidence = async () =>
      (
        await pool.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM moderation_decisions d) AS decisions,
    (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM moderation_cases c) AS cases,
    (SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb) FROM moderation_content_versions v) AS versions,
    (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM admin_audit_log a) AS audit`)
      ).rows[0];
    const beforeFacts = await mediaFacts();
    const beforeEvidence = await evidence();
    assert.equal(beforeEvidence.decisions.length, 1);

    const migrationClient = await pool.connect();
    try {
      await migrationClient.query('BEGIN');
      for (const file of migrations.filter(
        (name) => number(name) > 59 && number(name) <= 61
      ))
        await migrationClient.query(
          await readFile(new URL(file, directory), 'utf8')
        );
      await migrationClient.query('COMMIT');
    } catch (error) {
      await migrationClient.query('ROLLBACK');
      throw error;
    } finally {
      migrationClient.release();
    }

    assert.deepEqual(await mediaFacts(true), beforeFacts);
    assert.deepEqual(await evidence(), beforeEvidence);
    const preserved = (
      await pool.query(
        `SELECT id,usage_inheritance,media_batch_id,website_selected,
    usage_rights,sponsor_media_effective_usage(id) AS effective FROM sponsor_media_assets WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [historicalIds]
      )
    ).rows;
    assert.ok(
      preserved.every(
        (row) =>
          row.usage_inheritance === 'legacy' &&
          row.media_batch_id === null &&
          row.website_selected === true
      )
    );
    for (const row of preserved)
      assert.deepEqual(row.effective, row.usage_rights);
    assert.deepEqual(
      preserved.find((row) => row.id === historicalIds[0]).effective,
      unknown
    );
    assert.deepEqual(
      preserved.find((row) => row.id === historicalIds[1]).effective,
      confirmed
    );
    const newTables = [
      'sponsor_media_workspaces',
      'sponsor_media_batches',
      'sponsor_media_rule_versions',
      'sponsor_media_workspace_commands',
      'sponsor_media_batch_plans',
      'sponsor_media_cleanup_jobs',
      'sponsor_media_analysis_runs',
      'sponsor_media_analysis_suggestions',
      'sponsor_media_analysis_reviews',
      'sponsor_media_analysis_requests'
    ];
    for (const table of newTables)
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
        0,
        table
      );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM publication_deliveries'
        )
      ).rows[0].n,
      0
    );

    const newId = await insertMedia(unknown, false);
    const current = (
      await pool.query(
        'SELECT review_status,public_url,website_selected,usage_inheritance,sponsor_media_effective_usage(id) AS usage FROM sponsor_media_assets WHERE id=$1',
        [newId]
      )
    ).rows[0];
    assert.deepEqual(current, {
      review_status: 'pending_review',
      public_url: null,
      website_selected: false,
      usage_inheritance: 'legacy',
      usage: unknown
    });
    assert.deepEqual(await evidence(), beforeEvidence);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM sponsor_media_analysis_runs'
        )
      ).rows[0].n,
      0
    );
  }
);
