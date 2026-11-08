import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync
} from 'node:fs';

import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import test from 'node:test';

import { PreflightClientError } from '../dist/apps/funding-api/src/preflight/client.js';
import { loadPreflightRehearsalConfig } from '../dist/apps/funding-api/src/preflight/rehearsal-config.js';
import { parseRehearsalMissionDetail } from '../dist/apps/funding-api/src/preflight/rehearsal-contracts.js';

import {
  PreflightRehearsalStore,
  RehearsalError
} from '../dist/apps/funding-api/src/preflight/rehearsal-store.js';
import {
  createRehearsalFetch,
  PreflightRehearsalService
} from '../dist/apps/funding-api/src/preflight/rehearsal.js';

const at = '2026-11-03T15:00:00.000Z';
const env = {
  FUNDING_PLATFORM_ENV: 'test',
  FUNDING_PUBLIC_BASE_URL: 'https://funding.example.test',
  PREFLIGHT_REHEARSAL_ENABLED: 'true',
  PREFLIGHT_URL: 'https://preflight.example.test',
  PREFLIGHT_TOKEN_URL: 'https://identity.example.test/token',
  PREFLIGHT_TENANT_ID: 'synthetic-tenant',
  PREFLIGHT_CLIENT_ID: 'synthetic-rehearsal-client',
  PREFLIGHT_CLIENT_SECRET: 'synthetic-rehearsal-client-secret',
  PREFLIGHT_CONSOLE_URL: 'https://preflight.example.test/'
};

function directory(t) {
  const value = mkdtempSync(join(tmpdir(), 'funding-preflight-rehearsal-'));
  chmodSync(value, 0o700);
  t.after(() => {
    assert.equal(resolve(dirname(value)), resolve(tmpdir()));
    assert.ok(value.includes('funding-preflight-rehearsal-'));
    rmSync(value, { recursive: true, force: true });
  });
  return value;
}

function remote(payload, state = 'review_ready') {
  const ids = Array.from({ length: 9 }, () => randomUUID());
  const kinds = [
    'completeness',
    'preparation-policy',
    'draft',
    'output-check',
    'review-proposal'
  ];
  const output = [
    { complete: true },
    {
      businessDecisionAllowed: false,
      externalPublicationAllowed: false,
      humanReviewRequired: true
    },
    {
      title: '[Simulation] Synthetic returned title',
      summary: 'Synthetic summary',
      body: 'Synthetic body',
      warnings: ['Synthetic preparation only.']
    },
    { passed: true, sourceVersion: 1 },
    { prepared: true }
  ];
  const tasks = kinds.map((kind, index) => ({
    id: ids[index],
    key: ['inspect', 'policy', 'draft', 'verify', 'proposal'][index],
    kind,
    status: 'completed',
    attempts: 1,
    startedAt: at,
    finishedAt: at,
    errorCode: null
  }));
  const results = kinds.map((kind, index) => ({
    id: index === 4 ? randomUUID() : (ids[index + 5] ?? randomUUID()),
    taskId: tasks[index].id,
    kind,
    version: 1,
    obsolete: false,
    output: output[index],
    provenance:
      kind === 'draft'
        ? {
            provider: 'mock',
            model: 'deterministic-v1',
            simulated: true,
            inputVersion: 1,
            estimatedCostUsd: 0,
            inputHash: createHash('sha256')
              .update(JSON.stringify(payload.input))
              .digest('hex')
          }
        : { provider: 'deterministic', model: 'check-v1', simulated: false }
  }));
  const proposal = {
    id: randomUUID(),
    missionId: payload.missionId,
    tenantId: payload.tenantId,
    source: payload.source,
    status: 'prepared',
    version: 1,
    type: 'review',
    risk: 'normal',
    createdAt: at,
    sourceVersion: 1,
    draftResultId: results[2].id,
    resultIds: results.slice(0, 4).map((item) => item.id),
    checks: [0, 1, 3].map((index) => ({
      resultId: results[index].id,
      kind: results[index].kind,
      passed: true
    })),
    explanations: ['Synthetic output verified.'],
    limitations: ['Simulation'],
    blockingConditions: ['Human review required.'],
    anomalies: [],
    provenance: results[2].provenance,
    authority: 'source_application',
    businessDecisionExecuted: false
  };
  return {
    mission: {
      id: payload.missionId,
      tenantId: payload.tenantId,
      source: payload.source,
      workflow: payload.workflow,
      input: payload.input,
      status: state,
      revision: 5
    },
    results: state === 'review_ready' ? results : [],
    proposals: state === 'review_ready' ? [proposal] : [],
    telemetry: {
      createdAt: at,
      updatedAt: at,
      correlationId: randomUUID(),
      errorCode: null,
      tasks: state === 'ready' ? [] : tasks,
      history: [{ action: 'mission.transition', to: state, createdAt: at }]
    }
  };
}

