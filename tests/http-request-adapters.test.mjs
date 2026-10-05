import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRouteMatcher,
  firstHeaderValue,
  isJsonContentType
} from '../dist/apps/funding-api/src/http-routing.js';
import {
  parseMultipartBoundary,
  parseMultipartFormData
} from '../dist/apps/funding-api/src/http-multipart.js';
import {
  contentTypeForSponsorLogoFilename,
  parseSponsorLogoUpload,
  SPONSOR_LOGO_FILENAME_PATTERN
} from '../dist/apps/funding-api/src/sponsor-logo-upload.js';

const contributionId = 'ABCDEFAB-1234-4567-89AB-ABCDEFABCDEF';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('JSON media type accepts existing parameters and casing without accepting related formats', () => {
  for (const [header, expected] of [
    ['application/json', true],
    ['APPLICATION/JSON', true],
    ['  Application/Json \t; charset=utf-8', true],
    ['application/json; charset=utf-8; profile="example"', true],
    ['application/json;', true],
    [undefined, false],
    ['', false],
    [' \t', false],
    ['; application/json', false],
    ['text/plain; application/json', false],
    ['application/jsonp', false],
    ['application/json-patch+json', false],
    ['application/ld+json', false],
    ['application/json, application/json', false],
    ['application / json', false]
  ]) {
    assert.equal(isJsonContentType(header), expected, String(header));
  }
});

test('route matching accepts path aliases and query strings without matching another endpoint', () => {
  const { routeMatches, routeStartsWith } = createRouteMatcher(
    'https://example.invalid'
  );
  assert.equal(
    routeMatches(
      '/api/admin/attention?page=2',
      '/admin/attention',
      '/api/admin/attention'
    ),
    true
  );
  assert.equal(
    routeMatches(
      'https://example.invalid/admin/attention?type=invoice_missing',
      '/admin/attention'
    ),
    true
  );
  assert.equal(
    routeMatches('/admin/attention/other', '/admin/attention'),
    false
  );
  assert.equal(routeMatches(undefined, '/admin/attention'), false);
  assert.equal(routeMatches('http://[', 'http://['), true);
  assert.equal(
    routeStartsWith(
      '/api/admin/sponsorships/media/content/asset?id=1',
      '/api/admin/sponsorships/media/content/'
    ),
    true
  );
  assert.equal(
    routeStartsWith('/public/sponsor-media/asset', '/admin/'),
    false
  );
  assert.equal(routeStartsWith('http://[', '/admin/'), false);
  assert.equal(routeStartsWith(undefined, '/admin/'), false);
});

test('multipart boundary parsing preserves first-header selection and rejects missing or oversized boundaries', () => {
  assert.equal(firstHeaderValue(['first', 'second']), 'first');
  assert.equal(firstHeaderValue([]), null);
  assert.equal(firstHeaderValue(undefined), null);
  assert.equal(
    parseMultipartBoundary('multipart/form-data; boundary=sample'),
    'sample'
  );
  assert.equal(
    parseMultipartBoundary('Multipart/Form-Data; boundary="sample"'),
    'sample'
  );
  assert.equal(
    parseMultipartBoundary([
      'multipart/form-data; boundary=first',
      'multipart/form-data; boundary=second'
    ]),
    'first'
  );
  for (const header of [
    undefined,
    [],
    'application/json',
    'multipart/form-data',
    'multipart/form-data; boundary=""',
    `multipart/form-data; boundary=${'x'.repeat(201)}`
  ]) {
    assert.equal(parseMultipartBoundary(header), null);
  }
});

test('multipart parsing preserves binary bytes, field order and supplied metadata', () => {
  const boundary = 'synthetic-boundary';
  const binary = Buffer.concat([png, Buffer.from([0, 255, 13, 10, 0, 13, 10])]);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="contributionId"\r\n\r\n${contributionId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="../../private.php"\r\nContent-Type: IMAGE/PNG\r\n\r\n`
    ),
    binary,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const parts = parseMultipartFormData(body, boundary);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], {
    name: 'contributionId',
    filename: null,
    contentType: null,
    data: Buffer.from(contributionId)
  });
  assert.equal(parts[1].name, 'logo');
  assert.equal(parts[1].filename, '../../private.php');
  assert.equal(parts[1].contentType, 'image/png');
  assert.deepEqual(parts[1].data, binary);
  const logo = parseSponsorLogoUpload(parts, contributionId, binary.length);
  assert.ok(logo);
  assert.match(logo.filename, SPONSOR_LOGO_FILENAME_PATTERN);
  assert.ok(
    logo.filename.startsWith(`sponsor-logo-${contributionId.toLowerCase()}-`)
  );
  assert.equal(logo.filename.includes('private.php'), false);
  assert.equal(logo.filename.includes('/'), false);
  assert.deepEqual(logo.data, binary);
});

test('multipart parameters are identified by name even when filename precedes the field name', () => {
  const body = Buffer.concat([
    Buffer.from(
      '--sample\r\nContent-Disposition: form-data; filename="untrusted.png"; name="logo"\r\nContent-Type: image/png\r\n\r\n'
    ),
    png,
    Buffer.from('\r\n--sample--\r\n')
  ]);
  const parts = parseMultipartFormData(body, 'sample');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'logo');
  assert.equal(parts[0].filename, 'untrusted.png');
  assert.ok(parseSponsorLogoUpload(parts, contributionId, png.length));
});

test('multipart parser ignores segments without a named form field', () => {
  const body = Buffer.from(
    '--sample\r\nNo header separator\r\n--sample\r\nContent-Disposition: form-data; filename="logo.png"\r\n\r\nignored\r\n--sample--\r\n'
  );
  assert.deepEqual(parseMultipartFormData(body, 'sample'), []);
  assert.deepEqual(parseMultipartFormData(Buffer.alloc(0), 'sample'), []);
});

test('logo upload checks signature, declared MIME and byte limit before creating a controlled filename', () => {
  for (const [mimeType, extension, data] of [
    ['image/png', 'png', png],
    ['image/jpeg', 'jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/webp', 'webp', Buffer.from('RIFF0000WEBP', 'ascii')]
  ]) {
    const parts = [
      { name: 'logo', filename: 'untrusted.exe', contentType: mimeType, data }
    ];
    const logo = parseSponsorLogoUpload(parts, contributionId, data.length);
    assert.ok(logo);
    assert.equal(logo.mimeType, mimeType);
    assert.equal(logo.extension, extension);
    assert.equal(logo.sizeBytes, data.length);
    assert.match(logo.filename, SPONSOR_LOGO_FILENAME_PATTERN);
    assert.equal(contentTypeForSponsorLogoFilename(logo.filename), mimeType);
    assert.equal(
      parseSponsorLogoUpload(parts, contributionId, data.length - 1),
      null
    );
  }

  const valid = {
    name: 'logo',
    filename: 'logo.png',
    contentType: 'image/png',
    data: png
  };
  for (const part of [
    { ...valid, name: 'other' },
    { ...valid, filename: null },
    { ...valid, filename: '' },
    { ...valid, data: Buffer.alloc(0) },
    { ...valid, data: Buffer.from('<script>untrusted</script>') },
    { ...valid, contentType: 'image/jpeg' },
    { ...valid, contentType: null }
  ]) {
    assert.equal(parseSponsorLogoUpload([part], contributionId, 512), null);
  }
  assert.equal(contentTypeForSponsorLogoFilename('untrusted.svg'), null);
});
