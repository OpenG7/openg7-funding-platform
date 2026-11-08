import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import { loadAdminCampaignDeskSnapshot } from '../dist/apps/funding-api/src/admin-campaigns.service.js';
import { createHttpTransport } from '../dist/apps/funding-api/src/http-transport.js';
import { createPreflightDeskHttpHandler } from '../dist/apps/funding-api/src/preflight/desk-routes.js';
import {
  loadPreflightDeskOnClient,
  parsePreflightDeskQuery,
  preflightDeskStage,
  PreflightDeskService,
  projectPreflightDesk
} from '../dist/apps/funding-api/src/preflight/desk.js';
import { projectSponsorshipPublicationWorkflow } from '../dist/apps/funding-api/src/sponsorship-progress-workflow.js';

const at = new Date('2026-11-04T12:00:00Z');
const id = (value) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const query = { page: 1, pageSize: 20, stage: 'all' };

function row(value = 1, options = {}) {
  const contributionId = options.contributionId ?? id(1);
  return {
    amountMinor: '25000',
    currency: 'CAD',
    commitmentId: id(100),
    commitmentVersion: 1,
    authorizedDelivery: false,
    campaign: {
      id: id(value + 200),
      contributionId,
      reference: 'SYNTHETIC-ORDER',
      companyName: 'Synthetic company',
      paidAt: at.toISOString(),
      channel: 'facebook',
      target: 'openg7',
      ordinal: value,
      quantity: 10,
      format: 'collective_text',
      obligationState: 'pending',
      timing: null,
      preparation: {
        status: 'ready',
        version: 'synthetic-current',
        approvedAt: null,
        blockers: []
      },
      workflow: {
        obligationId: id(value + 200),
        channel: 'facebook',
        target: 'openg7',
        ordinal: value,
        state: 'action_required',
        reason: 'publication_preparation_required',
        responsibility: 'admin',
        deliveryId: null,
        scheduledAt: null
      },
      content: null,
      proof: null,
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}&tab=publication`,
      ...options.campaign
    },
    ...options
  };
}

test('desk stages keep preparation approval, authorization and qualified fulfilment separate', () => {
  const prepared = row(1);
  prepared.campaign.content = {
    title: 'Synthetic draft',
    body: 'Synthetic text'
  };
  prepared.campaign.preparation.status = 'approved';
  assert.equal(preflightDeskStage(prepared), 'to_review');
  const approved = row(2, { authorizedDelivery: true });
  assert.equal(preflightDeskStage(approved), 'to_deliver');
  const delivered = row(3);
  delivered.campaign.obligationState = 'fulfilled';
  delivered.campaign.workflow = {
    ...delivered.campaign.workflow,
    state: 'complete',
    reason: 'publication_done'
  };
  assert.notEqual(preflightDeskStage(delivered), 'delivered');
  delivered.campaign.proof = {
    id: id(500),
    obligationId: delivered.campaign.id,
    channel: 'facebook',
    target: 'openg7',
    provenance: 'provider_verified'
  };
  assert.equal(preflightDeskStage(delivered), 'delivered');
  const waived = row(4);
  waived.campaign.obligationState = 'adjusted';
  waived.campaign.workflow = {
    ...waived.campaign.workflow,
    state: 'complete',
    reason: 'obligation_adjusted'
  };
  const blocked = row(5);
  blocked.campaign.workflow = {
    ...blocked.campaign.workflow,
    state: 'uncertain',
    reason: 'publication_uncertain'
  };
  const result = projectPreflightDesk(
    [prepared, approved, delivered, waived, blocked],
    query,
    at.toISOString()
  );
  assert.deepEqual(result.summary, {
    total: 4,
    toPrepare: 1,
    toReview: 1,
    toDeliver: 1,
    delivered: 1,
    excludedAdjusted: 1,
    orders: 1,
    scope: 'recorded_promised_services',
    preflightLink: 'unverified'
  });
  assert.equal(result.orders[0].total, 4);
  assert.equal(result.orders[0].delivered, 1);
  assert.equal(
    result.orders[0].services.filter((item) => item.blocked).length,
    1
  );
  assert.ok(
    result.orders[0].services.every(
      (item) =>
        item.preparationOrigin === 'funding' &&
        item.preflightLink === 'unverified'
    )
  );
  assert.equal(
    result.orders[0].services[0].reviewUrl,
    `/admin/fundraiser/campaigns?sponsorshipId=${id(1)}&obligationId=${prepared.campaign.id}`
  );
});

test('desk summary covers the full search universe and stage filtering preserves complete groups', () => {
  const rows = Array.from({ length: 26 }, (_, n) =>
    row(n + 1, { contributionId: id(n + 1) })
  );
  const extra = row(70, { contributionId: id(1), authorizedDelivery: true });
  rows.push(extra);
  const page = projectPreflightDesk(
    rows,
    { ...query, pageSize: 10 },
    at.toISOString()
  );
  assert.equal(page.summary.total, 27);
  assert.equal(page.pagination.totalItems, 26);
  assert.equal(page.orders.length, 10);
  assert.equal(page.orders[0].services.length, 2);
  const filtered = projectPreflightDesk(
    rows,
    { ...query, stage: 'to_deliver' },
    at.toISOString()
  );
  assert.deepEqual(filtered.summary, page.summary);
  assert.equal(filtered.pagination.totalItems, 1);
  assert.equal(filtered.orders[0].services.length, 2);
  assert.equal(filtered.orders[0].total, 2);
  const last = projectPreflightDesk(
    rows,
    { ...query, page: 3, pageSize: 10 },
    at.toISOString()
  );
  assert.equal(last.orders.length, 6);
  assert.equal(last.pagination.hasNextPage, false);
  assert.equal(last.pagination.hasPreviousPage, true);
});

function source(quantity = 120) {
  const contributionId = id(1),
    commitmentId = id(100);
  return {
    contribution_id: contributionId,
    reference: 'SYNTHETIC',
    companyName: 'Synthetic',
    amount_minor: '25000',
    currency: 'CAD',
    paidAt: at.toISOString(),
    approval: null,
    commitment: {
      id: commitmentId,
      contributionId,
      version: 1,
      state: 'active',
      offerId: id(99),
      provenance: 'accepted_offer',
      offer: {
        benefits: [
          {
            id: 'collective_facebook',
            channel: 'facebook',
            target: 'openg7',
            quantity
          }
        ]
      },
      obligations: Array.from({ length: quantity }, (_, n) => ({
        id: id(n + 200),
        commitmentId,
        contributionId,
        benefitId: 'collective_facebook',
        channel: 'facebook',
        target: 'openg7',
        ordinal: n + 1,
        state: 'pending',
        version: 1,
        fulfilmentEvidenceId: null,
        blockedReason: null
      }))
    }
  };
}
function portsFor(item) {
  const calls = { sources: 0, preparation: 0, progress: 0 };
  const publication = {
    id: id(700),
    obligationId: item.commitment.obligations[0].id,
    deliveryId: id(701),
    channel: 'facebook',
    target: 'openg7',
    status: 'draft',
    deliveryStatus: 'publishing',
    deliveryMode: 'live',
    scheduledAt: at.toISOString()
  };
  return {
    calls,
    ports: {
      async sources() {
        calls.sources++;
        return [item];
      },
      async preparation() {
        calls.preparation++;
        return {
          version: 'synthetic',
          status: 'ready',
          blockers: [],
          drafts: []
        };
      },
      async progress() {
        calls.progress++;
        return {
          commitment: item.commitment,
          publications: [publication],
          qualifiedFulfilmentEvidenceIds: [],
          fulfilmentEvidence: [],
          publicationWorkflow: projectSponsorshipPublicationWorkflow(
            item.commitment,
            [publication],
            [],
            at,
            []
          )
        };
      }
    }
  };
}

test('desk reuses campaign caches for every passage beyond one hundred and fences exact delivery identity', async () => {
  const item = source(125),
    f = portsFor(item);
  const snapshot = await loadAdminCampaignDeskSnapshot(
    {},
    undefined,
    at,
    f.ports
  );
  assert.equal(snapshot.rows.length, 125);
  assert.deepEqual(f.calls, { sources: 1, preparation: 1, progress: 1 });
  // Existing workflow holds the source channel while a send is active. Only its
  // exact obligation is authorized; future ordinals must not inherit that right.
  assert.equal(
    snapshot.rows.filter((item) => item.authorizedDelivery).length,
    1
  );
  assert.equal(
    snapshot.rows.find((item) => item.authorizedDelivery).campaign.id,
    item.commitment.obligations[0].id
  );
  const result = projectPreflightDesk(
    snapshot.rows,
    query,
    snapshot.generatedAt
  );
  assert.equal(result.summary.total, 125);
  assert.equal(result.summary.toDeliver, 1);
  assert.equal(result.summary.toPrepare, 124);
  assert.equal(result.orders[0].services.length, 125);
});

test('desk reads a repeatable read-only transaction and binds search without a business write', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'release' });
    }
  };
  const result = await new PreflightDeskService({
    async connect() {
      return db;
    }
  }).list({ ...query, search: 'Synthetic' }, at);
  assert.equal(result.summary.total, 0);
  assert.match(calls[0].sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(calls[1].sql, /sponsorship_obligations/);
  assert.deepEqual(calls[1].values, [null, null, 'Synthetic', null, null]);
  assert.equal(calls[2].sql, 'COMMIT');
  assert.equal(calls[3].sql, 'release');
});

test('desk rejects invalid filters and malformed money rather than fabricate zero', () => {
  for (const search of [
    'page=0',
    'pageSize=100',
    'stage=approved',
    'page=1&page=2',
    'tenant=x',
    'search=' + encodeURIComponent('x\n')
  ]) {
    assert.throws(
      () => parsePreflightDeskQuery(new URLSearchParams(search)),
      (error) =>
        error.code === 'PREFLIGHT_DESK_INVALID_REQUEST' && error.status === 400
    );
  }
  assert.deepEqual(
    parsePreflightDeskQuery(
      new URLSearchParams('page=2&pageSize=50&stage=delivered&search=+Test+')
    ),
    { page: 2, pageSize: 50, stage: 'delivered', search: 'Test' }
  );
  assert.throws(
    () =>
      projectPreflightDesk(
        [row(1, { amountMinor: '-1' })],
        query,
        at.toISOString()
      ),
    (error) => error.code === 'PREFLIGHT_DESK_UNAVAILABLE'
  );
});

test('desk private HTTP protects reads and exposes no mutation action', async (t) => {
  let permitted = true,
    reads = 0;
  const { writeJson } = createHttpTransport({
    isProduction: true,
    allowedOrigins: ['https://funding.example.test']
  });
  const handler = createPreflightDeskHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    writeJson,
    ensureAdminAccess: (request, response) => {
      if (permitted) return true;
      writeJson(request, response, 401, { error: 'Authentication required.' });
      return false;
    },
    desk: {
      async list(q) {
        reads++;
        return projectPreflightDesk([], q, at.toISOString());
      }
    }
  });
  const server = createServer(
    (request, response) =>
      void handler(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  const url = `http://127.0.0.1:${server.address().port}/api/admin/preflight/desk`;
  const result = await fetch(url);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal((await result.json()).summary.total, 0);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '?stage=approved')).status, 400);
  permitted = false;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(reads, 1);
  for (const role of ['reader', 'operator', 'owner'])
    assert.equal(
      adminRoleAllows(role, 'GET', '/api/admin/preflight/desk'),
      true
    );
});

test('desk loader has the same search-scoped full universe before group pagination', async () => {
  const item = source(8),
    f = portsFor(item);
  const result = await loadPreflightDeskOnClient(
    {},
    { ...query, stage: 'to_deliver' },
    at,
    f.ports
  );
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].services.length, 8);
  assert.equal(result.summary.total, 8);
});
