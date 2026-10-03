import assert from 'node:assert/strict';
import { sep } from 'node:path';
import test from 'node:test';

import { discoverPlaywright as discover } from './ui/discover-playwright.mjs';

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
