import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('Playwright browser E2E is wired to the local Docker stack', () => {
  const pkg = JSON.parse(read('package.json'));
  const config = read('playwright.config.ts');
  const dockerUp = read('scripts/playwright-docker-up.mjs');
  const smokeSpec = read('tests/playwright/docker-public-smoke.spec.ts');

  assert.equal(
    pkg.scripts['docker:playwright'],
    'node scripts/docker-ready.mjs -- node scripts/playwright-docker-up.mjs'
  );
  assert.equal(
    pkg.scripts['test:e2e:playwright'],
    'yarn docker:playwright && yarn db:migrate && yarn test:e2e:seed && playwright test'
  );
  assert.equal(
    pkg.scripts['db:migrate'],
    'node scripts/docker-ready.mjs -- node scripts/db-migrate.mjs'
  );
  assert.equal(
    pkg.scripts['playwright:install'],
    'playwright install chromium'
  );
  assert.ok(pkg.devDependencies['@playwright/test']);
  assert.ok(config.includes("'http://127.0.0.1:8080'"));
  assert.ok(config.includes("name: 'chromium'"));
  assert.ok(dockerUp.includes('requires Node.js 22 or newer'));
  assert.ok(dockerUp.includes('FUNDING_ADMIN_TOKEN: ADMIN_TOKEN'));
  assert.ok(dockerUp.includes("FUNDING_PLATFORM_ENV: 'development'"));
  assert.ok(dockerUp.includes("STRIPE_SECRET_KEY: ''"));
  assert.ok(dockerUp.includes('DATABASE_URL:'));
  assert.ok(dockerUp.includes('postgres://${POSTGRES_USER}'));
  assert.ok(smokeSpec.includes("page.getByRole('heading'"));
  assert.equal(smokeSpec.includes('.classList'), false);
});
