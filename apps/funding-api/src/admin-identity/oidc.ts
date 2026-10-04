import type { IncomingMessage, ServerResponse } from 'node:http';

import * as oidc from 'openid-client';

import {
  identityHash,
  randomIdentityToken,
  type AdminIdentityConfig,
  type AdminOidcPersistence
} from './contracts.js';
import { cookie, redirect, setCookie } from './http.js';
import { safeAdminReturnPath, satisfiesMfa } from './policy.js';

export const loadAdminIdentityConfig = (
  env: NodeJS.ProcessEnv
): AdminIdentityConfig => {
  const issuer = new URL(env.FUNDING_ADMIN_OIDC_ISSUER ?? '');
  const base = new URL(env.FUNDING_PUBLIC_BASE_URL ?? '');
  const secure = base.protocol === 'https:';
  const local = (url: URL): boolean =>
    env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (!secure && !local(base)) ||
    (issuer.protocol !== 'https:' && !local(issuer)) ||
    base.username ||
    base.password ||
    issuer.username ||
    issuer.password ||
    !env.FUNDING_ADMIN_OIDC_CLIENT_ID ||
    !env.FUNDING_ADMIN_OIDC_CLIENT_SECRET
  ) {
    throw new Error(
      'OIDC requires a secure origin, issuer, client ID and client secret.'
    );
  }
  return {
    issuer,
    origin: base.origin,
    secure,
    cookieName: secure ? '__Host-og7-admin' : 'og7-admin',
    // These values were read when discovery, start or callback ran, rather
    // than captured by the service constructor.
    get clientId() {
      return env.FUNDING_ADMIN_OIDC_CLIENT_ID!;
    },
    get clientSecret() {
      return env.FUNDING_ADMIN_OIDC_CLIENT_SECRET!;
    },
    get mfaAcr() {
      return env.FUNDING_ADMIN_OIDC_MFA_ACR ?? '';
    },
    get ownerSubjects() {
      return (env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? '')
        .split(',')
        .map((value) => value.trim());
    }
  };
};

export const createAdminOidcHandler = (
  config: AdminIdentityConfig,
  persistence: AdminOidcPersistence
) => {
  let configuration: Promise<oidc.Configuration> | undefined;
  const client = (): Promise<oidc.Configuration> =>
    (configuration ??= oidc
      .discovery(
        config.issuer,
        config.clientId,
        config.clientSecret,
        undefined,
        {
          timeout: 10,
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(config.issuer.protocol === 'http:'
              ? [oidc.allowInsecureRequests]
              : [])
          ]
        }
      )
      .catch((error: unknown) => {
        configuration = undefined;
        throw error;
      }));

  return async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    path: string
  ): Promise<boolean> => {
    if (path === '/admin/auth/start' && request.method === 'GET') {
      const discovered = await client();
      const state = randomIdentityToken(),
        browser = randomIdentityToken(),
        verifier = oidc.randomPKCECodeVerifier(),
        nonce = randomIdentityToken();
      await persistence.cleanupChallenges();
      await persistence.createChallenge({
        stateHash: identityHash(state),
        browserHash: identityHash(browser),
        verifier,
        nonce,
        returnPath: safeAdminReturnPath(url.searchParams.get('returnUrl'))
      });
      setCookie(response, browser, 300, config, `${config.cookieName}-login`);
      redirect(
        response,
        oidc.buildAuthorizationUrl(discovered, {
          redirect_uri: `${config.origin}/api/admin/auth/callback`,
          scope: 'openid profile',
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          ...(config.mfaAcr
            ? { acr_values: config.mfaAcr.replace(/,/g, ' ') }
            : {})
        }).href
      );
      return true;
    }
    if (path === '/admin/auth/callback' && request.method === 'GET') {
      setCookie(response, '', 0, config, `${config.cookieName}-login`);
      try {
        const state = url.searchParams.get('state') ?? '';
        const challenge = await persistence.consumeChallenge(
          identityHash(state),
          identityHash(cookie(request, `${config.cookieName}-login`))
        );
        if (!challenge) throw new Error('Invalid challenge');
        const callback = new URL(
          `${config.origin}/api/admin/auth/callback${url.search}`
        );
        const tokens = await oidc.authorizationCodeGrant(
          await client(),
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
            config.mfaAcr
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          )
        )
          throw new Error('MFA required');
        const token = randomIdentityToken();
        await persistence.issueSession({
          subject: claims.sub,
          displayName:
            typeof claims.name === 'string'
              ? claims.name.slice(0, 120)
              : 'Administrator',
          bootstrapOwner: config.ownerSubjects.includes(claims.sub),
          tokenHash: identityHash(token)
        });
        // Clear the one-time login cookie and set the session in separate headers.
        const cleared = response.getHeader('Set-Cookie') as string;
        setCookie(response, token, 3600, config);
        response.setHeader('Set-Cookie', [
          cleared,
          response.getHeader('Set-Cookie') as string
        ]);
        redirect(response, challenge.returnPath);
      } catch {
        // No provider errors, claims, codes or browser cookies enter the audit.
        await persistence.auditSignInDenied().catch(() => undefined);
        redirect(response, '/admin/login?identityError=1');
      }
      return true;
    }
    return false;
  };
};
