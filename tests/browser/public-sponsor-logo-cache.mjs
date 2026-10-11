import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { chromium } from '@playwright/test';

import {
  createMediaExposureHelpers,
  sponsorLogoPublicUrlForFilename
} from '../../dist/apps/funding-api/src/business-helpers/media-exposure.js';
import { createHttpTransport } from '../../dist/apps/funding-api/src/http-transport.js';
import { createPublicSponsorMediaHttpHandler } from '../../dist/apps/funding-api/src/public-sponsor-media.http.js';

test('a normal browser fetch rechecks legacy logo eligibility after revocation', async () => {
  const filename =
    'sponsor-logo-22222222-2222-4222-8222-222222222222-1727188800000-0123456789abcdef.png';
  const logoPath = sponsorLogoPublicUrlForFilename(filename);
  const bytes = Buffer.from('Synthetic previously approved logo bytes');
  let visible = true;
  let checks = 0;
  let reads = 0;
  const helpers = createMediaExposureHelpers({
    publicBaseOrigin: 'http://127.0.0.1',
    sponsorLogoStorage: {
      deleteLogo: async () => assert.fail('Unexpected logo deletion.')
    },
    sponsorMediaStorage: {
      driver: 'local',
      deletePrivateObject: async () =>
        assert.fail('Unexpected private cleanup.'),
      deletePublicObject: async () => assert.fail('Unexpected public cleanup.')
    },
    reportWarning: assert.fail
  });
  const transport = createHttpTransport({
    isProduction: false,
    allowedOrigins: []
  });
  const handler = createPublicSponsorMediaHttpHandler({
    databaseAvailable: () => true,
    ...transport,
    ...helpers,
    sponsorLogoPublicUrlForFilename,
    getApprovedPublicSponsorMedia: async () =>
      assert.fail('Unexpected modern media lookup.'),
    sponsorMediaStorage: {
      readPrivateObject: async () =>
        assert.fail('Unexpected modern media read.')
    },
    isPublicApprovedSponsorshipLogoUrl: async (url) => {
      assert.equal(url, logoPath);
      checks++;
      return visible;
    },
    sponsorLogoStorage: {
      readLogo: async (file) => {
        assert.equal(file, filename);
        reads++;
        return bytes;
      }
    },
    reportFailure: (...args) => assert.fail(JSON.stringify(args))
  });
  const server = createServer(async (request, response) => {
    if (request.url === '/fixture') {
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store'
      });
      response.end(
        '<!doctype html><title>Synthetic legacy logo fixture</title>'
      );
      return;
    }
    if (!(await handler(request, response))) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    const fetchLogo = () =>
      page.evaluate(async (path) => {
        const response = await fetch(path);
        return {
          status: response.status,
          body: await response.text(),
          cacheControl: response.headers.get('cache-control')
        };
      }, logoPath);

    const first = await fetchLogo();
    assert.equal(first.status, 200);
    assert.equal(first.body, bytes.toString());
    assert.equal(first.cacheControl, 'no-store');
    assert.equal(checks, 1);
    assert.equal(reads, 1);

    visible = false;
    const revoked = await fetchLogo();
    assert.equal(revoked.status, 404);
    assert.notEqual(revoked.body, first.body);
    assert.equal(checks, 2);
    assert.equal(reads, 1);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
