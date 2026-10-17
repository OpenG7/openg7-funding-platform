import { randomUUID } from 'node:crypto';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';

type PreparationOperation =
  'carousel_read' | 'carousel_approve' | 'dossier_read' | 'dossier_approve';

export interface PreparationFailureDiagnostic {
  readonly event: 'admin_preparation_unavailable';
  readonly operation: PreparationOperation;
  readonly category: 'schema' | 'database_access' | 'unavailable';
  readonly code: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly sqlState?: '42P01' | '42703' | '42501';
}

/** Classify only known database failures; raw PostgreSQL diagnostics stay private. */
export function preparationHttpFailure(
  error: unknown,
  operation: PreparationOperation,
  reportFailure?: (diagnostic: PreparationFailureDiagnostic) => void
) {
  const safe = error instanceof AdminAutomaticRunError ? error : null;
  const databaseCode = (error as { code?: unknown } | null)?.code;
  const sqlState =
    databaseCode === '42P01' ||
    databaseCode === '42703' ||
    databaseCode === '42501'
      ? databaseCode
      : undefined;
  const code =
    safe?.code ??
    (sqlState === '42P01' || sqlState === '42703'
      ? 'PREPARATION_SCHEMA_INCOMPATIBLE'
      : sqlState === '42501'
        ? 'PREPARATION_DATABASE_ACCESS_DENIED'
        : 'RUN_UNAVAILABLE');
  const status = safe?.status ?? 503;
  const payload = { code, error: 'Private preparation is unavailable.' };
  if (status < 500) return { status, payload };

  const correlationId = randomUUID();
  const diagnostic: PreparationFailureDiagnostic = {
    event: 'admin_preparation_unavailable',
    operation,
    category:
      code === 'PREPARATION_SCHEMA_INCOMPATIBLE'
        ? 'schema'
        : code === 'PREPARATION_DATABASE_ACCESS_DENIED'
          ? 'database_access'
          : 'unavailable',
    code,
    correlationId,
    occurredAt: new Date().toISOString(),
    ...(sqlState ? { sqlState } : {})
  };
  try {
    reportFailure?.(diagnostic);
  } catch {
    // A diagnostic sink failure must not replace the safe HTTP response.
  }
  return { status, payload: { ...payload, correlationId } };
}
