import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { startDisposablePostgres } from './disposable-postgres.mjs';
import { PublicationAutomationService } from '../../../dist/apps/funding-api/src/publication-automation/service.js';
import { approveFixtureSubject } from './moderation-fixture.mjs';
import { recordFixtureSponsorshipAgreement } from './sponsorship-agreement-fixture.mjs';
import { waitForFixtureAccountCooldown } from './publication-account-cooldown-fixture.mjs';

// Private fixtures for publication-worker-claims.integration.mjs.
export function gate() {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  return {
    entered: entered.promise,
    resume: released.resolve,
    async pause(value) {
      entered.resolve(value);
      await released.promise;
    }
  };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Worker did not reach its pause.')),
          5000
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The real COMMIT finishes before the wrapper pauses its response. No row lock
// or open transaction is held while another worker expires/reclaims the delivery.
export function poolPausedAfterClaim(pool, pause) {
  let suspended = false;
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      let claim = null;
      return {
        async query(sql, ...args) {
          const result = await client.query(sql, ...args);
          if (sql.includes("SET status='publishing',attempts=attempts+1")) {
            claim = result.rows[0];
          }
          if (sql === 'COMMIT' && claim && !suspended) {
            suspended = true;
            await pause.pause(claim);
          }
          return result;
        },
        release: () => client.release()
      };
    }
  };
}

export async function withPausedTick(service, due, pause, check) {
  const running = service.tick(due);
  // The test awaits the task below, including when waiting for the pause fails.
  void running.catch(() => {});
  try {
    const value = await bounded(
      Promise.race([
        pause.entered,
        running.then(() => {
          throw new Error('Worker finished before its expected pause.');
        })
      ])
    );
    await check(value, running);
  } finally {
    pause.resume();
    await running;
  }
}

