import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertSandboxCleanupLabels,
  cleanupSandboxResources,
  listenForSandboxStop,
  sandboxComposeArgs,
  sandboxEnvironment,
  sandboxLabel,
  sandboxManifest,
  sandboxNginxConfiguration,
  sandboxStages
} from '../scripts/lib/admin-sandbox.mjs';

const root = resolve('.');
const project = 'og7-acceptance-a1b2-c3d4';
const temporary = join(root, 'synthetic-sandbox');
const options = () => ({
  parent: {
    PATH: 'synthetic-toolchain',
    DATABASE_URL: 'forbidden-database',
    COMPOSE_FILE: 'forbidden.yml',
    COMPOSE_PROJECT_NAME: 'production',
    FUNDING_ADMIN_TOKEN: 'forbidden-secret',
    FUNDING_ADMIN_SESSION_SECRET: 'forbidden-secret',
    STRIPE_SECRET_KEY: 'sk_live_forbidden',
    STRIPE_API_HOST: 'api.stripe.com',
    SMTP_HOST: 'forbidden-smtp',
    SOCIAL_PUBLICATION_MODE: 'live',
    SANDBOX_PUBLIC_BASE_URL: 'https://forbidden.example.test'
  },
  root,
  project,
  envFile: join(temporary, 'empty.env'),
  webPort: 48080,
  stripePort: 44242,
  moderationWebPort: 48081,
  oidcProviderPort: 48082,
  moderationNginxFile: join(temporary, 'nginx-oidc.conf'),
  manifestFile: join(temporary, 'openg7-sandbox.json'),
  nginxFile: join(temporary, 'nginx.conf')
});

test('interactive sandbox ignores inherited applications and credentials and generates private local secrets', () => {
  const env = sandboxEnvironment(options());
  const another = sandboxEnvironment(options());
  assert.equal(env.PATH, 'synthetic-toolchain');
  assert.equal(env.COMPOSE_PROJECT_NAME, project);
  assert.equal(
    env.COMPOSE_FILE,
    [
      join(root, 'docker-compose.acceptance.yml'),
      join(root, 'docker-compose.sandbox.yml')
    ].join(delimiter)
  );
  assert.equal(env.COMPOSE_ENV_FILES, options().envFile);
  assert.equal(env.COMPOSE_DISABLE_ENV_FILE, 'true');
  assert.equal(env.OPENG7_E2E_ENV_FILE, options().envFile);
  assert.equal(env.OPENG7_E2E_ISOLATED, '1');
  assert.equal(env.SANDBOX_PUBLIC_BASE_URL, 'http://127.0.0.1:48081');
  assert.equal(env.PLAYWRIGHT_BASE_URL, env.SANDBOX_PUBLIC_BASE_URL);
  assert.equal(env.MODERATION_WEB_BASE_URL, env.SANDBOX_PUBLIC_BASE_URL);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.SMTP_HOST, undefined);
  assert.equal(env.SOCIAL_PUBLICATION_MODE, undefined);
  assert.ok(env.FUNDING_ADMIN_TOKEN.length >= 32);
  assert.ok(env.FUNDING_ADMIN_SESSION_SECRET.length >= 32);
  assert.notEqual(env.FUNDING_ADMIN_TOKEN, env.FUNDING_ADMIN_SESSION_SECRET);
  assert.notEqual(env.FUNDING_ADMIN_TOKEN, another.FUNDING_ADMIN_TOKEN);
  assert.notEqual(
    env.FUNDING_ADMIN_SESSION_SECRET,
    another.FUNDING_ADMIN_SESSION_SECRET
  );
  assert.match(env.STRIPE_SECRET_KEY, /^sk_test_/);
  assert.equal(
    Object.values(env).some((value) => /forbidden|sk_live_/.test(value)),
    false
  );
});

test('sandbox environment refuses foreign projects, malformed paths and overlapping ports', () => {
  for (const changes of [
    { project: 'production' },
    { project: '../og7-acceptance-a1' },
    { manifestFile: 'relative.json' },
    { nginxFile: undefined },
    { moderationWebPort: 48080 },
    { stripePort: 3333 },
    { oidcProviderPort: 443 }
  ])
    assert.throws(() => sandboxEnvironment({ ...options(), ...changes }));
});

