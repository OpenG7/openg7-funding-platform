import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool, PoolClient } from 'pg';
import * as oidc from 'openid-client';

export type AdminRole = 'reader' | 'operator' | 'owner';
export interface AdminIdentity {
  id: string;
  sessionId: string;
  displayName: string;
  role: AdminRole;
  expiresAt: string;
}
export const identityHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const random = (): string => randomBytes(32).toString('base64url');
const roles: readonly string[] = ['reader', 'operator', 'owner'];
const operatorActions = new Set([
  '/admin/pilotage/command',
  '/admin/pilotage/receipt',
  '/admin/sponsorships/details',
  '/admin/sponsorships/review',
  '/admin/sponsorships/request-information',
  '/admin/sponsorships/publication',
  '/admin/sponsorships/media',
  '/admin/sponsorships/media/delete',
  '/admin/sponsorships/media/review',
  '/admin/sponsorships/logo',
  '/admin/sponsorships/logo/delete',
  '/admin/email-queue/retry',
  '/admin/sponsorship-invoices/resend',
  '/admin/sponsorship-credit-notes/resend',
  '/admin/publication-drafts',
  '/admin/publication-drafts/update',
  '/admin/publication-batches',
  '/admin/publication-batches/assign',
  '/admin/publication-batches/unassign',
  '/admin/publication-batches/schedule',
  '/admin/publication-batches/cancel',
  '/admin/publication-batches/publish',
  '/admin/publication-batches/publish-social',
  '/admin/publication-slots',
  '/admin/publication-slots/update',
  '/admin/publication-slots/assign-batch',
  '/admin/publication-slots/assign-draft',
  '/admin/publication-slots/cancel',
  '/admin/publication-slots/publish',
  '/admin/assistant/query',
  '/admin/assistant/prepare'
]);
export const adminRoleAllows = (
  role: AdminRole,
  method: string,
  pathname: string
): boolean => {
  const path = pathname.replace(/^\/api(?=\/)/, '');
  if (role === 'owner') return true;
  if (
    path.startsWith('/admin/access') ||
    path === '/admin/contributions.csv' ||
    path === '/admin/setup-status' ||
    path === '/admin/sponsorships/followup-access'
  )
    return false;
  if (method === 'GET') return true;
  // These read-only queries use POST so private search text stays out of URLs.
  if (
    method === 'POST' &&
    ['/admin/search', '/admin/assistant/query'].includes(path)
  )
    return true;
  return role === 'operator' && method === 'POST' && operatorActions.has(path);
};
export const safeAdminReturnPath = (candidate: string | null): string => {
  if (!candidate || candidate.includes('\\')) return '/admin/fundraiser';
  const url = new URL(candidate, 'https://admin.invalid');
  return url.origin === 'https://admin.invalid' &&
    /^\/admin\/fundraiser(?:\/|$)/.test(url.pathname)
    ? url.pathname + url.search
    : '/admin/fundraiser';
};
export const satisfiesMfa = (
  claims: Record<string, unknown>,
  acceptedAcr: readonly string[]
): boolean =>
  (Array.isArray(claims.amr) && claims.amr.includes('mfa')) ||
  (typeof claims.acr === 'string' && acceptedAcr.includes(claims.acr));

