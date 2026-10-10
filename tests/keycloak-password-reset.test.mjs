import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  executeKeycloakPasswordReset,
  inspectKeycloakPasswordResetTarget,
  keycloakPasswordResetPlan,
  parseKeycloakPasswordResetArgs
} from '../scripts/lib/keycloak-password-reset.mjs';
import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const privateCanary = 'synthetic-private-reset-canary-' + 's'.repeat(32);
const containerId = 'c'.repeat(64);
const imageId = 'sha256:' + 'd'.repeat(64);
const daemonId = 'e'.repeat(64);
const project = 'synthetic-keycloak-reset';
const endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const edgeNetworkId = '1'.repeat(64);
const identityNetworkId = '2'.repeat(64);
const proxyId = '3'.repeat(64);
const databaseId = '4'.repeat(64);
const extraId = '5'.repeat(64);

const identityNetworks = () => ({
  edge: { NetworkID: edgeNetworkId, Aliases: ['keycloak'] },
  identity: { NetworkID: identityNetworkId, Aliases: ['keycloak'] }
});

const configuration = () => ({
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-db-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD: privateCanary,
  FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-owner',
  FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: 'synthetic-initial-' + 'p'.repeat(32)
});

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-keycloak-reset-test-'));
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('og7-keycloak-reset-test-'));
    rmSync(target, { recursive: true, force: true });
  });
  createLocalTlsFixture(root);
  const env = configuration();
  const options = parseKeycloakPasswordResetArgs([]);
  return { root, env, options };
};

const safeError = (error) => {
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes(privateCanary));
  return true;
};

const dockerFixture = ({
  selectedEndpoint = endpoint,
  context = 'synthetic-desktop',
  failOperation,
  failure = 'status',
  psOutput = containerId,
  daemonOutputs = [JSON.stringify(daemonId)],
  transformInspection = (model) => model,
  transformNetworkMembers = (model) => model,
  transformPeerInspection = (model) => model,
  transformPeerRecords = (model) => model
} = {}) => {
  const calls = [];
  let infoCalls = 0;
  let networkCalls = 0;
  const runDocker = (command, args, options) => {
    assert.equal(command, 'docker');
    assert.ok(!args.join(' ').includes(privateCanary));
    const operationArgs = ['--context', '--host'].includes(args[0])
      ? args.slice(2)
      : args;
    calls.push({ args, operationArgs, options });
    const operation =
      operationArgs[0] === 'context'
        ? 'context-' + operationArgs[1]
        : operationArgs[0] === 'network'
          ? 'network-' + operationArgs[1]
          : operationArgs[0] === 'inspect' &&
              !operationArgs[2].includes('"image"')
            ? 'peer-inspect'
            : operationArgs[0];
    if (operation === failOperation) {
      if (failure === 'throw') throw new Error(privateCanary);
      return {
        status: failure === 'signal' ? null : 1,
        signal: failure === 'signal' ? 'SIGTERM' : undefined,
        error: failure === 'error' ? new Error(privateCanary) : undefined,
        stdout: privateCanary,
        stderr: privateCanary
      };
    }
    if (operation === 'context-show')
      return { status: 0, stdout: context, stderr: '' };
    if (operation === 'context-inspect')
      return {
        status: 0,
        stdout: JSON.stringify(selectedEndpoint),
        stderr: ''
      };
    if (operation === 'info')
      return {
        status: 0,
        stdout: daemonOutputs[Math.min(infoCalls++, daemonOutputs.length - 1)],
        stderr: ''
      };
    if (operation === 'compose')
      return { status: 0, stdout: psOutput, stderr: '' };
    if (operation === 'network-inspect') {
      const networkId = operationArgs[2];
      const members =
        networkId === edgeNetworkId
          ? { [containerId]: {}, [proxyId]: {} }
          : { [containerId]: {}, [databaseId]: {} };
      return {
        status: 0,
        stdout: JSON.stringify(
          transformNetworkMembers(members, networkId, ++networkCalls)
        ),
        stderr: ''
      };
    }
    if (operation === 'peer-inspect') {
      const peers = operationArgs.slice(3).map((id) => {
        const service =
          id === containerId
            ? 'keycloak'
            : id === proxyId
              ? 'traefik'
              : id === databaseId
                ? 'identity-postgres'
                : 'synthetic-worker';
        const networks =
          id === containerId
            ? identityNetworks()
            : id === proxyId
              ? {
                  edge: {
                    NetworkID: edgeNetworkId,
                    Aliases: ['traefik', 'auth.openg7.test']
                  }
                }
              : id === databaseId
                ? {
                    identity: {
                      NetworkID: identityNetworkId,
                      Aliases: ['identity-postgres']
                    }
                  }
                : {
                    edge: { NetworkID: edgeNetworkId, Aliases: [] },
                    identity: { NetworkID: identityNetworkId, Aliases: [] }
                  };
        return transformPeerInspection({
          id,
          project,
          service,
          running: true,
          networks
        });
      });
      return {
        status: 0,
        stdout: transformPeerRecords(peers)
          .map((peer) => JSON.stringify(peer))
          .join('\n'),
        stderr: ''
      };
    }
    if (operation === 'inspect')
      return {
        status: 0,
        stdout: JSON.stringify(
          transformInspection({
            id: containerId,
            image: imageId,
            running: true,
            networks: identityNetworks(),
            labels: {
              'com.docker.compose.service': 'keycloak',
              'com.docker.compose.project': project
            },
            env: [
              'KC_HOSTNAME=https://auth.openg7.test',
              'FUNDING_PUBLIC_BASE_URL=https://localhost',
              'KC_BOOTSTRAP_ADMIN_PASSWORD=' + privateCanary
            ]
          })
        ),
        stderr: ''
      };
    if (operation === 'run') return { status: 0, stdout: '', stderr: '' };
    throw new Error('Unexpected mocked Docker operation.');
  };
  return { calls, runDocker };
};

