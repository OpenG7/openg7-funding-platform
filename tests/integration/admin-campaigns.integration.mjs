import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { AdminCampaignsService } from '../../dist/apps/funding-api/src/admin-campaigns.service.js';
import { createAdminCampaignsHttpHandler } from '../../dist/apps/funding-api/src/admin-campaigns.http.js';
import { AdminPreparationService } from '../../dist/apps/funding-api/src/admin-preparation.service.js';
import { createAdminAuthorization } from '../../dist/apps/funding-api/src/admin-authorization.js';
import { adminRoleAllows } from '../../dist/apps/funding-api/src/admin-identity.js';
import { createHttpTransport } from '../../dist/apps/funding-api/src/http-transport.js';
import { createAdminPublicationDraftOnConnection } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  capturePublicationObligations,
  recordSocialFulfilment
} from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const origin = 'https://synthetic-campaigns.invalid';
const actor = 'admin:00000000-0000-4000-8000-000000000004';
const query = (extra = {}) => ({
  page: 1,
  pageSize: 25,
  sort: 'preparation',
  direction: 'desc',
  ...extra
});

async function listen(pool) {
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: [origin]
  });
  const identity = (request) => {
    const role = request.headers['x-synthetic-role'];
    return ['reader', 'operator', 'owner'].includes(role)
      ? { id: 'synthetic-' + role, role }
      : null;
  };
  const authorization = createAdminAuthorization({
    adminIdentity: {
      identity,
      permits(request) {
        const account = identity(request);
        return Boolean(
          account &&
          adminRoleAllows(
            account.role,
            request.method,
            new URL(request.url, origin).pathname
          )
        );
      }
    },
    adminTokenConfigured: false,
    isProduction: true,
    hasDatabase: true,
    verifyAdminSession: () => null,
    adminTokenMatches: () => false,
    writeJson: transport.writeJson
  });
  const handler = createAdminCampaignsHttpHandler({
    publicBaseOrigin: origin,
    ...authorization,
    writeJson: transport.writeJson,
    campaigns: new AdminCampaignsService(pool)
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response)))
      transport.writeJson(request, response, 404, { code: 'NOT_FOUND' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    async request(suffix = '', role = 'reader', method = 'GET') {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/admin/campaigns${suffix}`,
        { method, headers: role ? { 'x-synthetic-role': role } : {} }
      );
      assert.match(response.headers.get('cache-control'), /no-store/);
      return { status: response.status, body: await response.json() };
    },
    stop: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

test(
  'campaigns read exact promises, current preparation and qualified delivery evidence without mutating dossiers',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    const http = await listen(pool);
    t.after(async () => {
      await http.stop();
      await stop();
    });
    const service = new AdminCampaignsService(pool);
    const preparations = new AdminPreparationService(pool);
    const seed = async (company, quantity, paidAt) => {
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
            sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
           VALUES('sponsorship_interest',50000,'CAD','paid',$2::timestamptz,$1,
            'Synthetic public presentation',TRUE,'approved',TRUE) RETURNING id`,
          [company, paidAt]
        )
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        channel: 'facebook',
        quantity
      });
      return id;
    };
    const upcoming = await seed(
      'Synthetic upcoming thirty passages',
      30,
      '2026-08-01T12:00:00Z'
    );
    const approved = await seed(
      'Synthetic approved campaign',
      1,
      '2026-01-01T12:00:00Z'
    );
    const unconfirmed = await seed(
      'Synthetic payment not yet confirmed',
      1,
      '2026-09-01T12:00:00Z'
    );
    await pool.query(
      "UPDATE fund_contributions SET status='pending',paid_at=NULL WHERE id=$1",
      [unconfirmed]
    );
    await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
      VALUES('personal_support',5000,'CAD','paid',NOW()),('sponsorship_interest',5000,'CAD','paid',NOW())`);
    await approveFixtureSubject(pool, { type: 'sponsorship', id: approved });
    await withPostgresTransaction(pool, (db) =>
      createAdminPublicationDraftOnConnection(
        db,
        { contributionId: approved, feedTarget: 'openg7', channel: 'facebook' },
        actor
      )
    );
    const approve = async () => {
      const receipt = await preparations.dossierPreparation(approved);
      assert.equal(receipt.canApprove, true);
      return preparations.approveDossierPreparation(
        {
          contributionId: approved,
          expectedVersion: receipt.version,
          requestId: randomUUID(),
          confirmed: true
        },
        actor
      );
    };
    await approve();

    const snapshot = async () => {
      const result = {};
      for (const table of [
        'fund_contributions',
        'sponsorship_obligations',
        'sponsor_publication_drafts',
        'publication_deliveries',
        'admin_preparation_approvals',
        'sponsorship_fulfilment_evidence',
        'email_messages',
        'admin_audit_log'
      ])
        result[table] = (
          await pool.query(`SELECT * FROM ${table} ORDER BY id`)
        ).rows;
      return result;
    };

    await t.test(
      'approvals sort globally before pagination, with every repeated future passage retained',
      async () => {
        const before = await snapshot();
        const first = await service.list(query());
        const second = await service.list(query({ page: 2 }));
        assert.equal(first.pagination.totalItems, 31);
        assert.equal(first.pagination.totalPages, 2);
        assert.equal(first.items.length, 25);
        assert.equal(first.items[0].contributionId, approved);
        assert.equal(first.items[0].preparation.status, 'approved');
        assert.equal(second.items.length, 6);
        const combined = [...first.items, ...second.items];
        assert.equal(new Set(combined.map((item) => item.id)).size, 31);
        const future = combined.filter(
          (item) => item.contributionId === upcoming
        );
        assert.equal(future.length, 30);
        assert.deepEqual(
          future.map((item) => item.ordinal).sort((a, b) => a - b),
          Array.from({ length: 30 }, (_, i) => i + 1)
        );
        assert.ok(
          future.every(
            (item) =>
              item.quantity === 30 &&
              item.proof === null &&
              item.preparation.status === 'incomplete'
          )
        );
        assert.ok(
          !combined.some((item) => item.contributionId === unconfirmed)
        );
        assert.equal(
          (await service.list(query({ search: 'Synthetic approved campaign' })))
            .pagination.totalItems,
          1
        );
        assert.equal(
          (await service.list(query({ target: 'openg20' }))).pagination
            .totalItems,
          0
        );
        assert.equal(
          (await service.list(query({ search: "%' OR TRUE--" }))).pagination
            .totalItems,
          0
        );
        assert.equal(
          (await service.list(query({ sort: 'paid_at', direction: 'desc' })))
            .items[0].contributionId,
          upcoming
        );
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'dossier handoffs isolate promises and resolve the twenty-sixth passage before pagination',
      async () => {
        const before = await snapshot();
        const target = (
          await pool.query(
            'SELECT id FROM sponsorship_obligations WHERE contribution_id=$1 AND ordinal=26',
            [upcoming]
          )
        ).rows[0].id;
        const broad = await service.list(query());
        assert.equal(
          broad.items.some((item) => item.id === target),
          false
        );

        const first = await http.request(`?sponsorshipId=${upcoming}`);
        const second = await http.request(`?sponsorshipId=${upcoming}&page=2`);
        assert.equal(first.status, 200);
        assert.equal(first.body.pagination.totalItems, 30);
        assert.equal(first.body.items.length, 25);
        assert.equal(second.body.items.length, 5);
        assert.ok(
          [...first.body.items, ...second.body.items].every(
            (item) => item.contributionId === upcoming
          )
        );

        const suffix = `?sponsorshipId=${upcoming}&obligationId=${target}`;
        for (const role of ['reader', 'operator', 'owner']) {
          const exact = await http.request(suffix, role);
          assert.equal(exact.status, 200);
          assert.equal(exact.body.pagination.totalItems, 1);
          assert.equal(exact.body.pagination.totalPages, 1);
          assert.equal(exact.body.items[0].id, target);
          assert.equal(exact.body.items[0].ordinal, 26);
          assert.equal(exact.body.items[0].contributionId, upcoming);
        }
        for (const emptyScope of [
          `?sponsorshipId=${approved}&obligationId=${target}`,
          `?sponsorshipId=${randomUUID()}`,
          `?sponsorshipId=${upcoming}&obligationId=${randomUUID()}`,
          `?sponsorshipId=${unconfirmed}`,
          suffix + '&channel=website'
        ]) {
          const empty = await http.request(emptyScope);
          assert.equal(empty.status, 200);
          assert.equal(empty.body.pagination.totalItems, 0);
          assert.deepEqual(empty.body.items, []);
        }
        assert.equal((await http.request(suffix, null)).status, 401);
        assert.equal(
          (await http.request('?sponsorshipId=invalid', null)).status,
          401
        );
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'a stale approval returns to review while its promises remain visible',
      async () => {
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body=body || ' Synthetic revision',updated_at=clock_timestamp() WHERE contribution_id=$1",
          [approved]
        );
        const response = await service.list(
          query({ search: 'Synthetic approved campaign' })
        );
        assert.equal(response.items.length, 1);
        assert.equal(response.items[0].preparation.status, 'review_required');
        assert.equal(response.items[0].preparation.approvedAt, null);
        assert.equal(response.items[0].proof, null);
        await approve();
      }
    );

    const delivery = async (mode) => {
      const draft = (
        await pool.query(
          'SELECT * FROM sponsor_publication_drafts WHERE contribution_id=$1',
          [approved]
        )
      ).rows[0];
      const batch = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',1,'open') RETURNING id"
        )
      ).rows[0].id;
      await pool.query(
        'UPDATE sponsor_publication_drafts SET batch_id=$2 WHERE id=$1',
        [draft.id, batch]
      );
      const sources = [
        { ...draft, name: 'Synthetic approved campaign', batch_id: batch }
      ];
      const message = composePublicationRecognition(
        sources.map((source) => ({
          id: source.id,
          contributionId: source.contribution_id,
          name: source.name,
          title: source.title,
          body: source.body,
          disclosureText: source.disclosure_text
        }))
      );
      const row = (
        await pool.query(
          `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,source_snapshot,account_id,mode)
           VALUES('openg7:facebook','sponsorship',$1,$2,NOW(),$3::jsonb,'synthetic-campaign-page',$4) RETURNING *`,
          [batch, message, JSON.stringify(sources), mode]
        )
      ).rows[0];
      row.obligation_snapshot = await withPostgresTransaction(pool, (db) =>
        capturePublicationObligations(db, row)
      );
      await pool.query(
        'UPDATE publication_deliveries SET obligation_snapshot=$2::jsonb WHERE id=$1',
        [row.id, JSON.stringify(row.obligation_snapshot)]
      );
      await withPostgresTransaction(pool, (db) =>
        recordSocialFulfilment(
          db,
          row,
          'synthetic-post-' + row.id,
          'https://www.facebook.com/synthetic-post-' + row.id,
          actor,
          'provider_acknowledged'
        )
      );
      await pool.query(
        "UPDATE publication_deliveries SET status='published',published_at=NOW() WHERE id=$1",
        [row.id]
      );
      return row;
    };

    await t.test(
      'simulation remains unfulfilled and only qualified live evidence completes its exact passage',
      async () => {
        await delivery('mock');
        let item = (
          await service.list(query({ search: 'Synthetic approved campaign' }))
        ).items[0];
        assert.equal(item.proof, null);
        assert.equal(item.obligationState, 'pending');
        assert.notEqual(item.workflow.state, 'complete');
        const live = await delivery('live');
        const before = await snapshot();
        item = (
          await service.list(query({ search: 'Synthetic approved campaign' }))
        ).items[0];
        assert.equal(item.obligationState, 'fulfilled');
        assert.equal(item.workflow.state, 'complete');
        assert.equal(item.proof.obligationId, item.id);
        assert.equal(item.proof.deliveryId, live.id);
        assert.equal(
          item.proof.obligationVersion,
          live.obligation_snapshot[0].version
        );
        assert.equal(item.proof.deliveryVersion, live.version);
        const currentObligation = (
          await pool.query(
            'SELECT version FROM sponsorship_obligations WHERE id=$1::uuid',
            [item.id]
          )
        ).rows[0];
        assert.equal(
          currentObligation.version,
          item.proof.obligationVersion + 1
        );
        assert.equal(item.proof.provenance, 'provider_acknowledged');
        assert.equal(item.preparation.status, 'review_required');
        assert.deepEqual(await snapshot(), before);
        await pool.query(
          "UPDATE fund_contributions SET status='refunded',public_display_consent=FALSE WHERE id=$1",
          [approved]
        );
        item = (
          await service.list(query({ search: 'Synthetic approved campaign' }))
        ).items[0];
        assert.equal(item.proof.deliveryId, live.id);
        assert.equal(item.workflow.state, 'complete');
      }
    );

    await t.test(
      'HTTP reads require an administrative session and reject malformed filters and mutations',
      async () => {
        assert.equal((await http.request()).status, 200);
        assert.equal((await http.request('', null)).status, 401);
        assert.equal((await http.request('', 'owner', 'POST')).status, 405);
        for (const suffix of [
          '?page=0',
          '?pageSize=500',
          '?channel=instagram',
          '?target=other',
          '?sort=amount',
          '?page=1&page=2',
          '?sponsorshipId=',
          '?sponsorshipId=invalid',
          `?sponsorshipId=${approved}&sponsorshipId=${upcoming}`,
          `?obligationId=${randomUUID()}`,
          `?sponsorshipId=${approved}&obligationId=invalid`,
          '?unknown=1'
        ])
          assert.equal((await http.request(suffix)).status, 400, suffix);
        const response = await http.request(
          '?channel=facebook&search=Synthetic%20approved%20campaign'
        );
        assert.equal(response.status, 200);
        assert.equal(response.body.items.length, 1);
        assert.equal(response.body.items[0].proof.deliveryId !== null, true);
        assert.equal(
          Number.isSafeInteger(response.body.items[0].proof.obligationVersion),
          true
        );
        assert.equal(
          Number.isSafeInteger(response.body.items[0].proof.deliveryVersion),
          true
        );
        const privateResponse = JSON.stringify(response.body);
        assert.equal(privateResponse.includes('source_snapshot'), false);
        assert.equal(privateResponse.includes('obligation_snapshot'), false);
        assert.equal(privateResponse.includes('request_hash'), false);
      }
    );
  }
);
