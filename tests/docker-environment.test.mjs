import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  dockerCommandEnvironment,
  readDockerConfiguration
} from '../scripts/lib/docker-environment.mjs';
import { dockerUpPlan, parseDockerUpArgs } from '../scripts/lib/docker-up.mjs';

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]])
);
const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: hostEnv,
    stdio: 'pipe',
    windowsHide: true
  }).status === 0;
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-docker-environment-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'og7-docker-environment-')));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
};
const resolvedProbe = (input, values) => {
  const requested = JSON.parse(input).services.configuration.environment;
  return JSON.stringify({
    services: {
      configuration: {
        environment: Object.fromEntries(
          Object.keys(requested).map((name) => {
            if (name.startsWith('__OPENG7_PRESENT_'))
              return [
                name,
                Object.hasOwn(values, name.slice('__OPENG7_PRESENT_'.length))
                  ? '1'
                  : ''
              ];
            return [name, values[name] ?? ''];
          })
        )
      }
    }
  });
};

test('Docker configuration reads a fixed Compose probe without exporting dotenv values', (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, '.env'), 'unused=synthetic-private-canary\n');
  const env = {
    ...hostEnv,
    FUNDING_PUBLIC_BASE_URL: 'https://shell.example.test'
  };
  const original = { ...env };
  const configuration = readDockerConfiguration({
    env,
    cwd,
    runCompose: (command, args, options) => {
      assert.equal(command, 'docker');
      assert.deepEqual(args, [
        'compose',
        '-f',
        '-',
        'config',
        '--format',
        'json'
      ]);
      assert.equal(options.env, env);
      assert.equal(options.cwd, cwd);
      assert.equal(options.stdio, 'pipe');
      assert.doesNotMatch(
        options.input,
        /synthetic-private-canary|shell\.example/
      );
      return {
        status: 0,
        stdout: resolvedProbe(options.input, {
          FUNDING_PUBLIC_BASE_URL: env.FUNDING_PUBLIC_BASE_URL,
          FUNDING_KEYCLOAK_ENABLED: 'false',
          FUNDING_ADMIN_OIDC_MFA_ACR: ''
        })
      };
    }
  });
  assert.deepEqual(env, original);
  assert.equal(configuration.FUNDING_KEYCLOAK_ENABLED, 'false');
  assert.equal(
    configuration.FUNDING_PUBLIC_BASE_URL,
    env.FUNDING_PUBLIC_BASE_URL
  );
  assert.equal(configuration.FUNDING_ADMIN_OIDC_MFA_ACR, '');
  assert.ok(!Object.hasOwn(configuration, 'FUNDING_KEYCLOAK_DB_PASSWORD'));
  assert.ok(!Object.hasOwn(configuration, 'unused'));
});

test('Docker configuration without environment files preserves shell values without requiring Compose', (t) => {
  const env = { ...hostEnv, FUNDING_KEYCLOAK_ENABLED: 'false' };
  assert.deepEqual(
    readDockerConfiguration({
      env,
      cwd: fixture(t),
      runCompose: () => assert.fail('No environment file needs resolving')
    }),
    env
  );
});

test('Docker configuration hides errors and captured environment output', (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, '.env'), 'synthetic=value\n');
  const canary = 'synthetic-private-canary';
  for (const runCompose of [
    () => ({ status: 1, stderr: canary, stdout: canary }),
    () => ({ error: new Error(canary), stdout: canary }),
    () => ({ status: 0, stdout: canary }),
    () => ({
      status: 0,
      stdout: '{"services":{"configuration":{"environment":null}}}'
    }),
    () => {
      throw new Error(canary);
    }
  ])
    assert.throws(
      () => readDockerConfiguration({ env: hostEnv, cwd, runCompose }),
      (error) => {
        assert.match(error.message, /Cannot resolve Docker configuration/);
        assert.doesNotMatch(error.message, /private-canary/);
        return true;
      }
    );
});

test('Docker child environments keep shell settings and only add plan overrides', () => {
  const shellEnv = {
    DATABASE_URL: 'synthetic-shell-database',
    PATH: 'synthetic-path'
  };
  const configuration = {
    ...shellEnv,
    FUNDING_KEYCLOAK_ENABLED: 'false',
    FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-private-database-password',
    FUNDING_PLATFORM_ENV: 'production',
    COMPOSE_PROFILES: 'database,metrics'
  };
  const planned = {
    ...configuration,
    FUNDING_PLATFORM_ENV: 'development',
    ANGULAR_CONFIGURATION: 'development',
    COMPOSE_PROFILES: 'metrics'
  };
  const child = dockerCommandEnvironment(planned, configuration, shellEnv);
  assert.deepEqual(child, {
    ...shellEnv,
    FUNDING_PLATFORM_ENV: 'development',
    ANGULAR_CONFIGURATION: 'development',
    COMPOSE_PROFILES: 'metrics'
  });
  assert.ok(!Object.hasOwn(child, 'FUNDING_KEYCLOAK_DB_PASSWORD'));
  assert.ok(!Object.hasOwn(child, 'FUNDING_KEYCLOAK_ENABLED'));
  assert.equal(configuration.COMPOSE_PROFILES, 'database,metrics');
});