const audit = async (
  db: PoolClient,
  actor: string,
  action: string,
  target: string,
  metadata: Record<string, unknown> = {}
): Promise<void> => {
  await db.query(
    `INSERT INTO admin_audit_log (actor,action,entity_type,entity_id,metadata)
    VALUES ($1,$2,'admin_access',$3,$4::jsonb)`,
    [actor, action, target, JSON.stringify(metadata)]
  );
};
export class AdminIdentityService {
  private configuration: Promise<oidc.Configuration> | undefined;
  private readonly issuer: URL;
  private readonly origin: string;
  private readonly cookieName: string;
  private readonly secure: boolean;
  private readonly identities = new WeakMap<IncomingMessage, AdminIdentity>();
  constructor(
    private readonly pool: Pool,
    private readonly env: NodeJS.ProcessEnv
  ) {
    this.issuer = new URL(env.FUNDING_ADMIN_OIDC_ISSUER ?? '');
    const base = new URL(env.FUNDING_PUBLIC_BASE_URL ?? '');
    this.origin = base.origin;
    this.secure = base.protocol === 'https:';
    const local = (url: URL): boolean =>
      env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!this.secure && !local(base)) ||
      (this.issuer.protocol !== 'https:' && !local(this.issuer)) ||
      base.username ||
      base.password ||
      this.issuer.username ||
      this.issuer.password ||
      !env.FUNDING_ADMIN_OIDC_CLIENT_ID ||
      !env.FUNDING_ADMIN_OIDC_CLIENT_SECRET
    ) {
      throw new Error(
        'OIDC requires a secure origin, issuer, client ID and client secret.'
      );
    }
    this.cookieName = this.secure ? '__Host-og7-admin' : 'og7-admin';
  }
  private client(): Promise<oidc.Configuration> {
    return (this.configuration ??= oidc
      .discovery(
        this.issuer,
        this.env.FUNDING_ADMIN_OIDC_CLIENT_ID!,
        this.env.FUNDING_ADMIN_OIDC_CLIENT_SECRET!,
        undefined,
        {
          timeout: 10,
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(this.issuer.protocol === 'http:'
              ? [oidc.allowInsecureRequests]
              : [])
          ]
        }
      )
      .catch((error: unknown) => {
        this.configuration = undefined;
        throw error;
      }));
  }
  private cookie(request: IncomingMessage, name = this.cookieName): string {
    return (
      (request.headers.cookie ?? '')
        .split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${name}=`))
        ?.slice(name.length + 1) ?? ''
    );
  }
  private setCookie(
    response: ServerResponse,
    value: string,
    age: number,
    name = this.cookieName
  ): void {
    response.setHeader(
      'Set-Cookie',
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.secure ? '; Secure' : ''}`
    );
  }
  identity(request: IncomingMessage): AdminIdentity | undefined {
    return this.identities.get(request);
  }
  async resolve(request: IncomingMessage): Promise<void> {
    const token = this.cookie(request);
    if (!/^[\w-]{43}$/.test(token)) return;
    const result = await this.pool.query(
      `SELECT a.id,a.display_name,a.role,s.id AS session_id,s.expires_at
      FROM admin_identity_sessions s JOIN admin_accounts a ON a.id=s.account_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT a.disabled AND a.issuer=$2`,
      [identityHash(token), this.issuer.href]
    );
    const row = result.rows[0];
    if (row)
      this.identities.set(request, {
        id: row.id,
        displayName: row.display_name,
        role: row.role,
        sessionId: row.session_id,
        expiresAt: row.expires_at.toISOString()
      });
  }
  permits(request: IncomingMessage): boolean {
    const identity = this.identity(request);
    return (
      !!identity &&
      (request.method === 'GET' || request.headers.origin === this.origin) &&
      adminRoleAllows(
        identity.role,
        request.method ?? '',
        new URL(request.url ?? '/', this.origin).pathname
      )
    );
  }
  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(JSON.stringify(value));
  }
  private redirect(response: ServerResponse, location: string): void {
    response.writeHead(303, {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    });
    response.end();
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', this.origin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (path === '/admin/session') {
      this.json(response, 403, { error: 'Use identity sign-in.' });
      return true;
    }
    if (path === '/admin/auth/start' && request.method === 'GET') {
      const client = await this.client();
      const state = random(),
        browser = random(),
        verifier = oidc.randomPKCECodeVerifier(),
        nonce = random();
      await this.pool.query(
        'DELETE FROM admin_login_challenges WHERE expires_at<=now()'
      );
      await this.pool.query(
        `INSERT INTO admin_login_challenges (state_hash,browser_hash,verifier,nonce,return_path)
        VALUES ($1,$2,$3,$4,$5)`,
        [
          identityHash(state),
          identityHash(browser),
          verifier,
          nonce,
          safeAdminReturnPath(url.searchParams.get('returnUrl'))
        ]
      );
      this.setCookie(response, browser, 300, `${this.cookieName}-login`);
      this.redirect(
        response,
        oidc.buildAuthorizationUrl(client, {
          redirect_uri: `${this.origin}/api/admin/auth/callback`,
          scope: 'openid profile',
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          ...(this.env.FUNDING_ADMIN_OIDC_MFA_ACR
            ? {
                acr_values: this.env.FUNDING_ADMIN_OIDC_MFA_ACR.replace(
                  /,/g,
                  ' '
                )
              }
            : {})
        }).href
      );
      return true;
    }
    if (path === '/admin/auth/callback' && request.method === 'GET') {
      this.setCookie(response, '', 0, `${this.cookieName}-login`);
      try {
        const state = url.searchParams.get('state') ?? '';
        const challenge = (
          await this.pool.query(
            `DELETE FROM admin_login_challenges
          WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *`,
            [
              identityHash(state),
              identityHash(this.cookie(request, `${this.cookieName}-login`))
            ]
          )
        ).rows[0];
        if (!challenge) throw new Error('Invalid challenge');
        const callback = new URL(
          `${this.origin}/api/admin/auth/callback${url.search}`
        );
        const tokens = await oidc.authorizationCodeGrant(
          await this.client(),
          callback,
          {
            pkceCodeVerifier: challenge.verifier,
            expectedState: state,
            expectedNonce: challenge.nonce,
            idTokenExpected: true
          }
        );
        const claims = tokens.claims();
        if (
          !claims ||
          !satisfiesMfa(
            claims,
            (this.env.FUNDING_ADMIN_OIDC_MFA_ACR ?? '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          )
        )
          throw new Error('MFA required');
        const token = random();
        const db = await this.pool.connect();
        try {
          await db.query('BEGIN');
          if (
            (this.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? '')
              .split(',')
              .map((value) => value.trim())
              .includes(claims.sub)
          ) {
            await db.query(
              `INSERT INTO admin_accounts (issuer,subject,display_name,role) VALUES ($1,$2,$3,'owner')
              ON CONFLICT (issuer,subject) DO NOTHING`,
              [
                this.issuer.href,
                claims.sub,
                typeof claims.name === 'string'
                  ? claims.name.slice(0, 120)
                  : 'Administrator'
              ]
            );
          }
          const account = (
            await db.query(
              'SELECT * FROM admin_accounts WHERE issuer=$1 AND subject=$2 AND NOT disabled FOR UPDATE',
              [this.issuer.href, claims.sub]
            )
          ).rows[0];
          if (!account) throw new Error('Account not permitted');
          const createdSession = await db.query(
            `INSERT INTO admin_identity_sessions (account_id,token_hash,expires_at)
            VALUES ($1,$2,now()+interval '1 hour') RETURNING id`,
            [account.id, identityHash(token)]
          );
          await audit(
            db,
            `admin:${account.id}`,
            'admin.session.created',
            createdSession.rows[0].id
          );
          await db.query('COMMIT');
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        } finally {
          db.release();
        }
        // Keep both cookie headers: clear the one-time login cookie and set the session.
        const cleared = response.getHeader('Set-Cookie') as string;
        this.setCookie(response, token, 3600);
        response.setHeader('Set-Cookie', [
          cleared,
          response.getHeader('Set-Cookie') as string
        ]);
        this.redirect(response, challenge.return_path);
      } catch {
        // No provider errors, claims, codes or browser cookies enter the audit.
        await this.pool
          .query(
            `INSERT INTO admin_audit_log (actor,action,entity_type,metadata)
          VALUES ('anonymous','admin.sign_in.denied','admin_access','{}'::jsonb)`
          )
          .catch(() => undefined);
        this.redirect(response, '/admin/login?identityError=1');
      }
      return true;
    }
    if (path === '/admin/auth/current' && request.method === 'GET') {
      this.json(
        response,
        this.identity(request) ? 200 : 401,
        this.identity(request) ?? { error: 'Sign-in required.' }
      );
      return true;
    }
    if (path === '/admin/auth/logout' && request.method === 'POST') {
      if (request.headers.origin !== this.origin) {
        this.json(response, 403, { error: 'Origin refused.' });
        return true;
      }
      const identity = this.identity(request);
      if (identity) await this.revoke(identity, identity.sessionId);
      this.setCookie(response, '', 0);
      this.json(response, 200, { ok: true });
      return true;
    }
    if (path === '/admin/access' && request.method === 'GET') {
      if (!this.permits(request)) {
        this.json(response, 403, { error: 'Owner role required.' });
        return true;
      }
      const accounts = await this.pool.query(
        'SELECT id,subject,display_name AS "displayName",role,disabled FROM admin_accounts WHERE issuer=$1 ORDER BY created_at',
        [this.issuer.href]
      );
      const sessions = await this.pool.query(
        `SELECT s.id,s.account_id AS "accountId",s.created_at AS "createdAt",s.expires_at AS "expiresAt"
        FROM admin_identity_sessions s JOIN admin_accounts a ON a.id=s.account_id
        WHERE a.issuer=$1 AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.created_at DESC LIMIT 500`,
        [this.issuer.href]
      );
      this.json(response, 200, {
        accounts: accounts.rows,
        sessions: sessions.rows
      });
      return true;
    }
    if (path === '/admin/access' && request.method === 'POST') {
      if (!this.permits(request)) {
        this.json(response, 403, {
          error: 'Owner role and same origin required.'
        });
        return true;
      }
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString();
          if (body.length > 4096) throw new Error('Body too large');
        }
        const input = JSON.parse(body) as Record<string, unknown>;
        if (
          typeof input.sessionId === 'string' &&
          /^[\da-f-]{36}$/i.test(input.sessionId)
        ) {
          await this.revoke(this.identity(request)!, input.sessionId);
        } else {
          await this.saveAccount(this.identity(request)!, input);
        }
        this.json(response, 200, { ok: true });
      } catch {
        this.json(response, 400, {
          error: 'Invalid change. At least one enabled owner must remain.'
        });
      }
      return true;
    }
    return false;
  }
  async revoke(actor: AdminIdentity, sessionId: string): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'UPDATE admin_identity_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL',
        [sessionId]
      );
      await audit(db, `admin:${actor.id}`, 'admin.session.revoked', sessionId);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async saveAccount(
    actor: AdminIdentity,
    input: Record<string, unknown>
  ): Promise<void> {
    if (
      typeof input.subject !== 'string' ||
      !input.subject.trim() ||
      input.subject.length > 255 ||
      typeof input.displayName !== 'string' ||
      !input.displayName.trim() ||
      input.displayName.length > 120 ||
      typeof input.role !== 'string' ||
      !roles.includes(input.role) ||
      typeof input.disabled !== 'boolean'
    )
      throw new Error('Invalid account');
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      // Serialize membership changes, including concurrent attempts to remove the last owner.
      await db.query('LOCK TABLE admin_accounts IN SHARE ROW EXCLUSIVE MODE');
      const result = await db.query(
        `INSERT INTO admin_accounts (issuer,subject,display_name,role,disabled) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,disabled=EXCLUDED.disabled RETURNING id`,
        [
          this.issuer.href,
          input.subject,
          input.displayName.trim(),
          input.role,
          input.disabled
        ]
      );
      const count = await db.query(
        "SELECT 1 FROM admin_accounts WHERE issuer=$1 AND role='owner' AND NOT disabled LIMIT 1",
        [this.issuer.href]
      );
      if (!count.rowCount) throw new Error('Last owner');
      await db.query(
        'UPDATE admin_identity_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',
        [result.rows[0].id]
      );
      await audit(
        db,
        `admin:${actor.id}`,
        'admin.account.updated',
        result.rows[0].id,
        { role: input.role, disabled: input.disabled }
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
}
