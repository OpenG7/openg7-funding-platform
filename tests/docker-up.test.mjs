import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  chooseDockerEnvironment,
  dockerUpPlan,
  normalizeDockerEnvironment,
  parseDockerUpArgs,
  startDockerStack
} from '../scripts/lib/docker-up.mjs';
import {
  redactStripeOutput,
  runStripeListener,
  stripeListenerEnvironment,
  stripeSnapshotListenerArgs,
  verifyLocalStripeTls,
  verifyStripeSigningSecret
} from '../scripts/lib/stripe-listener.mjs';

const testEnv = {
  STRIPE_SECRET_KEY: 'sk_test_synthetic123',
  STRIPE_WEBHOOK_SECRET: 'whsec_synthetic123',
  FUNDING_PLATFORM_ENV: 'production'
};
const planFor = (args, env = testEnv, localTls = true) =>
  dockerUpPlan(parseDockerUpArgs(args), { env, localTls });

test('interactive startup asks for the environment; unattended startup requires an explicit choice', async () => {
  const answers = ['invalid', 'dev'];
  let questions = 0;
  assert.equal(
    await chooseDockerEnvironment(
      {},
      {
        interactive: true,
        ask: async () => {
          questions++;
          return answers.shift();
        }
      }
    ),
    'development'
  );
  assert.equal(questions, 2);
  assert.equal(
    await chooseDockerEnvironment(
      {},
      { interactive: true, ask: async () => '' }
    ),
    'development'
  );
  await assert.rejects(
    chooseDockerEnvironment({}, { interactive: false }),
    /--environment/
  );
  assert.equal(
    await chooseDockerEnvironment(
      { environment: 'production' },
      { interactive: false }
    ),
    'production'
  );
  for (const invalid of ['toString', '__proto__', 'constructor', undefined])
    assert.throws(() => normalizeDockerEnvironment(invalid), /invalide/);
  for (const invalid of [
    'toString',
    '__proto__',
    'constructor',
    'local-other'
  ]) {
    assert.throws(
      () => parseDockerUpArgs([`--env=${invalid}`]),
      /invalide/,
      'Invalid modes must not become a startup plan through shared normalization'
    );
  }
  assert.throws(
    () => parseDockerUpArgs(['--environment', 'dev', '--env=prod']),
    /seul/
  );
  assert.throws(() => parseDockerUpArgs(['--environment']), /invalide/);
  assert.throws(
    () => parseDockerUpArgs(['--database', '--no-database']),
    /Choisir/
  );
});

test('local startup uses development builds, PostgreSQL and the existing trusted TLS overlay', () => {
  const plan = planFor(['--environment', 'local']);
  assert.equal(plan.stripeWebhook, true);
  assert.equal(plan.commandEnv.FUNDING_PLATFORM_ENV, 'development');
  assert.ok(plan.commands[1].includes('ANGULAR_CONFIGURATION=development'));
  assert.ok(plan.commands[0].includes('database'));
  assert.ok(plan.commands[0].includes('docker-compose.local-tls.yml'));
  assert.deepEqual(plan.commands[2].slice(-3), ['up', '-d', '--wait']);
  assert.equal(testEnv.FUNDING_PLATFORM_ENV, 'production');
});

test('only local startup adds exact HTTPS loopback origins, preserving configured origins', () => {
  const origins =
    ' https://fund.example.test, https://localhost, ,https://fund.example.test ';
  const env = { ...testEnv, FUNDING_ALLOWED_ORIGINS: origins };
  assert.equal(
    planFor(['--env=dev'], env).commandEnv.FUNDING_ALLOWED_ORIGINS,
    'https://fund.example.test,https://localhost,https://127.0.0.1'
  );
  assert.equal(
    planFor(['--env=local']).commandEnv.FUNDING_ALLOWED_ORIGINS,
    'https://localhost,https://127.0.0.1'
  );
  assert.equal(env.FUNDING_ALLOWED_ORIGINS, origins);
  for (const environment of ['prod', 'autre']) {
    assert.equal(
      planFor(['--env', environment], env).commandEnv.FUNDING_ALLOWED_ORIGINS,
      origins
    );
    assert.equal(
      planFor(['--env', environment]).commandEnv.FUNDING_ALLOWED_ORIGINS,
      undefined
    );
  }
});

