import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { createSponsorshipOfferSnapshot } from '../../dist/packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments.repository.js';
import { qualifySponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { listSponsorshipFulfilmentEvidence } from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor
} from './support/moderation-fixture.mjs';

test(
  'website fulfils only the recorded required elements actually displayed with current website rights',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#345678' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const objects = new Map();
    const storage = {
      readPrivateObject: async (key) => objects.get(key) ?? null
    };
    const rights = (channels) => ({
      state: 'confirmed',
      channels,
      targets: ['openg7'],
      transformations: ['technical'],
      credit: null,
      restrictions: null
    });
    const version = async (id) =>
      (
        await pool.query(
          'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].version;
    const command = async (id) => ({
      contributionId: id,
      expectedVersion: await version(id),
      visible: true,
      confirmed: true
    });
    const seed = async ({ requiredLogo, logoChannels }) => {
      const session = 'cs_website_requirements_' + randomUUID();
      const company = 'Synthetic required elements ' + randomUUID();
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions
          (contribution_type,amount_cents,currency,status,paid_at,stripe_session_id,
          sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
          VALUES('sponsorship_interest',5000,'cad','paid',NOW(),$1,$2,
          'Synthetic public presentation',TRUE,'approved',TRUE) RETURNING id`,
          [session, company]
        )
      ).rows[0].id;
      await withPostgresTransaction(pool, async (db) => {
        await activateSponsorshipCommitments(db, {
          stripeSessionId: session
        });
        const current = createSponsorshipOfferSnapshot(5000, 'CAD');
        await qualifySponsorshipCommitment(
          db,
          {
            requestId: randomUUID(),
            contributionId: id,
            expectedVersion: 1,
            confirmation: id,
            reason: 'Synthetic recorded website agreement',
            evidenceReference: 'synthetic://website-required-elements',
            offer: {
              ...current,
              version: 'historical-qualification-v1',
              benefits: current.benefits.map((benefit) => ({
                ...benefit,
                requiredElements: [
                  ...benefit.requiredElements,
                  ...(requiredLogo ? ['approved_logo'] : [])
                ]
              }))
            }
          },
          fixtureModerationActor
        );
      });
      const insertMedia = async (kind, channels) => {
        const key = 'synthetic-website/' + id + '/' + kind;
        const media = (
          await pool.query(
            `INSERT INTO sponsor_media_assets
            (contribution_id,kind,review_status,original_filename,original_mime_type,
            original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,
            public_url,checksum_sha256,width,height,alt_text,usage_rights)
            VALUES($1,$2,'approved','synthetic.webp','image/webp',$3,$4,$3,$4,
            '/api/public/sponsor-media/'||gen_random_uuid(),$5,40,30,'Synthetic source',$6::jsonb) RETURNING id`,
            [
              id,
              kind,
              bytes.length,
              key,
              checksum,
              JSON.stringify(rights(channels))
            ]
          )
        ).rows[0].id;
        objects.set(key, bytes);
        await approveFixtureSubject(pool, { type: 'media', id: media });
        return media;
      };
      const presentation = await insertMedia('supporting_image', ['website']);
      const logo = logoChannels
        ? await insertMedia('logo', logoChannels)
        : null;
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return { id, company, presentation, logo };
    };

    const required = await seed({
      requiredLogo: true,
      logoChannels: ['facebook']
    });
    await t.test(
      'a required logo approved only for Facebook cannot fulfil a Website promise when the legacy logo field is null',
      async () => {
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_logo_url FROM fund_contributions WHERE id=$1',
              [required.id]
            )
          ).rows[0].sponsor_logo_url,
          null
        );
        const obligation = (await loadSponsorshipCommitment(pool, required.id))
          .obligations[0];
        assert.equal(obligation.state, 'blocked');
        assert.equal(obligation.blockedReason, 'required_elements_missing');
        await assert.rejects(
          setSponsorshipWebsiteVisibility(
            pool,
            await command(required.id),
            fixtureModerationActor,
            storage
          ),
          { code: 'REQUIRED_ELEMENTS_MISSING', status: 409 }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_site_visibility_held AS held FROM fund_contributions WHERE id=$1',
              [required.id]
            )
          ).rows[0].held,
          true
        );
        assert.deepEqual(
          await listSponsorshipFulfilmentEvidence(pool, required.id),
          []
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='sponsorship_website.visibility'",
              [required.id]
            )
          ).rows[0].count,
          0
        );
      }
    );

    await t.test(
      'qualifying the same owned logo for Website permits fulfilment and records the exact publicly displayed logo',
      async () => {
        await pool.query(
          'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1',
          [required.logo, JSON.stringify(rights(['website', 'facebook']))]
        );
        await approveFixtureSubject(pool, { type: 'media', id: required.logo });
        await approveFixtureSubject(pool, {
          type: 'sponsorship',
          id: required.id
        });
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await command(required.id),
            fixtureModerationActor,
            storage
          ),
          'updated'
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, required.id)).obligations[0]
            .state,
          'fulfilled'
        );
        const evidence = await listSponsorshipFulfilmentEvidence(
          pool,
          required.id
        );
        assert.equal(evidence.length, 1);
        const snapshot = (
          await pool.query(
            'SELECT source_snapshot,media_snapshot FROM sponsorship_fulfilment_evidence WHERE id=$1',
            [evidence[0].id]
          )
        ).rows[0];
        assert.deepEqual(
          snapshot.media_snapshot.map((media) => media.id),
          [required.presentation, required.logo]
        );
        const profile = (await listPublicSponsorships(pool)).sponsorships.find(
          (item) => item.company_name === required.company
        );
        assert.ok(profile);
        assert.equal(
          profile.logo_url,
          '/api/public/sponsor-media/' + required.logo
        );
        assert.equal(snapshot.source_snapshot[0].logo_url, profile.logo_url);
      }
    );

    await t.test(
      'the current offer without a required logo still fulfils with its approved presentation alone',
      async () => {
        const optional = await seed({ requiredLogo: false });
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await command(optional.id),
            fixtureModerationActor,
            storage
          ),
          'updated'
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, optional.id)).obligations[0]
            .state,
          'fulfilled'
        );
        assert.equal(
          (await listSponsorshipFulfilmentEvidence(pool, optional.id)).length,
          1
        );
      }
    );
  }
);
