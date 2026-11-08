import type { PreflightInboxProposal } from '@openg7/funding-core';

import { PreflightClient, PreflightClientError } from './client.js';
import {
  PreflightContractError,
  integer,
  record,
  text,
  uuid,
  type RemoteInboxProposal
} from './contracts.js';
import type { PreflightInboxConfig } from './inbox-config.js';

function strings(raw: unknown): string[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 100 ||
    raw.some((value) => typeof value !== 'string' || value.length > 2000)
  )
    throw new PreflightContractError();
  return [...raw] as string[];
}

/** Allowlist remote metadata; no draft, private input, tenant, credentials or dossier link escapes. */
export function projectInboxProposal(
  value: RemoteInboxProposal
): PreflightInboxProposal {
  if (
    value.authority !== 'source_application' ||
    value.businessDecisionExecuted !== false ||
    value.sourceVersion !== value.source.version ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new PreflightContractError();
  const provenance = record(value.provenance);
  if (
    typeof provenance.simulated !== 'boolean' ||
    !Array.isArray(value.checks) ||
    value.checks.length > 100
  )
    throw new PreflightContractError();
  return {
    id: value.id,
    missionId: value.missionId,
    source: { ...value.source },
    type: value.type,
    risk: value.risk,
    status: value.status,
    version: value.version,
    createdAt: new Date(value.createdAt).toISOString(),
    explanations: strings(value.explanations),
    limitations: strings(value.limitations),
    blockingConditions: strings(value.blockingConditions),
    anomalies: strings(value.anomalies),
    checks: value.checks.map((raw) => {
      const check = record(raw);
      if (typeof check.passed !== 'boolean') throw new PreflightContractError();
      return {
        resultId: uuid(check.resultId),
        kind: text(check.kind),
        passed: check.passed
      };
    }),
    provenance: {
      simulated: provenance.simulated,
      provider: text(provenance.provider),
      model: text(provenance.model, 200)
    },
    authority: 'source_application',
    businessDecisionExecuted: false
  };
}

/** Defence in depth: the inbox transport can read proposals and request its OAuth token only. */
export function createInboxFetch(
  config: PreflightInboxConfig,
  fetcher: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    if (!config.connection.enabled)
      throw new PreflightClientError('preflight_inbox_disabled');
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const target = new URL(url);
    const api = new URL(config.connection.baseUrl + '/api/proposals');
    const apiPrefix = new URL(config.connection.baseUrl + '/api/');
    const oauth =
      url === config.connection.tokenUrl &&
      method === 'POST' &&
      !(
        target.origin === apiPrefix.origin &&
        target.pathname.startsWith(apiPrefix.pathname)
      );
    const read =
      method === 'GET' &&
      target.origin === api.origin &&
      target.pathname === api.pathname &&
      !target.username &&
      !target.password &&
      !target.hash &&
      [...target.searchParams.keys()].every(
        (key) =>
          ['application', 'status', 'page', 'pageSize'].includes(key) &&
          target.searchParams.getAll(key).length === 1
      ) &&
      target.searchParams.get('application') === 'funding-platform' &&
      target.searchParams.get('status') === 'prepared';
    if (!oauth && !read)
      throw new PreflightClientError('preflight_inbox_write_forbidden');
    return fetcher(input, init);
  };
}

export function createPreflightInboxReader(
  config: PreflightInboxConfig,
  fetcher: typeof fetch = fetch
) {
  const client = config.connection.enabled
    ? new PreflightClient(config.connection, {
        fetch: createInboxFetch(config, fetcher)
      })
    : null;
  return async (page: number, pageSize: number) => {
    integer(page);
    integer(pageSize);
    if (!client) throw new PreflightClientError('preflight_inbox_disabled');
    const result = await client.listInboxProposals(page, pageSize);
    return { ...result, items: result.items.map(projectInboxProposal) };
  };
}
