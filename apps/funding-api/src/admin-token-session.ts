import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AdminSessionResponse } from '@openg7/funding-core';

const ADMIN_SESSION_TOKEN_PREFIX = 'openg7-admin-session.';
const ADMIN_SESSION_NONCE_BYTES = 16;

export interface AdminTokenSessionConfig {
  readonly adminToken: string;
  readonly sessionSecret: string;
  readonly sessionTtlMinutes: number;
  readonly isProduction: boolean;
  readonly projectId: string;
}

export interface AdminSessionPayload {
  readonly actor: 'funding-admin-session';
  readonly exp: number;
  readonly iat: number;
  readonly nonce: string;
  readonly v: 1;
}

const constantTimeMatches = (candidate: string, expected: string): boolean => {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
};

/** Token sessions use the startup configuration; OIDC authorization stays separate. */
export const createAdminTokenSessionService = ({
  adminToken,
  sessionSecret,
  sessionTtlMinutes,
  isProduction,
  projectId
}: AdminTokenSessionConfig) => {
  const signingSecret =
    sessionSecret || adminToken || (!isProduction ? projectId : null);

  const adminTokenMatches = (candidate: string): boolean =>
    Boolean(adminToken) && constantTimeMatches(candidate, adminToken);

  const signAdminSessionPayload = (encodedPayload: string): string | null => {
    if (!signingSecret) {
      return null;
    }
    return createHmac('sha256', signingSecret)
      .update(encodedPayload)
      .digest('base64url');
  };

  const createAdminSession = (
    now = Date.now()
  ): AdminSessionResponse | null => {
    const expiresAtMs = now + sessionTtlMinutes * 60 * 1000;
    const payload: AdminSessionPayload = {
      actor: 'funding-admin-session',
      exp: expiresAtMs,
      iat: now,
      nonce: randomBytes(ADMIN_SESSION_NONCE_BYTES).toString('base64url'),
      v: 1
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url'
    );
    const signature = signAdminSessionPayload(encodedPayload);
    if (!signature) {
      return null;
    }
    return {
      actor: payload.actor,
      expiresAt: new Date(payload.exp).toISOString(),
      sessionToken: `${ADMIN_SESSION_TOKEN_PREFIX}${encodedPayload}.${signature}`,
      ttlSeconds: Math.floor((payload.exp - payload.iat) / 1000)
    };
  };

  const verifyAdminSession = (
    candidate: string,
    now = Date.now()
  ): AdminSessionPayload | null => {
    if (!candidate.startsWith(ADMIN_SESSION_TOKEN_PREFIX)) {
      return null;
    }
    const token = candidate.slice(ADMIN_SESSION_TOKEN_PREFIX.length);
    const [encodedPayload, signature] = token.split('.', 2);
    if (!encodedPayload || !signature) {
      return null;
    }
    const expectedSignature = signAdminSessionPayload(encodedPayload);
    if (
      !expectedSignature ||
      !constantTimeMatches(signature, expectedSignature)
    ) {
      return null;
    }

    let payload: AdminSessionPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8')
      ) as AdminSessionPayload;
    } catch {
      return null;
    }
    if (
      payload.v !== 1 ||
      payload.actor !== 'funding-admin-session' ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= now
    ) {
      return null;
    }
    return payload;
  };

  return { adminTokenMatches, createAdminSession, verifyAdminSession };
};
