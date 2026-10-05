import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolRegistry } from '../dist/apps/production-launch-agent/src/tools/tool-registry.js';
import {
  currentRevision,
  productionLaunchFixture,
  selectedRevision,
  stableRevision
} from './support/production-launch-fixture.mjs';

const run = (tool, options) => {
  const f = productionLaunchFixture(options);
  return { ...f, completion: new ToolRegistry().run(tool, f.context) };
};

test('deploy selects the full post-pull revision, runs the canonical runner and records only a candidate', async () => {
  const f = run('deploy');
  const output = await f.completion;
  assert.equal(output.success, true);
  assert.equal(output.details.qualified, true);
  assert.equal(output.details.version, selectedRevision);
  assert.deepEqual(f.calls.commands, [
    { key: 'git_current_sha' },
    { key: 'deploy_pull' },
    { key: 'git_current_sha' },
    { key: 'deploy_run', params: { sha: selectedRevision } },
    { key: 'git_current_sha' }
  ]);
  assert.deepEqual(f.calls.deployments, [
    { status: 'candidate', version: selectedRevision }
  ]);
  assert.equal(f.calls.actions.length, 1);
});

test('failed or changed deployment revisions stop qualification and never enter stable history', async (t) => {
  for (const scenario of [
    { codes: { 'git_current_sha:1': 1 }, noRunner: true },
    { revisions: ['abcdef0'], noRunner: true },
    { codes: { deploy_pull: 1 }, noRunner: true },
    { codes: { 'git_current_sha:2': 1 }, noRunner: true },
    { revisions: [currentRevision, 'A'.repeat(40)], noRunner: true },
    { codes: { deploy_run: 17 } },
    { codes: { 'git_current_sha:3': 1 } },
    { revisions: [currentRevision, selectedRevision, stableRevision] }
  ]) {
    await t.test(JSON.stringify(scenario), async () => {
      const f = run('deploy', scenario);
      const output = await f.completion;
      assert.equal(output.success, false);
      assert.deepEqual(f.calls.deployments, []);
      if (scenario.noRunner)
        assert.equal(
          f.calls.commands.some((call) => call.key === 'deploy_run'),
          false
        );
      assert.equal(f.calls.actions[0].success, false);
    });
  }
});

test('rollback excludes the current checkout and sends the recorded full revision to the canonical runner', async () => {
  const f = run('rollback');
  const output = await f.completion;
  assert.equal(output.success, true);
  assert.deepEqual(f.calls.stableReads, [currentRevision]);
  assert.deepEqual(f.calls.commands, [
    { key: 'git_current_sha' },
    { key: 'rollback_run', params: { sha: stableRevision } }
  ]);
  assert.equal(output.details.version, stableRevision);
  assert.equal(output.details.qualified, true);
  assert.deepEqual(f.calls.deployments, []);
  assert.equal(f.calls.actions[0].success, true);
});

test('rollback refuses unknown revisions or missing history before any image restoration', async (t) => {
  for (const scenario of [
    { codes: { git_current_sha: 1 } },
    { revisions: ['abcdef0'] },
    { stable: null },
    { stable: '$(printf synthetic)' },
    { stable: 'A'.repeat(40) },
    { stable: stableRevision + '\n' }
  ]) {
    await t.test(JSON.stringify(scenario), async () => {
      const f = run('rollback', scenario);
      assert.equal((await f.completion).success, false);
      assert.equal(
        f.calls.commands.some((call) => call.key === 'rollback_run'),
        false
      );
      assert.deepEqual(f.calls.deployments, []);
    });
  }
});

test('a failed rollback runner is never qualified or recorded as a stable deployment', async () => {
  const f = run('rollback', { codes: { rollback_run: 1 } });
  const output = await f.completion;
  assert.equal(output.success, false);
  assert.equal(output.details.qualified, false);
  assert.deepEqual(f.calls.deployments, []);
  assert.equal(f.calls.actions[0].success, false);
});

test('dry-run deployment and rollback never read stable history or record a deployment', async (t) => {
  for (const tool of ['deploy', 'rollback']) {
    await t.test(tool, async () => {
      const f = run(tool, { execute: false });
      const output = await f.completion;
      assert.equal(output.success, true);
      assert.equal(output.details.simulated, true);
      assert.deepEqual(f.calls.stableReads, []);
      assert.deepEqual(f.calls.deployments, []);
      assert.equal(
        f.calls.commands.find((call) => call.key.endsWith('_run')).params.sha,
        '0'.repeat(40)
      );
    });
  }
});

test('roles stop deployment and rollback before invoking commands or reading history', async (t) => {
  for (const [role, tool] of [
    ['viewer', 'deploy'],
    ['viewer', 'rollback'],
    ['operator', 'rollback']
  ]) {
    await t.test(`${role} ${tool}`, async () => {
      const f = run(tool, { role });
      assert.equal((await f.completion).success, false);
      assert.deepEqual(f.calls.commands, []);
      assert.deepEqual(f.calls.stableReads, []);
      assert.deepEqual(f.calls.actions, []);
      assert.deepEqual(f.calls.deployments, []);
    });
  }
});
