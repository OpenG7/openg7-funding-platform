import assert from 'node:assert/strict';

export const stableRevision = 'a'.repeat(40);
export const currentRevision = 'b'.repeat(40);
export const selectedRevision = 'c'.repeat(40);

/** Synthetic ports only: no CLI/config loader, network, SSH or Docker. */
export const productionLaunchFixture = ({
  role = 'admin',
  execute = true,
  stable = stableRevision,
  revisions = [currentRevision, selectedRevision, selectedRevision],
  codes = {},
  reportFailure = false,
  reportAuditFailure = false
} = {}) => {
  const calls = {
    commands: [],
    stableReads: [],
    actions: [],
    deployments: [],
    incidents: [],
    reports: [],
    events: []
  };
  let revisionReads = 0;
  const context = {
    config: { role, reportDir: '/synthetic/reports' },
    execute,
    memory: {
      lastStableDeployment(excluded) {
        calls.stableReads.push(excluded);
        return stable;
      },
      recordAction(action) {
        calls.actions.push(action);
      },
      recordDeployment(deployment) {
        calls.deployments.push(deployment);
        calls.events.push(`deployment:${deployment.status}`);
      },
      recordIncident(incident) {
        calls.incidents.push(incident);
      },
      recordReport(report) {
        calls.events.push('report:record');
        if (reportAuditFailure)
          throw new Error('Synthetic report audit failure');
        calls.reports.push(report);
      },
      close() {
        assert.fail('Workflow must not close injected memory');
      }
    },
    reporter: {
      async write() {
        calls.events.push('report:write');
        if (reportFailure) throw new Error('Synthetic report write failure');
        return {
          jsonPath: '/synthetic/report.json',
          markdownPath: '/synthetic/report.md'
        };
      }
    },
    async runCommand(request) {
      calls.commands.push(request);
      const occurrence = calls.commands.filter(
        (call) => call.key === request.key
      ).length;
      const code =
        codes[`${request.key}:${occurrence}`] ?? codes[request.key] ?? 0;
      const stdout =
        request.key === 'git_current_sha'
          ? (revisions[revisionReads++] ?? revisions.at(-1))
          : 'Synthetic command completed';
      return {
        command: `synthetic ${request.key}`,
        code,
        stderr: code ? 'Synthetic command failure' : '',
        stdout: stdout ?? ''
      };
    }
  };
  return { calls, context };
};
