import type { PoolClient } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';

import { requireAssistance } from './errors.js';

export type AssistanceAction = 'source' | 'run' | 'review' | 'apply';
export type AssistanceCommand = Record<string, unknown> & {
  contributionId: string;
  requestId: string;
};

export function parseAssistanceCommand(
  raw: unknown,
  fields: readonly string[]
): AssistanceCommand {
  requireAssistance(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'ASSISTANCE_INVALID_REQUEST',
    400
  );
  const input = raw as AssistanceCommand;
  const allowed = ['contributionId', 'requestId', ...fields];
  requireAssistance(
    Object.keys(input).length === allowed.length &&
      Object.keys(input).every((key) => allowed.includes(key)) &&
      isValidUuid(input.contributionId) &&
      isValidUuid(input.requestId),
    'ASSISTANCE_INVALID_REQUEST',
    400
  );
  // PostgreSQL UUIDs are case-insensitive. Bind locks, hashes and replays to the
  // same canonical identity without changing private text or the caller's object.
  const canonical: AssistanceCommand = { ...input };
  for (const field of [
    'contributionId',
    'requestId',
    'runId',
    'confirmation'
  ]) {
    const value = canonical[field];
    if (isValidUuid(value)) canonical[field] = value.toLowerCase();
  }
  return canonical;
}

export const isAssistanceVersion = (
  value: unknown,
  minimum = 1
): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;

/** Stable key order binds a request to its actual JSON data, never its serialization. */
export function canonicalAssistanceInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAssistanceInput);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalAssistanceInput(item)])
    );
  return value;
}

export async function recordedAssistanceRequest(
  db: PoolClient,
  input: AssistanceCommand,
  action: AssistanceAction,
  actor: string,
  hash: string
): Promise<boolean> {
  const prior = (
    await db.query<{
      contribution_id: string;
      action: string;
      actor: string;
      request_hash: string;
    }>(
      'SELECT * FROM preparation_assistance_requests WHERE request_id=$1::uuid',
      [input.requestId]
    )
  ).rows[0];
  if (!prior) return false;
  requireAssistance(
    prior.contribution_id === input.contributionId &&
      prior.action === action &&
      prior.actor === actor &&
      prior.request_hash === hash,
    'ASSISTANCE_REQUEST_CONFLICT'
  );
  return true;
}
