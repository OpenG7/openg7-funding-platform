import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestRateLimit } from '../dist/apps/funding-api/src/http-rate-limit.js';

const request = (
  url,
  { method = 'GET', peer = '192.0.2.1', forwarded } = {}
) => ({
  url,
  method,
  headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  socket: { remoteAddress: peer }
});

const fixture = (overrides = {}) => {
  let now = 1000;
  const writes = [];
  const enforce = createRequestRateLimit(
    {
      publicBaseOrigin: 'https://example.invalid',
      trustedProxyHops: 0,
      rateLimitWindowMs: 1500,
      publicWriteRateLimitMax: 1,
      sponsorshipFollowupRateLimitMax: 1,
      referenceLookupRateLimitMax: 1,
      referenceRecoveryRateLimitMax: 1,
      adminRateLimitMax: 1,
      ...overrides
    },
    (_request, _response, status, payload, headers) =>
      writes.push({ status, payload, headers }),
    () => now
  );
  return {
    enforce: (input) => enforce(input, {}),
    writes,
    setNow: (value) => {
      now = value;
    }
  };
};

test('HTTP aliases share the same per-IP bucket and return the existing 429 response', () => {
  const limiter = fixture();
  assert.equal(
    limiter.enforce(request('/checkout-sessions', { method: 'POST' })),
    true
  );
  assert.equal(
    limiter.enforce(
      request('/api/checkout-sessions?campaign=synthetic', { method: 'POST' })
    ),
    false
  );
  assert.deepEqual(limiter.writes, [
    {
      status: 429,
      payload: { error: 'Too many requests. Please retry later.' },
      headers: { 'Retry-After': '2' }
    }
  ]);
  assert.equal(
    limiter.enforce(
      request('/api/checkout-sessions', { method: 'POST', peer: '192.0.2.2' })
    ),
    true
  );
});

test('rate-limit groups keep recovery, lookup, follow-up, checkout and administration independent', () => {
  const limiter = fixture();
  for (const [first, second, method] of [
    ['/checkout-sessions', '/api/checkout-sessions', 'POST'],
    ['/reference-lookup', '/api/reference-lookup', 'POST'],
    ['/reference-recovery', '/api/sponsorship-followup/recover', 'POST'],
    [
      '/sponsorship-followup/draft',
      '/api/sponsorship-followup/media/content/asset',
      'GET'
    ],
    ['/admin/session', '/api/admin/sponsorships/refund', 'POST']
  ]) {
    assert.equal(limiter.enforce(request(first, { method })), true, first);
    assert.equal(limiter.enforce(request(second, { method })), false, second);
  }
  assert.equal(limiter.writes.length, 5);
});

test('legacy sponsorship details writes share the Checkout quota across aliases', () => {
  for (const path of ['/sponsorship-details', '/api/sponsorship-details']) {
    const limiter = fixture();
    assert.equal(limiter.enforce(request(path, { method: 'POST' })), true);
    assert.equal(
      limiter.enforce(request('/api/checkout-sessions', { method: 'POST' })),
      false
    );
    assert.equal(limiter.writes.at(-1).status, 429);
    assert.equal(limiter.enforce(request(path, { method: 'GET' })), true);
  }
});

test('identity routes and admin media reads share the admin limit regardless of HTTP method', () => {
  for (const [first, second] of [
    ['/admin/auth/config', '/api/admin/auth/callback'],
    ['/admin/access', '/api/admin/sponsorships/media/content/asset'],
    ['/admin/pilotage/receipt', '/api/admin/sponsorship-invoices/pdf'],
    ['/api/admin/publication-automation/media', '/admin/expenses/update'],
    ['/admin/backups', '/api/admin/backups'],
    ['/admin/allocations', '/api/admin/allocations/update'],
    [
      '/admin/contribution-activity',
      '/api/admin/contribution-activity/present'
    ],
    ['/admin/sponsorships/website-visibility', '/api/admin/new-action']
  ]) {
    const limiter = fixture();
    assert.equal(limiter.enforce(request(first)), true, first);
    assert.equal(
      limiter.enforce(request(second, { method: 'POST' })),
      false,
      second
    );
  }
});

