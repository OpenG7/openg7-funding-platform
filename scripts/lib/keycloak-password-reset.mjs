import { spawnSync } from 'node:child_process';
import { randomUUID, X509Certificate } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dockerComposeFileArgs } from './docker-config.mjs';
import { validateLocalIdentityConfig } from './local-identity.mjs';

const usernamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,127}$/;
const containerPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const projectPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const containerTemplate =
  '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"env":{{json .Config.Env}},"networks":{{json .NetworkSettings.Networks}}}';
const peerTemplate =
  '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"networks":{{json .NetworkSettings.Networks}}}';
const resetScript = `set -euo pipefail
unset KC_CLI_PASSWORD
umask 077
keytool -importcert -noprompt -alias openg7-local -file /tmp/openg7-cli-ca.pem -keystore /tmp/openg7-cli-truststore.jks -storetype JKS -storepass changeit >/dev/null
exec /opt/keycloak/bin/kcadm.sh set-password --no-config --server https://auth.openg7.test --realm master --user "$1" -r openg7 --username "$2" --temporary --truststore /tmp/openg7-cli-truststore.jks --trustpass changeit
`;

export function parseKeycloakPasswordResetArgs(args) {
  const options = { dryRun: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--username' || argument === '--admin-user') {
      const name = argument === '--username' ? 'username' : 'adminUser';
      const value = args[++index];
      if (options[name] !== undefined || !usernamePattern.test(value ?? ''))
        throw new Error(
          'Specify each username once, using 1-128 letters, digits, dots, underscores, @ or hyphens.'
        );
      options[name] = value;
    } else
      throw new Error(
        'Unknown option. Use yarn keycloak:reset-password --help. Password arguments are not accepted.'
      );
  }
  return options;
}

function publicCa(path) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65_536)
      throw new Error();
    const text = readFileSync(path, 'utf8');
    if (text.includes('PRIVATE KEY')) throw new Error();
    const certificate = new X509Certificate(text);
    const now = Date.now();
    if (
      !certificate.ca ||
      now < Date.parse(certificate.validFrom) ||
      now >= Date.parse(certificate.validTo)
    )
      throw new Error();
    return certificate.fingerprint256;
  } catch {
    throw new Error(
      'A valid public local rootCA.pem is required. No private key may be supplied.'
    );
  }
}

export function keycloakPasswordResetPlan({ root, env, options }) {
  validateLocalIdentityConfig(env);
  const username =
    options.username ?? env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME;
  const adminUser =
    options.adminUser ?? env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME;
  if (
    !usernamePattern.test(username ?? '') ||
    !usernamePattern.test(adminUser ?? '')
  )
    throw new Error(
      'Specify a valid target with --username and a Keycloak master administrator with --admin-user.'
    );
  const caPath = join(root, 'traefik', 'certs', 'rootCA.pem');
  if (caPath.includes(','))
    throw new Error(
      'The public CA path cannot contain a comma in a Docker bind mount.'
    );
  return {
    username,
    adminUser,
    publicOrigin: env.FUNDING_PUBLIC_BASE_URL,
    caPath,
    caFingerprint: publicCa(caPath),
    composeArgs: ['compose', ...dockerComposeFileArgs(env, { localTls: true })]
  };
}

function inspectContainer(read, containerId, plan) {
  const container = JSON.parse(
    read(['inspect', '--format', containerTemplate, containerId])
  );
  const project = container.labels?.['com.docker.compose.project'];
  if (
    container.id !== containerId ||
    !imagePattern.test(container.image ?? '') ||
    container.running !== true ||
    !projectPattern.test(project ?? '') ||
    container.labels?.['com.docker.compose.service'] !== 'keycloak' ||
    !Array.isArray(container.env)
  )
    throw new Error();
  const values = Object.fromEntries(
    container.env.map((value) => {
      if (typeof value !== 'string' || !value.includes('=')) throw new Error();
      const separator = value.indexOf('=');
      return [value.slice(0, separator), value.slice(separator + 1)];
    })
  );
  if (
    values.KC_HOSTNAME !== 'https://auth.openg7.test' ||
    values.FUNDING_PUBLIC_BASE_URL !== plan.publicOrigin
  )
    throw new Error();
  return { project, imageId: container.image, networks: container.networks };
}