test('password-reset arguments accept named accounts and dry-run without accepting password arguments', () => {
  const options = parseKeycloakPasswordResetArgs([
    '--username',
    'named.owner',
    '--admin-user',
    'named.admin',
    '--dry-run'
  ]);
  assert.equal(options.username, 'named.owner');
  assert.equal(options.adminUser, 'named.admin');
  assert.equal(options.dryRun, true);
  assert.equal(options.help, false);
  assert.equal(parseKeycloakPasswordResetArgs(['--help']).help, true);
  for (const args of [
    ['--username'],
    ['--admin-user'],
    ['--unknown'],
    ['--new-password', privateCanary],
    ['--password', privateCanary]
  ])
    assert.throws(() => parseKeycloakPasswordResetArgs(args), safeError);
});

test('dry-run planning selects configured names and reads only the public local CA', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan({
    ...context,
    options: { ...context.options, dryRun: true }
  });
  assert.equal(
    plan.username,
    context.env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME
  );
  assert.equal(
    plan.adminUser,
    context.env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME
  );
  assert.equal(
    plan.caPath,
    join(context.root, 'traefik', 'certs', 'rootCA.pem')
  );
  assert.ok(plan.caFingerprint);
  assert.ok(Array.isArray(plan.composeArgs));
  assert.ok(
    plan.composeArgs.some((arg) =>
      arg.endsWith('docker-compose.identity.local.yml')
    )
  );
  assert.ok(!JSON.stringify(plan).includes(privateCanary));
  const override = keycloakPasswordResetPlan({
    ...context,
    options: {
      ...context.options,
      username: 'other.owner',
      adminUser: 'other.admin'
    }
  });
  assert.equal(override.username, 'other.owner');
  assert.equal(override.adminUser, 'other.admin');
});

test('password reset refuses production, unmanaged origins, missing accounts and unsafe account names', (t) => {
  const context = fixture(t);
  for (const change of [
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_KEYCLOAK_ENABLED: 'false' },
    { FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.org' },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { FUNDING_PUBLIC_BASE_URL: 'https://openg7.org' },
    { COMPOSE_FILE: 'custom.yml' },
    {
      FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: '',
      FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: ''
    }
  ])
    assert.throws(
      () =>
        keycloakPasswordResetPlan({
          ...context,
          env: { ...context.env, ...change }
        }),
      safeError
    );
  for (const username of [
    'name with spaces',
    '--option',
    'shell;command',
    'u'.repeat(129)
  ]) {
    assert.throws(
      () =>
        keycloakPasswordResetPlan({
          ...context,
          options: { ...context.options, username }
        }),
      safeError
    );
    assert.throws(
      () =>
        keycloakPasswordResetPlan({
          ...context,
          options: { ...context.options, adminUser: username }
        }),
      safeError
    );
  }
});

