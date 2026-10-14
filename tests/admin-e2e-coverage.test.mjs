import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  declaredAdminRoutes,
  activeAdminScenarios,
  validateAdminCoverage
} from '../scripts/lib/admin-e2e-coverage.mjs';

const routes = ['/admin/fundraiser'];
const selected = [
  {
    file: 'tests/identity/example.spec.ts',
    title: 'real journey',
    config: 'tests/playwright-identity.config.mjs'
  }
];
const registry = () => ({
  version: 1,
  routes: [...routes],
  guarantees: Array.from({ length: 17 }, (_, index) => ({
    id: 'A' + String(index + 1).padStart(2, '0'),
    routes: [...routes],
    roles: ['owner'],
    states: ['ready', 'denied'],
    evidence: [
      {
        level: 'e2e',
        file: 'tests/identity/example.spec.ts',
        title: 'real journey'
      }
    ]
  }))
});

test('admin coverage rejects missing routes, guarantees, skipped evidence and simulated suites', () => {
  assert.deepEqual(validateAdminCoverage(registry(), routes, selected, '.'), {
    routes: 1,
    guarantees: 17
  });
  for (const change of [
    (item) => item.routes.push('/admin/unknown'),
    (item) => item.guarantees.pop(),
    (item) => (item.guarantees[0].roles = []),
    (item) => (item.guarantees[0].evidence[0].title = 'unselected journey'),
    (item) => (item.guarantees[0].evidence[0].file = '../outside.spec.ts')
  ]) {
    const item = registry();
    change(item);
    assert.throws(() => validateAdminCoverage(item, routes, selected, '.'));
  }
  assert.throws(() =>
    validateAdminCoverage(
      registry(),
      routes,
      [{ ...selected[0], config: 'tests/playwright-admin-ui.config.mjs' }],
      '.'
    )
  );
  const unlinked = registry();
  unlinked.routes.push('/admin/new-capability');
  assert.throws(
    () =>
      validateAdminCoverage(
        unlinked,
        [...routes, '/admin/new-capability'],
        selected,
        '.'
      ),
    /no linked guarantee/
  );
  const report = {
    config: { rootDir: process.cwd() },
    suites: [
      {
        specs: [
          {
            file: 'tests/identity/example.spec.ts',
            title: 'real journey',
            tests: [{ expectedStatus: 'skipped' }]
          },
          {
            file: 'tests/identity/example.spec.ts',
            title: 'known failure',
            tests: [{ expectedStatus: 'failed' }]
          }
        ]
      }
    ]
  };
  assert.deepEqual(
    activeAdminScenarios(report, process.cwd(), 'playwright.config.ts'),
    []
  );
});

test('admin route coverage follows declarations and the publication matcher spaces', () => {
  const source = readFileSync(
    'apps/funding-web/src/app/admin.routes.ts',
    'utf8'
  );
  const discovered = declaredAdminRoutes(source);
  assert.equal(discovered.length, 20);
  assert.ok(discovered.includes('/admin/fundraiser/publications/calendar'));
  const extra = source.replace(
    "path: 'fundraiser/access'",
    "path: 'fundraiser/new-capability'"
  );
  assert.ok(
    declaredAdminRoutes(extra).includes('/admin/fundraiser/new-capability')
  );
  assert.ok(!declaredAdminRoutes(extra).includes('/admin/fundraiser/access'));
});
