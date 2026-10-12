import type { PublicationAutomationCommand } from '@openg7/funding-core';

import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  audit,
  publicDelivery,
  type DeliveryRow,
  type PublicationCommandsContext
} from './context.js';
import {
  assert,
  digest,
  feedConfig,
  PublicationAutomationError,
  validId
} from './policy.js';
import { DeliveryFailure, safeCode, verifyRemote } from './provider.js';
import type { Db } from './sources.js';
import { canonicalPublicationAccount } from './account-reservations.js';

type ReconcileInput = Extract<
  PublicationAutomationCommand,
  { action: 'reconcile' }
>;
type VisibilityInput = Extract<
  PublicationAutomationCommand,
  { action: 'check-visibility' }
>;
type VisibilityState = 'visible' | 'missing' | 'changed' | 'unknown';
interface EvidenceRow {
  id: string;
  delivery_id: string;
  channel: 'facebook' | 'linkedin';
  target: 'openg7' | 'openg20';
  account_id: string;
  external_post_id: string;
  message: string;
  media_snapshot: DeliveryRow['media_snapshot'];
}

async function readDelivery(
  db: Db,
  id: string,
  locked = false
): Promise<DeliveryRow> {
  const row = (
    await db.query<DeliveryRow>(
      `SELECT * FROM publication_deliveries WHERE id=$1${locked ? ' FOR UPDATE' : ''}`,
      [id]
    )
  ).rows[0];
  assert(row, 'VERSION_CONFLICT');
  return structuredClone(row);
}

function validateTarget(
  input: ReconcileInput | VisibilityInput,
  row: DeliveryRow
): void {
  assert(row.version === input.version, 'VERSION_CONFLICT');
  assert(input.confirmation === row.id, 'CONFIRMATION_REQUIRED', 400);
}

function validateInput(input: ReconcileInput | VisibilityInput): void {
  assert(
    validId(input.id) && Number.isInteger(input.version),
    'INVALID_COMMAND',
    400
  );
}

function currentDestination(
  context: PublicationCommandsContext,
  row: DeliveryRow
) {
  const configured = feedConfig(row.feed_id, context.env);
  assert(configured.config.mode === row.mode, 'MODE_CHANGED');
  const approved = canonicalPublicationAccount(row);
  const current = canonicalPublicationAccount({
    ...row,
    account_id: configured.accountId
  });
  assert(current.accountId === approved.accountId, 'DESTINATION_CHANGED');
  return configured;
}

/** Read, then remote verification, then fresh locking; no transaction spans HTTP. */
export async function reconcileDelivery(
  context: PublicationCommandsContext,
  input: ReconcileInput,
  actor: string
): Promise<{ id: string }> {
  validateInput(input);
  assert(
    typeof input.externalPostId === 'string' &&
      input.externalPostId.length > 0 &&
      input.externalPostId.length <= 200,
    'RECONCILIATION_UNAVAILABLE'
  );
  const snapshot = await withPostgresTransaction(context.pool, async (db) => {
    const row = await readDelivery(db, input.id);
    validateTarget(input, row);
    assert(row.status === 'uncertain', 'RECONCILIATION_UNAVAILABLE');
    return row;
  });
  const destination = currentDestination(context, snapshot);
  const result = await verifyRemote(
    destination.config,
    {
      ...publicDelivery(snapshot),
      // Derived composites need no asset FK, but their bytes still require
      // media investigation. They can never qualify through a text-only read.
      mediaId: snapshot.media_snapshot
        ? (snapshot.media_id ?? snapshot.id)
        : snapshot.media_id,
      accountId: canonicalPublicationAccount(snapshot).accountId
    },
    input.externalPostId
  ).catch((error: unknown) => {
    if (error instanceof DeliveryFailure)
      throw new PublicationAutomationError('REMOTE_POST_UNVERIFIED', 503);
    throw error;
  });
  // Observation is durable even if a newer moderation decision or a completion
  // failure prevents a published projection. It never fulfils an obligation.
  await withPostgresTransaction(context.pool, async (db) => {
    const current = await readDelivery(db, input.id, true);
    await audit(db, actor, 'reconciliation_result_observed', input.id, {
      observedVersion: snapshot.version,
      currentVersion: current.version,
      mode: snapshot.mode,
      feedId: snapshot.feed_id,
      contentFingerprint: digest(snapshot.message),
      externalPostId: result.externalPostId,
      externalPostUrl: result.externalPostUrl
    });
  });
  return withPostgresTransaction(context.pool, async (db) => {
    const current = await readDelivery(db, input.id, true);
    validateTarget(input, current);
    assert(current.status === 'uncertain', 'RECONCILIATION_UNAVAILABLE');
    const refreshed = currentDestination(context, current);
    assert(
      refreshed.fingerprint === destination.fingerprint,
      'DESTINATION_CHANGED'
    );
    await context.complete(
      db,
      current,
      result.externalPostId,
      result.externalPostUrl,
      actor,
      'provider_verified'
    );
    await audit(db, actor, 'reconcile', current.id, {
      version: current.version,
      feedId: current.feed_id,
      mode: current.mode,
      provenance: 'provider_verified'
    });
    return { id: current.id };
  });
}

