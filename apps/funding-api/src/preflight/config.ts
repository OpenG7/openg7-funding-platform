/** Private backend configuration. Disabled means no network calls and no secrets required. */
export interface DisabledPreflightConfig {
  readonly enabled: false;
}
export interface EnabledPreflightConfig {
  readonly enabled: true;
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope?: string;
  readonly requestTimeoutMs: number;
  readonly maxCostUsd: number;
}
export type PreflightConfig = DisabledPreflightConfig | EnabledPreflightConfig;

export class PreflightConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PreflightConfigurationError';
  }
}

function flag(value: string | undefined, name: string): boolean {
  if (value == null || value === 'false') return false;
  if (value === 'true') return true;
  throw new PreflightConfigurationError(`${name}_invalid`);
}
function required(value: string | undefined, name: string, max = 4096): string {
  if (!value || !value.trim() || value.length > max)
    throw new PreflightConfigurationError(`${name}_required`);
  return value;
}
function endpoint(
  raw: string | undefined,
  name: string,
  localAllowed: boolean
): string {
  let url: URL;
  try {
    url = new URL(required(raw, name));
  } catch {
    throw new PreflightConfigurationError(`${name}_invalid`);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (localAllowed &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
  ) {
    throw new PreflightConfigurationError(`${name}_secure_url_required`);
  }
  return url.toString();
}

export function loadPreflightConfig(
  env: NodeJS.ProcessEnv = process.env
): PreflightConfig {
  const enabled = flag(env.PREFLIGHT_ENABLED, 'preflight_enabled');
  if (!enabled) return { enabled: false };
  const platform = env.FUNDING_PLATFORM_ENV ?? env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(platform))
    throw new PreflightConfigurationError('preflight_environment_invalid');
  const insecureLocal = flag(
    env.PREFLIGHT_ALLOW_INSECURE_LOCAL,
    'preflight_allow_insecure_local'
  );
  if (
    insecureLocal &&
    (platform === 'production' || env.NODE_ENV === 'production')
  )
    throw new PreflightConfigurationError('preflight_insecure_local_forbidden');
  const tenantId = required(
    env.PREFLIGHT_TENANT_ID,
    'preflight_tenant_id',
    128
  ).trim();
  const clientId = required(
    env.PREFLIGHT_CLIENT_ID,
    'preflight_client_id',
    256
  ).trim();
  const clientSecret = required(
    env.PREFLIGHT_CLIENT_SECRET,
    'preflight_client_secret'
  );
  const timeout = Number(env.PREFLIGHT_REQUEST_TIMEOUT_MS ?? '10000');
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000)
    throw new PreflightConfigurationError('preflight_request_timeout_invalid');
  const scope = env.PREFLIGHT_SCOPE?.trim();
  if (scope && scope.length > 1000)
    throw new PreflightConfigurationError('preflight_scope_invalid');
  const maxCostUsd = Number(env.PREFLIGHT_MAX_COST_USD ?? '0.5');
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0 || maxCostUsd > 100)
    throw new PreflightConfigurationError('preflight_max_cost_invalid');
  return {
    enabled: true,
    baseUrl: endpoint(
      env.PREFLIGHT_URL,
      'preflight_url',
      insecureLocal
    ).replace(/\/$/, ''),
    tokenUrl: endpoint(
      env.PREFLIGHT_TOKEN_URL,
      'preflight_token_url',
      insecureLocal
    ),
    tenantId,
    clientId,
    clientSecret,
    requestTimeoutMs: timeout,
    maxCostUsd,
    ...(scope ? { scope } : {})
  };
}
