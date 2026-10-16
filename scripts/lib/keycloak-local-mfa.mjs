import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

import { dockerComposeFileArgs } from './docker-config.mjs';
import { inspectKeycloakPasswordResetTarget } from './keycloak-password-reset.mjs';
import { keycloakHttpsRequest } from './keycloak-provision-user.mjs';
import {
  validateLocalIdentityCertificates,
  validateLocalIdentityConfig
} from './local-identity.mjs';
import { validateLocalPasswordOnly } from './local-password-policy.mjs';

const canonicalFlow = 'openg7-password-otp';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = () =>
  new Error(
    'Cannot reconcile the local Keycloak authentication profile. Preserve the identity database and retry only after verifying its configuration.'
  );
const validId = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,255}$/.test(value);

export const localPasswordFlowAlias = (clientId) =>
  'openg7-local-password-only-' +
  createHash('sha256').update(clientId).digest('hex').slice(0, 12);

function checkPath(path, directory = false) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (
    info &&
    (info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile()) ||
      (!directory && info.size > 1024 * 1024) ||
      (process.platform !== 'win32' && info.mode & 0o077))
  )
    throw failure();
  return info;
}

function privateFiles(root, env, create) {
  const key = createHash('sha256')
    .update(
      `${env.FUNDING_ADMIN_OIDC_ISSUER}\n${env.FUNDING_ADMIN_OIDC_CLIENT_ID}`
    )
    .digest('hex');
  let directory = resolve(root);
  for (const name of ['var', 'keycloak-local-auth', key]) {
    directory = join(directory, name);
    // var is a shared repository output directory; only its type is relevant.
    if (name === 'var') {
      const info = lstatSync(directory, { throwIfNoEntry: false });
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw failure();
      if (!info && create) mkdirSync(directory, { mode: 0o700 });
    } else {
      const info = checkPath(directory, true);
      if (!info && create) mkdirSync(directory, { mode: 0o700 });
    }
  }
  return {
    directory,
    state: join(directory, 'profile.json'),
    lock: join(directory, 'profile.lock'),
    audit: join(directory, 'audit.jsonl')
  };
}

