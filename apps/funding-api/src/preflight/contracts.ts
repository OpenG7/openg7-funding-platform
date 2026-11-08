/** Preflight HTTP wire contract v1. No dependency on another application's source tree. */
export interface PreflightSource {
  application: 'funding-platform';
  subjectType: 'sponsorship-commitment';
  subjectId: string;
  version: number;
}
export interface PreflightMission {
  schemaVersion: '1.0';
  missionId?: string;
  eventId?: string;
  tenantId: string;
  source: PreflightSource;
  workflow: { type: 'sponsorship-preparation-v1'; version: '1.0' };
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  constraints: {
    humanApprovalRequired: true;
    maxCostUsd: number;
    timeoutMs?: number;
    maxAttempts?: number;
  };
  input: Record<string, unknown>;
}
export interface PreflightSourceUpdate {
  schemaVersion: '1.0';
  type: 'source.updated';
  eventId: string;
  tenantId: string;
  source: PreflightSource;
}
export const remoteMissionStates = [
  'received',
  'planning',
  'ready',
  'running',
  'waiting_input',
  'waiting_dependency',
  'review_ready',
  'completed',
  'failed',
  'cancelled',
  'superseded'
] as const;
export type RemoteMissionState = (typeof remoteMissionStates)[number];
export interface RemoteMission {
  id: string;
  tenantId: string;
  source: PreflightSource;
  workflow: { type: string; version: string };
  status: RemoteMissionState;
  input: Record<string, unknown>;
  revision: number;
}
export interface RemoteResult {
  id: string;
  taskId: string;
  kind: string;
  output: Record<string, unknown>;
  provenance: Record<string, unknown>;
  version: number;
  obsolete: boolean;
}
export interface RemoteProposal extends Record<string, unknown> {
  id: string;
  missionId: string;
  tenantId: string;
  source: PreflightSource;
  status: 'prepared' | 'obsolete';
  version: number;
  type: string;
  risk: string;
}
export interface RemoteMissionDetail {
  mission: RemoteMission;
  results: RemoteResult[];
  proposals: RemoteProposal[];
}
export interface RemoteProposalPage {
  items: RemoteProposal[];
  total: number;
  page: number;
  pageSize: number;
}
/** Inbox inspection accepts public Preflight source references without assuming a Funding dossier. */
export interface RemoteInboxProposal extends Record<string, unknown> {
  id: string;
  missionId: string;
  tenantId: string;
  source: {
    application: 'funding-platform';
    subjectType: string;
    subjectId: string;
    version: number;
  };
  status: 'prepared';
  version: number;
  type: string;
  risk: string;
}
export interface RemoteInboxProposalPage {
  items: RemoteInboxProposal[];
  total: number;
  page: number;
  pageSize: number;
}
export class PreflightContractError extends Error {
  constructor(readonly code = 'preflight_response_invalid') {
    super(code);
    this.name = 'PreflightContractError';
  }
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new PreflightContractError();
  return value;
}
export function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new PreflightContractError();
  return value;
}
export function integer(value: unknown, min = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < min)
    throw new PreflightContractError();
  return value as number;
}
export function uuid(value: unknown): string {
  const result = text(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result
    )
  )
    throw new PreflightContractError();
  return result;
}
export function parseSource(raw: unknown): PreflightSource {
  const value = record(raw);
  if (
    value.application !== 'funding-platform' ||
    value.subjectType !== 'sponsorship-commitment'
  )
    throw new PreflightContractError('preflight_source_mismatch');
  return {
    application: 'funding-platform',
    subjectType: 'sponsorship-commitment',
    subjectId: uuid(value.subjectId),
    version: integer(value.version)
  };
}
export function parseRemoteMission(
  raw: unknown,
  tenantId: string
): RemoteMission {
  const value = record(raw);
  const workflow = record(value.workflow);
  if (value.tenantId !== tenantId)
    throw new PreflightContractError('preflight_tenant_mismatch');
  if (!(remoteMissionStates as readonly unknown[]).includes(value.status))
    throw new PreflightContractError('preflight_unknown_state');
  if (
    workflow.type !== 'sponsorship-preparation-v1' ||
    workflow.version !== '1.0'
  )
    throw new PreflightContractError('preflight_workflow_mismatch');
  return {
    id: uuid(value.id),
    tenantId,
    source: parseSource(value.source),
    workflow: { type: workflow.type, version: workflow.version },
    status: value.status as RemoteMissionState,
    input: record(value.input),
    revision: integer(value.revision)
  };
}
export function parseRemoteProposal(
  raw: unknown,
  tenantId: string
): RemoteProposal {
  const value = record(raw);
  if (value.tenantId !== tenantId)
    throw new PreflightContractError('preflight_tenant_mismatch');
  if (!['prepared', 'obsolete'].includes(value.status as string))
    throw new PreflightContractError();
  return {
    ...value,
    id: uuid(value.id),
    missionId: uuid(value.missionId),
    tenantId,
    source: parseSource(value.source),
    status: value.status as 'prepared' | 'obsolete',
    version: integer(value.version),
    type: text(value.type),
    risk: text(value.risk)
  };
}
export function parseRemoteInboxProposal(
  raw: unknown,
  tenantId: string
): RemoteInboxProposal {
  const value = record(raw);
  const source = record(value.source);
  if (value.tenantId !== tenantId)
    throw new PreflightContractError('preflight_tenant_mismatch');
  if (source.application !== 'funding-platform')
    throw new PreflightContractError('preflight_source_mismatch');
  if (value.status !== 'prepared') throw new PreflightContractError();
  return {
    ...value,
    id: uuid(value.id),
    missionId: uuid(value.missionId),
    tenantId,
    source: {
      application: 'funding-platform',
      subjectType: text(source.subjectType),
      subjectId: text(source.subjectId),
      version: integer(source.version)
    },
    status: 'prepared',
    version: integer(value.version),
    type: text(value.type),
    risk: text(value.risk)
  };
}
export function parseRemoteMissionDetail(
  raw: unknown,
  tenantId: string
): RemoteMissionDetail {
  const value = record(raw);
  if (
    !Array.isArray(value.results) ||
    value.results.length > 100 ||
    !Array.isArray(value.proposals) ||
    value.proposals.length > 100
  )
    throw new PreflightContractError();
  const mission = parseRemoteMission(value.mission, tenantId);
  const results = value.results.map((rawResult) => {
    const result = record(rawResult);
    if (typeof result.obsolete !== 'boolean')
      throw new PreflightContractError();
    return {
      id: uuid(result.id),
      taskId: uuid(result.taskId),
      kind: text(result.kind),
      output: record(result.output),
      provenance: record(result.provenance),
      version: integer(result.version),
      obsolete: result.obsolete
    };
  });
  const proposals = value.proposals.map((item) =>
    parseRemoteProposal(item, tenantId)
  );
  if (
    proposals.some(
      (proposal) =>
        proposal.missionId !== mission.id ||
        proposal.source.subjectId !== mission.source.subjectId ||
        proposal.source.version !== mission.source.version
    )
  )
    throw new PreflightContractError('preflight_proposal_mismatch');
  return { mission, results, proposals };
}
