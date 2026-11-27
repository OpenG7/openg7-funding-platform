import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import {
  parseAssuranceOptions,
  emptyAssuranceEpisodes,
  observeAssuranceEpisodes,
  ASSURANCE_CHECKS
} from './lib/operational-assurance.mjs';

const root = new URL('../', import.meta.url);
try {
  const options = parseAssuranceOptions(process.argv.slice(2));
  if (!options.run)
    console.log(
      JSON.stringify(
        {
          mode: 'plan',
          ...options,
          checks: ASSURANCE_CHECKS,
          target: 'owned-local-disposable-postgresql-and-loopback-receiver',
          externalNotifications: false,
          paidModels: false,
          productionAccess: false
        },
        null,
        2
      )
    );
  else {
    if (Number(process.versions.node.split('.')[0]) !== 22)
      throw new Error('Node 22 required.');
    const runFile = promisify(execFile);
    const { stdout: revision } = await runFile('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      windowsHide: true
    });
    const { stdout: changes } = await runFile(
      'git',
      ['status', '--porcelain'],
      { cwd: root, windowsHide: true }
    );
    const report = {
      definition: 'isolated-operational-assurance/v1',
      generatedAt: new Date().toISOString(),
      revision: revision.trim(),
      dirty: Boolean(changes.trim()),
      runtime: { node: process.version },
      options,
      scope: 'synthetic-local-ports-not-production-health',
      completed: false,
      interrupted: false,
      cycles: [],
      episodes: emptyAssuranceEpisodes(),
      events: [],
      recoveryDurationMs: null
    };
    const directory = new URL('test-results/', root);
    await mkdir(directory, { recursive: true });
    const save = () =>
      writeFile(
        new URL('admin-operational-assurance.json', directory),
        JSON.stringify(report, null, 2) + '\n',
        'utf8'
      );
    await save();
    const { runOperationalAssuranceCycle } =
      await import('../tests/integration/support/operational-assurance.mjs');
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
      console.error(
        'Stop requested; the owned synthetic resources will close after the current check.'
      );
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      for (
        let cycle = 1;
        cycle <= options.cycles && !controller.signal.aborted;
        cycle++
      ) {
        console.log(
          `Isolated operational assurance: cycle ${cycle}/${options.cycles}.`
        );
        const result = await runOperationalAssuranceCycle({
          signal: controller.signal,
          unavailableTransport:
            options.exercise === 'failure-recovery' && cycle <= 2
        });
        report.cycles.push(result);
        if (result.status !== 'interrupted') {
          const observed = observeAssuranceEpisodes(
            report.episodes,
            result.checks,
            result.finishedAt
          );
          report.episodes = observed.state;
          report.events.push(...observed.events);
        }
        await save();
        console.log(
          JSON.stringify({
            cycle,
            status: result.status,
            checks: result.checks.map(({ id, status, code }) => ({
              id,
              status,
              ...(code ? { code } : {})
            })),
            cleanup: result.cleanup
          })
        );
        if (result.cleanup === 'failed') break;
        if (cycle < options.cycles && !controller.signal.aborted) {
          try {
            await setTimeout(options.intervalMs, undefined, {
              signal: controller.signal
            });
          } catch {
            if (!controller.signal.aborted)
              throw new Error('Assurance interval failed.');
          }
        }
      }
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
    report.interrupted = controller.signal.aborted;
    report.completed =
      !report.interrupted && report.cycles.length === options.cycles;
    await save();
    if (
      !report.completed ||
      report.cycles.some((cycle) => cycle.status !== 'passed')
    )
      process.exitCode = 1;
    console.log(
      'Aggregate report: test-results/admin-operational-assurance.json'
    );
  }
} catch {
  console.error(
    'Operational assurance could not complete. Check bounded options, Node 22, runtime build and the local Docker test image.'
  );
  process.exitCode = 1;
}
