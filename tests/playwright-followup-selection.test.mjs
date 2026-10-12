import assert from 'node:assert/strict';
import { sep } from 'node:path';
import test from 'node:test';

import { discoverPlaywright as discover } from './ui/discover-playwright.mjs';

test('follow-up fixtures run once in isolation while persisted journeys remain in Docker', () => {
  const fixtures = new Set([
    'sponsorship-followup.spec.ts',
    'sponsorship-moderation-followup.spec.ts',
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

test('funding-home and offer fixtures run once in their dedicated suite and stay outside both Docker selections', () => {
  const fixtures = new Map([
    ['funding-home-trust.spec.ts', 26],
    ['payment-recovery-ui.spec.ts', 8],
    ['sponsorship-offer-ui.spec.ts', 10]
  ]);
  const home = discover('tests/playwright/home-trust.config.ts');
  assert.deepEqual(
    new Set(home.specs.map((spec) => spec.file)),
    new Set(fixtures.keys())
  );
  for (const [file, expectedCount] of fixtures) {
    const specs = home.specs.filter((spec) => spec.file === file);
    assert.equal(specs.length, expectedCount, file);
    for (const spec of specs) assert.equal(spec.tests.length, 1, spec.title);
  }
  for (const isolated of [false, true]) {
    const docker = discover('playwright.config.ts', isolated);
    assert.equal(
      docker.specs.some((spec) => fixtures.has(spec.file)),
      false
    );
    assert.ok(
      docker.specs.some(
        (spec) => spec.file === 'sponsorship-publication-acceptance.spec.ts'
      )
    );
    for (const { outputDir: dockerOutput } of docker.projects) {
      for (const { outputDir: homeOutput } of home.projects) {
        assert.notEqual(dockerOutput, homeOutput);
        assert.equal(
          homeOutput.startsWith(dockerOutput + sep),
          false,
          'Docker must preserve the dedicated suite artifacts.'
        );
      }
    }
  }
});