test('the public manifest is the exact versioned presentation contract without authentication or payment data', () => {
  const env = sandboxEnvironment(options());
  assert.deepEqual(sandboxManifest(), {
    version: 1,
    enabled: true,
    stripeBasePath: '/__sandbox/stripe'
  });
  const publicJson = JSON.stringify(sandboxManifest());
  for (const secret of [
    env.FUNDING_ADMIN_TOKEN,
    env.FUNDING_ADMIN_SESSION_SECRET,
    env.STRIPE_WEBHOOK_SECRET
  ])
    assert.equal(publicJson.includes(secret), false);
  assert.equal(
    /token|secret|password|paid|contributionId/.test(publicJson),
    false
  );
});

test('sandbox nginx preserves production routes while adding no-store same-origin Stripe routing and OIDC API', async () => {
  const source = await readFile(
    join(root, 'apps/funding-web/nginx.conf'),
    'utf8'
  );
  const configured = sandboxNginxConfiguration(source, { oidc: true });
  assert.ok(configured.includes('location = /openg7-sandbox.json {'));
  assert.ok(configured.includes('try_files /openg7-sandbox.json =404;'));
  assert.ok(configured.includes('location ^~ /__sandbox/stripe/ {'));
  assert.ok(configured.includes('proxy_pass http://stripe-stub:4242/;'));
  assert.ok(configured.includes('add_header Cache-Control "no-store" always;'));
  assert.ok(!configured.includes('proxy_pass http://api:3333;'));
  assert.equal(
    configured.match(/proxy_pass http:\/\/api:3334;/g).length,
    source.match(/proxy_pass http:\/\/api:3333;/g).length
  );
  assert.ok(configured.includes('location = /api/admin/sponsorships/logo {'));
  assert.ok(configured.includes('client_max_body_size 9m;'));
  assert.ok(configured.includes('location = /health {'));
  assert.ok(!source.includes('/openg7-sandbox.json'));
  assert.ok(
    sandboxNginxConfiguration(source).includes('proxy_pass http://api:3333;')
  );
  assert.throws(() => sandboxNginxConfiguration('server {}'));
});

test('Compose mutations always name both owned files and the unique sandbox project explicitly', () => {
  assert.deepEqual(sandboxComposeArgs(options()), [
    'compose',
    '--project-name',
    project,
    '--env-file',
    options().envFile,
    '--file',
    join(root, 'docker-compose.acceptance.yml'),
    '--file',
    join(root, 'docker-compose.sandbox.yml')
  ]);
  assert.throws(() =>
    sandboxComposeArgs({ ...options(), project: 'openg7-local' })
  );
  assert.throws(() => sandboxComposeArgs({ ...options(), envFile: '.env' }));
});

test('teardown rejects any container or network without both exact project and sandbox labels', () => {
  const owned = {
    'com.docker.compose.project': project,
    [sandboxLabel]: 'true'
  };
  assert.doesNotThrow(() => assertSandboxCleanupLabels(project, []));
  assert.doesNotThrow(() =>
    assertSandboxCleanupLabels(project, [owned, { ...owned }])
  );
  for (const resource of [
    null,
    {},
    { ...owned, [sandboxLabel]: 'false' },
    { ...owned, 'com.docker.compose.project': 'openg7-local' }
  ])
    assert.throws(
      () => assertSandboxCleanupLabels(project, [owned, resource]),
      /Refusing cleanup/
    );
  assert.throws(() => assertSandboxCleanupLabels('production', [owned]));
});

test('sandbox cleanup inspects both resource kinds before its single scoped teardown', async () => {
  const events = [];
  const owned = {
    'com.docker.compose.project': project,
    [sandboxLabel]: 'true'
  };
  await cleanupSandboxResources({
    project,
    readDocker: (args) => {
      events.push(['read', ...args]);
      if (args[0] === 'ps') return 'a'.repeat(12) + '\n' + 'b'.repeat(64);
      if (args[0] === 'network') return 'c'.repeat(12);
      assert.equal(args[0], 'inspect');
      return args
        .slice(5)
        .map(() => JSON.stringify(owned))
        .join('\n');
    },
    run: async (command, args) => {
      events.push(['mutate', command, ...args]);
    }
  });
  assert.deepEqual(
    events.map((event) => event[0]),
    ['read', 'read', 'read', 'read', 'mutate']
  );
  assert.equal(events[0].at(-1), `label=com.docker.compose.project=${project}`);
  assert.equal(events[2].at(-1), `label=com.docker.compose.project=${project}`);
  assert.deepEqual(events.at(-1), [
    'mutate',
    'docker',
    'compose',
    'down',
    '--remove-orphans'
  ]);
});