// The shared edge network must not send the confirmed reset to another stack.
function verifyIdentityNetworks(read, containerId, container) {
  if (
    !container.networks ||
    typeof container.networks !== 'object' ||
    Array.isArray(container.networks)
  )
    throw new Error();
  const networks = Object.values(container.networks);
  if (!networks.length || networks.length > 8) throw new Error();
  const peers = new Map();
  let foundAuthAlias = false;
  let foundKeycloakAlias = false;
  for (const network of networks) {
    if (!containerPattern.test(network?.NetworkID ?? '')) throw new Error();
    const members = JSON.parse(
      read([
        'network',
        'inspect',
        network.NetworkID,
        '--format',
        '{{json .Containers}}'
      ])
    );
    if (!members || typeof members !== 'object' || Array.isArray(members))
      throw new Error();
    const ids = Object.keys(members);
    if (
      !ids.includes(containerId) ||
      ids.length > 128 ||
      ids.some((id) => !containerPattern.test(id))
    )
      throw new Error();
    const inspected = read(['inspect', '--format', peerTemplate, ...ids])
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    if (
      inspected.length !== ids.length ||
      new Set(inspected.map((peer) => peer.id)).size !== ids.length
    )
      throw new Error();
    for (const peer of inspected) {
      if (!ids.includes(peer.id) || peer.project !== container.project)
        throw new Error();
      peers.set(peer.id, peer);
      const attached = Object.values(peer.networks ?? {}).find(
        (item) => item?.NetworkID === network.NetworkID
      );
      if (!attached) throw new Error();
      for (const aliases of [attached.Aliases, attached.DNSNames]) {
        if (aliases == null) continue;
        if (
          !Array.isArray(aliases) ||
          aliases.some((alias) => typeof alias !== 'string')
        )
          throw new Error();
        for (const alias of aliases.map((value) => value.toLowerCase())) {
          if (alias === 'keycloak') {
            if (peer.id !== containerId) throw new Error();
            foundKeycloakAlias = true;
          }
          if (alias === 'auth.openg7.test') {
            if (peer.service !== 'traefik' || peer.running !== true)
              throw new Error();
            foundAuthAlias = true;
          }
        }
      }
    }
  }
  const keycloaks = [...peers.values()].filter(
    (peer) => peer.service === 'keycloak'
  );
  const proxies = [...peers.values()].filter(
    (peer) => peer.service === 'traefik'
  );
  if (
    keycloaks.length !== 1 ||
    keycloaks[0].id !== containerId ||
    proxies.length !== 1 ||
    proxies[0].running !== true ||
    !foundAuthAlias ||
    !foundKeycloakAlias
  )
    throw new Error();
}

