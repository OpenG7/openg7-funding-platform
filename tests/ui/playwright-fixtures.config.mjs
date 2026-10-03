import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Built Web and intercepted APIs only. No API process, .env, seed or teardown.
export function defineBuiltWebSuite(suite) {
  return defineConfig({
    testDir: './playwright',
    workers: 1,
    retries: 0,
    timeout: 30000,
    expect: { timeout: 7000 },
    reporter: 'list',
    use: {
      baseURL: 'http://127.0.0.1:4179',
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure'
    },
    webServer: {
      command: '"' + process.execPath + '" tests/ui/serve-built-web.mjs',
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      url: 'http://127.0.0.1:4179',
      reuseExistingServer: false
    },
    ...suite
  });
}

export function definePublicPageSuite(suite) {
  return defineBuiltWebSuite({
    expect: { timeout: 7500 },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }
    ],
    ...suite
  });
}

export function publicJourneyProjects() {
  return [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }
  ];
}