test('sandbox cleanup refuses foreign or uninspectable resources before any mutation', async (t) => {
  const owned = {
    'com.docker.compose.project': project,
    [sandboxLabel]: 'true'
  };
  for (const fault of [
    'foreign-container',
    'foreign-network',
    'missing-label',
    'invalid-id',
    'invalid-json',
    'read-failure'
  ]) {
    await t.test(fault, async () => {
      const mutations = [];
      await assert.rejects(
        cleanupSandboxResources({
          project,
          readDocker: (args) => {
            if (fault === 'read-failure')
              throw new Error('Synthetic Docker read failure');
            if (args[0] === 'ps')
              return fault === 'invalid-id'
                ? '../foreign-resource'
                : 'a'.repeat(12);
            if (args[0] === 'network') return 'b'.repeat(12);
            if (fault === 'invalid-json') return 'not JSON';
            const kind = args[2];
            if (fault === `foreign-${kind}`)
              return JSON.stringify({
                ...owned,
                'com.docker.compose.project': 'openg7-local'
              });
            if (fault === 'missing-label')
              return JSON.stringify({ 'com.docker.compose.project': project });
            return JSON.stringify(owned);
          },
          run: async (...args) => {
            mutations.push(args);
          }
        })
      );
      assert.deepEqual(mutations, []);
    });
  }
  let reads = 0;
  await assert.rejects(
    cleanupSandboxResources({
      project: 'openg7-local',
      readDocker: () => {
        reads++;
        return '';
      },
      run: async () => {
        throw new Error('Must not mutate');
      }
    }),
    /Invalid sandbox cleanup project/
  );
  assert.equal(reads, 0);
});

test('sandbox cleanup propagates a failed teardown without retrying or targeting another stack', async () => {
  const mutations = [];
  const failure = new Error('Synthetic teardown failure');
  await assert.rejects(
    cleanupSandboxResources({
      project,
      readDocker: () => '',
      run: async (command, args) => {
        mutations.push([command, ...args]);
        throw failure;
      }
    }),
    (error) => error === failure
  );
  assert.deepEqual(mutations, [
    ['docker', 'compose', 'down', '--remove-orphans']
  ]);
});

test('interactive startup migrates an empty private DB and waits for explicit stop without seeding or running Playwright', async () => {
  const commands = [];
  const ready = Promise.withResolvers();
  const stop = Promise.withResolvers();
  let cleanups = 0;
  const pending = sandboxStages({
    run: async (command, args) => commands.push([command, ...args]),
    node: 'node',
    ready: () => ready.resolve(),
    waitForStop: () => stop.promise,
    cleanup: async () => {
      cleanups++;
    }
  });
  await ready.promise;
  assert.equal(cleanups, 0);
  assert.ok(
    commands.some(
      (command) => command.join(' ') === 'node scripts/db-migrate.mjs'
    )
  );
  assert.ok(
    commands.some(
      (command) =>
        command.join(' ') ===
        'docker compose up -d --wait api mailpit stripe-stub web-oidc'
    )
  );
  assert.ok(
    commands.some((command) =>
      command.includes('/app/tests/identity/docker-moderation-server.mjs')
    )
  );
  assert.ok(
    commands.some((command) =>
      command.includes('scripts/lib/admin-acceptance-readiness.mjs')
    )
  );
  assert.equal(
    commands.some((command) =>
      /e2e-seed|playwright|db:restore|:live/.test(command.join(' '))
    ),
    false
  );
  stop.resolve();
  await pending;
  assert.equal(cleanups, 1);
});