test('rate-limit memory remains bounded without resetting existing client quotas', () => {
  const limiter = fixture({ adminRateLimitMax: 2 });
  for (let i = 0; i < 5000; i++)
    assert.equal(
      limiter.enforce(request('/admin/dashboard', { peer: `2001:db8::${i}` })),
      true
    );
  for (let i = 5000; i < 5010; i++)
    assert.equal(
      limiter.enforce(request('/admin/dashboard', { peer: `2001:db8::${i}` })),
      false
    );
  assert.equal(limiter.writes.at(-1).status, 429);
  assert.equal(limiter.writes.at(-1).headers['Retry-After'], '2');
  const existing = request('/api/admin/dashboard', { peer: '2001:db8::0' });
  assert.equal(limiter.enforce(existing), true);
  assert.equal(limiter.enforce(existing), false);
  assert.equal(
    limiter.enforce(request('/checkout-sessions', { method: 'POST' })),
    true
  );
  limiter.setNow(2499);
  const newcomer = request('/admin/dashboard', { peer: '2001:db8::new' });
  assert.equal(limiter.enforce(newcomer), false);
  assert.equal(limiter.writes.at(-1).headers['Retry-After'], '1');
  limiter.setNow(2500);
  assert.equal(limiter.enforce(newcomer), true);
  assert.equal(limiter.enforce(existing), true);
});

test('new clients reclaim expired buckets while active clients keep their counters', () => {
  const limiter = fixture();
  for (let i = 0; i < 4999; i++)
    assert.equal(
      limiter.enforce(request('/admin/dashboard', { peer: `2001:db8::${i}` })),
      true
    );
  limiter.setNow(2000);
  const active = request('/admin/dashboard', { peer: '2001:db8::active' });
  assert.equal(limiter.enforce(active), true);
  limiter.setNow(2500);
  const newcomer = request('/admin/dashboard', { peer: '2001:db8::new' });
  assert.equal(limiter.enforce(newcomer), true);
  assert.equal(limiter.enforce(active), false);
  assert.equal(limiter.writes.at(-1).headers['Retry-After'], '1');
});

test('non-limited routes and non-writing checkout methods do not consume a write bucket', () => {
  const limiter = fixture();
  for (const input of [
    request('/health'),
    request('/stripe/webhook', { method: 'POST' }),
    request('/checkout-sessions'),
    request('/reference-lookup'),
    request('/reference-recovery'),
    request('/public/sponsor-media/asset'),
    request(undefined)
  ]) {
    assert.equal(limiter.enforce(input), true);
    assert.equal(limiter.enforce(input), true);
  }
  assert.equal(
    limiter.enforce(request('/checkout-sessions', { method: 'POST' })),
    true
  );
  assert.equal(limiter.writes.length, 0);
});

test('limits reset at expiry and Retry-After rounds up with a minimum of one second', () => {
  const limiter = fixture();
  assert.equal(limiter.enforce(request('/admin/dashboard')), true);
  limiter.setNow(2499);
  assert.equal(limiter.enforce(request('/api/admin/dashboard')), false);
  assert.equal(limiter.writes.at(-1).headers['Retry-After'], '1');
  limiter.setNow(2500);
  assert.equal(limiter.enforce(request('/api/admin/dashboard')), true);
  assert.equal(limiter.enforce(request('/admin/dashboard')), false);
  assert.equal(limiter.writes.at(-1).headers['Retry-After'], '2');
});

test('untrusted forwarded headers cannot rotate a bucket while configured proxy hops select the trusted end', () => {
  const direct = fixture();
  assert.equal(
    direct.enforce(request('/admin/dashboard', { forwarded: '203.0.113.1' })),
    true
  );
  assert.equal(
    direct.enforce(request('/admin/dashboard', { forwarded: '203.0.113.2' })),
    false
  );

  const proxied = fixture({ trustedProxyHops: 1 });
  assert.equal(
    proxied.enforce(
      request('/admin/dashboard', { forwarded: '198.51.100.1, 203.0.113.1' })
    ),
    true
  );
  assert.equal(
    proxied.enforce(
      request('/admin/dashboard', { forwarded: '198.51.100.2, 203.0.113.1' })
    ),
    false
  );
  assert.equal(
    proxied.enforce(
      request('/admin/dashboard', { forwarded: '198.51.100.1, 203.0.113.2' })
    ),
    true
  );
});

test('a zero limit remains disabled and independent limiter instances do not share buckets', () => {
  const disabled = fixture({ adminRateLimitMax: 0 });
  for (let i = 0; i < 5; i++)
    assert.equal(disabled.enforce(request('/admin/session')), true);
  assert.equal(disabled.writes.length, 0);
  const first = fixture();
  const second = fixture();
  assert.equal(first.enforce(request('/admin/session')), true);
  assert.equal(first.enforce(request('/admin/session')), false);
  assert.equal(second.enforce(request('/admin/session')), true);
});