/** Immutable fulfilled facts are the comparison source, rather than an edited delivery. */
export async function checkDeliveryVisibility(
  context: PublicationCommandsContext,
  input: VisibilityInput,
  actor: string
): Promise<{ id: string }> {
  validateInput(input);
  assert(validId(input.requestId), 'INVALID_COMMAND', 400);
  const fingerprint = digest(
    JSON.stringify({
      action: input.action,
      id: input.id,
      version: input.version,
      confirmation: input.confirmation,
      actor
    })
  );
  const snapshot = await withPostgresTransaction(context.pool, async (db) => {
    const row = await readDelivery(db, input.id);
    validateTarget(input, row);
    const evidence = (
      await db.query<EvidenceRow>(
        `SELECT id,delivery_id,channel,target,account_id,external_post_id,message,media_snapshot FROM sponsorship_fulfilment_evidence WHERE delivery_id=$1 AND mode='live' ORDER BY id`,
        [row.id]
      )
    ).rows;
    assert(evidence.length > 0, 'VISIBILITY_EVIDENCE_REQUIRED');
    const previous = (
      await db.query<{ evidence_id: string; request_fingerprint: string }>(
        'SELECT evidence_id,request_fingerprint FROM sponsorship_fulfilment_visibility WHERE evidence_id=ANY($1::uuid[]) AND request_id=$2',
        [evidence.map((item) => item.id), input.requestId]
      )
    ).rows;
    assert(
      previous.every((item) => item.request_fingerprint === fingerprint),
      'VISIBILITY_REQUEST_CONFLICT'
    );
    return { row, evidence, replay: previous.length === evidence.length };
  });
  if (snapshot.replay) return { id: snapshot.row.id };
  const original = snapshot.evidence[0];
  const historicalAccount = canonicalPublicationAccount({
    ...snapshot.row,
    feed_id: `${original.target}:${original.channel}` as DeliveryRow['feed_id'],
    account_id: original.account_id,
    mode: 'live'
  });
  const comparison = {
    ...publicDelivery(snapshot.row),
    feedId: `${original.target}:${original.channel}` as DeliveryRow['feed_id'],
    accountId: historicalAccount.accountId,
    mode: 'live' as const,
    message: original.message,
    mediaId: original.media_snapshot
      ? ('id' in original.media_snapshot &&
          typeof original.media_snapshot.id === 'string' &&
          original.media_snapshot.id) ||
        'unverified-proof-media'
      : null
  };
  let state: VisibilityState = 'visible';
  let reason = 'POST_VERIFIED';
  try {
    const configured = feedConfig(comparison.feedId, context.env);
    const configuredAccount = canonicalPublicationAccount({
      ...snapshot.row,
      feed_id: comparison.feedId,
      account_id: configured.accountId,
      mode: 'live'
    });
    assert(
      configuredAccount.accountId === comparison.accountId,
      'DESTINATION_CHANGED'
    );
    await verifyRemote(
      configured.config,
      comparison,
      original.external_post_id
    );
  } catch (error) {
    reason = safeCode(error);
    state = reason === 'POST_MISMATCH' ? 'changed' : 'unknown';
  }
  // A 404/403 or timeout remains unknown. They do not establish deletion, and
  // this observation never revokes a fulfilled fact or authorizes a resend.
  return withPostgresTransaction(context.pool, async (db) => {
    const current = await readDelivery(db, input.id, true);
    validateTarget(input, current);
    for (const evidence of snapshot.evidence) {
      const inserted = await db.query(
        `INSERT INTO sponsorship_fulfilment_visibility(evidence_id,request_id,request_fingerprint,state,actor,reason_code)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(evidence_id,request_id) DO NOTHING RETURNING id`,
        [evidence.id, input.requestId, fingerprint, state, actor, reason]
      );
      const saved = (
        await db.query<{ request_fingerprint: string }>(
          'SELECT request_fingerprint FROM sponsorship_fulfilment_visibility WHERE evidence_id=$1 AND request_id=$2',
          [evidence.id, input.requestId]
        )
      ).rows[0];
      assert(
        saved?.request_fingerprint === fingerprint,
        'VISIBILITY_REQUEST_CONFLICT'
      );
      if (inserted.rowCount)
        await audit(db, actor, 'visibility_observed', current.id, {
          evidenceId: evidence.id,
          requestId: input.requestId,
          state,
          reason
        });
    }
    return { id: current.id };
  });
}
