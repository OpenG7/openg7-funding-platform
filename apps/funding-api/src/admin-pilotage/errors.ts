export class PilotError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}

export function requireValue(
  value: unknown,
  code: string,
  status = 409
): asserts value {
  if (!value) throw new PilotError(code, status);
}
