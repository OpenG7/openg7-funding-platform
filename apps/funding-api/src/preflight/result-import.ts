import { createHash } from 'node:crypto';

import {
  integer,
  isRecord,
  record,
  text,
  uuid,
  PreflightContractError,
  type RemoteMissionDetail
} from './contracts.js';

export interface ImportedPreflightPreparation {
  status: 'proposed';
  missionId: string;
  proposalId: string;
  draftResultId: string;
  tenantId: string;
  commitmentId: string;
  sourceVersion: number;
  sourceHash: string;
  title: string;
  summary: string;
  body: string;
  warnings: string[];
  provenance: Record<string, unknown>;
  checks: unknown[];
  anomalies: unknown[];
  blockingConditions: string[];
  businessDecisionExecuted: false;
}
export interface ExpectedPreflightSource {
  tenantId: string;
  subjectId: string;
  sourceVersion: number;
  sourceHash: string;
}
const bad = (code: string): never => {
  throw new PreflightContractError(code);
};
function strings(
  value: unknown,
  maxCount: number,
  maxLength: number
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maxCount ||
    value.some((item) => typeof item !== 'string' || item.length > maxLength)
  )
    return bad('preflight_result_invalid');
  return value as string[];
}

/** Produces a private proposal only. This module exposes no approval, visibility or publication port. */
export function parseValidatedPreparation(
  detail: RemoteMissionDetail,
  expected: ExpectedPreflightSource
): ImportedPreflightPreparation | null {
  const mission = detail.mission;
  if (
    mission.tenantId !== expected.tenantId ||
    mission.source.application !== 'funding-platform' ||
    mission.source.subjectType !== 'sponsorship-commitment' ||
    mission.source.subjectId !== expected.subjectId ||
    mission.source.version !== expected.sourceVersion ||
    mission.input.sourceSnapshotDigest !== expected.sourceHash
  )
    return bad('preflight_source_obsolete');
  if (!/^[a-f0-9]{64}$/.test(expected.sourceHash))
    return bad('preflight_source_invalid');
  if (mission.status !== 'review_ready') return null;
  const proposals = detail.proposals.filter(
    (item) => item.status === 'prepared'
  );
  if (proposals.length !== 1) return bad('preflight_proposal_invalid');
  const proposal = proposals[0]!;
  if (
    proposal.missionId !== mission.id ||
    proposal.source.version !== expected.sourceVersion ||
    proposal.tenantId !== expected.tenantId ||
    proposal.source.subjectId !== expected.subjectId ||
    proposal.authority !== 'source_application' ||
    proposal.businessDecisionExecuted !== false ||
    proposal.sourceVersion !== expected.sourceVersion
  )
    return bad('preflight_proposal_authority_invalid');
  const draftId = uuid(proposal.draftResultId);
  const result = detail.results.find(
    (item) => item.id === draftId && item.kind === 'draft' && !item.obsolete
  );
  if (!result) return bad('preflight_draft_missing');
  const output = record(result.output);
  if (
    Object.keys(output).some(
      (key) => !['title', 'summary', 'body', 'warnings'].includes(key)
    )
  )
    return bad('preflight_result_invalid');
  const provenance = record(result.provenance);
  text(provenance.provider);
  text(provenance.model, 200);
  if (
    typeof provenance.simulated !== 'boolean' ||
    provenance.inputVersion !== expected.sourceVersion ||
    typeof provenance.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(provenance.generatedAt)) ||
    typeof provenance.inputHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(provenance.inputHash) ||
    typeof provenance.estimatedCostUsd !== 'number' ||
    !Number.isFinite(provenance.estimatedCostUsd) ||
    provenance.estimatedCostUsd < 0
  )
    return bad('preflight_provenance_invalid');
  const inputHash = createHash('sha256')
    .update(JSON.stringify(mission.input))
    .digest('hex');
  if (provenance.inputHash !== inputHash)
    return bad('preflight_input_hash_mismatch');
  const safeProvenance: Record<string, unknown> = {
    provider: provenance.provider,
    model: provenance.model,
    simulated: provenance.simulated,
    generatedAt: provenance.generatedAt,
    inputHash: provenance.inputHash,
    inputVersion: provenance.inputVersion,
    estimatedCostUsd: provenance.estimatedCostUsd
  };
  if (provenance.usage !== undefined) {
    const usage = record(provenance.usage);
    safeProvenance.usage = {
      inputTokens: integer(usage.inputTokens, 0),
      outputTokens: integer(usage.outputTokens, 0)
    };
  }
  if (provenance.reservedCostUsd !== undefined) {
    if (
      typeof provenance.reservedCostUsd !== 'number' ||
      !Number.isFinite(provenance.reservedCostUsd) ||
      provenance.reservedCostUsd < 0
    )
      return bad('preflight_provenance_invalid');
    safeProvenance.reservedCostUsd = provenance.reservedCostUsd;
  }
  const checks = proposal.checks;
  const safeChecks: Array<{ kind: string; resultId: string; passed: true }> =
    [];
  if (
    !Array.isArray(checks) ||
    checks.length !== 3 ||
    !Array.isArray(proposal.resultIds)
  )
    return bad('preflight_checks_invalid');
  for (const kind of ['completeness', 'preparation-policy', 'output-check']) {
    const check = checks.find((item) => isRecord(item) && item.kind === kind);
    if (
      !isRecord(check) ||
      check.passed !== true ||
      typeof check.resultId !== 'string' ||
      !proposal.resultIds.includes(check.resultId)
    )
      return bad('preflight_checks_invalid');
    const persisted = detail.results.find(
      (item) =>
        item.id === check.resultId && item.kind === kind && !item.obsolete
    );
    if (!persisted) return bad('preflight_checks_invalid');
    if (
      kind === 'output-check' &&
      (persisted.output.passed !== true ||
        persisted.output.sourceVersion !== expected.sourceVersion)
    )
      return bad('preflight_checks_invalid');
    if (
      kind === 'preparation-policy' &&
      (persisted.output.businessDecisionAllowed !== false ||
        persisted.output.externalPublicationAllowed !== false ||
        persisted.output.humanReviewRequired !== true)
    )
      return bad('preflight_policy_invalid');
    safeChecks.push({ kind, resultId: uuid(check.resultId), passed: true });
  }
  if (!Array.isArray(proposal.anomalies) || proposal.anomalies.length > 100)
    return bad('preflight_proposal_invalid');
  return {
    status: 'proposed',
    missionId: uuid(mission.id),
    proposalId: uuid(proposal.id),
    draftResultId: draftId,
    tenantId: expected.tenantId,
    commitmentId: uuid(expected.subjectId),
    sourceVersion: integer(expected.sourceVersion),
    sourceHash: expected.sourceHash,
    title: text(output.title, 200),
    summary: text(output.summary, 4000),
    body: text(output.body, 20000),
    warnings: strings(output.warnings, 50, 1000),
    provenance: safeProvenance,
    checks: safeChecks,
    anomalies: strings(proposal.anomalies, 100, 1000),
    blockingConditions: strings(proposal.blockingConditions, 50, 1000),
    businessDecisionExecuted: false
  };
}
