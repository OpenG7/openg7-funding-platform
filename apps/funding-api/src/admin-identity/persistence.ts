import type { Pool } from 'pg';

import { auditAdminIdentity } from './audit.js';
import type { AdminIdentityPersistence } from './contracts.js';

export const createAdminIdentityPersistence = (
  pool: Pool,
  issuer: string
): AdminIdentityPersistence => ({
  async cleanupChallenges() {
    await pool.query(
      'DELETE FROM admin_login_challenges WHERE expires_at<=now()'
    );
  },
  async createChallenge(input) {
    await pool.query(
      `INSERT INTO admin_login_challenges (state_hash,browser_hash,verifier,nonce,return_path)
        VALUES ($1,$2,$3,$4,$5)`,
      [
        input.stateHash,
        input.browserHash,
        input.verifier,
        input.nonce,
        input.returnPath
      ]
    );
  },
  async consumeChallenge(stateHash, browserHash) {
    const challenge = (
      await pool.query(
        `DELETE FROM admin_login_challenges
          WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *`,
        [stateHash, browserHash]
      )
    ).rows[0];
    return challenge
      ? {
          verifier: challenge.verifier,
          nonce: challenge.nonce,
          returnPath: challenge.return_path
        }
      : undefined;
  },
  async resolveSession(tokenHash) {
    const result = await pool.query(
      `SELECT a.id,a.display_name,a.role,s.id AS session_id,s.expires_at
      FROM admin_identity_sessions s JOIN admin_accounts a ON a.id=s.account_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT a.disabled AND a.issuer=$2`,
      [tokenHash, issuer]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          role: row.role,
          sessionId: row.session_id,
          expiresAt: row.expires_at.toISOString()
        }
      : undefined;
  },
  async issueSession(input) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      if (input.bootstrapOwner) {
        await db.query(
          `INSERT INTO admin_accounts (issuer,subject,display_name,role) VALUES ($1,$2,$3,'owner')
              ON CONFLICT (issuer,subject) DO NOTHING`,
          [issuer, input.subject, input.displayName]
        );
      }
      const account = (
        await db.query(
          'SELECT * FROM admin_accounts WHERE issuer=$1 AND subject=$2 AND NOT disabled FOR UPDATE',
          [issuer, input.subject]
        )
      ).rows[0];
      if (!account) throw new Error('Account not permitted');
      const createdSession = await db.query(
        `INSERT INTO admin_identity_sessions (account_id,token_hash,expires_at)
            VALUES ($1,$2,now()+interval '1 hour') RETURNING id`,
        [account.id, input.tokenHash]
      );
      await auditAdminIdentity(
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
  },
  async auditSignInDenied() {
    // No provider errors, claims, codes or browser cookies enter the audit.
    await pool
      .query(
        `INSERT INTO admin_audit_log (actor,action,entity_type,metadata)
          VALUES ('anonymous','admin.sign_in.denied','admin_access','{}'::jsonb)`
      )
      .catch(() => undefined);
  },
  async listAccess() {
    const accounts = await pool.query(
      'SELECT id,subject,display_name AS "displayName",role,disabled FROM admin_accounts WHERE issuer=$1 ORDER BY created_at',
      [issuer]
    );
    const sessions = await pool.query(
      `SELECT s.id,s.account_id AS "accountId",s.created_at AS "createdAt",s.expires_at AS "expiresAt"
        FROM admin_identity_sessions s JOIN admin_accounts a ON a.id=s.account_id
        WHERE a.issuer=$1 AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.created_at DESC LIMIT 500`,
      [issuer]
    );
    return { accounts: accounts.rows, sessions: sessions.rows };
  },
  async revoke(actor, sessionId) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const updated = await db.query(
        `UPDATE admin_identity_sessions s SET revoked_at=now() FROM admin_accounts a
         WHERE s.id=$1 AND s.account_id=a.id AND a.issuer=$2 AND s.revoked_at IS NULL RETURNING s.id`,
        [sessionId, issuer]
      );
      if (updated.rowCount)
        await auditAdminIdentity(
          db,
          `admin:${actor.id}`,
          'admin.session.revoked',
          sessionId
        );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  },
  async saveAccount(actor, input) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Serialize membership changes, including concurrent attempts to remove the last owner.
      await db.query('LOCK TABLE admin_accounts IN SHARE ROW EXCLUSIVE MODE');
      const result = await db.query(
        `INSERT INTO admin_accounts (issuer,subject,display_name,role,disabled) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,disabled=EXCLUDED.disabled RETURNING id`,
        [issuer, input.subject, input.displayName, input.role, input.disabled]
      );
      const count = await db.query(
        "SELECT 1 FROM admin_accounts WHERE issuer=$1 AND role='owner' AND NOT disabled LIMIT 1",
        [issuer]
      );
      if (!count.rowCount) throw new Error('Last owner');
      await db.query(
        'UPDATE admin_identity_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',
        [result.rows[0].id]
      );
      await auditAdminIdentity(
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
});
