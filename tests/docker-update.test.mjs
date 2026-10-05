import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  chooseDockerUpdateEnvironment,
  dockerUpdateInvocation,
  dockerUpdatePlan,
  executeDockerUpdate,
  parseDockerUpdateArgs,
  resolveDockerUpdateOptions
} from '../scripts/lib/docker-update.mjs';

const unattended = async (args = [], env = {}) => {
  const options = parseDockerUpdateArgs(args);
  const environment = await chooseDockerUpdateEnvironment(options, {
    env,
    interactive: false,
    ask: () => assert.fail('No unattended environment question')
  });
  const resolved = await resolveDockerUpdateOptions(options, environment, {
    env,
    askYesNo: async (_question, defaultValue = false) => defaultValue
  });
  return dockerUpdatePlan(resolved, { env });
};

test('update accepts its existing environment aliases without acquiring startup-only modes', () => {
  for (const [value, environment] of [
    ['prod', 'production'],
    ['production', 'production'],
    [' DEV ', 'development'],
    ['development', 'development']
  ]) {
    for (const args of [
      ['--environment', value],
      ['--env', value],
      [`--environment=${value}`],
      [`--env=${value}`]
    ])
      assert.equal(parseDockerUpdateArgs(args).environment, environment);
  }
  assert.equal(
    parseDockerUpdateArgs(['--production']).environment,
    'production'
  );
  assert.equal(
    parseDockerUpdateArgs(['--development']).environment,
    'development'
  );
  assert.equal(
    parseDockerUpdateArgs(['--env=dev', '--development']).environment,
    'development'
  );
  for (const value of [
    'local',
    'other',
    'autre',
    '',
    '__proto__',
    'constructor'
  ]) {
    assert.throws(
      () => parseDockerUpdateArgs([`--env=${value}`]),
      /Invalid environment/
    );
  }
});

test('update retains conflict errors, unknown-option help and historical help precedence', () => {
  assert.throws(() => parseDockerUpdateArgs(['--env=dev', '--production']), {
    message: 'Choose only one target environment.'
  });
  for (const flag of [
    'database',
    'build-app',
    'prune-images',
    'stripe-webhook'
  ]) {
    const args = [`--${flag}`, `--no-${flag}`];
    assert.throws(() => parseDockerUpdateArgs(args), {
      message: `Choose either --${flag} or --no-${flag}, not both.`
    });
    assert.equal(parseDockerUpdateArgs([...args, '--help']).help, true);
    assert.doesNotThrow(() =>
      parseDockerUpdateArgs([`--${flag}`, `--${flag}`])
    );
  }
  for (const flag of ['--environment', '--env']) {
    assert.throws(() => parseDockerUpdateArgs([flag]), {
      message: `${flag} requires production or development.`
    });
  }
  assert.throws(
    () => parseDockerUpdateArgs(['--help', '--env=local']),
    /Invalid environment/
  );
  for (const flag of ['--dry-run', '--unknown', '-h']) {
    assert.throws(
      () => parseDockerUpdateArgs([flag]),
      (error) => error.message === `Unknown argument: ${flag}` && error.showHelp
    );
  }
});

test('environment choice preserves CLI, shell and production fallback precedence', async () => {
  const noQuestion = () => assert.fail('An environment is already determined');
  assert.equal(
    await chooseDockerUpdateEnvironment(
      { environment: 'development' },
      {
        env: { FUNDING_PLATFORM_ENV: 'production' },
        interactive: true,
        ask: noQuestion
      }
    ),
    'development'
  );
  for (const [value, expected] of [
    ['DEV', 'development'],
    ['prod', 'production'],
    ['local', 'production'],
    ['invalid', 'production'],
    ['', 'production']
  ]) {
    assert.equal(
      await chooseDockerUpdateEnvironment(
        {},
        {
          env: { FUNDING_PLATFORM_ENV: value },
          interactive: false,
          ask: noQuestion
        }
      ),
      expected
    );
  }
  const answers = ['local', ' ', 'dev'];
  const questions = [];
  const reports = [];
  assert.equal(
    await chooseDockerUpdateEnvironment(
      {},
      {
        env: {},
        interactive: true,
        ask: async (question) => {
          questions.push(question);
          return answers.shift();
        },
        reportInvalid: (message) => reports.push(message)
      }
    ),
    'development'
  );
  assert.equal(questions.length, 3);
  assert.equal(
    questions[0],
    'Pour quel environnement est destine le build ? [production/development] (production) '
  );
  assert.deepEqual(reports, [
    'Choix invalide. Utilise production ou development.',
    'Choix invalide. Utilise production ou development.'
  ]);
  assert.equal(
    await chooseDockerUpdateEnvironment(
      {},
      { env: {}, interactive: true, ask: async () => '' }
    ),
    'production'
  );
});

