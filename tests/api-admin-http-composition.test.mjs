import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminAuthorization } from '../dist/apps/funding-api/src/admin-authorization.js';
import { createAdminHttpHandlers } from '../dist/apps/funding-api/src/http-composition/admin-handlers.js';
import {
  readBody,
  readBodyBuffer
} from '../dist/apps/funding-api/src/http-transport.js';

const origin = 'https://funding.example.test';
const token = 'synthetic-admin-token';
const id = '11111111-1111-4111-8111-111111111111';
const version = '2026-10-03T12:34:56.123456Z';

const fixture = ({ database = true, role, permitted = true, pool } = {}) => {
  const effects = [];
  const port =
    (name, result) =>
    async (...args) => {
      effects.push({ name, args });
      return result;
    };
  const writeJson = (_request, response, status, payload) => {
    Object.assign(response, { status, payload });
  };
  const adminIdentity = role
    ? {
        identity: () => ({ id: 'synthetic-account', role }),
        permits: () => permitted
      }
    : null;
  const authorization = createAdminAuthorization({
    adminIdentity,
    adminTokenConfigured: true,
    isProduction: true,
    hasDatabase: database,
    verifyAdminSession: () => null,
    adminTokenMatches: (candidate) => candidate === token,
    writeJson
  });
  const unexpected = async (...args) => {
    effects.push({ name: 'unexpected', args });
    throw new Error('Unexpected synthetic resource access.');
  };
  const setup = { checkedAt: '2026-10-04T12:00:00Z', services: [] };
  const receipt = { requestId: id, status: 'completed', code: 'COMPLETED' };
  const handlers = createAdminHttpHandlers({
    dbPool: database
      ? (pool ?? { query: unexpected, connect: unexpected })
      : null,
    publicBaseOrigin: origin,
    allowedOrigins: [],
    isProduction: true,
    stripe: null,
    sponsorMediaMaxBytes: 1024,
    sponsorMediaMaxSupportingImages: 3,
    sponsorLogoMaxBytes: 1024,
    sponsorshipFollowupTokenTtlDays: 30,
    ...authorization,
    readBody: (request, limit) => {
      effects.push({ name: 'body', args: [limit] });
      return readBody(request, limit);
    },
    readBodyBuffer: (request, limit) => {
      effects.push({ name: 'bodyBuffer', args: [limit] });
      return readBodyBuffer(request, limit);
    },
    writeJson,
    writeCsv: unexpected,
    writePdf: unexpected,
    writeBinary: unexpected,
    readCockpitSystems: unexpected,
    adminNotificationRecipient: () => 'synthetic@example.test',
    sponsorMediaStorage: {
      driver: 'local',
      readPrivateObject: unexpected,
      publishObject: unexpected,
      deletePublicObject: unexpected
    },
    sponsorMediaPublicUrl: () => '/api/public/sponsor-media/synthetic',
    deleteSponsorMediaObjects: unexpected,
    writeSponsorMediaMutationFailure: unexpected,
    sponsorLogoStorage: {
      readLogo: unexpected,
      writeLogo: unexpected,
      deleteLogo: unexpected
    },
    getSponsorLogoFilenameFromUrl: () => null,
    deleteControlledSponsorLogoFile: unexpected,
    writeSponsorshipMutationFailure: unexpected,
    routeAssetId: () => null,
    recordAdminAssistantAudit: unexpected,
    adminAssistantConfig: {
      enabled: false,
      providerConfigured: false,
      provider: 'disabled',
      maxMessageLength: 1000
    },
    socialPublicationRuntime: () => ({ mode: 'mock', configuredChannels: [] }),
    adminPilotage: {
      state: port('pilotage.state', { decisions: [] }),
      command: port('pilotage.command', receipt),
      readReceipt: unexpected,
      acknowledgeReceipt: unexpected,
      editorial: { state: unexpected, propose: unexpected, variant: unexpected }
    },
    adminIdentity,
    publicationAutomation: {
      state: unexpected,
      mediaOptions: unexpected,
      command: port('automation.command', { updated: true })
    },
    writeSponsorshipRefundIneligible: unexpected,
    adminStripeBackfill: {
      read: unexpected,
      preview: unexpected,
      execute: port('backfill.execute', { id, status: 'completed' })
    },
    contributionActivity: { list: unexpected, claimPresentation: unexpected },
    adminTokenConfigured: true,
    adminTokenMatches: (candidate) => candidate === token,
    createAdminSession: () => null,
    buildAdminSetupStatus: port('setup', setup)
  });
  return {
    effects,
    setup,
    receipt,
    async request(
      name,
      path,
      { method = 'POST', input, anonymous = false } = {}
    ) {
      const request = Object.assign(
        Readable.from([JSON.stringify(input ?? {})]),
        {
          url: path,
          method,
          headers: {
            'content-type': 'application/json',
            origin,
            ...(anonymous ? {} : { authorization: `Bearer ${token}` })
          }
        }
      );
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      return { handled: await handlers[name](request, response), ...response };
    }
  };
};

