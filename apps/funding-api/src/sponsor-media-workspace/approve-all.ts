import { createHash, randomUUID } from 'node:crypto';

import type {
  SponsorMediaApproveAllCandidate,
  SponsorMediaApproveAllClassification,
  SponsorMediaApproveAllExecuteRequest,
  SponsorMediaApproveAllItemResult,
  SponsorMediaApproveAllPlan,
  SponsorMediaApproveAllPlanRequest,
  SponsorMediaApproveAllReceipt,
  SponsorMediaApproveAllReceiptRequest,
  SponsorMediaApproveAllReceiptResponse,
  SponsorMediaBatchPlanRequest
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { ModerationError } from '../moderation/policy.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { readSponsorshipMediaConsentAssets } from '../sponsorship-media-consent.js';

import { preparePlanManifest, type StoredPlan } from './plan-manifest.js';
import { applyPlanMutations } from './plan-mutations.js';
import {
  ensure,
  fingerprint,
  lockWorkspace,
  MediaWorkspaceError,
  record,
  replay,
  validId,
  validateCommand
} from './policy.js';
import { readWorkspace } from './read.js';
import {
  attestMediaSources,
  type MediaSourceAttestation
} from './source-attestation.js';

interface ApproveAllMember {
  readonly candidate: SponsorMediaApproveAllCandidate;
  readonly native?: StoredPlan;
}
interface StoredApproveAllPlan {
  readonly kind: 'approve_all';
  readonly request: SponsorMediaApproveAllPlanRequest;
  readonly response: SponsorMediaApproveAllPlan;
  readonly members: readonly ApproveAllMember[];
  /** Authoritative immutable plan-column expiry, loaded with the stored JSON. */
  readonly columnExpiresAt?: string;
}
interface StartedApproval {
  readonly kind: 'approve_all';
  readonly stage: 'start';
  readonly status: 'in_progress';
  readonly request: SponsorMediaApproveAllExecuteRequest;
  readonly planId: string;
  readonly contributionId: string;
}
interface ItemReceipt {
  readonly kind: 'approve_all';
  readonly stage: 'item';
  readonly requestId: string;
  readonly planId: string;
  readonly item: SponsorMediaApproveAllItemResult;
}
interface ReceiptState {
  readonly stored: StoredApproveAllPlan;
  readonly start: StartedApproval;
  readonly result: SponsorMediaApproveAllReceipt;
  readonly finalized: boolean;
}
export interface SponsorMediaApproveAllOptions {
  /** Internal observer after the item transaction commits; never accepted from HTTP. */
  readonly afterItemCommitted?: (
    item: SponsorMediaApproveAllItemResult,
    index: number
  ) => Promise<void> | void;
}

const ownKeys = (value: unknown, keys: readonly string[]): boolean =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

export function validateApproveAllPlanRequest(
  input: SponsorMediaApproveAllPlanRequest
): void {
  ensure(
    ownKeys(input, ['requestId', 'contributionId', 'expectedRevision']),
    'INVALID_MEDIA_COMMAND',
    400
  );
  validateCommand(input);
}
export function validateApproveAllExecuteRequest(
  input: SponsorMediaApproveAllExecuteRequest
): void {
  ensure(
    ownKeys(input, ['requestId', 'planId', 'confirmation', 'humanReviewed']) &&
      validId(input.requestId) &&
      validId(input.planId) &&
      input.confirmation === input.planId &&
      input.humanReviewed === true,
    'CONFIRMATION_REQUIRED',
    400
  );
}

/** Independent namespaces keep immutable start, item, decision and final records distinct. */
export function approveAllDerivedRequestId(
  requestId: string,
  phase: 'item' | 'decision' | 'final',
  assetId?: string
): string {
  const chars = createHash('sha256')
    .update(
      JSON.stringify([
        'openg7.media.approve-all.v1',
        requestId.toLowerCase(),
        phase,
        assetId?.toLowerCase() ?? null
      ])
    )
    .digest('hex')
    .slice(0, 32)
    .split('');
  chars[12] = '8';
  chars[16] = ((parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function classifyApproveAllReasons(
  reasons: readonly string[]
): SponsorMediaApproveAllClassification {
  if (!reasons.length) return 'eligible';
  if (reasons.every((reason) => reason === 'MEDIA_ALREADY_APPROVED'))
    return 'already_approved';
  return reasons.some((reason) =>
    [
      'MEDIA_CONTENT_UNAVAILABLE',
      'MEDIA_INVALID',
      'MEDIA_NOT_FOUND',
      'MEDIA_KIND_UNSUPPORTED',
      'MEDIA_PLAN_STALE',
      'MEDIA_VERSION_CONFLICT',
      'MODERATION_CONTENT_CHANGED',
      'MODERATION_DECISION_CONFLICT'
    ].includes(reason)
  )
    ? 'not_processable'
    : 'blocked';
}

function resultFor(
  member: ApproveAllMember,
  result: SponsorMediaApproveAllItemResult['result'],
  reasons: readonly string[] = member.candidate.reasons,
  version = member.candidate.asset.version
): SponsorMediaApproveAllItemResult {
  return {
    id: member.candidate.asset.id,
    originalFilename: member.candidate.asset.originalFilename,
    version,
    result,
    reasons
  };
}

function receiptFrom(
  stored: StoredApproveAllPlan,
  start: StartedApproval,
  results: ReadonlyMap<string, SponsorMediaApproveAllItemResult>,
  terminal: boolean
): SponsorMediaApproveAllReceipt {
  const items = stored.members.map(
    (member) =>
      results.get(member.candidate.asset.id) ??
      resultFor(
        member,
        member.candidate.classification === 'eligible'
          ? 'pending'
          : member.candidate.classification
      )
  );
  const count = (result: SponsorMediaApproveAllItemResult['result']) =>
    items.filter((item) => item.result === result).length;
  const summary = {
    total: items.length,
    approved: count('approved'),
    alreadyApproved: count('already_approved'),
    blocked: count('blocked'),
    notProcessable: count('not_processable'),
    failed: count('failed'),
    pending: count('pending')
  };
  return {
    kind: 'approve_all',
    requestId: start.request.requestId,
    planId: start.planId,
    contributionId: start.contributionId,
    status:
      !terminal || summary.pending
        ? 'in_progress'
        : summary.blocked + summary.notProcessable + summary.failed > 0
          ? 'partial'
          : 'completed',
    items,
    summary
  };
}

const localBusinessError = (
  error: unknown
): error is MediaWorkspaceError | ModerationError =>
  (error instanceof MediaWorkspaceError || error instanceof ModerationError) &&
  error.status < 500;

/** Whole-dossier coordination over the same native approval policies and mutations. */
export class SponsorMediaApproveAllService {
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<SponsorMediaStorage, 'readPrivateObject'>,
    private readonly options: SponsorMediaApproveAllOptions = {}
  ) {}

  private async stored(
    db: Pick<Pool, 'query'>,
    planId: string,
    actor: string
  ): Promise<StoredApproveAllPlan> {
    const row = (
      await db.query<{
        actor: string;
        plan: StoredApproveAllPlan;
        expires_at: Date | string;
      }>(
        'SELECT actor,plan,expires_at FROM sponsor_media_batch_plans WHERE id=$1',
        [planId]
      )
    ).rows[0];
    ensure(row, 'MEDIA_PLAN_NOT_FOUND', 404);
    ensure(row.actor === actor, 'MEDIA_PLAN_ACTOR_MISMATCH', 403);
    ensure(
      row.plan.kind === 'approve_all' &&
        row.plan.response?.kind === 'approve_all',
      'MEDIA_PLAN_KIND_MISMATCH'
    );
    return {
      ...row.plan,
      columnExpiresAt: new Date(row.expires_at).toISOString()
    };
  }

  async plan(
    input: SponsorMediaApproveAllPlanRequest,
    actor: string
  ): Promise<SponsorMediaApproveAllPlan> {
    validateApproveAllPlanRequest(input);
    input = {
      ...input,
      requestId: input.requestId.toLowerCase(),
      contributionId: input.contributionId.toLowerCase()
    };
    const hash = fingerprint({ kind: 'approve_all', input });
    const prior = (
      await this.pool.query<{
        actor: string;
        payload_fingerprint: string;
        plan: StoredApproveAllPlan;
      }>(
        'SELECT actor,payload_fingerprint,plan FROM sponsor_media_batch_plans WHERE contribution_id=$1 AND request_id=$2',
        [input.contributionId, input.requestId]
      )
    ).rows[0];
    if (prior) {
      ensure(prior.plan.kind === 'approve_all', 'MEDIA_PLAN_KIND_MISMATCH');
      ensure(
        prior.actor === actor && prior.payload_fingerprint === hash,
        'IDEMPOTENCY_CONFLICT'
      );
      return prior.plan.response;
    }
    const snapshot = await withPostgresTransaction(
      this.pool,
      (db) => readWorkspace(db, input.contributionId),
      { readOnlySnapshot: true }
    );
    const attestations = await attestMediaSources(
      this.pool,
      this.storage,
      input.contributionId,
      snapshot.assets
        .filter((asset) => asset.reviewStatus !== 'approved')
        .map((asset) => asset.id)
    );
    return withPostgresTransaction(this.pool, async (db) => {
      const revision = await lockWorkspace(db, input.contributionId);
      const existing = (
        await db.query<{
          actor: string;
          payload_fingerprint: string;
          plan: StoredApproveAllPlan;
        }>(
          'SELECT actor,payload_fingerprint,plan FROM sponsor_media_batch_plans WHERE contribution_id=$1 AND request_id=$2',
          [input.contributionId, input.requestId]
        )
      ).rows[0];
      if (existing) {
        ensure(
          existing.plan.kind === 'approve_all',
          'MEDIA_PLAN_KIND_MISMATCH'
        );
        ensure(
          existing.actor === actor && existing.payload_fingerprint === hash,
          'IDEMPOTENCY_CONFLICT'
        );
        return existing.plan.response;
      }
      ensure(revision === input.expectedRevision, 'WORKSPACE_VERSION_CONFLICT');
      const workspace = await readWorkspace(db, input.contributionId);
      const id = randomUUID(),
        expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const members: ApproveAllMember[] = [];
      for (const asset of workspace.assets) {
        if (asset.reviewStatus === 'approved') {
          members.push({
            candidate: {
              asset,
              classification: 'already_approved',
              reasons: []
            }
          });
          continue;
        }
        // Approval must not reactivate a previously selected image on a visible profile.
        if (asset.websiteSelected) {
          members.push({
            candidate: {
              asset,
              classification: 'blocked',
              reasons: ['MEDIA_WEBSITE_SELECTION_REVIEW_REQUIRED']
            }
          });
          continue;
        }
        const request: SponsorMediaBatchPlanRequest = {
          requestId: input.requestId,
          contributionId: input.contributionId,
          expectedRevision: revision,
          action: 'approve',
          assets: [
            {
              id: asset.id,
              version: asset.version,
              ...(asset.usage?.restrictions && !asset.usageRestrictionsReviewed
                ? { usageRestrictionsConfirmed: true as const }
                : {})
            }
          ]
        };
        const native = await preparePlanManifest(
          db,
          request,
          workspace,
          attestations
        );
        const reasons = native.blocked[0]?.reasons ?? [];
        const candidate: SponsorMediaApproveAllCandidate = {
          asset,
          classification: classifyApproveAllReasons(reasons),
          reasons
        };
        members.push({
          candidate,
          native: {
            request,
            manifest: native.manifest,
            response: {
              id,
              contributionId: input.contributionId,
              action: 'approve',
              revision,
              expiresAt,
              assets: native.assets,
              blocked: native.blocked,
              effects: []
            }
          }
        });
      }
      const candidates = members.map((member) => member.candidate);
      const pendingConsent = await readSponsorshipMediaConsentAssets(db, {
        record: { contributionId: input.contributionId },
        media: workspace.assets
      });
      const count = (classification: SponsorMediaApproveAllClassification) =>
        candidates.filter(
          (candidate) => candidate.classification === classification
        ).length;
      const response: SponsorMediaApproveAllPlan = {
        kind: 'approve_all',
        id,
        contributionId: input.contributionId,
        revision,
        expiresAt,
        candidates,
        summary: {
          total: candidates.length,
          eligible: count('eligible'),
          blocked: count('blocked'),
          alreadyApproved: count('already_approved'),
          notProcessable: count('not_processable'),
          authorizationRequired: candidates.filter(
            ({ asset }) => !asset.usage || asset.usage.state !== 'confirmed'
          ).length,
          consentRequestable: pendingConsent.length
        },
        effects: [
          'ACCEPT_MEDIA_ONLY',
          'NO_SOCIAL_PUBLICATION',
          'WEBSITE_SELECTION_UNCHANGED'
        ]
      };
      const stored: StoredApproveAllPlan = {
        kind: 'approve_all',
        request: input,
        response,
        members
      };
      await db.query(
        `INSERT INTO sponsor_media_batch_plans(id,contribution_id,request_id,payload_fingerprint,actor,workspace_revision,plan,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [
          id,
          input.contributionId,
          input.requestId,
          hash,
          actor,
          Number(revision),
          JSON.stringify(stored),
          expiresAt
        ]
      );
      return response;
    });
  }

  private async state(
    db: PoolClient,
    input: SponsorMediaApproveAllReceiptRequest,
    actor: string
  ): Promise<ReceiptState | null> {
    const row = (
      await db.query<{ actor: string; result: StartedApproval }>(
        'SELECT actor,result FROM sponsor_media_workspace_commands WHERE contribution_id=$1 AND request_id=$2',
        [input.contributionId, input.requestId]
      )
    ).rows[0];
    if (!row) return null;
    ensure(row.actor === actor, 'MEDIA_RECEIPT_ACTOR_MISMATCH', 403);
    const start = row.result;
    ensure(
      start.kind === 'approve_all' && start.stage === 'start',
      'MEDIA_RECEIPT_KIND_MISMATCH'
    );
    const stored = await this.stored(db, start.planId, actor);
    ensure(
      stored.response.contributionId === input.contributionId &&
        start.request.requestId === input.requestId,
      'MEDIA_RECEIPT_KIND_MISMATCH'
    );
    const ids = [
      approveAllDerivedRequestId(input.requestId, 'final'),
      ...stored.members.map((member) =>
        approveAllDerivedRequestId(
          input.requestId,
          'item',
          member.candidate.asset.id
        )
      )
    ];
    const outcomes = await db.query<{
      request_id: string;
      actor: string;
      result: ItemReceipt | SponsorMediaApproveAllReceipt;
    }>(
      'SELECT request_id,actor,result FROM sponsor_media_workspace_commands WHERE contribution_id=$1 AND request_id=ANY($2::uuid[])',
      [input.contributionId, ids]
    );
    const results = new Map<string, SponsorMediaApproveAllItemResult>();
    let final: SponsorMediaApproveAllReceipt | null = null;
    for (const outcome of outcomes.rows) {
      ensure(outcome.actor === actor, 'MEDIA_RECEIPT_ACTOR_MISMATCH', 403);
      ensure(
        outcome.result.kind === 'approve_all' &&
          outcome.result.planId === start.planId &&
          outcome.result.requestId === input.requestId,
        'MEDIA_RECEIPT_KIND_MISMATCH'
      );
      if (outcome.request_id === ids[0])
        final = outcome.result as SponsorMediaApproveAllReceipt;
      else {
        const item = outcome.result as ItemReceipt;
        ensure(
          item.stage === 'item' &&
            approveAllDerivedRequestId(
              input.requestId,
              'item',
              item.item.id
            ) === outcome.request_id,
          'MEDIA_RECEIPT_KIND_MISMATCH'
        );
        results.set(item.item.id, item.item);
      }
    }
    return {
      stored,
      start,
      result: final ?? receiptFrom(stored, start, results, false),
      finalized: !!final
    };
  }

  async receipt(
    input: SponsorMediaApproveAllReceiptRequest,
    actor: string
  ): Promise<SponsorMediaApproveAllReceiptResponse> {
    ensure(
      ownKeys(input, ['contributionId', 'requestId']) &&
        validId(input.contributionId) &&
        validId(input.requestId),
      'INVALID_MEDIA_RECEIPT',
      400
    );
    input = {
      contributionId: input.contributionId.toLowerCase(),
      requestId: input.requestId.toLowerCase()
    };
    return withPostgresTransaction(
      this.pool,
      async (db) => {
        const state = await this.state(db, input, actor);
        return state
          ? { found: true as const, result: state.result }
          : { found: false as const };
      },
      { readOnlySnapshot: true }
    );
  }

  private async start(
    input: SponsorMediaApproveAllExecuteRequest,
    actor: string
  ): Promise<{ stored: StoredApproveAllPlan; start: StartedApproval }> {
    return withPostgresTransaction(this.pool, async (db) => {
      const stored = await this.stored(db, input.planId, actor);
      await lockWorkspace(db, stored.response.contributionId);
      const hash = fingerprint({ kind: 'approve_all', input });
      const previous = (await replay(
        db,
        stored.response.contributionId,
        input.requestId,
        hash,
        actor
      )) as StartedApproval | undefined;
      if (previous) {
        ensure(
          previous.kind === 'approve_all' &&
            previous.stage === 'start' &&
            previous.planId === input.planId,
          'MEDIA_RECEIPT_KIND_MISMATCH'
        );
        return { stored, start: previous };
      }
      ensure(stored.response.summary.eligible > 0, 'MEDIA_NO_ELIGIBLE_ASSETS');
      ensure(
        Date.parse(stored.columnExpiresAt ?? stored.response.expiresAt) >
          Date.now(),
        'MEDIA_PLAN_EXPIRED'
      );
      const start: StartedApproval = {
        kind: 'approve_all',
        stage: 'start',
        status: 'in_progress',
        request: input,
        planId: input.planId,
        contributionId: stored.response.contributionId
      };
      await record(
        db,
        start.contributionId,
        input.requestId,
        hash,
        actor,
        'approve_all.started',
        start
      );
      return { stored, start };
    });
  }

  private async processItem(
    start: StartedApproval,
    member: ApproveAllMember,
    actor: string,
    attestations: ReadonlyMap<string, MediaSourceAttestation>
  ): Promise<{ item: SponsorMediaApproveAllItemResult; created: boolean }> {
    const itemId = approveAllDerivedRequestId(
      start.request.requestId,
      'item',
      member.candidate.asset.id
    );
    const hash = fingerprint({
      kind: 'approve_all',
      stage: 'item',
      requestId: start.request.requestId,
      planId: start.planId,
      assetId: member.candidate.asset.id
    });
    return withPostgresTransaction(this.pool, async (db) => {
      await lockWorkspace(db, start.contributionId);
      const previous = (await replay(
        db,
        start.contributionId,
        itemId,
        hash,
        actor
      )) as ItemReceipt | undefined;
      if (previous) {
        ensure(
          previous.kind === 'approve_all' &&
            previous.stage === 'item' &&
            previous.planId === start.planId,
          'MEDIA_RECEIPT_KIND_MISMATCH'
        );
        return { item: previous.item, created: false };
      }
      const workspace = await readWorkspace(db, start.contributionId);
      const current = workspace.assets.find(
        (asset) => asset.id === member.candidate.asset.id
      );
      const original = member.candidate.asset;
      const manifest = member.native!.manifest[0]!;
      let item: SponsorMediaApproveAllItemResult;
      if (!current)
        item = resultFor(member, 'not_processable', ['MEDIA_NOT_FOUND']);
      else if (current.reviewStatus === 'approved')
        item = resultFor(member, 'already_approved', [], current.version);
      else if (current.websiteSelected)
        item = resultFor(
          member,
          'blocked',
          ['MEDIA_WEBSITE_SELECTION_REVIEW_REQUIRED'],
          current.version
        );
      else if (
        current.readiness.state === 'blocked' &&
        current.readiness.reasons.length
      )
        item = resultFor(
          member,
          classifyApproveAllReasons(
            current.readiness.reasons
          ) as SponsorMediaApproveAllItemResult['result'],
          current.readiness.reasons,
          current.version
        );
      else if (
        current.version !== original.version ||
        current.moderation.fingerprint !== manifest.fingerprint ||
        current.moderation.currentDecisionId !== manifest.currentDecisionId ||
        fingerprint(current.usage ?? null) !==
          fingerprint(original.usage ?? null) ||
        fingerprint(current.usageAcceptance ?? null) !==
          fingerprint(original.usageAcceptance ?? null)
      )
        item = resultFor(
          member,
          'not_processable',
          ['MEDIA_PLAN_STALE'],
          current.version
        );
      else if (
        !attestations.get(current.id)?.valid ||
        attestations.get(current.id)?.version !== current.version ||
        attestations.get(current.id)?.checksum !== manifest.sourceChecksum
      )
        item = resultFor(
          member,
          'not_processable',
          ['MEDIA_CONTENT_UNAVAILABLE'],
          current.version
        );
      else {
        await db.query('SAVEPOINT media_approve_all_item');
        try {
          const native = await preparePlanManifest(
            db,
            member.native!.request,
            workspace,
            attestations
          );
          const reasons = native.blocked[0]?.reasons ?? [];
          if (reasons.length)
            item = resultFor(
              member,
              classifyApproveAllReasons(
                reasons
              ) as SponsorMediaApproveAllItemResult['result'],
              reasons,
              current.version
            );
          else {
            ensure(
              native.manifest[0]?.candidateFingerprint ===
                manifest.candidateFingerprint,
              'MEDIA_PLAN_STALE'
            );
            const plan: StoredPlan = {
              ...member.native!,
              manifest: native.manifest.map((entry) => ({
                ...entry,
                decisionRequestId: approveAllDerivedRequestId(
                  start.request.requestId,
                  'decision',
                  entry.id
                )
              })),
              response: {
                ...member.native!.response,
                revision: workspace.revision,
                assets: native.assets,
                blocked: []
              }
            };
            await db.query(
              "SELECT set_config('openg7.media_actor',$1,true),set_config('openg7.media_request_id',$2,true)",
              [actor, itemId]
            );
            const applied = await applyPlanMutations(
              db,
              plan,
              {
                requestId: itemId,
                planId: start.planId,
                confirmation: start.planId,
                humanReviewed: true
              },
              actor,
              workspace,
              { preserveWebsiteSelection: true }
            );
            item = resultFor(member, 'approved', [], applied[0]!.version);
          }
          await db.query('RELEASE SAVEPOINT media_approve_all_item');
        } catch (error) {
          if (!localBusinessError(error)) throw error;
          await db.query('ROLLBACK TO SAVEPOINT media_approve_all_item');
          await db.query('RELEASE SAVEPOINT media_approve_all_item');
          item = resultFor(
            member,
            classifyApproveAllReasons([
              error.code
            ]) as SponsorMediaApproveAllItemResult['result'],
            [error.code],
            current.version
          );
        }
      }
      const result: ItemReceipt = {
        kind: 'approve_all',
        stage: 'item',
        requestId: start.request.requestId,
        planId: start.planId,
        item
      };
      await record(
        db,
        start.contributionId,
        itemId,
        hash,
        actor,
        'approve_all.item',
        { ...result, assetId: item.id, items: [item], status: 'completed' }
      );
      return { item, created: true };
    });
  }

  private async finish(
    start: StartedApproval,
    actor: string
  ): Promise<SponsorMediaApproveAllReceipt> {
    return withPostgresTransaction(this.pool, async (db) => {
      await lockWorkspace(db, start.contributionId);
      const state = await this.state(
        db,
        {
          contributionId: start.contributionId,
          requestId: start.request.requestId
        },
        actor
      );
      ensure(state, 'MEDIA_RECEIPT_NOT_FOUND', 404);
      if (state.finalized) return state.result;
      ensure(state.result.summary.pending === 0, 'MEDIA_APPROVAL_INCOMPLETE');
      const results = new Map(
        state.result.items.map((item) => [item.id, item])
      );
      const result = receiptFrom(state.stored, start, results, true);
      const finalId = approveAllDerivedRequestId(
        start.request.requestId,
        'final'
      );
      await record(
        db,
        start.contributionId,
        finalId,
        fingerprint({
          kind: 'approve_all',
          stage: 'final',
          request: start.request
        }),
        actor,
        'approve_all.completed',
        result
      );
      return result;
    });
  }

  async execute(
    input: SponsorMediaApproveAllExecuteRequest,
    actor: string
  ): Promise<SponsorMediaApproveAllReceipt> {
    validateApproveAllExecuteRequest(input);
    input = {
      ...input,
      requestId: input.requestId.toLowerCase(),
      planId: input.planId.toLowerCase(),
      confirmation: input.confirmation.toLowerCase()
    };
    const { stored, start } = await this.start(input, actor);
    const state = await withPostgresTransaction(
      this.pool,
      (db) =>
        this.state(
          db,
          { contributionId: start.contributionId, requestId: input.requestId },
          actor
        ),
      { readOnlySnapshot: true }
    );
    ensure(state, 'MEDIA_RECEIPT_NOT_FOUND', 404);
    if (state.finalized) return state.result;
    const results = new Map(
      state.result.items
        .filter((item) => item.result !== 'pending')
        .map((item) => [item.id, item])
    );
    try {
      let committed = 0;
      const pending = stored.members.filter(
        (member) =>
          member.candidate.classification === 'eligible' &&
          !results.has(member.candidate.asset.id)
      );
      for (let offset = 0; offset < pending.length; offset += 4) {
        const batch = pending.slice(offset, offset + 4);
        const attestations = await attestMediaSources(
          this.pool,
          this.storage,
          start.contributionId,
          batch.map((member) => member.candidate.asset.id)
        );
        for (const member of batch) {
          const outcome = await this.processItem(
            start,
            member,
            actor,
            attestations
          );
          results.set(outcome.item.id, outcome.item);
          if (outcome.created)
            await this.options.afterItemCommitted?.(outcome.item, committed++);
        }
      }
      return await this.finish(start, actor);
    } catch {
      // No failed item is invented after an uncertain commit or unavailable audit.
      // Earlier per-item receipts remain durable; only an explicit POST resumes.
      try {
        const current = await this.receipt(
          { contributionId: start.contributionId, requestId: input.requestId },
          actor
        );
        if (current.found) return current.result;
      } catch {
        /* Return only confirmed outcomes when the read itself is unavailable. */
      }
      return receiptFrom(stored, start, results, false);
    }
  }
}
