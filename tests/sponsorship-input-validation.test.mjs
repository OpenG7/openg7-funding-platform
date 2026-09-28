import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSafeSponsorshipText,
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../dist/packages/funding-core/src/sponsorship-validation.js';
import { loadSponsorMediaLimits } from '../dist/apps/funding-api/src/sponsor-media-limits.js';
import {
  loadTrustedProxyHops,
  requestClientIp
} from '../dist/apps/funding-api/src/request-client-ip.js';

test('sponsorship fields preserve international names and multiline messages, but reject control characters', () => {
  assert.equal(isSafeSponsorshipText("Équipe O'Brian — 建設"), true);
  assert.equal(isSafeSponsorshipText('Line one\nLine two\tend', true), true);
  for (const value of ['Company\0Name', 'Name\nHeader', 'Name\x7f', 123, null])
    assert.equal(isSafeSponsorshipText(value), false);
  for (const email of ['camille+fund@example.test', "o'brian@example.test"])
    assert.equal(isSponsorshipEmail(email), true);
  for (const email of [
    'a..b@example.test',
    '.a@example.test',
    'a\0@example.test',
    'a@localhost',
    'a@-example.test',
    'a'.repeat(65) + '@example.test'
  ])
    assert.equal(isSponsorshipEmail(email), false, email);
});

test('company links reject credentials, local addresses and URL parser normalization of controls', () => {
  for (const value of [
    '',
    null,
    undefined,
    ' https://example.test/path?q=1 ',
    'https://équipe.example/'
  ])
    assert.equal(isSponsorshipHttpsUrl(value), true);
  for (const value of [
    'https://user:pass@example.test/',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://app.local/',
    'https://app.localhost/',
    'https://localhost/',
    'https://exam\nple.test/',
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'https://example.test/' + 'x'.repeat(2048)
  ])
    assert.equal(isSponsorshipHttpsUrl(value), false, value);
});

test('media settings fail closed when invalid or incompatible with the proxy envelope', () => {
  assert.deepEqual(loadSponsorMediaLimits({}), {
    maxUploadBytes: 8388608,
    maxSupportingImages: 3
  });
  assert.equal(
    loadSponsorMediaLimits({ FUNDING_SPONSOR_MEDIA_MAX_BYTES: '1024' })
      .maxUploadBytes,
    1024
  );
  for (const value of ['', '0', '-1', '1.5', 'invalid', '8388609', 'Infinity'])
    assert.throws(() =>
      loadSponsorMediaLimits({ FUNDING_SPONSOR_MEDIA_MAX_BYTES: value })
    );
  for (const value of ['0', '-1', '1.5', '9007199254740992'])
    assert.throws(() =>
      loadSponsorMediaLimits({
        FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES: value
      })
    );
});

test('request quotas ignore spoofed forwarding headers unless proxy hops are explicitly configured', () => {
  const request = {
    socket: { remoteAddress: '192.0.2.10' },
    headers: {
      'x-forwarded-for': '198.51.100.1, 203.0.113.2',
      'x-real-ip': '198.51.100.7'
    }
  };
  assert.equal(loadTrustedProxyHops(undefined), 0);
  assert.equal(requestClientIp(request, 0), '192.0.2.10');
  assert.equal(requestClientIp(request, 1), '203.0.113.2');
  request.headers['x-forwarded-for'] = '198.51.100.99, 203.0.113.2';
  assert.equal(requestClientIp(request, 1), '203.0.113.2');
  request.headers['x-forwarded-for'] = 'invalid';
  assert.equal(requestClientIp(request, 1), '192.0.2.10');
  for (const value of ['-1', '1.5', '9', 'NaN'])
    assert.throws(() => loadTrustedProxyHops(value));
});