// Representative owned routes include both authorization-only and database-bound checks.
const protectedRoutes = [
  ['AdminContributions', 'contributions.csv'],
  ['AdminDocuments', 'sponsorship-invoices/backfill'],
  ['AdminAccounting', 'expenses'],
  ['AdminEmail', 'email/test'],
  ['AdminInsights', 'dashboard', 'GET'],
  ['AdminSponsorshipRecords', 'sponsorships/details'],
  ['AdminSponsorshipDecisions', 'sponsorships/review'],
  ['AdminSponsorshipMedia', 'sponsorships/media/delete'],
  ['AdminAssistant', 'assistant/prepare'],
  ['AdminPublicationDrafts', 'publication-drafts'],
  ['AdminPublicationSlots', 'publication-slots'],
  ['AdminPublicationBatches', 'publication-batches'],
  ['AdminPilotage', 'pilotage/command'],
  ['AdminPublicationAutomation', 'publication-automation'],
  ['AdminSponsorshipRefund', 'sponsorships/refund'],
  ['AdminStripeBackfill', 'stripe-backfill'],
  ['AdminContributionActivity', 'contribution-activity/present'],
  ['AdminBackups', 'backups'],
  ['AdminAudit', 'audit-log', 'GET'],
  ['AdminSponsorshipAccess', 'sponsorships/followup-access']
];

test('admin composition preserves authorization refusals before body or resource access', async () => {
  for (const [options, anonymous, expectedStatus] of [
    [{}, true, 401],
    [{ role: 'owner', permitted: false }, false, 403],
    [{ database: false }, false, 503]
  ]) {
    for (const [name, path, method = 'POST'] of protectedRoutes) {
      const f = fixture(options);
      const result = await f.request(
        `handle${name}Request`,
        `/api/admin/${path}`,
        {
          method,
          anonymous
        }
      );
      assert.equal(result.handled, true, path);
      assert.equal(result.status, expectedStatus, path);
      assert.deepEqual(f.effects, [], `No private effect for ${path}`);
    }
  }
});

test('admin composition keeps authenticated setup available without a database', async () => {
  const f = fixture({ database: false });
  const result = await f.request(
    'handleAdminSetupRequest',
    '/api/admin/setup-status',
    {
      method: 'GET'
    }
  );
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(result.payload, f.setup);
  assert.deepEqual(f.effects, [{ name: 'setup', args: [] }]);
});

test('admin composition passes pilotage confirmation, version and resolved actor to the existing runtime', async () => {
  const input = {
    requestId: id,
    action: 'feed.pause',
    targetId: 'openg7:linkedin',
    version,
    confirmation: 'openg7:linkedin'
  };
  for (const [role, writable, owner, actor] of [
    ['operator', true, false, 'admin:synthetic-account'],
    ['owner', true, true, 'admin:synthetic-account'],
    [undefined, true, true, 'funding-admin-token']
  ]) {
    const f = fixture({ role });
    const result = await f.request(
      'handleAdminPilotageRequest',
      '/api/admin/pilotage/command',
      {
        input
      }
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, f.receipt);
    assert.deepEqual(f.effects, [
      { name: 'body', args: [16 * 1024] },
      { name: 'pilotage.command', args: [input, actor, writable, owner] }
    ]);
  }
});

test('admin composition retains identity restrictions in pilotage read projections', async () => {
  const f = fixture({ role: 'reader' });
  const result = await f.request(
    'handleAdminPilotageRequest',
    '/api/admin/pilotage',
    {
      method: 'GET'
    }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(f.effects, [
    {
      name: 'pilotage.state',
      args: [{ page: 1, domain: undefined, id: undefined }, false, false]
    }
  ]);
});

test('admin composition preserves confirmation and audit actor across automation and backfill ports', async () => {
  const f = fixture({ role: 'owner' });
  const command = {
    action: 'worker',
    enabled: true,
    version: 5,
    confirmation: 'enable-worker'
  };
  const automation = await f.request(
    'handleAdminPublicationAutomationRequest',
    '/api/admin/publication-automation',
    {
      input: command
    }
  );
  assert.equal(automation.status, 200);
  const backfill = await f.request(
    'handleAdminStripeBackfillRequest',
    '/api/admin/stripe-backfill',
    {
      input: {
        action: 'execute',
        id,
        confirmation: 'execute-synthetic-preview'
      }
    }
  );
  assert.equal(backfill.status, 200);
  assert.deepEqual(f.effects, [
    { name: 'body', args: [undefined] },
    { name: 'automation.command', args: [command, 'admin:synthetic-account'] },
    { name: 'body', args: [4096] },
    {
      name: 'backfill.execute',
      args: [id, 'execute-synthetic-preview', 'admin:synthetic-account']
    }
  ]);
});

test('admin composition binds the injected database to filtered audit reads', async () => {
  const queries = [];
  const row = {
    id,
    actor: 'synthetic-owner',
    action: 'synthetic.read',
    entity_type: 'synthetic',
    entity_id: null,
    summary: null,
    metadata: {},
    created_at: version
  };
  const pool = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      return { rows: queries.length === 1 ? [{ has_audit_log: true }] : [row] };
    }
  };
  const f = fixture({ pool });
  const result = await f.request(
    'handleAdminAuditRequest',
    `/api/admin/audit-log?entryId=${id}`,
    {
      method: 'GET'
    }
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].parameters, [id]);
  assert.deepEqual(result.payload.entries, [row]);
  assert.deepEqual(f.effects, []);
});