function capture(runDocker, args, root, env) {
  try {
    const result = runDocker('docker', args, {
      cwd: root,
      env,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (
      result.error ||
      result.signal ||
      result.status !== 0 ||
      typeof result.stdout !== 'string'
    )
      throw new Error();
    return result.stdout;
  } catch {
    throw new Error(
      'Cannot verify the local Keycloak Docker target. No password was changed.'
    );
  }
}

export function inspectKeycloakPasswordResetTarget({
  root,
  env,
  plan,
  runDocker = spawnSync
}) {
  let endpoint;
  try {
    if (!env.DOCKER_CONTEXT && env.DOCKER_HOST) endpoint = env.DOCKER_HOST;
    else {
      const context =
        env.DOCKER_CONTEXT ||
        capture(runDocker, ['context', 'show'], root, env).trim();
      if (!context || context.length > 256 || /[\r\n\0]/.test(context))
        throw new Error();
      endpoint = JSON.parse(
        capture(
          runDocker,
          [
            'context',
            'inspect',
            context,
            '--format',
            '{{json .Endpoints.docker.Host}}'
          ],
          root,
          env
        )
      );
    }
    if (
      typeof endpoint !== 'string' ||
      /[\r\n\0]/.test(endpoint) ||
      !/^(?:unix:\/\/\/[^\r\n\0]+|npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+)$/.test(
        endpoint
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      'Password reset requires a local Unix socket or local Windows Docker pipe; remote Docker targets are refused.'
    );
  }
  const dockerArgs = ['--host', endpoint];
  const commandEnv = { ...env, DOCKER_CONTEXT: '', DOCKER_HOST: endpoint };
  const read = (args) =>
    capture(runDocker, [...dockerArgs, ...args], root, commandEnv);
  try {
    const daemonId = JSON.parse(read(['info', '--format', '{{json .ID}}']));
    if (
      typeof daemonId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,255}$/.test(daemonId)
    )
      throw new Error();
    const containerId = read([
      ...plan.composeArgs,
      'ps',
      '-q',
      'keycloak'
    ]).trim();
    if (!containerPattern.test(containerId)) throw new Error();
    const container = inspectContainer(read, containerId, plan);
    verifyIdentityNetworks(read, containerId, container);
    return {
      dockerArgs,
      commandEnv,
      containerId,
      ...container,
      daemonId,
      endpoint
    };
  } catch {
    throw new Error(
      'The managed local Keycloak container must be running on the expected HTTPS target. No password was changed.'
    );
  }
}

export function executeKeycloakPasswordReset({
  root,
  plan,
  target,
  confirmed = false,
  runDocker = spawnSync
}) {
  if (!confirmed)
    throw new Error(
      'Password reset requires explicit interactive confirmation.'
    );
  if (publicCa(plan.caPath) !== plan.caFingerprint)
    throw new Error(
      'The public local CA changed. Check the target and run the command again.'
    );
  try {
    const read = (args) =>
      capture(
        runDocker,
        [...target.dockerArgs, ...args],
        root,
        target.commandEnv
      );
    const daemonId = JSON.parse(read(['info', '--format', '{{json .ID}}']));
    const container = inspectContainer(read, target.containerId, plan);
    if (
      daemonId !== target.daemonId ||
      container.project !== target.project ||
      container.imageId !== target.imageId
    )
      throw new Error();
    verifyIdentityNetworks(read, target.containerId, container);
  } catch {
    throw new Error(
      'The Docker target changed or cannot be verified after confirmation. No password was changed.'
    );
  }
  const directory = join(root, 'var', 'keycloak-local', target.project);
  const auditPath = join(directory, 'password-resets.jsonl');
  const correlation = randomUUID();
  const audit = (result) => {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (lstatSync(directory).isSymbolicLink()) throw new Error();
      try {
        const info = lstatSync(auditPath);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      appendFileSync(
        auditPath,
        JSON.stringify({
          date: new Date().toISOString(),
          actor: plan.adminUser,
          action: 'keycloak.password.reset',
          realm: 'openg7',
          target: plan.username,
          project: target.project,
          daemonId: target.daemonId,
          correlation,
          result
        }) + '\n',
        { mode: 0o600 }
      );
    } catch {
      throw new Error(
        'Cannot record the password-reset audit. Verify the operation before retrying.'
      );
    }
  };
  audit('started');
  let result;
  try {
    result = runDocker(
      'docker',
      [
        ...target.dockerArgs,
        'run',
        '--rm',
        '--pull=never',
        '-it',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--network',
        `container:${target.containerId}`,
        '--mount',
        `type=bind,source=${plan.caPath},target=/tmp/openg7-cli-ca.pem,readonly`,
        '--entrypoint',
        '/bin/bash',
        target.imageId,
        '-c',
        resetScript,
        '--',
        plan.adminUser,
        plan.username
      ],
      { cwd: root, env: target.commandEnv, stdio: 'inherit', windowsHide: true }
    );
  } catch {
    audit('unknown');
    throw new Error(
      'Password-reset command failed. Verify the user before retrying; no automatic retry was performed.'
    );
  }
  if (result.error || result.signal || result.status !== 0) {
    audit('unknown');
    throw new Error(
      'Password-reset command did not complete successfully. Verify the user before retrying.'
    );
  }
  audit('succeeded');
  return { correlation, auditPath };
}
