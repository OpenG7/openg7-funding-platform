import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { resendStripeEvents } from '../scripts/lib/stripe-cli.mjs';

const secret = 'sk_test_SyntheticPrivateCanary';
const options = {
  eventIds: ['evt_SyntheticOne', 'evt_SyntheticTwo'],
  live: false,
  webhookEndpoint: 'we_Synthetic',
  apiKey: secret,
  dryRun: false,
  confirm: true
};

test('dry-run remains offline and never prints explicit or inherited credentials', () => {
  const lines = [];
  resendStripeEvents(
    { ...options, dryRun: true },
    {
      env: { STRIPE_API_KEY: 'sk_test_InheritedCanary' },
      resolveExecutable: () => assert.fail('dry-run must not find the CLI'),
      spawn: () => assert.fail('dry-run must not invoke the CLI'),
      write: (line) => lines.push(line)
    }
  );
  assert.equal(lines.length, 2);
  assert.match(
    lines[0],
    /events resend evt_SyntheticOne --confirm --webhook-endpoint we_Synthetic/
  );
  assert.doesNotMatch(lines.join('\n'), /Canary|--api-key/);
});

test('resend passes explicit credentials only in child environment and uses the native executable', () => {
  const env = Object.freeze({ PATH: 'synthetic' });
  const calls = [],
    lines = [];
  resendStripeEvents(options, {
    env,
    resolveExecutable: (childEnv) => {
      assert.equal(childEnv.STRIPE_API_KEY, secret);
      return '/synthetic/native/stripe.exe';
    },
    spawn: (executable, args, config) => {
      calls.push({ executable, args, config });
      return { status: 0 };
    },
    write: (line) => lines.push(line)
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.executable, '/synthetic/native/stripe.exe');
    assert.equal(call.config.shell, false);
    assert.equal(call.config.env.STRIPE_API_KEY, secret);
    assert.doesNotMatch(call.args.join(' '), /Canary|--api-key/);
  }
  assert.doesNotMatch(lines.join('\n'), /Canary/);
  assert.equal(env.STRIPE_API_KEY, undefined);
});

test('inherited API keys retain Stripe CLI precedence over the compatible explicit option', () => {
  const env = Object.freeze({ STRIPE_API_KEY: 'sk_test_InheritedCanary' });
  resendStripeEvents(options, {
    env,
    resolveExecutable: () => 'synthetic-stripe',
    spawn: (_executable, args, config) => {
      assert.equal(config.env.STRIPE_API_KEY, env.STRIPE_API_KEY);
      assert.doesNotMatch(args.join(' '), /Canary|--api-key/);
      return { status: 0 };
    },
    write: () => {}
  });
});

test('saved credentials, live selection and interactive confirmation remain explicit', () => {
  const env = { STRIPE_API_KEY: secret };
  resendStripeEvents(
    { ...options, apiKey: '', live: true, confirm: false },
    {
      env,
      resolveExecutable: () => 'synthetic-stripe',
      spawn: (_executable, args, config) => {
        assert.equal(config.env.STRIPE_API_KEY, secret);
        assert.ok(args.includes('--live'));
        assert.equal(args.includes('--confirm'), false);
        return { status: 0 };
      },
      write: () => {}
    }
  );
});

test('a failed or uncertain invocation stops the batch and hides child diagnostics', () => {
  for (const result of [
    { error: new Error(secret), status: null },
    { status: 17 },
    { status: null, signal: 'SIGTERM' }
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        resendStripeEvents(options, {
          env: {},
          resolveExecutable: () => 'synthetic-stripe',
          write: () => {},
          spawn: () => {
            calls++;
            return result;
          }
        }),
      (error) => {
        assert.equal(error.exitCode, result.status || 1);
        assert.doesNotMatch(error.message, /Canary/);
        return true;
      }
    );
    assert.equal(calls, 1);
  }
});

test('CLI dry-run preserves both supported explicit key syntaxes without disclosing either', () => {
  for (const keyArgs of [['--api-key', secret], [`--api-key=${secret}`]]) {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/stripe-resend-events.mjs',
        'evt_Synthetic',
        '--endpoint',
        'we_Synthetic',
        '--dry-run',
        ...keyArgs
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, STRIPE_API_KEY: 'sk_test_InheritedCanary' }
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /stripe events resend evt_Synthetic/);
    assert.doesNotMatch(result.stdout + result.stderr, /Canary|--api-key/);
  }
});