test('update option questions preserve order, text, defaults and explicit opt-outs', async () => {
  const questions = [];
  const resolved = await resolveDockerUpdateOptions(
    parseDockerUpdateArgs([]),
    'development',
    {
      env: {},
      askYesNo: async (question, defaultValue = false) => {
        questions.push([question, defaultValue]);
        return defaultValue;
      }
    }
  );
  assert.deepEqual(questions, [
    ['Activer la database PostgreSQL pour docker:update ? [y/N] ', false],
    ["Recompiler l'API et Angular avant le Docker update ? [y/N] ", false],
    [
      'Supprimer les anciennes images Docker non utilisees apres le build ? [Y/n] ',
      true
    ],
    ['Lancer Stripe webhook listener apres le Docker update ? [y/N] ', false]
  ]);
  assert.deepEqual(resolved, {
    targetEnvironment: 'development',
    useDatabase: false,
    buildAppFirst: false,
    pruneImages: true,
    startStripeWebhook: false
  });

  const explicit = await resolveDockerUpdateOptions(
    parseDockerUpdateArgs([
      '--database',
      '--build-app',
      '--no-prune-images',
      '--no-stripe-webhook'
    ]),
    'development',
    {
      env: {},
      askYesNo: () => assert.fail('Explicit flags must suppress questions')
    }
  );
  assert.deepEqual(explicit, {
    targetEnvironment: 'development',
    useDatabase: true,
    buildAppFirst: true,
    pruneImages: false,
    startStripeWebhook: false
  });
  for (const environment of ['production', 'development']) {
    const plan = await unattended([`--env=${environment}`]);
    assert.equal(plan.pruneImages, true);
    assert.equal(plan.buildAppFirst, false);
    assert.equal(plan.startStripeWebhook, false);
    assert.equal(plan.useDatabase, false);
  }
});

test('inherited database profiles keep update-specific precedence and Compose configuration untouched', async () => {
  const env = {
    COMPOSE_PROFILES: ' metrics, database , ',
    COMPOSE_FILE: 'custom.yml',
    FUNDING_ALLOWED_ORIGINS: 'https://example.invalid',
    ANGULAR_CONFIGURATION: 'production'
  };
  const plan = await unattended(['--development', '--no-database'], env);
  assert.equal(plan.useDatabase, true);
  assert.equal(plan.commandEnv.COMPOSE_PROFILES, env.COMPOSE_PROFILES);
  assert.equal(plan.commandEnv.COMPOSE_FILE, 'custom.yml');
  assert.equal(
    plan.commandEnv.FUNDING_ALLOWED_ORIGINS,
    env.FUNDING_ALLOWED_ORIGINS
  );
  assert.equal(plan.commandEnv.ANGULAR_CONFIGURATION, 'development');
  assert.equal(env.ANGULAR_CONFIGURATION, 'production');
  assert.deepEqual(plan.commands[0].args.slice(0, 5), [
    'compose',
    '--profile',
    'database',
    '--progress',
    'plain'
  ]);
  assert.ok(
    plan.commands
      .filter(({ args }) => args[0] === 'compose')
      .every(({ args }) => !args.includes('-f'))
  );
  assert.equal(
    (await unattended(['--no-database'], { COMPOSE_PROFILES: 'metrics' }))
      .useDatabase,
    false
  );
});

