import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

// Discover the actual selection without browsers, servers, seed or teardown.
export function discoverPlaywright(config, isolated = false) {
  const env = { ...process.env, OPENG7_E2E_ISOLATED: isolated ? '1' : '0' };
  for (const key of [
    'PLAYWRIGHT_JSON_OUTPUT_DIR',
    'PLAYWRIGHT_JSON_OUTPUT_NAME',
    'PLAYWRIGHT_JSON_OUTPUT_FILE'
  ])
    delete env[key];
  const report = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, 'test', '--list', '--reporter=json', '--config', config],
      { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true }
    )
  );
  assert.deepEqual(report.errors, []);
  const specs = (suite, parents = []) => {
    const titles = suite.title ? [...parents, suite.title] : parents;
    return [
      ...(suite.specs ?? []).map((spec) => ({
        ...spec,
        titlePath: [...titles, spec.title]
      })),
      ...(suite.suites ?? []).flatMap((child) => specs(child, titles))
    ];
  };
  return { specs: specs(report), projects: report.config.projects };
}