test('password reset rejects a missing, malformed or private CA instead of disabling certificate checks', (t) => {
  const context = fixture(t);
  const caPath = join(context.root, 'traefik', 'certs', 'rootCA.pem');
  const original = readFileSync(caPath);
  for (const value of [
    '',
    privateCanary,
    original.toString() + '\n-----BEGIN PRIVATE KEY-----\n' + privateCanary
  ]) {
    writeFileSync(caPath, value);
    assert.throws(() => keycloakPasswordResetPlan(context), safeError);
  }
  rmSync(caPath);
  assert.throws(() => keycloakPasswordResetPlan(context), safeError);
});

test('target inspection resolves the selected context once and pins every daemon operation to its local socket', (t) => {
  const context = fixture(t);
  const env = {
    ...context.env,
    DOCKER_CONTEXT: 'synthetic-desktop',
    DOCKER_HOST: 'tcp://ignored.invalid:2375'
  };
  const plan = keycloakPasswordResetPlan({ ...context, env });
  const docker = dockerFixture();
  const target = inspectKeycloakPasswordResetTarget({
    root: context.root,
    env,
    plan,
    runDocker: docker.runDocker
  });
  assert.deepEqual(target.dockerArgs, ['--host', endpoint]);
  assert.equal(target.commandEnv.DOCKER_CONTEXT, '');
  assert.equal(target.commandEnv.DOCKER_HOST, endpoint);
  assert.equal(target.containerId, containerId);
  assert.equal(target.imageId, imageId);
  assert.equal(target.project, project);
  assert.equal(target.daemonId, daemonId);
  assert.ok(
    !docker.calls.some(
      (call) => call.operationArgs.join(' ') === 'context show'
    )
  );
  for (const call of docker.calls.filter((item) =>
    ['info', 'compose', 'inspect', 'network'].includes(item.operationArgs[0])
  )) {
    assert.deepEqual(call.args.slice(0, 2), ['--host', endpoint]);
    assert.equal(call.options.env.DOCKER_CONTEXT, '');
    assert.equal(call.options.env.DOCKER_HOST, endpoint);
  }
});

test('target inspection discovers a default context or explicit Unix host and rejects remote daemon endpoints', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  const defaults = dockerFixture();
  inspectKeycloakPasswordResetTarget({
    ...context,
    plan,
    runDocker: defaults.runDocker
  });
  assert.ok(
    defaults.calls.some(
      (call) => call.operationArgs.join(' ') === 'context show'
    )
  );
  const unix = dockerFixture({
    selectedEndpoint: 'unix:///var/run/docker.sock'
  });
  const selected = inspectKeycloakPasswordResetTarget({
    ...context,
    env: { ...context.env, DOCKER_HOST: 'unix:///var/run/docker.sock' },
    plan,
    runDocker: unix.runDocker
  });
  assert.equal(selected.endpoint, 'unix:///var/run/docker.sock');
  assert.ok(!unix.calls.some((call) => call.operationArgs[0] === 'context'));
  for (const unsafe of [
    'tcp://localhost:2375',
    'ssh://remote.example.test',
    'npipe://remote/pipe/docker_engine',
    'unix://remote/socket',
    privateCanary
  ]) {
    const docker = dockerFixture({ selectedEndpoint: unsafe });
    assert.throws(
      () =>
        inspectKeycloakPasswordResetTarget({
          ...context,
          plan,
          runDocker: docker.runDocker
        }),
      safeError
    );
    assert.ok(
      !docker.calls.some((call) =>
        ['compose', 'inspect', 'run'].includes(call.operationArgs[0])
      )
    );
  }
});