function fixture(t) {
  const root = directory(t);
  const config = loadPreflightRehearsalConfig({
    ...env,
    PREFLIGHT_REHEARSAL_STORAGE_DIR: root
  });
  const state = {
    submissions: [],
    detail: null,
    submitError: null,
    readError: null,
    status: 'review_ready'
  };
  const client = {
    async submit(payload) {
      state.submissions.push(structuredClone(payload));
      state.detail = remote(payload, state.status);
      if (state.submitError) throw state.submitError;
      return { mission: state.detail.mission, duplicate: false };
    },
    async getRehearsalMission() {
      if (state.readError) throw state.readError;
      if (!state.detail)
        throw new PreflightClientError('preflight_http_error', false, 404);
      return structuredClone(state.detail);
    }
  };
  const service = new PreflightRehearsalService(config, {
    client,
    now: () => at
  });
  return { root, config, state, client, service };
}

test('a synthetic recipe persists before sending, returns verified output, and deduplicates concurrent clicks', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  const [first, duplicate] = await Promise.all([
    f.service.start(id, 'standard', 'admin:synthetic-owner'),
    f.service.start(id, 'standard', 'admin:synthetic-owner')
  ]);
  assert.equal(f.state.submissions.length, 1);
  assert.deepEqual(first, duplicate);
  assert.equal(first.delivery, 'acknowledged');
  assert.equal(first.terminal, true);
  assert.equal(first.output.body, 'Synthetic body');
  assert.equal(first.observedSimulated, true);
  assert.equal(
    first.steps.filter((step) => step.state === 'confirmed').length,
    5
  );
  assert.equal(first.steps.at(-1).state, 'attention');
  assert.ok(first.steps.slice(0, 5).every((step) => step.at));
  assert.equal(first.authority, 'source_application');
  assert.equal(first.businessDecisionExecuted, false);
  assert.equal(f.state.submissions[0].constraints.maxCostUsd, 0);
  assert.equal(f.state.submissions[0].input.synthetic, true);
  const persisted = JSON.parse(
    readFileSync(join(f.root, id + '.json'), 'utf8')
  );
  assert.equal(persisted.payload.missionId, first.missionId);
  assert.ok(
    persisted.audit.some(
      (entry) =>
        entry.action === 'returned' && entry.actor === 'admin:synthetic-owner'
    )
  );
  assert.ok(!JSON.stringify(first).includes('admin:synthetic-owner'));
  if (process.platform !== 'win32') {
    assert.equal(statSync(f.root).mode & 0o777, 0o700);
    assert.equal(statSync(join(f.root, id + '.json')).mode & 0o777, 0o600);
  }
  await assert.rejects(
    f.service.start(id, 'missing_input', 'admin:synthetic-owner'),
    (error) => error.code === 'PREFLIGHT_REHEARSAL_IDEMPOTENCY_CONFLICT'
  );
  assert.equal(f.state.submissions.length, 1);
});

test('a lost acknowledgement is reconciled by observation after restart without another submission', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  f.state.submitError = new PreflightClientError('preflight_timeout', true);
  const uncertain = await f.service.start(
    id,
    'standard',
    'admin:synthetic-owner'
  );
  assert.equal(uncertain.delivery, 'uncertain');
  assert.equal(uncertain.steps[1].state, 'attention');
  assert.equal(uncertain.steps[2].state, 'pending');
  const restarted = new PreflightRehearsalService(f.config, {
    client: f.client,
    now: () => at
  });
  const recovered = await restarted.observe(id, 'admin:synthetic-owner');
  assert.equal(recovered.delivery, 'acknowledged');
  assert.equal(recovered.receivedAt, at);
  await restarted.resume(id, 'admin:synthetic-owner');
  assert.equal(f.state.submissions.length, 1);
});

test('interruption after remote acceptance and before acknowledgement persistence remains recoverable', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  const save = f.service.store.save.bind(f.service.store);
  f.service.store.save = async (run) => {
    if (run.view.delivery === 'acknowledged')
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_UNAVAILABLE');
    return save(run);
  };
  await assert.rejects(
    f.service.start(id, 'standard', 'admin:synthetic-owner'),
    (error) => error.code === 'PREFLIGHT_REHEARSAL_STORAGE_UNAVAILABLE'
  );
  assert.equal(
    JSON.parse(readFileSync(join(f.root, id + '.json'), 'utf8')).view.delivery,
    'sending'
  );
  const restarted = new PreflightRehearsalService(f.config, {
    client: f.client,
    now: () => at
  });
  assert.equal(
    (await restarted.observe(id, 'admin:synthetic-owner')).delivery,
    'acknowledged'
  );
  assert.equal(f.state.submissions.length, 1);
});

