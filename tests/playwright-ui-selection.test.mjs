import assert from 'node:assert/strict';
import { sep } from 'node:path';
import test from 'node:test';

import { discoverPlaywright } from './ui/discover-playwright.mjs';

const publicPages = [
  ['about', ['funding-about.spec.ts']],
  ['sponsors', ['sponsors-public.spec.ts']],
  ['transparency', ['funding-transparency-public.spec.ts']],
  ['boutique', ['boutique.spec.ts']]
];

function assertBrowserMatrix(specs, projects) {
  const selections = new Map();
  for (const spec of specs) {
    const key = JSON.stringify([
      spec.file,
      spec.line,
      spec.column,
      spec.titlePath
    ]);
    const selected = selections.get(key) ?? [];
    selected.push(...spec.tests.map((item) => item.projectName));
    selections.set(key, selected);
  }
  for (const [spec, selected] of selections)
    assert.deepEqual(selected.sort(), [...projects].sort(), spec);
}

test('isolated public page suites keep their own coverage and desktop/mobile matrix', () => {
  const outputs = new Set();
  for (const [name, files] of publicPages) {
    const report = discoverPlaywright(`tests/playwright-${name}-ui.config.mjs`);
    assert.deepEqual(
      new Set(report.specs.map((spec) => spec.file)),
      new Set(files)
    );
    assert.deepEqual(
      report.projects.map((project) => project.name),
      ['chromium', 'mobile-chrome']
    );
    assertBrowserMatrix(report.specs, ['chromium', 'mobile-chrome']);
    const output = report.projects[0].outputDir;
    assert.equal(
      outputs.has(output),
      false,
      'suite artifacts must be distinct'
    );
    for (const previous of outputs)
      assert.equal(output.startsWith(previous + sep), false);
    outputs.add(output);
  }
});

test('public journeys and accessibility keep separate selections across four browsers', () => {
  const suites = [
    [
      'public-journeys',
      [
        'builders-public.spec.ts',
        'public-journeys.spec.ts',
        'support-page.spec.ts',
        'refund-policy.spec.ts'
      ]
    ],
    ['platform-accessibility', ['platform-accessibility.spec.ts']]
  ];
  const projects = ['chromium', 'firefox', 'webkit', 'mobile-webkit'];
  for (const [name, files] of suites) {
    const report = discoverPlaywright(`tests/playwright-${name}.config.mjs`);
    assert.deepEqual(
      new Set(report.specs.map((spec) => spec.file)),
      new Set(files)
    );
    assert.deepEqual(
      report.projects.map((project) => project.name),
      projects
    );
    assertBrowserMatrix(report.specs, projects);
  }
});