test('target inspection rejects stopped, ambiguous, foreign or incompatible containers before any reset', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  const changes = [
    (model) => ({ ...model, id: 'unsafe-id' }),
    (model) => ({ ...model, image: 'mutable:image-tag' }),
    (model) => ({ ...model, running: false }),
    (model) => ({
      ...model,
      labels: { ...model.labels, 'com.docker.compose.service': 'api' }
    }),
    (model) => ({
      ...model,
      labels: {
        ...model.labels,
        'com.docker.compose.project': 'unsafe project'
      }
    }),
    (model) => ({
      ...model,
      env: [
        'KC_HOSTNAME=https://auth.openg7.org',
        'FUNDING_PUBLIC_BASE_URL=https://localhost'
      ]
    }),
    (model) => ({
      ...model,
      env: [
        'KC_HOSTNAME=https://auth.openg7.test',
        'FUNDING_PUBLIC_BASE_URL=https://openg7.org'
      ]
    })
  ];
  for (const transformInspection of changes) {
    const docker = dockerFixture({ transformInspection });
    assert.throws(
      () =>
        inspectKeycloakPasswordResetTarget({
          ...context,
          plan,
          runDocker: docker.runDocker
        }),
      safeError
    );
    assert.ok(!docker.calls.some((call) => call.operationArgs[0] === 'run'));
  }
  for (const psOutput of ['', containerId + '\n' + 'b'.repeat(64)]) {
    const docker = dockerFixture({ psOutput });
    assert.throws(
      () =>
        inspectKeycloakPasswordResetTarget({
          ...context,
          plan,
          runDocker: docker.runDocker
        }),
      safeError
    );
  }
});

test('HTTPS routing refuses shared projects, duplicate identity services and aliases owned by another container', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  const addExtra = (members, networkId) =>
    networkId === edgeNetworkId ? { ...members, [extraId]: {} } : members;
  const cases = [
    {
      name: 'a shared network contains another project',
      transformPeerInspection: (peer) =>
        peer.id === proxyId ? { ...peer, project: 'other-project' } : peer
    },
    {
      name: 'a second Keycloak shares the network',
      transformNetworkMembers: addExtra,
      transformPeerInspection: (peer) =>
        peer.id === extraId ? { ...peer, service: 'keycloak' } : peer
    },
    {
      name: 'a second proxy shares the network',
      transformNetworkMembers: addExtra,
      transformPeerInspection: (peer) =>
        peer.id === extraId ? { ...peer, service: 'traefik' } : peer
    },
    {
      name: 'no proxy belongs to the network',
      transformNetworkMembers: (members, networkId) =>
        networkId === edgeNetworkId ? { [containerId]: {} } : members
    },
    {
      name: 'the selected Keycloak is missing from a network',
      transformNetworkMembers: (members, networkId) =>
        networkId === edgeNetworkId ? { [proxyId]: {} } : members
    },
    {
      name: 'a network member identifier is malformed',
      transformNetworkMembers: (members) => ({ ...members, 'short-id': {} })
    },
    {
      name: 'a network identifier is malformed',
      transformInspection: (model) => ({
        ...model,
        networks: { edge: { NetworkID: 'short-id' } }
      })
    },
    {
      name: 'the selected container has no networks',
      transformInspection: (model) => ({ ...model, networks: {} })
    },
    {
      name: 'network inspection returns an array',
      transformNetworkMembers: () => []
    },
    {
      name: 'the proxy is stopped',
      transformPeerInspection: (peer) =>
        peer.id === proxyId ? { ...peer, running: false } : peer
    },
    {
      name: 'another service claims the Keycloak DNS alias',
      transformNetworkMembers: addExtra,
      transformPeerInspection: (peer) =>
        peer.id === extraId
          ? {
              ...peer,
              networks: {
                edge: {
                  NetworkID: edgeNetworkId,
                  Aliases: ['KEYCLOAK']
                }
              }
            }
          : peer
    },
    {
      name: 'another service claims the public authentication DNS name',
      transformNetworkMembers: addExtra,
      transformPeerInspection: (peer) =>
        peer.id === extraId
          ? {
              ...peer,
              networks: {
                edge: {
                  NetworkID: edgeNetworkId,
                  DNSNames: ['AUTH.OPENG7.TEST']
                }
              }
            }
          : peer
    },
    {
      name: 'the proxy does not claim the authentication hostname',
      transformPeerInspection: (peer) =>
        peer.id === proxyId
          ? {
              ...peer,
              networks: {
                edge: { NetworkID: edgeNetworkId, Aliases: ['traefik'] }
              }
            }
          : peer
    },
    {
      name: 'Keycloak does not claim its upstream DNS name',
      transformPeerInspection: (peer) =>
        peer.id === containerId
          ? {
              ...peer,
              networks: {
                edge: { NetworkID: edgeNetworkId, Aliases: [] },
                identity: { NetworkID: identityNetworkId, Aliases: [] }
              }
            }
          : peer
    },
    {
      name: 'a member is attached to a different network',
      transformPeerInspection: (peer) =>
        peer.id === proxyId ? { ...peer, networks: {} } : peer
    },
    {
      name: 'an inspected member is duplicated',
      transformPeerRecords: (peers) => peers.map(() => peers[0])
    },
    {
      name: 'an inspected member is absent',
      transformPeerRecords: (peers) => peers.slice(1)
    }
  ];
  for (const { name, ...options } of cases) {
    const docker = dockerFixture(options);
    assert.throws(
      () =>
        inspectKeycloakPasswordResetTarget({
          ...context,
          plan,
          runDocker: docker.runDocker
        }),
      safeError,
      name
    );
    assert.ok(
      !docker.calls.some((call) => call.operationArgs[0] === 'run'),
      name
    );
  }
});

