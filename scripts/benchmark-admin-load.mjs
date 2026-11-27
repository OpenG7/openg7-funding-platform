import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import { promisify } from 'node:util';

import { parseAdminLoadOptions } from './lib/admin-load-profile.mjs';

const root = new URL('../', import.meta.url);
const runFile = promisify(execFile);
try {
  const options = parseAdminLoadOptions(process.argv.slice(2));
  if (!options.run) {
    console.log(
      JSON.stringify(
        {
          mode: 'plan',
          ...options,
          target: 'owned-local-disposable-postgresql',
          scope: 'static-synthetic-backlog-not-contributions-per-day',
          fixture: { sponsorshipShare: 1, obligationsPerDossier: 2 },
          providerCalls: 0,
          productionAccess: false
        },
        null,
        2
      )
    );
  } else {
    if (Number(process.versions.node.split('.')[0]) !== 22)
      throw new Error('Run this benchmark with Node 22.');
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
      schemaVersion: 1,
      definition: 'admin-controlled-load/v1',
      generatedAt: new Date().toISOString(),
      revision: revision.trim(),
      dirty: Boolean(changes.trim()),
      options,
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        logicalCpus: availableParallelism(),
        hostMemoryBytes: totalmem()
      },
      scope: 'static-synthetic-backlog-owned-local-postgresql-no-provider',
      limitations: [
        'not-daily-arrival-throughput',
        'no-http-or-provider-latency',
        'no-human-capacity-measurement',
        'recently-seeded-and-warmed-database',
        'small-sample-percentiles-not-an-slo',
        'instrumented-node-memory-includes-captured-query-metadata'
      ],
      profiles: [],
      completed: false
    };
    const directory = new URL('test-results/', root);
    await mkdir(directory, { recursive: true });
    const save = () =>
      writeFile(
        new URL('admin-controlled-load.json', directory),
        JSON.stringify(report, null, 2) + '\n',
        'utf8'
      );
    await save();
    const { runAdminLoadProfile } =
      await import('../tests/integration/support/admin-controlled-load.mjs');
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
      console.error(
        'Stop requested; bounded reads will drain and the owned test database will close.'
      );
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    for (const dossiers of options.profiles) {
      if (controller.signal.aborted) break;
      console.log(`Controlled load: ${dossiers} synthetic dossiers.`);
      const result = await runAdminLoadProfile(dossiers, options, {
        signal: controller.signal
      });
      report.profiles.push(result);
      await save();
      console.log(
        JSON.stringify({
          dossiers,
          status: result.status,
          phases: result.phases.map((p) => ({
            name: p.name,
            status: p.status,
            ...p.latencies
          }))
        })
      );
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    report.completed = !controller.signal.aborted;
    report.interrupted = controller.signal.aborted;
    await save();
    if (
      report.interrupted ||
      report.profiles.some((profile) => profile.status !== 'passed')
    )
      process.exitCode = 1;
    console.log('Aggregate report: test-results/admin-controlled-load.json');
  }
} catch {
  console.error(
    'Controlled load could not complete. Check bounded options, Node 22, runtime build and the local Docker test image.'
  );
  process.exitCode = 1;
}
