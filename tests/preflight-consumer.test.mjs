import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PreflightClient } from '../dist/apps/funding-api/src/preflight/client.js';
import { loadPreflightConfig } from '../dist/apps/funding-api/src/preflight/config.js';
import { parseRemoteMissionDetail } from '../dist/apps/funding-api/src/preflight/contracts.js';
import { parseValidatedPreparation } from '../dist/apps/funding-api/src/preflight/result-import.js';
import { createPreflightHttpHandler } from '../dist/apps/funding-api/src/preflight/routes.js';

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenantId = 'synthetic-tenant';
const source = {
  application: 'funding-platform',
  subjectType: 'sponsorship-commitment',
  subjectId: id(2),
  version: 7
};
const input = {
  title: 'Synthetic source',
  description: 'Draft only',
  benefits: ['Private preparation'],
  sourceSnapshotDigest: 'a'.repeat(64)
};
const submitted = {
  schemaVersion: '1.0',
  missionId: id(1),
  eventId: id(8),
  tenantId,
  source,
  workflow: { type: 'sponsorship-preparation-v1', version: '1.0' },
  constraints: { humanApprovalRequired: true, maxCostUsd: 0.5 },
  input
};
function detail() {
  const draftProvenance = {
    provider: 'mock',
    model: 'deterministic-v1',
    simulated: true,
    generatedAt: '2026-11-02T12:00:00.000Z',
    inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    inputVersion: 7,
    estimatedCostUsd: 0
  };
  const result = (n, kind, output) => ({
    id: id(n),
    taskId: id(n + 20),
    kind,
    output,
    provenance: {},
    version: 1,
    obsolete: false
  });
  return {
    mission: {
      id: id(1),
      tenantId,
      source,
      workflow: submitted.workflow,
      status: 'review_ready',
      input,
      revision: 1
    },
    results: [
      result(3, 'completeness', { complete: true }),
      result(4, 'preparation-policy', {
        businessDecisionAllowed: false,
        externalPublicationAllowed: false,
        humanReviewRequired: true
      }),
      {
        ...result(5, 'draft', {
          title: '[Demo] Draft',
          summary: 'Synthetic summary',
          body: 'Synthetic draft only',
          warnings: ['Simulation']
        }),
        provenance: draftProvenance
      },
      result(6, 'output-check', { passed: true, sourceVersion: 7 })
    ],
    proposals: [
      {
        id: id(7),
        missionId: id(1),
        tenantId,
        source,
        status: 'prepared',
        version: 1,
        type: 'review',
        risk: 'normal',
        authority: 'source_application',
        businessDecisionExecuted: false,
        sourceVersion: 7,
        draftResultId: id(5),
        resultIds: [id(3), id(4), id(5), id(6)],
        checks: [
          { kind: 'completeness', resultId: id(3), passed: true },
          { kind: 'preparation-policy', resultId: id(4), passed: true },
          { kind: 'output-check', resultId: id(6), passed: true }
        ],
        anomalies: [],
        blockingConditions: ['Review in source required']
      }
    ]
  };
}
const expected = {
  tenantId,
  subjectId: id(2),
  sourceVersion: 7,
  sourceHash: 'a'.repeat(64)
};
const env = {
  PREFLIGHT_ENABLED: 'true',
  FUNDING_PLATFORM_ENV: 'test',
  PREFLIGHT_URL: 'http://127.0.0.1:3000',
  PREFLIGHT_TOKEN_URL: 'http://127.0.0.1:3001/token',
  PREFLIGHT_ALLOW_INSECURE_LOCAL: 'true',
  PREFLIGHT_TENANT_ID: tenantId,
  PREFLIGHT_CLIENT_ID: 'synthetic-client',
  PREFLIGHT_CLIENT_SECRET: 'synthetic-secret',
  PREFLIGHT_REQUEST_TIMEOUT_MS: '100'
};
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
const token = () =>
  response({
    access_token: 'synthetic-access-token',
    expires_in: 300,
    token_type: 'Bearer'
  });

test('connector configuration is explicitly disabled and production refuses insecure URLs', () => {
  assert.deepEqual(loadPreflightConfig({}), { enabled: false });
  for (const patch of [
    { NODE_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: 'production' },
    { PREFLIGHT_URL: 'http://public.example.test' },
    { PREFLIGHT_TOKEN_URL: 'https://client:secret@example.test/token' },
    { PREFLIGHT_ENABLED: 'yes' },
    { PREFLIGHT_REQUEST_TIMEOUT_MS: '0' }
  ]) {
    assert.throws(() => loadPreflightConfig({ ...env, ...patch }));
  }
  assert.equal(
    loadPreflightConfig({
      ...env,
      PREFLIGHT_ALLOW_INSECURE_LOCAL: 'false',
      PREFLIGHT_URL: 'https://preflight.example.test',
      PREFLIGHT_TOKEN_URL: 'https://identity.example.test/token'
    }).enabled,
    true
  );
});