test('a stop line from a pipe releases the interactive lifetime and performs cleanup once', async () => {
  const input = new PassThrough();
  const stop = Promise.withResolvers();
  const ready = Promise.withResolvers();
  let cleanups = 0;
  const detach = listenForSandboxStop(input, () => stop.resolve());
  try {
    const pending = sandboxStages({
      run: async () => {},
      node: 'node',
      ready: () => ready.resolve(),
      waitForStop: () => stop.promise,
      cleanup: async () => {
        cleanups++;
      }
    });
    await ready.promise;
    input.write('status\nnot-stop\n');
    await new Promise((done) => setImmediate(done));
    assert.equal(cleanups, 0);
    input.write('sto');
    await new Promise((done) => setImmediate(done));
    assert.equal(cleanups, 0);
    input.write('p\r\n');
    await pending;
    assert.equal(cleanups, 1);
  } finally {
    detach();
    input.destroy();
  }
});

test('ending stdin or detaching its listener never requests a sandbox shutdown', async () => {
  for (const end of [false, true]) {
    const input = new PassThrough();
    let stops = 0;
    const detach = listenForSandboxStop(input, () => {
      stops++;
    });
    if (end) input.end('ordinary input\n');
    else {
      detach();
      input.write('stop\n');
    }
    await new Promise((done) => setImmediate(done));
    assert.equal(stops, 0);
    detach();
    input.destroy();
  }
});

test('interactive startup failure cleans its own resources once and does not announce readiness', async () => {
  for (const failure of ['config', 'build', 'migration', 'identity']) {
    let cleanups = 0;
    let ready = false;
    await assert.rejects(
      sandboxStages({
        run: async (_command, args) => {
          const stage = args.join(' ');
          if (
            (failure === 'config' && args.includes('config')) ||
            (failure === 'build' && args.includes('build')) ||
            (failure === 'migration' && stage.includes('db-migrate')) ||
            (failure === 'identity' &&
              stage.includes('docker-moderation-server'))
          )
            throw new Error('Synthetic startup failure');
        },
        node: 'node',
        ready: () => {
          ready = true;
        },
        waitForStop: async () => {},
        cleanup: async () => {
          cleanups++;
        }
      }),
      /Synthetic startup failure/
    );
    assert.equal(ready, false);
    assert.equal(cleanups, 1);
  }
});

test('teardown failure is not reported as a successful interactive session', async () => {
  await assert.rejects(
    sandboxStages({
      run: async () => {},
      node: 'node',
      ready: async () => {},
      waitForStop: async () => {},
      cleanup: async () => {
        throw new Error('Synthetic cleanup refusal');
      }
    }),
    /Synthetic cleanup refusal/
  );
});

test('verify runs the dedicated browser recipe once against OIDC and never waits for stdin', async () => {
  const commands = [];
  let cleanups = 0;
  await sandboxStages({
    run: async (command, args) => commands.push([command, ...args]),
    node: 'node22',
    cli: 'synthetic-playwright-cli',
    verify: true,
    ready: async () => {},
    waitForStop: async () => {
      throw new Error('Verify must not wait for stdin');
    },
    cleanup: async () => {
      cleanups++;
    }
  });
  assert.deepEqual(commands.at(-1), [
    'node22',
    'synthetic-playwright-cli',
    'test',
    '--config',
    'tests/playwright-sandbox.config.mjs',
    '--workers=1'
  ]);
  assert.equal(
    commands.filter((command) => command.includes('synthetic-playwright-cli'))
      .length,
    1
  );
  assert.equal(
    commands.some((command) => command.includes('scripts/e2e-seed.mjs')),
    false
  );
  assert.equal(cleanups, 1);
});

test('verify preserves a browser failure, captures diagnostics and still cleans the sandbox once', async () => {
  const events = [];
  const failure = new Error('Synthetic browser failure');
  await assert.rejects(
    sandboxStages({
      run: async (_command, args) => {
        if (args[0] === 'synthetic-playwright-cli') {
          events.push('browser');
          throw failure;
        }
      },
      node: 'node22',
      cli: 'synthetic-playwright-cli',
      verify: true,
      ready: async () => {
        events.push('ready');
      },
      waitForStop: async () => {
        throw new Error('Verify must not wait');
      },
      diagnostics: async () => {
        events.push('diagnostics');
        throw new Error('Synthetic diagnostics failure');
      },
      cleanup: async () => {
        events.push('cleanup');
      }
    }),
    (error) => error === failure
  );
  assert.deepEqual(events, ['ready', 'browser', 'diagnostics', 'cleanup']);
});