test('captured Docker failures never reveal private command output or exception details', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  for (const failOperation of [
    'context-show',
    'context-inspect',
    'info',
    'compose',
    'inspect',
    'network-inspect',
    'peer-inspect'
  ]) {
    for (const failure of ['status', 'signal', 'error', 'throw']) {
      const docker = dockerFixture({ failOperation, failure });
      assert.throws(
        () =>
          inspectKeycloakPasswordResetTarget({
            ...context,
            plan,
            runDocker: docker.runDocker
          }),
        safeError
      );
    }
  }
});

test('interactive execution uses an ephemeral CLI image and public CA while prompting for both passwords', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  const docker = dockerFixture();
  const target = inspectKeycloakPasswordResetTarget({
    ...context,
    plan,
    runDocker: docker.runDocker
  });
  executeKeycloakPasswordReset({
    root: context.root,
    plan,
    target,
    confirmed: true,
    runDocker: docker.runDocker
  });
  const call = docker.calls.find((item) => item.operationArgs[0] === 'run');
  assert.ok(call);
  assert.deepEqual(call.args.slice(0, 2), ['--host', endpoint]);
  assert.ok(call.operationArgs.includes('--rm'));
  assert.ok(call.operationArgs.includes('--tmpfs'));
  assert.ok(
    call.operationArgs.includes('--pull=never') ||
      (call.operationArgs.includes('--pull') &&
        call.operationArgs.includes('never'))
  );
  assert.ok(
    call.operationArgs.includes('-it') ||
      (call.operationArgs.includes('-i') && call.operationArgs.includes('-t'))
  );
  assert.ok(call.operationArgs.includes('container:' + containerId));
  assert.ok(call.operationArgs.includes(imageId));
  assert.ok(
    call.operationArgs.some(
      (arg) => arg.includes(plan.caPath) && arg.includes('readonly')
    )
  );
  assert.ok(!call.operationArgs.includes('--env'));
  assert.equal(call.options.stdio, 'inherit');
  const script = call.operationArgs[call.operationArgs.indexOf('-c') + 1];
  assert.match(script, /KC_CLI_PASSWORD/);
  assert.match(script, /--no-config/);
  assert.match(script, /https:\/\/auth\.openg7\.test/);
  assert.match(script, /--temporary/);
  assert.ok(!script.includes('--new-password'));
  assert.ok(!script.includes('--password '));
  assert.ok(!JSON.stringify(call.args).includes(privateCanary));
  assert.ok(
    !JSON.stringify(call.args).includes(
      context.env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD
    )
  );
  const lines = readFileSync(
    join(
      context.root,
      'var',
      'keycloak-local',
      project,
      'password-resets.jsonl'
    ),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((entry) => entry.result),
    ['started', 'succeeded']
  );
  assert.equal(lines[0].actor, plan.adminUser);
  assert.equal(lines[0].target, plan.username);
  assert.equal(lines[0].correlation, lines[1].correlation);
  assert.ok(!JSON.stringify(lines).includes(privateCanary));
});

