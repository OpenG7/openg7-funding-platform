import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolRegistry } from '../dist/apps/production-launch-agent/src/tools/tool-registry.js';

const stableVersion = 'a'.repeat(40);
const commandResult = (key, code = 0) => ({
  command: `synthetic ${key}`,
  code,
  stderr: code === 0 ? '' : 'Synthetic command failure',
  stdout: code === 0 ? 'Synthetic command completed' : ''
});

// Synthetic ToolContext only: no configuration loader, CLI, database or transport.
const fixture = ({
  role = 'admin',
  version = stableVersion,
  codes = {}
} = {}) => {
  const calls = { commands: [], stableReads: 0, actions: [], deployments: [] };
  const responses = Object.fromEntries(
    ['git_checkout', 'deploy_build', 'deploy_up'].map((key) => [
      key,
      commandResult(key, codes[key] ?? 0)
    ])
  );
  const context = {
    config: {
      appDir: '/synthetic/application',
      databasePath: '/synthetic/memory.sqlite',
      defaultChecklistPath: '/synthetic/checklist.yaml',
      domain: 'synthetic.example.invalid',
      healthPath: '/health',
      reportDir: '/synthetic/reports',
      role,
      ssh: {
        host: 'synthetic.example.invalid',
        username: 'synthetic',
        port: 22,
        readyTimeoutMs: 1,
        retries: 0
      }
    },
    execute: false,
    memory: {
      lastStableDeployment: () => {
        calls.stableReads++;
        return version;
      },
      recordAction: (action) => calls.actions.push(action),
      recordDeployment: (deployment) => calls.deployments.push(deployment),
      recordIncident: () =>
        assert.fail('Rollback must not record an incident.'),
      recordReport: () => assert.fail('Rollback must not record a report.'),
      close: () => assert.fail('The tool must not close its injected memory.')
    },
    reporter: {
      write: async () => assert.fail('The tool must not write a report.')
    },
    runCommand: async (request) => {
      calls.commands.push(request);
      assert.ok(Object.hasOwn(responses, request.key), 'Unexpected command');
      return responses[request.key];
    }
  };
  return { registry: new ToolRegistry(), context, calls, responses };
};

const assertAudit = (f, output) => {
  assert.equal(output.tool, 'rollback');
  assert.ok(Number.isFinite(Date.parse(output.startedAt)));
  assert.ok(Number.isFinite(Date.parse(output.finishedAt)));
  assert.ok(output.durationMs >= 0);
  assert.deepEqual(f.calls.actions, [
    {
      action: 'rollback',
      durationMs: output.durationMs,
      result: output.message,
      success: output.success,
      user: 'admin'
    }
  ]);
  assert.deepEqual(f.calls.deployments, []);
};

const checkoutRequest = { key: 'git_checkout', params: { sha: stableVersion } };
const buildRequest = { key: 'deploy_build' };
const upRequest = { key: 'deploy_up' };

test('rollback without a stable version runs no commands and audits the failure', async () => {
  const f = fixture({ version: null });
  const output = await f.registry.run('rollback', f.context);
  assert.equal(output.success, false);
  assert.equal(
    output.message,
    'Aucune version stable enregistrée pour rollback'
  );
  assert.deepEqual(output.details, {});
  assert.equal(f.calls.stableReads, 1);
  assert.deepEqual(f.calls.commands, []);
  assertAudit(f, output);
});

test('failed rollback checkout stops before build and up and retains the version', async () => {
  const f = fixture({ codes: { git_checkout: 1 } });
  const output = await f.registry.run('rollback', f.context);
  assert.equal(output.success, false);
  assert.equal(output.message, 'Checkout de la version stable impossible');
  assert.deepEqual(output.details, {
    checkout: f.responses.git_checkout,
    version: stableVersion
  });
  assert.deepEqual(f.calls.commands, [checkoutRequest]);
  assertAudit(f, output);
});

test('failed rollback build never starts services and returns checkout, build and version evidence', async () => {
  const f = fixture({ codes: { deploy_build: 17 } });
  const output = await f.registry.run('rollback', f.context);
  assert.equal(output.success, false);
  assert.equal(output.message, 'docker compose build a échoué');
  assert.deepEqual(output.details, {
    build: f.responses.deploy_build,
    checkout: f.responses.git_checkout,
    version: stableVersion
  });
  assert.deepEqual(f.calls.commands, [checkoutRequest, buildRequest]);
  assertAudit(f, output);
});

test('failed rollback up remains unsuccessful with all command evidence', async () => {
  const f = fixture({ codes: { deploy_up: 1 } });
  const output = await f.registry.run('rollback', f.context);
  assert.equal(output.success, false);
  assert.equal(output.message, 'Rollback incomplet');
  assert.deepEqual(output.details, {
    build: f.responses.deploy_build,
    checkout: f.responses.git_checkout,
    up: f.responses.deploy_up,
    version: stableVersion
  });
  assert.deepEqual(f.calls.commands, [
    checkoutRequest,
    buildRequest,
    upRequest
  ]);
  assertAudit(f, output);
});

test('successful rollback keeps checkout, build and up in order and audits success', async () => {
  const f = fixture();
  const output = await f.registry.run('rollback', f.context);
  assert.equal(output.success, true);
  assert.equal(output.message, `Rollback vers ${stableVersion}`);
  assert.deepEqual(output.details, {
    build: f.responses.deploy_build,
    checkout: f.responses.git_checkout,
    up: f.responses.deploy_up,
    version: stableVersion
  });
  assert.deepEqual(f.calls.commands, [
    checkoutRequest,
    buildRequest,
    upRequest
  ]);
  assertAudit(f, output);
});

for (const role of ['viewer', 'operator']) {
  test(`${role} cannot start rollback or read its stable deployment`, async () => {
    const f = fixture({ role });
    const output = await f.registry.run('rollback', f.context);
    assert.equal(output.success, false);
    assert.equal(output.message, 'RBAC: rôle insuffisant pour rollback');
    assert.deepEqual(output.details, { requiredRole: 'admin', role });
    assert.equal(f.calls.stableReads, 0);
    assert.deepEqual(f.calls.commands, []);
    assert.deepEqual(f.calls.actions, []);
    assert.deepEqual(f.calls.deployments, []);
  });
}
