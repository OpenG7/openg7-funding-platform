import assert from 'node:assert/strict';
import test from 'node:test';

import config from './playwright-dev-tools-ui.config.mjs';
import { discoverPlaywright } from './ui/discover-playwright.mjs';

test('the dev tools browser suite selects only its fixtures on desktop and mobile without DB lifecycle hooks', () => {
  const report = discoverPlaywright('tests/playwright-dev-tools-ui.config.mjs');
  assert.deepEqual(
    new Set(report.specs.map((spec) => spec.file)),
    new Set(['dev-tools-pages.spec.ts'])
  );
  assert.deepEqual(
    report.projects.map((project) => project.name),
    ['chromium', 'mobile-chrome']
  );
  assert.equal(config.globalSetup, undefined);
  assert.equal(config.globalTeardown, undefined);
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.url, 'http://127.0.0.1:4179');
  assert.match(config.webServer.command, /tests\/ui\/serve-built-web\.mjs/);
});
