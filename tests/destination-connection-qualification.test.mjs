import assert from 'node:assert/strict';
import test from 'node:test';

import {
  qualifyDestinationConnections,
  runQualificationCli
} from '../scripts/qualify-destination-connections.mjs';

const now = new Date('2026-01-01T00:00:00Z');
const env = {
  SOCIAL_PUBLICATION_MODE: 'live',
  SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: 'synthetic-page',
  SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic-private-token'
};
const options = { now, feed: 'openg7:facebook' };

test('qualification plans all four destinations without network calls or secret disclosure', async () => {
  const report = await qualifyDestinationConnections(env, {
    now,
    verify: () => {
      assert.fail('Planning must not call the provider');
    }
  });
  assert.equal(report.destinations.length, 4);
  assert.equal(report.scope, 'configuration_plan_no_network');
  assert.equal(report.destinations[0].status, 'not_checked');
  assert.equal(report.destinations[0].expiry, 'unknown');
  assert.equal(report.destinations[2].status, 'missing_configuration');
  assert.ok(!JSON.stringify(report).includes('synthetic-private-token'));
  assert.ok(!JSON.stringify(report).includes('synthetic-page'));
});

test('explicit checks use the existing provider configuration and keep unknown expiry unresolved', async () => {
  const calls = [];
  const report = await qualifyDestinationConnections(env, {
    ...options,
    check: true,
    verify: async (...args) => calls.push(args)
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].facebook.pageAccessToken, 'synthetic-private-token');
  assert.equal(calls[0][1], 'facebook');
  assert.equal(calls[0][2], 'synthetic-page');
  assert.equal(report.destinations[0].status, 'account_access_verified');
  assert.equal(report.destinations[0].expiry, 'unknown');
  assert.ok(report.unverified.includes('publishing_permissions'));
  assert.ok(report.unverified.includes('publication_authorization'));
});

test('mock, disabled, missing, expired, invalid and custom-endpoint configurations never call providers', async () => {
  for (const [changes, status] of [
    [{ SOCIAL_PUBLICATION_MODE: 'mock' }, 'simulation'],
    [{ SOCIAL_PUBLICATION_MODE: 'disabled' }, 'disabled'],
    [
      { SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: '' },
      'missing_configuration'
    ],
    [
      { SOCIAL_PUBLICATION_OPENG7_FACEBOOK_EXPIRES_AT: '2025-12-31T00:00:00Z' },
      'blocked_expiry'
    ],
    [
      { SOCIAL_PUBLICATION_OPENG7_FACEBOOK_EXPIRES_AT: 'not-a-date' },
      'blocked_expiry'
    ],
    [
      {
        SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL:
          'https://graph.facebook.com.example.test'
      },
      'blocked_endpoint'
    ],
    [
      {
        SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL: 'http://graph.facebook.com'
      },
      'blocked_endpoint'
    ],
    [
      {
        SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL:
          'https://secret@graph.facebook.com'
      },
      'blocked_endpoint'
    ],
    [
      {
        SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL:
          'https://graph.facebook.com?access_token=secret'
      },
      'blocked_endpoint'
    ]
  ]) {
    const report = await qualifyDestinationConnections(
      { ...env, ...changes },
      {
        ...options,
        check: true,
        verify: () => assert.fail('Blocked qualification must not send a token')
      }
    );
    assert.equal(report.destinations[0].status, status);
    assert.equal(report.destinations[0].attemptedAt, null);
  }
});

test('destination selection respects LinkedIn mapping and the OpenG7-only legacy fallback', async () => {
  const legacy = {
    SOCIAL_PUBLICATION_MODE: 'live',
    SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID:
      'urn:li:organization:synthetic',
    SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN: 'synthetic-private-token'
  };
  const calls = [];
  const report = await qualifyDestinationConnections(legacy, {
    now,
    check: true,
    verify: async (...args) => calls.push(args)
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'linkedin');
  assert.equal(calls[0][2], 'synthetic');
  assert.equal(
    report.destinations.find((d) => d.feedId === 'openg20:linkedin').status,
    'missing_configuration'
  );
  await assert.rejects(
    qualifyDestinationConnections(legacy, {
      feed: 'unknown:linkedin',
      verify: () => assert.fail()
    }),
    /INVALID_DESTINATION/
  );
});

test('the real provider adapters issue only identity and organization access GETs', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.method ?? 'GET', 'GET');
    assert.equal(init.redirect, 'error');
    calls.push(url);
    if (new URL(url).hostname === 'graph.facebook.com') {
      assert.equal(
        init.headers.Authorization,
        'Bearer synthetic-private-token'
      );
      return Response.json({ id: 'synthetic-page' });
    }
    assert.equal(new URL(url).hostname, 'api.linkedin.com');
    return Response.json({
      elements: [
        {
          organization: 'urn:li:organization:synthetic-org',
          role: 'ADMINISTRATOR'
        }
      ]
    });
  });
  const report = await qualifyDestinationConnections(
    {
      ...env,
      SOCIAL_PUBLICATION_OPENG7_LINKEDIN_ACCOUNT_ID: 'synthetic-org',
      SOCIAL_PUBLICATION_OPENG7_LINKEDIN_ACCESS_TOKEN: 'synthetic-private-token'
    },
    { now, check: true }
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/me\?fields=id$/);
  assert.match(calls[1], /\/organizationAcls\?q=roleAssignee&state=APPROVED$/);
  assert.equal(
    report.destinations.filter((d) => d.status === 'account_access_verified')
      .length,
    2
  );
});

test('invalid check mode is rejected before any provider call', async () => {
  await assert.rejects(
    qualifyDestinationConnections(env, {
      ...options,
      check: 'false',
      verify: () => assert.fail()
    }),
    /INVALID_CHECK_MODE/
  );
});

test('provider errors are contained and never expose their message or private payload', async () => {
  const report = await qualifyDestinationConnections(env, {
    ...options,
    check: true,
    verify: async () => {
      throw new Error('synthetic-private-token /private/provider/payload');
    }
  });
  assert.equal(report.destinations[0].status, 'check_failed');
  assert.ok(!JSON.stringify(report).includes('private'));
});

test('CLI validates before reading, uses only the explicit file, and reports fixed failures', async () => {
  for (const args of [
    [],
    ['--check'],
    ['--env', 'file', '--feed', 'unknown'],
    ['--env', 'file', '--check', '--check'],
    ['--env', 'file', '--unknown']
  ]) {
    assert.equal(
      await runQualificationCli(args, {
        read: () => assert.fail('Invalid invocation must not read files'),
        stderr: () => {}
      }),
      2
    );
  }
  const output = [];
  const read = async (path) => {
    assert.equal(path, 'synthetic.env');
    return 'SOCIAL_PUBLICATION_MODE=mock\n';
  };
  assert.equal(
    await runQualificationCli(['--env', 'synthetic.env'], {
      read,
      stdout: (v) => output.push(JSON.parse(v))
    }),
    0
  );
  assert.equal(output[0].scope, 'configuration_plan_no_network');
  assert.equal(
    await runQualificationCli(['--env', 'synthetic.env', '--check'], {
      read,
      stdout: () => {}
    }),
    1
  );
  const errors = [];
  assert.equal(
    await runQualificationCli(['--env', 'synthetic.env'], {
      read: async () => {
        throw new Error('private file path');
      },
      stderr: (v) => errors.push(v)
    }),
    2
  );
  assert.deepEqual(errors, ['DESTINATION_QUALIFICATION_UNAVAILABLE']);
});