test('production refuses an explicit Stripe listener before any option questions or commands', async () => {
  await assert.rejects(
    resolveDockerUpdateOptions(
      parseDockerUpdateArgs(['--stripe-webhook']),
      'production',
      {
        env: {},
        askYesNo: () => assert.fail('Stripe restriction precedes questions')
      }
    ),
    { message: '--stripe-webhook is only available for development builds.' }
  );
});

test('update plan retains exact build, Compose, prune and listener commands and ordering', async () => {
  const defaultPlan = await unattended();
  assert.equal(defaultPlan.targetEnvironment, 'production');
  assert.equal(defaultPlan.commandEnv.FUNDING_PLATFORM_ENV, 'production');
  assert.equal(defaultPlan.commandEnv.ANGULAR_CONFIGURATION, 'production');
  assert.deepEqual(defaultPlan.commands, [
    {
      command: 'docker',
      args: [
        'compose',
        '--progress',
        'plain',
        'pull',
        '--ignore-buildable',
        '--quiet'
      ]
    },
    {
      command: 'docker',
      args: [
        'compose',
        '--progress',
        'plain',
        'build',
        '--pull',
        '--build-arg',
        'FUNDING_PLATFORM_ENV=production',
        '--build-arg',
        'ANGULAR_CONFIGURATION=production'
      ]
    },
    {
      command: 'docker',
      args: ['compose', '--progress', 'plain', 'up', '-d', '--remove-orphans']
    },
    { command: 'docker', args: ['image', 'prune', '-f'] }
  ]);
  const full = await unattended([
    '--development',
    '--database',
    '--build-app',
    '--prune-images',
    '--stripe-webhook'
  ]);
  const compose = ['compose', '--profile', 'database', '--progress', 'plain'];
  assert.deepEqual(full.commands, [
    { command: 'yarn', args: ['build'] },
    {
      command: 'yarn',
      args: [
        'workspace',
        '@openg7/funding-web',
        'build',
        '--configuration',
        'development'
      ]
    },
    {
      command: 'docker',
      args: [...compose, 'pull', '--ignore-buildable', '--quiet']
    },
    {
      command: 'docker',
      args: [
        ...compose,
        'build',
        '--pull',
        '--build-arg',
        'FUNDING_PLATFORM_ENV=development',
        '--build-arg',
        'ANGULAR_CONFIGURATION=development'
      ]
    },
    { command: 'docker', args: [...compose, 'up', '-d', '--remove-orphans'] },
    { command: 'docker', args: ['image', 'prune', '-f'] },
    { command: 'yarn', args: ['stripe:webhook:listen'], stripeWebhook: true }
  ]);
  assert.equal((await unattended(['--no-prune-images'])).commands.length, 3);
});

test('invocations preserve argument vectors on Linux and cmd.exe escaping on Windows', () => {
  const env = { FUNDING_PLATFORM_ENV: 'development' };
  const args = ['compose', '--progress', 'plain', 'build', '--pull'];
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(
      dockerUpdateInvocation('docker', args, { platform, env }),
      { command: 'docker', args, options: { stdio: 'inherit', env } }
    );
  }
  assert.deepEqual(
    dockerUpdateInvocation('docker', args, { platform: 'win32', env }),
    {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'docker compose --progress plain build --pull'],
      options: { stdio: 'inherit', env }
    }
  );
  const windowsEnv = { ...env, ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  const invocation = dockerUpdateInvocation(
    'synthetic',
    ['', 'two words', 'a&b', 'a"b', 'a^b', 'a|b', 'a<b', 'a>b'],
    { platform: 'win32', env: windowsEnv }
  );
  assert.equal(invocation.command, windowsEnv.ComSpec);
  assert.equal(
    invocation.args[3],
    'synthetic "" "two words" "a^&b" "a^"b" "a^^b" "a^|b" "a^<b" "a^>b"'
  );
});

