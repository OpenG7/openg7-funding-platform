import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

import { dockerComposeFileArgs } from './docker-config.mjs';
import { validateKeycloakInitialUserConfig } from './keycloak-config.mjs';
import { validateLocalIdentityConfig } from './local-identity.mjs';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const dockerName = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const daemonIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,255}$/;
const stateError = () =>
  new Error(
    'Invalid local initial-user state or Docker daemon binding. Preserve the identity database and reconcile the private bootstrap state.'
  );

export function validateInitialUserConfig(env) {
  if (!validateKeycloakInitialUserConfig(env)) return false;
  validateLocalIdentityConfig(env);
  return true;
}

function capturedDocker(runDocker, args, options) {
  try {
    const result = runDocker('docker', args, {
      ...options,
      encoding: 'utf8',
      stdio: 'pipe',
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
    // Neither rendered Compose configuration nor daemon diagnostics may escape.
    throw new Error(
      'Cannot verify the local identity database target with Docker. No initial user was prepared.'
    );
  }
}

function dockerTarget({ root, env, runDocker }) {
  const dockerEnv = { ...process.env, ...env };
  let args;
  let pinnedEnv;
  if (dockerEnv.DOCKER_CONTEXT) {
    args = ['--context', dockerEnv.DOCKER_CONTEXT];
    pinnedEnv = { DOCKER_CONTEXT: dockerEnv.DOCKER_CONTEXT };
  } else if (dockerEnv.DOCKER_HOST) {
    args = ['--host', dockerEnv.DOCKER_HOST];
    pinnedEnv = { DOCKER_HOST: dockerEnv.DOCKER_HOST, DOCKER_CONTEXT: '' };
  } else {
    const context = capturedDocker(runDocker, ['context', 'show'], {
      cwd: root,
      env: dockerEnv
    }).trim();
    if (!context || context.length > 256 || /[\r\n\0]/.test(context))
      throw new Error(
        'Cannot resolve a stable Docker context for local identity preparation.'
      );
    args = ['--context', context];
    pinnedEnv = { DOCKER_CONTEXT: context };
  }
  const commandEnv = { ...dockerEnv, ...pinnedEnv };
  let daemonId;
  try {
    daemonId = JSON.parse(
      capturedDocker(runDocker, [...args, 'info', '--format', '{{json .ID}}'], {
        cwd: root,
        env: commandEnv
      })
    );
    if (typeof daemonId !== 'string' || !daemonIdPattern.test(daemonId))
      throw new Error();
  } catch {
    throw new Error(
      'Cannot verify the Docker daemon identity. No initial user was prepared.'
    );
  }
  return { args, commandEnv, pinnedEnv, daemonId };
}

function identityTarget({ root, env, runDocker, target }) {
  try {
    const configuration = JSON.parse(
      capturedDocker(
        runDocker,
        [
          ...target.args,
          'compose',
          ...dockerComposeFileArgs(env, { localTls: true }),
          'config',
          '--format',
          'json'
        ],
        {
          cwd: root,
          env: {
            ...target.commandEnv,
            FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE:
              './docker/keycloak/openg7-realm.json'
          }
        }
      )
    );
    const project = configuration.name;
    const volume = configuration.volumes?.['identity-postgres-data']?.name;
    const mounts = configuration.services?.['identity-postgres']?.volumes;
    const dataMounts = Array.isArray(mounts)
      ? mounts.filter((mount) => mount.target === '/var/lib/postgresql/data')
      : [];
    if (
      typeof project !== 'string' ||
      typeof volume !== 'string' ||
      !dockerName.test(project ?? '') ||
      !dockerName.test(volume ?? '') ||
      dataMounts.length !== 1 ||
      dataMounts[0].type !== 'volume' ||
      dataMounts[0].source !== 'identity-postgres-data'
    )
      throw new Error();
    return { project, volume };
  } catch {
    throw new Error(
      'Cannot resolve the managed local identity database target. No initial user was prepared.'
    );
  }
}

function readCanonicalRealm(root) {
  try {
    const realm = JSON.parse(
      readFileSync(
        join(root, 'docker', 'keycloak', 'openg7-realm.json'),
        'utf8'
      )
    );
    if (realm.realm !== 'openg7' || realm.users !== undefined)
      throw new Error();
    return realm;
  } catch {
    throw new Error(
      'Cannot prepare the initial user from the canonical Keycloak realm.'
    );
  }
}

function readState(path, expected) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65_536)
      throw new Error();
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (
      state.version !== 2 ||
      state.daemonId !== expected.daemonId ||
      state.project !== expected.project ||
      state.volume !== expected.volume ||
      state.username !== expected.username ||
      !uuid.test(state.subject ?? '') ||
      Object.keys(state).some(
        (key) =>
          ![
            'version',
            'project',
            'volume',
            'username',
            'daemonId',
            'subject'
          ].includes(key)
      )
    )
      throw new Error();
    return state;
  } catch {
    throw stateError();
  }
}

