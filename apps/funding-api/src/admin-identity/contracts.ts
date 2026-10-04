import { createHash, randomBytes } from 'node:crypto';

export type AdminRole = 'reader' | 'operator' | 'owner';

export interface AdminIdentity {
  id: string;
  sessionId: string;
  displayName: string;
  role: AdminRole;
  expiresAt: string;
}

export interface AdminIdentityConfig {
  readonly issuer: URL;
  readonly origin: string;
  readonly cookieName: string;
  readonly secure: boolean;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly mfaAcr: string;
  readonly ownerSubjects: readonly string[];
}

export interface AdminAccountInput {
  readonly subject: string;
  readonly displayName: string;
  readonly role: AdminRole;
  readonly disabled: boolean;
}

export interface AdminLoginChallenge {
  readonly verifier: string;
  readonly nonce: string;
  readonly returnPath: string;
}

export interface AdminLoginChallengeInput extends AdminLoginChallenge {
  readonly stateHash: string;
  readonly browserHash: string;
}

export interface AdminSessionIssueInput {
  readonly subject: string;
  readonly displayName: string;
  readonly bootstrapOwner: boolean;
  readonly tokenHash: string;
}

export interface AdminAccessListing {
  readonly accounts: {
    id: string;
    subject: string;
    displayName: string;
    role: AdminRole;
    disabled: boolean;
  }[];
  readonly sessions: {
    id: string;
    accountId: string;
    createdAt: Date;
    expiresAt: Date;
  }[];
}

// OIDC uses these ports without owning a database connection or transaction.
export interface AdminOidcPersistence {
  cleanupChallenges(): Promise<void>;
  createChallenge(input: AdminLoginChallengeInput): Promise<void>;
  consumeChallenge(
    stateHash: string,
    browserHash: string
  ): Promise<AdminLoginChallenge | undefined>;
  issueSession(input: AdminSessionIssueInput): Promise<void>;
  auditSignInDenied(): Promise<void>;
}

export interface AdminIdentityPersistence extends AdminOidcPersistence {
  resolveSession(tokenHash: string): Promise<AdminIdentity | undefined>;
  listAccess(): Promise<AdminAccessListing>;
  revoke(actor: AdminIdentity, sessionId: string): Promise<void>;
  saveAccount(actor: AdminIdentity, input: AdminAccountInput): Promise<void>;
}

export const identityHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const randomIdentityToken = (): string =>
  randomBytes(32).toString('base64url');