test('prod and other never invoke Stripe; other preserves the supplied runtime and Compose configuration', async () => {
  for (const environment of ['prod', 'autre']) {
    const plan = planFor(['--env', environment], {
      ...testEnv,
      FUNDING_PLATFORM_ENV: 'custom',
      COMPOSE_FILE: 'custom.yml'
    });
    assert.equal(plan.stripeWebhook, false);
    assert.ok(!plan.commands[0].includes('docker-compose.local-tls.yml'));
    assert.ok(!plan.commands[0].includes('database'));
    assert.equal(
      plan.commandEnv.FUNDING_PLATFORM_ENV,
      environment === 'prod' ? 'production' : 'custom'
    );
    let commands = 0;
    await startDockerStack(plan, {
      runDocker: async () => {
        commands++;
      },
      checkStripe: () => assert.fail('Stripe must not be contacted'),
      listenStripe: () => assert.fail('Stripe must not be started')
    });
    assert.equal(commands, 3);
  }
});

test('local opt-outs respect custom Compose files and disable the database profile inherited from .env', () => {
  const plan = planFor(['--env=dev', '--no-database', '--no-stripe-webhook'], {
    ...testEnv,
    COMPOSE_FILE: 'custom.yml',
    COMPOSE_PROFILES: 'database,metrics'
  });
  assert.equal(plan.stripeWebhook, false);
  assert.equal(plan.commandEnv.COMPOSE_FILE, 'custom.yml');
  assert.equal(plan.commandEnv.COMPOSE_PROFILES, 'metrics');
  assert.ok(!plan.commands[0].includes('database'));
  assert.ok(!plan.commands[0].includes('-f'));
  assert.throws(
    () =>
      planFor(['--env=local'], { STRIPE_SECRET_KEY: 'sk_live_synthetic123' }),
    /jamais live/
  );
});

test('Stripe starts only after successful configuration validation, build and service readiness', async () => {
  const plan = planFor(['--env=local']);
  const stages = [];
  await startDockerStack(plan, {
    checkStripe: async () => stages.push('check'),
    runDocker: async (args) =>
      stages.push(
        args.includes('config')
          ? 'config'
          : args.includes('build')
            ? 'build'
            : 'ready'
      ),
    listenStripe: async () => stages.push('listen')
  });
  assert.deepEqual(stages, ['check', 'config', 'build', 'ready', 'listen']);
  for (let failure = 0; failure < 4; failure++) {
    let stage = 0;
    const run = async () => {
      if (stage++ === failure) throw new Error('synthetic failure');
    };
    await assert.rejects(
      startDockerStack(plan, {
        checkStripe: run,
        runDocker: run,
        listenStripe: () => assert.fail('No listener after a failed startup')
      }),
      /synthetic failure/
    );
    assert.equal(stage, failure + 1);
  }
});

test('listener uses the application test account and rejects missing, live or mismatched credentials', () => {
  assert.equal(
    stripeListenerEnvironment({
      ...testEnv,
      STRIPE_API_KEY: 'sk_live_unrelated'
    }).STRIPE_API_KEY,
    testEnv.STRIPE_SECRET_KEY
  );
  for (const key of [undefined, '', 'sk_live_synthetic', 'rk_live_synthetic'])
    assert.throws(
      () => stripeListenerEnvironment({ ...testEnv, STRIPE_SECRET_KEY: key }),
      /mode test/
    );
  assert.throws(
    () => stripeListenerEnvironment({ ...testEnv, STRIPE_WEBHOOK_SECRET: '' }),
    /Configurer/
  );
  assert.throws(
    () =>
      stripeListenerEnvironment({ ...testEnv, STRIPE_API_HOST: 'stripe-stub' }),
    /simulateur/
  );
  verifyStripeSigningSecret(
    'whsec_synthetic123\n',
    testEnv.STRIPE_WEBHOOK_SECRET
  );
  assert.throws(
    () =>
      verifyStripeSigningSecret(
        'whsec_privatecanary',
        testEnv.STRIPE_WEBHOOK_SECRET
      ),
    (error) => {
      assert.doesNotMatch(error.message, /privatecanary|synthetic123/);
      return true;
    }
  );
  assert.equal(
    redactStripeOutput(
      'Ready whsec_privatecanary sk_test_privatecanary rk_live_privatecanary'
    ),
    'Ready [secret masque] [secret masque] [secret masque]'
  );
});

test('recent Stripe CLIs explicitly select all snapshot events advertised in their help', () => {
  const help = `Flags:
      --all-snapshot         Listen to all snapshot events
      --all-thin             Listen to all thin events
  -e, --events strings       The events to listen for
      --forward-to string    Forward webhook events to this URL`;
  assert.deepEqual(stripeSnapshotListenerArgs(help), [
    'listen',
    '--all-snapshot',
    '--forward-to',
    'https://localhost/api/stripe/webhook'
  ]);
});