function readState(path) {
  if (!checkPath(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (
      state.version !== 1 ||
      typeof state.issuer !== 'string' ||
      typeof state.clientId !== 'string' ||
      !validId(state.realmId) ||
      !uuid.test(state.clientUuid ?? '') ||
      !validId(state.project) ||
      !validId(state.daemonId) ||
      (state.previousBrowser !== null && !validId(state.previousBrowser)) ||
      (state.flowId !== null && !validId(state.flowId)) ||
      Object.keys(state).length !== 9
    )
      throw failure();
    return state;
  } catch {
    throw failure();
  }
}

function persist(path, state) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    checkPath(path);
    writeFileSync(temporary, JSON.stringify(state) + '\n', {
      mode: 0o600,
      flag: 'wx'
    });
    renameSync(temporary, path);
  } catch {
    throw failure();
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

function json(response) {
  try {
    if (
      response?.status !== 200 ||
      typeof response.body !== 'string' ||
      response.body.length > 1024 * 1024
    )
      throw failure();
    return JSON.parse(response.body);
  } catch {
    throw failure();
  }
}

function verifyClient(client, env) {
  if (
    !uuid.test(client?.id ?? '') ||
    client.clientId !== env.FUNDING_ADMIN_OIDC_CLIENT_ID ||
    client.enabled !== true ||
    client.protocol !== 'openid-connect' ||
    client.publicClient !== false ||
    client.clientAuthenticatorType !== 'client-secret' ||
    client.standardFlowEnabled !== true ||
    client.implicitFlowEnabled !== false ||
    client.directAccessGrantsEnabled !== false ||
    client.serviceAccountsEnabled !== false ||
    !Array.isArray(client.redirectUris) ||
    client.redirectUris.length !== 1 ||
    client.redirectUris[0] !==
      env.FUNDING_PUBLIC_BASE_URL + '/api/admin/auth/callback' ||
    client.attributes?.['pkce.code.challenge.method'] !== 'S256' ||
    !Array.isArray(client.protocolMappers) ||
    !client.protocolMappers.some(
      (mapper) =>
        mapper.protocolMapper === 'oidc-amr-mapper' &&
        mapper.config?.['id.token.claim'] === 'true'
    ) ||
    client.protocolMappers.some(
      (mapper) =>
        mapper.protocolMapper !== 'oidc-amr-mapper' &&
        ['amr', 'acr'].includes(mapper.config?.['claim.name'])
    ) ||
    (client.authenticationFlowBindingOverrides !== undefined &&
      (!client.authenticationFlowBindingOverrides ||
        typeof client.authenticationFlowBindingOverrides !== 'object' ||
        Array.isArray(client.authenticationFlowBindingOverrides)))
  )
    throw failure();
  return client;
}

function verifyExecutions(executions, otpRequirement) {
  if (!Array.isArray(executions) || executions.length !== 2) throw failure();
  const password = executions.find(
    (execution) => execution.providerId === 'auth-username-password-form'
  );
  const otp = executions.find(
    (execution) => execution.providerId === 'auth-otp-form'
  );
  if (
    !password ||
    !otp ||
    !validId(password.id) ||
    !validId(otp.id) ||
    password.authenticationFlow === true ||
    otp.authenticationFlow === true ||
    password.requirement !== 'REQUIRED' ||
    !otpRequirement.includes(otp.requirement)
  )
    throw failure();
  return otp;
}

/** Configure only the verified local client; never mutate the canonical realm flow. */
export async function configureLocalKeycloakMfa({
  root,
  env,
  request = keycloakHttpsRequest,
  inspectTarget = inspectKeycloakPasswordResetTarget,
  validateCertificates = validateLocalIdentityCertificates
}) {
  const passwordOnly = validateLocalPasswordOnly(env);
  const files = privateFiles(root, env, false);
  const existingState = readState(files.state);
  if (!passwordOnly && !existingState) return null;
  validateLocalIdentityConfig(env);
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )
    throw failure();
  validateCertificates(root);
  const ca = readFileSync(join(root, 'traefik', 'certs', 'rootCA.pem'));
  const target = inspectTarget({
    root,
    env,
    plan: {
      publicOrigin: env.FUNDING_PUBLIC_BASE_URL,
      composeArgs: [
        'compose',
        ...dockerComposeFileArgs(env, { localTls: true })
      ]
    }
  });
  if (!validId(target?.project) || !validId(target?.daemonId)) throw failure();
  privateFiles(root, env, true);
  try {
    writeFileSync(files.lock, '', { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error(
      'Local Keycloak authentication configuration is already in progress. Reconcile the previous operation before retrying.'
    );
  }
  const correlation = randomUUID();
  const audit = (result) => {
    try {
      checkPath(files.audit);
      appendFileSync(
        files.audit,
        JSON.stringify({
          date: new Date().toISOString(),
          actor: env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID
            ? 'provisioning-service'
            : 'bootstrap-administrator',
          action: 'keycloak.local-auth.configure',
          target: env.FUNDING_ADMIN_OIDC_CLIENT_ID,
          project: target.project,
          passwordOnly,
          correlation,
          result
        }) + '\n',
        { mode: 0o600 }
      );
    } catch {
      throw failure();
    }
  };
  let changed = false;
  let token;
  const origin = new URL(env.FUNDING_ADMIN_OIDC_ISSUER).origin;
  const exchange = async (path, { method = 'GET', body } = {}) => {
    try {
      return await request({
        url: origin + path,
        method,
        ca,
        timeoutMs: 10_000,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw failure();
    }
  };
  // Each uncertain mutation is reconciled with one bounded read, never replayed.
  const mutate = async (path, method, body, verify, statuses = [204]) => {
    let response;
    try {
      response = await exchange(path, { method, body });
    } catch {
      // The provider may have accepted the mutation before the transport failed.
    }
    const reconciled = await verify();
    if (!reconciled) throw failure();
    if (
      response &&
      !statuses.includes(response.status) &&
      response.status !== 409
    )
      throw failure();
    changed = true;
  };
  try {
    audit('started');
    const service = Boolean(env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID);
    const credentials = service
      ? {
          grant_type: 'client_credentials',
          client_id: env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID,
          client_secret: env.FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET
        }
      : {
          grant_type: 'password',
          client_id: 'admin-cli',
          username: env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME,
          password: env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD
        };
    if (Object.values(credentials).some((value) => !value)) throw failure();
    let authentication;
    try {
      authentication = await request({
        url:
          origin +
          `/realms/${service ? 'openg7' : 'master'}/protocol/openid-connect/token`,
        method: 'POST',
        ca,
        timeoutMs: 10_000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(credentials).toString()
      });
    } catch {
      throw failure();
    }
    token = json(authentication).access_token;
    if (
      typeof token !== 'string' ||
      !token ||
      token.length > 65_536 ||
      /[\r\n]/.test(token)
    )
      throw failure();
    const realm = json(await exchange('/admin/realms/openg7'));
    if (
      !validId(realm.id) ||
      realm.realm !== 'openg7' ||
      realm.enabled !== true ||
      realm.sslRequired?.toLowerCase() !== 'all' ||
      realm.browserFlow !== canonicalFlow
    )
      throw failure();
    const clients = json(
      await exchange(
        '/admin/realms/openg7/clients?' +
          new URLSearchParams({ clientId: env.FUNDING_ADMIN_OIDC_CLIENT_ID })
      )
    );
    if (
      !Array.isArray(clients) ||
      clients.length !== 1 ||
      !uuid.test(clients[0].id ?? '') ||
      clients[0].clientId !== env.FUNDING_ADMIN_OIDC_CLIENT_ID
    )
      throw failure();
    const clientPath = '/admin/realms/openg7/clients/' + clients[0].id;
    const getClient = async () =>
      verifyClient(json(await exchange(clientPath)), env);
    let client = await getClient();
    let state = readState(files.state);
    if (
      state &&
      (state.issuer !== env.FUNDING_ADMIN_OIDC_ISSUER ||
        state.clientId !== env.FUNDING_ADMIN_OIDC_CLIENT_ID ||
        state.realmId !== realm.id ||
        state.clientUuid !== client.id ||
        state.project !== target.project ||
        state.daemonId !== target.daemonId)
    )
      throw failure();
    const currentBrowser = () =>
      client.authenticationFlowBindingOverrides?.browser || null;
    if (!state) {
      if (currentBrowser())
        throw new Error(
          'The local Keycloak client already uses an unmanaged authentication override. Preserve it and reconcile the profile before proceeding.'
        );
      state = {
        version: 1,
        issuer: env.FUNDING_ADMIN_OIDC_ISSUER,
        clientId: env.FUNDING_ADMIN_OIDC_CLIENT_ID,
        realmId: realm.id,
        clientUuid: client.id,
        project: target.project,
        daemonId: target.daemonId,
        previousBrowser: null,
        flowId: null
      };
      persist(files.state, state);
    }
    if (
      currentBrowser() !== state.previousBrowser &&
      currentBrowser() !== state.flowId
    )
      throw failure();
    if (passwordOnly) {
      const alias = localPasswordFlowAlias(env.FUNDING_ADMIN_OIDC_CLIENT_ID);
      const flowsPath = '/admin/realms/openg7/authentication/flows';
      const findFlow = async () => {
        const flows = json(await exchange(flowsPath));
        if (!Array.isArray(flows) || flows.length > 256) throw failure();
        const matches = flows.filter((flow) => flow.alias === alias);
        if (matches.length > 1) throw failure();
        const flow = matches[0];
        if (
          flow &&
          (!validId(flow.id) ||
            flow.topLevel !== true ||
            flow.builtIn !== false ||
            flow.providerId !== 'basic-flow')
        )
          throw failure();
        return flow;
      };
      const executionPath = (flowAlias) =>
        flowsPath + '/' + encodeURIComponent(flowAlias) + '/executions';
      verifyExecutions(json(await exchange(executionPath(canonicalFlow))), [
        'REQUIRED'
      ]);
      let flow = await findFlow();
      if (!flow) {
        await mutate(
          flowsPath + '/' + canonicalFlow + '/copy',
          'POST',
          { newName: alias },
          async () => Boolean((flow = await findFlow())),
          [201]
        );
      }
      if (state.flowId && state.flowId !== flow.id) throw failure();
      state.flowId = flow.id;
      persist(files.state, state);
      const otp = verifyExecutions(json(await exchange(executionPath(alias))), [
        'REQUIRED',
        'DISABLED'
      ]);
      if (otp.requirement !== 'DISABLED')
        await mutate(
          executionPath(alias),
          'PUT',
          { id: otp.id, requirement: 'DISABLED' },
          async () => {
            verifyExecutions(json(await exchange(executionPath(alias))), [
              'DISABLED'
            ]);
            return true;
          }
        );
      // Only explicit bootstrap-owner subjects may have their pending OTP action removed.
      const subjects = [
        ...new Set(
          (env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ];
      if (
        subjects.length > 16 ||
        subjects.some((subject) => !uuid.test(subject))
      )
        throw failure();
      for (const subject of subjects) {
        const userPath = '/admin/realms/openg7/users/' + subject;
        const getUser = async () => {
          const user = json(await exchange(userPath));
          if (
            user.id !== subject ||
            user.enabled !== true ||
            user.serviceAccountClientId ||
            user.federationLink ||
            !Array.isArray(user.requiredActions) ||
            user.requiredActions.some((action) => typeof action !== 'string')
          )
            throw failure();
          return user;
        };
        const user = await getUser();
        if (user.requiredActions.includes('CONFIGURE_TOTP')) {
          const requiredActions = user.requiredActions.filter(
            (action) => action !== 'CONFIGURE_TOTP'
          );
          await mutate(userPath, 'PUT', { requiredActions }, async () => {
            const actual = (await getUser()).requiredActions;
            return (
              actual.length === requiredActions.length &&
              actual.every((action, index) => action === requiredActions[index])
            );
          });
        }
      }
    }
    const desiredBrowser = passwordOnly ? state.flowId : state.previousBrowser;
    client = await getClient();
    if (currentBrowser() !== desiredBrowser) {
      if (
        currentBrowser() !== state.previousBrowser &&
        currentBrowser() !== state.flowId
      )
        throw failure();
      // Keycloak 26.8 updates only supplied bindings; null removes this override.
      await mutate(
        clientPath,
        'PUT',
        { authenticationFlowBindingOverrides: { browser: desiredBrowser } },
        async () => {
          client = await getClient();
          return currentBrowser() === desiredBrowser;
        }
      );
    }
    audit('verified');
    return { passwordOnly, changed };
  } catch (error) {
    audit('failed');
    // Never forward provider errors, bodies, access tokens, or private config.
    if (error?.message?.startsWith('The local Keycloak client already'))
      throw error;
    throw failure();
  } finally {
    unlinkSync(files.lock);
  }
}