test(
  'Compose resolves interpolation, comments and quotes while the Docker child environment stays intact',
  { skip: !composeAvailable },
  (t) => {
    const cwd = fixture(t);
    writeFileSync(
      join(cwd, '.env'),
      [
        "POSTGRES_PASSWORD='synthetic-password$with#symbols'",
        'DATABASE_URL=postgres://app:${POSTGRES_PASSWORD}@postgres:5432/funding',
        'FUNDING_KEYCLOAK_ENABLED=false # provider stays disabled',
        'FUNDING_OPERATIONS_WATCHER_ENABLED="false" # watcher stays disabled',
        'FUNDING_ALLOWED_ORIGINS="https://funding.example.test" # public origin',
        "FUNDING_ADMIN_OIDC_CLIENT_SECRET='synthetic-secret-${POSTGRES_PASSWORD} # literal'",
        'FUNDING_ADMIN_OIDC_MFA_ACR=',
        "QUOTED='literal ${POSTGRES_PASSWORD} # with spaces'",
        'INLINE=value # omitted comment',
        'ESCAPED="line one\\nline two"'
      ].join('\n')
    );
    writeFileSync(
      join(cwd, 'compose.yml'),
      JSON.stringify({
        services: {
          api: {
            image: 'scratch',
            environment: {
              DATABASE_URL: '${DATABASE_URL}',
              PASSWORD: '${POSTGRES_PASSWORD}',
              QUOTED: '${QUOTED}',
              INLINE: '${INLINE}',
              ESCAPED: '${ESCAPED}',
              FUNDING_ALLOWED_ORIGINS: '${FUNDING_ALLOWED_ORIGINS}'
            }
          }
        }
      })
    );
    const configuration = readDockerConfiguration({ env: hostEnv, cwd });
    assert.equal(configuration.FUNDING_KEYCLOAK_ENABLED, 'false');
    assert.equal(configuration.FUNDING_OPERATIONS_WATCHER_ENABLED, 'false');
    assert.equal(
      configuration.FUNDING_ALLOWED_ORIGINS,
      'https://funding.example.test'
    );
    assert.equal(configuration.FUNDING_ADMIN_OIDC_MFA_ACR, '');
    assert.equal(
      configuration.FUNDING_ADMIN_OIDC_CLIENT_SECRET,
      'synthetic-secret-${POSTGRES_PASSWORD} # literal'
    );
    assert.ok(!Object.hasOwn(configuration, 'FUNDING_KEYCLOAK_DB_PASSWORD'));
    assert.ok(!Object.hasOwn(configuration, 'DATABASE_URL'));

    const render = (env) => {
      const result = spawnSync(
        'docker',
        ['compose', '-f', 'compose.yml', 'config', '--format', 'json'],
        {
          cwd,
          env,
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true
        }
      );
      assert.equal(
        result.status,
        0,
        'Synthetic Compose runtime rendering failed'
      );
      return Object.fromEntries(
        Object.entries(JSON.parse(result.stdout).services.api.environment).map(
          ([name, value]) => [name, value.replace(/\$\$/g, '$')]
        )
      );
    };
    const child = dockerCommandEnvironment(
      configuration,
      configuration,
      hostEnv
    );
    assert.deepEqual(child, hostEnv);
    const runtime = render(child);
    assert.deepEqual(runtime, render(hostEnv));
    assert.equal(
      runtime.DATABASE_URL,
      'postgres://app:synthetic-password$with#symbols@postgres:5432/funding'
    );
    assert.equal(runtime.QUOTED, 'literal ${POSTGRES_PASSWORD} # with spaces');
    assert.equal(runtime.INLINE, 'value');
    assert.equal(runtime.ESCAPED, 'line one\nline two');

    const plan = dockerUpPlan(
      parseDockerUpArgs([
        '--environment',
        'local',
        '--no-database',
        '--no-stripe-webhook'
      ]),
      { env: configuration, localTls: false }
    );
    const localRuntime = render(
      dockerCommandEnvironment(plan.commandEnv, configuration, hostEnv)
    );
    assert.equal(localRuntime.DATABASE_URL, runtime.DATABASE_URL);
    assert.equal(
      localRuntime.FUNDING_ALLOWED_ORIGINS,
      'https://funding.example.test,https://localhost,https://127.0.0.1'
    );
  }
);