test('execution requires confirmation and refuses a daemon or container changed since inspection', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  const docker = dockerFixture();
  const target = inspectKeycloakPasswordResetTarget({
    ...context,
    plan,
    runDocker: docker.runDocker
  });
  const inspectedCalls = docker.calls.length;
  assert.throws(
    () =>
      executeKeycloakPasswordReset({
        root: context.root,
        plan,
        target,
        runDocker: docker.runDocker
      }),
    safeError
  );
  assert.equal(docker.calls.length, inspectedCalls);
  for (const daemonOutput of [JSON.stringify('f'.repeat(64)), privateCanary]) {
    const changed = dockerFixture({
      daemonOutputs: [JSON.stringify(daemonId), daemonOutput]
    });
    const inspected = inspectKeycloakPasswordResetTarget({
      ...context,
      plan,
      runDocker: changed.runDocker
    });
    assert.throws(
      () =>
        executeKeycloakPasswordReset({
          root: context.root,
          plan,
          target: inspected,
          confirmed: true,
          runDocker: changed.runDocker
        }),
      safeError
    );
    assert.ok(!changed.calls.some((call) => call.operationArgs[0] === 'run'));
  }
  let inspections = 0;
  const changedContainer = dockerFixture({
    transformInspection: (model) =>
      ++inspections === 1
        ? model
        : { ...model, image: 'sha256:' + 'b'.repeat(64) }
  });
  const inspected = inspectKeycloakPasswordResetTarget({
    ...context,
    plan,
    runDocker: changedContainer.runDocker
  });
  assert.throws(
    () =>
      executeKeycloakPasswordReset({
        root: context.root,
        plan,
        target: inspected,
        confirmed: true,
        runDocker: changedContainer.runDocker
      }),
    safeError
  );
  assert.ok(
    !changedContainer.calls.some((call) => call.operationArgs[0] === 'run')
  );
  assert.equal(
    existsSync(
      join(
        context.root,
        'var',
        'keycloak-local',
        project,
        'password-resets.jsonl'
      )
    ),
    false
  );
});

test('execution reinspects network membership after confirmation before launching the password reset', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  for (const changedPeer of [
    (peer) => ({ ...peer, project: 'other-project' }),
    (peer) => ({
      ...peer,
      networks: {
        edge: { NetworkID: edgeNetworkId, DNSNames: ['auth.openg7.test'] }
      }
    })
  ]) {
    let confirmed = false;
    const docker = dockerFixture({
      transformNetworkMembers: (members, networkId) =>
        confirmed && networkId === edgeNetworkId
          ? { ...members, [extraId]: {} }
          : members,
      transformPeerInspection: (peer) =>
        peer.id === extraId ? changedPeer(peer) : peer
    });
    const target = inspectKeycloakPasswordResetTarget({
      ...context,
      plan,
      runDocker: docker.runDocker
    });
    confirmed = true;
    assert.throws(
      () =>
        executeKeycloakPasswordReset({
          root: context.root,
          plan,
          target,
          confirmed: true,
          runDocker: docker.runDocker
        }),
      safeError
    );
    assert.ok(!docker.calls.some((call) => call.operationArgs[0] === 'run'));
  }
  assert.equal(
    existsSync(
      join(
        context.root,
        'var',
        'keycloak-local',
        project,
        'password-resets.jsonl'
      )
    ),
    false
  );
});

test('execution refuses a changed CA and reports a failed interactive process without exposing its diagnostics', (t) => {
  const context = fixture(t);
  const plan = keycloakPasswordResetPlan(context);
  const docker = dockerFixture();
  const target = inspectKeycloakPasswordResetTarget({
    ...context,
    plan,
    runDocker: docker.runDocker
  });
  const original = readFileSync(plan.caPath);
  const alternateCa = createLocalTlsFixture(
    join(context.root, 'replacement-ca')
  );
  writeFileSync(plan.caPath, readFileSync(alternateCa.caPath));
  assert.throws(
    () =>
      executeKeycloakPasswordReset({
        root: context.root,
        plan,
        target,
        confirmed: true,
        runDocker: docker.runDocker
      }),
    safeError
  );
  assert.ok(!docker.calls.some((call) => call.operationArgs[0] === 'run'));
  writeFileSync(plan.caPath, original);
  for (const failure of ['status', 'signal', 'error', 'throw']) {
    const failing = dockerFixture({ failOperation: 'run', failure });
    assert.throws(
      () =>
        executeKeycloakPasswordReset({
          root: context.root,
          plan,
          target,
          confirmed: true,
          runDocker: failing.runDocker
        }),
      safeError
    );
  }
  const audit = readFileSync(
    join(
      context.root,
      'var',
      'keycloak-local',
      project,
      'password-resets.jsonl'
    ),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    audit.map((entry) => entry.result),
    [
      'started',
      'unknown',
      'started',
      'unknown',
      'started',
      'unknown',
      'started',
      'unknown'
    ]
  );
  assert.ok(!JSON.stringify(audit).includes(privateCanary));
});