test('injected execution stops on every failed stage and never starts a listener after an update failure', async () => {
  const plan = await unattended([
    '--development',
    '--database',
    '--build-app',
    '--stripe-webhook'
  ]);
  const calls = [];
  await executeDockerUpdate(plan, {
    runCommand: async (command, args, env) => {
      assert.equal(env, plan.commandEnv);
      calls.push([command, args]);
    },
    beforeStripeWebhook: () => calls.push('listener-notice')
  });
  assert.deepEqual(
    calls.slice(0, 6),
    plan.commands.slice(0, 6).map(({ command, args }) => [command, args])
  );
  assert.equal(calls[6], 'listener-notice');
  assert.deepEqual(calls[7], ['yarn', ['stripe:webhook:listen']]);

  for (let failure = 0; failure < plan.commands.length; failure++) {
    let executed = 0;
    let notices = 0;
    await assert.rejects(
      executeDockerUpdate(plan, {
        runCommand: async () => {
          if (executed++ === failure)
            throw new Error('Synthetic command failure');
        },
        beforeStripeWebhook: () => {
          notices++;
        }
      }),
      /Synthetic command failure/
    );
    assert.equal(executed, failure + 1);
    assert.equal(notices, failure === plan.commands.length - 1 ? 1 : 0);
  }
});

// The child executes only Node. Its builtin spawnSync is replaced before the
// CLI imports it, so no Docker, Yarn, Stripe or pruning process can be started.
const cli = (args, failure = null) =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
  import childProcess from 'node:child_process';
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  // The CLI must not load the developer's real .env in this isolated simulation.
  fs.existsSync = () => false;
  let calls = 0;
  const failure = ${JSON.stringify(failure)};
  childProcess.spawnSync = (command, args, options) => {
    if (args.join(' ').includes(' ps --all --services ')) return { status: 0, stdout: '' };
    console.log('STUB_CALL=' + JSON.stringify({ command, args, environment: options.env.FUNDING_PLATFORM_ENV, angular: options.env.ANGULAR_CONFIGURATION }));
    const index = calls++;
    if (failure?.index === index) return failure.error ? { error: new Error(failure.error) } : { status: failure.status };
    return { status: 0 };
  };
  syncBuiltinESMExports();
  process.argv = [process.execPath, 'scripts/docker-update.mjs', ...${JSON.stringify(args)}];
  await import('./scripts/docker-update.mjs');
`
    ],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
    }
  );

test('CLI adaptation uses the planned commands with stubbed execution and propagates status/start failures', () => {
  const result = cli([
    '--development',
    '--database',
    '--build-app',
    '--no-prune-images',
    '--stripe-webhook'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const calls = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('STUB_CALL='))
    .map((line) => JSON.parse(line.slice('STUB_CALL='.length)));
  assert.equal(calls.length, 6);
  assert.ok(
    calls.every(
      (call) =>
        call.environment === 'development' && call.angular === 'development'
    )
  );
  assert.match(result.stdout, /Verification et lancement du relais Stripe/);
  assert.ok(
    result.stdout.indexOf('--remove-orphans') <
      result.stdout.indexOf('Verification et lancement')
  );
  const failStatus = cli(['--development', '--stripe-webhook'], {
    index: 1,
    status: 7
  });
  assert.equal(failStatus.status, 7);
  assert.doesNotMatch(failStatus.stdout, /Verification et lancement/);
  const failStart = cli([], { index: 0, error: 'Synthetic start failure' });
  assert.equal(failStart.status, 1);
  assert.match(failStart.stderr, /Command failed to start: docker compose/);
  assert.match(failStart.stderr, /Synthetic start failure/);
  assert.equal(cli([], { index: 0, status: null }).status, 1);
});

test('CLI help and argument errors cannot execute update or pruning commands', () => {
  for (const args of [['--help'], ['--help', '--database', '--no-database']]) {
    const result = cli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.doesNotMatch(result.stdout, /STUB_CALL=/);
  }
  for (const [args, message] of [
    [['--unknown'], /Unknown argument: --unknown/],
    [['--env=local'], /Invalid environment "local"/],
    [
      ['--database', '--no-database'],
      /Choose either --database or --no-database/
    ],
    [['--production', '--stripe-webhook'], /only available for development/]
  ]) {
    const result = cli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout, /STUB_CALL=/);
    assert.equal(result.stderr.includes('Usage:'), args[0] === '--unknown');
  }
});
