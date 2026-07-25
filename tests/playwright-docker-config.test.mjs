import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('Playwright browser E2E is wired to the local Docker stack', () => {
  const pkg = JSON.parse(read('package.json'));
  const config = read('playwright.config.ts');
  const compose = read('docker-compose.yml');
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
  assert.ok(dockerUp.includes("FUNDING_ADMIN_RATE_LIMIT_MAX: '0'"));
  assert.ok(dockerUp.includes("FUNDING_PLATFORM_ENV: 'development'"));
  assert.ok(dockerUp.includes("SOCIAL_PUBLICATION_MODE: 'mock'"));
  assert.ok(dockerUp.includes('STRIPE_SECRET_KEY: STRIPE_TEST_SECRET_KEY'));
  assert.ok(
    compose.includes(
      'FUNDING_ADMIN_RATE_LIMIT_MAX: ${FUNDING_ADMIN_RATE_LIMIT_MAX:-120}'
    )
  );
  assert.ok(compose.includes('STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-}'));
  assert.ok(
    compose.includes('STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-}')
  );
  assert.ok(dockerUp.includes('DATABASE_URL:'));
  assert.ok(dockerUp.includes('postgres://${POSTGRES_USER}'));
  assert.ok(smokeSpec.includes("page.getByRole('heading'"));
  assert.equal(smokeSpec.includes('.classList'), false);
});

test('Playwright runs a desktop + mobile matrix without duplicating DB-mutating specs', () => {
  const pkg = JSON.parse(read('package.json'));
  const config = read('playwright.config.ts');
  const mobileSpec = read('tests/playwright/mobile-public-responsive.spec.ts');

  // Two projects: the full desktop suite and a read-only mobile smoke.
  assert.ok(config.includes("name: 'chromium'"));
  assert.ok(config.includes("name: 'mobile-chrome'"));
  assert.ok(config.includes("devices['Desktop Chrome']"));
  assert.ok(config.includes("devices['Pixel 5']"));

  // The @mobile tag routing is what keeps DB-mutating specs desktop-only:
  // desktop greps the tag out, mobile greps it in.
  assert.ok(config.includes('grepInvert: MOBILE_TAG'));
  assert.ok(config.includes('grep: MOBILE_TAG'));

  // Pixel 5 is a Chromium device, so the matrix adds no new browser binary and
  // the install script stays chromium-only.
  assert.equal(
    pkg.scripts['playwright:install'],
    'playwright install chromium'
  );

  // The mobile spec is tagged and stays read-only: it must not pull in the
  // admin-session or signed-webhook helpers that mutate the shared database.
  assert.ok(mobileSpec.includes("tag: '@mobile'"));
  assert.equal(mobileSpec.includes('signInAsAdmin'), false);
  assert.equal(mobileSpec.includes('stripe-webhook'), false);
});