test('verify rejects a missing browser runner before creating services and retains cleanup failures', async () => {
  let commands = 0;
  let cleanups = 0;
  await assert.rejects(
    sandboxStages({
      run: async () => {
        commands++;
      },
      node: 'node22',
      verify: true,
      ready: async () => {},
      waitForStop: async () => {},
      cleanup: async () => {
        cleanups++;
      }
    }),
    /Missing sandbox browser runner/
  );
  assert.equal(commands, 0);
  assert.equal(cleanups, 1);
  await assert.rejects(
    sandboxStages({
      run: async () => {},
      node: 'node22',
      cli: 'synthetic-playwright-cli',
      verify: true,
      ready: async () => {},
      waitForStop: async () => {},
      cleanup: async () => {
        throw new Error('Synthetic verification cleanup failure');
      }
    }),
    /Synthetic verification cleanup failure/
  );
});

test('sandbox override retains isolated services and labels every teardown target', async () => {
  const source = await readFile(
    join(root, 'docker-compose.sandbox.yml'),
    'utf8'
  );
  const base = await readFile(
    join(root, 'docker-compose.acceptance.yml'),
    'utf8'
  );
  assert.equal((source.match(/labels: \*sandbox-labels/g) ?? []).length, 7);
  assert.ok(source.includes("org.openg7.admin-sandbox: 'true'"));
  assert.ok(
    source.includes(
      "STUB_PUBLIC_BASE_URL: '${SANDBOX_PUBLIC_BASE_URL:?}/__sandbox/stripe'"
    )
  );
  assert.ok(
    source.includes("FUNDING_PUBLIC_BASE_URL: '${SANDBOX_PUBLIC_BASE_URL:?}'")
  );
  assert.ok(source.includes("SOCIAL_PUBLICATION_WORKER_ENABLED: 'false'"));
  assert.ok(source.includes('/usr/share/nginx/html/openg7-sandbox.json:ro'));
  assert.ok(!source.includes('ports:'));
  assert.ok(base.includes('tmpfs:'));
  assert.ok(base.includes('127.0.0.1:${ACCEPTANCE_MODERATION_WEB_PORT:?}'));
});

test('sandbox CLI help and rejected options run without a Docker daemon or inherited credentials', async () => {
  const execute = promisify(execFile);
  const { stdout } = await execute(
    process.execPath,
    ['scripts/admin-sandbox.mjs', '--help'],
    { cwd: root, windowsHide: true }
  );
  assert.match(stdout, /Ctrl\+C/);
  assert.match(stdout, /line stop/);
  await assert.rejects(
    execute(process.execPath, ['scripts/admin-sandbox.mjs', '--production'], {
      cwd: root,
      windowsHide: true
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Unknown sandbox option/);
      return true;
    }
  );
});

test('acceptance CI always runs the sandbox recipe and requires its success', async () => {
  const source = await readFile(
    join(root, '.github/workflows/admin-acceptance.yml'),
    'utf8'
  );
  const block = (name) =>
    source.match(
      new RegExp(
        `^  ${name}:\\r?\\n(?:(?!^  [a-zA-Z_][a-zA-Z0-9_]*:)[\\s\\S])*`,
        'm'
      )
    )?.[0] ?? '';
  const sandbox = block('sandbox');
  assert.match(sandbox, /run: yarn test:e2e:sandbox/);
  assert.doesNotMatch(sandbox, /^    (?:if|continue-on-error|strategy):/m);
  const recipe = sandbox
    .split(/^      - /m)
    .find((step) => step.includes('run: yarn test:e2e:sandbox'));
  assert.ok(recipe);
  assert.doesNotMatch(recipe, /^\s+(?:if|continue-on-error):/m);
  const acceptance = block('acceptance');
  assert.match(acceptance, /^    needs:\s*\[[\s\S]*?\bsandbox\b[\s\S]*?\]/m);
  assert.match(
    acceptance,
    /SANDBOX_RESULT: \$\{\{ needs\.sandbox\.result \}\}/
  );
  assert.match(acceptance, /test "\$SANDBOX_RESULT" = success/);
});
