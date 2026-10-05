import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolRegistry } from '../dist/apps/production-launch-agent/src/tools/tool-registry.js';
import { WorkflowEngine } from '../dist/apps/production-launch-agent/src/workflows/workflow-engine.js';
import {
  productionLaunchFixture,
  selectedRevision,
  stableRevision
} from './support/production-launch-fixture.mjs';

const checklist = (delivery = 'deploy') => ({
  name: 'synthetic-delivery',
  steps: ['check_docker', delivery, 'check_health', 'generate_report'].map(
    (tool) => ({ tool })
  )
});
const run = (f, delivery = 'deploy') =>
  new WorkflowEngine(new ToolRegistry()).run(checklist(delivery), f.context);

test('stable qualification follows successful delivery, every remaining check and written audited report', async (t) => {
  for (const delivery of ['deploy', 'rollback']) {
    await t.test(delivery, async () => {
      const f = productionLaunchFixture();
      const report = await run(f, delivery);
      assert.equal(report.success, true);
      assert.deepEqual(
        report.results.map((item) => item.tool),
        checklist(delivery).steps.map((item) => item.tool)
      );
      assert.deepEqual(
        f.calls.deployments,
        delivery === 'deploy'
          ? [
              { status: 'candidate', version: selectedRevision },
              { status: 'stable', version: selectedRevision }
            ]
          : [{ status: 'stable', version: stableRevision }]
      );
      assert.ok(
        f.calls.events.indexOf('deployment:stable') >
          f.calls.events.indexOf('report:write')
      );
      assert.ok(
        f.calls.events.indexOf('deployment:stable') >
          f.calls.events.indexOf('report:record')
      );
    });
  }
});

test('a failed prerequisite prevents deployment and a failed later check keeps only its candidate', async (t) => {
  for (const failure of ['check_docker', 'check_health']) {
    await t.test(failure, async () => {
      const f = productionLaunchFixture({ codes: { [failure]: 1 } });
      const report = await run(f);
      assert.equal(report.success, false);
      assert.equal(report.results.at(-1).tool, failure);
      assert.equal(
        report.results.some((item) => item.tool === 'generate_report'),
        false
      );
      assert.equal(
        f.calls.deployments.some((item) => item.status === 'stable'),
        false
      );
      if (failure === 'check_docker') assert.deepEqual(f.calls.deployments, []);
      else
        assert.deepEqual(f.calls.deployments, [
          { status: 'candidate', version: selectedRevision }
        ]);
      assert.equal(f.calls.incidents.length, 1);
      assert.equal(f.calls.reports[0].success, false);
    });
  }
});

test('failed report generation or audit never promotes a previously deployed candidate', async (t) => {
  for (const options of [
    { reportFailure: true },
    { reportAuditFailure: true }
  ]) {
    await t.test(JSON.stringify(options), async () => {
      const f = productionLaunchFixture(options);
      await assert.rejects(run(f), /Synthetic report/);
      assert.deepEqual(f.calls.deployments, [
        { status: 'candidate', version: selectedRevision }
      ]);
    });
  }
});

test('even a successful dry-run checklist cannot qualify deployment or rollback history', async (t) => {
  for (const delivery of ['deploy', 'rollback']) {
    await t.test(delivery, async () => {
      const f = productionLaunchFixture({ execute: false });
      assert.equal((await run(f, delivery)).success, true);
      assert.deepEqual(f.calls.deployments, []);
      assert.deepEqual(f.calls.stableReads, []);
    });
  }
});

test('stable qualification requires an explicit qualified result with exactly one full commit SHA', async (t) => {
  for (const details of [
    {},
    { qualified: false, version: selectedRevision },
    { qualified: 'true', version: selectedRevision },
    { qualified: true, version: 'abcdef0' },
    { qualified: true, version: 'A'.repeat(40) },
    { qualified: true, version: selectedRevision + '\n' }
  ]) {
    await t.test(JSON.stringify(details), async () => {
      const f = productionLaunchFixture();
      const engine = new WorkflowEngine({
        async run(tool) {
          return {
            tool,
            details,
            success: true,
            message: 'Synthetic delivery'
          };
        }
      });
      const report = await engine.run(
        { name: 'synthetic-delivery', steps: [{ tool: 'deploy' }] },
        f.context
      );
      assert.equal(report.success, true);
      assert.deepEqual(f.calls.deployments, []);
    });
  }
});

test('a failed generate_report tool stops subsequent actions and prevents stable qualification', async () => {
  const f = productionLaunchFixture();
  const real = new ToolRegistry();
  const engine = new WorkflowEngine({
    async run(tool, context, params) {
      if (tool === 'generate_report')
        return {
          tool,
          success: false,
          message: 'Synthetic report failure',
          details: {}
        };
      return real.run(tool, context, params);
    }
  });
  const plan = checklist();
  plan.steps.push({ tool: 'restart_service', params: { service: 'api' } });
  const report = await engine.run(plan, f.context);
  assert.equal(report.success, false);
  assert.equal(report.results.at(-1).tool, 'generate_report');
  assert.equal(
    f.calls.commands.some((call) => call.key === 'restart_service'),
    false
  );
  assert.deepEqual(f.calls.deployments, [
    { status: 'candidate', version: selectedRevision }
  ]);
});
