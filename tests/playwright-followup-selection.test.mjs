import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { sep } from 'node:path';
import test from 'node:test';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

// Ask Playwright to discover tests without starting browsers, servers or teardown.
// This catches lost coverage and duplicate execution across the real configs.
function discover(config, isolated = false) {
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
  const specs = (suite) => [
    ...(suite.specs ?? []),
    ...(suite.suites ?? []).flatMap(specs)
  ];
  return { specs: specs(report), projects: report.config.projects };
}

test('follow-up fixtures run once in isolation while persisted journeys remain in Docker', () => {
  const fixtures = new Set([
    'sponsorship-followup.spec.ts',
    'sponsor-media-upload-feedback.spec.ts'
  ]);
  const followup = discover('tests/playwright-followup-ui.config.mjs');
  assert.deepEqual(new Set(followup.specs.map((spec) => spec.file)), fixtures);
  for (const spec of followup.specs) {
    assert.equal(spec.tests.length, 1, spec.title);
    assert.equal(
      spec.tests[0].projectName,
      spec.title.includes('@mobile') ? 'mobile-chrome' : 'chromium'
    );
  }
  for (const isolated of [false, true]) {
    const docker = discover('playwright.config.ts', isolated);
    assert.equal(
      docker.specs.some((spec) => fixtures.has(spec.file)),
      false
    );
    for (const file of [
      'sponsor-navigation.spec.ts',
      'sponsor-rejected-state.spec.ts'
    ])
      assert.ok(
        docker.specs.some((spec) => spec.file === file),
        file
      );
    for (const { outputDir: dockerOutput } of docker.projects) {
      for (const { outputDir: followupOutput } of followup.projects) {
        assert.notEqual(dockerOutput, followupOutput);
        assert.equal(
          followupOutput.startsWith(dockerOutput + sep),
          false,
          'Docker must not clean up the isolated suite artifacts'
        );
      }
    }
  }
});