test('a manual resume sends the exact persisted identifiers and payload only after a known-mission 404', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  f.state.submitError = new PreflightClientError('preflight_unavailable', true);
  await f.service.start(id, 'standard', 'admin:synthetic-owner');
  const initial = f.state.submissions[0];
  f.state.detail = null;
  await f.service.observe(id, 'admin:synthetic-owner');
  assert.equal(f.state.submissions.length, 1);
  f.state.submitError = null;
  const resumed = await f.service.resume(id, 'admin:synthetic-owner');
  assert.equal(resumed.delivery, 'acknowledged');
  assert.equal(f.state.submissions.length, 2);
  assert.deepEqual(f.state.submissions[1], initial);
});

test('a temporary observation failure preserves confirmed evidence and never invents processing failure', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  const ready = await f.service.start(id, 'standard', 'admin:synthetic-owner');
  f.state.readError = new PreflightClientError(
    'preflight_http_error',
    true,
    503
  );
  const unavailable = await f.service.observe(id, 'admin:synthetic-owner');
  assert.deepEqual(unavailable.output, ready.output);
  assert.deepEqual(unavailable.proposals, ready.proposals);
  assert.equal(unavailable.receivedAt, ready.receivedAt);
  assert.deepEqual(unavailable.steps, ready.steps);
  assert.equal(unavailable.steps[2].state, 'confirmed');
  assert.equal(unavailable.error.code, 'PREFLIGHT_REHEARSAL_UNAVAILABLE');
  const auditBefore = JSON.parse(
    readFileSync(join(f.root, id + '.json'), 'utf8')
  ).audit.length;
  await f.service.observe(id, 'admin:synthetic-owner');
  assert.equal(
    JSON.parse(readFileSync(join(f.root, id + '.json'), 'utf8')).audit.length,
    auditBefore
  );
});

test('changed source input, correlation, obsolete results and unsafe provenance invalidate the current returned output', async (t) => {
  for (const mutate of [
    (detail) => {
      detail.mission.input.description = 'Changed after preparation';
    },
    (detail) => {
      detail.telemetry.correlationId = randomUUID();
    },
    (detail) => {
      detail.results.find((result) => result.kind === 'draft').obsolete = true;
    },
    (detail) => {
      detail.results.find(
        (result) => result.kind === 'draft'
      ).provenance.inputVersion = 2;
    },
    (detail) => {
      detail.results.find(
        (result) => result.kind === 'draft'
      ).provenance.simulated = false;
    },
    (detail) => {
      detail.proposals[0].sourceVersion = 2;
    },
    (detail) => {
      detail.results.find((result) => result.kind === 'output-check').version =
        2;
    }
  ]) {
    const f = fixture(t),
      id = randomUUID();
    await f.service.start(id, 'standard', 'admin:synthetic-owner');
    mutate(f.state.detail);
    const invalid = await f.service.observe(id, 'admin:synthetic-owner');
    assert.equal(invalid.output, null);
    assert.equal(invalid.proposals.length, 0);
    assert.equal(invalid.receivedAt, null);
    assert.equal(invalid.error.code, 'PREFLIGHT_REHEARSAL_RESPONSE_INVALID');
    assert.notEqual(invalid.steps[4].state, 'confirmed');
  }
});

test('waiting input is explicit and a superseded mission loses its current result', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  f.state.status = 'waiting_input';
  const waiting = await f.service.start(
    id,
    'missing_input',
    'admin:synthetic-owner'
  );
  assert.equal(waiting.missionStatus, 'waiting_input');
  assert.equal(waiting.steps[2].state, 'attention');
  assert.equal(waiting.steps[4].state, 'pending');
  assert.equal(waiting.observedSimulated, null);
  assert.equal(
    Object.hasOwn(f.state.submissions[0].input, 'description'),
    false
  );
  const other = fixture(t),
    otherId = randomUUID();
  await other.service.start(otherId, 'standard', 'admin:synthetic-owner');
  other.state.detail.mission.status = 'superseded';
  const stale = await other.service.observe(otherId, 'admin:synthetic-owner');
  assert.equal(stale.output, null);
  assert.equal(stale.receivedAt, null);
  assert.equal(stale.error.code, 'PREFLIGHT_REHEARSAL_SOURCE_OBSOLETE');
});

