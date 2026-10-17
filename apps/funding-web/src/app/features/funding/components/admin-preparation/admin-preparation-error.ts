export type AdminPreparationError =
  | 'forbidden'
  | 'schema_incompatible'
  | 'database_access_denied'
  | 'unavailable'
  | 'stale'
  | 'uncertain';

/** Only public API codes influence the message; database details stay private. */
export function preparationError(
  error: unknown,
  operation: 'read' | 'approve'
): AdminPreparationError {
  const failure = error as { status?: number; code?: string } | null;
  if (failure?.status === 401 || failure?.status === 403) return 'forbidden';
  if (failure?.status === 503) {
    if (failure.code === 'PREPARATION_SCHEMA_INCOMPATIBLE')
      return 'schema_incompatible';
    if (failure.code === 'PREPARATION_DATABASE_ACCESS_DENIED')
      return 'database_access_denied';
  }
  if (operation === 'read') return 'unavailable';
  return failure?.status === 409 ? 'stale' : 'uncertain';
}

export function isPreparationConfigurationError(
  error: AdminPreparationError | null
): boolean {
  return error === 'schema_incompatible' || error === 'database_access_denied';
}
