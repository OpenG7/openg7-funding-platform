/** Decode endpoint messages while preserving each caller's fallback. */
export async function errorMessageFromResponse(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      readonly message?: unknown;
      readonly error?: unknown;
    };
    return typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : fallback;
  } catch {
    return fallback;
  }
}
