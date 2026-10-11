import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';

import { validateKeycloakProvisionUserConfig } from './keycloak-config.mjs';
import { validateLocalIdentityCertificates } from './local-identity.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stateError = () =>
  new Error(
    'Invalid private Keycloak provisioning state. Preserve the account and reconcile the state before retrying.'
  );
const uncertainError = () =>
  new Error(
    'The previous Keycloak user creation has an uncertain outcome. Verify the User ID and owner configuration before retrying; no creation or password reset was repeated.'
  );

/** One bounded HTTPS exchange. Credentials never follow redirects. */
export function keycloakHttpsRequest({
  url,
  method = 'GET',
  headers = {},
  body,
  ca,
  timeoutMs = 10_000
}) {
  return new Promise((resolveRequest, reject) => {
    let pending;
    let response;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        response?.destroy();
        pending?.destroy();
        reject(
          new Error(
            'Keycloak HTTPS exchange failed; sensitive diagnostics are withheld.'
          )
        );
      } else resolveRequest(result);
    };
    const deadline = setTimeout(() => finish(true), timeoutMs);
    try {
      const endpoint = new URL(url);
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash
      )
        throw new Error();
      pending = httpsRequest(
        endpoint,
        { method, headers, ca, agent: false, rejectUnauthorized: true },
        (incoming) => {
          response = incoming;
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024) return finish(true);
            chunks.push(chunk);
          });
          response.once('aborted', () => finish(true));
          response.once('error', () => finish(true));
          response.once('close', () => {
            if (!response.complete) finish(true);
          });
          response.once('end', () => {
            if (!response.complete) return finish(true);
            finish(null, {
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        }
      );
      pending.once('error', () => finish(true));
      pending.end(body);
    } catch {
      finish(true);
    }
  });
}

function checkPrivateInfo(
  info,
  { directory = false, privateMode = true, maxSize = 16_384 } = {}
) {
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile())
  )
    throw stateError();
  if (
    process.platform !== 'win32' &&
    ((typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      (privateMode && info.mode & 0o077))
  )
    throw stateError();
  if (!directory && info.size > maxSize) throw stateError();
}

function privateDirectory(root, issuer, username, { create = true } = {}) {
  const key = createHash('sha256')
    .update(issuer + '\n' + username)
    .digest('hex');
  let directory = resolve(root);
  for (const [name, privateMode] of [
    ['var', false],
    ['keycloak-provisioning', true],
    [key, true]
  ]) {
    directory = join(directory, name);
    if (create) {
      try {
        mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw stateError();
      }
    }
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (!info) throw stateError();
    checkPrivateInfo(info, { directory: true, privateMode });
  }
  return directory;
}

function readState(path, issuer, username) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  try {
    checkPrivateInfo(info);
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (
      state.version !== 1 ||
      state.issuer !== issuer ||
      state.username !== username ||
      typeof state.realmId !== 'string' ||
      !state.realmId ||
      state.realmId.length > 255 ||
      !['pending', 'verified', 'rejected'].includes(state.phase) ||
      (state.subject !== null && !uuid.test(state.subject ?? '')) ||
      (state.phase === 'verified' && !state.subject) ||
      (state.phase === 'rejected' && state.subject !== null) ||
      Object.keys(state).some(
        (key) =>
          ![
            'version',
            'issuer',
            'username',
            'realmId',
            'phase',
            'subject'
          ].includes(key)
      )
    )
      throw stateError();
    return state;
  } catch {
    throw stateError();
  }
}