function writeImport(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error();
      if (readFileSync(path, 'utf8') === text) return;
    }
    // The protected parent directory remains 0700. The bind-mounted template
    // contains placeholders only and must be readable by container UID 1000.
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o644 });
    renameSync(temporary, path);
  } catch {
    throw new Error(
      'Cannot write the private local realm import. No account was changed.'
    );
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Prepare a local first-start import or preserve its DB; no Keycloak Admin API. */
export function prepareLocalInitialUser({
  root,
  env,
  runDocker = spawnSync,
  allowCreate = true,
  onWarning = console.warn
}) {
  if (env.FUNDING_KEYCLOAK_PROVISION_USER === 'true') {
    // Explicit Admin API provisioning runs after provider readiness. Never
    // invent an owner UUID or expand an import password in this path.
    validateKeycloakInitialUserConfig(env);
    env.FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE =
      './docker/keycloak/openg7-realm.json';
    env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON = '';
    return null;
  }
  if (!validateInitialUserConfig(env)) return null;
  const realm = readCanonicalRealm(root);
  const target = dockerTarget({ root, env, runDocker });
  const { project, volume } = identityTarget({ root, env, runDocker, target });
  const expected = {
    project,
    volume,
    username: env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME,
    daemonId: target.daemonId
  };
  const directory = resolve(root, 'var', 'keycloak-local', project);
  const statePath = join(directory, 'initial-user.json');
  let stateInfo;
  try {
    stateInfo = lstatSync(statePath, { throwIfNoEntry: false });
  } catch {
    throw stateError();
  }
  let state;
  if (stateInfo) state = readState(statePath, expected);
  else {
    const names = capturedDocker(
      runDocker,
      [
        ...target.args,
        'volume',
        'ls',
        '--format',
        '{{.Name}}',
        '--filter',
        `name=^${volume}$`
      ],
      { cwd: root, env: target.commandEnv }
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (names.length === 1 && names[0] === volume) {
      // Never invent an owner or reuse an unverified import/password override.
      Object.assign(env, target.pinnedEnv, {
        FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE:
          './docker/keycloak/openg7-realm.json',
        FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON: ''
      });
      onWarning(
        'The local identity database already exists without initial-user state. Automatic first-user preparation skipped; configure users and owner subjects manually.'
      );
      return null;
    }
    // Fail closed on unexpected output rather than treating it as an empty target.
    if (names.length)
      throw new Error('Cannot verify a new local identity database volume.');
    if (!allowCreate)
      throw new Error(
        'Initial-user state is missing. Initialize a new local identity database with yarn docker:up:dev:keycloak first.'
      );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    state = { version: 2, ...expected, subject: randomUUID() };
    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600
      });
    } catch (error) {
      if (error.code !== 'EEXIST')
        throw new Error(
          'Cannot persist local initial-user state. No account was created.'
        );
      state = readState(statePath, expected);
    }
  }
  realm.users = [
    {
      id: state.subject,
      username: state.username,
      enabled: true,
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      credentials: [
        {
          type: 'password',
          value: '${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}',
          temporary: true
        }
      ]
    }
  ];
  const importFile = join(directory, 'openg7-realm.json');
  writeImport(importFile, JSON.stringify(realm, null, 2) + '\n');
  // Keycloak expands placeholders recursively before parsing the JSON. Escape
  // the string content and encode dollars so that its value remains literal.
  env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON = JSON.stringify(
    env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD
  )
    .slice(1, -1)
    .replaceAll('$', '\\u0024');
  Object.assign(env, target.pinnedEnv);
  env.FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE = importFile;
  if (!env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS?.trim())
    env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = state.subject;
  return { subject: state.subject, importFile };
}
