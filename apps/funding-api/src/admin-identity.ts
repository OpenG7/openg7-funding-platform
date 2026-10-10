import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminIdentitySetupStatus } from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  identityHash,
  type AdminIdentity,
  type AdminIdentityConfig,
  type AdminIdentityPersistence
} from './admin-identity/contracts.js';
import {
  cookie,
  hasAccessConfirmation,
  json,
  parseAdminAccountInput,
  readAccessChange,
  setCookie
} from './admin-identity/http.js';
import {
  createAdminOidcHandler,
  loadAdminIdentityConfig
} from './admin-identity/oidc.js';
import { createAdminIdentityPersistence } from './admin-identity/persistence.js';
import { adminRoleAllows } from './admin-identity/policy.js';
import {
  createIdentityProviderHealth,
  type IdentityProviderHealth
} from './admin-identity/provider-health.js';

export { identityHash } from './admin-identity/contracts.js';
export type { AdminIdentity, AdminRole } from './admin-identity/contracts.js';
export type { IdentityProviderHealth } from './admin-identity/provider-health.js';
export {
  adminRoleAllows,
  safeAdminReturnPath,
  satisfiesMfa
} from './admin-identity/policy.js';

export const buildAdminIdentitySetupStatus = (
  identity: Pick<AdminIdentityService, 'setupStatus'> | null,
  privateDataEncryptionConfigured: boolean
): AdminIdentitySetupStatus =>
  identity?.setupStatus(privateDataEncryptionConfigured) ?? {
    mode: 'token',
    issuer: null,
    callback_url: null,
    client_id_configured: false,
    client_secret_configured: false,
    owner_bootstrap_configured: false,
    mfa_policy: 'amr',
    private_data_encryption_configured: privateDataEncryptionConfigured
  };

export class AdminIdentityService {
  readonly providerHealth: IdentityProviderHealth;
  private readonly config: AdminIdentityConfig;
  private readonly persistence: AdminIdentityPersistence;
  private readonly handleOidc: ReturnType<typeof createAdminOidcHandler>;
  private readonly identities = new WeakMap<IncomingMessage, AdminIdentity>();

  constructor(pool: Pool, env: NodeJS.ProcessEnv) {
    this.config = loadAdminIdentityConfig(env);
    this.providerHealth = createIdentityProviderHealth(this.config.issuer, env);
    this.persistence = createAdminIdentityPersistence(
      pool,
      this.config.issuer.href
    );
    this.handleOidc = createAdminOidcHandler(this.config, this.persistence);
  }

  identity(request: IncomingMessage): AdminIdentity | undefined {
    return this.identities.get(request);
  }

  setupStatus(
    privateDataEncryptionConfigured: boolean
  ): AdminIdentitySetupStatus {
    return {
      mode: 'oidc',
      issuer:
        this.config.issuer.search || this.config.issuer.hash
          ? null
          : this.config.issuer.href,
      callback_url: `${this.config.origin}/api/admin/auth/callback`,
      client_id_configured: Boolean(this.config.clientId),
      client_secret_configured: Boolean(this.config.clientSecret),
      owner_bootstrap_configured: this.config.ownerSubjects.some(Boolean),
      mfa_policy: this.config.mfaAcr.split(',').some((value) => value.trim())
        ? 'acr'
        : 'amr',
      private_data_encryption_configured: privateDataEncryptionConfigured
    };
  }

  async resolve(request: IncomingMessage): Promise<void> {
    const token = cookie(request, this.config.cookieName);
    if (!/^[\w-]{43}$/.test(token)) return;
    const identity = await this.persistence.resolveSession(identityHash(token));
    if (identity) this.identities.set(request, identity);
  }

  permits(request: IncomingMessage): boolean {
    const identity = this.identity(request);
    return (
      !!identity &&
      (request.method === 'GET' ||
        request.headers.origin === this.config.origin) &&
      adminRoleAllows(
        identity.role,
        request.method ?? '',
        new URL(request.url ?? '/', this.config.origin).pathname
      )
    );
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', this.config.origin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (path === '/admin/session') {
      json(response, 403, { error: 'Use identity sign-in.' });
      return true;
    }
    if (await this.handleOidc(request, response, url, path)) return true;
    if (path === '/admin/auth/current' && request.method === 'GET') {
      json(
        response,
        this.identity(request) ? 200 : 401,
        this.identity(request) ?? { error: 'Sign-in required.' }
      );
      return true;
    }
    if (path === '/admin/auth/logout' && request.method === 'POST') {
      if (request.headers.origin !== this.config.origin) {
        json(response, 403, { error: 'Origin refused.' });
        return true;
      }
      const identity = this.identity(request);
      if (identity) await this.revoke(identity, identity.sessionId);
      setCookie(response, '', 0, this.config);
      json(response, 200, { ok: true });
      return true;
    }
    if (path === '/admin/access' && request.method === 'GET') {
      if (!this.permits(request)) {
        json(response, this.identity(request) ? 403 : 401, {
          code: this.identity(request) ? 'OWNER_REQUIRED' : 'SESSION_EXPIRED',
          error: 'Owner session required.'
        });
        return true;
      }
      json(response, 200, await this.persistence.listAccess());
      return true;
    }
    if (path === '/admin/access' && request.method === 'POST') {
      if (!this.permits(request)) {
        json(response, this.identity(request) ? 403 : 401, {
          code: this.identity(request) ? 'ACCESS_DENIED' : 'SESSION_EXPIRED',
          error: 'Owner role and same origin required.'
        });
        return true;
      }
      try {
        const input = await readAccessChange(request);
        if (!hasAccessConfirmation(input)) {
          json(response, 400, {
            code: 'CONFIRMATION_REQUIRED',
            error: 'Confirm the exact account or session.'
          });
          return true;
        }
        if (
          typeof input.sessionId === 'string' &&
          /^[\da-f-]{36}$/i.test(input.sessionId)
        ) {
          await this.revoke(this.identity(request)!, input.sessionId);
        } else {
          await this.saveAccount(this.identity(request)!, input);
        }
        json(response, 200, { ok: true });
      } catch (error) {
        const lastOwner =
          error instanceof Error && error.message === 'Last owner';
        const invalid =
          error instanceof SyntaxError ||
          (error instanceof Error &&
            ['Invalid account', 'Body too large'].includes(error.message));
        json(response, lastOwner ? 409 : invalid ? 400 : 503, {
          code: lastOwner
            ? 'LAST_OWNER'
            : invalid
              ? 'INVALID_ACCESS_CHANGE'
              : 'ACCESS_UNAVAILABLE',
          error: lastOwner
            ? 'At least one enabled owner must remain.'
            : invalid
              ? 'Invalid access change.'
              : 'Access change unavailable.'
        });
      }
      return true;
    }
    return false;
  }
  async revoke(actor: AdminIdentity, sessionId: string): Promise<void> {
    await this.persistence.revoke(actor, sessionId);
  }

  async saveAccount(
    actor: AdminIdentity,
    input: Record<string, unknown>
  ): Promise<void> {
    await this.persistence.saveAccount(actor, parseAdminAccountInput(input));
  }
}