export async function createPublicationWorkerClaimsFixture(t) {
  const database = await startDisposablePostgres();
  t.after(database.stop);
  const pool = database.pool;
  const facebookFeed = 'openg20:facebook';
  const linkedinFeed = 'openg20:linkedin';
  const facebookBase = 'https://publication-worker.test/facebook';
  const linkedinBase = 'https://publication-worker.test/linkedin';
  const env = {
    SOCIAL_PUBLICATION_MODE: 'live',
    SOCIAL_PUBLICATION_WORKER_ENABLED: 'true',
    SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL: facebookBase,
    SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL: linkedinBase,
    SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20',
    SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN:
      'synthetic-facebook-credential',
    SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCOUNT_ID: '20',
    SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCESS_TOKEN:
      'synthetic-linkedin-credential'
  };
  let imageBytes = null;
  const storage = { readPrivateObject: async () => imageBytes };
  const serviceFor = (source = pool) =>
    new PublicationAutomationService(source, storage, env);
  const service = serviceFor();

  async function reset() {
    await pool.query(
      'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
    );
    await pool.query(
      "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,connection='unchecked',checked_at=NULL,account_fingerprint=NULL,last_prepared_at=NULL"
    );
    await pool.query(
      'UPDATE publication_worker_settings SET enabled=TRUE,version=1'
    );
    imageBytes = null;
  }

  // Every fetch is intercepted; even the live-mode payload/projection tests can
  // never reach a real provider. Unrecognized requests also fail the test after
  // the worker's provider-error handling, rather than being swallowed there.
  function provider(st, respond) {
    const calls = [];
    const unexpected = [];
    st.mock.method(globalThis, 'fetch', async (url, init = {}) => {
      const request = {
        url: String(url),
        method: init.method ?? 'GET',
        init
      };
      if (
        request.method === 'GET' &&
        request.url === `${facebookBase}/me?fields=id`
      ) {
        return Response.json({ id: '20' });
      }
      if (
        request.method === 'GET' &&
        request.url ===
          `${linkedinBase}/organizationAcls?q=roleAssignee&state=APPROVED`
      ) {
        return Response.json({
          elements: [
            { organization: 'urn:li:organization:20', role: 'ADMINISTRATOR' }
          ]
        });
      }
      calls.push(request);
      const response = await respond(request, calls.length);
      if (!response) {
        unexpected.push({ url: request.url, method: request.method });
        throw new Error('Unexpected simulated provider request.');
      }
      return response;
    });
    st.after(() => assert.deepEqual(unexpected, []));
    return calls;
  }

  async function activate(feedId = facebookFeed) {
    await service.command({ action: 'check', feedId }, 'claim-tester');
    const feed = (await service.feeds()).find((f) => f.id === feedId);
    assert.equal(feed.connection, 'ready');
    await service.command(
      { action: 'settings', settings: { ...feed, paused: false } },
      'claim-tester'
    );
  }

  async function record(id) {
    return (
      await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [id])
    ).rows[0];
  }

  async function audits(id, action) {
    return (
      await pool.query(
        'SELECT actor,action,metadata FROM admin_audit_log WHERE entity_id=$1 AND action=$2 ORDER BY created_at,id',
        [id, `publication_automation.${action}`]
      )
    ).rows;
  }

  async function approve(id) {
    await approveFixtureSubject(pool, { type: 'publication_delivery', id });
    const row = await record(id);
    await service.command(
      { action: 'approve', id, version: row.version, confirmation: id },
      'claim-tester'
    );
  }

  async function compose({
    batch = false,
    mediaId = null,
    feedId = facebookFeed
  } = {}) {
    const scheduledAt = new Date(Date.now() + 60000).toISOString();
    let batchId;
    if (batch) {
      const contributionId = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_feed_target,sponsor_feed_channels)
       VALUES($1,'sponsorship_interest',50000,'paid',TRUE,'approved','Claim fence fixture','openg20','["facebook"]')`,
        [contributionId]
      );
      await recordFixtureSponsorshipAgreement(pool, contributionId, {
        channel: 'facebook',
        target: 'openg20'
      });
      await approveFixtureSubject(pool, {
        type: 'sponsorship',
        id: contributionId
      });
      const slot = (
        await pool.query(
          "INSERT INTO publication_slots(feed_target,channel,starts_at,capacity,status) VALUES('openg20','facebook',$1,1,'scheduled') RETURNING id",
          [scheduledAt]
        )
      ).rows[0];
      batchId = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity,status,scheduled_at,slot_id) VALUES('facebook',1,'open',$1,$2) RETURNING id",
          [scheduledAt, slot.id]
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,batch_id,slot_id)
       VALUES($1,'openg20','facebook','Approved fixture sponsor','Approved fixture summary','Paid sponsorship.',$2,$3)`,
        [contributionId, batchId, slot.id]
      );
    }
    const { id } = await service.command(
      {
        action: 'compose',
        feedId,
        kind: batch ? 'sponsorship' : 'news',
        batchId,
        message: batch ? undefined : 'Exact claim fence message',
        scheduledAt,
        mediaId
      },
      'claim-tester'
    );
    await approve(id);
    return { id, due: new Date(Date.parse(scheduledAt) + 1000) };
  }

  async function expire(id) {
    assert.equal(
      (
        await pool.query(
          "UPDATE publication_deliveries SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1 AND status='publishing'",
          [id]
        )
      ).rowCount,
      1
    );
  }

  async function quarantine(id, due) {
    await expire(id);
    await serviceFor().tick(due);
    const row = await record(id);
    assert.equal(row.status, 'uncertain');
    assert.equal(row.error_code, 'LEASE_EXPIRED');
    return row;
  }

  async function reapprove(id) {
    let row = await record(id);
    await service.command(
      {
        action: 'confirm-absent',
        id,
        version: row.version,
        confirmation: id,
        reason:
          'Synthetic operator reviewed the account history and confirmed no post.'
      },
      'claim-tester'
    );
    row = await record(id);
    assert.equal(row.approved_at, null);
    const scheduledAt = new Date(Date.now() + 60000).toISOString();
    await service.command(
      {
        action: 'edit',
        id,
        version: row.version,
        message: row.batch_id
          ? `${row.message}\n\nReauthorized after review.`
          : 'New exact approved message',
        scheduledAt,
        mediaId: row.media_id
      },
      'claim-tester'
    );
    await approve(id);
    // Live dispatch spacing uses the database clock. These synthetic-provider
    // fencing scenarios wait for that real bound rather than rewriting the bail
    // or letting the injected worker date bypass the account cooldown.
    await waitForFixtureAccountCooldown(pool, id);
    return new Date(Date.parse(scheduledAt) + 1000);
  }

  async function projections(id) {
    const row = await record(id);
    return {
      batch: (
        await pool.query(
          'SELECT * FROM sponsor_publication_batches WHERE id=$1',
          [row.batch_id]
        )
      ).rows,
      drafts: (
        await pool.query(
          'SELECT * FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id',
          [row.batch_id]
        )
      ).rows,
      slot: (
        await pool.query(
          'SELECT * FROM publication_slots WHERE id=(SELECT slot_id FROM sponsor_publication_batches WHERE id=$1)',
          [row.batch_id]
        )
      ).rows
    };
  }

  const facebookSuccess = (request, number) =>
    request.method === 'POST' && request.url === `${facebookBase}/20/feed`
      ? Response.json({ id: `20_${number}` })
      : null;

  async function createApprovedImage() {
    imageBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
    })
      .webp()
      .toBuffer();
    const contributionId = randomUUID();
    const mediaId = randomUUID();
    await pool.query(
      "INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name) VALUES($1,'sponsorship_interest',50000,'paid',TRUE,'approved','Synthetic image owner')",
      [contributionId]
    );
    await pool.query(
      `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text,usage_rights)
       VALUES($1,$2,'supporting_image','approved','fixture.webp','image/webp',$3,$4,$3,$5,$6,'https://example.test/fixture.webp',$7,2,2,'Synthetic approved image',
       '{"state":"confirmed","channels":["website","facebook","linkedin"],"targets":["openg7","openg20"],"transformations":["technical"],"credit":null,"restrictions":null}')`,
      [
        mediaId,
        contributionId,
        imageBytes.length,
        `${mediaId}/original`,
        `${mediaId}/processed`,
        `${mediaId}/public`,
        createHash('sha256').update(imageBytes).digest('hex')
      ]
    );
    await approveFixtureSubject(pool, {
      type: 'sponsorship',
      id: contributionId
    });
    await approveFixtureSubject(pool, { type: 'media', id: mediaId });
    return mediaId;
  }

  return {
    pool,
    service,
    serviceFor,
    reset,
    provider,
    activate,
    record,
    audits,
    compose,
    expire,
    quarantine,
    reapprove,
    projections,
    facebookSuccess,
    facebookFeed,
    facebookBase,
    linkedinFeed,
    linkedinBase,
    createApprovedImage
  };
}