test('OAuth client credentials are backend-only and shared concurrent calls use one token request', async () => {
  let tokenCalls = 0;
  let apiCalls = 0;
  const client = new PreflightClient(loadPreflightConfig(env), {
    fetch: async (url, init) => {
      assert.equal(init.redirect, 'error');
      if (url.includes(':3001/')) {
        tokenCalls++;
        assert.equal(init.body.get('grant_type'), 'client_credentials');
        assert.equal(init.body.get('client_secret'), 'synthetic-secret');
        return token();
      }
      apiCalls++;
      assert.equal(init.headers.authorization, 'Bearer synthetic-access-token');
      assert.equal(JSON.stringify(init).includes('synthetic-secret'), false);
      return response(detail());
    }
  });
  const results = await Promise.all([
    client.getMission(id(1)),
    client.getMission(id(1))
  ]);
  assert.equal(results.length, 2);
  assert.equal(tokenCalls, 1);
  assert.equal(apiCalls, 2);
});

test('submission checks returned identity and a duplicate retains the mission id', async () => {
  const client = new PreflightClient(loadPreflightConfig(env), {
    fetch: async (url) =>
      url.includes(':3001/')
        ? token()
        : response({ mission: detail().mission, duplicate: true })
  });
  const result = await client.submit(submitted);
  assert.equal(result.duplicate, true);
  assert.equal(result.mission.id, id(1));
  await assert.rejects(
    client.submit({ ...submitted, tenantId: 'another' }),
    /preflight_scope_mismatch/
  );
});

test('token expiration and one 401 response cause bounded renewal without blind transport retries', async () => {
  let now = 0;
  let tokenCalls = 0;
  let apiCalls = 0;
  const client = new PreflightClient(loadPreflightConfig(env), {
    now: () => now,
    fetch: async (url) => {
      if (url.includes(':3001/')) {
        tokenCalls++;
        return token();
      }
      apiCalls++;
      if (apiCalls === 1) return response({ error: 'expired' }, 401);
      return response(detail());
    }
  });
  await client.getMission(id(1));
  assert.equal(tokenCalls, 2);
  now = 301000;
  await client.getMission(id(1));
  assert.equal(tokenCalls, 3);
});

test('provider errors, malformed responses and timeouts are visible without leaking credentials', async () => {
  for (const [fetcher, expectedCode] of [
    [
      async (url) => (url.includes(':3001/') ? token() : response({}, 503)),
      'preflight_http_error'
    ],
    [
      async (url) =>
        url.includes(':3001/')
          ? token()
          : response({
              ...detail(),
              mission: { ...detail().mission, status: 'automatically_approved' }
            }),
      'preflight_unknown_state'
    ],
    [
      async () =>
        new Response('private upstream details', {
          status: 500,
          headers: { 'content-type': 'text/plain' }
        }),
      'preflight_response_invalid'
    ],
    [async () => new Promise(() => {}), 'preflight_timeout']
  ]) {
    const client = new PreflightClient(loadPreflightConfig(env), {
      fetch: fetcher
    });
    await assert.rejects(
      client.getMission(id(1)),
      (error) =>
        error.code === expectedCode &&
        !String(error).includes('synthetic-secret') &&
        !String(error).includes('private upstream')
    );
  }
});

test('results are imported as private proposed work with provenance and no business authority', () => {
  const parsed = parseRemoteMissionDetail(detail(), tenantId);
  parsed.results[2].provenance.unnecessaryPrivateProviderField =
    'synthetic-private-provider-value';
  const preparation = parseValidatedPreparation(parsed, expected);
  assert.equal(preparation.status, 'proposed');
  assert.equal(preparation.businessDecisionExecuted, false);
  assert.equal(preparation.provenance.simulated, true);
  assert.equal(preparation.sourceHash, expected.sourceHash);
  assert.equal(Object.hasOwn(preparation, 'approved'), false);
  assert.equal(Object.hasOwn(preparation, 'published'), false);
  assert.equal(
    Object.hasOwn(preparation.provenance, 'unnecessaryPrivateProviderField'),
    false
  );
});

test('stale versions, forged authority, invalid provenance and obsolete results cannot become imported proposals', () => {
  const mutations = [
    (value) => {
      value.mission.source = { ...source, version: 8 };
    },
    (value) => {
      value.mission.input = { ...input, sourceSnapshotDigest: 'b'.repeat(64) };
    },
    (value) => {
      value.proposals[0].businessDecisionExecuted = true;
    },
    (value) => {
      value.results[2].provenance.inputHash = 'b'.repeat(64);
    },
    (value) => {
      value.results[2].provenance.simulated = undefined;
    },
    (value) => {
      value.results[2].obsolete = true;
    },
    (value) => {
      value.results[2].output.approved = true;
    },
    (value) => {
      value.results[1].output.externalPublicationAllowed = true;
    }
  ];
  for (const mutate of mutations) {
    const value = detail();
    mutate(value);
    assert.throws(() => parseValidatedPreparation(value, expected));
  }
  assert.equal(
    parseValidatedPreparation(
      { ...detail(), mission: { ...detail().mission, status: 'running' } },
      expected
    ),
    null
  );
});