test(
  'Compose environment file selection and shell precedence are preserved',
  { skip: !composeAvailable },
  (t) => {
    const cwd = fixture(t);
    writeFileSync(
      join(cwd, 'first.env'),
      'FUNDING_KEYCLOAK_ENABLED=true\nFUNDING_PUBLIC_BASE_URL=https://first.example.test\nFUNDING_ADMIN_OIDC_MFA_ACR=first\n'
    );
    writeFileSync(
      join(cwd, 'second.env'),
      'FUNDING_KEYCLOAK_ENABLED=false # latest file wins\nFUNDING_PUBLIC_BASE_URL=https://second.example.test\nFUNDING_ADMIN_OIDC_MFA_ACR=\n'
    );
    const env = {
      ...hostEnv,
      COMPOSE_ENV_FILES: 'first.env,second.env',
      FUNDING_PUBLIC_BASE_URL: 'https://shell.example.test'
    };
    const configuration = readDockerConfiguration({ env, cwd });
    assert.equal(configuration.FUNDING_KEYCLOAK_ENABLED, 'false');
    assert.equal(
      configuration.FUNDING_PUBLIC_BASE_URL,
      env.FUNDING_PUBLIC_BASE_URL
    );
    assert.equal(configuration.FUNDING_ADMIN_OIDC_MFA_ACR, '');
    assert.ok(!Object.hasOwn(configuration, 'FUNDING_KEYCLOAK_DB_PASSWORD'));
    assert.deepEqual(
      dockerCommandEnvironment(configuration, configuration, env),
      env
    );
  }
);

