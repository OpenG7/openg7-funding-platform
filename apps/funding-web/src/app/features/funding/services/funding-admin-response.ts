interface AdminErrorDetails {
  readonly message?: string;
  readonly code?: string;
}

/** Decode an error body once; callers retain their message and code policies. */
export async function errorDetailsFromResponse(
  response: Response
): Promise<AdminErrorDetails> {
  try {
    const payload = (await response.json()) as {
      readonly message?: unknown;
      readonly error?: unknown;
      readonly code?: unknown;
    };
    return {
      message:
        typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : undefined,
      code: typeof payload.code === 'string' ? payload.code : undefined
    };
  } catch {
    return {};
  }
}

/** Decode endpoint messages while preserving each caller's fallback. */
export async function errorMessageFromResponse(
  response: Response,
  fallback: string
): Promise<string> {
  return (await errorDetailsFromResponse(response)).message ?? fallback;
}