test('source cancellation and decision notifications contain versioned keys and preserve tenant scope', async () => {
  const calls = [];
  const client = new PreflightClient(loadPreflightConfig(env), {
    fetch: async (url, init) => {
      if (url.includes(':3001/')) return token();
      calls.push([url, JSON.parse(init.body)]);
      const value = detail();
      value.mission.status = url.endsWith('/cancel')
        ? 'cancelled'
        : 'completed';
      return response(value);
    }
  });
  await client.cancelMission(id(1), 7, 'synthetic-cancel');
  await client.recordSourceDecision(id(1), {
    sourceVersion: 7,
    decision: 'review-recorded',
    eventId: 'synthetic-decision'
  });
  assert.deepEqual(calls[0][1], {
    sourceVersion: 7,
    eventId: 'synthetic-cancel'
  });
  assert.equal(calls[1][1].sourceVersion, 7);
});

test('late cancellation and source decision replays accept superseded acknowledgments', async () => {
  const client = new PreflightClient(loadPreflightConfig(env), {
    fetch: async (url) => {
      if (url.includes(':3001/')) return token();
      const value = detail();
      value.mission.status = 'superseded';
      return response(value);
    }
  });
  const cancelled = await client.cancelMission(id(1), 7, 'synthetic-cancel');
  const decided = await client.recordSourceDecision(id(1), {
    sourceVersion: 7,
    decision: 'review-recorded',
    eventId: 'synthetic-decision'
  });
  for (const acknowledgment of [cancelled, decided]) {
    assert.equal(acknowledgment.mission.id, id(1));
    assert.equal(acknowledgment.mission.source.version, 7);
    assert.equal(acknowledgment.mission.tenantId, tenantId);
    assert.equal(acknowledgment.mission.status, 'superseded');
  }
});

test('superseded notification acknowledgments still reject different versions, missions and tenants', async () => {
  for (const operation of ['cancel', 'source-decision']) {
    for (const mismatch of ['version', 'mission', 'tenant']) {
      const client = new PreflightClient(loadPreflightConfig(env), {
        fetch: async (url) => {
          if (url.includes(':3001/')) return token();
          const value = detail();
          value.mission.status = 'superseded';
          value.proposals = [];
          if (mismatch === 'version')
            value.mission.source = { ...source, version: 8 };
          if (mismatch === 'mission') value.mission.id = id(9);
          if (mismatch === 'tenant')
            value.mission.tenantId = 'different-synthetic-tenant';
          return response(value);
        }
      });
      await assert.rejects(
        operation === 'cancel'
          ? client.cancelMission(id(1), 7, 'synthetic-cancel')
          : client.recordSourceDecision(id(1), {
              sourceVersion: 7,
              decision: 'review-recorded',
              eventId: 'synthetic-decision'
            }),
        {
          message:
            mismatch === 'tenant'
              ? 'preflight_tenant_mismatch'
              : operation === 'cancel'
                ? 'preflight_cancellation_mismatch'
                : 'preflight_decision_mismatch'
        }
      );
    }
  }
});

function httpFixture(overrides = {}) {
  const output = { headers: {} };
  const calls = [];
  const handler = createPreflightHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    enabled: true,
    ensureAdminAccess: () => true,
    writeJson: (_request, _response, status, payload) =>
      Object.assign(output, { status, payload }),
    listPreparations: async (contributionId) => {
      calls.push(contributionId);
      return { items: [] };
    },
    connectorStatus: async () => ({
      pending: 0,
      quarantined: 0,
      trackedMissions: 0
    }),
    ...overrides
  });
  return {
    output,
    calls,
    run: (method, url) =>
      handler(
        { method, url },
        {
          setHeader: (key, value) => {
            output.headers[key] = value;
          }
        }
      )
  };
}
test('admin proposal inspection requires a verified Funding session, is read-only and rejects invalid queries', async () => {
  const absent = httpFixture({ ensureAdminAccess: () => false });
  await absent.run(
    'GET',
    `/api/admin/preflight/preparations?sponsorshipId=${id(2)}`
  );
  assert.deepEqual(absent.calls, []);
  const good = httpFixture();
  await good.run(
    'GET',
    `/api/admin/preflight/preparations?sponsorshipId=${id(2)}`
  );
  assert.equal(good.output.status, 200);
  assert.equal(good.output.headers['Cache-Control'], 'private, no-store');
  for (const url of [
    '/admin/preflight/preparations',
    '/admin/preflight/preparations?sponsorshipId=invalid',
    `/admin/preflight/preparations?sponsorshipId=${id(2)}&approve=true`
  ]) {
    const invalid = httpFixture();
    await invalid.run('GET', url);
    assert.equal(invalid.output.status, 400);
    assert.deepEqual(invalid.calls, []);
  }
  const mutation = httpFixture();
  await mutation.run('POST', '/admin/preflight/status');
  assert.equal(mutation.output.status, 405);
  const disabled = httpFixture({ enabled: false });
  await disabled.run('GET', '/admin/preflight/status');
  assert.equal(disabled.output.payload.connectionState, 'disabled');
  assert.deepEqual(disabled.calls, []);
});