test(
  'Docker startup and update CLI resolve their plan without passing dotenv runtime settings to children',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t);
    mkdirSync(join(root, 'scripts/lib'), { recursive: true });
    for (const name of [
      'docker-up.mjs',
      'docker-update.mjs',
      'lib/docker-up.mjs',
      'lib/docker-update.mjs',
      'lib/docker-config.mjs',
      'lib/keycloak-config.mjs',
      'lib/docker-environment.mjs'
    ])
      writeFileSync(
        join(root, 'scripts', name),
        readFileSync(join('scripts', name))
      );
    writeFileSync(
      join(root, '.env'),
      'POSTGRES_PASSWORD=synthetic-private-runtime-password\nDATABASE_URL=postgres://app:${POSTGRES_PASSWORD}@postgres:5432/funding\nFUNDING_KEYCLOAK_ENABLED=false # optional\nFUNDING_OPERATIONS_WATCHER_ENABLED=false # optional\n'
    );
    for (const [script, args, expectedChildren] of [
      [
        'docker-up.mjs',
        ['--environment', 'prod', '--no-database', '--no-stripe-webhook'],
        3
      ],
      [
        'docker-update.mjs',
        [
          '--production',
          '--no-database',
          '--no-build-app',
          '--no-prune-images'
        ],
        4
      ]
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { EventEmitter } from 'node:events';
      import { syncBuiltinESMExports } from 'node:module';
      const compose = childProcess.spawnSync;
      let probes = 0;
      let children = 0;
      const originalEnv = { ...process.env };
      const verify = options => {
        assert.equal(options.env.DATABASE_URL, undefined);
        assert.equal(options.env.POSTGRES_PASSWORD, undefined);
        assert.equal(options.env.FUNDING_KEYCLOAK_ENABLED, undefined);
        assert.equal(options.env.FUNDING_PLATFORM_ENV, 'production');
        assert.equal(options.env.ANGULAR_CONFIGURATION, 'production');
        children++;
      };
      childProcess.spawnSync = (command, args, options) => {
        if (args.join(' ') === 'compose -f - config --format json') {
          probes++;
          assert.deepEqual(options.env, originalEnv);
          return compose(command, args, options);
        }
        verify(options);
        return { status: 0, stdout: '' };
      };
      childProcess.spawn = (_command, _args, options) => {
        verify(options);
        const child = new EventEmitter();
        process.nextTick(() => child.emit('exit', 0));
        return child;
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, ${JSON.stringify(script)}, ...${JSON.stringify(args)}];
      await import('./scripts/' + ${JSON.stringify(script)});
      assert.equal(probes, 1);
      assert.equal(children, ${expectedChildren});
      assert.deepEqual({ ...process.env }, originalEnv);
    `
        ],
        {
          cwd: root,
          env: hostEnv,
          encoding: 'utf8',
          timeout: 15000,
          windowsHide: true
        }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /synthetic-private-runtime-password|postgres:\/\//
      );
    }
  }
);

test(
  'custom Compose projects preserve root and shell precedence, nested aliases and literal dollars',
  { skip: !composeAvailable },
  (t) => {
    for (const rootFile of [false, true]) {
      const cwd = fixture(t);
      mkdirSync(join(cwd, 'nested'));
      const names = [
        'FUNDING_PLATFORM_ENV',
        'FUNDING_OPERATIONS_WATCHER_ENABLED',
        'FUNDING_KEYCLOAK_HOSTNAME',
        'FUNDING_ADMIN_OIDC_CLIENT_ID',
        'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
        'FUNDING_ALLOWED_ORIGINS'
      ];
      writeFileSync(
        join(cwd, 'nested/.env'),
        [
          'FUNDING_PLATFORM_ENV=development',
          'FUNDING_OPERATIONS_WATCHER_ENABLED=true',
          'FUNDING_KEYCLOAK_HOSTNAME=${IDENTITY_DOMAIN:-auth.nested.example.test}',
          'FUNDING_ADMIN_OIDC_CLIENT_ID=nested-client',
          "FUNDING_ADMIN_OIDC_CLIENT_SECRET='nested$single$$double${literal}'",
          'FUNDING_ALLOWED_ORIGINS=https://nested.example.test'
        ].join('\n')
      );
      writeFileSync(
        join(cwd, 'nested/compose.yml'),
        JSON.stringify({
          services: {
            api: {
              image: 'scratch',
              environment: Object.fromEntries(
                names.map((name) => [name, `\${${name}}`])
              )
            }
          }
        })
      );
      if (rootFile)
        writeFileSync(
          join(cwd, '.env'),
          [
            'COMPOSE_FILE=nested/compose.yml',
            'IDENTITY_DOMAIN=auth.root.example.test',
            'FUNDING_PLATFORM_ENV=production',
            'FUNDING_ADMIN_OIDC_CLIENT_ID=root-client',
            "FUNDING_ADMIN_OIDC_CLIENT_SECRET='root$single$$double${literal}'",
            "MULTILINE='first\nFUNDING_ALLOWED_ORIGINS=https://forged.example.test\nlast'"
          ].join('\n')
        );
      for (const shellOverrides of [false, true]) {
        const env = {
          ...hostEnv,
          ...(rootFile ? {} : { COMPOSE_FILE: 'nested/compose.yml' }),
          ...(shellOverrides
            ? {
                FUNDING_PLATFORM_ENV: 'development',
                FUNDING_ADMIN_OIDC_CLIENT_ID: 'shell-client'
              }
            : {})
        };
        const original = { ...env };
        const configuration = readDockerConfiguration({ env, cwd });
        const native = spawnSync(
          'docker',
          ['compose', 'config', '--format', 'json'],
          {
            cwd,
            env,
            encoding: 'utf8',
            stdio: 'pipe',
            windowsHide: true
          }
        );
        assert.equal(
          native.status,
          0,
          'Synthetic custom Compose rendering failed'
        );
        const values = JSON.parse(native.stdout).services.api.environment;
        for (const name of names)
          assert.equal(
            configuration[name],
            values[name].replace(/\$\$/g, '$'),
            name
          );
        assert.equal(configuration.FUNDING_OPERATIONS_WATCHER_ENABLED, 'true');
        assert.equal(
          configuration.FUNDING_PLATFORM_ENV,
          rootFile && !shellOverrides ? 'production' : 'development'
        );
        assert.equal(
          configuration.FUNDING_ADMIN_OIDC_CLIENT_ID,
          shellOverrides
            ? 'shell-client'
            : rootFile
              ? 'root-client'
              : 'nested-client'
        );
        assert.equal(
          configuration.FUNDING_ADMIN_OIDC_CLIENT_SECRET,
          `${rootFile ? 'root' : 'nested'}$single$$double\${literal}`
        );
        assert.equal(
          configuration.FUNDING_ALLOWED_ORIGINS,
          'https://nested.example.test'
        );
        assert.deepEqual(env, original);
        assert.deepEqual(
          dockerCommandEnvironment(configuration, configuration, env),
          env
        );
        assert.ok(!Object.hasOwn(configuration, 'IDENTITY_DOMAIN'));
      }
    }
  }
);