test('older Stripe CLIs explicitly select wildcard snapshot events without the all-snapshot flag', () => {
  const help = `Flags:
  -e, --events strings       The events to listen for
      --forward-to string    Forward webhook events to this URL`;
  assert.deepEqual(stripeSnapshotListenerArgs(help), [
    'listen',
    '--events',
    '*',
    '--forward-to',
    'https://localhost/api/stripe/webhook'
  ]);
});

test('local TLS preflight rejects untrusted certificates before any event forwarding', async () => {
  for (const event of ['trusted', 'untrusted', 'error', 'timeout']) {
    const socket = new EventEmitter();
    socket.authorized = event === 'trusted';
    let ended = false;
    socket.end = () => {
      ended = true;
    };
    socket.destroy = () => {
      ended = true;
    };
    socket.setTimeout = (_ms, callback) => {
      if (event === 'timeout') queueMicrotask(callback);
    };
    const result = verifyLocalStripeTls({
      connect: (options) => {
        assert.equal(options.rejectUnauthorized, true);
        assert.equal(options.servername, 'localhost');
        queueMicrotask(() => {
          if (event === 'error')
            socket.emit('error', new Error('privatecanary'));
          else if (event !== 'timeout') socket.emit('secureConnect');
        });
        return socket;
      }
    });
    if (event === 'trusted') await result;
    else
      await assert.rejects(result, (error) => {
        assert.match(error.message, /tls:local:setup/);
        assert.doesNotMatch(error.message, /privatecanary/);
        return true;
      });
    assert.equal(ended, true);
  }
});

test('captured CLI checks handle failure and remove signal handlers without exposing output', async () => {
  const before = process.listenerCount('SIGINT');
  const options = {
    executable: process.execPath,
    env: process.env,
    capture: true
  };
  const output = await runStripeListener(
    ['-e', 'process.stdout.write("whsec_synthetic123\\n")'],
    options
  );
  verifyStripeSigningSecret(output, testEnv.STRIPE_WEBHOOK_SECRET);
  await assert.rejects(
    runStripeListener(
      ['-e', 'process.stderr.write("whsec_privatecanary"); process.exit(1)'],
      options
    ),
    (error) => {
      assert.doesNotMatch(error.message, /privatecanary/);
      return true;
    }
  );
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('listener cancellation terminates its child and reports interruption', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { runStripeListener } from './scripts/lib/stripe-listener.mjs';
    const timer = setTimeout(() => process.emit('SIGINT'), 200);
    try {
      await runStripeListener(['-e', 'setInterval(() => {}, 1000)'], { executable: process.execPath, env: process.env, capture: true });
      process.exitCode = 1;
    } catch (error) {
      if (error.exitCode !== 130) process.exitCode = 1;
    } finally { clearTimeout(timer); }
  `
    ],
    { encoding: 'utf8', timeout: 10000 }
  );
  assert.equal(result.status, 0, result.stderr);
});

test('listener output masks credentials even when a secret spans multiple chunks', () => {
  const writer =
    'process.stdout.write("Ready whsec_priv"); setTimeout(() => { console.log("atecanary"); console.log("forwarded"); }, 50)';
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { runStripeListener } from './scripts/lib/stripe-listener.mjs';
    await runStripeListener(['-e', ${JSON.stringify(writer)}], { executable: process.execPath, env: process.env });
  `
    ],
    { encoding: 'utf8', timeout: 10000 }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ready \[secret masque\]/);
  assert.match(result.stdout, /forwarded/);
  assert.doesNotMatch(result.stdout + result.stderr, /privatecanary/);
});

test('CLI help and dry runs without environment files need neither Docker nor Stripe and do not disclose secrets', (t) => {
  for (const file of [
    'scripts/docker-up.mjs',
    'scripts/stripe-webhook-listen.mjs'
  ]) {
    const help = spawnSync(process.execPath, [file, '--help'], {
      encoding: 'utf8'
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
  }
  const root = mkdtempSync(join(tmpdir(), 'og7-docker-up-dry-run-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'og7-docker-up-dry-run-')));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  for (const name of [
    'docker-up.mjs',
    'lib/docker-up.mjs',
    'lib/docker-config.mjs',
    'lib/keycloak-config.mjs',
    'lib/production-identity.mjs',
    'lib/local-identity.mjs',
    'lib/keycloak-initial-user.mjs',
    'lib/services-check-context.mjs',
    'lib/services-check-identity.mjs',
    'lib/docker-environment.mjs'
  ])
    writeFileSync(
      join(root, 'scripts', name),
      readFileSync(join('scripts', name))
    );
  const result = spawnSync(
    process.execPath,
    ['scripts/docker-up.mjs', '--env=local', '--dry-run'],
    {
      encoding: 'utf8',
      cwd: root,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...testEnv
      }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stripe:webhook:listen/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic123/);
});