test('recipe transport cannot send other business commands, another scope or a billable mission', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  await f.service.start(id, 'standard', 'admin:synthetic-owner');
  const calls = [];
  const fetcher = createRehearsalFetch(f.config, async (input, init) => {
    calls.push({ input, init });
    return new Response('{}', {
      headers: { 'content-type': 'application/json' }
    });
  });
  const mission = f.state.submissions[0],
    base = f.config.connection.baseUrl + '/api/missions';
  await fetcher(base, { method: 'POST', body: JSON.stringify(mission) });
  await fetcher(base + '/' + mission.missionId, { method: 'GET' });
  await fetcher(f.config.connection.tokenUrl, { method: 'POST' });
  for (const [url, init] of [
    [
      base + '/' + mission.missionId + '/source-decision',
      { method: 'POST', body: '{}' }
    ],
    [base.replace('/missions', '/events'), { method: 'POST', body: '{}' }],
    [
      base,
      {
        method: 'POST',
        body: JSON.stringify({
          ...mission,
          constraints: { ...mission.constraints, maxCostUsd: 0.01 }
        })
      }
    ],
    [
      base,
      {
        method: 'POST',
        body: JSON.stringify({ ...mission, tenantId: 'another-tenant' })
      }
    ],
    [
      base,
      {
        method: 'POST',
        body: JSON.stringify({
          ...mission,
          source: { ...mission.source, application: 'openg7-social' }
        })
      }
    ],
    [base + '/' + mission.missionId + '?tenant=another', { method: 'GET' }]
  ])
    await assert.rejects(
      fetcher(url, init),
      (error) => error.code === 'preflight_rehearsal_request_forbidden'
    );
  assert.equal(calls.length, 3);
});

test('public mission telemetry validates tenant, history correlation and bounded task states', async (t) => {
  const f = fixture(t);
  await f.service.start(randomUUID(), 'standard', 'admin:synthetic-owner');
  const detail = f.state.detail;
  const raw = {
    mission: {
      ...detail.mission,
      createdAt: at,
      updatedAt: at,
      correlationId: detail.telemetry.correlationId,
      errorCode: null
    },
    results: detail.results,
    proposals: detail.proposals,
    tasks: detail.telemetry.tasks,
    history: [
      {
        action: 'mission.transition',
        data: { to: 'review_ready' },
        createdAt: at,
        correlationId: detail.telemetry.correlationId,
        actor: 'must-not-escape'
      }
    ]
  };
  const parsed = parseRehearsalMissionDetail(raw, env.PREFLIGHT_TENANT_ID);
  assert.equal(parsed.telemetry.tasks.length, 5);
  assert.ok(!JSON.stringify(parsed.telemetry).includes('must-not-escape'));
  for (const mutate of [
    (value) => {
      value.mission.tenantId = 'another-tenant';
    },
    (value) => {
      value.history[0].correlationId = randomUUID();
    },
    (value) => {
      value.tasks[0].status = 'invented';
    },
    (value) => {
      value.tasks[0].errorCode = 'secret/path/with-private-data';
    }
  ]) {
    const value = structuredClone(raw);
    mutate(value);
    assert.throws(() =>
      parseRehearsalMissionDetail(value, env.PREFLIGHT_TENANT_ID)
    );
  }
});

test('private recipe storage is bounded, tenant-scoped, and refuses symlinks or permissive POSIX files', async (t) => {
  const f = fixture(t),
    id = randomUUID();
  await f.service.start(id, 'standard', 'admin:synthetic-owner');
  const otherTenant = new PreflightRehearsalStore(f.root, 'another-tenant');
  assert.equal(
    await otherTenant.read(id).catch((error) => error.code),
    'PREFLIGHT_REHEARSAL_NOT_FOUND'
  );
  assert.equal((await otherTenant.list()).length, 0);
  const snapshot = JSON.parse(readFileSync(join(f.root, id + '.json'), 'utf8'));
  for (let index = 1; index < 100; index++) {
    const copy = structuredClone(snapshot);
    copy.view.id = randomUUID();
    await f.service.store.create(copy);
  }
  const overflow = structuredClone(snapshot);
  overflow.view.id = randomUUID();
  await assert.rejects(
    f.service.store.create(overflow),
    (error) => error.code === 'PREFLIGHT_REHEARSAL_CAPACITY_REACHED'
  );
  assert.equal((await f.service.store.list()).length, 100);
  if (process.platform !== 'win32') {
    chmodSync(join(f.root, id + '.json'), 0o644);
    await assert.rejects(
      f.service.store.read(id),
      (error) => error.code === 'PREFLIGHT_REHEARSAL_STORAGE_INVALID'
    );
    chmodSync(join(f.root, id + '.json'), 0o600);
    const target = join(f.root, randomUUID() + '.json');
    symlinkSync(join(f.root, id + '.json'), target);
    await assert.rejects(
      f.service.store.read(target.split('/').at(-1).slice(0, -5)),
      (error) => error.code === 'PREFLIGHT_REHEARSAL_STORAGE_INVALID'
    );
    unlinkSync(target);
  }
});
