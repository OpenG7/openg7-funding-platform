export class PreparationAssistanceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
    this.name = 'PreparationAssistanceError';
  }
}

export function requireAssistance(
  condition: unknown,
  code: string,
  status = 409
): asserts condition {
  if (!condition) throw new PreparationAssistanceError(code, status);
}