function persistState(path, state) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (info) checkPrivateInfo(info);
    writeFileSync(temporary, JSON.stringify(state) + '\n', {
      flag: 'wx',
      mode: 0o600
    });
    renameSync(temporary, path);
  } catch {
    throw stateError();
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

function appendAudit(path, record) {
  let descriptor;
  try {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (info) checkPrivateInfo(info, { privateMode: true, maxSize: Infinity });
    descriptor = openSync(
      path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    // Audit history may exceed the state-file bound.
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      (process.platform !== 'win32' && opened.mode & 0o077)
    )
      throw new Error();
    writeFileSync(descriptor, JSON.stringify(record) + '\n');
  } catch {
    throw new Error(
      'Cannot record the private provisioning audit. Reconcile the account before retrying.'
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function jsonResponse(response, message) {
  try {
    if (
      response.status !== 200 ||
      typeof response.body !== 'string' ||
      response.body.length > 1024 * 1024
    )
      throw new Error();
    return JSON.parse(response.body);
  } catch {
    throw new Error(message);
  }
}

function validateUser(user, username, expectedSubject) {
  if (
    !user ||
    !uuid.test(user.id ?? '') ||
    user.id !== expectedSubject ||
    typeof user.username !== 'string' ||
    user.username.toLowerCase() !== username ||
    user.enabled !== true ||
    user.serviceAccountClientId ||
    user.federationLink
  )
    throw new Error(
      'The existing Keycloak user does not match the verified owner identity. No account was modified.'
    );
}

/** Restore a previously verified subject for rollback; no provider or writes. */
export function restoreKeycloakOwnerSubjects({ root, env }) {
  if (!validateKeycloakProvisionUserConfig(env)) return null;
  if ((env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? '').trim()) return null;
  const issuer = env.FUNDING_ADMIN_OIDC_ISSUER;
  const username = env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME.toLowerCase();
  const directory = privateDirectory(root, issuer, username, { create: false });
  const state = readState(join(directory, 'user.json'), issuer, username);
  if (state?.phase !== 'verified') throw stateError();
  env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = state.subject;
  return { subject: state.subject };
}

/** Explicit creation; uncertain POSTs never repeat or edit credentials/OTP. */
export async function provisionKeycloakUser({
  root,
  env,
  request = keycloakHttpsRequest,
  requireEnrollment = false
}) {
  if (!validateKeycloakProvisionUserConfig(env)) return null;
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )
    throw new Error('User provisioning requires TLS certificate verification.');
  const local = env.FUNDING_PLATFORM_ENV === 'development';
  let ca;
  if (local) {
    validateLocalIdentityCertificates(root);
    ca = readFileSync(join(root, 'traefik', 'certs', 'rootCA.pem'));
  }
  const issuer = env.FUNDING_ADMIN_OIDC_ISSUER;
  const origin = new URL(issuer).origin;
  const username = env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME.toLowerCase();
  const owners = (env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const directory = privateDirectory(root, issuer, username);
  const statePath = join(directory, 'user.json');
  const lockPath = join(directory, 'provision.lock');
  const auditPath = join(directory, 'audit.jsonl');
  const correlation = randomUUID();
  let state = readState(statePath, issuer, username);
  try {
    writeFileSync(lockPath, correlation + '\n', { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error(
      'Keycloak user provisioning is already in progress or its private lock is unavailable. Verify the previous operation before retrying.'
    );
  }
  const actor =
    env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID ||
    env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME;
  const audit = (result) =>
    appendAudit(auditPath, {
      date: new Date().toISOString(),
      actor,
      action: 'keycloak.user.provision',
      issuer,
      realm: 'openg7',
      target: username,
      correlation,
      result
    });
  const exchange = async (
    path,
    { method = 'GET', headers = {}, body } = {}
  ) => {
    try {
      return await request({ url: origin + path, method, headers, body, ca });
    } catch {
      throw new Error(
        'Keycloak provisioning request failed. Reconcile any pending creation before retrying.'
      );
    }
  };
  try {
    // Re-read after acquiring the lock; another completed run may have saved it.
    state = readState(statePath, issuer, username);
    audit('started');
    const discovery = jsonResponse(
      await exchange('/realms/openg7/.well-known/openid-configuration'),
      'Keycloak HTTPS discovery is unavailable. No user was changed.'
    );
    if (
      discovery.issuer !== issuer ||
      discovery.token_endpoint !== issuer + '/protocol/openid-connect/token'
    )
      throw new Error(
        'Keycloak discovery does not match the configured issuer. No user was changed.'
      );
    const service = Boolean(env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID);
    const tokenBody = new URLSearchParams(
      service
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
          }
    ).toString();
    const token = jsonResponse(
      await exchange(
        `/realms/${service ? 'openg7' : 'master'}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenBody
        }
      ),
      'Keycloak provisioning authentication failed. Check the existing bootstrap account or dedicated provisioning client; no credentials were reset.'
    );
    if (
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      token.access_token.length > 65_536 ||
      /[\r\n]/.test(token.access_token)
    )
      throw new Error(
        'Keycloak returned an invalid provisioning access token.'
      );
    const headers = { Authorization: 'Bearer ' + token.access_token };
    const realm = jsonResponse(
      await exchange('/admin/realms/openg7', { headers }),
      'Cannot verify the managed Keycloak realm with the provisioning identity.'
    );
    if (
      realm.realm !== 'openg7' ||
      realm.enabled !== true ||
      typeof realm.id !== 'string' ||
      !realm.id ||
      realm.id.length > 255 ||
      realm.sslRequired?.toLowerCase() !== 'all' ||
      realm.browserFlow !== 'openg7-password-otp'
    )
      throw new Error(
        'Keycloak must use the managed openg7 HTTPS password and OTP realm. No user was changed.'
      );
    if (state && state.realmId !== realm.id) throw stateError();
    const users = jsonResponse(
      await exchange(
        '/admin/realms/openg7/users?' +
          new URLSearchParams({ username, exact: 'true', max: '2' }),
        { headers }
      ),
      'Cannot resolve the exact Keycloak user. No user was changed.'
    );
    if (!Array.isArray(users) || users.length > 1)
      throw new Error(
        'The Keycloak username is ambiguous. No account was modified.'
      );
    let subject;
    let created = false;
    if (users.length) {
      const user = users[0];
      subject = state?.subject || (owners.includes(user.id) ? user.id : null);
      if (!subject)
        throw new Error(
          'An existing Keycloak user requires its verified User ID in owner subjects or private provisioning state. No password, OTP or owner privilege was changed.'
        );
      validateUser(user, username, subject);
    } else {
      if (state && state.phase !== 'rejected') throw uncertainError();
      state = {
        version: 1,
        issuer,
        username,
        realmId: realm.id,
        phase: 'pending',
        subject: null
      };
      persistState(statePath, state);
      audit('creation-pending');
      const response = await exchange('/admin/realms/openg7/users', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          enabled: true,
          requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
          credentials: [
            {
              type: 'password',
              value: env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD,
              temporary: true
            }
          ]
        })
      });
      // Keycloak checks manage-users before creation. A received 403 proves
      // rejection; keep the realm binding and allow a later explicit retry.
      if (response.status === 403) {
        persistState(statePath, { ...state, phase: 'rejected' });
        audit('creation-rejected');
        throw new Error(
          'Keycloak rejected user creation with HTTP 403. Verify the provisioning identity has manage-users permission and retry; no user was created.'
        );
      }
      if (response.status !== 201) throw uncertainError();
      try {
        const location = response.headers?.location;
        if (typeof location !== 'string') throw new Error();
        const url = new URL(location, origin);
        subject = url.pathname.slice('/admin/realms/openg7/users/'.length);
        if (
          url.origin !== origin ||
          url.search ||
          url.hash ||
          url.username ||
          url.password ||
          url.pathname !== '/admin/realms/openg7/users/' + subject ||
          !uuid.test(subject)
        )
          throw new Error();
      } catch {
        throw uncertainError();
      }
      // Save the acknowledged UUID before any verification that may fail.
      state.subject = subject;
      persistState(statePath, state);
      created = true;
    }
    const user = jsonResponse(
      await exchange('/admin/realms/openg7/users/' + subject, { headers }),
      'Cannot verify the acknowledged Keycloak User ID. Preserve the account and retry verification.'
    );
    validateUser(user, username, subject);
    persistState(statePath, {
      version: 1,
      issuer,
      username,
      realmId: realm.id,
      phase: 'verified',
      subject
    });
    audit(created ? 'created' : 'verified-existing');
    if (requireEnrollment) {
      const credentials = jsonResponse(
        await exchange(
          '/admin/realms/openg7/users/' + subject + '/credentials',
          { headers }
        ),
        'Cannot verify the personal Keycloak OTP enrollment before application deployment.'
      );
      if (
        !Array.isArray(credentials) ||
        !credentials.some((credential) => credential?.type === 'otp') ||
        !Array.isArray(user.requiredActions) ||
        user.requiredActions.some((action) =>
          ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'].includes(action)
        )
      )
        throw new Error(
          'Complete the personal password change and OTP enrollment before deploying the production API. The prepared Keycloak account was preserved.'
        );
      audit('enrollment-verified');
    }
    if (!owners.length) env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = subject;
    return { subject, created };
  } catch (error) {
    audit('failed');
    throw error;
  } finally {
    unlinkSync(lockPath);
  }
}
